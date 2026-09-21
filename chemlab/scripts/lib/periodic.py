"""The periodic layer: every element, its properties, its shelf record, and what
happens when two elements are put together.

Everything here is either copied from a cited table or computed by the kernel.  Two
conventions matter and both are stated in the output rather than assumed:

* temperatures - the element sources give kelvin, the warehouse stores degC, so every
  converted number keeps `kelvin` alongside it;
* `basis` - `measured` means the source reports it for this substance, `rule` means a
  documented rule of arithmetic or of the textbook produced it, and `predicted` means
  a formula the rules allow but nobody has measured.  The app must show the label.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:                                        # the builder imports chem as a top-level module
    from lib import chem  # noqa: E402
except ImportError:                         # pragma: no cover
    import chem  # noqa: E402

KELVIN = 273.15
# the molecular form of the standard state, for the handful of elements that are not
# written as single atoms in an equation
MOLECULAR = {"H": "H2", "N": "N2", "O": "O2", "F": "F2", "Cl": "Cl2", "Br": "Br2", "I": "I2",
             "S": "S8", "P": "P4"}
# conventional formula used when writing an equation: the allotrope name goes with it
EQUATION_FORM = {"S8": ("S", "sulfur is written S in equations"),
                 "P4": ("P", "phosphorus is written P in equations")}
NOBLE = {"He", "Ne", "Ar", "Kr", "Xe", "Rn", "Og"}
# elements that behave as anions somewhere in the tables: used only to word a refusal
# a hydride of these is written with the central atom first: NH3, CH4, PH3, SiH4, not H3N
H_CENTRE_FIRST = {"B", "C", "N", "P", "As", "Sb", "Si", "Se"}


def display_formula(a, b, za, zb):
    """The criss-cross formula, in the order a chemist would write it."""
    f = chem.criss_cross((a, za), (b, zb))
    if f and a == "H" and b in H_CENTRE_FIRST:
        alt = chem.criss_cross((b, zb), (a, za))
        if alt:
            return alt
    return f


NONMETAL_SIDE = set(MOLECULAR) | {"B", "Si", "Ge", "As", "Sb", "Te", "Se", "Po", "At", "H"}
# elements nobody has in a bottle: no half-life long enough to matter, or none isolated
NOT_A_REAGENT = {"Tc", "Pm", "At", "Fr", "Ra"} | {  # (Tc/Pm/At have no stable isotope)
    "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr", "Rf", "Db", "Sg",
    "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og", "Ac", "Pa"}
DIATOMIC_GAS = {"H", "N", "O", "F", "Cl"}


def _cite(meta, fallback="as cited in the vendored element table"):
    """Turn the source's own citation keys into a short human string."""
    keys = (meta or {}).get("cite") or ""
    named = {
        "haynes2014crc": "CRC Handbook 95th ed. (Haynes 2014)",
        "iupac-weights": "IUPAC CIAAW atomic weights",
        "Meija2016": "Meija et al., Pure Appl. Chem. 88 (2016)",
        "Slater1964": "Slater, J. Chem. Phys. 41 (1964)",
        "Cordero2008": "Cordero et al., Dalton Trans. (2008)",
        "Shannon1976": "Shannon, Acta Cryst. A32 (1976)",
        "NIST-ASD": "NIST Atomic Spectra Database",
        "Andersen2004": "Andersen, Mol. Phys. 102 (2004)",
        "Mann2000a": "Mann et al., J. Chem. Educ. 77 (2000)",
        "kyleandlaby": "Kyle & Laby (project)",
        "Wikipedia": "Wikipedia infobox (via the vendored table)",
    }
    out = []
    for k in [x.strip() for x in str(keys).split(",") if x.strip()]:
        out.append(named.get(k, k))
    return "; ".join(out) if out else fallback


def load_source(root):
    p = os.path.join(root, "raw", "mendeleev", "element_data.json")
    if not os.path.exists(p):
        return None
    d = json.load(open(p))
    p2 = os.path.join(root, "raw", "elements_source.json")
    bow = {}
    if os.path.exists(p2):
        for e in json.load(open(p2))["elements"]:
            bow[e["symbol"]] = e
    return {"mend": d, "bow": bow, "version": d.get("version", "?")}


def _by_z(mend, table):
    out = {}
    for r in mend[table]:
        out.setdefault(r["atomic_number"], []).append(r)
    return out


def build_elements(warn, species_rows, src):
    """One rich record per element: 118 of them, each field with its own provenance.

    `species_rows` is needed for the cross-links, which is why this runs after the
    species layer rather than before it.
    """
    if not src:
        warn.append("raw/mendeleev/element_data.json missing - periodic layer skipped")
        return []
    mend, bow, ver = src["mend"], src["bow"], src["version"]
    MSRC = "mendeleev %s (MIT), data as cited below" % ver
    ox = _by_z(mend, "oxidation_states")
    ir = _by_z(mend, "ionic_radii")
    pt = _by_z(mend, "phase_transitions")
    iso = _by_z(mend, "isotopes")
    series = {r["id"]: r["name"] for r in mend["series"]}
    prov = {e["symbol"]: e.get("_provenance", {}) for e in mend["elements"]}

    rows = []
    for e in mend["elements"]:
        Z, sym = e["atomic_number"], e["symbol"]
        p = prov.get(sym, {})
        b = bow.get(sym, {})

        def N(key, units=None, conf="high", extra=None):
            v = e.get(key)
            u = units or (p.get(key, {}) or {}).get("unit") or ""
            d = {"value": v, "units": u, "source": _cite(p.get(key)) + " via " + MSRC,
                 "ref_id": None, "confidence": conf}
            if v is None:
                d["missing"] = "not reported for this element by the cited sources"
            if extra:
                d.update(extra)
            return d

        rec = {
            "number": Z, "symbol": sym, "name": e["name"],
            "established": True,
            "atomic_mass": N("atomic_weight", "u"),
            "mass_uncertainty": ({"value": e.get("atomic_weight_uncertainty"), "units": "u",
                                 "source": _cite(p.get("atomic_weight_uncertainty")) + " via " + MSRC,
                                 "ref_id": None, "confidence": "high"}
                                if e.get("atomic_weight_uncertainty") else None),
            "monoisotopic": bool(e.get("is_monoisotopic")),
            "radioactive": bool(e.get("is_radioactive")),
            "category": series.get(e.get("series_id"), b.get("category")),
            "phase_at_298K": b.get("phase"),
            "group": e.get("group_id"), "period": e.get("period"), "block": e.get("block"),
            "electron_configuration": (e.get("electronic_configuration") or b.get("electron_configuration")),
            "shells": b.get("shells"),
            "electronegativity_pauling": N("en_pauling", "Pauling scale"),
            "electronegativity_allen": N("en_allen", "eV"),
            "electron_affinity": N("electron_affinity", "eV"),
            "ionisation_kJ_mol": (b.get("ionization_energies") or [])[:6] or None,
            "atomic_radius_pm": N("atomic_radius"),
            "covalent_radius_pm": N("covalent_radius_cordero"),
            "metallic_radius_pm": N("metallic_radius"),
            "vdw_radius_pm": N("vdw_radius"),
            "polarisability_bohr3": N("dipole_polarizability"),
            "density": N("density"),
            "heat_capacity_molar": N("molar_heat_capacity", "J/mol/K"),
            "heat_capacity_specific": N("specific_heat_capacity"),
            "thermal_conductivity": N("thermal_conductivity"),
            "lattice_structure": e.get("lattice_structure"),
            "lattice_constant": N("lattice_constant"),
            "abundance_crust_ppm": N("abundance_crust", "ppm"),
            "abundance_sea_mg_L": N("abundance_sea", "mg/L"),
            "cas": e.get("cas"),
            "appearance": b.get("appearance"),
            "summary": b.get("summary"),
            "name_origin": e.get("name_origin"),
            "occurrence": e.get("sources"),
            "uses": e.get("uses"),
            "discovered_by": (e.get("discoverers") or b.get("discovered_by")),
            "discovery_year": e.get("discovery_year"),
            "colour_hex": ("#" + b["cpk-hex"]) if b.get("cpk-hex") else e.get("cpk_color"),
            "kelvin_note": ("temperatures below are degC; the sources quote kelvin, and "
                            "the kelvin value is kept next to each conversion"),
        }
        am = rec["atomic_mass"].get("value")
        kern = chem.ATOMIC_WEIGHT.get(sym)
        if am is not None and kern is not None and abs(am - kern) > 0.02:
            # e.g. technetium: CIAAW has no standard atomic weight for it and gives [98],
            # while 97.90721 u is the mass of Tc-98 itself.  Stoichiometry must use the
            # bracketed number the rest of the warehouse uses, so the isotope mass is kept
            # beside it rather than quietly replacing it.
            rec["atomic_mass"]["isotopic_mass_u"] = am
            rec["atomic_mass"]["value"] = kern
            rec["atomic_mass"]["note"] = (
                "no stable isotope, so CIAAW quotes a bracketed mass number rather than a "
                "standard atomic weight; the molar mass of this element uses that whole number "
                f"({kern}) and the isotopic mass of the longest-lived nuclide ({am} u) is kept "
                "here so the difference is visible instead of being a rounding mystery")
            rec["atomic_mass"]["confidence"] = "approx"
        # --- phase transitions: convert K -> degC and keep both
        tr = (pt.get(Z) or [{}])[0]
        for key, src_key in (("mel_point", "melting_point"), ("boil_point", "boiling_point"),
                             ("critical_temp", "critical_temperature"),
                             ("triple_point", "triple_point_temperature")):
            kvals = [x.get(src_key) for x in (pt.get(Z) or []) if x.get(src_key)]
            bkey = {"mel_point": "melt", "boil_point": "boil"}.get(key)
            kv = kvals[0] if kvals else b.get(bkey) if bkey else None
            units = "K" if key in ("critical_temp", "triple_point") else "degC"
            val = kv if key in ("critical_temp", "triple_point") else (
                round(kv - KELVIN, 2) if isinstance(kv, (int, float)) else None)
            rec[key] = {"value": val, "units": units,
                        "source": ("phase-transition table, " + MSRC) if kvals else
                                  ("Periodic-Table-JSON (Bowserinator), CC BY-SA 3.0"),
                        "ref_id": None, "confidence": "high" if kvals else "med",
                        "kelvin": kv}
            if kv is None:
                rec[key]["missing"] = ("no measured value: the element has not been made in "
                                       "bulk, or the source gives none")
        if rec["mel_point"]["kelvin"] is not None and rec["mel_point"]["kelvin"] < 2000:
            pass
        # sublimation is recorded so the app does not call iodine's 'boil point' a melt
        rec["is_sublimation"] = bool((pt.get(Z) or [{}])[0].get("is_sublimation_point"))
        mb = rec["mel_point"].get("value")
        bb = rec["boil_point"].get("value")
        if mb is not None and bb is not None and bb < mb:
            # arsenic is the classic case: it sublimes at 1 atm, so the 'boiling point'
            # the tables give is below a melting point that only exists under pressure
            rec["boil_below_melt_note"] = (
                "the listed boiling point is below the melting point because this element "
                "sublimes at 1 atm; the melt applies only under pressure")
        rec["fusion_heat_kJ_mol"] = N("fusion_heat", "kJ/mol")
        rec["vaporisation_heat_kJ_mol"] = N("evaporation_heat", "kJ/mol")
        # --- oxidation states: the source splits 'main' from 'extended'
        states = ox.get(Z, [])
        rec["oxidation_states_main"] = sorted({r["oxidation_state"] for r in states
                                               if r["category"] == "main" and r["oxidation_state"]})
        rec["oxidation_states_extended"] = sorted({r["oxidation_state"] for r in states
                                                   if r["category"] != "main"})
        rec["oxidation_states_provenance"] = ("oxidation-state table, " + MSRC +
                                              "; 'main' are the states the source lists as common")
        # --- ionic radii (Shannon), kept per coordination so the app can pick VI
        rec["ionic_radii"] = [{
            "charge": r["charge"], "coordination": r["coordination"], "spin": r["spin"] or None,
            "radius_pm": r["ionic_radius"], "crystal_radius_pm": r["crystal_radius"],
            "source": "Shannon 1976 via " + MSRC, "confidence": "high",
        } for r in sorted(ir.get(Z, []), key=lambda x: (x["charge"], x["coordination"]))] or None
        # --- isotopes: the natural ones in full, plus the longest-lived for radionuclides
        isl = iso.get(Z, [])
        nat = [r for r in isl if r.get("abundance") is not None]
        pick = sorted(isl, key=lambda r: -(r.get("abundance") or 0))[:1]
        longlived = None
        if not nat and isl:
            def hl(r):
                u = {"ms": 1e-3, "us": 1e-6, "ns": 1e-9, "min": 60, "h": 3600, "d": 86400,
                     "y": 3.156e7, "s": 1}.get(r.get("half_life_unit"), 3.156e7)
                return (r.get("half_life") or 0) * u
            longlived = sorted(isl, key=hl)[-1]
        rec["isotopes_natural"] = [{
            "mass_number": r["mass_number"], "mass_u": r["mass"],
            "abundance_percent": r["abundance"], "spin": r["spin"],
            "abundance_uncertainty": r.get("abundance_uncertainty"),
            "source": "IUPAC/CIAAW via " + MSRC, "confidence": "high"} for r in nat] or None
        rec["isotopes_stable_count"] = len(nat)
        if longlived:
            rec["longest_lived_isotope"] = {
                "mass_number": longlived["mass_number"], "mass_u": longlived["mass"],
                "half_life": longlived["half_life"], "half_life_units": longlived["half_life_unit"],
                "radioactive": bool(longlived["is_radioactive"]),
                "note": "no stable isotope exists; this is the longest-lived one",
                "source": "IUPAC/CIAAW via " + MSRC, "confidence": "high"}
        rec["standard_atomic_weight_source"] = ("CIAAW, via " + MSRC)
        rows.append(rec)

    # --- hypothetical rows in the raw file are not elements anybody can use
    extra = [s for s in bow if s not in {r["symbol"] for r in rows}]
    if extra:
        warn.append("periodic layer: %d row(s) in the raw element file are not established "
                    "elements and are excluded (%s)" % (len(extra), ", ".join(sorted(extra))))
    for r in rows:
        r["not_a_shelf_reagent"] = r["symbol"] in NOT_A_REAGENT
        if r["number"] >= 100:
            # nothing past einsteinium has ever been held in a beaker: a density for
            # oganesson is a calculation, and a table that prints it like a measurement
            # is the kind of lie this dataset is built not to tell
            r["values_are_predicted"] = True
            r["prediction_note"] = (
                "no isotope of this element has been produced in bulk: a few atoms at a time, "
                "for a moment. Every temperature, density and radius here is a calculated value "
                "for an element that has never been weighed, so the app labels them 'predicted' "
                "and never uses them in a calculation about a real flask")
            for key in ("density", "mel_point", "boil_point", "heat_capacity_molar",
                        "atomic_radius_pm", "covalent_radius_pm", "vdw_radius_pm",
                        "metallic_radius_pm", "electron_affinity", "electronegativity_pauling",
                        "electronegativity_allen", "fusion_heat_kJ_mol",
                        "vaporisation_heat_kJ_mol", "lattice_constant"):
                d = r.get(key)
                if isinstance(d, dict):
                    d["measured"] = False
                    d["confidence"] = "approx"
            r["is_sublimation"] = False
    return rows


# --------------------------------------------------------------- element <-> shelf
def element_atoms(formula):
    """The single element a formula is made of, or None.  'Fe', 'H2', 'S8' -> symbol."""
    try:
        c = chem.parse_formula(formula)
    except Exception:
        return None
    if len(c) != 1:
        return None
    if ":" in str(formula) or "^" in str(formula):
        return None
    return next(iter(c))


# Isotope shorthand is not an element: D2O contains hydrogen, and the periodic table has no
# row for an isotope. The index follows the nucleus rather than the letters, so heavy water
# appears in hydrogen's dataset; the species record keeps its D count, because that is what
# makes its molar mass 20.03 rather than 18.02.
ISOTOPE_OF = {"D": "H", "T": "H"}


def index_symbols(rec):
    return [ISOTOPE_OF.get(sym, sym) for sym in (rec.get("elements") or {})]


def crosslink(elements, species_rows, reactions, warn):
    """Attach to each element what the warehouse actually holds for it.

    This is what makes 'open iron, see everything we know about iron' work: the app
    reads el['dataset'] and gets the species, the reactions and the property counts.
    """
    by_el = {}
    for s in species_rows:
        for sym in index_symbols(s):
            by_el.setdefault(sym, []).append(s["id"])
        el = element_atoms(s.get("formula") or "")
        if el:
            by_el.setdefault(el, [])
            if s["id"] not in by_el[el]:
                by_el[el].append(s["id"])
    # which reactions involve which element. A reaction term carries a species_id, not a
    # copy of the species record, so the lookup has to go through the index: reading
    # t["species"] used to return {} for every term and left every element with an empty
    # reaction list, which is the sort of bug only a cross-check catches.
    idx = {s["id"]: s for s in species_rows}
    rx_by_el = {}
    for r in reactions:
        for side in ("reactants", "products"):
            for t in r.get(side) or []:
                sid = t.get("species_id")
                sp = t.get("species") or idx.get(sid) or {}
                for sym in index_symbols(sp):
                    rx_by_el.setdefault(sym, set()).add(r["id"])
    for e in elements:
        ids = sorted(set(by_el.get(e["symbol"], [])))
        e["dataset"] = {
            "species_ids": ids,
            "species_count": len(ids),
            "elemental_species": sorted(i for i in ids if element_atoms(idx[i].get("formula") or "")
                                        == e["symbol"]),
            "reaction_ids": sorted(rx_by_el.get(e["symbol"], set())),
            "reaction_count": len(rx_by_el.get(e["symbol"], set())),
            "weighable": not e["not_a_shelf_reagent"],
            "note": ("the element's own bottle is listed under elemental_species; the rest are "
                     "compounds in this dataset that contain the element"),
        }
        if not ids:
            warn.append("element %s (%s): no species in this dataset contains it"
                        % (e["symbol"], e["name"]))
    return elements


def build_element_species(elements, species_rows, by_formula, warn):
    """A shelf record for every element that has none, built from the element table.

    Properties are copied with their citation; molar mass is computed.  Nothing here
    invents a number: an element with no measured melt point gets `null` plus the
    reason, and the synthetic ones are marked as not selectable on the shelf.
    """
    have = {element_atoms(s.get("formula") or "") for s in species_rows}
    out = []
    for e in elements:
        sym = e["symbol"]
        if sym in have:
            continue
        formula = MOLECULAR.get(sym, sym)
        ph = (e.get("phase_at_298K") or "Solid").lower()[0]
        if ph not in ("s", "l", "g"):
            ph = "s"
        word = {"s": "solid", "l": "liquid", "g": "gas"}[ph]
        rec = {
            "id": "elem_" + sym.lower(),
            "name": "%s (%s, standard state)" % (e["name"], word),
            "formula": formula, "formula_written": formula,
            "kind": "species", "state": ph,
            "elements": {}, "role": "element",
            "from_element": sym,
            "molar_mass": None,
            "note": ("generated from the periodic table because this element had no record: "
                     "every property below is the element's own measured value, cited, and "
                     "nothing else about it is claimed"),
        }
        for fld, key in (("props_mp", "mel_point"), ("props_bp", "boil_point"),
                         ("props_den", "density")):
            src = e.get(key) or {}
            rec[fld] = {"value": src.get("value"), "units": src.get("units") or (
                "g/cm3" if key == "density" else "degC"),
                "source": src.get("source", "periodic layer"), "ref_id": None,
                "confidence": src.get("confidence", "med")}
            if src.get("kelvin") is not None:
                rec[fld]["kelvin"] = src["kelvin"]
            if src.get("value") is None:
                rec[fld]["missing"] = src.get("missing", "no measured value in the cited sources")
            if key == "density" and ph == "g":
                rec[fld]["note"] = ("gas density at 0 degC and 1 atm as given by the source, "
                                    "not the liquid's")
        cp = e.get("heat_capacity_molar") or {}
        if cp.get("value") is not None:
            rec["heat_capacity_molar"] = {"value": cp["value"], "units": "J/mol/K",
                                         "source": cp.get("source", "periodic layer"),
                                         "ref_id": None, "confidence": "high"}
        fh = e.get("fusion_heat_kJ_mol") or {}
        if fh.get("value") is not None:
            rec["fusion_heat"] = {"value": fh["value"], "units": "kJ/mol",
                                 "source": fh.get("source", "periodic layer"), "ref_id": None,
                                 "confidence": "high",
                                 "note": "enthalpy of fusion: q = n * this, used for melt/freeze maths"}
        vh = e.get("vaporisation_heat_kJ_mol") or {}
        if vh.get("value") is not None:
            rec["vapourisation_heat"] = {"value": vh["value"], "units": "kJ/mol",
                                        "source": vh.get("source", "periodic layer"),
                                        "ref_id": None, "confidence": "high"}
        if e.get("cas"):
            rec["cas"] = e["cas"]
            rec["cas_provenance"] = {"source": "element table (vendored), same value the "
                                    "substance's own register entry carries", "confidence": "high"}
        if e.get("colour_hex"):
            rec["swatch_hex"] = e["colour_hex"]
        if sym in NOBLE:
            rec["note"] += "; a noble gas: it does not combine under lab conditions"
        if e.get("radioactive"):
            rec["availability"] = "not a shelf reagent: radioactive, no quantities in this lab"
        if e["not_a_shelf_reagent"]:
            rec["availability"] = "not a shelf reagent: not obtainable outside a nuclear facility"
        # the shelf screen must filter on a flag, not string-match the prose above
        if e["not_a_shelf_reagent"] or e.get("radioactive"):
            rec["not_a_shelf_reagent"] = True
            rec["shelf_block_reason"] = (
                "radioactive" if e.get("radioactive") else "not obtainable outside a nuclear "
                "facility") + " - the element page may show this record, the bench may not " \
                "select it"
        if ph == "g" and not e["not_a_shelf_reagent"]:
            rec["vol"] = rec.get("vol") or "gas"
        counts = chem.parse_formula(formula)
        rec["elements"] = {e: n for e, n in sorted(counts.items())}
        rec["molar_mass"] = {
            "value": chem.molar_mass(counts), "units": "g/mol",
            "source": "computed from CIAAW standard atomic weights", "ref_id": None,
            "confidence": "high",
            "note": "never typed by hand - chem.molar_mass(); for an element this is "
                    "the atomic weight times the atoms in the standard-state molecule"}
        unc = e.get("mass_uncertainty") or {}
        if unc.get("value") is not None:
            rec["molar_mass"]["uncertainty_u"] = round(unc["value"] * sum(counts.values()), 5)
            rec["molar_mass"]["uncertainty_note"] = (
                "the atomic weight itself carries this uncertainty (CIAAW), so the molar mass "
                "cannot be quoted to more digits than that")
        rec["colour"] = None
        rec["colour_missing"] = ("the element table describes appearance in words only "
                                 "for some metals; no colour is asserted here")
        if formula in EQUATION_FORM:
            rec["equation_form"] = EQUATION_FORM[formula][0]
            rec["equation_form_note"] = EQUATION_FORM[formula][1]
        out.append(rec)
    return out


# ------------------------------------------------------------ oxidation states layer
def group_charges(species_rows, tables):
    """Charges of polyatomic ions, read off the records the build already verified.

    Nothing is typed in: an ion only counts if it exists as an aqueous species with a
    charge, or as a key in the thermo-ion table, which writes the charge in its name.
    """
    gc = {}
    for s in species_rows:
        f = s.get("formula") or ""
        q = s.get("charge")
        if q and f and s.get("kind") == "aqueous_ion":
            bare = chem.strip_charge(f)
            if bare:
                gc.setdefault(bare, int(q))
    for key in (tables.get("thermo_ion") or {}):
        m = re.match(r"^(.*?)(\d*)([+-])\(aq\)$", key)
        if m:
            n = int(m.group(2) or 1) * (1 if m.group(3) == "+" else -1)
            bare = re.sub(r"[\s.]*\d*$", "", m.group(1))
            gc.setdefault(bare, n)
    for key in (tables.get("ksp") or {}):
        m = re.match(r"^([A-Za-z0-9()]+?)\^(\d*)([+-])$", key)
        if m:
            gc.setdefault(m.group(1), int(m.group(2) or 1) * (1 if m.group(3) == "+" else -1))
    for extra, q in (("OH", -1), ("NH4", 1), ("NO3", -1), ("SO4", -2), ("CO3", -2), ("PO4", -3)):
        # the six every solubility argument needs; kept only so the derivation above
        # failing to find one does not silently change an oxidation state
        gc.setdefault(extra, q)
    return gc


def annotate_states(species_rows, gc, elements):
    """Give each species the oxidation states its own formula supports, per element.

    The element records then carry which states are actually seen in this dataset, so
    the app can say 'iron appears here as +2 and +3' without anyone typing a list.
    """
    seen = {}
    for s in species_rows:
        f = s.get("formula")
        if not f or s.get("kind") not in (None, "species", "aqueous_ion"):
            continue
        charge = int(s.get("charge") or 0)
        try:
            st, un, notes = chem.ox_states(f, gc, charge=charge)
        except Exception as ex:
            s["oxidation_states_missing"] = "formula %r could not be read (%s)" % (f, ex)
            continue
        if st:
            s["oxidation_states"] = st
            if notes:
                s["oxidation_states_basis"] = "; ".join(notes[:3])
        if un:
            s["oxidation_states_unresolved"] = un
            s.setdefault("oxidation_states_missing",
                         "the rules leave more than one element free in this formula, so no "
                         "state is asserted (mixed valence, or a structure the formula does not show)")
        for k, v in (st or {}).items():
            for x in v:
                seen.setdefault(k, set()).add(x)
    for e in elements:
        got = sorted(seen.get(e["symbol"], []))
        e["oxidation_states_observed"] = got or None
        e["oxidation_states_source"] = ("computed from the %d species in this dataset by the "
                                        "textbook rule set (see ENGINE/COMBINATORICS)"
                                        % len(species_rows))
    return seen


# ------------------------------------------------------------- element combinations
def e0_couples(e0):
    """Index the electrode table by element, split into 'as a reductant' / 'as oxidant'.

    A couple counts as binary when both sides contain nothing but that element and
    electrons - Na+/Na for the metal, Cl2/Cl- for the nonmetal - because only then is
    E(degrees) a number about A + B and not about some other reaction that happens to
    involve them.
    """
    metal, nonmet = {}, {}
    for key, rec in (e0 or {}).items():
        if "(" in key or "base" in key.lower() and "O2/" not in key:
            pass
        parts = key.split("/")
        if len(parts) != 2:
            continue
        left, right = parts
        v = rec.get("value") if isinstance(rec, dict) else rec
        m = re.fullmatch(r"([A-Z][a-z]?)", right.strip())
        if m and re.fullmatch(r"[A-Za-z0-9()\[\]]*?\d*\+", left.strip()):
            sym = m.group(1)
            ch = re.search(r"(\d*)\+$", left.strip())
            n = int(ch.group(1)) if ch and ch.group(1) else 1
            metal.setdefault(sym, []).append({"couple": key, "E_V": v, "n": n})
            continue
        m = re.fullmatch(r"(\d*)([A-Z][a-z]?)2?", left.strip())
        ch = re.fullmatch(r"([A-Z][a-z]?)(\d*)-", right.strip())
        if m and ch and m.group(2) == ch.group(1):
            sym = m.group(2)
            n = int(ch.group(2)) if ch.group(2) else 1
            nonmet.setdefault(sym, []).append({"couple": key, "E_V": v, "n": n})
    if "O" in e0 or True:
        for key in list(e0 or {}):
            if key.startswith("O2/OH-"):
                nonmet.setdefault("O", []).append(
                    {"couple": key, "E_V": e0[key]["value"], "n": 4,
                     "proxy": "aqueous oxygen couple used in place of O2/O2-, which no table lists"})
    return metal, nonmet


def build_combinations(elements, species_rows, reactions, tables, warn):
    """Every pair of elements, the formula the valences allow, and what is real about it.

    `verified` means the formula exists as a record in this dataset, so the app shows
    the measured properties by following the id.  `predicted` means only the arithmetic
    is available - mass, electronegativity difference, ionic character, and an emf
    derived from the electrode table where both binary couples exist.  No melting
    point, no colour and no yield is ever attached to a predicted formula.
    """
    idx, idx_red, sp_idx = {}, {}, {s["id"]: s for s in species_rows}
    used = Counter_sid = None
    used_ids = set()
    for r in reactions or []:
        for side in ("reactants", "products"):
            for t in (r.get(side) or []):
                if t.get("species_id"):
                    used_ids.add(t["species_id"])

    def prefer(rows):
        """Same atoms, several records: the dry form wins - two elements meeting give a
        solid or a gas, not a solution - then the record the reaction files actually use,
        so NaCl points at the bottle rather than at the mineral note."""
        if len(rows) == 1:
            return rows[0]
        return sorted(rows, key=lambda r: (0 if r.get("state") in ("s", "g", "l") else 1,
                                           0 if r["id"] in used_ids else 1,
                                           0 if r.get("kind") == "species" else 1,
                                           r["id"]))[0]

    for s in species_rows:
        f = s.get("formula")
        if not f or s.get("kind") not in (None, "species"):
            continue
        try:
            c = chem.parse_formula(f)
        except Exception:
            continue
        if s.get("charge"):
            continue
        idx.setdefault(chem.hill(c), []).append(s)
        g = 0
        for n in c.values():
            g = chem._gcd(g, int(n)) if g else int(n)
        if g > 1:
            idx_red.setdefault(chem.hill({k: v // g for k, v in c.items()}), []).append(s)
    idx = {k: prefer(v) for k, v in idx.items()}
    idx_red = {k: prefer(v) for k, v in idx_red.items()}
    metal_c, nonmet_c = e0_couples(tables.get("e0"))
    # reactions whose reactants are exactly two elements: the real equation to show
    pair_rx = {}
    for r in reactions:
        if r.get("record_type") != "equation":
            continue
        rs = [t for t in (r.get("reactants") or [])]
        if len(rs) != 2:
            continue
        els = []
        for t in rs:
            sp = t.get("species") or sp_idx.get(t.get("species_id")) or {}
            syms = list(sp.get("elements") or [])
            if len(syms) != 1:
                els = None
                break
            els.append(syms[0])
        if not els:
            continue
        made = set()
        for t in (r.get("products") or []):
            sp = t.get("species") or sp_idx.get(t.get("species_id")) or {}
            f = sp.get("formula") or t.get("formula") or ""
            if not f:
                continue
            made.add(chem.hill(chem.parse_formula(f)) if f in ("x",) else f)
            try:
                c = chem.parse_formula(f)
                g = 0
                for n in c.values():
                    g = chem._gcd(g, int(n)) if g else int(n)
                if g > 1:
                    made.add(chem.hill({k: v // g for k, v in c.items()}))
            except Exception:
                pass
        pair_rx.setdefault(tuple(sorted(els)), []).append((r["id"], made))
    EN = {e["symbol"]: (e.get("electronegativity_pauling") or {}).get("value") for e in elements}
    MASS = {e["symbol"]: (e.get("atomic_mass") or {}).get("value") for e in elements}
    MAIN = {e["symbol"]: [s for s in (e.get("oxidation_states_main") or [])] for e in elements}
    NOBLE_S = {e["symbol"] for e in elements if e["symbol"] in NOBLE}
    EXT = {e["symbol"]: list(e.get("oxidation_states_extended") or []) for e in elements}
    rows, seen = [], set()
    syms = [e["symbol"] for e in elements]

    def none_row(x, y, why):
        rows.append({"pair": "%s-%s" % (x, y), "elements": [x, y], "formula": None,
                     "formula_hill": None, "states": None, "status": "none", "why": why,
                     "molar_mass": None, "electronegativity_difference": None,
                     "percent_ionic_character": None, "predicted_emf": None, "verdict": None,
                     "reaction_ids": [], "species_id": None})

    for i, aa in enumerate(syms):
        for bb in syms[i + 1:]:
            a, b = aa, bb          # locals: the swap below must not leak into the next pair
            ea, eb = EN.get(a), EN.get(b)
            if ea is not None and eb is not None and eb < ea:
                a, b = b, a                          # a is the more electropositive
            if a in NOBLE_S or b in NOBLE_S:
                noble = a if a in NOBLE_S else b
                other = b if noble == a else a
                if noble in ("He", "Ne", "Ar", "Rn", "Og") or other not in ("F", "O"):
                    none_row(aa, bb, "%s is a noble gas: no binary compound of it exists "
                                     "under lab conditions, so there is nothing to mix" % noble)
                    continue
            # the common valences only, filled from the extended list solely when a side
            # has none - widening further would invent CH, H2C and other radicals as
            # if they were compounds
            pos = [x for x in MAIN.get(a, []) if x and x > 0][:4] or \
                  [x for x in EXT.get(a, []) if x and x > 0][:2]
            neg = sorted({abs(x) for x in MAIN.get(b, []) if x and x < 0})[:3] or \
                  sorted({abs(x) for x in EXT.get(b, []) if x and x < 0})[:2]
            if not pos or not neg:
                both_metal = (a not in NONMETAL_SIDE) and (b not in NONMETAL_SIDE)
                none_row(aa, bb, (
                    "both elements are metals: they can form an alloy or an intermetallic "
                    "phase, which has no valence formula to write down"
                    if both_metal else
                    "the source lists no negative oxidation state for %s and no positive one "
                    "for %s, so no neutral binary formula follows from the valence rules"
                    % (b, a)))
                continue
            for za in pos:
                for zb in neg:
                    f = display_formula(a, b, za, zb)
                    if not f:
                        continue
                    try:
                        cc = chem.parse_formula(f)
                    except Exception:
                        continue
                    h = chem.hill(cc)
                    g = 0
                    for n in cc.values():
                        g = chem._gcd(g, int(n)) if g else int(n)
                    red = chem.hill({k: (v // g if g > 1 else v) for k, v in cc.items()})
                    key = (h, a, b)
                    if key in seen:
                        continue
                    seen.add(key)
                    hit = idx.get(h)
                    empirical = None
                    if hit is None:
                        alt = idx.get(red) or idx_red.get(red) or idx_red.get(h)
                        if alt is not None:
                            hit, empirical = alt, True
                    dchi = round(abs((ea or 0) - (eb or 0)), 2) if ea is not None and eb is not None else None
                    row = {
                        "pair": "%s-%s" % (a, b), "elements": [a, b],
                        "formula": f, "formula_hill": h, "formula_reduced": red,
                        "states": [za, -zb],
                        "status": "verified" if hit and not empirical else "predicted",
                        "molar_mass": {"value": chem.molar_mass(cc), "units": "g/mol",
                                       "source": "computed from CIAAW atomic weights",
                                       "ref_id": None, "confidence": "high",
                                       "basis": "computed"},
                        "electronegativity_difference": (
                            {"value": dchi, "units": "Pauling scale",
                             "source": "computed from the element table", "ref_id": None,
                             "confidence": "high", "basis": "computed"} if dchi is not None else None),
                        "percent_ionic_character": (
                            {"value": chem.pauling_ionicity(dchi), "units": "%",
                             "source": "Pauling: 100*(1-exp(-(dX/2)^2))", "ref_id": None,
                             "confidence": "rule", "basis": "rule",
                             "note": "a rule of thumb about bonding, not a measurement"}
                            if dchi is not None else None),
                    }
                    n_e = za * (cc and 1) or 0
                    n_e = za * (1 if h else 0)
                    # electrons per formula unit of product
                    ncat = cc.get(a, 1)
                    n_e = za * ncat
                    mc = [c for c in metal_c.get(a, []) if c["n"] == za] or metal_c.get(a, [])
                    nc = [c for c in nonmet_c.get(b, []) if c["n"] == zb] or nonmet_c.get(b, [])
                    if mc and nc and mc[0]["E_V"] is not None and nc[0]["E_V"] is not None:
                        cell = round(nc[0]["E_V"] - mc[0]["E_V"], 3)
                        logk = round(n_e * cell / 0.0591, 1)
                        row["predicted_emf"] = {
                            "value": cell, "units": "V",
                            "source": "E(couple of %s) - E(couple of %s) from tables.e0"
                                      % (b, a), "ref_id": None,
                            "confidence": "med", "basis": "computed",
                            "couples": [mc[0]["couple"], nc[0]["couple"]],
                            "note": ("the cell emf for forming this compound from its elements, "
                                     "using aqueous standard potentials")}
                        row["log_k"] = {"value": logk, "units": "dimensionless at 25 C",
                                        "source": "log K = n*E/0.0591, n = %d e- per formula unit" % n_e,
                                        "ref_id": None, "confidence": "med", "basis": "computed"}
                        row["delta_g_kJ_per_mol"] = {
                            "value": round(-n_e * 96.485 * cell, 1), "units": "kJ/mol of product",
                            "source": "dG = -nFE, F = 96485 C/mol", "ref_id": None,
                            "confidence": "med", "basis": "computed"}
                        row["verdict"] = ("combination strongly favoured" if logk > 3 else
                                         "combination not favoured in water" if logk < -3 else
                                         "close to the boundary; conditions decide")
                    else:
                        row["predicted_emf"] = None
                        row["verdict"] = None
                        row["why_no_verdict"] = (
                            "no binary standard couple for %s and %s in tables.e0, so no emf can "
                            "be derived; thermodynamic data for this formula is not in the dataset"
                            % (a, b))
                    if empirical:
                        row["status"] = "empirical"
                        row["note"] = ("the empirical formula of the pair matches a substance in "
                                       "this dataset whose molecular formula is %s: same atoms in "
                                       "the same ratio, so properties are quoted from that record "
                                       "and the two formulas are shown together"
                                       % hit.get("formula_written"))
                    if hit:
                        row["species_id"] = hit["id"]
                        row["name"] = hit.get("name")
                        row["state"] = hit.get("state")
                        row["properties_available"] = sorted(k for k in
                                                             ("props_mp", "props_bp", "props_den",
                                                              "props_sol", "colour_description", "dhf")
                                                             if hit.get(k))
                        pass
                    rid, other = [], []
                    for rid_, made in pair_rx.get(tuple(sorted([a, b])), []):
                        (rid if (h in made or red in made) else other).append(rid_)
                    row["reaction_ids"] = rid
                    if other:
                        row["other_reactions_of_this_pair"] = other
                        row["other_reactions_note"] = (
                            "these reactions combine the same two elements but make a different "
                            "ratio of them, so they are not this formula's preparation")
                        row["note"] = (
                            "formula allowed by the common valences the cited table lists for "
                            "these two elements. A formula absent from this list is not claimed "
                            "impossible - it is outside what the rules enumerate. No measured "
                            "property exists for it in this dataset, so no yield, colour, melting "
                            "point or hazard may be shown for it")
                    rows.append(row)
    return rows


# ------------------------------------------------------ what two solutions can give
# The statements below are the same solubility rules already curated as prose in
# tables.solubility_rules, written so a program can use them.  'soluble' means the
# app shows no precipitate; 'insoluble' means it shows one when Q exceeds Ksp, or the
# rule says so when no Ksp has been measured for that salt.
_RULE_TEXT = {
    0: "all sodium, potassium and ammonium salts",
    1: "all nitrates",
    2: "most chlorides",
    3: "most sulfates",
    4: "most carbonates, phosphates, sulfites, silicates",
    5: "most sulfides",
    6: "most hydroxides",
    7: "most oxalates and chromates",
    8: "acetates, perchlorates",
}
S, I, SL = "soluble", "insoluble", "slightly soluble"
ANION_RULE = {
    "NO3": (S, {}, 1), "ClO4": (S, {}, 8), "ClO3": (S, {}, 8), "C2H3O2": (S, {}, 8),
    "MnO4": (S, {"Ag": SL}, 8), "NO2": (S, {"Ag": SL}, 8), "CN": (S, {"Ag": I}, 0),
    "CNS": (S, {"Ag": SL}, 0), "H2Y": (S, {}, 0), "Cr2O7": (S, {}, 0),
    "Cl": (S, {"Ag": I, "Pb": SL, "Hg": I, "Cu": SL}, 2),
    "Br": (S, {"Ag": I, "Pb": SL, "Hg": I, "Cu": SL}, 2),
    "I": (S, {"Ag": I, "Pb": I, "Hg": I, "Cu": I}, 2),
    "SO4": (S, {"Ba": I, "Sr": I, "Pb": I, "Ca": SL, "Ag": SL, "Hg": I, "Ra": I}, 3),
    "HSO4": (S, {"Ca": I, "Ba": I, "Sr": I, "Pb": I}, 3),
    "S2O3": (S, {"Ag": I, "Pb": I, "Ba": I, "Sr": I}, 3),
    "S2O7": (S, {}, 3), "O6S4": (S, {}, 3),
    "CO3": (I, {"Na": S, "K": S, "NH4": S, "Li": SL, "Rb": S, "Cs": S}, 4),
    "HCO3": (S, {"Na": SL, "K": SL, "NH4": S}, 4),
    "CHO3": (S, {}, 4),
    "PO4": (I, {"Na": S, "K": S, "NH4": S, "Li": SL}, 4),
    "SO3": (I, {"Na": S, "K": S, "NH4": S}, 4),
    "SiO3": (I, {"Na": S, "K": S, "NH4": S}, 4),
    "C2O4": (I, {"Na": S, "K": S, "NH4": S}, 7),
    "CrO4": (I, {"Na": S, "K": S, "NH4": S, "Mg": SL, "Ca": SL}, 7),
    "AsO3": (I, {"Na": S, "K": S, "NH4": S}, 4),
    "B4O7": (I, {"Na": S, "K": S, "NH4": S}, 4),
    "S": (I, {"Na": S, "K": S, "NH4": S, "Ca": S, "Ba": S, "Sr": S, "Mg": S}, 5),
    "OH": (I, {"Na": S, "K": S, "NH4": S, "Ba": S, "Sr": S, "Ca": SL, "Li": S}, 6),
    "O4P": (I, {"Na": S, "K": S, "NH4": S}, 4),
}
# ligand complexes, a diazonium salt and the iron of haemoglobin: real records, but a
# solubility rule says nothing about them, so they are kept out of the matrix rather than
# answered with a rule that does not apply
SKIP_IONS = {"HbFe", "C6H5N2", "OSb", "CFeNS", "Ag(NH3)2", "Cu(NH3)4", "Ni(NH3)6",
             "Fe(CN)6", "Ag(CN)2", "Au(CN)2", "CdI4", "Co(SCN)4", "HgI4", "PbI4", "Zn(NH3)4",
             "SbO", "H2Y", "C4H4O6", "Cr2O7", "B4O7", "AsO3", "MoO4", "O3S2", "O6S4", "CNS"}
GAS_ON_ACID = {"CO3": "CO2", "HCO3": "CO2", "CHO3": "CO2", "SO3": "SO2", "S": "H2S",
               "C2H3O2": None, "CN": "HCN", "C2O4": None, "NO2": "NO2"}


def _conj_acid(anion, q, pka):
    """The protonated form of an anion, found in the pKa table by trying the writings.

    No acid names are hard-coded: PO4^3- -> H3PO4 and 3HPO4 are looked up in
    tables.pka, and the answer is only used because the table really has that entry.
    """
    n = abs(int(q or 1))
    cands = ["H%0d%s" % (n, anion), anion + "H" * n if n == 1 else anion + ("H%d" % n),
             "H" + anion, anion]
    for c in cands:
        if c in pka:
            return c
    return None


def _writtenIon(s):
    """(display text, element counts, |charge|) for an ion record."""
    w = s.get("formula_written") or s.get("formula") or ""
    q = int(s.get("charge") or 0)
    try:
        c = chem.count_atoms(re.sub(r"\^.*$", "", w))
    except Exception:
        return None
    return w, c, q


def build_precip_matrix(species_rows, tables, warn):
    """Every soluble-cation / anion pair the shelf can supply, and what it gives.

    A pair is decided first by a measured Ksp if this dataset has one, then by the
    curated solubility rules, and the record says which of the two it used - so the
    app never has to present a rule as a measurement.
    """
    cations, anions = {}, {}
    skipped = []
    for s in species_rows:
        if s.get("kind") != "aqueous_ion":
            continue
        got = _writtenIon(s)
        if not got:
            continue
        w, c, q = got
        if w in SKIP_IONS or sum(c.values()) > 7 or (len(c) > 3 and q and w not in ANION_RULE):
            skipped.append(w)
            continue
        (cations if q > 0 else anions).setdefault(w, {"text": w, "counts": c, "q": abs(q),
                                                      "id": s["id"], "sp": s})
    # NH4+ has to be registered by hand: it is the acid behind the tables.pka entry
    # 'NH4Cl', it is on the shelf as ammonium chloride/sulfate, and no net-ionic
    # equation in the dataset ever wrote it, so the derived ion layer does not know it.
    _pk = (tables.get("pka") or {}).get("NH4Cl")
    if _pk is not None:
        try:
            c = chem.count_atoms("NH4")
            if "NH4" not in cations:
                cations["NH4"] = {"text": "NH4", "counts": c, "q": 1,
                                  "id": "ion:NH4(+1)", "sp": None,
                                  "basis": "the acid in tables.pka entry 'NH4Cl'"}
        except Exception:
            warn.append("could not register NH4+ in the precipitation matrix")
    # the thermo-ion table knows ions the equations never mentioned
    for key, rec in (tables.get("thermo_ion") or {}).items():
        m = re.match(r"^(.*?)(\d*)([+-])\(aq\)$", key)
        if not m:
            continue
        w, q = m.group(1), int(m.group(2) or 1) * (1 if m.group(3) == "+" else -1)
        w = re.sub(r"[\s.]*\d*$", "", w)
        if (w in cations or w in anions):
            continue
        try:
            c = chem.count_atoms(chem.strip_charge(w))
        except Exception:
            continue
        (cations if q > 0 else anions).setdefault(w, {"text": w, "counts": c, "q": abs(q),
                                                      "id": "thermo:" + key, "sp": None})
    ksp_by_hill = {}
    for k, v in (tables.get("ksp") or {}).items():
        try:
            ksp_by_hill.setdefault(chem.hill(chem.parse_formula(k)), (k, v))
        except Exception:
            ksp_by_hill.setdefault(k, (k, v))
    species_by_hill, species_by_red = {}, {}
    for s in species_rows:
        if s.get("kind") in (None, "species") and not s.get("charge") and s.get("formula"):
            try:
                cc = chem.parse_formula(s["formula"])
            except Exception:
                continue
            species_by_hill.setdefault(chem.hill(cc), s)
            g = 0
            for n in cc.values():
                g = chem._gcd(g, int(n)) if g else int(n)
            if g > 1:
                species_by_red.setdefault(chem.hill({k: v // g for k, v in cc.items()}), s)
    pka = tables.get("pka") or {}
    if skipped:
        warn.append("precipitation matrix: %d aqueous ion(s) left out because the solubility "
                    "rules do not speak of them (%s)"
                    % (len(set(skipped)), ", ".join(sorted(set(skipped)))))
    rows = []
    for cw, cat in sorted(cations.items()):
        for aw, an in sorted(anions.items()):
            L = abs(cat["q"] * an["q"]) // chem._gcd(cat["q"], an["q"])
            nc, na = L // cat["q"], L // an["q"]
            counts = {}
            for src, mult in ((cat["counts"], nc), (an["counts"], na)):
                for e, n in src.items():
                    counts[e] = counts.get(e, 0) + n * mult
            # brackets only when the group is repeated: Ag2SO4, not Ag2(SO4);
            # Al2(SO4)3 keeps them, which is the case they exist for
            disp = (cw + (str(nc) if nc > 1 else "")) + \
                   (("(" + aw + ")" + str(na)) if (len(an["counts"]) > 1 and na > 1)
                    else aw + (str(na) if na > 1 else ""))
            h = chem.hill(counts)
            g = 0
            for n in counts.values():
                g = chem._gcd(g, int(n)) if g else int(n)
            red = chem.hill({k: v // g for k, v in counts.items()}) if g > 1 else h
            found = species_by_hill.get(h) or species_by_red.get(red)
            if found is not None:
                # write the product the way the substance is written in the dataset:
                # H+ + OH- gives H2O, not the criss-cross's 'HOH'
                disp = found.get("formula_written") or disp
            row = {"cation": cw + ("%d+" % cat["q"] if cat["q"] > 1 else "+"),
                   "anion": aw + ("%d-" % an["q"] if an["q"] > 1 else "-"),
                   "cation_id": cat["id"], "anion_id": an["id"],
                   "product": disp, "product_hill": h,
                   "coefficients": [nc, na],
                   "molar_mass": {"value": chem.molar_mass(counts), "units": "g/mol",
                                  "source": "computed from CIAAW atomic weights", "ref_id": None,
                                  "confidence": "high", "basis": "computed"}}
            ksp = None
            kkey = None
            got = ksp_by_hill.get(h)
            if got:
                kkey, ksp = got
            if ksp and isinstance(ksp, dict) and ksp.get("Ksp", {}).get("value"):
                kv = ksp["Ksp"]["value"]
                s_mol = (kv / ((nc ** nc) * (na ** na))) ** (1.0 / (nc + na))
                row["outcome"] = "precipitate"
                row["basis"] = "measured Ksp"
                row["ksp"] = {"value": kv, "units": "(mol/L)^n",
                              "source": ksp["Ksp"].get("source", "curated"), "ref_id": None,
                              "confidence": ksp["Ksp"].get("confidence", "high")}
                row["dissolution_equation"] = ksp.get("dissolution_equation")
                row["solubility_mol_L"] = {"value": float("%.3g" % s_mol), "units": "mol/L",
                                          "source": "computed from the Ksp of %s via "
                                                      "s = (Ksp/(p^p q^q))^(1/(p+q))" % kkey,
                                          "ref_id": None,
                                          "confidence": "high", "basis": "computed",
                                          "note": "ideal dilute solution: no activity correction"}
                row["solubility_g_L"] = {"value": float("%.3g" % (s_mol * chem.molar_mass(counts))),
                                        "units": "g/L", "source": "solubility(mol/L) x molar mass",
                                        "ref_id": None, "confidence": "high", "basis": "computed"}
                row["ksp_key"] = kkey
            elif (cw == "H" and aw == "OH") or (cw == "H" and an["counts"].get("O") and aw in ("OH",)):
                row["outcome"] = "neutralisation"
                row["basis"] = "ionic product of water, tables.kw"
                row["note"] = "H+ + OH- = H2O: the reaction is complete, and the heat is in the reaction record"
            elif cw == "H" and (aw in GAS_ON_ACID or _conj_acid(aw, an["q"], pka)):
                g = GAS_ON_ACID.get(aw)
                row["outcome"] = "acid on the salt of a weak acid"
                row["basis"] = "pKa table"
                conj = _conj_acid(aw, an["q"], pka)
                pk = pka.get(conj) if conj else None
                pkv = pk.get("value") if isinstance(pk, dict) else None
                pks = (pk.get("pKa_values") or []) if isinstance(pk, dict) else []
                if pkv is None and pks:
                    pkv = pks[0]          # the table stores the stepwise list, not one value
                row["conjugate_acid"] = conj
                if pkv is not None:
                    row["pKa_of_conjugate_acid"] = {"value": pkv, "units": "dimensionless",
                                                   "source": pk.get("source", "curated"),
                                                   "ref_id": None,
                                                   "confidence": pk.get("confidence", "med")}
                    if len(pks) > 1:
                        row["pKa_of_conjugate_acid"]["values_stepwise"] = list(pks)
                # a diprotic acid whose first proton is strong and second is weak (H2SO4,
                # H2SO3) does react with the bare anion - it makes the hydrogen salt - but the
                # protonation is partial, so no single net ionic equation holds at every
                # dilution. That is its own answer, neither "nothing" nor "the weak acid forms".
                partial = (bool(pks) and len(pks) > 1 and an["q"] >= 2 and pks[0] < 0
                           and pks[1] > 0)
                if g:
                    row["gas"] = g
                    row["note"] = ("the weak acid is regenerated and leaves the solution as %s; "
                                   "bubbling and an odour at the mouth of the tube are the "
                                   "observations - waft, never inhale directly, and treat a gas "
                                   "from this branch as toxic unless its own record says "
                                   "otherwise" % g)
                elif partial:
                    row["outcome"] = "no visible change"
                    row["partial_protonation"] = True
                    row["note"] = ("%s is strong in its first proton and weak in its second "
                                   "(pKa %s / %s), so %s becomes partly the hydrogen salt: "
                                   "no precipitate and no gas, only pH and heat"
                                   % (conj, pks[0], pks[1], row["anion"]))
                elif pkv is not None and pkv < 0:
                    # finding the acid in the pKa table is not enough to call it weak: HCl,
                    # HBr, HI, HNO3 and HClO4 are in there with negative pKa, and adding H+ to
                    # their anions does nothing at all. Saying "the weak acid is regenerated"
                    # for hydrochloric acid would be a chemistry error with a citation.
                    row["outcome"] = "no acid-base reaction"
                    row["no_reaction"] = True
                    row["note"] = ("%s is a strong acid (pKa %s), so H+ and %s stay "
                                   "dissociated: this pair gives no precipitate and no gas. "
                                   "The row is silent about redox or colour changes, which the "
                                   "ion-pair rules do not cover (acidified manganate, for "
                                   "instance, disproportionates)"
                                   % (row.get("conjugate_acid") or disp, pkv, row["anion"]))
                else:
                    # "a smell" is only true of the volatile ones, and the dataset says which:
                    # quote the product's own odour field if it has one, else claim nothing
                    od = (found or {}).get("odour")
                    row["note"] = ("the weak acid is regenerated and stays dissolved: no "
                                   "precipitate and no gas"
                                   + (", odour of the acid: %s" % od if od else
                                      " (this acid has no odour recorded)"))
                    if od:
                        row["odour"] = od
                        row["odour_source"] = "the product's own species record"
            elif cw == "NH4" and aw == "OH":
                row["outcome"] = "ammonia released"
                row["basis"] = "pKa of NH4+ (tables.pka)"
                row["gas"] = "NH3"
                row["note"] = "the litmus test for ammonium: warm gently, damp red litmus turns blue"
            else:
                rule = ANION_RULE.get(aw)
                if rule is None:
                    row["outcome"] = None
                    row["basis"] = None
                    row["why"] = ("no Ksp in this dataset and the anion is not in the solubility-rule "
                                  "table, so the app must say 'not covered' rather than guess")
                else:
                    default, exc, ridx = rule
                    verdict = exc.get(cw, default)
                    row["outcome"] = "precipitate" if verdict in (I, SL) else "no visible change"
                    row["basis"] = "solubility rule"
                    row["rule"] = {"solubility": verdict,
                                   "statement": _RULE_TEXT[ridx],
                                   "exceptions_apply_to": sorted(exc) or None}
                    row["confidence"] = "med"
                    if verdict == SL:
                        row["note"] = ("the rule says 'slightly': a cloudiness may appear only when "
                                       "the solutions are concentrated")
            if found:
                row["product_in_dataset"] = True
                row["species_id"] = found["id"]
                row["product_name"] = found.get("name")
                if row.get("outcome") == "precipitate":
                    if found.get("colour_description") or found.get("colour"):
                        row["colour"] = found.get("colour_description") or found.get("colour")
                        row["colour_hex"] = found.get("colour_hex")
            else:
                row["product_in_dataset"] = False
                if row.get("outcome") == "precipitate":
                    row["colour_note"] = ("this salt is not otherwise described in the dataset, "
                                         "so its colour is not known: show 'a solid appears' and "
                                         "no colour, rather than the usual white")
            lhs = "%s%s + %s%s" % (cat["text"], "%d+" % cat["q"] if cat["q"] > 1 else "+",
                                   an["text"], "%d-" % an["q"] if an["q"] > 1 else "-")
            if row.get("outcome") == "precipitate":
                ph = {"s": "s", "l": "l", "g": "g", "aq": "aq", "soln": "aq"}.get(
                    (found or {}).get("state"), "s")
                row["net_ionic"] = "%s = %s(%s)" % (lhs, disp, ph)
                if found and found.get("props_sol"):
                    row["product_solubility_on_record"] = found["props_sol"]
            elif row.get("outcome") == "neutralisation":
                row["net_ionic"] = "H+ + OH- = H2O(l)"
            elif row.get("gas"):
                row["net_ionic"] = "%s = %s(g)" % (lhs, row["gas"])
            elif row.get("outcome") and not (row.get("no_reaction")
                                             or row.get("partial_protonation")):
                row["net_ionic"] = "%s = %s(aq)" % (lhs, disp)
            else:
                row["net_ionic"] = None
                row["net_ionic_note"] = (
                    "no net ionic equation: the conjugate acid is strong, so both ions stay "
                    "dissolved and nothing is formed" if row.get("no_reaction") else
                    "no single net ionic equation: the first proton attaches completely and the "
                    "second only partly, so the mixture is an equilibrium between X and HX"
                    if row.get("partial_protonation") else
                    "nothing is decided for this pair, so no equation is written: an equation "
                    "here would be the guess the record exists to avoid")
            rows.append(row)
    return rows
