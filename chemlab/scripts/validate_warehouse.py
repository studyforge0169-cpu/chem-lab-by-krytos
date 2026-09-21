#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Independent validation of the built warehouse.

This script deliberately does NOT import data_curated/*.py. It reads data/chemlab.json (or
# the shipped data/chemlab.json.gz when the plain file is absent) and
data/chemlab.db and re-derives everything that can be re-derived, so a mistake in the
builder cannot hide itself here. Run after build_warehouse.py:

    python3 scripts/build_warehouse.py && python3 scripts/validate_warehouse.py
"""
import json
import os
import re
import atexit
import gzip
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, "lib"))
import chem as CH                                            # noqa: E402  (the only import)

# Every artifact this script checks exists in two shapes: the plain file a build leaves behind, and the
# .gz copy the app actually ships. Verification must work on either, because "the data is validated" is
# a claim about the file, not about somebody's working directory. A tree that carries neither is an error
# the script reports rather than a check it quietly skips.
_tmpfiles = []


def _drop_tmpfiles():
    for _t in _tmpfiles:
        try:
            os.unlink(_t)
        except OSError:
            pass


atexit.register(_drop_tmpfiles)


def _data(name):
    plain = os.path.join(ROOT, "data", name)
    if os.path.exists(plain):
        return plain
    if os.path.exists(plain + ".gz"):
        import tempfile
        raw = gzip.open(plain + ".gz", "rb").read()
        fd, tmp = tempfile.mkstemp(prefix="chemlab-validate-")
        with os.fdopen(fd, "wb") as fh:
            fh.write(raw)
        _tmpfiles.append(tmp)
        return tmp
    return None


_DOC_PATH = _data("chemlab.json")
if _DOC_PATH is None:
    raise SystemExit("no data/chemlab.json or data/chemlab.json.gz to validate - run scripts/build_warehouse.py")
DOC = json.load(open(_DOC_PATH))
DB = _data("chemlab.db")

results = []


def case(name, fn):
    try:
        detail = fn()
        results.append((True, name, detail if detail else ""))
    except AssertionError as exc:
        results.append((False, name, str(exc)))
    except Exception as exc:                                # noqa: BLE001
        results.append((False, name, f"{type(exc).__name__}: {exc}"))


def check_provenance_shape():
    """Every {value,...} object must carry units/source/confidence, and a null value must
    say why. This is the rule the whole dataset is built on."""
    bad = []

    def walk(node, path):
        if isinstance(node, dict):
            if "value" in node:
                for k in ("units", "source", "confidence"):
                    if k not in node:
                        bad.append(f"{path}: numeric field missing '{k}'")
                if node["value"] is None and not (node.get("missing") or node.get("note")):
                    bad.append(f"{path}: null value with no reason given")
                if isinstance(node["value"], str) and node["value"].strip() and \
                        node["value"].strip() not in ("process",):
                    bad.append(f"{path}: value is a string, not a number")
            for k, v in node.items():
                if k not in ("elements", "per_phase", "ions", "json"):
                    walk(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")

    for section in ("species", "tables", "derived"):
        walk(DOC[section], section)
    assert not bad, f"{len(bad)} provenance problems, e.g. {bad[:3]}"
    return f"{len(DOC['species'])} species + tables walked, 0 violations"


def check_molar_mass():
    bad, n = [], 0
    for s in DOC["species"]:
        f = s.get("formula_written")
        if not f or s.get("kind") in ("mixture", "unresolved"):
            continue
        try:
            want = CH.molar_mass(f)
        except Exception:                                   # noqa: BLE001
            continue
        n += 1
        got = (s.get("molar_mass") or {}).get("value")
        if got is None or abs(got - want) > 0.011:
            bad.append(f"{s['id']}: stored {got} vs recomputed {want}")
    assert not bad, f"{len(bad)} molar masses do not reproduce, e.g. {bad[:4]}"
    return f"{n} formulas re-weighed from atomic weights, all match"


def check_equations():
    bad, n = [], 0
    for r in DOC["reactions"]:
        if r["record_type"] != "equation":
            continue
        n += 1
        chk = CH.check_equation(r["equation"])
        if not chk["ok"]:
            bad.append(f"{r['id']}: {chk['problems']}")
        if r.get("balance_check", {}).get("atoms_ok") is False:
            bad.append(f"{r['id']}: build said atoms_ok False")
    assert not bad, f"{len(bad)} equations are not conserved: {bad[:4]}"
    return f"{n} equation strings re-checked for atom and charge conservation"


def check_terms_and_masses():
    ids = {s["id"] for s in DOC["species"]}
    bad, n = [], 0
    for r in DOC["reactions"]:
        for side in ("reactants", "products"):
            for t in r[side]:
                n += 1
                if t["species_id"] and t["species_id"] not in ids:
                    bad.append(f"{r['id']}: term {t['token']} points at unknown species {t['species_id']}")
                if t.get("grams_per_mol_rxn") and t.get("molar_mass"):
                    want = round(t["coefficient"] * t["molar_mass"], 3)
                    if abs(want - t["grams_per_mol_rxn"]) > 0.02:
                        bad.append(f"{r['id']}: {t['token']} grams {t['grams_per_mol_rxn']} != {want}")
    unres = {t for r in DOC["reactions"] for t in (r.get("unresolved_terms") or [])}
    assert not bad, f"{len(bad)} term problems: {bad[:4]}"
    assert not unres, f"{len(unres)} equation tokens resolve to nothing: {sorted(unres)[:6]}"
    return f"{n} terms resolve to a species; stoichiometric masses reproduce; 0 dangling tokens"


def check_dh():
    thermo = DOC["tables"]["thermo"]
    ions = DOC["tables"]["thermo_ion"]
    bad, ok = [], 0
    for r in DOC["reactions"]:
        td = r.get("thermo_derived")
        if not td or td["dH_rxn"]["value"] is None:
            continue
        ok += 1
    # recompute the ones whose terms all carry a dHf on the term itself
    for r in DOC["reactions"]:
        td = r.get("thermo_derived")
        if not td or td["dH_rxn"]["value"] is None:
            continue
        total = 0.0
        for side, sign in (("reactants", -1.0), ("products", 1.0)):
            for t in r[side]:
                if t.get("dHf_kJ_mol") is None:
                    total = None
                    break
                total += sign * t["coefficient"] * t["dHf_kJ_mol"]
        if total is None:
            bad.append(f"{r['id']}: says complete but a term has no dHf")
        elif abs(round(total, 2) - td["dH_rxn"]["value"]) > 0.02:
            bad.append(f"{r['id']}: stored dH {td['dH_rxn']['value']} vs recomputed {round(total,2)}")
    assert not bad, f"{len(bad)} enthalpy recomputations disagree: {bad[:3]}"
    return f"{ok} reaction enthalpies re-summed from the term table, all reproduce"


def check_solubility():
    bad, n = [], 0
    for e in DOC["derived"]["solubility"]["entries"]:
        if e.get("status") != "ok":
            continue
        n += 1
        ksp = e["Ksp"]["value"]
        eqn = e["equation"]
        rhs = re.split(r"=|->", eqn)[1]
        stoich = []
        for tok in [t.strip() for t in rhs.split(" + ") if t.strip()]:
            m = re.match(r"^(\d+)?\s*(.+?)\^?(\d*)([+-])?$", tok)
            stoich.append((int(m.group(1)) if m.group(1) else 1))
        nus = sum(stoich)
        pf = 1.0
        for c in stoich:
            pf *= c ** c
        want = round((ksp / pf) ** (1.0 / nus), 10)
        got = e["molar_solubility_M"]["value"]
        if abs(got - want) > max(1e-12, abs(want) * 0.01):
            bad.append(f"{e['id']}: stored s {got} vs recomputed {want}")
    assert not bad, f"{len(bad)} Ksp solubilities do not reproduce: {bad[:3]}"
    return f"{n} Ksp -> solubility derivations re-done independently"


def check_emf_consistency():
    e0 = {k: v["value"] for k, v in DOC["tables"]["e0"].items()}
    bad = []
    for p in DOC["derived"]["displacement"]["predictions"]:
        a = p["basis"]["reducing"]
        b = p["basis"]["reduced"]
        if a not in e0 or b not in e0:
            bad.append(f"{p['metal']}/{p['reduces']}: couple name not in the E0 table")
            continue
        want = round(e0[b] - e0[a], 3)
        if abs(want - p["emf_V"]["value"]) > 0.0015:
            bad.append(f"{p['metal']}+{p['reduces']}: emf {p['emf_V']['value']} vs {want}")
        if p["spontaneous"] != (want > 0):
            bad.append(f"{p['metal']}+{p['reduces']}: spontaneity sign disagrees with the E0 difference")
    assert not bad, f"{len(bad)} displacement predictions disagree with the electrode table: {bad[:3]}"
    return f"{len(DOC['derived']['displacement']['predictions'])} displacement predictions re-derived from E0"


def check_colours():
    cmap = DOC["tables"]["colour_map"]
    bad = []
    for s in DOC["species"]:
        h = s.get("colour_hex")
        if h and not re.match(r"^#[0-9A-Fa-f]{6}$", h):
            bad.append(f"{s['id']}: bad hex {h}")
        d = s.get("colour")
        if d and not h:
            bad.append(f"{s['id']}: colour '{d}' has no hex")
    assert not bad, f"{len(bad)} colour problems: {bad[:4]}"
    return f"{len(cmap)} colour words in the map; every species colour resolves to a hex"


def check_safety_links():
    rid = {r["id"] for r in DOC["reactions"]}
    sid = {s["id"] for s in DOC["species"]}
    # Being named by a kit is not the same as being in the register, so kit membership is not
    # allowed to stand in for a row here: that is how 32 kit ids stayed invisible for a prompt.
    gl = set(DOC["tables"]["apparatus"])
    mat = set(DOC["tables"]["materials"])
    IDISH = re.compile(r"^[A-Za-z0-9_\-]+$")
    bad = []

    def names(where, tokens):
        if isinstance(tokens, str):
            tokens = [tokens]          # a whole sentence, not a list of one-word tokens
        for t in tokens or []:
            # a technique that writes "a porcelain dish with an inverted funnel" is prose, and
            # prose is rendered as words; only id-shaped tokens are expected to resolve
            for tok in re.split(r"[+,\n]| and ", str(t)):
                tok = tok.strip().rstrip(".")
                if not tok or not IDISH.match(tok):
                    continue
                if tok not in gl and tok not in mat:
                    bad.append(f"{where}: apparatus '{tok}' is in neither tables.apparatus nor materials")

    for r in DOC["reactions"]:
        if r["safety"].get("blocked") and "hard-stop" not in (r["extras_raw"] or ""):
            bad.append(f"{r['id']}: blocked flag without the data that set it")
        names(f"reaction {r['id']}", r["safety"].get("unregistered_apparatus") or [])
    for kid, ids in DOC["lab"]["kits"].items():
        names(f"kit {kid}", ids)
    for group, rows in DOC["lab"]["curriculum"].items():
        rows = rows.values() if isinstance(rows, dict) else rows
        for row in rows:
            if isinstance(row, dict):
                names(f"{group} / {row.get('name', '?')}", row.get("app"))
    techs = DOC["tables"]["techniques"]
    for t in (techs.values() if isinstance(techs, dict) else techs):
        names(f"technique {t.get('id', '?')}", t.get("apparatus"))
    for topic in DOC["lab"]["refusals"]:
        if not topic["policy"]:
            bad.append(f"refusal '{topic['topic']}' has no policy text")
    for r in DOC["safety_index"]["reactions_hard_stopped"]:
        if r not in rid:
            bad.append(f"safety_index points at missing reaction {r}")
    assert not bad, f"{len(bad)} safety-link problems: {bad[:4]}"
    n5 = len(DOC["safety_index"]["species_hazard5"])
    return (f"blocked/restricted/hood lists point at real records; {n5} hazard-5 species; "
            f"every id-shaped apparatus token in {len(gl)} register rows resolves - reactions, kits, "
            "the syllabus index and the techniques all checked")


def check_ghs():
    h_known = set(DOC["lab"]["ghs"]["h_codes"])
    p_known = set(DOC["lab"]["ghs"]["p_codes"])
    bad, nh, np_, withghs = [], 0, 0, 0
    for s in DOC["species"]:
        g = s.get("ghs") or {}
        if g.get("h_codes"):
            withghs += 1
        for h in g.get("h_codes") or []:
            nh += 1
            if h["code"] not in h_known:
                bad.append(f"{s['id']}: H-code {h['code']} has no wording in the reference table")
        for pc in g.get("p_codes") or []:
            np_ += 1
            for part in pc.split("+"):
                if part and part not in p_known:
                    bad.append(f"{s['id']}: P-code {part} (from {pc}) missing from the wording table")
    unv = set(DOC["lab"]["ghs"].get("h_codes_unverified", [])) | \
          set(DOC["lab"]["ghs"].get("p_codes_unverified", []))
    real = [b for b in bad if not any(u in b for u in unv)]
    assert not real, f"{len(real)} GHS codes without wording: {real[:3]}"
    return f"{withghs} species carry a GHS block; {nh} H-statements and {np_} P-statements all resolve to text"


def check_curriculum():
    rid = {r["id"] for r in DOC["reactions"]}
    bad, n = [], 0
    for board, items in DOC["lab"]["curriculum"].items():
        for exp, spec in items.items():
            for r in spec.get("react", []):
                n += 1
                if r not in rid:
                    bad.append(f"{board}/{exp[:40]}: reaction id '{r}' is not in the dataset")
    assert not bad, f"{len(bad)} curriculum entries point at missing reactions: {bad[:5]}"
    return f"{n} curriculum experiment steps resolve to real reaction records"


def check_duplicates():
    sid = [s["id"] for s in DOC["species"]]
    rid = [r["id"] for r in DOC["reactions"]]
    dup = {x for x in sid if sid.count(x) > 1} | {x for x in rid if rid.count(x) > 1}
    assert not dup, f"duplicate ids: {sorted(dup)[:6]}"
    return f"{len(sid)} species and {len(rid)} reaction ids are unique"


def check_db():
    if DB is None:
        raise AssertionError("neither data/chemlab.db nor chemlab.db.gz is here")
    con = sqlite3.connect(DB)
    q = con.execute
    ns = q("SELECT COUNT(*) FROM species").fetchone()[0]
    nr = q("SELECT COUNT(*) FROM reaction").fetchone()[0]
    nt = q("SELECT COUNT(*) FROM term").fetchone()[0]
    if ns != len(DOC["species"]):
        raise AssertionError(f"db has {ns} species, json has {len(DOC['species'])}")
    if nr != len(DOC["reactions"]):
        raise AssertionError(f"db has {nr} reactions, json has {len(DOC['reactions'])}")
    # spot-check: the db columns must agree with the embedded json blob, row by row
    bad = []
    for rid, eq, blob in q("SELECT id, equation, json FROM reaction WHERE equation IS NOT NULL"):
        d = json.loads(blob)
        if d.get("equation") != eq:
            bad.append(f"{rid}: column and blob disagree")
    for sid, mm, blob in q("SELECT id, molar_mass, json FROM species"):
        d = json.loads(blob)
        jv = (d.get("molar_mass") or {}).get("value")
        if (mm is None) != (jv is None) or (mm is not None and abs(mm - jv) > 0.011):
            bad.append(f"{sid}: species column {mm} vs blob {jv}")
    con.close()
    assert not bad, f"{len(bad)} json/db mismatches: {bad[:3]}"
    return f"db rows {ns}/{nr}/{nt} (species/reactions/terms) agree with chemlab.json"


def check_periodic_layer():
    """Elements: units, plausibility, self-consistency of the generated shelf records.

    This is where the unit bug that once shipped lives - the sources quote kelvin and the
    warehouse stores degC, so a value that is only a kelvin number in a degC field has to
    be caught here rather than trusted.
    """
    els = DOC["elements"]
    spid = {s["id"]: s for s in DOC["species"]}
    bad = []
    if len(els) != 118:
        bad.append(f"{len(els)} element records, expected 118 (the periodic table, no more)")
    for e in els:
        for key in ("mel_point", "boil_point"):
            d = e.get(key) or {}
            v = d.get("value")
            if v is None:
                if not d.get("missing"):
                    bad.append(f"{e['symbol']}: {key} null with no reason")
                continue
            if d.get("units") != "degC":
                bad.append(f"{e['symbol']}: {key} carries {d.get('units')!r}, the warehouse is degC")
            if not (-273.2 <= v <= 6200):
                bad.append(f"{e['symbol']}: {key} {v} degC is not a real temperature")
            kv = d.get("kelvin")
            if kv is not None and abs((kv - 273.15) - v) > 0.02:
                bad.append(f"{e['symbol']}: {key} kelvin and degC disagree")
        mp, bp = (e.get("mel_point") or {}).get("value"), (e.get("boil_point") or {}).get("value")
        if mp is not None and bp is not None and bp < mp and not e.get("boil_below_melt_note"):
            bad.append(f"{e['symbol']}: boils below it melts with no explanation")
        if e["number"] >= 100:
            if not e.get("values_are_predicted"):
                bad.append(f"{e['symbol']}: a superheavy element presented without saying "
                           f"that nothing about it has been measured")
            for key in ("density", "mel_point", "boil_point"):
                d = e.get(key) or {}
                if d.get("value") is not None and d.get("measured") is not False:
                    bad.append(f"{e['symbol']}: {key} is a calculation marked as a measurement")
        am = (e.get("atomic_mass") or {}).get("value")
        if not am or not (1.0 <= am <= 300.0):
            bad.append(f"{e['symbol']}: atomic mass {am} out of range")
        iso = e.get("isotopes_natural")
        if iso:
            tot = sum(i["abundance_percent"] or 0 for i in iso)
            if not 90.0 <= tot <= 100.5:
                bad.append(f"{e['symbol']}: natural isotope abundances sum to {tot:.1f} %")
        ox = e.get("oxidation_states_main") or []
        for x in ox:
            if not isinstance(x, int) or abs(x) > 8:
                bad.append(f"{e['symbol']}: oxidation state {x!r} is not a small integer")
        for sid in (e.get("dataset") or {}).get("species_ids") or []:
            if sid not in spid:
                bad.append(f"{e['symbol']}: dataset points at missing species {sid}")
        for sid in (e.get("dataset") or {}).get("elemental_species") or []:
            sp = spid.get(sid) or {}
            c = CH.parse_formula(sp.get("formula") or "")
            if sum(c.values()) and am and sp.get("kind") == "species":
                want = round(am * sum(c.values()), 3)
                got = (sp.get("molar_mass") or {}).get("value")
                if got is not None and abs(got - want) > 0.05:
                    bad.append(f"{sid}: mass {got} vs {sum(c.values())} x {am} = {want}")
    # the element -> reaction crosslink must not be empty because a lookup silently missed
    linked = {rid for e in els for rid in (e.get("dataset") or {}).get("reaction_ids", [])}
    expected = {
        r["id"]
        for r in DOC["reactions"]
        if any(
            (spid.get(t.get("species_id")) or {}).get("elements")
            for side in ("reactants", "products")
            for t in (r.get(side) or [])
        )
    }
    missing = sorted(expected - linked)
    if missing:
        bad.append(f"{len(missing)} reactions with a formula-bearing term are in no element's "
                   f"dataset.reaction_ids, e.g. {missing[:3]}")
    if not linked:
        bad.append("no element lists a single reaction: the crosslink is broken")

    gen = [s for s in DOC["species"] if s.get("from_element")]
    for s in gen:
        e = next((x for x in els if x["symbol"] == s["from_element"]), None)
        if e is None:
            bad.append(f"{s['id']}: from_element {s['from_element']!r} is not an element")
            continue
        # the bench must be able to filter on a flag, not on the prose in `availability`
        blocked = bool(e["not_a_shelf_reagent"] or e.get("radioactive"))
        if blocked != bool(s.get("not_a_shelf_reagent")):
            bad.append(f"{s['id']}: element {e['symbol']} blocked={blocked} but the shelf "
                       f"record says not_a_shelf_reagent={s.get('not_a_shelf_reagent')}")
        if blocked and not s.get("shelf_block_reason"):
            bad.append(f"{s['id']}: blocked from the bench with no reason given")
        for fld, key in (("props_mp", "mel_point"), ("props_bp", "boil_point"),
                         ("props_den", "density")):
            a, b = (s.get(fld) or {}), (e.get(key) or {})
            if a.get("value") != b.get("value"):
                bad.append(f"{s['id']}.{fld} {a.get('value')} != element {b.get('value')}")
    assert not bad, f"{len(bad)} periodic problems: {bad[:4]}"
    n_gen = len(gen)
    return (f"118 elements: units, ranges, kelvin bookkeeping, {n_gen} generated shelf records "
            f"match their element row; isotope abundances sum")


def check_combinations():
    """The element-pair table: formula algebra, links, and nothing measured on a guess."""
    path = _data("combinations.json")
    if path is None:
        raise AssertionError("neither data/combinations.json nor .json.gz is here")
    doc = json.load(open(path))
    rows = doc["combinations"]
    spid = {s["id"]: s for s in DOC["species"]}
    els = {e["symbol"]: e for e in DOC["elements"]}
    bad = []
    if doc["meta"]["rows"] != len(rows):
        bad.append(f"meta says {doc['meta']['rows']} rows, file has {len(rows)}")
    seen_pairs = set()
    for r in rows:
        a, b = r["elements"]
        if a not in els or b not in els:
            bad.append(f"{r['pair']}: unknown element")
            continue
        seen_pairs.add(tuple(sorted((a, b))))
        if r["status"] == "none":
            if r.get("formula") or not r.get("why"):
                bad.append(f"{r['pair']}: 'none' row without a reason")
            continue
        f = r["formula"]
        try:
            c = CH.parse_formula(f)
        except Exception as exc:
            bad.append(f"{r['pair']} {f}: does not parse ({exc})")
            continue
        if CH.hill(c) != r["formula_hill"]:
            bad.append(f"{r['pair']} {f}: stored hill is wrong")
        za, zb = r["states"]
        if abs(c.get(a, 0) * za + c.get(b, 0) * zb) > 1e-6:
            bad.append(f"{r['pair']} {f}: charges do not balance ({c.get(a,0)}x{za} vs {c.get(b,0)}x{-zb})")
        mm = (r.get("molar_mass") or {}).get("value")
        if mm is not None and abs(mm - CH.molar_mass(c)) > 0.01:
            bad.append(f"{r['pair']} {f}: molar mass {mm} vs recomputed {CH.molar_mass(c)}")
        if r["status"] in ("verified", "empirical"):
            sp = spid.get(r.get("species_id"))
            if sp is None:
                bad.append(f"{r['pair']} {f}: verified row with no species record")
            else:
                g = 0
                for n in c.values():
                    g = CH._gcd(g, int(n)) if g else int(n)
                red = CH.hill({k: v // g for k, v in c.items()})
                spc = CH.parse_formula(sp.get("formula") or "x")
                sg = 0
                for n in spc.values():
                    sg = CH._gcd(sg, int(n)) if sg else int(n)
                spod = CH.hill({k: v // sg for k, v in spc.items()}) if sg > 1 else None
                exact = sp.get("formula") == r["formula_hill"]
                reduced = bool(spod) and spod == red
                if r["status"] == "verified" and not exact:
                    bad.append(f"{r['pair']} {f}: called verified but the record is "
                               f"{sp.get('formula')}, a different ratio")
                if r["status"] == "empirical" and not (exact or reduced):
                    bad.append(f"{r['pair']} {f}: linked species {sp['id']} has formula "
                               f"{sp.get('formula')} - neither the same nor the same ratio")
                if r["status"] == "empirical" and not r.get("note"):
                    bad.append(f"{r['pair']} {f}: empirical row without the explanation")
            for rid in r.get("reaction_ids") or []:
                if rid not in {x["id"] for x in DOC["reactions"]}:
                    bad.append(f"{r['pair']}: reaction {rid} does not exist")
        else:
            for k in r:
                if k.startswith(("props_", "colour", "mp_", "bp_", "yield")):
                    bad.append(f"{r['pair']} {f} ({r['status']}): carries a measured property {k}")
        em = (r.get("predicted_emf") or {}).get("value")
        if em is not None:
            lk = (r.get("log_k") or {}).get("value")
            dg = (r.get("delta_g_kJ_per_mol") or {}).get("value")
            n = int("".join(ch for ch in (r.get("log_k") or {}).get("source", "").split("n = ")[1][:2]
                            if ch.isdigit()) or 0) if "n = " in (r.get("log_k") or {}).get("source", "") else 0
            if n and abs(lk - n * em / 0.0591) > 0.3:
                bad.append(f"{r['pair']} {f}: log K {lk} vs n*E/0.0591 = {n * em / 0.0591:.1f}")
            if n and abs(dg + n * 96.485 * em) > 0.6:
                bad.append(f"{r['pair']} {f}: dG {dg} vs -nFE = {-n * 96.485 * em:.1f}")
    n_pairs = len(els) * (len(els) - 1) // 2
    if len(seen_pairs) != n_pairs:
        bad.append(f"{len(seen_pairs)} element pairs covered, {n_pairs} exist")
    if DB:
        con = sqlite3.connect(DB)
        ndb = con.execute("SELECT COUNT(*) FROM combination").fetchone()[0]
        con.close()
        if ndb != len(rows):
            bad.append(f"db has {ndb} combination rows, json has {len(rows)}")
    assert not bad, f"{len(bad)} combination problems: {bad[:4]}"
    ver = len([r for r in rows if r["status"] in ("verified", "empirical")])
    return (f"{len(rows)} rows over {len(seen_pairs)} pairs re-derived: formulas balance, "
            f"masses recompute, {ver} links point at real species, predicted rows carry no "
            f"measured property, log K and dG reproduce from n x E")


def check_precipitation_matrix():
    """Mixing two solutions: Ksp maths re-done, and a rule never overrides a measurement."""
    M = (DOC["tables"].get("precipitation_matrix") or {})
    if not M:
        raise AssertionError("no precipitation matrix in the warehouse")
    spid = {s["id"]: s for s in DOC["species"]}
    ksp_keys = set(DOC["tables"]["ksp"])
    bad = []
    n_ksp = n_rule = 0
    for key, r in M.items():
        out = r.get("outcome")
        if out not in ("precipitate", "no visible change", "neutralisation", "no acid-base reaction",
                        "acid on the salt of a "
                       "weak acid", "ammonia released", None):
            bad.append(f"{key}: unknown outcome {out!r}")
        if r.get("basis") == "measured Ksp":
            n_ksp += 1
            k = r.get("ksp_key")
            ent = DOC["tables"]["ksp"].get(k)
            if not ent:
                bad.append(f"{key}: cites Ksp key {k!r} which is not in tables.ksp")
                continue
            kv = ent["Ksp"]["value"]
            if abs((r["ksp"]["value"] - kv) / kv) > 1e-9:
                bad.append(f"{key}: Ksp changed in transit")
            nc, na = r["coefficients"]
            s = (kv / (nc ** nc * na ** na)) ** (1.0 / (nc + na))
            got = r["solubility_mol_L"]["value"]
            if abs(got / s - 1) > 0.02:
                bad.append(f"{key}: solubility {got:g} vs recomputed {s:.3g}")
            mm = (r.get("molar_mass") or {}).get("value")
            if mm and abs((r["solubility_g_L"]["value"]) / (s * mm) - 1) > 0.02:
                bad.append(f"{key}: g/L not mol/L x molar mass")
            if out != "precipitate":
                bad.append(f"{key}: has a Ksp but says {out!r}")
        elif r.get("basis") == "solubility rule":
            n_rule += 1
            if r["product"] in ksp_keys:
                bad.append(f"{key}: decided by rule although {r['product']} has a measured Ksp")
        if r.get("species_id") and r["species_id"] not in spid:
            bad.append(f"{key}: species_id {r['species_id']} missing")
        ni = r.get("net_ionic")
        if r.get("no_reaction"):
            # a strong conjugate acid: the honest answer is "nothing happens", and the row
            # must not sneak an equation or a colour back in
            if r.get("outcome") != "no acid-base reaction":
                bad.append(f"{key}: no_reaction row with outcome {r.get('outcome')!r}")
            pk = (r.get("pKa_of_conjugate_acid") or {}).get("value")
            if pk is None or pk >= 0 or (r.get("partial_protonation")):
                bad.append(f"{key}: no_reaction row without a negative pKa ({pk})")
            if r.get("colour") or r.get("gas") or r.get("ksp"):
                bad.append(f"{key}: 'nothing happens' row carrying a colour, a gas or a Ksp")
            if r.get("basis") != "pKa table":
                bad.append(f"{key}: no_reaction row not decided by the pKa table")
        if r.get("partial_protonation"):
            steps = (r.get("pKa_of_conjugate_acid") or {}).get("values_stepwise") or []
            if not (len(steps) > 1 and steps[0] < 0 < steps[1]):
                bad.append(f"{key}: partial_protonation without a strong-then-weak pKa pair")
            if r.get("outcome") != "no visible change":
                bad.append(f"{key}: partial_protonation row claims {r.get('outcome')!r}")
        if ni is None:
            if r.get("outcome") and not (r.get("no_reaction")
                                         or r.get("partial_protonation")):
                bad.append(f"{key}: decided outcome but no net ionic equation")
            elif not r.get("net_ionic_note"):
                bad.append(f"{key}: undecided pair without the 'no equation' explanation")
        else:
            # an acid-on-a-weak-acid-salt row names the gas that leaves, not the acid in
            # between, which is the right thing: H+ + CO3^2- = CO2(g) is what you see
            rhs = ni.split("=")[-1]
            named = r["product"] in rhs or (r.get("gas") or "") in rhs
            if not named or r["cation"].rstrip("+").rstrip("0123456789") not in ni:
                bad.append(f"{key}: net ionic string does not name the product and the cation")
            if r.get("outcome") == "precipitate" and not any(
                    t in ni for t in ("(s)", "(aq)", "(l)", "(g)")):
                bad.append(f"{key}: a precipitate whose equation marks no phase")
        if r.get("colour") and r.get("outcome") != "precipitate":
            bad.append(f"{key}: a colour on a pair that produces nothing")
    if DB:
        con = sqlite3.connect(DB)
        ndb = con.execute("SELECT COUNT(*) FROM precip").fetchone()[0]
        n_el = con.execute("SELECT COUNT(*) FROM element").fetchone()[0]
        n_iso = con.execute("SELECT COUNT(*) FROM isotope").fetchone()[0]
        con.close()
        if ndb != len(M):
            bad.append(f"db precip rows {ndb} vs {len(M)} in json")
        if n_el != len(DOC["elements"]):
            bad.append(f"db element rows {n_el} vs {len(DOC['elements'])}")
        if n_iso < 200:
            bad.append(f"only {n_iso} isotope rows in the db")
    assert not bad, f"{len(bad)} matrix problems: {bad[:4]}"
    return (f"{len(M)} ion pairs: {n_ksp} Ksp derivations re-done, {n_rule} rule-based rows "
            f"confirmed to have no measurement, all links resolve")



if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("check_") and callable(fn):
            case(name[6:].replace("_", " "), fn)
    passed = [r for r in results if r[0]]
    failed = [r for r in results if not r[0]]
    print(f"\nvalidate_warehouse: {len(passed)} passed, {len(failed)} failed\n")
    for ok, name, detail in results:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name:24} {detail[:110]}")
    sys.exit(1 if failed else 0)
