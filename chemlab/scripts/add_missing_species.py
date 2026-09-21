#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Register every formula that the reaction files use but the inventory lacks.

Why this exists: the reaction curation grew after the species list was frozen, so the
builder reported equation terms with no matching bottle. A warehouse where a quarter of
the terms are unresolvable is not a warehouse. This script adds the missing rows - with
name, state and (where the reaction record itself says so) colour - and NO physical
numbers, because those were not curated for them: molar mass is computed by the kernel
from the formula, and everything else stays null with a reason.

Idempotent: run build_warehouse.py first, then this, then build again. Re-running adds
nothing, because the tokens are resolved by then.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, os.path.join(ROOT, "data_curated"))
import chem as CH          # noqa: E402
import naming as NAM       # noqa: E402
import species as SP       # noqa: E402

SPECIES_PY = os.path.join(ROOT, "data_curated", "species.py")
BACKUP = SPECIES_PY + ".bak"

# Names that the reaction record itself supplies (read from the curated text, not guessed
# from the formula - several of these formulas are ambiguous on their own).
FROM_CONTEXT = {
    "C3H4O2": ("Pyruvic aldehyde (methylglyoxal)", None,
               "the 'volatile oil' of tartaric-acid pyrolysis; named by the reaction record dec_tartrate"),
    "C2H5N3O2": ("Biuret", "white", "two ureas minus ammonia; named by dec_urea"),
    "C6H10": ("Cyclohexene", "colourless", "named by org_bromine_water / org_baeyer"),
    "C6H10Br2": ("trans-1,2-Dibromocyclohexane", "colourless", "addition of bromine across the double bond"),
    "C6H12O2": ("cis-1,2-Cyclohexanediol", "white", "the diol Baeyer's test produces"),
    "MnO(OH)2": ("Hydrated manganese(IV) oxide", "brown",
                 "written this way to keep the Mn(OH)2 -> MnO2 oxidation bookkeeping honest"),
    "CuSiO3": ("Copper(II) silicate", "blue-green", "the membrane in the chemical-garden demo"),
    "KFeFe(CN)6": ("Prussian blue, KFe[Fe(CN)6]", "blue",
                   "mixed-valence iron(II/III) hexacyanoferrate; the Fe3+ confirmatory precipitate"),
    "KClI2": ("Potassium triiodide", "dark", "KI complexing I2 - the same chemistry as Lugol's iodine"),
    "(C17H35COO)2Ca": ("Calcium stearate (soap scum)", "white",
                        "why soap fails in hard water - the record names it"),
    "C6H2Br3NH2": ("2,4,6-Tribromoaniline", "white", "the white precipitate of aniline + bromine water"),
    "C2H4Br2": ("1,2-Dibromoethane", "colourless", "ethylene + bromine"),
    "Fe(OC6H5)3": ("Iron(III) phenoxide", "violet", "the FeCl3 test on phenol"),
    "Na2Zn(OH)4": ("Sodium zincate", None, "zinc dissolving in excess alkali"),
    "KAl(OH)4": ("Potassium aluminate", None, "aluminium dissolving in excess alkali"),
    "CaSO4.2H2O": ("Gypsum", "white", "the mineral; the dihydrate that sets"),
    "CaSO4.1/2H2O": ("Plaster of Paris", "white", "the hemihydrate that sets with water"),
    "CuSO4.5H2O": ("Copper(II) sulphate pentahydrate", "blue", "blue vitriol"),
    "H2S2O7": ("Pyrosulphuric (oleum) acid", "colourless", "SO3 dissolved in concentrated H2SO4"),
    "H2SiF6": ("Hexafluorosilicic acid", "colourless", "what HF actually makes when it eats glass"),
    "HAuCl4": ("Chloroauric acid", None, "gold dissolved in aqua regia"),
    "Ag2C2": ("Silver acetylide", "white", "explosive when dry - a demonstration, never a preparation"),
    "V2O4": ("Vanadium(IV) oxide", "blue-black", "the reduced form of the contact-process catalyst"),
    "CaC2O4": ("Calcium oxalate", "white", "the group-VI calcium confirmatory precipitate"),
    "MgNH4PO4": ("Magnesium ammonium phosphate", "white", "the crystalline white ppt that confirms Mg2+"),
    "Na2S4O6": ("Sodium tetrathionate", None, "the product of iodine on thiosulphate"),
    "K2MnO4": ("Potassium manganate", "dark-green", "the green intermediate in alkali + permanganate"),
    "Cr2(SO4)3": ("Chromium(III) sulphate", "violet-green", None),
    "KIO3": ("Potassium iodate", "white", "the iodine-clock oxidiser"),
    "KHSO4": ("Potassium hydrogen sulphate", "white", "acid sulphate - the bisulphate of the lab bottle"),
    "NaHSO4": ("Sodium hydrogen sulphate", "white", None),
    "Li3N": ("Lithium nitride", "red-brown", "the only alkali metal that burns in nitrogen"),
    "Mg3N2": ("Magnesium nitride", "yellow-green", "what the magnesium in air becomes, and it gives off NH3 with water"),
    "Hg2(NO3)2": ("Mercury(I) nitrate", "white", "the Hg2(2+) dimer - note it is not Hg(2+)"),
    "P4": ("Tetraphosphorus (white phosphorus)", "waxy-white",
           "reference only - see the refusal list; never a preparation, never stored"),
    "P4O10": ("Phosphorus(V) oxide", "white", "the powerful drying agent formed when phosphorus burns"),
    "N2O4": ("Dinitrogen tetroxide", "colourless", "in equilibrium with brown NO2 - the classic dimerisation demo"),
    "NH2Cl": ("Chloramine", None, "what bleach and ammonia make together, which is why that mix is refused"),
    "BaSO3": ("Barium sulphite", "white", "dissolves in acid, unlike BaSO4 - the discriminator"),
    "Ag2CO3": ("Silver carbonate", "yellow", None),
    "CuI": ("Copper(I) iodide", "white", "the off-white precipitate left when iodide reduces Cu(II)"),
    "CHI3": ("Iodoform (triiodomethane)", "pale-yellow", "the antiseptic-smelling flakes of the haloform reaction"),
    "BaO": ("Barium oxide", "grey-white", None),
    "Al2O3": ("Aluminium oxide (alumina)", "white", "amphoteric; the catalyst support and the abrasive"),
    "MgCO3": ("Magnesium carbonate", "white", None),
    "LiOH": ("Lithium hydroxide", "white", None),
    "NaI": ("Sodium iodide", "white", None),
    "CO": ("Carbon monoxide", "colourless",
           "odorless and silently lethal - see the refusal list for why it is not generated at home"),
    "C2H2": ("Ethyne (acetylene)", "colourless", None),
    "C2H6": ("Ethane", "colourless", None),
    "Au": ("Gold", "yellow", None),
    "Si": ("Silicon", "grey", None),
    "HClO": ("Hypochlorous acid", "pale-yellow", "the actual bleaching agent in chloric(I) acid solution"),
    "K2SO4": ("Potassium sulphate", "white", None),
    "V2O5": ("Vanadium(V) oxide", "orange-yellow", "the contact-process catalyst, and the oxide that V2O4 reduces to"),
    "Na2SiO3": ("Sodium silicate (water glass)", "colourless", None),
}


def slug(formula):
    s = re.sub(r"[^A-Za-z0-9]", "", formula.lower())
    return ("z" + s) if s[:1].isdigit() else s


def main():
    log = json.load(open(os.path.join(ROOT, "data", "build_log.json")))
    unresolved = [t for t in log["unresolved_tokens"]]
    have = {r[0] for r in SP.SPECIES}
    have_h = {}
    for sid, _n, f, *_rest in SP.SPECIES:
        try:
            have_h.setdefault(CH.hill(CH.parse_formula(f)), []).append(sid)
        except Exception:                                       # noqa: BLE001
            pass
    rows = []
    for tok in unresolved:
        bare = re.sub(r"\((s|l|g|aq)\)$", "", tok).strip()
        ms = re.search(r"\(([A-Z][A-Za-z0-9.]*)\)$", bare)
        if ms:
            try:
                CH.parse_formula(ms.group(1))
                bare = bare[: ms.start()].strip()
            except Exception:                                   # noqa: BLE001
                pass
        try:
            CH.parse_formula(bare)
        except Exception as exc:                                # noqa: BLE001
            print(f"  skip {tok!r}: formula will not parse ({exc})")
            continue
        try:
            h = CH.hill(CH.parse_formula(bare))
        except Exception:                                       # noqa: BLE001
            continue
        if have_h.get(h):
            continue
        name, colour, note = FROM_CONTEXT.get(bare, (None, None, None))
        if not name:
            try:
                name = NAM.name_from_formula(bare)
            except Exception:                                   # noqa: BLE001
                name = None
        state = None   # never inferred from a formula - left null with a reason
        if name is None:
            name = bare
            note = "formula alone is ambiguous; the app shows the formula as written"
        sid = slug(bare)
        i = 2
        while sid in have or any(r[0] == sid for r in rows):
            sid = slug(bare) + str(i)
            i += 1
        props = {"note": note or ("registered so this equation term resolves; no physical "
                                 "properties curated for it - the app must show that, not a "
                                 "guessed density"),
                 "alias": [name] if name != bare else []}
        if bare == "P4":
            props["danger"] = 5
            props["safety"] = "reference-only"
        if colour:
            props["colour_note"] = "appearance taken from the reaction record that uses it"
        rows.append((sid, name, bare, state, colour, props))
        have.add(sid)
        have_h.setdefault(h, []).append(sid)
    if not rows:
        print("[add_missing_species] nothing to add - every equation term already resolves")
        return
    if not os.path.exists(BACKUP):
        open(BACKUP, "w").write(open(SPECIES_PY).read())
    src = open(SPECIES_PY).read()
    tail = ",\n    ".join("(%r, %r, %r, %r, %r, %r)" % (sid, nm, f, st, col, pr)
                            for sid, nm, f, st, col, pr in rows)
    block = ("\n# ---------------- registered by scripts/add_missing_species.py so that every\n"
             "# equation term in data_curated/reactions*.py resolves to a record. State and\n"
             "# colour are only filled where the reaction curation itself states them.\n"
             "SPECIES += [\n    " + tail.replace("\n", "\n    ") + ",\n]\n")
    if "registered by scripts/add_missing_species.py" in src:
        src = src[:src.index("\n# ---------------- registered by scripts/add_missing_species.py")]
    open(SPECIES_PY, "w").write(src + block)
    print(f"[add_missing_species] appended {len(rows)} species rows to data_curated/species.py")
    for sid, nm, f, st, col, pr in rows[:70]:
        print(f"   + {sid:22} {f:18} {nm}")


if __name__ == "__main__":
    main()
