"""
ChemLab AI - World Chemistry Knowledge for Python backend
Whole world chemistry, not just 582 species
"""

WORLD_COMPOUNDS = {
    "water": {"formula": "H2O", "name": "Water", "mw": 18.015, "type": "inorganic", "knowledge": "Universal solvent, 71% Earth, 60% body, H-bonding, 18 isotopic forms, Kw=1e-14, anomalous expansion, high heat capacity 4.18 J/gK"},
    "hcl": {"formula": "HCl", "name": "Hydrochloric acid", "mw": 36.46, "type": "acid", "knowledge": "Strong acid pKa -7, stomach pH 1-2, 1M pH 0, azeotrope 20.2% 108.6C, 9 routes in lab, world 1000+ acids"},
    "h2so4": {"formula": "H2SO4", "name": "Sulfuric acid", "mw": 98.08, "type": "acid", "knowledge": "King of chemicals, 70M tons/year, Contact process S->SO2->SO3->H2SO4, strong diprotic, dehydrates sugar, exothermic dilution"},
    "nacl": {"formula": "NaCl", "name": "Sodium chloride", "mw": 58.44, "type": "salt", "knowledge": "Table salt 3.5% seawater, cubic lattice, 6M tons/year, essential electrolyte, 4000 years trade"},
    "nh3": {"formula": "NH3", "name": "Ammonia", "mw": 17.03, "type": "base", "knowledge": "Haber-Bosch N2+3H2->2NH3 400C 200 atm Fe, 80M tons/year, 1% world energy, weak base pKb 4.75, pyramidal"},
    "co2": {"formula": "CO2", "name": "Carbon dioxide", "mw": 44.01, "type": "gas", "knowledge": "Greenhouse 420ppm, dry ice -78.5C, limewater milky, photosynthesis 6CO2+6H2O->C6H12O6+6O2, 25x worse than CO2 is CH4"},
    "ch4": {"formula": "CH4", "name": "Methane", "mw": 16.04, "type": "organic", "knowledge": "Simplest alkane, natural gas 70-90%, tetrahedral, 25x greenhouse vs CO2, fuel"},
    "c2h5oh": {"formula": "C2H5OH", "name": "Ethanol", "mw": 46.07, "type": "organic", "knowledge": "Alcohol, 95.6% azeotrope, fermentation C6H12O6->2C2H5OH+2CO2, fuel, 13% max natural, H-bonding"},
}

REACTION_TEMPLATES = [
    {"id": "acid_base", "pattern": "acid + base -> salt + water", "example": "HCl + NaOH -> NaCl + H2O", "rule": "H+ + OH- -> H2O ΔH=-57kJ, pH change"},
    {"id": "metal_acid", "pattern": "metal + acid -> salt + H2", "example": "Zn + 2HCl -> ZnCl2 + H2", "rule": "Reactivity series K>Na>Ca>Mg>Al>Zn>Fe>...H>Cu>Ag>Au"},
    {"id": "precipitation", "pattern": "AB + CD -> AD(s) + CB", "example": "AgNO3 + NaCl -> AgCl(s) white", "rule": "Solubility rules, Ksp, Q>Ksp→ppt"},
    {"id": "combustion", "pattern": "fuel + O2 -> CO2 + H2O", "example": "CH4 + 2O2 -> CO2 + 2H2O", "rule": "Exothermic, flame, needs O2"},
    {"id": "synthesis", "pattern": "A + B -> AB", "example": "2H2 + O2 -> 2H2O, N2+3H2->2NH3 Haber", "rule": "Formation, often exothermic"},
]

CHEMISTRY_RULES = [
    {"id": "solubility", "rule": "Nitrates soluble, alkali soluble, chlorides soluble except Ag+, Pb2+, sulfates except Ba2+, carbonates insoluble except alkali"},
    {"id": "reactivity", "rule": "K>Na>Ca>Mg>Al>Zn>Fe>Sn>Pb>H>Cu>Hg>Ag>Au, more reactive displaces less"},
    {"id": "periodic", "rule": "Radius decreases across period, increases down group, electronegativity F 4.0 max, ionization opposite, metallic decreases across"},
]

def get_world_knowledge(query):
    q = query.lower()
    results = []
    for cid, data in WORLD_COMPOUNDS.items():
        if q in cid or q in data["formula"].lower() or q in data["name"].lower():
            results.append({"id": cid, **data})
    return results

def predict_world_reaction(reactants):
    q = " ".join(reactants).lower()
    if ("acid" in q or "hcl" in q) and ("base" in q or "naoh" in q):
        return {"products": ["salt", "water"], "equation": "acid + base -> salt + water", "type": "acid-base", "explanation": "Neutralization H+ + OH- -> H2O"}
    if any(m in q for m in ["zn", "mg", "fe"]) and any(a in q for a in ["hcl", "h2so4"]):
        return {"products": ["salt", "H2"], "equation": "metal + acid -> salt + H2", "type": "redox", "explanation": "Metal displaces H2, reactivity series"}
    if "o2" in q and any(f in q for f in ["ch4", "h2", "fuel"]):
        return {"products": ["CO2", "H2O"], "equation": "fuel + O2 -> CO2 + H2O", "type": "combustion", "explanation": "Combustion exothermic flame"}
    return {"products": ["compound"], "equation": "A + B -> AB", "type": "synthesis", "explanation": "General synthesis"}

def explain_world_concept(concept):
    q = concept.lower()
    if "acid" in q:
        return "Acids: donate H+, pH<7, strong HCl H2SO4 HNO3 fully dissociate pKa<0, weak CH3COOH pKa 4.76 partial, theories Arrhenius Bronsted Lewis, world 1000+ acids, 27 in lab, superacids HF-SbF5, stomach HCl pH1-2, 70M tons H2SO4/year"
    if "base" in q:
        return "Bases: accept H+, pH>7, strong NaOH KOH Ca(OH)2, weak NH3 pKb 4.75, theories, uses soap NaOH+fat, antacid, world 1000+ bases, 24 in lab"
    if "periodic" in q:
        return "Periodic Table: 118 elements H to Og, 7 periods 18 groups 4 blocks, trends radius decreases across increases down, ionization opposite, electronegativity F 4.0 max Fr 0.7 min, metallic decreases across, Mendeleev predicted, quantum explains, categories alkali halogen noble gas transition"
    if "organic" in q:
        return "Organic: carbon 10M+ compounds, 4 bonds catenation, functional groups alkane alkene alkyne alcohol aldehyde ketone acid ester amine, reactions substitution addition elimination, mechanisms SN1 SN2 E1 E2, synthesis retrosynthesis Grignard, world petroleum polymers drugs life DNA proteins"
    return f"Chemistry concept {concept}: study of matter, 118 elements, 100M+ compounds PubChem, reactions balance mass charge, energy ΔH ΔG, equilibrium K, kinetics rate, branches inorganic organic physical analytical biochemical, lab 582 species but world millions"
