# COMBINATORICS.md — picking any element, mixing anything, and staying honest

The question this layer answers: *can the app open the periodic table, let you pick two
things, and show everything it knows — including when it knows almost nothing?*

Four data structures carry it, and the rules below say exactly what each one is, how it
was produced, and what the interface may and may not say about it.

| what | where | size (as built) |
|---|---|---|
| an element record with every property the cited tables give | `elements[]`, table `element` | 118 records, ~40 fields each |
| a shelf bottle for every element that had none | `species[]` rows with `from_element` | 87 generated |
| every element pair and what their valences allow | `data/combinations.json.gz`, table `combination` | 9410 rows over 6903 pairs |
| every cation/anion pair of the ions this shelf can supply | `tables.precipitation_matrix`, table `precip` | 380 rows |

Everything here is either **copied with a citation** or **computed by `scripts/lib/chem.py`**.
There is no fourth category and there must never be one.

---

## 1. The element record

One row per element, Z = 1…118. Hypothetical rows in the raw source (element 119) are
excluded and the exclusion is logged as a build warning, because an app that offers
ununennium on a shelf is a lie.

Fields, and the only reading that is correct for each:

```jsonc
{
  "number": 26, "symbol": "Fe", "name": "Iron",
  "atomic_mass": {
    "value": 55.845, "units": "u",
    "source": "Meija et al., Pure Appl. Chem. 88 (2016); IUPAC CIAAW atomic weights via mendeleev 1.3.0 (MIT), data as cited below",
    "ref_id": null, "confidence": "high"
  },
  "mass_uncertainty": { "value": 0.002, "units": "u", "source": "…", "confidence": "high" },
  "mel_point": { "value": 1538.0, "units": "degC", "kelvin": 1811.15, "source": "phase-transition table, …", "confidence": "high" },
  "boil_point": { "value": 2861.0, "units": "degC", "kelvin": 3134.15, "source": "…", "confidence": "high" },
  "density":   { "value": 7.87, "units": "g/cm^3", "source": "CRC Handbook 95th ed. (Haynes 2014); enwiki:1039678864 via …", "confidence": "high" },
  "heat_capacity_molar":      { "value": 25.1,   "units": "J/mol/K", "source": "…", "confidence": "high" },
  "heat_capacity_specific":   { "value": 0.449,  "units": "J/g/K",   "source": "…", "confidence": "high" },
  "fusion_heat_kJ_mol":       { "value": 13.8,   "units": "kJ/mol",  "source": "…", "confidence": "high" },
  "vaporisation_heat_kJ_mol": { "value": 340.0,  "units": "kJ/mol",  "source": "…", "confidence": "high" },
  "thermal_conductivity":     { "value": 80.4,   "units": "W/m/K",   "source": "…", "confidence": "high" },
  "electronegativity_pauling": { "value": 1.83, "units": "Pauling scale", "source": "…", "confidence": "high" },
  "electronegativity_allen":   { "value": 10.64, "units": "eV", "source": "Mann et al. …", "confidence": "high" },
  "electron_affinity": { "value": 0.151, "units": "eV", "source": "…", "confidence": "high" },
  "ionisation_kJ_mol": [762.5, 1561.9, 2957, 5290, 7240, 9560],
  "atomic_radius_pm": 140.0, "covalent_radius_pm": { "value": 142.0, "units": "pm", "source": "Cordero et al., Dalton Trans. (2008) …" },
  "metallic_radius_pm": { "value": 117.0 }, "vdw_radius_pm": { "value": 204.0 },
  "polarisability_bohr3": { "value": 62.0, "units": "bohr^3" },
  "lattice_structure": "BCC", "lattice_constant": { "value": 2.87, "units": "angstrom" },
  "group": 8, "period": 4, "block": "d", "category": "transition metal",
  "phase_at_298K": "Solid", "electron_configuration": "1s2 2s2 2p6 3s2 3p6 4s2 3d6",
  "shells": [2, 8, 14, 2],
  "oxidation_states_main": [2, 3],
  "oxidation_states_extended": [-4, -2, -1, 0, 1, 4, 5, 6, 7],
  "oxidation_states_observed": [0, 2, 3, 4],
  "oxidation_states_provenance": "oxidation-state table, mendeleev 1.3.0 (MIT) …; 'main' are the states the source lists as common",
  "ionic_radii": [
    { "charge": 2, "coordination": "VI", "spin": "HS", "radius_pm": 78.0,
      "crystal_radius_pm": 92.0, "source": "Shannon 1976 via …", "confidence": "high" },
    { "charge": 3, "coordination": "VI", "spin": "HS", "radius_pm": 64.5,
      "crystal_radius_pm": 78.5, "source": "Shannon 1976 via …", "confidence": "high" }
  ],
  "isotopes_natural": [
    { "mass_number": 54, "mass_u": 53.939608189, "abundance_percent": 5.845,
      "abundance_uncertainty": 0.105, "spin": "0", "source": "IUPAC/CIAAW via …", "confidence": "high" }
  ],
  "isotopes_stable_count": 4,
  "radioactive": false, "monoisotopic": false,
  "not_a_shelf_reagent": false,
  "cas": "7439-89-6",
  "appearance": "lustrous metallic with a grayish tinge",
  "colour_hex": "#e06633",
  "summary": "Iron is a chemical element with symbol Fe …",
  "name_origin": "Anglo-Saxon: iron; symbol from Latin: ferrum",
  "occurrence": "Obtained from iron ores. …", "uses": "Used in steel and other alloys. …",
  "discovered_by": "Known to the ancients.", "discovery_year": null,
  "abundance_crust_ppm": { "value": 56300.0, "units": "ppm", "source": "CRC …", "confidence": "high" },
  "abundance_sea_mg_L":  { "value": 0.002, "units": "mg/L" },
  "kelvin_note": "temperatures below are degC; the sources quote kelvin, and the kelvin value is kept next to each conversion",
  "boil_below_melt_note": "…only on the elements that sublime at 1 atm (arsenic)",
  "dataset": { "species_ids": ["fe", "fe2o3", "…"], "species_count": 42,
               "elemental_species": ["fe", "fe_powder"], "reaction_ids": ["syn_nh3", "…"],
               "reaction_count": 18, "weighable": true, "note": "…" }
}
```

The five rules the app has to follow:

1. **Units.** Every temperature in this warehouse is **degC**; `kelvin` sits beside it
   because that is what the source printed. Never display `kelvin` as a Celsius figure —
   that bug once shipped iron melting at 1811 °C. If a value has no measurement it is
   `null` with `missing`; the element screen shows "not measured", not a dash.
2. **`approx` confidence.** An element with no stable isotope has no standard atomic
   weight: CIAAW brackets a mass number (Tc [98]), while the source table also carries the
   mass of one nuclide (97.90721 u). The record uses the bracketed whole number for
   stoichiometry — that is what the kernel weighs — and keeps the isotopic mass in
   `atomic_mass.isotopic_mass_u` with a note. Show `≈` for these.
3. **`oxidation_states_observed` is not the source's list.** It is what the 581 species in
   this dataset actually exhibit, assigned by §3 below. `oxidation_states_main` is the
   cited table. The element page may show both, labelled; it must not merge them.
4. **`values_are_predicted`** appears on the elements nobody has ever made in bulk —
   Z ≥ 100 plus the handful of short-lived ones. Those records carry `prediction_note`
   saying what they are, and every numeric field on them is `measured: false` with
   `confidence: "approx"`. `is_sublimation` is forced false there (a "boils below its melt"
   claim about an unobtainable element is a claim about nothing), and `longest_lived_isotope`
   replaces the half-life table. The app must render these as *predicted* — the validator
   rejects a superheavy record without the flag, and rejects a field on one that says
   `measured: true`. The generated shelf bottle for such an element is marked
   `not_a_shelf_reagent` with a `shelf_block_reason` (37 of the 87 generated bottles are
   blocked this way), so the bench cannot select one even though the element page can show
   it. The validator fails the build when the flag on a bottle and on its element row
   disagree.
5. **`not_a_shelf_reagent`** (and `radioactive`) means: information yes, bottle no. The
   periodic screen opens, the properties are there, and the "add to bench" control is
   absent, with the reason in the same place.

## 2. The shelf record for an element

The build generates `elem_<symbol>` for every element that had no species at all (87 of
them), so that "pick titanium" is not an empty screen:

- `formula` is the standard state: the symbol for metals and network solids, `H2 N2 O2
  F2 Cl2 Br2 I2` for the diatomic elements, `S8` and `P4` for sulfur and phosphorus
  (with `equation_form: "S"` / `"P"` and the note that equations write them that way),
  and the bare symbol for the noble gases;
- `molar_mass` is computed — for an element that is the atomic weight times the atoms in
  the molecule, and `uncertainty_u` propagates the CIAAW uncertainty;
- a bottle for a radioactive or unobtainable element carries `not_a_shelf_reagent: true` and
  `shelf_block_reason` (plus prose in `availability`): the shelf screen filters on the flag,
  never on the sentence. 37 of the 87 generated records are blocked this way, and the
  validator fails the build if the flag on the bottle and on the element row disagree;
- `props_mp`, `props_bp`, `props_den`, `heat_capacity_molar`, `fusion_heat`,
  `vapourisation_heat` are **copied from the element record**, with its citation.
  A generated bottle has no new data in it at all; it is the element's own numbers
  reachable from the shelf;
- `colour` is `null` with `colour_missing`: the sources describe metals in words, so no
  hex is invented;
- gases get `vol: "gas"`; nothing gets a GHS block it does not have, so these records go
  through the guard's *unknown hazard* path in SAFETY.md rather than appearing safe.

Coverage rule: if a curated record for the element already exists (iron, sulfur, copper…
— 31 of them), it is used as is (31 elements already had one). The build never overrides a curated
bottle with a generated one, and warns if an id would clash.

## 3. Oxidation states, assigned not looked up

`chem.ox_states(formula, group_charges, charge=…)` returns `(states, unresolved, notes)`
where `states` maps a symbol to a **list** (a symbol can sit in two environments in one
formula). The rule set, in the order tried:

1. Nothing else is consulted first: the fixed values — F −1; group 1 +1; group 2 +2;
   Al/Ga +3; Zn/Cd +2; Ag +1; O −2 (unless F is present, which is `OF2`); H +1 unless
   every partner is a metal (hydride, −1); a halogen −1 unless the only other elements
   present are O, F or H, which keeps `Cl2O`, `HClO` and `KClO3` solvable while an
   oxychloride such as `CrO2Cl2` still reads chloride; S/Se/Te −2 against metals and H
   only.
2. Exactly one element left free ⇒ its state is whatever the balance demands
   (`Σ nᵢxᵢ = charge on the particle`). It must come out an integer.
3. If no free element remains, the fixed values are *verified* against the balance; a
   disagreement is a failure, not a rounding issue.
4. If that fails, `O = −1` (peroxide) and then `O = −½` (superoxide) are tried, and the
   note records which convention the answer needed.
5. Only if the formula still does not close are polyatomic ions consumed as charged
   units, from `group_charges` — derived from the aqueous-ion records and the
   `thermo_ion` keys, not typed in. This is what makes the flat `CuSO4` read Cu +2 / S +6.
6. A formula that *writes* its groups — `(NH4)(NO3)` — is read through the groups first,
   which is why it yields N at −3 **and** +5, while the flat `NH4NO3` yields +1, the
   average. That difference is the honest answer: the written formula is all the evidence
   there is. `notes` says `bracketed groups did not resolve, so the average state is given`
   when the group reading fails.

What is *not* allowed: an average presented as a single element's state where the rules
left a choice, or a value for an indeterminate case. `Fe3O4`, `Co3O4` and `Pb3O4` come back
with the metal in `unresolved` and no number, because no single state fits; the species
record then carries `oxidation_states_missing: "the rules leave more than one element free
in this formula, so no state is asserted (mixed valence, or a structure the formula does
not show)"`. Show that sentence. Do not show Fe(2.67+).

Every species with a strict formula carries `oxidation_states` (348 of 581 as built),
`oxidation_states_basis` when a convention was needed, and
`oxidation_states_unresolved` when something was left free.

## 4. Binary enumeration: what two elements can make

For every unordered pair of elements (6903 of them) the build exchanges the valences and
reduces them — the criss-cross a textbook does:

```
formula(A, B) = A  z_B/g  B  z_A/g        g = gcd(|z_A|, |z_B|)
```

with `z_A` a positive state of the more electropositive element and `z_B` the magnitude of
a negative state of the other, both taken from `oxidation_states_main`. When a side has no
main value at all, the *extended* list fills it; it is never merged in when the main list
already has something, because that is how `CH`, `H2C` and `CN4` appear as if they were
compounds. The electropositive element is written first, except for a hydride of B, C, N,
P, As, Sb, Si or Se, where the central atom is: `NH3`, `CH4`, `PH3`, `SiH4` — not `H3N`.

Each row is then classified, and the class decides what the app may show:

| `status` | how it was decided | the app shows |
|---|---|---|
| `verified` | `formula_hill` equals a species record's Hill formula | that species' measured properties, by following `species_id`; its reactions, by following `reaction_ids` |
| `empirical` | only the reduced ratio matches (P2O5 against the record for P4O10) | both formulas side by side, properties from the record, and `note` explaining the ratio |
| `predicted` | the valences allow it, and nothing in the dataset has it | formula, computed molar mass, Δχ, Pauling ionic character, and the emf chain in §5 if it exists — **and nothing else** |
| `none` | the pair gives no binary compound in this model | the `why` string, which is one of: noble gas; both metals, so an alloy has no formula to write; no valence pair that balances |

When several records share a formula the pick is deterministic and stated in the code:
the dry form (s/l/g) beats an aqueous one, then the record the reaction files actually
use, then id order. That is why `Na + Cl` gives the NaCl bottle and not the mineral note,
and `N + H` gives dry ammonia rather than ammonia solution.

`reaction_ids` is product-checked: a reaction is linked to a formula only when one of *its*
products has that Hill formula. A reaction that combines the same two elements in a
different ratio goes to `other_reactions_of_this_pair` with its own note, so `P2O3` never
claims `syn_p4o10` as its preparation.

Two properties the row may carry that are *not* measurements but are still worth showing:

- `electronegativity_difference` — `|χ_A − χ_B|` from the element records, `basis: computed`;
- `percent_ionic_character` — Pauling, `100 · (1 − e^(-(Δχ/2)²))`, `basis: rule`, with the
  note *"a rule of thumb about bonding, not a measurement"*. NaCl reads 71.2 %. The UI may
  show the percentage; it must not convert it into a label such as "ionic compound", and
  it must not be used to decide anything about safety.

## 5. The emf chain: how far the combination goes

This is the only *thermodynamic* statement the layer makes about a formula nobody has
measured, and it is only made when both binary couples exist in `tables.e0`:

```
E      = E°(B/B^z-) − E°(A^z+/A)              volts, from the curated table
n      = z_A × (number of A per formula unit) electrons per formula unit
log K  = n·E / 0.0591                          at 25 °C (the 0.0591 convention, ENGINE §0)
ΔG     = −n · 96.485 · E                       kJ per mole of product
verdict= strongly favoured  if log K >  3
         not favoured in water if log K < −3
         otherwise: "close to the boundary; conditions decide"
```

156 of the 9410 rows carry it. `Na-Cl` gives E = 4.068 V, log K ≈ 275; `Al-O` 2.063 V;
`Cu-O` for Cu2O 0.059 V, which the verdict calls a boundary case — and that is exactly the
truth a copper ore is a boundary case. Every one of those numbers must be shown with its
`couples` list so a reader can find the two E° values, and with these three caveats, which
belong in the UI, not only in a spec:

1. the potentials are **aqueous standard states**; burning sodium in chlorine is not an
   aqueous cell, so the number says "how far this would go if it could go in water", not
   "how violently the beaker behaves";
2. for oxygen the table has no `O2/O2−` couple, so the row uses `O2/OH− (base)` and says
   so in `couples`/`note` — a proxy, honestly labelled;
3. ΔG here is the free energy of **combination from the elements**, not the standard free
   energy of formation of a real substance. Never present it as `ΔfG`.

Where a couple is missing the row has `predicted_emf: null` and `why_no_verdict` naming
which element has no entry in `tables.e0`. The app must print that sentence rather than
leaving the panel blank.

## 6. Mixing two solutions: the precipitation matrix

Free play in water is decided by ions, not by elements, and that is a much smaller and a
much better-covered space. `tables.precipitation_matrix` holds 380 cation–anion pairs —
every combination of the ions this shelf actually supplies (the aqueous-ion records plus
the `thermo_ion` keys, which is where ammonium comes from). As built, **50** are decided by
a measured Ksp, **256** by a curated solubility rule, **19** by an acid–base rule read off
`tables.pka` (including Kw for H⁺ + OH⁻), and **55** say "not covered"; 135 of the 380 give
a precipitate. Decided in this order:

```
1  a measured Ksp exists for the neutral product
     -> basis "measured Ksp": the outcome, both solubilities computed from it, and the
        colour only if the substance is on record

2  H+ with OH-
     -> basis "ionic product of water, tables.kw": neutralisation, H2O(l), the heat is in
        the reaction record

3  H+ with the anion of an acid that tables.pka has an entry for
     basis "pKa table", and that entry's own numbers pick one of four answers:
       3a the acid leaves the solution as a gas (CO2, SO2, H2S, HCN, NO2)
            -> "acid on the salt of a weak acid" + `gas`: bubbling is the observation
       3b strong first proton, weak second (H2SO4, pKa -3.0 / 1.99)
            -> "no visible change" + `partial_protonation`: the hydrogen salt forms partly,
               and no single net ionic equation holds at every dilution
       3c one proton, pKa < 0 (HCl, HBr, HI, HNO3, HMnO4)
            -> "no acid-base reaction" + `no_reaction`: both ions stay dissolved
       3d anything else (acetate, oxalate, phosphate, chromate, sulfite, thiocyanate...)
            -> "acid on the salt of a weak acid": the weak acid is regenerated and stays
               dissolved; `odour` only where the product's own record states one

4  NH4+ with OH-
     -> basis "pKa of NH4+": NH3 gas, damp red litmus turns blue on warming

5  anything else
     -> basis "solubility rule", confidence "med": the curated rules decide, and the row
        quotes which statement and which cations the exception list covers

6  no Ksp, no rule and no pKa entry speaks of the pair
     -> outcome null with `why`; 55 of the 380 rows stop here rather than guess
```

A row, exactly as the build writes it (`tables.precipitation_matrix["ion:Ag(+1)|ion:SO4(-2)"]`)
— note that the key is the two record ids joined by `|`, and that there is no `key` field
inside the row:

```jsonc
{
  "cation": "Ag+", "anion": "SO42-", "cation_id": "ion:Ag(+1)", "anion_id": "ion:SO4(-2)",
  "product": "Ag2SO4", "product_hill": "Ag2O4S", "coefficients": [2, 1],
  "molar_mass": { "value": 311.796, "units": "g/mol", "source": "computed from CIAAW atomic weights",
                  "ref_id": null, "confidence": "high", "basis": "computed" },
  "outcome": "precipitate",
  "basis": "measured Ksp", "ksp_key": "Ag2SO4",
  "ksp": { "value": 1.2e-05, "units": "(mol/L)^n", "source": "CRC", "ref_id": null, "confidence": "med" },
  "dissolution_equation": "Ag2SO4 = 2Ag+ + SO4^2-",
  "solubility_mol_L": { "value": 0.0144, "units": "mol/L",
                        "source": "computed from the Ksp of Ag2SO4 via s = (Ksp/(p^p q^q))^(1/(p+q))",
                        "confidence": "high", "basis": "computed",
                        "note": "ideal dilute solution: no activity correction" },
  "solubility_g_L": { "value": 4.5, "units": "g/L", "source": "solubility(mol/L) x molar mass",
                      "confidence": "high", "basis": "computed" },
  "product_in_dataset": false,
  "colour_note": "this salt is not otherwise described in the dataset, so its colour is not known: "
                 "show 'a solid appears' and no colour, rather than the usual white",
  "net_ionic": "Ag+ + SO42- = Ag2SO4(s)"
}
```

Fields that appear on some rows only: `species_id`, `product_name`, `product_solubility_on_record`,
`colour`/`colour_hex` (on `precipitate` rows), `rule` (on rule rows), `gas` and
`conjugate_acid` (on acid–base rows), and `why` + `net_ionic` = `null` + `net_ionic_note`
(on undecided rows).


The solver's own steps, restated so an implementation matches:

```
L   = lcm(z_cat, z_an);  p = L/z_cat, q = L/z_an          coefficients of the neutral salt
Ksp = (p·s)^p (q·s)^q  ⇒  s = (Ksp / (p^p q^q))^(1/(p+q))
g/L = s · M(product)
```

Rules the app must keep:

- the matrix keys on the two ion **record ids** (`"ion:Ag(+1)|ion:SO4(-2)"`), never on the
  display text: `MnO4-` and `MnO42-` collide on text and a silent dict collision once
  dropped 18 pairs;
- a `basis: "solubility rule"` row is a rule. Its panel says *"by the solubility rules
  (all sodium…, most chlorides…)"*, quoting `rule.statement`, and it must never be
  rendered in the same style as a Ksp number. The build guarantees a rule is only
  consulted when no measurement exists for that product;
- `confidence` on rule rows is `"med"`; on Ksp rows it is the Ksp's own confidence;
- "slightly soluble" is a *cloudiness in concentrated solution only* note, not a precipitate:
  render it as `solubility rule: slightly soluble` and let the Q-vs-Ksp logic in ENGINE §2
  decide whether anything appears at the volumes actually mixed;
- rows with `outcome: null` are the honest ones: `why` says no Ksp exists and no rule
  speaks of that ion. The app shows "this pair is not covered" — the alternative is a guess
  that looks like data;
- the product is written **as the dataset writes it**: when the neutral salt is a substance
  on record, `product` copies that record's `formula_written`, so H⁺ + OH⁻ reads `H2O` and
  never the criss-cross's `HOH`. `product_hill` stays the computed Hill formula;
- `colour` / `colour_hex` appear on `precipitate` rows and nowhere else — a row that says "no
  visible change" must not be rendered with a swatch. When the salt is not described anywhere
  in the dataset the row carries `colour_note` instead (97 of the 380), and the app must then
  say *"a solid appears"* with no colour rather than assume white;
- `product_in_dataset` is true on 116 rows; on those, `species_id`, `product_name` and (for
  precipitates) `product_solubility_on_record` link the row to the full substance record, so
  the sheet a user taps is the same record the shelf shows;
- the acid–base branch reads `tables.pka` and nothing else. Finding the conjugate acid in the
  table is not the same as it being weak: **H⁺ + Cl⁻ is not "the weak acid is regenerated"**,
  so a row whose acid has pKa < 0 is `outcome: "no acid-base reaction"` with `no_reaction:
  true`; a diprotic acid with a strong first and weak second proton (H₂SO₄) is
  `partial_protonation: true`. Both leave `net_ionic` null with `net_ionic_note`, because an
  equation there would be the thing the row exists to avoid;
- the `odour` on an acid–base row is quoted from the product's own species record (1 row has
  it), and the gas rows say *waft, never inhale* — the matrix never invites a sniff;
- complexing and biochemical ions (hexacyanoferrates, diamminesilver, the iron of
  haemoglobin, EDTA, antonyl…) are deliberately **left out** of the matrix, and the build
  logs it: a solubility rule says nothing about them, and a wrong precipitate for
  `[Fe(CN)6]4-` is worse than no answer.

## 7. What the layer refuses to do

The whole design rests on saying no in the right places, and these are the noes for this
part of the data:

1. **No ternary or higher compounds are enumerated.** Elements are combined in pairs, so a
   formula like `KAl(SO4)2` is only reachable through the curated records (where it is, with
   its real properties). The combination table answers "what can these *two* elements make",
   not "what can I make". Say which question is being answered.
2. **No measured property is ever attached to a `predicted` row.** No melting point, no
   colour, no density, no GHS, no yield, no "you would see". The validator checks this by
   rejecting any predicted row that carries a `props_*` or `colour*` key.
3. **No crystal structure, hardness, or "likely state" heuristic.** A rule of the form "high
   ionic character ⇒ probably a solid" is a guess about an unmeasured substance; the layer
   carries `percent_ionic_character` and stops there.
4. **No non-stoichiometry, no alloys, no intermetallics, no phases.** `Fe0.95S`, brass,
   solder and steel are real and the dataset keeps them as `mixture` records with no molar
   mass; the combination table says "two metals: an alloy has no formula to write down".
5. **No kinetics, ever.** A favourable log K says nothing about whether the flask gets warm
   in your lifetime. Aluminium and oxygen are the classic case: `Al2O3` is `verified`, the
   emf is enormous, and the foil in the drawer is unchanged, because the reaction is
   passivated. Any time the app shows a big log K it must be able to show the
   `time=`/kinetics note from the reaction record, or say that nothing is known about speed
   (`SAFETY.md` and ENGINE §6).
6. **`none` is not "impossible".** It means the valence rules enumerate no neutral binary
   formula. Xenon fluorides exist and are outside the enumeration; the UI wording must be
   "no compound of these two is in this data", not "these two do not react".
7. **No radioactivity maths.** `isotopes_natural`, half-lives and `radioactive` are there for
   the element page; the layer never computes doses, decay heat, or shielding, and the guard
   blocks radionuclide records from the bench entirely.

## 8. Rebuilding and checking this layer only

```bash
# 1. vendor the element tables (MIT source; needs the wheel once, see raw/MANIFEST.json)
python3 scripts/vendor_mendeleev.py /tmp/mend/mendeleev-1.3.0-py3-none-any.whl
# 2. rebuild: periodic layer, generated bottles, combinations, precipitation matrix
python3 scripts/build_warehouse.py
# 3. the three checks that cover exactly this layer
python3 scripts/validate_warehouse.py   # periodic layer, combinations, precipitation matrix
python3 scripts/test_chem.py            # ox-state rules, criss-cross, ionicity
```

`validate_warehouse.py` re-derives this layer from the built files with its own arithmetic,
so a mistake in `periodic.py` cannot hide: it recomputes every formula's charge balance and
molar mass, every `s = (Ksp/(p^p q^q))^(1/(p+q))` derivation, every log K and ΔG from `n·E`,
every generated bottle's mass against the element's atomic weight, and it insists that the
6903 element pairs are each covered exactly once.
