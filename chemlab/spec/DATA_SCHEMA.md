# DATA_SCHEMA — what is in `data/chemlab.json` and `data/chemlab.db`

Rebuild everything with:

```bash
python3 scripts/normalize_reactions.py     # repairs + re-balances the reaction files
python3 scripts/build_warehouse.py         # -> data/chemlab.json, chemlab.db, DATA_REPORT.md
python3 scripts/validate_warehouse.py      # 13 independent re-derivations, must be 13 passed
python3 scripts/test_chem.py               # 45 kernel tests
```

The JSON is the app-facing form (one file, `ensure_ascii=False`, index-safe ordering).
The SQLite file has the same rows normalised into tables for a phone that wants to query
rather than load 7.6 MB. Both are generated — never edit either by hand; edit
`data_curated/*.py` and rebuild.

## The one rule every number obeys

```jsonc
{ "value": 1.8e-10,
  "units": "(mol/L)^n",
  "source": "CRC",              // where it came from
  "ref_id": 962,                // PubChem CID if it came from PubChem, else null
  "confidence": "high" }        // high | med | approx | annotation | missing
```

and, if `value` is `null`, there is always a `missing` or `note` key saying why. A field
that is absent means "this dataset does not speak to it"; a field that is `null` means
"we know there should be a number and we did not have one". The app should render the
second as "no data" and never as `0`.

## Top level

| key | what it is |
|---|---|
| `meta` | counts, licences, and the conventions the rest of the file assumes |
| `elements` | 118 rows, one per element: ~40 properties each, all cited, plus the links to what this dataset holds for that element |
| `species` | 581 records: what is on the shelf — 491 substance rows (404 curated + 87 generated from the periodic table), 53 derived aqueous ions, 19 mixtures, 10 aliases, 2 polymers, 6 note rows |
| `reactions` | 424 records: what happens when you mix things |
| `tables` | the numeric reference layer (Ksp, pKa, E0, ΔfH, glassware, techniques…) |
| `lab` | how a lab behaves: bottles, indicators, analysis trees, GHS, waste, emergencies, curriculum |
| `derived` | tables the build *computed*: displacement predictions, Ksp→solubility, weak-acid pH |
| `tables.precipitation_matrix` | every cation–anion pair the shelf can supply, and what it gives (see COMBINATORICS.md §6) |
| — `data/combinations.json.gz` | **a sidecar, not inside this file**: every pair of elements and what their valences allow (COMBINATORICS.md §4–5) |
| `safety_index` | the lists the guard reads: hard-stopped / restricted / hood / hazard-5 |
| `index` | colour map, formula→species ids, category counts, gas tests |
| `combinations_note` | one sentence pointing at the sidecar, so a reader of the JSON alone knows the 9410 combination rows exist |

## `elements[]` — 118 rows, one per element

The periodic table screen reads this and nothing else. 60 keys on a normal row; `number`,
`symbol`, `name`, `category`, `phase_at_298K`, `group`, `period`, `block` are plain, and
**every other numeric field is the usual `{value, units, source, ref_id, confidence}` object**.
Coverage is of 118 elements, and a missing value is a `null` with `missing`, never a guess:

| field | present | notes |
|---|---|---|
| `atomic_mass` + `mass_uncertainty` | 118 / 74 | u; CIAAW. Bracketed mass numbers (Tc [98]) are `confidence: "approx"` and keep `isotopic_mass_u` beside them |
| `density` `cas` `summary` `phase_at_298K` `established` | 118 | g/cm^3; `colour_hex` on 109 |
| `mel_point` `boil_point` | 109 / 107 | **degC**, with `kelvin` beside each; `is_sublimation` and `boil_below_melt_note` where the source's "boiling point" is below the melting point |
| `uses` `occurrence` `name_origin` `discovered_by` `appearance` | 112 / 118 / 118 / 118 / 86 | prose; `discovery_year` on 105 |
| `ionisation_kJ_mol` | 104 | the series, kJ/mol, as a list: 1st IE first; this source stops at the 6th |
| `oxidation_states_main` / `_extended` / `_observed` | 100 / 105 / 43 | cited table / wider list / what **this** dataset's species actually show (COMBINATORICS §3) — the 43 is the honest one: only 43 elements appear in this warehouse in a state the rule set can assign |
| `ionic_radii` | 98 | Shannon, per charge + coordination + spin, pm |
| `abundance_crust_ppm` / `abundance_sea_mg_L` | 88 / 81 | mg/kg and mg/L as published |
| `electronegativity_pauling` / `_allen` | 85 / 71 | both scales, never averaged |
| `heat_capacity_molar` / `_specific` | 85 | J/mol/K and J/g/K |
| `lattice_structure` / `lattice_constant` | 91 | angstrom |
| `electron_affinity` | 77 | eV |
| `thermal_conductivity` | 66 | W/m/K |
| `critical_temp` / `triple_point` | 31 / 17 | K, where the source has them |
| `isotopes_natural` + `isotopes_stable_count` | 84 | mass, abundance %, uncertainty, spin |
| `dataset` | 118 | `species_ids`, `reaction_ids`, counts, `weighable` — what this warehouse holds for the element |
| `values_are_predicted` `prediction_note` `longest_lived_isotope` | 19 | only the elements nobody has made in bulk; every field on those rows is `measured: false`, `confidence: "approx"` |

`phase_at_298K`, `radioactive`, `monoisotopic`, `not_a_shelf_reagent`, `established` and
`colour_hex` are plain flags/strings. The kelvin bookkeeping note (`kelvin_note`) is on every
row that has a temperature, because the sources quote kelvin.

## `species[]`

```jsonc
{ "id": "cuso4aq",
  "name": "Copper(II) sulphate solution",
  "formula_written": "CuSO4",              // exactly as curated
  "formula": "CuO4S",                      // Hill, computed
  "kind": "species",                        // species | aqueous_ion | mixture | alias | polymer | note
  "state": "aq",                            // s l g aq v  (null = not curated)
  "colour": "sky-blue",                     // the curated phrase, kept verbatim
  "colour_hex": "#4FA8D8",                  // the one colour the renderer uses
  "colour_resolved_from": "sky",            // when the phrase had to be simplified
  "molar_mass": { … },                      // computed by the kernel, never typed
  "elements": { "Cu": 1, "O": 4, "S": 1 },
  "props_mp": {…}, "props_bp": {…}, "props_den": {…}, "props_sol": {…|text},
  "props_ka": { "values": [4.2], "units": "pKa units", … },
  "oxidation_states": { "Cu": [2], "S": [6], "O": [-2], "H": [1] },   // assigned by the
  "oxidation_states_basis": "polyatomic group SO4 (charge -2) consumed 1",   // kernel, §3
  "oxidation_states_unresolved": ["Fe"],                               // mixed valence etc.
  "oxidation_states_missing": "the rules leave more than one element free…",
  "from_element": "Ti",                       // only on the 87 bottles generated from the
                                              // periodic table: this is the element itself
  "heat_capacity_molar": {…}, "fusion_heat": {…}, "vapourisation_heat": {…},   // same 87
  "availability": "not a shelf reagent: radioactive, no quantities in this lab",
  "equation_form": "S", "equation_form_note": "sulfur is written S in equations",
  "cas": "7758-99-8",
  "cas_provenance": {…} | "cas_conflict": { "curated": …, "pubchem": [ … ] },
  "hazard_score": 2,                        // 0-5 curated, the guard's first look
  "ion": "Cu2+",                            // the ion it releases in water
  "flame": "green", "hygro": true, "vol": true, "odour": "…",
  "stock": "…", "forms": ["…"], "reacts": ["…"], "ind": {…},
  "ghs": { "signal_word": "Warning", "pictograms": ["GHS07"],
           "h_codes": [ { "code": "H302", "text": "…", "text_authoritative": "…",
                          "cat": "Acute toxicity 4" } ],
           "p_codes": ["P264","P270","P301+P312+P330"],
           "hazard_classes": […], "nfpa": { "health": 1, "fire": 0, "instability": 0 },
           "source": "PubChem GHS (Reg. EC 1272/2008, ECHA, NITE)" },
  "pubchem": { "cid": 24463, "cid_verified": true, "smiles": "…", "inchikey": "…",
               "mw_pubchem": "…", "xlogp": 0, "tpsa": …, "exact_mass": "…",
               "mp_candidates": [ { "value": 110, "raw": "110 °C (dehydration)",
                                    "units": "degC", "source": "CRC …", "confidence": "annotation" } ],
               "Solubility": [ { "text": "…", "ref": 68, "source": "CRC Handbook" } ], … },
  "note": "…"                               // the curated teaching/safety sentence
}
```

`kind: "mixture"` rows (petroleum ether, litmus, soda lime, brass, cement) are real shelf
items with no single formula: `formula` is null, `molar_mass` is null, and the app must not
offer them for stoichiometry — only for the demonstration they belong to.

Element bottles (`from_element` set) carry nothing the element record does not already
have: the formula of the standard state, the element's own cited mp/bp/density/heat
capacities, and a computed molar mass. They have no colour, no GHS block and no hazard
score, which routes them through the guard's *unknown hazard* path rather than making them
look safe. A radioactive or unobtainable element's bottle carries
`not_a_shelf_reagent: true` and `shelf_block_reason` (37 of the 87 do), with the same fact in
prose in `availability` — the shelf screen filters on the flag, never on the sentence, and no
record is ever deleted to keep it off the bench.

`kind: "aqueous_ion"` rows (`ion:H(+1)`, `ion:Cr2O7(-2)`, …) were **created by the build**
because the net-ionic equations need them. They carry charge, computed mass (electron mass
ignored, as the handbooks do) and, where curated, ΔfH of the aqueous ion. They are flagged
`derived_record: true`.

## `reactions[]`

```jsonc
{ "id": "redox_fe2_kmno4",
  "name": "…", "categories": ["redox","titration","pinned"],
  "record_type": "equation",                 // or "process"
  "equation": "2 KMnO4 + 10 FeSO4 + 8 H2SO4 -> …",   // the string to display
  "reactants": [ { "coefficient": 2, "token": "KMnO4", "phase": null, "solvent": null,
                   "species_id": "kmno4", "formula": "KMnO4", "moles": 2,
                   "molar_mass": 158.032, "grams_per_mol_rxn": 316.064,
                   "dHf_kJ_mol": -837.0, "dHf_phase_note": "curated dHf, s phase",
                   "display_name": "Potassium permanganate" } ],
  "products": [ … ],
  "balance_check": { "atoms_ok": true, "charge": [8, 8], "elements": {…}, "problems": [] },
  "solver": { "coefficients": {…}, "curated": {…}, "agrees_with_curated": true,
              "basis_ratio_vs_smallest_integers": null, "pinned": true },
  "thermo_derived": { "dH_rxn": {…}, "per": "one mole of reaction as written",
                      "missing_terms": [ { "token": "…", "reason": "…" } ],
                      "cross_check": { "curated": -57.3, "derived": -56.79,
                                       "comparison_basis": "per mole of H2O",
                                       "abs_diff_kJ": 0.51, "verdict": "agree" } },
  "thermo_curated": { "dH": {…}, "yield": … },
  "electrochem": { "E0_cell_V": {…}, "n_electrons": 1, "dG_kJ_mol": {…}, "logK_25C": {…} },
  "equilibrium": { "K": {…}, "logK": {…}, "Kc": {…}, "P": {…} },
  "kinetics": { "T": 25, "time": "30 s", "cat": "Mn2+", "light": "daylight" },
  "observations": [ { "code": "p", "kind": "precipitate", "text": "white curd" },
                    { "code": "c", "kind": "colour_change", "from": "purple", "to": "colourless", … } ],
  "appears": { "gases": ["CO2"], "precipitates": [], "colour_change": ["purple","colourless"] },
  "safety": { "danger_score": 3, "controls": ["fume-hood"], "max_scale": "5 mL",
              "apparatus": ["burette_50","conical_250"], "materials": ["pH-10-buffer"],
              "unregistered_apparatus": [], "blocked": false },
  "tags": ["cbse12"], "reference": { "app": […], "scale": …, "ion": "Fe2+" },
  "teaching_note": "…", "extras_raw": "T= dH= danger= …" }
```

`record_type: "process"` is the honest form for anything the equation model cannot express
(rusting, fractional distillation, a group-separation scheme, an industrial train). It has
`reactants`/`products` as written, `observations`, `safety`, and **no** `equation`,
`balance_check` or `thermo_derived`. If the app is asked to compute yield on a process
record it must say the record is descriptive, not invent an equation to balance.

`categories` flags that matter to code: `pinned` (coefficients are curated, verified by
hand — still atom-and-charge-checked), `process`, `blocked-by-safety` (see
`safety_index.reactions_hard_stopped`), and everything else is a subject tag for browsing.

## `tables` — the reference layer

| key | shape | the engine uses it for |
|---|---|---|
| `ksp` | `{ "AgCl": {Ksp, dissolution_equation, ion_product_of} }` | precipitation Q, and the solubility the app quotes |
| `pka` / `pkb` | `{ "H2CO3": {pKa_values:[6.35,10.33], note, …} }` | pH, buffers, which indicator works |
| `kw` | temperature → value | everything near neutral, and the "Kw is 1e-14 only at 25 °C" lesson |
| `e0` | couple → V | EMF, the displacement rule, oxidising strength |
| `beta` | complex → logβ | complexometry, why NH3 dissolves AgCl, masking |
| `thermo` / `thermo_ion` | substance → per-phase ΔfH/S/Cp | ΔH of reaction, and the heat a beaker feels |
| `dh_solution` | substance → kJ/mol | why NH4NO3 cools and NaOH heats |
| `flame` / `ion_colour` / `colour_map` | appearance | rendering, never guessing a shade |
| `aqueous_tension_mmhg`, `water_density`, `vapour_pressure_kpa` | T → value | any gas collected over water |
| `constants` | R, F, N_A, molar volumes at 4 conventions, Cp/Lf/Lv | the arithmetic, with the convention named |
| `glassware` / `apparatus` | capacity, graduation, tolerance, kind, note | "how precisely can this be measured" and what to draw |
| `techniques` | goal, steps, apparatus, physics, error model | the procedure text and its realistic uncertainty |
| `solubility_rules`, `acid_strength_order`, `activity_series` | ordered lists | quick qualitative calls, with the numbers behind them |
| `naming` | anion/metal/prefix tables | naming a formula the user typed |

## `tables.precipitation_matrix` — 380 rows, keyed `"ion:Ag(+1)|ion:SO4(-2)"`

What happens when two solutions meet. The key is the two **record ids** of the ions, joined by
`|` — never the display text (MnO4− and MnO42− collide on text). Rules and reasoning:
COMBINATORICS §6; this is the field list.

| field | on which rows |
|---|---|
| `cation` `anion` `cation_id` `anion_id` | always — display text and the ids the key is made of |
| `product` `product_hill` `coefficients` `molar_mass` | always — the neutral salt from the criss-cross, but written as the dataset writes it when the substance is on record (`H2O`, not `HOH`) |
| `outcome` | `precipitate` (135) · `no visible change` (172) · `acid on the salt of a weak acid` (12) · `no acid-base reaction` (4) · `neutralisation` (1) · `ammonia released` (1) · `null` (55) |
| `basis` | `measured Ksp` (50) · `solubility rule` (256) · `pKa table` (17) · `pKa of NH4+ (tables.pka)` (1) · `ionic product of water, tables.kw` (1) · `null` (55) |
| `ksp` `ksp_key` `dissolution_equation` `solubility_mol_L` `solubility_g_L` | Ksp rows only; the two solubilities are computed, with the formula in the `source` string |
| `rule` | rule rows only: the verdict, `rule.statement` to quote, and which cations the exception list covers |
| `conjugate_acid` `pKa_of_conjugate_acid` `gas` `odour` | acid–base rows; `odour` only where the product's own record has one |
| `no_reaction` | the conjugate acid is strong (pKa < 0), so the pair stays dissociated; `net_ionic` is null with `net_ionic_note` |
| `partial_protonation` | strong first proton, weak second (H2SO4): no single net ionic equation is true at every dilution |
| `species_id` `product_name` `colour` `colour_hex` `product_solubility_on_record` | only when the product is a substance in this dataset **and** the row precipitates; `product_in_dataset` says which |
| `colour_note` | 97 rows: the salt is not described anywhere, so the app must say "a solid appears" and show no colour |
| `net_ionic` | every decided row except the two "no equation" cases above; phases are `(s) (l) (g) (aq)` |
| `why` `net_ionic_note` | the 55 undecided rows — no Ksp, no rule, no pKa entry speaks of this pair |

Confidence is the Ksp's own on measured rows and `"med"` on rule rows, always with the rule
text attached, so a rule can never be rendered like a measurement.

## `derived` — computed, not copied

- `displacement.predictions`: 703 metal pairs from `tables.e0`; each carries the EMF,
  whether it is spontaneous, and the two couples it was computed from. The "activity
  series" the app draws is **this**, sorted — not a mnemonic.
- `solubility.entries`: for every Ksp, the dissolution equation re-parsed, molar
  solubility and g/L. The note on it is part of the data: hydrolysis is ignored, so
  sulphide/carbonate/hydroxide solubilities are under-estimates in real water.
- `weak_acid_ph.entries`: pH of 0.1 M for every pKa, from the quadratic (not the
  `√(Ka·c)` shortcut), so the app can show where the shortcut breaks.

## `lab` — behaviour, not chemistry

`stock_bottles` (what the label says and why a "1 M from concentrate" is only 1 M to 2 %),
`indicators` (ranges + both hex colours + the trap), `paper_tests`, `cation_scheme`
(group 0-VI with the Ksp reason for each separation and the classic mistake),
`anion_scheme`, `organic_tests`, `ghs` (pictogram names, H/P wording), `mixing_rules`,
`refusals`, `waste_classes`, `storage_rules`, `emergency`, `curriculum`, `troubleshooting`,
`kits`.

## SQLite map

`meta · element(+json blob) · isotope · species(+json blob) · prop · h_code · p_code ·
reaction(+json blob) · term · observation · ksp · pka · e0 · thermo · displacement ·
indicator · mixing_rule · refusal · glassware · technique · curriculum · kit ·
combination(+json blob) · precip(+json blob)`

`combination` (9410 rows) is the element-pair table from `data/combinations.json.gz`; index
`ix_comb(elements, hill)` answers "what can these two make" in one lookup. `precip` (380
rows) is the ion-pair table; `ix_precip(cation, anion)` is the lookup the mixing screen uses
before it falls back to the rules in `lab.mixing_rules`.

`species.json` and `reaction.json` carry the full record, so a query can be cheap and a
detail screen can still be complete. The build asserts the columns agree with the
blobs (`validate_warehouse.py::db`), that the periodic layer is self-consistent
(`::periodic layer`), that every combination row's algebra re-derives (`::combinations`) and
that every solubility decision can be recomputed from its Ksp (`::precipitation matrix`).
