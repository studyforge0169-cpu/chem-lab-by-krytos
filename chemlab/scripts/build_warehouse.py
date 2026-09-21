#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the chemlab warehouse: data/chemlab.json + data/chemlab.db + data/DATA_REPORT.md.

Design rules this script enforces (they are the reason the dataset is trustworthy):

  * nothing is hand-typed that can be computed: molar mass, atom counts, balancing,
    charge balance and reaction enthalpy all come from scripts/lib/chem.py;
  * every number in the output is wrapped as {value, units, source, ref, confidence};
  * a missing value stays null with a reason - the builder never fills a gap with a
    plausible-looking figure;
  * the reference tables that the engine needs (Ksp with its dissolution equation, E0,
    pKa, dHf, glassware tolerances) are passed through verbatim with their provenance,
    and cross-checked against the species list.

Run:  python3 scripts/build_warehouse.py
"""
import json
import math
import os
import re
import sqlite3
import sys
import datetime
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, os.path.join(ROOT, "data_curated"))

import chem as CH                                     # noqa: E402
import naming as NAM                                   # noqa: E402
import species as SP                                   # noqa: E402
import tables as TB                                    # noqa: E402
import lab as LB                                       # noqa: E402
import periodic as PD                                     # noqa: E402
import reactions as R1                                  # noqa: E402
import reactions2 as R2                                 # noqa: E402

RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "data")
PUBDIR = os.path.join(RAW, "pubchem")

# --------------------------------------------------------------------- provenance
LICENSES = [
    {"dataset": "curated reaction/species/reference tables", "author": "this project",
     "license": "CC0-1.0 (dedicated to the public domain)",
     "note": "every value carries its own source tag; the numbers themselves come from the references below"},
    {"dataset": "CRC Handbook of Chemistry and Physics, 97th ed.", "role": "Ksp, pKa, E0, dHf/S/Cp, density, solubility",
     "license": "copyrighted - only individual numeric values are used, which are not themselves copyrightable"},
    {"dataset": "IUPAC/CIAAW standard atomic weights",
     "role": "molar masses - the curated abridged table ships as data, and the periodic layer "
             "fills all 119 symbols from CIAAW via mendeleev, so no element parses to a guessed "
             "mass",
     "license": "CC BY-NC-SA 4.0 for the table; the values are data"},
    {"dataset": "PubChem (NLM)", "role": "SMILES, InChIKey, computed properties, GHS classification, experimental annotations",
     "license": "PubChem records are largely public domain; individual annotated values cite their own source (CRC, NTP, ILO ICSC, ECHA)",
     "attribution": "must be shown in the app's data-credits screen"},
    {"dataset": "Bowserinator Periodic-Table-JSON", "role": "element backbone",
     "license": "CC BY-SA 3.0", "attribution": "https://github.com/Bowserinator/Periodic-Table-JSON"},
    {"dataset": "mendeleev 1.3.0 (vendored slice, MIT)",
     "role": "periodic layer: atomic weights with CIAAW uncertainties, oxidation states, "
             "Shannon/Slater/Cordero radii, electron affinities, heat capacities, abundances, "
             "phase transitions, natural isotopes, lattice data",
     "license": "MIT (c) Klaus Lida, David Zienkiewicz",
     "attribution": "raw/mendeleev/LICENSE.mendeleev.txt; the library in turn cites CRC 95th "
                    "ed., IUPAC CIAAW (Pure Appl. Chem. 88, 2016), Shannon 1976, Slater 1964, "
                    "Cordero 2008 and the NIST Atomic Spectra Database. Named here because this "
                    "dataset redistributes its values."},
    {"dataset": "OSHA HazCom 29 CFR 1910.1200 / UNECE GHS Rev.9", "role": "H- and P-statement wording",
     "license": "US government work / UNECE - reproduction permitted with acknowledgement"},
    {"dataset": "NFPA 704", "role": "the four ratings",
     "license": "NFPA is a trademark; ratings are reproduced as data from PubChem's ICSC/CRC entries, not from an NFPA table"},
]

UNITS = {
    "mp": "degC", "bp": "degC", "den": "g/cm3", "sol": "g per 100 g water",
    "ka": "pKa units", "kb": "pKb units", "dhf": "kJ/mol", "s": "J/(mol K)",
    "cp": "J/(mol K)", "dH": "kJ per mole of reaction as written",
    "E0": "V vs SHE at 25 C", "K": "dimensionless (standard state 1 M, 1 bar)",
    "dG": "kJ/mol", "Ksp": "(mol/L)^n", "logK": "dimensionless",
    "tolerance": "mL", "capacity": "mL", "wavelength": "nm", "pH": "pH units",
}


def num(value, units, source, ref=None, conf="high", note=None):
    """The one legal shape for a number in this warehouse."""
    d = {"value": value, "units": units, "source": source, "ref_id": ref,
         "confidence": conf}
    if value is None:
        d["missing"] = "not curated in this dataset; see PLAN.md - never interpolated"
    if note:
        d["note"] = note
    return d


def fold(x):
    """ASCII-fold a string so 'Aluminium' and 'Aluminum' compare equal."""
    t = {"oe": "o", "ae": "a"}
    s = str(x)
    for k, v in t.items():
        s = s.replace(k, v)
    return "".join(c for c in s if c.isalnum()).lower()


# ------------------------------------------------------------------ PubChem ingest
def _walk(sec, path=()):
    """Yield (path, information-list) for every leaf section of a PUG-View record."""
    for s in sec.get("Section", []) or []:
        yield from _walk(s, path + (s.get("TOCHeading"),))
    if sec.get("Information"):
        yield path, sec["Information"]


def _refmap(rec):
    return {r.get("ReferenceNumber"): (r.get("SourceName") or "").strip()
            for r in (rec.get("Reference") or [])}


NUM_RE = re.compile(r"(-?\d+(?:\.\d+)?)")


def parse_temp(text):
    """'-78.5 °C' / '113 °F' / '184 K' -> degC float, honouring any pressure suffix."""
    if not text:
        return None
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*°?\s*F\b", text)
    if m:
        return round((float(m.group(1)) - 32) * 5.0 / 9.0, 2)
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*°?\s*C\b", text)
    if m:
        return float(m.group(1))
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*K\b", text)
    if m and "°" not in text:
        return round(float(m.group(1)) - 273.15, 2)
    return None


def parse_density(text):
    if not text:
        return None
    m = re.search(r"(\d\.\d+)\s*(?:g\s*/\s*(?:cm\s*3|cm3|cc|mL|ml)|g\s*cm-3|g\/cu\s*cm)", text)
    if m:
        return float(m.group(1))
    m = re.search(r"sp\.\s*gr\.?\s*[:=]?\s*(0?\.\d+)", text, re.I)
    return float(m.group(1)) if m else None


def heading_values(blob):
    """Flatten one PUG-View heading to [{text, parsed, ref, source}]."""
    rec = (blob or {}).get("Record") or {}
    refs = _refmap(rec)
    out = []
    for _path, infos in _walk(rec):
        for info in infos:
            v = info.get("Value", {}) or {}
            for s in (v.get("StringWithMarkup") or []):
                txt = re.sub(r"\s+", " ", (s.get("String") or "").strip(" \u00b7"))
                if txt:
                    out.append({"text": txt, "ref": info.get("ReferenceNumber"),
                                "source": refs.get(info.get("ReferenceNumber"), "")})
            nums = v.get("Number")
            if nums:
                out.append({"text": " ".join(str(n) for n in nums),
                            "ref": info.get("ReferenceNumber"),
                            "source": refs.get(info.get("ReferenceNumber"), "")})
    return out


def ghs_from(blob):
    """Pull the GHS block out of the classification heading. Shape verified against PUG-View."""
    rec = (blob or {}).get("Record") or {}
    ghs = {"signal_word": None, "pictograms": [], "h_codes": [], "p_codes": [],
           "hazard_classes": [], "precaution_text": []}
    for _path, infos in _walk(rec):
        for info in infos:
            name = (info.get("Name") or "").strip()
            strs = [s.get("String", "") for s in
                    ((info.get("Value") or {}).get("StringWithMarkup") or [])]
            markup = []
            for s in (info.get("Value") or {}).get("StringWithMarkup") or []:
                markup += s.get("Markup") or []
            if name.startswith("Pictogram"):
                ghs["pictograms"] = sorted({m.get("Extra") for m in markup
                                            if m.get("Type") == "Icon" and m.get("Extra")})
            elif name == "Signal":
                ghs["signal_word"] = (strs[0].strip() if strs else None)
            elif "Hazard Statement" in name:
                for s in strs:
                    m = re.match(r"\s*(H\d{3,4}[a-z]?)\s*:\s*(.*?)\s*(?:\[(.*)\])?\s*$", s)
                    if m:
                        ghs["h_codes"].append({"code": m.group(1), "text": m.group(2),
                                               "cat": (m.group(3) or "").strip()})
                        if m.group(3):
                            ghs["hazard_classes"].append(m.group(3).strip())
            elif "Precautionary" in name:
                for s in strs:
                    for pc in re.findall(r"P\d{3}(?:\+P?\d{3})*|[Pp]\d{3}(?:\+[Pp]?\d{3})*", s):
                        ghs["p_codes"].append(pc.upper())
                    if re.match(r"\s*P\d{3}", s):
                        ghs["precaution_text"].append(s)
            elif "Hazard Categories" in name or "Hazards Categories" in name:
                ghs["hazard_classes"] += [s for s in strs if s]
    # de-duplicate, keep order
    ghs["p_codes"] = sorted(set(ghs["p_codes"]))
    ghs["hazard_classes"] = sorted(set(ghs["hazard_classes"]))
    seen, hh = set(), []
    for h in ghs["h_codes"]:
        if h["code"] not in seen:
            seen.add(h["code"])
            hh.append(h)
    ghs["h_codes"] = hh
    return ghs


def nfpa_from(blob):
    rec = (blob or {}).get("Record") or {}
    for _path, infos in _walk(rec):
        for info in infos:
            for s in (info.get("Value") or {}).get("StringWithMarkup") or []:
                m = re.search(r"(\d)\s*-\s*(\d)\s*-\s*(\d)", s.get("String", ""))
                if m:
                    return {"health": int(m.group(1)), "fire": int(m.group(2)),
                            "instability": int(m.group(3)),
                            "source": "PubChem/NFPA-704 diamond"}
    return None


def ingest_pubchem():
    """Read raw/pubchem/*.json into a per-species dict of normalised numbers + GHS."""
    out = {}
    props_path = os.path.join(PUBDIR, "properties.json")
    props = {}
    if os.path.exists(props_path):
        props = json.load(open(props_path))
    cidmap_path = os.path.join(PUBDIR, "cidmap.json")
    cidmap = json.load(open(cidmap_path)) if os.path.exists(cidmap_path) else {}
    cas_path = os.path.join(PUBDIR, "cas.json")
    casfile = json.load(open(cas_path)) if os.path.exists(cas_path) else {}
    for fn in sorted(os.listdir(PUBDIR)) if os.path.isdir(PUBDIR) else []:
        if not fn.endswith(".json") or fn in ("cidmap.json", "properties.json"):
            continue
        sid = fn[:-5]
        d = json.load(open(os.path.join(PUBDIR, fn)))
        heads = d.get("headings") or {}
        rec = {"cid": d.get("cid"), "fetched": d.get("fetched")}
        comp = props.get(sid) or {}
        if comp:
            rec.update({
                "title": comp.get("Title"),
                "props_source": "PubChem PUG-REST computed properties (not experimental)",
                "formula_pubchem": comp.get("MolecularFormula"),
                "mw_pubchem": comp.get("MolecularWeight"),
                "smiles": comp.get("CanonicalSMILES") or comp.get("ConnectivitySMILES"),
                "smiles_isomeric": comp.get("IsomericSMILES"),
                "inchikey": comp.get("InChIKey"),
                "iupac_name": comp.get("IUPACName"),
                "xlogp": comp.get("XLogP"), "tpsa": comp.get("TPSA"),
                "h_donors": comp.get("HBondDonorCount"),
                "h_acceptors": comp.get("HBondAcceptorCount"),
                "heavy_atoms": comp.get("HeavyAtomCount"),
                "exact_mass": comp.get("ExactMass"), "monoisotopic_mass": comp.get("MonoisotopicMass"),
                "charge": comp.get("Charge"),
                "rotatable_bonds": comp.get("RotatableBondCount"),
                "source": "PubChem PUG-REST (computed)",
            })
        for key in ("mp", "bp", "den"):
            h = {"mp": "Melting Point", "bp": "Boiling Point", "den": "Density"}[key]
            parse = parse_density if key == "den" else parse_temp
            cands = []
            for v in heading_values(heads.get(h)):
                val = parse(v["text"])
                if val is not None:
                    cands.append({"value": val, "raw": v["text"], "source": v["source"] or "PubChem annotation",
                                  "units": UNITS[key], "confidence": "annotation",
                                  "note": "as published, with the condition in the text - "
                                          "not normalised to 25 C or 1 bar"})
            rec[key + "_candidates"] = cands
            if key == "den":
                rec["den_raw"] = [v["text"] for v in heading_values(heads.get(h))][:4]
        for h in ("Solubility", "Vapor Pressure", "Flash Point", "Autoignition Temperature",
                  "Explosive Limits", "Heat of Combustion", "Heat of Vaporization",
                  "Enthalpy of Solution", "Corrosivity", "Toxicity Summary", "pH",
                  "Stability/Shelf Life", "Storage Conditions", "Other Experimental Properties",
                  "Decomposition", "Viscosity", "Surface Tension", "Flammability"):
            vals = heading_values(heads.get(h))
            if vals:
                rec[h] = vals[:8]
        g = ghs_from(heads.get("GHS Classification"))
        if g["signal_word"] or g["h_codes"] or g["pictograms"]:
            g["source"] = "PubChem GHS (Reg. EC 1272/2008, ECHA, NITE)"
            rec["ghs"] = g
        n = nfpa_from(heads.get("NFPA Hazard Classification"))
        if n:
            rec["nfpa"] = n
        m = cidmap.get(sid) or {}
        rec["cid_verified"] = bool(m.get("verified"))
        rec["query_used"] = m.get("query")
        entry = casfile.get(sid) or {}
        if entry.get("cas"):
            rec["cas_list"] = entry["cas"]
        out[sid] = rec
    return out


# ------------------------------------------------------------------- species layer
MIXTURE_HINT = re.compile(r"mix|\bx\b|\.\s*x|\+\s*[A-Z]", re.I)
POLYMER_WORDS = {"cellulose", "protein", "starch", "rubber", "nylon", "agar", "chitin",
                 "keratin", "casein", "polyethylene", "pvc", "silk", "wool", "pectin",
                 "dna", "rna", "keratin"}
PLACEHOLDER_WORDS = {"x", "mix", "mixture", "varies", "n/a", "na", "see"}
NOTE_WORDS = ("safety note", "note)", "not included", "reference)", "(setup)", "generator",
              "deliberately excluded", "practice")


def classify_kind(formula, name, note):
    """What sort of record this is, decided from the shape of the entry.

    A formula that will not parse is a fact about the substance, not an error - but the
    cases differ, and the app has to treat them differently: an alloy or a solubility
    mixture can still be weighed per bottle, a polymer has no molecule to count, an alias
    row exists only to redirect a name, and a note row exists only to carry a warning.
    """
    f = str(formula).strip().lower()
    txt = f"{name} {note or ''}".lower()
    if f in POLYMER_WORDS:
        return "polymer"
    if f in PLACEHOLDER_WORDS:
        if "alias" in txt or re.search(r"see\s+[a-z0-9_]+", txt):
            return "alias"
        if any(w in txt for w in NOTE_WORDS):
            return "note"
        return "mixture"
    if "+" in f or ".x" in f or "x" in f.split(".")[-1]:
        return "mixture"
    if re.fullmatch(r"[a-z][a-z0-9\- ]*", f):
        return "polymer" if any(w in txt for w in ("polymer", "protein", "fibre", "paper",
                                                   "soap", "dye", "sol", "clay", "juice",
                                                   "powder (", "solder", "alloy")) else "mixture"
    return "alias"
BAD_CAS = re.compile(r"^(?!\d{2,7}-\d{1,2}-\d$)")


def resolve_colour(desc, cmap):
    """A curated appearance phrase -> one hex for the renderer.

    Phrases like 'white-pale-yellow' (the dry solid, then the solution it makes) are kept
    verbatim in the data; the renderer only needs one colour, so the first component the
    colour map knows is used and the substitution is recorded on the record.
    """
    if not desc:
        return None, None
    d = str(desc).strip().lower()
    if d in cmap:
        return cmap[d], d
    for word in re.split(r"[-/, ]+", d):
        if word in cmap:
            return cmap[word], word
    parts = d.split("-")
    for i in range(len(parts)):
        two = "-".join(parts[i:i + 2])
        if two in cmap:
            return cmap[two], two
    return None, None


def build_species(pub):
    warn = []
    rows, by_formula, by_id = [], defaultdict(list), {}
    for sid, name, formula, state, colour, props in SP.SPECIES:
        try:
            counts = CH.parse_formula(formula)          # parse_formula, not count_atoms:
            hill = CH.hill(counts)                      # it understands 'CuSO4.5H2O' and 'K4[Fe(CN)6]'
            mm = CH.molar_mass(counts)
            kind = "species"
            if MIXTURE_HINT.search(formula) or not counts:
                kind = "mixture"
        except Exception as exc:                                  # noqa: BLE001
            counts, hill, mm = None, None, None
            kind = classify_kind(formula, name, props.get("note"))
            warn.append(f"species {sid}: formula {formula!r} typed as {kind}")
        if sid in by_id:
            warn.append(f"duplicate species id {sid}")
        by_id[sid] = True
        if hill:
            by_formula[hill].append(sid)

        pb = pub.get(sid, {})
        rec = {
            "id": sid, "name": name, "formula_written": formula, "formula": hill,
            "kind": kind, "state": state, "colour": colour, "molar_mass": num(
                mm, "g/mol", "computed from CIAAW standard atomic weights",
                conf="high", note="never typed by hand - chem.molar_mass()"),
            "elements": {e: n for e, n in sorted((counts or {}).items())},
            "hazard_score": props.get("danger", 0),
        }
        # ---- curated physical props, each with provenance
        for k in ("mp", "bp", "den"):
            cur = props.get(k)
            src, conf, note = ("curated (CRC 97th)", "high", None)
            if cur is None:
                cands = pb.get(k + "_candidates") or []
                if cands:
                    pref = sorted(cands, key=lambda c: 0 if "CRC" in c["source"] else 1)[0]
                    spread = round(max(c["value"] for c in cands) - min(c["value"] for c in cands), 2)
                    cur = pref["value"]
                    src, conf = f"PubChem annotation ({pref['source'] or 'source unlisted'})", "med"
                    if len(cands) > 1:
                        note = f"{len(cands)} annotated values, spread {spread} " + \
                               ("degC; the most-cited reference was taken" if k != "den" else "g/cm3")
            rec["props_" + k] = num(cur, UNITS[k], src, ref=(pb.get("cid") if src != "curated (CRC 97th)" else None),
                                     conf=conf, note=note)
        if props.get("sol") is not None:
            s = props["sol"]
            isnum = isinstance(s, (int, float))
            rec["props_sol"] = (num(s, UNITS["sol"], "curated (CRC 97th)", conf="high") if isnum
                                else {"text": str(s), "source": "curated", "confidence": "high",
                                      "units": UNITS["sol"], "value": None,
                                      "note": "qualitative - recorded as text because a number was not curated"})
            if not isnum and re.match(r"^\s*[\d.]+\s*$", str(s)):
                warn.append(f"species {sid}: sol looks numeric but is a string")
        for k in ("ka", "kb"):
            if props.get(k):
                rec["props_" + k] = {"values": props[k], "units": UNITS[k],
                                     "source": "curated (CRC 97th)", "confidence": "high",
                                     "note": "polyprotic: one entry per proton, in order"}
        for k in ("cas", "role", "ion", "flame", "odour", "vol", "hygro", "solv",
                  "stock", "forms", "reacts", "ind", "sweet", "alias", "mixture",
                  "gas_id", "dhf"):
            if k in props:
                rec[k] = props[k]
        # ---- CAS registry number: a bottle label needs it, and a wrong one is worse than none
        pub_cas = pb.get("cas_list") or []
        cur_cas = props.get("cas")
        if cur_cas:
            bad = bool(BAD_CAS.match(str(cur_cas)))
            if bad and pub_cas:
                rec["cas"] = pub_cas[0]
                rec["cas_provenance"] = {
                    "source": "PubChem CAS heading", "ref_id": pb.get("cid"), "confidence": "high",
                    "note": f"the curated value {cur_cas!r} is not a valid registry number and was "
                            f"replaced, not corrected by hand; PubChem lists {len(pub_cas)} for this "
                            "CID, the first is used"}
                warn.append(f"species {sid}: replaced malformed CAS {cur_cas!r} with {pub_cas[0]}")
            elif bad:
                rec["cas"] = None
                rec["cas_provenance"] = {"source": None, "confidence": "missing",
                                         "note": f"curated value {cur_cas!r} is malformed and PubChem "
                                                 "had nothing to check it against"}
                warn.append(f"species {sid}: malformed CAS {cur_cas!r} and no PubChem record to fix it")
            elif pub_cas and str(cur_cas) not in pub_cas:
                rec["cas_conflict"] = {"curated": cur_cas, "pubchem": pub_cas}
                warn.append(f"species {sid}: curated CAS {cur_cas} is not among PubChem's {pub_cas}")
            else:
                rec["cas_provenance"] = {"source": "curated, confirmed by PubChem CAS heading",
                                        "ref_id": pb.get("cid"), "confidence": "high"}
        elif pub_cas:
            rec["cas"] = pub_cas[0]
            rec["cas_provenance"] = {"source": "PubChem CAS heading", "ref_id": pb.get("cid"),
                                     "confidence": "high",
                                     "note": "no CAS was curated for this record; this one is "
                                             "PubChem's, not invented here",
                                     "also_listed": pub_cas[1:5]}
        else:
            rec["cas"] = rec.get("cas")
        # ---- GHS / hazard, only from PubChem's own annotations
        ghs = pb.get("ghs")
        if ghs:
            for h in ghs["h_codes"]:
                h["text_authoritative"] = LB.H_CODES.get(h["code"], h["text"])
            for pc in list(ghs["p_codes"]):
                ghs.setdefault("p_text", {})[pc] = LB.P_CODES.get(pc, "")
            ghs["nfpa"] = pb.get("nfpa")
            rec["ghs"] = ghs
        else:
            rec["ghs"] = {"signal_word": None, "pictograms": [], "h_codes": [],
                          "p_codes": [], "hazard_classes": [],
                          "note": "no GHS block retrieved from PubChem for this record - "
                                  "the app must show 'not assessed here', not a guessed one"}
        if pb:
            rec["pubchem"] = {k: v for k, v in pb.items() if v not in (None, [], {}, "")}
        note = props.get("note")
        if note:
            rec["note"] = note
        m_al = re.search(r"\bsee\s+([A-Za-z][A-Za-z0-9_' ]{2,28}?)(?=[,;.)]|$)",
                         f"{note or ''} {name}")
        if m_al:
            # an alias row is only useful if it points somewhere real: match the target by
            # id first, then by name, and drop it rather than leave a dangling redirect
            cand = m_al.group(1).strip().lower().replace("'s", "s")
            all_ids = {r[0] for r in SP.SPECIES}
            if cand in all_ids:
                rec["alias_of"] = cand
            elif [i for i in all_ids if i.startswith(cand) and cand != i]:
                rec["alias_of"] = sorted(i for i in all_ids if i.startswith(cand))[0]
            else:
                by_nm = {fold(nm): sid for sid, nm, *_rest in SP.SPECIES}
                fc = fold(cand)
                hit = by_nm.get(fc) or next((v for k, v in by_nm.items() if fc and fc in k), None)
                if hit:
                    rec["alias_of"] = hit
                else:
                    warn.append(f"species {sid}: alias points at {cand!r}, which is not a record")
        rec["name_candidates"] = NAM.candidate_names(sid, name, formula) if formula else [name]
        rows.append(rec)
    for hill, ids in by_formula.items():
        if len(ids) > 1:
            for i in ids:
                for r in rows:
                    if r["id"] == i:
                        r["formula_shared_with"] = [x for x in ids if x != i]
    return rows, by_formula, warn


# ----------------------------------------------------------------- reaction layer
AQ_CONTEXT_CATS = {"acid_base", "titration", "metathesis", "precip", "solubility",
                   "dissolution", "hydrolysis", "buffer", "gravimetric", "gas_gen",
                   "complex", "redox", "electrochem", "equilibrium", "displacement"}

class APPARATUS_KIND:
    """`app=` names everything a procedure needs. Split into graduated glassware
    (tables.GLASSWARE), ungraduated kit (lab.ACCESSORIES) and consumables/reagents
    (lab.MATERIALS); anything left over is reported instead of dropped."""
    GLASS = {g[0] for g in TB.GLASSWARE}
    ACC = set(LB.ACCESSORIES)
    MAT = set(LB.MATERIALS)
    # what the kits ask for. Registered means the object has a row in tables.apparatus:
    # being named by a kit is a request, not a registration, and treating it as one used to
    # hide 32 kit items and 4 reaction items that had no row - unregistered_apparatus stayed
    # empty while the register could not answer for them.
    KIT = {i.strip() for v in LB.KITS.values() for i in v}
    REGISTERED = GLASS | ACC

    @staticmethod
    def split_apparatus(names):
        app, mat, unk = [], [], []
        for n in names or []:
            n = str(n).strip()
            if n in APPARATUS_KIND.REGISTERED:
                app.append(n)
            elif n in APPARATUS_KIND.MAT:
                mat.append(n)
            else:
                unk.append(n)
        return {"apparatus": app, "materials": mat, "unknown": unk}


OBS_KEYS = {"p": "precipitate", "g": "gas", "c": "colour_change", "h": "heat",
            "f": "flame", "s": "sound", "l": "light", "t": "timescale",
            "n": "narrative"}
FLOAT_KEYS = {"T", "dH", "E0", "P", "K", "logK", "Kc", "yield", "scale"}
INT_KEYS = {"danger", "n"}


def parse_obs(text):
    out = []
    for tok in (text or "").split(";"):
        tok = tok.strip()
        if not tok:
            continue
        if ":" in tok:
            k, v = tok.split(":", 1)
            k = k.strip()
            if k in OBS_KEYS:
                d = {"code": k, "kind": OBS_KEYS[k], "text": v.strip()}
                if k == "c" and "->" in v:
                    a, b = v.split("->", 1)
                    d["from"], d["to"] = a.strip(), b.strip()
                out.append(d)
                continue
        out.append({"code": "?", "kind": "note", "text": tok})
    return out


def parse_extras(text):
    d = {}
    for tok in (text or "").split(";"):
        tok = tok.strip()
        if not tok:
            continue
        if "=" in tok:
            k, v = tok.split("=", 1)
            k, v = k.strip(), v.strip()
            if k in FLOAT_KEYS:
                try:
                    d[k] = float(v)
                except ValueError:
                    d[k] = v
            elif k in INT_KEYS:
                try:
                    d[k] = int(v)
                except ValueError:
                    d[k] = v
            elif k in ("app", "tag", "safety", "ion", "cat", "light"):
                d[k] = [x.strip() for x in re.split(r"[,\s]+", v) if x.strip()]
            else:
                d[k] = v
        else:
            d.setdefault("_loose", []).append(tok)
    return d


def ion_key(formula, charge):
    """(hill formula, signed charge) - the join key between an equation token such as
    'Cr2O7(2-)' and the curated aqueous-ion table, whose rows are written 'Cr2O7^2-(aq)'."""
    try:
        return (CH.hill(CH.parse_formula(formula)), int(charge))
    except Exception:                                             # noqa: BLE001
        return (formula, int(charge))


def build_ion_index():
    idx = {}
    for k, v in TB.THERMO_ION.items():
        m = re.match(r"^(.*?)\((s|l|g|aq)\)$", k)
        if not m:
            continue
        body, ph = m.group(1), m.group(2)
        if ph != "aq":
            continue
        mq = re.search(r"\^?(\d*)([+-])$", body)
        q = 0
        if mq:
            q = (1 if mq.group(2) == "+" else -1) * int(mq.group(1) or 1)
            body = body[: mq.start()]
        body = body.replace("^", "")
        ent = v if isinstance(v, (list, tuple)) else [None]
        idx[ion_key(body, q)] = {"written_as": k, "dHf": ent[0], "S": ent[1] if len(ent) > 1 else None,
                                "Cp": ent[2] if len(ent) > 2 else None,
                                "source": "curated (CRC 97th, aqueous ions)"}
    for k, val in TB.ION_COLOR.items():
        mq = re.match(r"^([A-Za-z0-9]+?)(\d*)([+-])$", k)
        if not mq:
            continue
        q = (1 if mq.group(3) == "+" else -1) * int(mq.group(2) or 1)
        key = ion_key(mq.group(1), q)
        if key in idx:
            idx[key]["colour"] = val[0]
            idx[key]["colour_hex"] = val[1]
    return idx


ION_INDEX = build_ion_index()
ELECTRON_NOTE = ("computed from the neutral atoms; the electron mass (0.00055 u per charge) "
                 "is ignored, exactly as the handbooks do")


def prescan_ions():
    """Every charged token used anywhere in the reaction files, found before the species
    list is frozen - so an ion term resolves to a record with a real mass and charge."""
    seen = {}
    for _rid, _nm, _cats, lhs, rhs, _obs, _ex in list(R1.REACTIONS) + list(R2.REACTIONS):
        for side in (lhs, rhs):
            for tok in [t.strip() for t in re.split(r"\s\+\s", side or "")]:
                if "(" not in tok and not re.search(r"[+-]\)?$|[+-]$", tok):
                    continue
                try:
                    parsed = CH.parse_side(side)
                except Exception:                                  # noqa: BLE001
                    break
                for _c, formula, _p in parsed:
                    bare, q = CH.strip_charge(formula)
                    if q and re.fullmatch(r"[A-Za-z0-9()\[\]^+\-.*]+", bare):
                        key = ion_key(bare, q)
                        seen.setdefault(key, {"id": f"ion:{bare}({q:+d})", "bare": bare,
                                              "name": _ion_name(bare, q)})
                break
    return seen


def ion_records(ions_seen):
    """Aqueous ions that appear in equations but are not bottles on a shelf. The engine
    still needs their mass and charge, so they get explicit records flagged as derived."""
    out = []
    for (formula, q), info in sorted(ions_seen.items()):
        ent = ION_INDEX.get((formula, q), {})
        try:
            mm = CH.molar_mass(info["bare"])
        except Exception:                                          # noqa: BLE001
            mm = None
        out.append({
            "id": info["id"], "name": info["name"], "formula_written": info["bare"],
            "formula": formula, "kind": "aqueous_ion", "state": "aq",
            "charge": q, "colour": ent.get("colour"), "colour_hex": ent.get("colour_hex"),
            "molar_mass": num(mm, "g/mol", "computed from CIAAW standard atomic weights",
                              conf="high", note=ELECTRON_NOTE),
            "elements": {}, "hazard_score": None, "derived_record": True,
            "props_dhf": num(ent.get("dHf"), "kJ/mol", ent.get("source", "not curated"),
                             conf="high" if ent.get("dHf") is not None else "missing"),
            "note": "aqueous ion used by the net-ionic equations - not a substance you can weigh out",
            "ghs": {"signal_word": None, "pictograms": [], "h_codes": [], "p_codes": [],
                    "hazard_classes": [], "note": "an ion in solution, not a classified product"},
        })
    return out


def _ion_name(bare, q):
    sign = "positive" if q > 0 else "negative"
    n = f"{bare} "
    if q:
        n += f"({abs(q)}{'+' if q > 0 else '-'})"
    return f"{bare} ion" if q in (1, -1) else f"{bare} {abs(q)}{'+' if q > 0 else '-'} ion"


def resolve(token, by_formula, species_names, ions_seen=None):
    """An equation token -> (species id, hill formula, phase). Charged tokens resolve to a
    derived aqueous-ion record so the app can still show mass and charge for them."""
    bare0, q0 = CH.strip_charge(token)
    if re.search(r"[a-z]\s+[a-z]", bare0) and not re.search(r"[A-Za-z]\)\s*[+\-]$", bare0):
        return None, None, None          # prose in a formula slot: refuse to guess
    bare, q = CH.strip_charge(token)
    ph = None
    m = re.search(r"\((s|l|g|aq|conc|dil|satd|fuming|hot|excess|light|dark)\)\s*$", bare)
    if m:
        ph = m.group(1)
        bare = bare[: m.start()].strip()
    else:
        # 'I2(CCl4)' / 'Br2(H2O)' - the bracket is the solvent of the solution, not a phase
        ms = re.search(r"\(([A-Z][A-Za-z0-9.]*|water|alcohol|ether|acetone|CCl4|CHCl3)\)$", bare)
        if ms and ms.group(1) not in ("aq", "s", "l", "g"):
            try:
                CH.parse_formula(ms.group(1))
                solvent = ms.group(1)
                bare = bare[: ms.start()].strip()
            except Exception:                                      # noqa: BLE001
                solvent = None
        else:
            solvent = None
    if q:
        key = ion_key(bare, q)
        iid = f"ion:{bare}({q:+d})"
        if ions_seen is not None and key not in ions_seen:
            ions_seen[key] = {"id": iid, "bare": bare, "name": _ion_name(bare, q)}
        return iid, key[0], ph or "aq"
    for cand in (bare, bare.replace(" ", "")):
        try:
            h = CH.hill(CH.parse_formula(cand))
        except Exception:                                          # noqa: BLE001
            continue
        ids = by_formula.get(h) or []
        if ph == "aq":
            aq = [i for i in ids if i.endswith("aq")]
            if aq:
                return aq[0], h, ph
        if ids:
            return ids[0], h, ph
    nm = species_names.get(fold(bare))
    if nm:
        return nm, None, ph
    return None, None, ph


def dhf_lookup(sid, token, phase, sp_lookup, ctx_aq=False):
    """Enthalpy of formation for one term in its stated phase, or (None, why-not).

    Preference order, all from tables.py:
      1. aqueous ion -> the curated ion table;
      2. the exact phase that is curated for that substance;
      3. for an aqueous solute with no aqueous entry: dHf(solid or liquid) + dH_solution,
         which is a real derivation and the only defensible way to get a solution-phase
         enthalpy from these tables;
      4. report it missing. Never substitute a value from a different phase silently.
    """
    bare, q = CH.strip_charge(token)
    m = re.search(r"\((s|l|g|aq)\)\s*$", bare)
    if m:
        bare, ph_expl = m.group(1), True
        bare = bare[: m.start()].strip()
    if q:
        ent = ION_INDEX.get(ion_key(bare, q))
        if ent and ent.get("dHf") is not None:
            return ent["dHf"], f"curated dHf of {ent['written_as']}"
        return None, f"no aqueous-ion dHf curated for {bare}({q:+d})"
    r = sp_lookup.get(sid) if sid else None
    written = (r or {}).get("formula_written")
    tried = []
    for k in [x for x in (bare, written, sid) if x]:
        kk = re.sub(r"\((s|l|g|aq)\)\s*$", "", str(k)).strip()
        blk = TB.THERMO.get(kk)
        if blk is None:
            try:
                blk = TB.THERMO.get(CH.hill(CH.parse_formula(kk)))
            except Exception:                                      # noqa: BLE001
                blk = None
        if blk is None:
            tried.append(kk)
            continue
        if isinstance(blk, dict):
            if phase in ("s", "l", "g", "aq"):
                want, whence = phase, "stated"
            elif ctx_aq and "aq" in blk:
                want, whence = "aq", "inferred: the reaction is run in aqueous solution"
            else:
                want = "l" if "l" in blk else ("s" if "s" in blk else ("g" if "g" in blk else sorted(blk)[0]))
                whence = f"assumed: the equation states no phase, so the {want} standard state was used"
            dhf_lookup.last_whence = whence
            if want in blk and blk[want]:
                return blk[want][0], f"curated dHf, {want} phase"
            if want == "aq":
                base_ph = "s" if "s" in blk else "l"
                base = blk.get(base_ph)
                dsl = TB.DH_SOLN.get(kk) if kk in TB.DH_SOLN else (
                    TB.DH_SOLN.get(sid) if sid in TB.DH_SOLN else None)
                if base and dsl is not None:
                    return round(base[0] + dsl, 2), (f"derived: dHf({base_ph} phase {base[0]}) "
                                                      f"+ dH_solution({dsl}) - see note")
                return None, f"{kk}: no aqueous dHf and no enthalpy of solution to derive one"
            return None, f"{kk}: no {want}-phase dHf curated"
        if isinstance(blk, (list, tuple)) and blk:
            return blk[0], "curated dHf (single-phase entry)"
    return None, f"no dHf entry for {token}"


def build_reactions(species_rows, by_formula, warn, ions_seen=None):
    names = {}
    for r in species_rows:
        for n in [r["name"]] + list(r.get("alias", []) or []):
            names.setdefault(fold(re.sub(r"\s*\(.*?\)", "", n)), r["id"])
        names.setdefault(fold(r["id"]), r["id"])
    sp_lookup = {r["id"]: r for r in species_rows}
    mass = {r["id"]: r["molar_mass"]["value"] for r in species_rows}
    for r in species_rows:
        if r.get("kind") == "aqueous_ion":
            mass[r["id"]] = r["molar_mass"]["value"]
    rows, seen = [], {}
    for rid, rname, cats, lhs, rhs, obs, extras in list(R1.REACTIONS) + list(R2.REACTIONS):
        cat_list = list(dict.fromkeys(c.strip() for c in (cats or "").split(",") if c.strip()))
        if rid in seen:
            warn.append(f"duplicate reaction id {rid}")
        seen[rid] = 1
        x, o = parse_extras(extras), parse_obs(obs)
        is_process = "process" in cat_list
        e = {"id": rid, "name": rname, "categories": cat_list,
             "record_type": "process" if is_process else "equation",
             "reactants_written": lhs, "products_written": rhs,
             "observations": o, "extras_raw": extras or "",
             "safety": {"danger_score": x.get("danger"),
                        "controls": x.get("safety", []),
                        "max_scale": x.get("scale"),
                        "apparatus": APPARATUS_KIND.split_apparatus(x.get("app", []))["apparatus"],
                        "materials": APPARATUS_KIND.split_apparatus(x.get("app", []))["materials"],
                        "unregistered_apparatus":
                            APPARATUS_KIND.split_apparatus(x.get("app", []))["unknown"],
                        "blocked": "hard-stop-warning" in (x.get("safety") or [])},
             "teaching_note": next((d["text"] for d in o if d["code"] == "n"), None),
             "reference": {k: v for k, v in x.items()
                           if k in ("T", "time", "cat", "light", "yield", "tag", "ion", "app", "scale", "danger", "safety")}}
        e["tags"] = e["reference"].pop("tag", [])
        for group, keys in (("equilibrium", ("K", "logK", "Kc", "P")),
                            ("kinetics", ("T", "time", "cat", "light")),
                            ("thermo_curated", ("dH", "yield"))):
            picked = {k: x[k] for k in keys if k in x}
            if picked:
                e[group] = {k: (num(v, UNITS.get(k, "see source"), "curated",
                                    conf="high") if isinstance(v, float) else v)
                            for k, v in picked.items()}
        if "dH" in x:
            e["thermo_curated"]["dH"]["units"] = UNITS["dH"]
        for side, text in (("reactants", lhs), ("products", rhs)):
            try:
                parsed = CH.parse_side(text)
            except Exception as exc:                                # noqa: BLE001
                warn.append(f"{rid}: {side} unparseable ({exc})")
                parsed = []
            terms = []
            for coef, formula, phase in parsed:
                sid, hill, ph2 = resolve(formula, by_formula, names, ions_seen)
                solvent_tag = None
                msv = re.search(r"\(([A-Z][A-Za-z0-9.]*)\)$", re.sub(
                    r"\((s|l|g|aq)\)$", "", formula))
                if msv and msv.group(1) not in ("s", "l", "g", "aq"):
                    try:
                        CH.parse_formula(msv.group(1))
                        solvent_tag = msv.group(1)
                        if sid is None:
                            sid2, hill2, _p = resolve(msv.group(0)[:0] + formula[: msv.start()],
                                                       by_formula, names, ions_seen)
                            sid, hill = sid2, hill2
                    except Exception:                              # noqa: BLE001
                        solvent_tag = None
                terms.append({"coefficient": coef, "token": formula, "species_id": sid,
                              "phase": phase or ph2, "solvent": solvent_tag, "formula": hill,
                              "moles": coef,
                              "molar_mass": mass.get(sid),
                              "grams_per_mol_rxn": (round(coef * mass[sid], 3)
                                                    if sid and mass.get(sid) else None),
                              "display_name": (sp_lookup[sid]["name"] if sid in sp_lookup else formula)})
                if sid is None and not is_process:
                    e.setdefault("unresolved_terms", []).append(formula)
            e[side] = terms
        if not is_process:
            eq = f"{lhs} -> {rhs}"
            chk = CH.check_equation(eq)
            e["equation"] = eq
            e["balance_check"] = {"atoms_ok": chk["ok"], "charge": chk["charge"],
                                  "elements": chk["elements"], "problems": chk["problems"]}
            if not chk["ok"]:
                warn.append(f"{rid}: atom/charge check failed: {chk['problems']}")
            try:
                rc, pc = CH.balance(lhs, rhs)
                got = ([t["coefficient"] for t in e["reactants"]],
                       [t["coefficient"] for t in e["products"]])
                cur_all = list(got[0]) + list(got[1])
                sol_all = list(rc) + list(pc)
                same = [list(rc), list(pc)] == [list(got[0]), list(got[1])]
                ratio = None
                if not same and all(c for c in cur_all):
                    rs = sorted({round(sv / cv, 6) for sv, cv in zip(sol_all, cur_all)})
                    if len(rs) == 1:
                        ratio = rs[0]
                e["solver"] = {"coefficients": {"reactants": list(rc), "products": list(pc)},
                               "curated": {"reactants": list(got[0]), "products": list(got[1])},
                               "agrees_with_curated": bool(same or ratio is not None),
                               "basis_ratio_vs_smallest_integers": ratio,
                               "note": ("curated coefficients are a rational multiple of the smallest "
                                        "integer balance - legitimate for Hess's-law and per-mole "
                                        "equations, so the build accepts it and says so"
                                        if (ratio is not None and not same) else None),
                               "pinned": "pinned" in cat_list}
                if "pinned" not in cat_list and not e["solver"]["agrees_with_curated"]:
                    warn.append(f"{rid}: curated coefficients differ from the solver")
            except ValueError as exc:
                e["solver"] = {"refused": str(exc), "pinned": "pinned" in cat_list}
                if "pinned" not in cat_list:
                    warn.append(f"{rid}: unbalanced and not pinned ({exc})")
            # ---- ΔH derived from the formation table, then cross-checked against curation
            total, missing = 0.0, []
            all_terms = e["reactants"] + e["products"]
            aq_context = (any(x.get("phase") == "aq" for x in all_terms)
                          or any((sp_lookup.get(x["species_id"]) or {}).get("state") == "aq"
                                 for x in all_terms)
                          or bool(set(cat_list) & AQ_CONTEXT_CATS))
            for side, sign in (("reactants", -1.0), ("products", 1.0)):
                for t in e[side]:
                    v, why = dhf_lookup(t["species_id"], t["token"], t["phase"], sp_lookup,
                                        aq_context)
                    t["dHf_phase_note"] = getattr(dhf_lookup, "last_whence", None)
                    t["dHf_kJ_mol"] = v
                    if v is None:
                        missing.append({"token": t["token"], "reason": why})
                    else:
                        total += sign * t["coefficient"] * v
            derived = round(total, 2)
            e["thermo_derived"] = {
                "dH_rxn": num(None if missing else derived, UNITS["dH"],
                              "computed: sum(n*dHf products) - sum(n*dHf reactants) from tables.THERMO",
                              conf="high",
                              note=(f"incomplete: {len(missing)} term(s) have no dHf entry"
                                    if missing else "all terms have a curated dHf")),
                "per": "one mole of reaction as written (i.e. per the coefficients above)",
                "missing_terms": missing,
                "term_detail": [{"token": t["token"], "dHf": t["dHf_kJ_mol"]}
                                for side in ("reactants", "products") for t in e[side]]}
            cur = (e.get("thermo_curated") or {}).get("dH")
            if isinstance(cur, dict) and cur.get("value") is not None and not missing:
                cv = cur["value"]
                coefs = [t["coefficient"] for t in all_terms] or [1]
                cand = [("per mole of reaction as written", derived, None)]
                for t in all_terms:
                    cand.append((f"per mole of {t['token']}", derived / t["coefficient"], t["token"]))
                bestpick = min(cand, key=lambda c: abs(round(c[1], 2) - cv))
                diff = round(abs(bestpick[1] - cv), 2)
                stated = all(t.get("phase") for t in all_terms)
                verdict = ("agree" if diff <= 3.0 else
                           ("basis-caveat: equation states no phase, so the derived value is a "
                            "standard-state sum and a mixed molecular/aqueous basis is expected - "
                            "prefer the net-ionic equation for enthalpy" if not stated else
                            "CHECK CURATION"))
                e["thermo_derived"]["cross_check"] = {
                    "curated": cv, "derived": derived, "comparison_basis": bestpick[0],
                    "derived_on_that_basis": round(bestpick[1], 2), "abs_diff_kJ": diff,
                    "verdict": verdict}
                if diff > 3.0 and stated:
                    warn.append(f"{rid}: curated dH={cv} vs derived {round(bestpick[1],2)} "
                                f"({bestpick[0]}) - diff {diff}")
            # ---- cell voltage / equilibrium constant
            if isinstance(x.get("E0"), float):
                n = x.get("n") or x.get("n_e")
                far = TB.CONST["F"][0]
                d = {"E0_cell_V": num(x["E0"], UNITS["E0"], "curated (electrode table)", conf="high"),
                     "n_electrons": n}
                if n:
                    d["dG_kJ_mol"] = num(round(-n * far * x["E0"] / 1000.0, 2), "kJ/mol",
                                         "computed: dG = -nFE", conf="high")
                    d["logK_25C"] = num(round(n * x["E0"] / 0.05916, 2), "dimensionless",
                                        "computed: logK = nE0/0.05916 at 298 K", conf="high")
                else:
                    d["note"] = "no electron count curated, so dG and logK are left null"
                e["electrochem"] = d
            # ---- what physically appears, derived from the products themselves
            e["appears"] = {
                "gases": [t["display_name"] for t in e["products"] if t.get("phase") == "g"],
                "precipitates": [t["display_name"] for t in e["products"] if t.get("phase") == "s"],
                "colour_change": next(((d.get("from"), d.get("to")) for d in o
                                       if d["code"] == "c"), None)}
        rows.append(e)
    return rows


# --------------------------------------------------------------- derived rule data
def build_derived(species_rows, by_formula):
    sp_lookup = {r["id"]: r for r in species_rows}
    mass = {r["id"]: r["molar_mass"]["value"] for r in species_rows}
    for r in species_rows:
        if r.get("kind") == "aqueous_ion":
            mass[r["id"]] = r["molar_mass"]["value"]
    out = {}

    # 1. single-displacement: generated from E0, not from a memorised series
    couples = []
    for label, e0 in TB.E0.items():
        m = re.match(r"^([A-Z][A-Za-z]?)\d*\+?/?", label)
        if not m or not isinstance(e0, (int, float)):
            continue
        el = m.group(1)
        if el in ("H", "O", "S", "N", "C", "Cl", "Br", "I", "F", "Se", "P", "Au", "Pt", "Ag", "Hg", "Tl"):
            pass
        couples.append((el, label, float(e0)))
    best = {}
    for el, label, e0 in couples:
        if el not in best or e0 < best[el][2]:
            best[el] = (el, label, e0)
    preds = []
    active = sorted(best.values(), key=lambda t: t[2])
    for i, (m_el, m_lab, m_e0) in enumerate(active):
        for t_el, t_lab, t_e0 in active[i + 1:]:
            if m_lab == t_lab:
                continue
            de = round(t_e0 - m_e0, 3)
            preds.append({
                "metal": m_el, "reduces": t_el,
                "emf_V": num(de, UNITS["E0"], "computed from the two curated E0 values", conf="high"),
                "spontaneous": de > 0,
                "logK": num(round(2 * de / 0.05916, 1), "dimensionless",
                            "computed: logK = nE/0.05916 assuming n=2", conf="med",
                            note="n is assumed 2 for both halves; where n differs (Al, Fe) the "
                                 "number is indicative, the sign is not"),
                "basis": {"reducing": m_lab, "reduced": t_lab}})
    out["displacement"] = {"note": "generated by build_warehouse from tables.E0 - the 'activity "
                                   "series' the app shows is this table, so a metal not in the "
                                   "table has no prediction rather than a wrong one",
                           "count": len(preds), "predictions": preds}

    # 2. molar and mass solubility from each Ksp's own dissolution equation
    sol = []
    for key, (ksp, eqn, src, conf) in TB.KSP.items():
        parts = re.split(r"\s*(?:=|->|\u2192)\s*", eqn)
        if len(parts) < 2:
            sol.append({"id": key, "equation": eqn, "status": "equation not machine-readable"})
            continue
        solid = re.sub(r"^\d+\s*", "", parts[0].strip())
        stoich = []
        for tok in [t.strip() for t in parts[1].split(" + ") if t.strip()]:
            m = re.match(r"^(\d+)?\s*(.+?)(?:\^?(\d*)([+-]))?$", tok)
            n = int(m.group(1)) if m.group(1) else 1
            stoich.append((n, m.group(2).strip(), m.group(3) or "", m.group(4) or ""))
        if not stoich:
            sol.append({"id": key, "equation": eqn, "status": "no ions parsed"})
            continue
        nus = sum(n for n, _f, _q, _s in stoich)
        # Ksp = prod([ion_i])^n_i = s^nus * prod(n_i^n_i)   ->   s = (Ksp/prod)^(1/nus)
        pf = 1.0
        for n, _f, _q, _s in stoich:
            pf *= n ** n
        s_molar = (ksp / pf) ** (1.0 / nus)
        bare_solid = re.sub(r"\^?(\d*)([+-])$", "", solid)
        try:
            solid_h = CH.hill(CH.parse_formula(bare_solid))
        except Exception:                                       # noqa: BLE001
            solid_h = None
        ids = (by_formula.get(solid_h) or by_formula.get(bare_solid) or []) if solid_h else []
        mw = None
        for sid in ids:
            if mass.get(sid):
                mw = mass[sid]
                break
        if mw is None:
            try:
                mw = CH.molar_mass(bare_solid)
            except Exception:                                   # noqa: BLE001
                mw = None
        sol.append({"id": key, "solid": bare_solid, "solid_species_id": (ids or [None])[0],
                    "equation": eqn, "ions": [{"coefficient": n, "formula": f,
                                               "charge": int((q or "1") if q != "-" else -1) if (q or s) else 0}
                                              for n, f, q, s in stoich],
                    "Ksp": num(ksp, UNITS["Ksp"], src, conf=conf),
                    "molar_solubility_M": num(round(s_molar, 10), "mol/L",
                                              "computed: s = (Ksp/prod(n^n))^(1/sum(n))", conf=conf),
                    "g_per_L": (num(round(s_molar * mw * 1000.0, 6), "g/L",
                                    "computed: s * M(solid), solid molar mass from the kernel",
                                    conf=conf) if mw else num(
                                        None, "g/L", "no molar mass for this solid",
                                        note="solid formula did not resolve to a species")),
                    "status": "ok"})
    out["solubility"] = {
        "note": "solubility in PURE WATER from Ksp only. It ignores hydrolysis, so a sulphide, "
                "carbonate or hydroxide will be UNDER-predicted in real water - the app must say "
                "so, because that is exactly what the exam asks.",
        "count": len(sol), "entries": sol}

    # 3. weak-acid pH and titration-end-point data the engine needs per species
    ph = []
    for key, val in TB.PKA.items():
        vals = val[0] if isinstance(val, tuple) else val
        try:
            ka = 10 ** (-vals[0])
        except Exception:                                           # noqa: BLE001
            continue
        c = 0.1
        # solve x^2 + Ka x - Ka c = 0 for [H+] of a c-molar weak acid
        x = (-ka + math.sqrt(ka * ka + 4 * ka * c)) / 2.0
        ph.append({"id": key, "pKa_first": vals[0],
                   "note": (val[1] if isinstance(val, tuple) and len(val) > 1 else ""),
                   "pH_at_0p1M": num(round(-math.log10(x), 2), "pH units",
                                     "computed from pKa at 0.1 mol/L", conf="high")})
    out["weak_acid_ph"] = {"basis": "[H+] solved from Ka and 0.1 M, i.e. the approximation the "
                                    "engine must NOT rely on - the quadratic is used",
                           "count": len(ph), "entries": ph}
    return out


# --------------------------------------------------------------------- elements
def build_elements(warn):
    path = os.path.join(RAW, "elements_source.json")
    if not os.path.exists(path):
        warn.append("raw/elements_source.json missing - element table skipped")
        return []
    d = json.load(open(path))
    rows = []
    for e in d["elements"]:
        rows.append({
            "number": e["number"], "symbol": e["symbol"], "name": e["name"],
            "atomic_mass": num(e.get("atomic_mass"), "u",
                               "Bowserinator Periodic-Table-JSON (from CIAAW)", conf="high"),
            "mass_number": e.get("mass"), "category": e.get("category"),
            "phase": e.get("phase"), "electron_configuration": e.get("electron_configuration"),
            "electron_configuration_semantic": e.get("electron_configuration_semantic"),
            "electronegativity": num(e.get("electronegativityPauling"), "Pauling scale",
                                     "Allen/CIAAW via Periodic-Table-JSON", conf="med"),
            "ionisation_energies_kJ_mol": e.get("ionization_energies"),
            "density": num(e.get("density"), "g/cm3", "Periodic-Table-JSON", conf="med"),
            "mel_point": num(e.get("melt"), "degC", "Periodic-Table-JSON", conf="med"),
            "boil_point": num(e.get("boil"), "degC", "Periodic-Table-JSON", conf="med"),
            "radius": num(e.get("atomic_radius"), "pm", "Periodic-Table-JSON", conf="med"),
            "oxidation_states": e.get("oxidation_states"),
            "abundance_crust_ppm": e.get("abundance_crust"),
            "discovery_year": e.get("discovery"),
        })
    return rows


# ------------------------------------------------------------- tables/lab passthrough
def wrap4(table, units, kind="value"):
    """tables.py stores (value, note, source, confidence) - turn that into the
    warehouse's provenance shape, keeping the note so the app can explain itself."""
    out = {}
    for k, v in table.items():
        if isinstance(v, tuple):
            val = v[0]
            note = v[1] if len(v) > 1 else ""
            src = v[2] if len(v) > 2 else "curated"
            conf = v[3] if len(v) > 3 else "med"
            d = num(val, units, src, conf=conf, note=note or None)
        else:
            d = num(v, units, "curated", conf="med")
        out[k] = d
    return out


def serialise_tables():
    t = {}
    t["ksp"] = {k: {"Ksp": num(v[0], UNITS["Ksp"], v[2], conf=v[3]),
                    "dissolution_equation": v[1],
                    "ion_product_of": v[1].split("->")[-1].strip()}
                for k, v in TB.KSP.items()}
    t["pka"] = {k: {"pKa_values": v[0], "units": "pKa", "source": v[2] if len(v) > 2 else "curated",
                    "confidence": v[3] if len(v) > 3 else "med", "note": v[1]}
                for k, v in TB.PKA.items()}
    t["pkb"] = wrap4(TB.PKB, "pKb units")
    t["kw"] = {k: num(v, "mol^2/L^2", "curated (CRC 97th)", conf="high") for k, v in TB.KW.items()}
    t["e0"] = {k: num(v, UNITS["E0"], "curated (CRC 97th electrode table)", conf="high")
               for k, v in TB.E0.items()}
    t["beta"] = {k: {"log_beta": num(round(math.log10(v[0]), 2), "dimensionless", v[2], conf=v[3]),
                     "beta": num(v[0], "L^n/mol^n", v[2], conf=v[3]), "note": v[1]}
                 for k, v in TB.BETA.items()}
    def _thermo_row(k, v):
        if isinstance(v, dict):          # {phase: (dHf, S, Cp)}
            per_phase = {}
            for ph, x in v.items():
                per_phase[ph] = {"dHf_kJ_mol": x[0], "S_J_molK": x[1], "Cp_J_molK": x[2]}
            return {"per_phase": per_phase, "source": "curated (CRC 97th)",
                    "units": "kJ/mol for dHf; J/(mol K) for S and Cp"}
        return {"dHf_kJ_mol": v[0], "S_J_molK": v[1], "Cp_J_molK": v[2], "phase": "aq",
                "source": "curated (CRC 97th)", "units": "kJ/mol; J/(mol K)"}

    t["thermo"] = {k: _thermo_row(k, v) for k, v in TB.THERMO.items()}
    t["thermo_ion"] = {k: {"dHf_kJ_mol": v[0], "S_J_molK": v[1], "Cp_J_molK": v[2],
                           "units": "kJ/mol, J/(mol K)", "source": "curated (CRC 97th)",
                           "note": "convention: dHf(H+, aq) = 0 exactly"}
                       for k, v in TB.THERMO_ION.items()}
    t["dh_solution"] = {k: num(v, "kJ/mol", "curated (CRC 97th)", conf="high",
                               note=("endothermic - the beaker gets cold" if v > 0
                                     else "exothermic - the beaker gets hot"))
                        for k, v in TB.DH_SOLN.items()}
    t["flame"] = {k: {"colour": v[0], "hex": v[1], "wavelength_nm": num(v[2], UNITS["wavelength"],
                                                                        "curated", conf="med"),
                      "note": v[3]} for k, v in TB.FLAME.items()}
    t["ion_colour"] = dict(TB.ION_COLOR)
    t["colour_map"] = dict(TB.COLOUR_MAP)
    t["aqueous_tension_mmhg"] = {k: num(v, "mm Hg", "curated (CRC vapour-pressure table)", conf="high")
                                for k, v in TB.AQUEOUS_TENSION_MMHG.items()}
    t["water_density"] = {k: num(v, "g/mL", "curated (CRC)", conf="high")
                          for k, v in TB.DENSITY_WATER.items()}
    t["vapour_pressure_kpa"] = {k: num(v, "kPa", "curated (CRC)", conf="high")
                                for k, v in TB.VAPOR_PRESSURE_KPA.items()}
    t["activity_series"] = list(TB.ACTIVITY_SERIES)
    t["solubility_rules"] = list(TB.SOLUBILITY_RULES)
    t["acid_strength_order"] = list(TB.ACID_STRENGTH_ORDER)
    t["solvent_dielectric"] = {k: num(v, "relative permittivity at 20-25 C", "curated", conf="med")
                               for k, v in TB.SOLVENT_DIELECTRIC.items()}
    t["constants"] = {k: {"value": v[0], "units": v[1],
                          "source": v[2] if len(v) > 2 else "SI definition / CODATA 2018",
                          "confidence": v[3] if len(v) > 3 else "high"}
                      for k, v in TB.CONST.items()}
    t["naming"] = {"anions": NAM.ANIONS, "metal_names": NAM.METAL_NAME,
                   "prefixes": {str(k): v for k, v in NAM.PREFIX.items()},
                   "stock_optional": sorted(NAM.STOCK_OPTIONAL)}
    t["glassware"] = [{"id": gid, "name": name, "capacity_mL": num(cap, UNITS["capacity"],
                                                                     "curated (class A nominal)", conf="high"),
                       "graduation_mL": grad,
                       "tolerance_mL": num(tol, UNITS["tolerance"], "curated (manufacturer class A)",
                                          conf="high"),
                       "kind": kind, "note": note,
                       "relative_uncertainty_percent": (round(100.0 * tol / cap, 3)
                                                         if isinstance(tol, (int, float)) and cap else None)}
                      for gid, name, cap, grad, tol, kind, note in TB.GLASSWARE]
    t["techniques"] = [dict({"id": k, "name": k.replace("_", " ").title()}, **v)
                       for k, v in TB.TECHNIQUES.items()]
    t["apparatus"] = {gid: {"name": name, "kind": kind, "note": note,
                            "capacity_mL": cap, "graduation_mL": grad, "tolerance_mL": tol,
                            "graduated": isinstance(tol, (int, float)) and tol > 0,
                            "source": "curated (class A tolerances) / lab.ACCESSORIES",
                            "confidence": "high"}
                      for gid, name, cap, grad, tol, kind, note in TB.GLASSWARE}
    for aid, (kind, note) in LB.ACCESSORIES.items():
        prev = t["apparatus"].get(aid)
        if prev is not None:
            # Five pieces are in both tables (bunsen, desiccator, eudiometer, kipp, woulff) and
            # the glassware row is the one with the numbers: the eudiometer's 50 mL capacity and
            # 0.2 mL graduation, the Kipp's 2 L, and a class-A note about how each behaves. The
            # accessory row is the one with the plain-language sentence. Neither may be dropped, so
            # the shelf gets both sentences and keeps every number the glass table carries.
            if note and note not in prev["note"]:
                prev["note"] = (prev["note"] + " · " + note).strip(" ·")
            prev["kind"] = prev["kind"] or kind
            prev["source"] = "curated (class A tolerances) + lab.ACCESSORIES"
            continue
        t["apparatus"][aid] = {"name": re.sub(r"[_-]+", " ", aid).strip().title(), "kind": kind, "note": note,
                               "capacity_mL": None, "graduation_mL": None, "tolerance_mL": None,
                               "graduated": False, "source": "curated (bench practice)",
                               "confidence": "high"}
    t["materials"] = sorted(LB.MATERIALS)
    t["safety_limits"] = {k: ({"text": v, "value": None, "missing": "this limit is a procedure, not a number",
                               "units": None, "source": "curated (school-lab practice)", "confidence": "high"}
                              if isinstance(v, str) else
                              {"value": v,
                               "units": ("g" if "gram" in k else ("mL" if "mL" in k else "")),
                              "source": "curated (school-lab practice limits)", "confidence": "high",
                              "note": "the app's guard uses these; they are policy, not nature"})
                          for k, v in TB.SAFETY_LIMITS.items()}
    return t


def serialise_lab():
    return {
        "stock_bottles": [{"label": a, "species_id": b, "percent_w_w": c, "density_g_cm3": d,
                           "molarity": e, "note": f,
                           "units": {"percent_w_w": "% w/w", "density": "g/cm3", "molarity": "mol/L"},
                           "source": "curated from typical supplier labels", "confidence": "med"}
                          for a, b, c, d, e, f in LB.STOCK_BOTTLES],
        "indicators": [{"name": a, "pH_low": b, "pH_high": c, "acid_colour": d, "base_colour": e,
                        "acid_hex": f, "base_hex": g, "note": h, "units": "pH",
                        "source": "curated (CRC indicator table)", "confidence": "high"}
                       for a, b, c, d, e, f, g, h in LB.INDICATORS],
        "paper_tests": [{"name": a, "how": b, "positive": c, "note": d} for a, b, c, d in LB.PAPER_TESTS],
        "cation_scheme": LB.CATION_SCHEME, "anion_scheme": LB.ANION_SCHEME,
        "organic_tests": [{"group": a, "reagent": b, "positive": c, "timescale": d, "caution": e}
                          for a, b, c, d, e in LB.ORGANIC_FUNCTIONAL_TESTS],
        "ghs": {"pictograms": LB.GHS_PICTOGRAMS, "h_codes": LB.H_CODES, "p_codes": LB.P_CODES,
                "h_codes_unverified": getattr(LB, "H_CODES_UNVERIFIED", []),
                "p_codes_unverified": getattr(LB, "P_CODES_UNVERIFIED", []),
                "wording_rule": "a code with no entry here must be shown as a bare code; the app "
                                "never paraphrases a hazard sentence it does not have"},
        "mixing_rules": [{"with": a, "and": b, "severity": c, "what_happens": d, "app_action": e,
                          "source": "curated from SDS incompatibility sections", "confidence": "high"}
                         for a, b, c, d, e in LB.MIXING_RULES],
        "refusals": [{"topic": a, "examples": b, "policy": c, "what_is_shown_instead": d}
                     for a, b, c, d in LB.BLOCKED],
        "waste_classes": LB.WASTE_CLASSES, "storage_rules": [{"rule": a, "why": b} for a, b in LB.STORAGE_RULES],
        "emergency": LB.EMERGENCY, "curriculum": LB.CURRICULUM,
        "troubleshooting": [{"symptom": a, "causes": b, "fix": c} for a, b, c in LB.TROUBLESHOOTING],
        "kits": LB.KITS,
    }


def safety_rollup(species_rows, reactions):
    """Everything the app needs to decide 'allow / warn / refuse', in one place."""
    hard_stop = [r["id"] for r in reactions if r["safety"]["blocked"]]
    restricted = [r["id"] for r in reactions if "restricted" in (r["safety"]["controls"] or [])]
    hood = [r["id"] for r in reactions if "fume-hood" in (r["safety"]["controls"] or [])]
    d5 = sorted({r["id"] for r in species_rows if (r.get("hazard_score") or 0) >= 5})
    ghs_crit = sorted({r["id"] for r in species_rows
                       if (r.get("ghs") or {}).get("signal_word") == "Danger"
                       and any(h["code"].startswith(("H300", "H310", "H330", "H224", "H241", "H271", "H200"))
                               for h in r["ghs"].get("h_codes", []))})
    return {"reactions_hard_stopped": hard_stop, "reactions_restricted": restricted,
            "reactions_needing_hood": hood,
            "species_hazard5": d5, "species_ghs_danger_critical": ghs_crit,
            "counts": {"hard_stop": len(hard_stop), "restricted": len(restricted),
                       "hood": len(hood), "hazard5": len(d5), "ghs_critical": len(ghs_crit)},
            "rule": "an app-level guard must be: refuse if the reaction is in "
                    "reactions_hard_stopped, or if a reagent is in species_hazard5 and the "
                    "user has no hood; warn otherwise. The refusal text comes from "
                    "lab.refusals, so the app never argues with the user - it quotes."}


# ------------------------------------------------------------------------- writers
def write_sqlite(path, doc, warn):
    if os.path.exists(path):
        os.remove(path)
    con = sqlite3.connect(path)
    c = con.cursor()
    ex = c.execute
    ex("""CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT)""")
    ex("""CREATE TABLE element(n INTEGER PRIMARY KEY, symbol TEXT, name TEXT, mass REAL,
          category TEXT, phase TEXT, en REAL, cfg TEXT, ox TEXT, mass_unc REAL, mp REAL, bp REAL,
          den REAL, cp REAL, radii_summary TEXT, radii TEXT, isotope_count INTEGER, radioactive INTEGER,
          shelf INTEGER, species_ids TEXT, reactions TEXT, json TEXT)""")
    ex("""CREATE TABLE isotope(element TEXT, mass_number INTEGER, mass_u REAL, abundance_pct REAL,
          spin TEXT, radioactive INTEGER, half_life REAL, half_life_units TEXT, source TEXT)""")
    ex("""CREATE TABLE combination(pair TEXT, elements TEXT, formula TEXT, hill TEXT, states TEXT,
          status TEXT, molar_mass REAL, dchi REAL, pct_ionic REAL, emf REAL, log_k REAL,
          dG_kJ REAL, verdict TEXT, species_id TEXT, reaction_ids TEXT, json TEXT)""")
    ex("""CREATE INDEX ix_comb ON combination(elements, hill)""")
    ex("""CREATE TABLE precip(cation TEXT, anion TEXT, product TEXT, outcome TEXT, basis TEXT,
          ksp REAL, solubility_mol_L REAL, solubility_g_L REAL, molar_mass REAL, colour TEXT,
          colour_hex TEXT, species_id TEXT, net_ionic TEXT, rule TEXT, json TEXT)""")
    ex("""CREATE INDEX ix_precip ON precip(cation, anion)""")
    ex("""CREATE TABLE species(id TEXT PRIMARY KEY, name TEXT, formula TEXT, kind TEXT, state TEXT,
          colour TEXT, colour_hex TEXT, molar_mass REAL, cas TEXT, hazard INTEGER, cid INTEGER,
          smiles TEXT, inchikey TEXT, xlogp REAL, mp REAL, bp REAL, den REAL, ghs_signal TEXT,
          nfpa_health INTEGER, nfpa_fire INTEGER, nfpa_inst INTEGER, note TEXT,
          json TEXT NOT NULL)""")
    ex("""CREATE TABLE prop(species_id TEXT, key TEXT, value REAL, text TEXT, units TEXT,
          source TEXT, confidence TEXT, note TEXT)""")
    ex("""CREATE TABLE h_code(species_id TEXT, code TEXT, text TEXT, category TEXT,
          source TEXT)""")
    ex("""CREATE TABLE p_code(species_id TEXT, code TEXT, text TEXT)""")
    ex("""CREATE TABLE reaction(id TEXT PRIMARY KEY, name TEXT, categories TEXT, record_type TEXT,
          equation TEXT, atoms_ok INTEGER, charge_left REAL, charge_right REAL, danger INTEGER,
          controls TEXT, max_scale TEXT, teaching_note TEXT, dH_curated REAL, dH_derived REAL,
          dH_agree INTEGER, E0 REAL, time_s TEXT, json TEXT NOT NULL)""")
    ex("""CREATE TABLE term(reaction_id TEXT, side TEXT, position INTEGER, coefficient REAL,
          token TEXT, species_id TEXT, phase TEXT, molar_mass REAL, grams REAL, dHf REAL)""")
    ex("""CREATE TABLE observation(reaction_id TEXT, code TEXT, kind TEXT, text TEXT,
          from_colour TEXT, to_colour TEXT)""")
    ex("""CREATE TABLE ksp(id TEXT, ksp REAL, equation TEXT, source TEXT, confidence TEXT,
          solubility_M REAL, g_per_L REAL)""")
    ex("""CREATE TABLE pka(id TEXT, pka REAL, step_index INTEGER, note TEXT, source TEXT, confidence TEXT)""")
    ex("""CREATE TABLE e0(couple TEXT, v REAL, source TEXT)""")
    ex("""CREATE TABLE thermo(key TEXT, phase TEXT, dhf REAL, s REAL, cp REAL, source TEXT)""")
    ex("""CREATE TABLE displacement(metal TEXT, reduces TEXT, emf REAL, logK REAL,
          reducing_couple TEXT, reduced_couple TEXT)""")
    ex("""CREATE TABLE indicator(name TEXT, lo REAL, hi REAL, acid TEXT, base TEXT,
          acid_hex TEXT, base_hex TEXT, note TEXT)""")
    ex("""CREATE TABLE mixing_rule(a TEXT, b TEXT, severity TEXT, happens TEXT, action TEXT)""")
    ex("""CREATE TABLE refusal(topic TEXT, examples TEXT, policy TEXT, shown_instead TEXT)""")
    ex("""CREATE TABLE glassware(id TEXT, name TEXT, capacity REAL, graduation REAL,
          tolerance REAL, uncertainty_pct REAL, kind TEXT, note TEXT)""")
    ex("""CREATE TABLE technique(id TEXT, name TEXT, steps TEXT, apparatus TEXT, why TEXT)""")
    ex("""CREATE TABLE curriculum(board TEXT, experiment TEXT, reactions TEXT, time_min INTEGER)""")
    ex("""CREATE TABLE kit(kit TEXT, item TEXT)""")
    for k, v in doc["meta"].items():
        ex("INSERT INTO meta VALUES(?,?)", (k, json.dumps(v)))
    def val_of(rec, key):
        d = rec.get(key) or {}
        return d.get("value") if isinstance(d, dict) else None

    for e in doc["elements"]:
        ds = e.get("dataset") or {}
        radii = e.get("ionic_radii") or []
        ex("INSERT INTO element VALUES(" + ",".join("?" * 22) + ")", (
            e["number"], e["symbol"], e["name"],
            val_of(e, "atomic_mass"), e.get("category"), e.get("phase_at_298K"),
            val_of(e, "electronegativity_pauling"), e.get("electron_configuration"),
            json.dumps(e.get("oxidation_states_main")), val_of(e, "mass_uncertainty"),
            val_of(e, "mel_point"), val_of(e, "boil_point"), val_of(e, "density"),
            val_of(e, "heat_capacity_molar"),
            json.dumps({"n": len(radii), "charges": sorted({r["charge"] for r in radii})}),
            json.dumps(radii), e.get("isotopes_stable_count") or 0,
            1 if e.get("radioactive") else 0, 0 if e.get("not_a_shelf_reagent") else 1,
            json.dumps(ds.get("species_ids")), json.dumps(ds.get("reaction_ids")), json.dumps(e)))
    for e in doc["elements"]:
        for i in (e.get("isotopes_natural") or []):
            ex("INSERT INTO isotope VALUES(?,?,?,?,?,?,?,?,?)",
               (e["symbol"], i["mass_number"], i["mass_u"], i["abundance_percent"], i["spin"],
                0, None, None, i["source"]))
        ll = e.get("longest_lived_isotope")
        if ll:
            ex("INSERT INTO isotope VALUES(?,?,?,?,?,?,?,?,?)",
               (e["symbol"], ll["mass_number"], ll["mass_u"], None, ll.get("spin"), 1,
                ll.get("half_life"), ll.get("half_life_units"), ll["source"]))
    for c in (doc.get("combinations") or []):
        def val(k):
            d = c.get(k) or {}
            return d.get("value") if isinstance(d, dict) else None
        ex("INSERT INTO combination VALUES(" + ",".join("?" * 16) + ")",
           (c["pair"], json.dumps(c["elements"]), c["formula"], c["formula_hill"],
            json.dumps(c["states"]), c["status"], val("molar_mass"),
            val("electronegativity_difference"), val("percent_ionic_character"),
            val("predicted_emf"), val("log_k"), val("delta_g_kJ_per_mol"), c.get("verdict"),
            c.get("species_id"), json.dumps(c.get("reaction_ids") or []), json.dumps(c)))
    for pr in (doc["tables"]["precipitation_matrix"] or {}).values():
        def pv(k):
            d = pr.get(k) or {}
            return d.get("value") if isinstance(d, dict) else None
        ex("INSERT INTO precip VALUES(" + ",".join("?" * 15) + ")",
           (pr["cation"], pr["anion"], pr["product"], pr.get("outcome"), pr.get("basis"),
            pv("ksp"), pv("solubility_mol_L"), pv("solubility_g_L"), pv("molar_mass"),
            pr.get("colour"), pr.get("colour_hex"), pr.get("species_id"), pr.get("net_ionic"),
            json.dumps(pr.get("rule")), json.dumps(pr)))
    for s in doc["species"]:
        g = s.get("ghs") or {}
        n = g.get("nfpa") or {}
        ex("INSERT INTO species VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
           (s["id"], s["name"], s.get("formula"), s.get("kind"), s.get("state"), s.get("colour"),
            (doc["tables"]["colour_map"].get(s.get("colour") or "") or None),
            (s["molar_mass"] or {}).get("value"), s.get("cas"), s.get("hazard_score"),
            (s.get("pubchem") or {}).get("cid"), (s.get("pubchem") or {}).get("smiles"),
            (s.get("pubchem") or {}).get("inchikey"),
            (s.get("pubchem") or {}).get("xlogp"),
            (s.get("props_mp") or {}).get("value"), (s.get("props_bp") or {}).get("value"),
            (s.get("props_den") or {}).get("value"), g.get("signal_word"),
            n.get("health"), n.get("fire"), n.get("instability"), s.get("note"),
            json.dumps(s)))
        for key in ("mp", "bp", "den", "sol"):
            d = s.get("props_" + key)
            if d:
                ex("INSERT INTO prop VALUES(?,?,?,?,?,?,?,?)",
                   (s["id"], key, d.get("value"), d.get("text"), d.get("units"),
                    d.get("source"), d.get("confidence"), d.get("note")))
        for h in (g.get("h_codes") or []):
            ex("INSERT INTO h_code VALUES(?,?,?,?,?)",
               (s["id"], h["code"], h.get("text_authoritative") or h.get("text"),
                h.get("cat"), g.get("source")))
        for pc in (g.get("p_codes") or []):
            ex("INSERT INTO p_code VALUES(?,?,?)",
               (s["id"], pc, ((g.get("p_text") or {}).get(pc)) or ""))
    for r in doc["reactions"]:
        dc = (r.get("thermo_curated") or {}).get("dH")
        dd = ((r.get("thermo_derived") or {}).get("dH_rxn") or {})
        cc = (r.get("thermo_derived") or {}).get("cross_check") or {}
        ex("INSERT INTO reaction VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
           (r["id"], r["name"], ",".join(r["categories"]), r["record_type"], r.get("equation"),
            1 if (r.get("balance_check") or {}).get("atoms_ok") else None,
            (r.get("balance_check") or {}).get("charge", (None, None))[0],
            (r.get("balance_check") or {}).get("charge", (None, None))[1],
            r["safety"].get("danger_score"), ",".join(r["safety"].get("controls") or []),
            r["safety"].get("max_scale"), r.get("teaching_note"),
            (dc or {}).get("value") if isinstance(dc, dict) else dc,
            dd.get("value"), (1 if cc.get("verdict") == "agree" else (0 if cc else None)),
            ((r.get("electrochem") or {}).get("E0_cell_V") or {}).get("value"),
            json.dumps((r.get("kinetics") or {}).get("time")), json.dumps(r)))
        for side in ("reactants", "products"):
            for i, t in enumerate(r.get(side) or []):
                ex("INSERT INTO term VALUES(?,?,?,?,?,?,?,?,?,?)",
                   (r["id"], side, i, t["coefficient"], t["token"], t.get("species_id"),
                    t.get("phase"), t.get("molar_mass"), t.get("grams_per_mol_rxn"),
                    t.get("dHf_kJ_mol")))
        for ob in r.get("observations") or []:
            ex("INSERT INTO observation VALUES(?,?,?,?,?,?)",
               (r["id"], ob["code"], ob["kind"], ob["text"], ob.get("from"), ob.get("to")))
    for e in doc["derived"]["solubility"]["entries"]:
        ex("INSERT INTO ksp VALUES(?,?,?,?,?,?,?)",
           (e["id"], (e.get("Ksp") or {}).get("value"), e.get("equation"),
            (e.get("Ksp") or {}).get("source"), (e.get("Ksp") or {}).get("confidence"),
            (e.get("molar_solubility_M") or {}).get("value"), (e.get("g_per_L") or {}).get("value")))
    for k, v in doc["tables"]["pka"].items():
        for i, p in enumerate(v["pKa_values"]):
            ex("INSERT INTO pka VALUES(?,?,?,?,?,?)",
               (k, p, i, v.get("note"), v.get("source"), v.get("confidence")))
    for k, v in doc["tables"]["e0"].items():
        ex("INSERT INTO e0 VALUES(?,?,?)", (k, v["value"], v["source"]))
    for tbl in ("thermo", "thermo_ion"):
        for k, v in doc["tables"][tbl].items():
            if "per_phase" in v:
                for ph, x in v["per_phase"].items():
                    ex("INSERT INTO thermo VALUES(?,?,?,?,?,?)",
                       (k, ph, x.get("dHf_kJ_mol"), x.get("S_J_molK"), x.get("Cp_J_molK"), v["source"]))
            else:
                ex("INSERT INTO thermo VALUES(?,?,?,?,?,?)",
                   (k, v.get("phase", "aq"), v.get("dHf_kJ_mol"), v.get("S_J_molK"),
                    v.get("Cp_J_molK"), v["source"]))
    for p in doc["derived"]["displacement"]["predictions"]:
        ex("INSERT INTO displacement VALUES(?,?,?,?,?,?)",
           (p["metal"], p["reduces"], p["emf_V"]["value"], p["logK"]["value"],
            p["basis"]["reducing"], p["basis"]["reduced"]))
    for i in doc["lab"]["indicators"]:
        ex("INSERT INTO indicator VALUES(?,?,?,?,?,?,?,?)",
           (i["name"], i["pH_low"], i["pH_high"], i["acid_colour"], i["base_colour"],
            i["acid_hex"], i["base_hex"], i["note"]))
    for m in doc["lab"]["mixing_rules"]:
        ex("INSERT INTO mixing_rule VALUES(?,?,?,?,?)",
           (m["with"], m["and"], m["severity"], m["what_happens"], m["app_action"]))
    for r in doc["lab"]["refusals"]:
        ex("INSERT INTO refusal VALUES(?,?,?,?)",
           (r["topic"], r["examples"], r["policy"], r["what_is_shown_instead"]))
    for gid, g in doc["tables"]["apparatus"].items():
        ex("INSERT INTO glassware VALUES(?,?,?,?,?,?,?,?)",
           (gid, g["name"], g["capacity_mL"], g["graduation_mL"], g["tolerance_mL"],
            (round(100.0 * g["tolerance_mL"] / g["capacity_mL"], 3)
             if g["tolerance_mL"] and g["capacity_mL"] else None), g["kind"], g["note"]))
    for gl in []:  # glassware rows now come from tables["apparatus"], which includes accessories
        ex("INSERT INTO glassware VALUES(?,?,?,?,?,?,?,?)",
           (gl["id"], gl["name"], gl["capacity_mL"]["value"], gl["graduation_mL"],
            gl["tolerance_mL"]["value"], gl["relative_uncertainty_percent"], gl["kind"], gl["note"]))
    for tq in doc["tables"]["techniques"]:
        ex("INSERT INTO technique VALUES(?,?,?,?,?)",
           (tq["id"], tq.get("goal", ""), json.dumps(tq.get("steps", [])),
            json.dumps(tq.get("apparatus", [])), tq.get("physics") or tq.get("error_model") or ""))
    for board, items in doc["lab"]["curriculum"].items():
        for exp, spec in items.items():
            ex("INSERT INTO curriculum VALUES(?,?,?,?)",
               (board, exp, json.dumps(spec.get("react", [])), spec.get("time")))
    for k, v in doc["lab"]["kits"].items():
        for item in v:
            ex("INSERT INTO kit VALUES(?,?)", (k, item))
    for t in ("species(formula)", "species(id)", "reaction(id)", "term(reaction_id)",
              "prop(species_id)", "h_code(code)", "ksp(id)", "pka(id)", "e0(couple)",
              "thermo(key)", "displacement(metal)", "curriculum(board)", "kit(kit)"):
        tab, col = t.split("(")
        ex(f"CREATE INDEX idx_{tab}_{col[:-1]} ON {t}")
    # count what is actually in the file, every table the schema above created - the report
    # quotes these and an earlier version only looked at three of them
    tables = [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' "
        "ORDER BY name")]
    counts = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}
    expected = {"species": len(doc["species"]), "reaction": len(doc["reactions"]),
                "element": len(doc.get("elements") or []),
                "combination": len(doc.get("combinations") or []),
                "precip": len((doc.get("tables") or {}).get("precipitation_matrix") or [])}
    for t, want in expected.items():
        if counts.get(t) != want:
            warn.append(f"sqlite: table {t} has {counts.get(t)} rows, source had {want}")
    con.commit()
    n = ex("SELECT COUNT(*) FROM species").fetchone()[0]
    nr = ex("SELECT COUNT(*) FROM reaction").fetchone()[0]
    nt = ex("SELECT COUNT(*) FROM term").fetchone()[0]
    con.close()
    return {"sqlite_rows": {"species": n, "reactions": nr, "terms": nt},
            "sqlite_tables": len(tables), "sqlite_counts": counts}


def write_report(path, doc, stats, warn):
    L = []
    A = L.append
    m = doc["meta"]
    A("# chemlab warehouse - data report")
    A("")
    A(f"Generated {m['generated']} by `scripts/build_warehouse.py`. "
      "Every number below was produced by that script, not typed.")
    A("")
    A("## Size")
    c = m["counts"]
    for k in ("species", "species_verified_against_pubchem", "reactions",
              "reactions_balanced_equations", "reactions_process_records",
              "pinned_equations", "elements", "ksp", "pka", "e0_couples",
              "thermo_species", "glassware", "techniques", "displacement_predictions",
              "solubility_entries_derived", "lab_tables", "mixing_rules", "refusal_topics"):
        if k in c:
            A(f"- **{k.replace('_',' ')}**: {c[k]}")
    A("")
    A("## Provenance")
    A("Every numeric field is an object `{value, units, source, ref_id, confidence}`. "
      "`confidence` is one of `high` (curated from CRC-class reference), `med` (single-source or "
      "annotation-derived), `approx` (order-of-magnitude only - the app must show it as such) or "
      "`null` with a `missing` reason. Nothing is interpolated: a gap stays a gap.")
    A("")
    A("### How the numbers split")
    for k, v in stats["sources"].items():
        A(f"- {k}: **{v}**")
    A("")
    A("### What kind of record each species is")
    A("")
    WHY = {
        "species": "a real substance with a formula the kernel can weigh",
        "aqueous_ion": "created by the build so a net-ionic equation resolves; it has a charge "
                       "and a computed mass, but it is not a bottle",
        "mixture": "several components with no fixed ratio (petroleum ether, solder, soda lime, "
                   "bleach): no single molar mass, so the app must not run stoichiometry on it",
        "polymer": "a macromolecule (cellulose, casein, starch): there is no molecule to count",
        "alias": "a pointer row that exists so a name or an old id still resolves; it carries "
                 "`alias_of`, and the app should redirect to that record",
        "note": "a record whose only job is to carry a safety or apparatus note (e.g. that no "
                "cyanide bottle exists here); never selectable as a reagent"}
    for k, v in m["counts"].get("species_kinds", {}).items():
        A(f"- `{k}`: {v} - " + WHY.get(k, "typed by the classifier in build_warehouse"))
    A("")
    A("## Validation the build performs")
    for k, v, intent in stats["checks_list"]:
        if intent:
            flag = "by design"
        elif v == 0:
            flag = "ok"
        else:
            flag = "ATTENTION"
        A(f"- {k}: **{v}** ({flag})")
    A("")
    A("`balance_check` runs the atom/charge ledger over the equation string as it will be shown; "
      "`solver` independently re-balances the skeleton and compares coefficients, so an equation is "
      "either solver-derived or explicitly `pinned` by curation. `pinned` records carry coefficients "
      "a human verified (typically a redox or organic equation where more than one balance exists, "
      "e.g. iodoform) and they are still checked for atom and charge conservation.")
    A("")
    A("`thermo_derived` computes dH for every complete equation from the formation table; where "
      "the curated dH (in `extras`) disagrees by more than 3 kJ the build warns, so the two sources "
      "audit each other.")
    A("")
    A("## ΔH cross-check")
    x = stats["dh"]
    A(f"- complete equations with all dHf present: **{x['complete']}** of **{x['equations']}**")
    A(f"- curated and derived values agree within 3 kJ: **{x['agree']}**")
    A(f"- disagreements that need curation attention: **{x['disagree']}**")
    A(f"- flagged only because the equation states no phase (basis caveat, not an error): "
      f"**{x.get('basis_caveat')}**")
    A(f"- no derived value possible (a term has no dHf): **{x['incomplete']}**")
    if x["worst"]:
        A("")
        A("largest differences (kJ/mol) - these are usually a phase mismatch or a missing term:")
        for rid, d in x["worst"]:
            A(f"- `{rid}`: {d}")
    A("")
    A("## Coverage and honesty limits")
    for s in stats["coverage"]:
        A(s)
    A("")
    A("## Known data defects surfaced by the build (kept, not hidden)")
    A("")
    A("Two classes deserve a note because they are *findings*, not mistakes: a formula that "
      "is a mixture by nature (petroleum ether, litmus, 'mixture') has no single molar mass, so "
      "it is typed `mixture` and left unweighed; and a curated CAS number that PubChem's own "
      "registry list does not contain is kept with a `cas_conflict` object on the record - the "
      "app should show both numbers and say which came from where, rather than silently "
      "prefer one source.")
    if warn:
        for w in warn[:80]:
            A(f"- {w}")
        if len(warn) > 80:
            A(f"- ... and {len(warn) - 80} more")
    else:
        A("- none")
    A("")
    A("## The periodic layer: every element, and what happens when two of them meet")
    A("")
    A("Three things had to be true before the app could offer 'pick any element, mix it, see "
      "everything'. They are, and each is a separate piece of data.")
    A("")
    A("**Every element is a record.** An element row carries: mass with its CIAAW uncertainty, "
      "category, phase at 298 K, group/period/block, electron configuration and shell counts, "
      "Pauling and Allen electronegativity, electron affinity, the ionisation series, atomic / "
      "covalent / metallic / van der Waals radii, ionic radii per coordination number, density, "
      "molar and specific heat capacity, thermal conductivity, lattice structure and constant, "
      "melting and boiling point, fusion and vaporisation enthalpy, crust and sea abundance, "
      "common and extended oxidation states, the natural isotopes with abundances and spins, "
      "the element's CAS number, appearance, a summary, where it comes from and what it is used "
      "for, and a swatch colour for the interface. Each number keeps its own citation.")
    pd_ = stats["periodic"]
    A("")
    A("| element field | elements with a value |")
    A("|---|---|")
    CNT = {"mel_point": "elements_with_melt", "boil_point": "elements_with_boil",
           "density": "elements_with_density", "heat_capacity_molar": "elements_with_cp",
           "fusion_heat_kJ_mol": "elements_with_fusion",
           "electronegativity_pauling": "elements_with_en", "atomic_radius_pm": "elements_with_radius",
           "electron_affinity": "elements_with_ea", "ionisation_kJ_mol": "elements_with_ie",
           "oxidation_states_main": "elements_with_ox", "ionic_radii": "elements_with_radii",
           "isotopes_natural": "elements_with_isotopes", "cas": "elements_with_cas",
           "abundance_crust_ppm": "elements_with_abundance", "summary": "elements_with_summary"}
    for label, key in (("melting point", "mel_point"), ("boiling point", "boil_point"),
                       ("density", "density"), ("heat capacity (molar)", "heat_capacity_molar"),
                       ("fusion enthalpy", "fusion_heat_kJ_mol"),
                       ("electronegativity", "electronegativity_pauling"),
                       ("atomic radius", "atomic_radius_pm"),
                       ("electron affinity", "electron_affinity"),
                       ("ionisation energies", "ionisation_kJ_mol"),
                       ("common oxidation states", "oxidation_states_main"),
                       ("ionic radii", "ionic_radii"), ("natural isotopes", "isotopes_natural"),
                       ("CAS number", "cas"), ("crust abundance", "abundance_crust_ppm"),
                       ("a summary paragraph", "summary")):
        A(f"| {label} | {pd_[CNT[key]]}/{len(doc['elements'])} |")
    A("")
    A(f"**Every element has a bottle.** {pd_['shelf_records_generated']} elements had no record "
      f"at all, so the build generated a standard-state shelf record for each one - formula from "
      f"the phase (H2, O2, Br2, S8 as written, metals as the symbol), molar mass computed, and "
      f"every physical property the cited table gives for that element. "
      f"{pd_['elements_on_the_shelf']}/{pd_['elements']} elements now resolve to at least one "
      f"species. Radioactive and synthetic elements are marked `not_a_shelf_reagent` so the app "
      f"can show the information without letting anybody put them in a beaker.")
    A("")
    A(f"**Every element pair has an answer.** {pd_['combinations']} rows, in "
      f"`data/combinations.json.gz` and the SQLite table `combination`, one per formula the "
      f"valence rules allow for a pair of elements, plus an explicit row for the pairs that give "
      f"nothing:")
    A("")
    A("| status | rows | what the app may say |")
    A("|---|---|---|")
    A(f"| `verified` | {pd_['combinations_verified']} "
      f"| the formula is a substance in this dataset: show its measured properties by following "
      f"`species_id`, and the preparation by following `reaction_ids` |")
    A(f"| `empirical` | {pd_['combinations_empirical']} | same atoms in a different multiple (P2O5 for P4O10): properties come "
      "from that record and both formulas are shown |")
    A(f"| `predicted` | {pd_['combinations_predicted']} | the "
      "valences allow the formula and nothing more is known: mass, electronegativity difference "
      "and Pauling ionic character are arithmetic, and "
      f"{pd_['combinations_with_emf']} rows also carry an emf, log K and a free energy derived "
      "from the electrode table - no melting point, no colour, no yield, ever |")
    A(f"| `none` | {pd_['combinations_none']} | the pair gives no binary compound in this model, with the reason "
      "(noble gas; two metals, so an alloy has no formula; no valence pair that balances) |")
    A("")
    A(f"{pd_['combinations_with_a_curated_reaction']} of those rows point at a reaction already "
      f"in the dataset, which is the honest answer to 'what happens if I mix these two': if an "
      f"equation exists it is shown, and only its own equation.")
    A("")
    A("**Mixing two solutions** is a different question and has its own table: "
      f"`tables.precipitation_matrix`, {pd_['ion_pairs']} cation-anion pairs of the ions this "
      f"shelf can actually supply. {pd_['ion_pairs_by_ksp']} are decided by a measured "
      f"solubility product (with the molar and g/L solubility computed from it), "
      f"{pd_['ion_pairs_by_rule']} by the curated solubility rules and labelled as a rule, "
      f"{pd_['ion_pairs_by_other_rule']} by an acid-base rule read off `tables.pka` (Kw for "
      f"H+ + OH-), "
      f"{pd_['ion_pairs_not_covered']} say 'not covered' rather than guess. "
      f"{pd_['ion_pairs_that_precipitate']} of them give a precipitate.")
    A("")
    A("## What the app can show for one substance")
    A("")
    A("The bottle sheet is not a fixed list: it shows the fields that exist and says why the "
      "rest are blank. This is the whole inventory of what a record may carry.")
    A("")
    A("| field | species | where it comes from |")
    A("|---|---|---|")
    for label, key, src in stats["property_fields"]:
        A(f"| `{key}` | {label} | {src} |")
    A("")
    A("## Refusals (the guard rail the app enforces from data)")
    for r in doc["lab"]["refusals"]:
        A(f"- **{r['topic']}** - {r['policy']} *Shown instead:* {r['what_is_shown_instead']}")
    A("")
    A("## Safety roll-up")
    sr = doc["safety_index"]
    A(f"- hard-stopped reactions: {sr['counts']['hard_stop']} "
      "(``" + ", ".join(sr["reactions_hard_stopped"]) + "``)")
    A(f"- restricted/display-only: {sr['counts']['restricted']}")
    A(f"- needing a fume hood: {sr['counts']['hood']}")
    A(f"- hazard-score-5 species: {sr['counts']['hazard5']}")
    A(f"- species whose GHS block contains a fatal/corrosive/oxidising statement: "
      f"{sr['counts']['ghs_critical']}")
    A("")
    A(sr["rule"])
    A("")
    A("## Licences")
    for lic in doc["meta"]["licenses"]:
        A(f"- {lic['dataset']}: {lic['license']}")
    A("")
    A("## SQLite")
    A("`data/chemlab.db` - see `spec/DATA_SCHEMA.md`. "
      f"{stats.get('sqlite_tables', 0)} tables; every row of the JSON above is in it, and "
      "the counts the build verified against its own source: "
      + ", ".join(f"{k}={v}" for k, v in sorted((stats.get("sqlite_counts") or
                                                 stats["sqlite_rows"]).items()) if v) + ".")
    A("")
    open(path, "w").write("\n".join(L) + "\n")


def main():
    os.makedirs(OUT, exist_ok=True)
    warn = []
    pub = ingest_pubchem()
    species, by_formula, w1 = build_species(pub)
    warn += w1
    ions_seen = prescan_ions()
    ion_rows = ion_records(ions_seen)
    species += ion_rows
    for r in ion_rows:
        by_formula.setdefault(r["formula"], []).append(r["id"])
    # ---- periodic layer: elements, their shelf records, and what two elements give
    tables = serialise_tables()
    elements = PD.build_elements(warn, species, PD.load_source(ROOT))
    state_groups = PD.group_charges(species, tables)
    PD.annotate_states(species, state_groups, elements)
    elem_extra = PD.build_element_species(elements, species, by_formula, warn)
    for r in elem_extra:
        if r["id"] in {x["id"] for x in species}:
            warn.append(f"element record {r['id']} clashes with a curated species - dropped")
            continue
        species.append(r)
        by_formula.setdefault(r["formula"], []).append(r["id"])
    derived = build_derived(species, by_formula)
    reactions = build_reactions(species, by_formula, warn, ions_seen)
    PD.crosslink(elements, species, reactions, warn)
    combinations = PD.build_combinations(elements, species, reactions, tables, warn)
    precip = PD.build_precip_matrix(species, tables, warn)
    # keyed on the ion records: display text like 'MnO4-' repeats between two charges of
    # the same element, and a silent dict collision would drop a pair from the matrix
    tables["precipitation_matrix"] = {r["cation_id"] + "|" + r["anion_id"]: r for r in precip}
    if len(tables["precipitation_matrix"]) != len(precip):
        warn.append("precipitation matrix: %d pairs collapsed onto the same key"
                    % (len(precip) - len(tables["precipitation_matrix"])))
    lab = serialise_lab()
    colour_map = dict(TB.COLOUR_MAP)
    for k in list(colour_map):        # accept 'blood red' as well as 'blood-red'
        colour_map.setdefault(k.replace("-", " "), colour_map[k])
    for s in species:
        c = s.get("colour") or ""
        hexv, matched = resolve_colour(c, colour_map)
        s["colour_hex"] = hexv
        if c:
            s["colour_description"] = c
            if matched and matched != c.lower():
                s["colour_resolved_from"] = matched
                s["colour_note"] = ("the curated phrase describes more than one appearance "
                                    f"(a solid and what it does in solution); the hex is for "
                                    f"'{matched}' and the full phrase is kept in colour_description")
            elif not matched:
                warn.append(f"species {s['id']}: colour {c!r} is not in COLOUR_MAP")

    eq = [r for r in reactions if r["record_type"] == "equation"]
    pinned = [r for r in eq if "pinned" in r["categories"]]
    complete = [r for r in eq if not (r.get("thermo_derived") or {}).get("missing_terms")]
    agree = [r for r in complete if (r["thermo_derived"].get("cross_check") or {}).get("verdict", "").startswith("agree")]
    caveat = [r for r in complete if "basis-caveat" in (r["thermo_derived"].get("cross_check") or {}).get("verdict", "")]
    dis = [(r["id"], (r["thermo_derived"].get("cross_check") or {}).get("abs_diff_kJ"))
           for r in complete if (r["thermo_derived"].get("cross_check") or {}).get("verdict") == "CHECK CURATION"]
    srcs = Counter()
    for s in species:
        for k in ("mp", "bp", "den", "sol"):
            d = s.get("props_" + k)
            if d and d.get("value") is not None:
                srcs[d.get("source", "?")] += 1
    srcs["curated: reference tables (Ksp/pKa/E0/thermo)"] = sum(
        len(tables[k]) for k in ("ksp", "pka", "pkb", "e0", "thermo", "dh_solution"))
    srcs["computed by the kernel (molar mass, balancing, ΔH, solubility, pH, EMF)"] = (
        len(species) + len(eq) + len(complete) + len(derived["solubility"]["entries"])
        + len(derived["weak_acid_ph"]["entries"]) + len(derived["displacement"]["predictions"]))
    srcs["PubChem (verified CID only)"] = len([s for s in species if s.get("pubchem", {}).get("smiles")])
    srcs["PubChem GHS annotations"] = len([s for s in species if (s.get("ghs") or {}).get("h_codes")])
    kinds = dict(Counter(s["kind"] for s in species).most_common())
    doc = {
        "meta": {
            "name": "chemlab warehouse", "version": "1.0.0",
            "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%MZ"),
            "purpose": "the complete data layer for an on-phone virtual chemistry lab: "
                       "what is on the shelf, what happens when you mix it, what you see, "
                       "what it costs in heat and volts, and what must not be run at all",
            "counts": {
                "species": len(species),
                "species_kinds": kinds,
                "species_verified_against_pubchem": len([s for s in species
                                                         if s.get("pubchem", {}).get("cid_verified")]),
                "reactions": len(reactions),
                "reactions_balanced_equations": len(eq),
                "reactions_process_records": len(reactions) - len(eq),
                "pinned_equations": len(pinned),
                "elements": len(elements),
                "element_property_fields": len([k for k in (elements[0] if elements else {})
                                                if not k.startswith("_")]),
                "element_records_generated_from_the_table": len(elem_extra),
                "species_with_oxidation_states": len([x for x in species if x.get("oxidation_states")]),
                "element_pair_formulas": len(combinations),
                "element_pair_formulas_verified": len([c for c in combinations
                                                       if c["status"] == "verified"]),
                "ion_pairs_in_water": len(precip),
                "ion_pairs_with_measured_ksp": len([p for p in precip if p.get("basis") == "measured Ksp"]),
                "isotopes": len([i for e in elements for i in (e.get("isotopes_natural") or [])]),
                "ksp": len(tables["ksp"]), "pka": len(tables["pka"]),
                "e0_couples": len(tables["e0"]), "thermo_species": len(tables["thermo"]),
                "glassware": len(tables["glassware"]), "techniques": len(tables["techniques"]),
                "displacement_predictions": derived["displacement"]["count"],
                "solubility_entries_derived": derived["solubility"]["count"],
                "lab_tables": len(lab), "mixing_rules": len(lab["mixing_rules"]),
                "refusal_topics": len(lab["refusals"]),
                "indicators": len(lab["indicators"]),
                "organic_tests": len(lab["organic_tests"]),
                "stock_bottle_recipe_rows": len(lab["stock_bottles"]),
            },
            "licenses": LICENSES,
            "conventions": {
                "states": "s solid, l liquid, g gas, aq aqueous, v viscous",
                "equation_format": "terms separated by ' + ', coefficient then formula, optional "
                                   "(s|l|g|aq) phase, ions as Cu(2+) / OH(1-); '->' between sides",
                "numeric_field": "{value, units, source, ref_id, confidence}; null value always has a "
                                 "'missing' reason",
                "record_type": "equation = machine-balanced and checkable; process = a described "
                               "procedure whose skeleton cannot be balanced honestly (e.g. 'rusting', "
                               "'fractional distillation of crude oil'), so the app must not attempt "
                               "stoichiometry on it",
                "temperature": "all curated data at 25 degC / 298.15 K unless the field says otherwise",
                "pressure": "1 bar; gases treated as ideal - stated because a 2 % error in a gas "
                            "volume experiment is exactly this assumption",
            },
        },
        "elements": elements,
        "combinations_note": ("element-pair combinations are in data/combinations.json.gz and in "
                              "the SQLite table 'combination', not inside this file: they are "
                              "%d rows of mostly predictions and an app should load them lazily"
                              % len(combinations)),
        "species": species,
        "reactions": reactions,
        "tables": tables,
        "lab": lab,
        "derived": derived,
        "safety_index": safety_rollup(species, reactions),
        "index": {
            "colour_map": colour_map,
            "by_formula": {k: v for k, v in sorted(by_formula.items())},
            "hazard_order": sorted({(r["safety"].get("danger_score") or 0) for r in reactions}),
            "categories": dict(Counter(c for r in reactions for c in r["categories"]).most_common()),
            "gas_tests": {r["id"]: r.get("reference", {}).get("ion") for r in reactions
                          if r.get("reference", {}).get("ion")},
        },
    }
    checks = {
            "equations failing the atom/charge ledger": len([r for r in eq if not r["balance_check"]["atoms_ok"]]),
            "equations where the solver disagrees with curation": len(
                [r for r in eq if r.get("solver", {}).get("agrees_with_curated") is False]),
            "unresolved species tokens in equations": len(
                {t for r in reactions for t in (r.get("unresolved_terms") or [])}),
            "species with a malformed CAS": len([w for w in warn if "malformed CAS" in w]),
            "equations the solver could not re-derive (ambiguous skeleton, pinned by hand)": len(
                [r for r in eq if "refused" in r.get("solver", {})]),
            "reaction records typed process (no equation by design)": len(reactions) - len(eq),
            "species with no strict formula (mixture/polymer/alias/note)": len(
                [s2 for s2 in species if s2.get("kind") != "species"]),
        }
    checks_list = [
        ("equations failing the atom/charge ledger", checks["equations failing the atom/charge ledger"], False),
        ("equations where the solver disagrees with curation",
         checks["equations where the solver disagrees with curation"], False),
        ("unresolved species tokens in equations",
         checks["unresolved species tokens in equations"], False),
        ("species with a malformed CAS", checks["species with a malformed CAS"], False),
        ("equations the solver could not re-derive, kept as pinned",
         checks["equations the solver could not re-derive (ambiguous skeleton, pinned by hand)"], True),
        ("reaction records typed process (no equation, by design)",
         checks["reaction records typed process (no equation by design)"], True),
        ("species with no strict formula (mixture/polymer/alias/note)",
         checks["species with no strict formula (mixture/polymer/alias/note)"], True),
        ("build warnings", len(warn), True),
    ]
    stats = {
        "checks": checks,
        "checks_list": checks_list,
        "sources": dict(srcs.most_common()),
        "dh": {"equations": len(eq), "complete": len(complete), "agree": len(agree),
               "disagree": len(dis), "basis_caveat": len(caveat),
               "incomplete": len(eq) - len(complete),
               "worst": sorted({(a, -b) for a, b in dis if b}, key=lambda t: t[1])[:12]},
        "coverage": [], "sqlite_rows": {}, "sqlite_counts": {},
                       "sqlite_tables": 0,
        "periodic": {
            "elements": len(elements),
            "with_melt_point": len([e for e in elements
                                    if (e.get("mel_point") or {}).get("value") is not None]),
            "with_density": len([e for e in elements if (e.get("density") or {}).get("value") is not None]),
            "with_oxidation_states": len([e for e in elements if e.get("oxidation_states_main")]),
            "with_isotopes": len([e for e in elements if e.get("isotopes_natural")]),
            "with_ionic_radii": len([e for e in elements if e.get("ionic_radii")]),
            "shelf_records_generated": len(elem_extra),
            "elements_on_the_shelf": len([e for e in elements if e["dataset"]["species_count"]]),
            "combinations": len(combinations),
            "combinations_verified": len([c for c in combinations if c["status"] == "verified"]),
            "combinations_with_emf": len([c for c in combinations
                                         if (c.get("predicted_emf") or {}).get("value") is not None]),
            "combinations_with_a_curated_reaction": len([c for c in combinations
                                                        if c.get("reaction_ids")]),
            "ion_pairs": len(precip),
            "ion_pairs_by_ksp": len([p for p in precip if p.get("basis") == "measured Ksp"]),
            "ion_pairs_by_rule": len([p for p in precip if p.get("basis") == "solubility rule"]),
            "ion_pairs_not_covered": len([p for p in precip if not p.get("outcome")]),
            "ion_pairs_by_other_rule": len([p for p in precip if p.get("outcome")
                                            and p.get("basis") not in ("measured Ksp",
                                                                        "solubility rule")]),
            "ion_pairs_that_precipitate": len([p for p in precip if p.get("outcome") == "precipitate"]),
            "species_annotated_with_states": len([x for x in species if x.get("oxidation_states")]),
            "combinations_predicted": len([c for c in combinations if c["status"] == "predicted"]),
            "combinations_none": len([c for c in combinations if c["status"] == "none"]),
            "combinations_empirical": len([c for c in combinations if c["status"] == "empirical"]),
            "elements_with_melt": len([e for e in elements if (e.get("mel_point") or {}).get("value") is not None]),
            "elements_with_boil": len([e for e in elements if (e.get("boil_point") or {}).get("value") is not None]),
            "elements_with_ox": len([e for e in elements if e.get("oxidation_states_main")]),
            "elements_with_isotopes": len([e for e in elements if e.get("isotopes_natural")]),
            "elements_with_radii": len([e for e in elements if e.get("ionic_radii")]),
            "elements_with_cas": len([e for e in elements if e.get("cas")]),
            "elements_with_summary": len([e for e in elements if e.get("summary")]),
            "elements_with_density": len([e for e in elements if (e.get("density") or {}).get("value") is not None]),
            "elements_with_cp": len([e for e in elements if (e.get("heat_capacity_molar") or {}).get("value") is not None]),
            "elements_with_fusion": len([e for e in elements if (e.get("fusion_heat_kJ_mol") or {}).get("value") is not None]),
            "elements_with_en": len([e for e in elements if (e.get("electronegativity_pauling") or {}).get("value") is not None]),
            "elements_with_radius": len([e for e in elements if (e.get("atomic_radius_pm") or {}).get("value") is not None]),
            "elements_with_ea": len([e for e in elements if (e.get("electron_affinity") or {}).get("value") is not None]),
            "elements_with_ie": len([e for e in elements if e.get("ionisation_kJ_mol")]),
            "elements_with_abundance": len([e for e in elements if (e.get("abundance_crust_ppm") or {}).get("value") is not None]),
        },
        "combos_path": "data/combinations.json.gz",
        "combo_rows": [],
    }
    PROP_FIELDS = [
        ("identity", "id", "the record key, unique"),
        ("identity", "name", "curated"),
        ("identity", "formula", "as written, then Hill-normalised by the kernel"),
        ("identity", "state", "curated: s / l / g / aq"),
        ("identity", "kind", "species / aqueous_ion / mixture / polymer / alias / note"),
        ("composition", "elements", "counted from the formula by the kernel"),
        ("composition", "oxidation_states", "assigned by the textbook rules (kernel); per element"),
        ("weighing", "molar_mass", "computed from CIAAW atomic weights"),
        ("appearance", "colour_description", "curated wording, kept verbatim"),
        ("appearance", "colour_hex", "resolved through tables.colour_map"),
        ("appearance", "odour", "curated"),
        ("physical", "props_mp", "CRC 97th, else a PubChem annotation, else null with a reason"),
        ("physical", "props_bp", "as melting point"),
        ("physical", "props_den", "as melting point"),
        ("physical", "props_sol", "curated solubility in water"),
        ("physical", "heat_capacity_molar", "element table (only on generated element bottles)"),
        ("physical", "fusion_heat", "element table: q = n x this, for melt/freeze maths"),
        ("phase", "vol", "volatile / hygroscopic / deliquescent flags"),
        ("thermo", "dhf", "standard enthalpy of formation, phase-aware"),
        ("acidity", "props_ka", "from tables.pka where the species is itself the acid"),
        ("safety", "ghs", "PubChem GHS block: signal word, H and P statements, pictograms, NFPA"),
        ("safety", "hazard_score", "curated 0-5 teaching hazard, not a legal classification"),
        ("safety", "cas", "curated, cross-checked against PubChem's registry list"),
        ("identification", "flame", "flame colour for the wire-loop test"),
        ("structure", "pubchem", "CID-verified SMILES, InChIKey, XLogP, TPSA, H-bond counts"),
        ("teaching", "note", "curated: what to look for, what it is used for, the caveat"),
        ("shelf", "stock", "the stock-bottle entry: concentration, purity, container"),
        ("links", "forms", "other records of the same substance (anhydrous/hydrate/solution)"),
        ("links", "reacts", "reaction ids this species appears in"),
        ("links", "alias_of", "for alias rows: the record to show instead"),
    ]
    n_sp = len(species)
    stats["property_fields"] = [
        (f"{len([x for x in species if x.get(k) not in (None, {}, [], '')])}/{n_sp}", k, src)
        for _grp, k, src in PROP_FIELDS]
    def have(pred, pool):
        return len([s for s in pool if pred(s)])
    n = len(species)
    n_real = len([s for s in species if s.get("kind") == "species"])
    n_named = len([s for s in species
                   if s.get("pubchem", {}).get("cid_verified")])
    for label, pred in (
            ("molar mass", lambda s: s["molar_mass"]["value"]),
            ("aqueous solubility", lambda s: s.get("props_sol")),
            ("melting point", lambda s: (s.get("props_mp") or {}).get("value")),
            ("boiling point", lambda s: (s.get("props_bp") or {}).get("value")),
            ("density", lambda s: (s.get("props_den") or {}).get("value")),
            ("CAS number", lambda s: s.get("cas")),
            ("GHS block (signal word or H-codes)", lambda s: (s.get("ghs") or {}).get("h_codes")),
            ("SMILES (PubChem, CID formula+MW verified)", lambda s: (s.get("pubchem") or {}).get("smiles")),
            ("InChIKey", lambda s: (s.get("pubchem") or {}).get("inchikey")),
            ("a teaching note", lambda s: s.get("note"))):
        den = n_named if label.startswith(("SMILES", "InChIKey")) else (
            n_real if label in ("molar mass", "CAS number") else n)
        pool = ([s for s in species if s.get("pubchem", {}).get("cid_verified")]
                if den is n_named else
                ([s for s in species if s.get("kind") == "species"] if den is n_real else species))
        k = have(pred, pool)
        extra = (f" - of the {n_named} records whose PubChem CID was verified by formula and "
                 f"molar mass" if den is n_named else
                 (f" - excluding the {n - n_real} mixture/alias/ion rows, which have no single "
                  f"formula to weigh" if den is n_real else ""))
        stats["coverage"].append(f"- {label}: {k}/{den} ({100.0 * k / max(den,1):.0f} %){extra}")
    stats["coverage"].append(f"- reactions with a curated timescale: "
                             f"{len([r for r in reactions if (r.get('kinetics') or {}).get('time')])}/{len(reactions)}")
    stats["coverage"].append(f"- reactions with a curated hazard level: "
                             f"{len([r for r in reactions if r['safety'].get('danger_score') is not None])}/{len(reactions)}")
    stats["coverage"].append(f"- reactions with apparatus named: "
                             f"{len([r for r in reactions if r['safety'].get('apparatus')])}/{len(reactions)}")
    stats["coverage"].append("- SMILES coverage is capped by PubChem name resolution, not by the "
                             "dataset's ambition; unresolved records keep `smiles: null` and the app "
                             "shows a 2D formula box instead of nothing.")

    jpath = os.path.join(OUT, "chemlab.json")
    json.dump(doc, open(jpath, "w"), indent=1, ensure_ascii=False, sort_keys=False)
    cpath = os.path.join(OUT, "combinations.json")
    json.dump({"meta": {"generated": doc["meta"]["generated"],
                        "what": ("every pair of elements, the formula their common oxidation "
                                 "states allow, and what is real about it: 'verified' rows point "
                                 "at a species record in chemlab.json, 'predicted' rows carry only "
                                 "arithmetic (mass, electronegativity difference, ionic character) "
                                 "and, where both binary electrode couples exist, an emf and a log K"),
                        "rows": len(combinations),
                        "verified": len([c for c in combinations if c["status"] == "verified"]),
                        "with_emf": len([c for c in combinations
                                        if (c.get("predicted_emf") or {}).get("value") is not None])},
               "combinations": combinations},
              open(cpath, "w"), indent=1, ensure_ascii=False)
    _sq = write_sqlite(os.path.join(OUT, "chemlab.db"),
                       dict(doc, combinations=combinations), warn)
    stats["sqlite_rows"] = _sq["sqlite_rows"]
    stats["sqlite_counts"] = _sq["sqlite_counts"]
    stats["sqlite_tables"] = _sq["sqlite_tables"]
    import gzip
    for f in (jpath, cpath, os.path.join(OUT, "chemlab.db")):
        with open(f, "rb") as i, gzip.open(f + ".gz", "wb", 9) as o:
            o.write(i.read())
    stats["dh"]["worst"] = [(a, -b) for a, b in stats["dh"]["worst"]]
    write_report(os.path.join(OUT, "DATA_REPORT.md"), doc, stats, warn)
    json.dump({"warnings": warn, "stats": {k: v for k, v in stats.items() if k != "coverage"},
               "unresolved_tokens": sorted({t for r in reactions for t in (r.get("unresolved_terms") or [])})},
              open(os.path.join(OUT, "build_log.json"), "w"), indent=1, default=str)
    print(f"[build] species {n} | reactions {len(reactions)} ({len(eq)} equations, "
          f"{len(reactions)-len(eq)} process, {len(pinned)} pinned)")
    print(f"[build] checks {stats['checks']}")
    print(f"[build] dh {stats['dh']['complete']}/{stats['dh']['equations']} complete, "
          f"{stats['dh']['agree']} agree, {stats['dh']['disagree']} disagree")
    pd_ = stats["periodic"]
    print(f"[build] periodic elements {pd_['elements']} ({pd_['shelf_records_generated']} shelf "
          f"records generated) | combinations {pd_['combinations']} "
          f"({pd_['combinations_verified']} verified, {pd_['combinations_with_emf']} with an emf) "
          f"| ion pairs {pd_['ion_pairs']} ({pd_['ion_pairs_by_ksp']} by measured Ksp, "
          f"{pd_['ion_pairs_by_rule']} by a solubility rule, "
          f"{pd_['ion_pairs_by_other_rule']} by an acid-base rule, "
          f"{pd_['ion_pairs_not_covered']} not covered)")
    print(f"[build] warnings {len(warn)}")
    print(f"[build] json {os.path.getsize(jpath)/1e6:.1f} MB | "
          f"db {os.path.getsize(os.path.join(OUT,'chemlab.db'))/1e6:.1f} MB")
    return doc, stats, warn


if __name__ == "__main__":
    main()
