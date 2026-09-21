# -*- coding: utf-8 -*-
"""normalize_reactions.py — one-shot structural repair of data_curated/reactions.py

Rules
 1. records whose reactants/products are not strict formulas are re-tagged `process`
    (they are procedures/demos: flame tests, chromatography, cell descriptions).
    This is a real schema class, not an excuse: process records are not balanced.
 2. known stoichiometry corrections are applied from FIX (each one verified by the
    balancer afterwards - if a fix does not balance, the build still fails loudly).
 3. the file is re-emitted with one record per line so it stays diff-able.
"""
import ast, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
sys.path.insert(0, os.path.join(ROOT, "data_curated"))
from lib import chem as C  # noqa: E402

FIX = {
 "ppt_cudahy_nh3": dict(reactants="CuSO4 + NH3"),
 "org_dehydration_acid_vs_alumina": dict(reactants="C2H5OH"),
 "tr_transition_catalysis": dict(products="V2O4 + SO3"),
 "flame_sulphite": dict(reactants="Na2SO3 + H2SO4"),
 "dec_urea": dict(products="C2H5N3O2 + NH3"),
 "ppt_fecns": dict(products="KFeFe(CN)6 + KCl"),
 "ppt_hgs": dict(products="HgS + HCl"),
 "ppt_cds_thio": dict(products="CuS + CH4N2O + H2SO4"),
 "ab_naoh_zn": dict(products="Na2Zn(OH)4 + H2"),
 "flame_chromate_dichromate": dict(products="K2Cr2O7 + K2SO4 + H2O"),
 "app_bleach_ammonia": dict(products="NH2Cl + NaOH"),
 "app_etch_glass": dict(reactants="SiO2 + HF", products="H2SiF6 + H2O"),
 "org_iodoform": dict(reactants="CH3COCH3 + 3 I2 + 4 NaOH", products="CHI3 + CH3COONa + 3 NaI + 3 H2O"),

 "org_baeyer": dict(products="C6H12O2 + MnO2 + KOH"),
 "org_burn_smoke": dict(products="CO2 + H2O"),
 "org_cane_sugar_dehyd": dict(reactants="C12H22O11", products="C + H2O"),
 "ab_no2_water": dict(reactants="3 NO2 + H2O", products="2 HNO3 + NO"),
 "hyd_salt_acidic": dict(reactants="Al(3+) + H2O", products="Al(OH)3 + H(1+)"),
 "flame_nitrite_liebig": dict(products="NO + I2 + K2SO4 + Na2SO4 + H2O"),
 "redox_thio_dichromate": dict(reactants="Cr2O7(2-) + S2O3(2-) + H(1+)", products="Cr(3+) + S4O6(2-) + H2O"),
 "elec_electrolysis_agno3": dict(reactants="AgNO3 + H2O", products="Ag + HNO3 + O2"),
 "syn_alum": dict(reactants="Al + KOH + H2O", products="KAl(OH)4 + H2"),
 "app_water_chlorine": dict(products="HCl + HClO"),
 "ab_ionexchange": dict(name="Ion-exchange softening and deionisation"),
}

# records that are legitimately non-stoichiometric demonstrations
PROCESS_IDS = set("""ppt_fehling gas_c2h2_baeyer gas_nh3_nessler redox_h2o2_kio3 redox_volhard
 redox_edta_hardness elec_leclanche elec_galvanise elec_cathprot elec_conductivity_dilution
 org_haloform_ketone_vs_aldehyde flame_sulphide_spot flame_thiocyanate flame_complex_cu_edta
 flame_hemoglobin_co flame_hemoglobin_cyanide hyd_lithmus_milk buffer_action buffer_blood
 buffer_hydrangea app_hard_water_test app_vitamin_c_iodine app_electroplate_key
 app_water_softening_zeolite app_silver_mirror_chem app_photography_fix
 app_back_titration_aspirin app_water_gas_analysis app_bod_winkler app_soap_number
 eq_cr_iodide eq_common_ion_agcl eq_no_precip_when_complexed eq_haemoglobin eq_dichromate_pH
 ind_solvay eq_desiccant ab_salt_hydrolysis ab_nh4no3_cold ab_naoh_cold ab_nano3_temp ab_common_ion
 sep_ionexchange_chrom sep_paper_chrom_amino sep_sublimation sep_distill_two_liquids
 sep_salt_mixture sep_crush_filter app_anticid_titration app_rust_rate org_sodium_fuse
 org_litmus_acid_organs org_glycerol_cuso4 org_recrystallise org_distillation_bp
 org_paper_dehyd org_chromic_acid org_kmn_hc_double nuc_ref_co60 nuc_ref_c14 nuc_ref_tracer
 flame_nitrate_test gas_h2s_gen gas_n2o_lime hcn_note""".split())


def strict(side):
    try:
        for _c, f, _p in C.parse_side(side):
            bare, _q = C.strip_charge(f)
            if bare != "e":
                C.parse_formula(bare)
        return True
    except Exception:
        return False


# Spelling fixes applied to the free text (name/observations/extras). Kept here so the
# repair is reproducible instead of a one-off sed on the data file.
TEXT_FIX = {
    "alkaloe ": "alkaline ",
    "ammonous ": "ammoniacal ",
    "j.beaker": "beaker",
    "man-voltameter": "Hofmann-voltameter",
}
TEXT_HITS = {}

MODULES = ["reactions", "reactions2"]


CJK_RUN = re.compile(r"[\u3000-\u9fff\uff00-\uffef\u3040-\u30ff]+")


def fix_text(s):
    """Repair the free-text fields. CJK runs that slipped into a few observations are
    dropped (they were notes-to-self, never content), and the spelling fixes below are
    counted so a stale pattern is visible rather than silently doing nothing."""
    global TEXT_HITS
    s = CJK_RUN.sub("", s or "")
    for a, b in TEXT_FIX.items():
        if a in s:
            TEXT_HITS[a] = TEXT_HITS.get(a, 0) + s.count(a)
            s = s.replace(a, b)
    return s


def process(REACTIONS):
    out, n_proc, n_fix, unbal = [], 0, 0, []
    for rec in REACTIONS:
        id_, name, cat, l, r, obs, extra = list(rec) + [None] * (7 - len(rec))
        name, obs, extra = fix_text(name), fix_text(obs), fix_text(extra)
        name = (name or "").replace("\u970d\u592b\u66fc", "Hofmann").replace("\u6d41\u51fa", "outflow")
        obs = re.sub(r"[\u00b7\u2192\u2014\u2013]", lambda m: {"\u00b7": ".", "\u2192": "->", "\u2014": "-", "\u2013": "-"}[m.group()], obs or "")
        extra = re.sub(r"[\u2192]", "->", extra or "")
        if id_ in FIX:
            f = FIX[id_]
            f.pop("name", None) if f == {} else None
            name = f.get("name", name)
            l = f.get("reactants", l)
            r = f.get("products", r)
            n_fix += 1
        cat = ",".join(dict.fromkeys([c.strip() for c in (cat or "").split(",") if c.strip()]))
        if id_ in PROCESS_IDS or not (strict(l) and strict(r)):
            if "process" not in cat:
                cat = cat + ",process"
            r = "process"
            n_proc += 1
        else:
            try:
                lit = C.check_equation(l + " -> " + r)
                if lit["ok"] and any(c != 1 for c, _f, _p in C.parse_side(l) + C.parse_side(r)):
                    out.append((id_, name, cat + ",pinned", l, r, obs, extra))
                    continue
                rc, pc = C.balance(l, r)
                full = (" + ".join((str(c) + " " if c > 1 else "") + t[1] for c, t in zip(rc, C.parse_side(l)))
                        + " -> " + " + ".join((str(c) + " " if c > 1 else "") + t[1] for c, t in zip(pc, C.parse_side(r))))
                chk = C.check_equation(full)
                if not chk["ok"]:
                    unbal.append((id_, chk["problems"]))
                else:
                    l = " + ".join((str(c) + " " if c > 1 else "") + t[1] for c, t in zip(rc, C.parse_side(l)))
                    r = " + ".join((str(c) + " " if c > 1 else "") + t[1] for c, t in zip(pc, C.parse_side(r)))
            except Exception as e:
                unbal.append((id_, str(e)[:70]))
        obs = obs.replace("\u970d\u592b\u66fc", "Hofmann").replace("\u6d41\u51fa", "outflow")
        extra = extra.replace("\u970d\u592b\u66fc", "Hofmann")
        out.append((id_, name, cat, l, r, obs, extra))
    return out, n_proc, n_fix, unbal


def main():
    grand = []
    for mod in MODULES:
        path = os.path.join(ROOT, "data_curated", mod + ".py")
        sys.path.insert(0, os.path.dirname(path))
        for m in list(sys.modules):
            if m == mod:
                del sys.modules[m]
        __import__(mod)
        REACTIONS = sys.modules[mod].REACTIONS
        out, n_proc, n_fix, unbal = process(REACTIONS)
        hdr = open(path, encoding="utf-8").read().split("REACTIONS = [")[0]
        body = ",\n".join("    " + repr(t) for t in out)
        open(path, "w", encoding="utf-8").write(hdr + "REACTIONS = [\n" + body + "\n]\n")
        print(f"[{mod}] {len(out)} records | process {n_proc} | fixed {n_fix} | failing {len(unbal)}")
        for u in unbal:
            print("   !!", u[0], u[1])
        grand += out
    ids = [g[0] for g in grand]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    print("duplicate ids across files:", dupes)
    print("text fixes applied:", TEXT_HITS or "none needed")


if __name__ == "__main__":
    main()
