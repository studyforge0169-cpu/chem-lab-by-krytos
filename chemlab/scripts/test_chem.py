#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Regression tests for the chemistry kernel (scripts/lib/chem.py).

Run:  python3 scripts/test_chem.py       (no pytest needed)
These are the checks that make the warehouse trustworthy: if any of them fail,
every derived number in data/chemlab.json is suspect.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import chem as CH  # noqa: E402

PASS, FAIL = [], []


def check(name, got, want, tol=1e-6):
    ok = (abs(got - want) <= tol) if isinstance(want, float) else (got == want)
    (PASS if ok else FAIL).append((name, got, want))


def raises(name, fn):
    try:
        fn()
        FAIL.append((name, "no error", "ValueError"))
    except ValueError:
        PASS.append((name, "ValueError", "ValueError"))


# ------------------------------------------------------------------ formula parsing
check("parse H2O", CH.parse_formula("H2O"), {"H": 2, "O": 1})
check("parse Cu(OH)2", CH.parse_formula("Cu(OH)2"), {"Cu": 1, "O": 2, "H": 2})
check("parse K4[Fe(CN)6]", CH.parse_formula("K4[Fe(CN)6]"), {"K": 4, "Fe": 1, "C": 6, "N": 6})
check("parse CuSO4.5H2O", CH.parse_formula("CuSO4.5H2O"),
      {"Cu": 1, "S": 1, "O": 9, "H": 10})
check("parse Fe2(SO4)3", CH.parse_formula("Fe2(SO4)3"), {"Fe": 2, "S": 3, "O": 12})
check("parse Ca(OH)2.8H2O hydrate dot", CH.parse_formula("CaSO4.2H2O"),
      {"Ca": 1, "S": 1, "O": 6, "H": 4})
check("parse half water", CH.parse_formula("CaSO4.1/2H2O"), {"Ca": 1, "S": 1, "O": 4.5, "H": 1})
raises("refuses 'mix'", lambda: CH.parse_formula("mix"))
raises("refuses 'C5H12mix'", lambda: CH.parse_formula("C5H12mix"))

# ------------------------------------------------------------------------- Hill order
check("hill CCl4 has no H", CH.hill({"C": 1, "Cl": 4}), "CCl4")
check("hill CH4", CH.hill({"C": 1, "H": 4}), "CH4")
check("hill ethanol", CH.hill({"C": 2, "H": 6, "O": 1}), "C2H6O")
check("hill non-organic", CH.hill({"Na": 1, "Cl": 1}), "ClNa")
check("hill CS2", CH.hill({"C": 1, "S": 2}), "CS2")

# ------------------------------------------------------------------------ molar mass
for f, want in (("H2O", 18.015), ("NaCl", 58.44), ("CuSO4.5H2O", 249.677),
                ("KMnO4", 158.032), ("H2SO4", 98.072), ("K2Cr2O7", 294.181),
                ("BaSO4", 233.386), ("Na2S2O3.5H2O", 248.172),
                ("(NH4)2SO4", 132.14), ("Fe2(SO4)3", 399.858)):
    check(f"molar_mass {f}", CH.molar_mass(f), want, 0.01)
check("molar_mass Mohr's salt", CH.molar_mass("FeSO4.(NH4)2SO4.6H2O"), 392.125, 0.02)

# -------------------------------------------------------------------------- balancing
check("balance N2+H2", CH.balance("N2 + H2", "NH3"), ([1, 3], [2]))
check("balance Fe2O3+CO", CH.balance("Fe2O3 + CO", "Fe + CO2"), ([1, 3], [2, 3]))
check("balance KMnO4+HCl", CH.balance("KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O".split(" -> ")[0],
                                      "KCl + MnCl2 + Cl2 + H2O"), ([2, 16], [2, 2, 5, 8]))
check("balance Pb(NO3)2", CH.balance("Pb(NO3)2", "PbO + NO2 + O2"), ([2], [2, 4, 1]))
check("balance thiosulphate+iodine", CH.balance("Na2S2O3 + I2", "Na2S4O6 + NaI"), ([2, 1], [1, 2]))
check("balance Fe+steam", CH.balance("Fe + H2O", "Fe3O4 + H2"), ([3, 4], [1, 4]))
check("balance ionic permanganate/chloride",
      CH.balance("MnO4(1-) + Cl(1-) + H(1+)", "Mn(2+) + Cl2 + H2O"), ([2, 10, 16], [2, 5, 8]))
raises("ambiguous skeleton refused", lambda: CH.balance("H2 + O2", "H2O + H2O2"))
raises("trivial refused", lambda: CH.balance("H2", "H2"))
raises("identity with two species refused", lambda: CH.balance("Na(1+) + Cl(1-)", "Na(1+) + Cl(1-)"))
check("same species both sides is still fine for equilibrium",
      CH.balance("CH3COOH + H2O", "CH3COO(1-) + H3O(1+)"), ([1, 1], [1, 1]))

# ------------------------------------------------------------------- charge as a row
check("charge conserved", CH.check_equation("MnO4(1-) + 8 H(1+) + 5 Fe(2+) -> Mn(2+) + 5 Fe(3+) + 4 H2O")["ok"], True)
check("charge violation caught", CH.check_equation("Ag(1+) + Cl(1-) -> AgCl2(1-)")["ok"], False)
check("atom violation caught", CH.check_equation("H2 + O2 -> H2O")["ok"], False)

# ------------------------------------------------------------------ side parsing rules
check("parse_side keeps phases", CH.parse_side("2 NaOH(aq) + CuSO4(aq)"),
      [(2, "NaOH", "aq"), (1, "CuSO4", "aq")])
check("term with internal + splits correctly", CH.parse_side("H(1+) + OH(1-)"),
      [(1, "H(1+)", None), (1, "OH(1-)", None)])
check("strip_charge Cu(2+)", CH.strip_charge("Cu(2+)"), ("Cu", 2))
check("strip_charge SO4(2-)", CH.strip_charge("SO4(2-)"), ("SO4", -2))
check("strip_charge neutral", CH.strip_charge("NaCl"), ("NaCl", 0))
check("electron", CH.strip_charge("e-"), ("e", -1))

# --------------------------------------------------- oxidation states and valence
GC = {"SO4": -2, "NO3": -1, "OH": -1, "NH4": 1, "CO3": -2, "PO4": -3, "ClO4": -1,
      "MnO4": -1, "Cr2O7": -2, "CN": -1, "C2O4": -2, "SO3": -2, "ClO3": -1, "NO2": -1,
      "ClO": -1, "CrO4": -2, "HSO4": -1, "HCO3": -1}


def ox(formula):
    st, un, notes = CH.ox_states(formula, GC)
    return {k: (v[0] if len(v) == 1 else v) for k, v in st.items()}


for f, want in (("H2SO4", {"S": 6}), ("KMnO4", {"Mn": 7}), ("K2Cr2O7", {"Cr": 6}),
                ("NaCl", {"Na": 1, "Cl": -1}), ("Fe2O3", {"Fe": 3}), ("CuSO4", {"Cu": 2, "S": 6}),
                ("CaCO3", {"Ca": 2, "C": 4}), ("CH4", {"C": -4}), ("NH3", {"N": -3}),
                ("H2O2", {"O": -1}), ("Na2O2", {"O": -1}), ("KO2", {"O": -0.5}),
                ("CaH2", {"H": -1}), ("Mg3N2", {"N": -3}), ("FeCl3", {"Fe": 3}),
                ("HClO", {"Cl": 1}), ("HClO4", {"Cl": 7}), ("S2Cl2", {"S": 1}),
                ("SF6", {"S": 6}), ("OF2", {"O": 2}), ("Cl2", {"Cl": 0}),
                ("SO4^2-", {"S": 6}), ("MnO2", {"Mn": 4}), ("SiO2", {"Si": 4}),
                ("Al2(SO4)3", {"Al": 3, "S": 6}), ("KAl(SO4)2.12H2O", {"K": 1, "Al": 3, "S": 6}),
                ("FeSO4.7H2O", {"Fe": 2, "S": 6}), ("NaHSO4", {"S": 6}), ("CaC2", {"C": -1}),
                ("CrO2Cl2", {"Cr": 6}), ("N2O", {"N": 1}), ("NO", {"N": 2}),
                ("H2C2O4", {"C": 3}), ("C6H12O6", {"C": 0}), ("K2MnO4", {"Mn": 6})):
    got = ox(f)
    for k, v in want.items():
        check(f"ox_states {f} {k}", got.get(k), v)
check("brackets give both nitrogen environments", ox("(NH4)(NO3)")["N"], [-3, 5])
check("a flat formula gives the average, and says so", ox("NH4NO3")["N"], 1)
st, un, notes = CH.ox_states("Fe3O4", GC)
check("mixed valence is left unresolved, not invented", "Fe" in un, True)
st, un, notes = CH.ox_states("H2SO4", GC)
check("no bogus note for a plain acid", [n for n in notes if "superoxide" in n or "peroxide" in n], [])

for (a, za), (b, zb), want in ((("Fe", 3), ("O", 2), "Fe2O3"), (("Ca", 2), ("Cl", 1), "CaCl2"),
                               (("Na", 1), ("O", 2), "Na2O"), (("Al", 3), ("S", 2), "Al2S3"),
                               (("C", 4), ("O", 2), "CO2"), (("Mg", 2), ("N", 3), "Mg3N2"),
                               (("N", 5), ("O", 2), "N2O5"), (("Cu", 1), ("O", 2), "Cu2O"),
                               (("S", 6), ("O", 2), "SO3"), (("Mn", 7), ("O", 2), "Mn2O7")):
    f = CH.criss_cross((a, za), (b, zb))
    check(f"criss-cross {a}{za}+{b}{zb}", f, want)
    c = CH.parse_formula(f)
    check(f"  and {f} is charge-balanced", c[a] * za - c[b] * zb, 0)
check("0.5 is not a valid subscript, so it is refused", CH.criss_cross(("X", 0), ("O", 2)), None)
check("Pauling ionic character of NaCl", CH.pauling_ionicity(3.16 - 0.93), 71.2)
check("a nonpolar pair is nearly covalent", CH.pauling_ionicity(0.0), 0.0)


if __name__ == "__main__":
    print(f"{len(PASS)} passed, {len(FAIL)} failed")
    for name, got, want in FAIL:
        print(f"  FAIL {name}: got {got!r} want {want!r}")
    sys.exit(1 if FAIL else 0)
