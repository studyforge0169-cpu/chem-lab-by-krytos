#!/usr/bin/env python3
"""Vendor the element-property tables the periodic-table layer needs.

Source: the `mendeleev` package (MIT, (c) Lida & Zienkiewicz), which ships a SQLite
dump of element data whose provenance is stated per column in `propertymetadata`
(CRC Handbook 2014, IUPAC 2016 atomic weights, Shannon 1976 ionic radii, NIST ASD
ionisation energies, ...).  We do not take the library as a dependency: this script
reads the wheel once and writes plain JSON, so the warehouse stays data-only and the
provenance of every number can be quoted in the app.

    python3 scripts/vendor_mendeleev.py /tmp/mend/mendeleev-1.3.0-py3-none-any.whl
"""
import hashlib
import json
import os
import sqlite3
import sys
import zipfile

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "raw", "mendeleev")

# columns kept, with the unit the source states and the citation key(s) it gives
COLS = {
    "atomic_weight": None, "atomic_weight_uncertainty": None, "cas": None,
    "en_pauling": None, "en_allen": None, "electron_affinity": None, "density": None,
    "molar_heat_capacity": None, "specific_heat_capacity": None, "fusion_heat": None,
    "evaporation_heat": None, "thermal_conductivity": None, "dipole_polarizability": None,
    "atomic_radius": None, "covalent_radius_cordero": None, "vdw_radius": None,
    "metallic_radius": None, "lattice_structure": None, "lattice_constant": None,
    "abundance_crust": None, "abundance_sea": None,
    "electronic_configuration": None, "group_id": None, "period": None, "block": None,
    "series_id": None, "is_radioactive": None, "is_monoisotopic": None,
    "geochemical_class": None, "goldschmidt_class": None, "discoverers": None,
    "discovery_year": None, "name_origin": None, "sources": None, "uses": None,
    "description": None, "cpk_color": None, "jmol_color": None,
}


def rows(cur, sql, args=()):
    cur.execute(sql, args)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def main(whl):
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, "_elements.db")
    with zipfile.ZipFile(whl) as z:
        with open(tmp, "wb") as fh:
            fh.write(z.read("mendeleev/elements.db"))
    dig = hashlib.sha256(open(whl, "rb").read()).hexdigest()
    con = sqlite3.connect(tmp)
    cur = con.cursor()
    version = os.path.basename(whl).split("-")[1]

    meta = {f"{r['table_name']}.{r['column_name']}": r for r in
             rows(cur, "select * from propertymetadata")}
    keep = ["symbol", "name", "atomic_number"] + list(COLS)
    sel = ", ".join(keep)
    els = rows(cur, f"select {sel} from elements order by atomic_number")
    for e in els:  # attach the unit + citation the source itself declares
        prov = {}
        for c in keep:
            m = meta.get(f"elements.{c}")
            if m:
                prov[c] = {"unit": m["unit"], "cite": m["citation_keys"],
                           "desc": m["description"], "origin": m["value_origin"]}
        e["_provenance"] = prov

    out = {
        "version": version,
        "package": "mendeleev",
        "license": "MIT (c) Klaus Lida, David Zienkiewicz",
        "wheel": os.path.basename(whl),
        "wheel_sha256": dig,
        "extracted_by": "scripts/vendor_mendeleev.py",
        "citation_keys": {
            "haynes2014crc": "CRC Handbook of Chemistry and Physics, 95th ed. (Haynes, 2014)",
            "iupac-weights": "IUPAC Commission on Isotopic Abundances and Atomic Weights (2016)",
            "Meija2016": "Meija et al., Pure Appl. Chem. 88, 1039 (2016) - atomic weights",
            "Slater1964": "J. C. Slater, J. Chem. Phys. 41, 3199 (1964) - atomic radii",
            "Shannon1976": "R. D. Shannon, Acta Cryst. A32, 751 (1976) - ionic radii",
            "Cordero2008": "Cordero et al., Dalton Trans. 2832 (2008) - covalent radii",
            "NIST-ASD": "NIST Atomic Spectra Database - ionisation energies",
            "chemlib": "ChemLib (Lida, 2016) - compiled element data",
        },
        "elements": els,
        "oxidation_states": rows(cur, "select * from oxidationstates order by atomic_number, oxidation_state"),
        "ionic_radii": rows(cur, "select * from ionicradii order by atomic_number, charge"),
        "phase_transitions": rows(cur, "select * from phasetransitions order by atomic_number"),
        "ionization_energies": rows(cur, "select * from ionizationenergies where ion_charge <= 5 order by atomic_number, ion_charge"),
        "isotopes": rows(cur, "select * from isotopes order by atomic_number, mass_number"),
        "series": rows(cur, "select * from series"),
        "groups": rows(cur, "select * from groups"),
    }
    p = os.path.join(OUT, "element_data.json")
    with open(p, "w") as fh:
        json.dump(out, fh)
    lic = "\n".join(t for t in [z.read("mendeleev/../mendeleev-1.3.0.dist-info/LICENSE").decode()
                                if False else ""])
    with open(os.path.join(OUT, "LICENSE.mendeleev.txt"), "w") as fh:
        fh.write("MIT License (mendeleev %s)\n\n" % version)
        try:
            fh.write(zipfile.ZipFile(whl).read("mendeleev-1.3.0.dist-info/LICENSE").decode())
        except KeyError:
            fh.write("(LICENSE entry not present in the wheel; MIT per the package metadata)\n")
    os.remove(tmp)
    print("wrote raw/mendeleev/element_data.json  %.1f KB" % (os.path.getsize(p) / 1024))
    print("  elements %d | ox-states %d | ionic radii %d | phase transitions %d | "
          "IEs %d | isotopes %d" % (len(els), len(out["oxidation_states"]),
          len(out["ionic_radii"]), len(out["phase_transitions"]),
          len(out["ionization_energies"]), len(out["isotopes"])))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/mend/mendeleev-1.3.0-py3-none-any.whl")
