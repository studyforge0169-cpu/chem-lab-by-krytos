#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Second PubChem pass: the computed structure table and the CAS registry numbers.

The first pass (fetch_pubchem.py) resolved and verified a CID per species and pulled the
experimental annotations. Two things were left out and are cheap to add here:

  1. PUG-REST `property/` for every verified CID in one batched request per 60 CIDs -
     SMILES, InChI/InChIKey, IUPAC name, XLogP, TPSA, H-bond counts, charge, complexity.
     These are the fields the app needs to draw a molecule and to say "why is this one
     water-soluble". They are computed by PubChem, so they are labelled as such.
  2. PUG-View's `CAS` heading per CID, which is what a bottle label shows. Fetched
     individually because it is not in the computed property list.

Writes raw/pubchem/properties.json and raw/pubchem/cas.json. Safe to re-run: rows already
present are skipped.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "raw", "pubchem")
UA = {"User-Agent": "chemlab-data-build/1.0 (offline virtual chemistry lab dataset)"}
LAST = [0.0]
RATE = 0.28          # ~3.5 req/s, under the published 5/s ceiling


def throttle():
    d = time.time() - LAST[0]
    if d < RATE:
        time.sleep(RATE - d)
    LAST[0] = time.time()


def get(url, tries=4):
    for attempt in range(tries):
        throttle()
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, b"{}"
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(min(40, 3 * (attempt + 1) ** 2))
                continue
            return e.code, b"{}"
        except Exception:                                       # noqa: BLE001
            time.sleep(2 * (attempt + 1))
    return 0, b"{}"


PROPS = ("MolecularFormula,MolecularWeight,Title,CanonicalSMILES,IsomericSMILES,InChI,"
         "InChIKey,IUPACName,XLogP,TPSA,Charge,HBondDonorCount,HBondAcceptorCount,"
         "HeavyAtomCount,RotatableBondCount,Complexity,ExactMass,MonoisotopicMass")
# (probed one at a time: CompoundCharge, TautomerCount and NominalMass are not PUG-REST
#  property names; Charge is. Recorded here so the list is reproducible.)


def fetch_props(verified):
    out = {}
    pf = os.path.join(RAW, "properties.json")
    if os.path.exists(pf):
        out = json.load(open(pf))
    todo = [cid for _sid, cid in verified.items() if cid and str(cid) not in
            {str(v.get("cid")) for v in out.values()}]
    by_cid = {v: k for k, v in verified.items()}
    for i in range(0, len(todo), 60):
        chunk = todo[i:i + 60]
        st, body = get(f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/"
                       f"{','.join(str(c) for c in chunk)}/property/{PROPS}/JSON")
        if st != 200:
            print(f"  props chunk {i}: HTTP {st}")
            continue
        try:
            rows = json.loads(body)["PropertyTable"]["Properties"]
        except Exception as exc:                                # noqa: BLE001
            print(f"  props chunk {i}: parse fail {exc}")
            continue
        for r in rows:
            sid = by_cid.get(r.get("CID"))
            if sid:
                out[sid] = r
        print(f"  props: {len(out)} records")
        json.dump(out, open(pf, "w"), indent=1)
    return out


def fetch_cas(verified):
    cf = os.path.join(RAW, "cas.json")
    out = json.load(open(cf)) if os.path.exists(cf) else {}
    todo = [(sid, cid) for sid, cid in verified.items()
            if cid and sid not in out]
    for n, (sid, cid) in enumerate(todo, 1):
        st, body = get("https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/"
                       f"{cid}/JSON?heading=" + urllib.parse.quote("CAS"))
        got = []
        if st == 200:
            try:
                rec = json.loads(body)["Record"]
            except Exception:                                   # noqa: BLE001
                rec = {}

            def walk(sec):
                for s in sec.get("Section", []) or []:
                    walk(s)
                for info in sec.get("Information", []) or []:
                    for sv in (info.get("Value", {}) or {}).get("StringWithMarkup", []) or []:
                        t = (sv.get("String") or "").strip()
                        if t:
                            got.append(t)
            walk(rec)
        out[sid] = {"cid": cid, "cas": sorted(set(got))[:6]}
        if n % 20 == 0 or n == len(todo):
            print(f"  cas: {n}/{len(todo)}")
            json.dump(out, open(cf, "w"), indent=1)
    return out


def main():
    cm = json.load(open(os.path.join(RAW, "cidmap.json")))
    verified = {sid: v["cid"] for sid, v in cm.items() if v.get("verified") and v.get("cid")}
    print(f"[props] {len(verified)} verified CIDs")
    fetch_props(verified)
    fetch_cas(verified)
    print("[props] done")


if __name__ == "__main__":
    main()
