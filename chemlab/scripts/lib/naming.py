# -*- coding: utf-8 -*-
"""naming.py — derive a PubChem-friendly name from a formula, and the nomenclature
tables the app itself needs (it must be able to *name* a product it just computed).

This is lookup-table nomenclature for common lab chemistry, not a full IUPAC engine:
it is honest about what it knows (returns None otherwise) so the pipeline can mark
'needs manual name' instead of shipping a confident wrong name.
"""
import re
try:
    from .chem import parse_formula, hill
except ImportError:  # loaded as a top-level module
    from chem import parse_formula, hill

# anion / fragment  -> (name, charge)
ANIONS = {
 "F": ("fluoride", -1), "Cl": ("chloride", -1), "Br": ("bromide", -1), "I": ("iodide", -1),
 "O": ("oxide", -2), "S": ("sulfide", -2), "Se": ("selenide", -2), "Te": ("telluride", -2),
 "N": ("nitride", -3), "P": ("phosphide", -3), "As": ("arsenide", -3), "C": ("carbide", -4),
 "Si": ("silicide", -4), "H": ("hydride", -1), "OH": ("hydroxide", -1), "O2": ("peroxide", -2),
 "NO2": ("nitrite", -1), "NO3": ("nitrate", -1), "NO": ("nitrosyl", -1), "N3": ("azide", -1),
 "SO2": ("hydrogensulfite?", -1), "SO3": ("sulfite", -2), "SO4": ("sulfate", -2),
 "HSO3": ("hydrogensulfite", -1), "HSO4": ("hydrogensulfate", -1), "S2O3": ("thiosulfate", -2),
 "S2O8": ("peroxydisulfate", -2), "SO5": ("peroxomonosulfate", -2), "S4O6": ("tetrathionate", -2),
 "CO3": ("carbonate", -2), "HCO3": ("hydrogencarbonate", -1), "C2O4": ("oxalate", -2),
 "CH3COO": ("acetate", -1), "C2H3O2": ("acetate", -1), "HCOO": ("formate", -1),
 "CHO2": ("formate", -1), "COO": ("carboxylate", -1), "CN": ("cyanide", -1),
 "SCN": ("thiocyanate", -1), "OCN": ("cyanate", -1), "CNO": ("cyanate", -1),
 "PO4": ("phosphate", -3), "HPO4": ("hydrogenphosphate", -2), "H2PO4": ("dihydrogenphosphate", -1),
 "P2O7": ("pyrophosphate", -4), "PO3": ("metaphosphate", -1),
 "CrO4": ("chromate", -2), "Cr2O7": ("dichromate", -2), "MnO4": ("permanganate", -1),
 "MnO4-": ("permanganate", -1), "ClO": ("hypochlorite", -1), "ClO2": ("chlorite", -1),
 "ClO3": ("chlorate", -1), "ClO4": ("perchlorate", -1), "BrO3": ("bromate", -1),
 "IO3": ("iodate", -1), "BO2": ("metaborate", -1), "B4O7": ("tetraborate", -2),
 "H2BO3": ("dihydrogenborate", -1), "SiO3": ("silicate", -2), "SiO4": ("orthosilicate", -4),
 "AsO4": ("arsenate", -3), "AsO3": ("arsenite", -3), "SbO3": ("antimonite", -3),
 "VO3": ("metavanadate", -1), "MoO4": ("molybdate", -2), "WO4": ("tungstate", -2),
 "SeO3": ("selenite", -2), "SeO4": ("selenate", -2), "TeO4": ("tellurate", -6),
 "ClF2": ("chlorodifluoride", 0), "AlO2": ("aluminate", -1), "ZnO2": ("zincate", -2),
 "SnO3": ("stannate", -3), "PbO2": ("plumbite?", -2), "Fe(CN)6": ("hexacyanoferrate", -4),
 "Fe(CN)63-": ("hexacyanoferrate(III)", -3), "Ag(CN)2": ("dicyanoargentate", -1),
 "AuCl4": ("tetrachloroaurate", -1), "PtCl6": ("hexachloroplatinate", -2),
 "NH2": ("amide", -1), "SH": ("sulfhydryl", -1), "SO4-": ("sulfate", -2),
}
# whole-formula overrides where the trivial ionic name is not what PubChem indexes
OVERRIDE = {
 "H2O": "water", "H2O2": "hydrogen peroxide", "NH3": "ammonia", "CH4": "methane",
 "CO2": "carbon dioxide", "CO": "carbon monoxide", "SO2": "sulfur dioxide",
 "SO3": "sulfur trioxide", "N2O": "nitrous oxide", "N2H4": "hydrazine",
 "NO": "nitric oxide", "NO2": "nitrogen dioxide", "N2O5": "dinitrogen pentoxide",
 "O3": "ozone", "H2S": "hydrogen sulfide", "PH3": "phosphine", "SiH4": "silane",
 "BF3": "boron trifluoride", "BCl3": "boron trichloride", "AlCl3": "aluminum chloride",
 "CCl4": "carbon tetrachloride", "CHCl3": "chloroform", "CH2Cl2": "dichloromethane",
 "SiF4": "silicon tetrafluoride", "SiCl4": "silicon tetrachloride",
 "PCl3": "phosphorus trichloride", "PCl5": "phosphorus pentachloride",
 "POCl3": "phosphoryl chloride", "P4O10": "phosphorus pentoxide",
 "SF6": "sulfur hexafluoride", "SO2Cl2": "sulfuryl chloride", "SCl2": "disulfur dichloride",
 "TiCl4": "titanium tetrachloride", "SnCl4": "tin(IV) chloride", "P2O5": "phosphorus pentoxide",
 "OF2": "oxygen difluoride", "Cl2O": "dichlorine monoxide", "ClO2": "chlorine dioxide",
 "I2O5": "diiodine pentoxide", "S2Cl2": "disulfur dichloride",
 # acids
 "HCl": "hydrochloric acid", "HBr": "hydrobromic acid", "HI": "hydroiodic acid",
 "HF": "hydrofluoric acid", "H2SO4": "sulfuric acid", "H2SO3": "sulfurous acid",
 "HNO3": "nitric acid", "HNO2": "nitrous acid", "H3PO4": "phosphoric acid",
 "H2CO3": "carbonic acid", "H2C2O4": "oxalic acid", "HClO4": "perchloric acid",
 "HClO3": "chloric acid", "HClO": "hypochlorous acid", "HCN": "hydrogen cyanide",
 "HCOOH": "formic acid", "CH3COOH": "acetic acid", "C6H5COOH": "benzoic acid",
 "H2S": "hydrogen sulfide", "H3BO3": "boric acid", "C6H6O": "phenol",
 "H4SiO4": "orthosilicic acid", "H2SiO3": "metasilicic acid",
 "H2O2": "hydrogen peroxide", "NaOH": "sodium hydroxide", "KOH": "potassium hydroxide",
 "Ca(OH)2": "calcium hydroxide", "Ba(OH)2": "barium hydroxide", "Mg(OH)2": "magnesium hydroxide",
 "NH4OH": "ammonium hydroxide", "NaCl": "sodium chloride", "KCl": "potassium chloride",
 "CaCO3": "calcium carbonate", "Na2CO3": "sodium carbonate", "NaHCO3": "sodium bicarbonate",
 "CuSO4": "copper sulfate", "FeCl3": "iron(III) chloride", "FeCl2": "iron(II) chloride",
 "AgNO3": "silver nitrate", "KMnO4": "potassium permanganate", "K2Cr2O7": "potassium dichromate",
 "K2CrO4": "potassium chromate", "Pb(NO3)2": "lead(2+) nitrate", "NaClO": "sodium hypochlorite",
 "Na2S2O3": "sodium thiosulfate", "Na2SO3": "sodium sulfite", "NaHSO3": "sodium bisulfite",
 "Na2SO4": "sodium sulfate", "NaNO3": "sodium nitrate", "KNO3": "potassium nitrate",
 "NH4Cl": "ammonium chloride", "(NH4)2SO4": "ammonium sulfate", "NH4NO3": "ammonium nitrate",
 "NH4NO2": "ammonium nitrite", "(NH4)2C2O4": "ammonium oxalate", "NH4SCN": "ammonium thiocyanate",
 "CaO": "calcium oxide", "MgO": "magnesium oxide", "CuO": "copper(II) oxide",
 "ZnO": "zinc oxide", "Al2O3": "aluminum oxide", "Fe2O3": "iron(III) oxide",
 "Fe3O4": "iron oxide", "SiO2": "silicon dioxide", "TiO2": "titanium dioxide",
 "MnO2": "manganese dioxide", "PbO": "lead monoxide", "PbO2": "lead dioxide",
 "HgO": "mercury oxide", "CaC2": "calcium carbide", "Ca3(PO4)2": "calcium phosphate",
 "CaSO4": "calcium sulfate", "BaSO4": "barium sulfate", "BaCl2": "barium chloride",
 "Ba(NO3)2": "barium nitrate", "Sr(NO3)2": "strontium nitrate", "ZnSO4": "zinc sulfate",
 "ZnCl2": "zinc chloride", "MgSO4": "magnesium sulfate", "MgCl2": "magnesium chloride",
 "Mg(NO3)2": "magnesium nitrate", "Al2(SO4)3": "aluminum sulfate",
 "AlCl3": "aluminum chloride", "KAl(SO4)2": "potassium aluminum sulfate",
 "Na3AlF6": "cryolite", "PbI2": "lead diiodide", "PbCl2": "lead dichloride",
 "PbS": "lead sulfide", "PbCrO4": "lead chromate", "PbSO4": "lead sulfate",
 "AgCl": "silver chloride", "AgBr": "silver bromide", "AgI": "silver iodide",
 "Ag2CrO4": "silver chromate", "Ag2O": "silver oxide", "Ag2S": "silver sulfide",
 "Hg2Cl2": "mercury chloride", "HgCl2": "mercury(II) chloride", "CdS": "cadmium sulfide",
 "ZnS": "zinc sulfide", "CuS": "copper monosulfide", "FeS": "iron sulfide",
 "CuCl2": "copper chloride", "Cu(NO3)2": "copper nitrate", "Cu2O": "copper(I) oxide",
 "Cu(OH)2": "copper hydroxide", "FeSO4": "iron(II) sulfate", "Fe2(SO4)3": "ferric sulfate",
 "Fe(NO3)3": "iron(III) nitrate", "Fe(OH)3": "ferric hydroxide", "Fe(OH)2": "ferrous hydroxide",
 "NiSO4": "nickel sulfate", "NiCl2": "nickel chloride", "CoCl2": "cobalt chloride",
 "CoSO4": "cobalt sulfate", "SnCl2": "tin(II) chloride", "Bi(NO3)3": "bismuth nitrate",
 "Na2SiO3": "sodium silicate", "Na2B4O7": "sodium tetraborate", "K4Fe(CN)6": "potassium ferrocyanide",
 "K3Fe(CN)6": "potassium ferricyanide", "K2SO4": "potassium sulfate", "Na2S": "sodium sulfide",
 "Na3PO4": "sodium phosphate", "Na2HPO4": "disodium hydrogen phosphate",
 "NaH2PO4": "sodium dihydrogen phosphate", "NaAc": "sodium acetate", "CH3COONa": "sodium acetate",
 "C2H3NaO2": "sodium acetate", "HCONH2": "formamide", "CH4N2O": "urea",
 "CH3OH": "methanol", "C2H6O": "ethanol", "C3H6O": "acetone", "C4H10O": "diethyl ether",
 "C2H4O2": "acetic acid", "C2H4O": "acetaldehyde", "CH2O": "formaldehyde",
 "C6H12O6": "glucose", "C12H22O11": "sucrose", "C3H8O3": "glycerol", "C2H6O2": "ethylene glycol",
 "C6H6": "benzene", "C7H8": "toluene", "C8H10": "xylene", "C6H14": "hexane",
 "C6H12": "cyclohexane", "C5H12": "pentane", "C2H5Cl": "chloroethane",
 "C2H6S": "dimethyl sulfide", "CH3NO2": "nitromethane", "CS2": "carbon disulfide",
 "CH3I": "iodomethane", "C2H5I": "iodoethane", "C4H9Br": "1-bromobutane",
 "C3H6O2": "methyl acetate", "C4H8O2": "ethyl acetate", "C6H5NO2": "nitrobenzene",
 "C6H7N": "aniline", "C6H5NH2": "aniline", "C6H4Br2": "dibromobenzene",
 "C2H4Br2": "1,2-dibromoethane", "C2H4Cl2": "1,2-dichloroethane", "CCl3CHO": "chloral",
 "C6H10": "cyclohexene", "C2H4": "ethylene", "C2H2": "acetylene", "C3H6": "propene",
 "C4H10": "butane", "C3H8": "propane", "C4H8": "butene", "C6H5Cl": "chlorobenzene",
 "C6H5Br": "bromobenzene", "C6H5OH": "phenol", "C6H5CHO": "benzaldehyde",
 "C6H5CH3": "toluene", "C10H8": "naphthalene", "C14H10": "anthracene",
 "C12H10": "biphenyl", "C3H6O3": "lactic acid", "C4H6O2": "vinyl acetate",
 "C4H6O4": "succinic acid", "C4H6O6": "tartaric acid", "C6H8O6": "ascorbic acid",
 "C6H8O7": "citric acid", "C7H6O2": "benzoic acid", "C7H6O3": "salicylic acid",
 "C8H8O3": "vanillin", "C9H8O4": "aspirin", "C4H8O": "methyl ethyl ketone",
 "C5H10O2": "pentanoic acid", "C4H8O2": "butyric acid", "C2H6": "ethane",
 "C2H6S": "ethanethiol", "CH3SH": "methanethiol", "CHCl3": "chloroform",
 "C2H5OC2H5": "diethyl ether", "CH3COCH3": "acetone", "CH3COOC2H5": "ethyl acetate",
 "CH3COCH2COOC2H5": "ethyl acetoacetate", "C6H12O6": "glucose",
 "CO(NH2)2": "urea", "CH3CONH2": "acetamide", "C2H5NO2": "glycine",
 "C3H7NO2": "alanine", "C18H35NaO2": "sodium stearate", "(C6H10O5)n": "starch",
 "C2H5OH": "ethanol", "CH3CH2OH": "ethanol",
}
METAL_NAME = {
 "Li": "lithium", "Na": "sodium", "K": "potassium", "Rb": "rubidium", "Cs": "caesium",
 "Mg": "magnesium", "Ca": "calcium", "Sr": "strontium", "Ba": "barium", "Ra": "radium",
 "Al": "aluminum", "Ga": "gallium", "In": "indium", "Tl": "thallium", "Sn": "tin",
 "Pb": "lead", "Bi": "bismuth", "Cu": "copper", "Ag": "silver", "Au": "gold",
 "Zn": "zinc", "Cd": "cadmium", "Hg": "mercury", "Fe": "iron", "Co": "cobalt",
 "Ni": "nickel", "Mn": "manganese", "Cr": "chromium", "Mo": "molybdenum", "W": "tungsten",
 "V": "vanadium", "Ti": "titanium", "Zr": "zirconium", "Hf": "hafnium", "Ta": "tantalum",
 "Nb": "niobium", "Re": "rhenium", "Os": "osmium", "Ir": "iridium", "Pt": "platinum",
 "Pd": "palladium", "Ru": "ruthenium", "Rh": "rhodium", "U": "uranium", "Th": "thorium",
 "Ce": "cerium", "La": "lanthanum", "Nd": "neodymium", "Sm": "samarium", "Y": "yttrium",
 "As": "arsenic", "Sb": "antimony", "Se": "selenium", "Te": "tellurium", "Si": "silicon",
 "Ge": "germanium", "B": "boron", "P": "phosphorus", "S": "sulfur", "C": "carbon",
 "Be": "beryllium", "Sc": "scandium", "W ": "tungsten",
}
STOCK_OPTIONAL = {"Na", "K", "Rb", "Cs", "Mg", "Ca", "Sr", "Ba", "Al", "Zn", "Cd",
                 "Ag", "Li", "Be", "Sc", "Y", "Ga", "In", "Sr"}
PREFIX = {1: "mono", 2: "di", 3: "tri", 4: "tetra", 5: "penta", 6: "hexa",
          7: "hepta", 8: "octa", 9: "nona", 10: "deca"}


def name_from_formula(f):
    """Best-effort common name for a formula; None when not derivable."""
    if not f:
        return None
    base = re.sub(r"\.\s*\d*\s*H2O.*$", "", f.strip())
    base = re.sub(r"[2-9]?\+|\-$", "", base).strip()
    if base in OVERRIDE:
        return OVERRIDE[base]
    if f in OVERRIDE:
        return OVERRIDE[f]
    m = re.match(r"^([A-Z][a-z]?)(\d*)(.+)$", base)
    if not m:
        return None
    cat, ccount, rest = m.group(1), int(m.group(2) or 1), m.group(3)
    if cat not in METAL_NAME or rest not in ANIONS:
        return None
    aname, acharge = ANIONS[rest]
    an = re.match(r".*(\d*)$", rest).group(1)
    n_anion = int(an) if an else 1
    total_neg = acharge * n_anion
    charge = round(-total_neg / ccount) if ccount else 0
    if cat == "H":
        return None
    name = METAL_NAME[cat]
    if charge not in (0, None) and cat not in STOCK_OPTIONAL:
        name += f"({charge if charge > 0 else ''})"
    n = re.match(r"^[A-Z][a-z]?(\d*)$", rest)
    rep = ""
    if n and int(n.group(1) or 1) > 1 and aname not in ANIONS:
        rep = PREFIX.get(int(n.group(1) or 1), "")
    out = f"{name} {rep}{aname}"
    mm = re.search(r"\.(\d*)\s*H2O", f)
    if mm:
        k = int(mm.group(1) or 1)
        out += " " + (PREFIX.get(k, str(k)) if k <= 10 else str(k)) + "hydrate"
    return out


def candidate_names(species_id, curated_name, formula):
    """ordered search queries for PubChem, plus a marker of how confident each is"""
    cands, seen = [], set()

    def add(x):
        x = (x or "").strip()
        if x and x.lower() not in seen:
            seen.add(x.lower())
            cands.append(x)
    add(name_from_formula(formula))
    # parenthetical common name:  'Ethanedioic (oxalic) acid dihydrate' -> 'oxalic acid'
    for m in re.finditer(r"\(([^)]+)\)", curated_name or ""):
        inner = m.group(1)
        if re.match(r"^[a-z]", inner) and len(inner) > 2:
            add(inner if "acid" in curated_name.lower() else inner)
    add(re.sub(r"\s*\([^)]*\)", "", curated_name or ""))
    add(curated_name)
    # a few manual corrections where English-vs-US spelling defeats PubChem
    for c in list(cands):
        alt = (c.replace("sulph", "sul").replace("aluminium", "aluminum")
                .replace("caesium", "cesium").replace("orthophosphoric", "phosphoric"))
        add(alt)
    return cands
