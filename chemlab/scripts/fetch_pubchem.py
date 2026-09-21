# -*- coding: utf-8 -*-
"""fetch_pubchem.py — pulls *measured* properties + safety annotations from PubChem
and caches them under raw/pubchem/. Everything the app ships can therefore be traced
back to an external source instead of my typing.

Endpoints (all public, no key):
  name -> CID : /rest/pug/compound/name/{name}/cids/JSON
  record      : /rest/pug_view/data/compound/{cid}/JSON?heading={heading}
Rate limit respected: PubChem allows 5 requests/second; we do 4/s.
"""
import json, os, re, sys, time, threading, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "raw", "pubchem")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from lib import chem as C  # noqa: E402
sys.path.insert(0, os.path.join(ROOT, "scripts", "lib"))
import naming as NAMING  # noqa: E402

HEADINGS = [
 "Melting Point", "Boiling Point", "Density", "Solubility", "Other Experimental Properties",
 "GHS Classification", "Hazard Statements", "Precautionary Statement List",
 "NFPA Hazard Classification", "Vapor Pressure", "pH", "Decomposition", "Stability/Shelf Life",
 "Storage Conditions", "Viscosity", "Surface Tension", "Autoignition Temperature",
 "Explosive Limits", "Heat of Combustion", "Heat of Vaporization", "Enthalpy of Solution",
 "Corrosivity", "Toxicity Summary", "Flammability", "Flash Point",
]
UA = {"User-Agent": "chemlab-data-build/1.0 (offline virtual chemistry lab dataset)"}
_lock = threading.Lock()
_next = [0.0]


def throttle():
    with _lock:
        now = time.time()
        wait = _next[0] - now
        if wait > 0:
            time.sleep(wait)
            now = time.time()
        _next[0] = max(now, _next[0]) + 0.25


def get(url, tries=5):
    for attempt in range(tries):
        throttle()
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, b"{}"
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(min(60, 2 ** attempt * 1.5))
                continue
            return e.code, e.read()
        except Exception:
            time.sleep(min(30, 2 ** attempt))
    return 0, b"{}"


def expected_formula(formula):
    try:
        return C.hill(C.parse_formula(formula))
    except Exception:
        return None


def props_for(cid):
    st, body = get("https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/%d/"
                   "property/MolecularFormula,MolecularWeight/JSON" % cid)
    if st != 200:
        return None
    try:
        return json.loads(body)["PropertyTable"]["Properties"][0]
    except Exception:
        return None


def cids_for(name):
    st, body = get("https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/"
                   + urllib.parse.quote(name) + "/cids/JSON")
    if st != 200:
        return []
    try:
        return json.loads(body)["IdentifierList"]["CID"]
    except Exception:
        return []


def resolve(id_, name, formula):
    """Try candidate names, and only accept a CID whose molecular formula AND molar
    mass agree with the curated record. Prevents 'searched for copper, got Cu2+ ion'."""
    try:
        from pubchem_names import PUBCHEM_NAME
    except Exception:
        PUBCHEM_NAME = {}
    if PUBCHEM_NAME.get(id_):
        cands = [PUBCHEM_NAME[id_]]
    else:
        cands = list(NAMING.candidate_names(id_, name, formula))
    exp_f = expected_formula(formula)
    try:
        exp_mw = C.molar_mass(formula)
    except Exception:
        exp_mw = None
    tried = []
    for q in cands:
        tried.append(q)
        for cid in cids_for(q)[:6]:
            p = props_for(cid)
            if not p:
                continue
            got_f = p.get("MolecularFormula")
            got_mw = float(p.get("MolecularWeight") or 0)
            norm = None
            try:
                norm = C.hill(C.parse_formula(got_f))
            except Exception:
                pass
            fm = (norm == exp_f) if (norm and exp_f) else False
            mw = (exp_mw is None) or abs(got_mw - exp_mw) < max(0.06, 0.0015 * (exp_mw or 0))
            if fm and mw:
                return id_, int(cid), q, True
    return id_, None, tried[0] if tried else name, False


def fetch_cid(id_, cid):
    out = {}
    for h in HEADINGS:
        st, body = get(f"https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/{cid}/JSON?heading="
                       + urllib.parse.quote(h))
        if st == 200 and body.strip() and body != b"{}":
            try:
                out[h] = json.loads(body)
            except Exception:
                out[h] = {"_raw_failed": True}
        else:
            out[h] = None
    with open(os.path.join(RAW, f"{id_}.json"), "w") as f:
        json.dump({"id": id_, "cid": cid, "headings": out, "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ")}, f)
    return id_, cid, sum(1 for v in out.values() if v)


def main():
    os.makedirs(RAW, exist_ok=True)
    sys.path.insert(0, os.path.join(ROOT, "data_curated"))
    from species import SPECIES
    skip_formula = {"mix", "mixture", "various", "x", "unknown", ""}
    todo = []
    for id_, name, formula, state, colour, note in SPECIES:
        if str(formula).lower() in skip_formula or note.get("alias"):
            continue
        if os.path.exists(os.path.join(RAW, f"{id_}.json")):
            continue
        todo.append((id_, name, formula))
    print(f"[fetch] {len(todo)} species to resolve", flush=True)
    cids, done = {}, 0
    with ThreadPoolExecutor(max_workers=3) as pool:
        for id_, cid, q, ok in pool.map(lambda t: resolve(*t), todo):
            cids[id_] = {"cid": cid, "query": q, "verified": ok}
            done += 1
            if done % 25 == 0:
                print(f"[fetch] resolved {done}/{len(todo)}", flush=True)
    with open(os.path.join(RAW, "cidmap.json"), "w") as f:
        json.dump(cids, f, indent=1)
    jobs = [(i, v["cid"]) for i, v in cids.items() if v["cid"]]
    jobs = [j for j in jobs if not os.path.exists(os.path.join(RAW, f"{j[0]}.json"))]
    print(f"[fetch] fetching {len(jobs)} records x {len(HEADINGS)} headings "
          f"(~{len(jobs)*len(HEADINGS)*0.26/60:.1f} min)", flush=True)
    t0 = time.time()
    n = 0
    with ThreadPoolExecutor(max_workers=3) as pool:
        for id_, cid, hits in pool.map(lambda t: fetch_cid(*t), jobs):
            n += 1
            if n % 20 == 0:
                el = time.time() - t0
                print(f"[fetch] {n}/{len(jobs)}  {el/60:.1f} min  eta {el/n*(len(jobs)-n)/60:.1f} min", flush=True)
    print(f"[fetch] DONE {n} records in {(time.time()-t0)/60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
