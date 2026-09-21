# Virtual Chemistry Lab — Master Plan

Goal: a phone app where you pick reagents + apparatus and the app tells you what *actually*
happens (colour change, precipitate, gas, heat, pH, voltage, mass balance) the way a real lab would.

To do that you need **three different things**, and people usually only build the first one:

| Layer | What it is | Who does the work |
|---|---|---|
| **1. Data** | Tables of numbers: species properties, reactions, equilibria, thermodynamics, electrochemistry, glassware, hazards | This task (what I'm collecting now) |
| **2. Engine** | Rules that combine the data: balance → limiting reagent → what forms → how much → how hot → what colour | You write (I give formulas + pseudocode in `spec/`) |
| **3. UI** | Drag a bottle, pour into a beaker, see the meniscus and the colour | You build (Flutter/React Native), data ships as a bundled `.db` |

The app is only "real world" if layer 1 is complete **and consistent**. The single most common
failure of chemistry apps: they hard-code 30 "recipes" and then the user mixes two of the 30
that aren't paired and gets "no reaction", which is worse than no app. So the data is built so
that reactions are **derivable** (ions + Ksp + pKa + E° + ΔHf) and hand-authored lab recipes are
only the curated *recipes/observations* layer on top.

---

## 1. What "real world" means — the minimum phenomena the data must support

Each phenomenon below is a requirement on the dataset, not on the UI.

1. **Identify the reagent**: formula, molar mass, physical state, colour, odour, density, hydrate form, bottle strength (% w/w, d, molarity).
2. **Dissolve it**: solubility in water/alcohol, per-100 g, temp dependence, enthalpy of solution → beaker warms or cools.
3. **Mix two solutions → what forms?** ions meet; precipitates form only if `Q > Ksp`; colours come from hydrated-ion colours; gases escape if volatile/insoluble.
4. **Acid–base**: pH from Ka/pKa (polyprotic, weak/strong, salt hydrolysis), buffer (H–H), titration curves, indicator colour at that pH, buffer capacity.
5. **Quantify**: moles ↔ molarity ↔ molality ↔ ppm ↔ normality; dilution `C₁V₁=C₂V₂`; limiting reagent; % yield; theoretical gas volume at lab T,P (ideal gas law).
6. **Heat**: ΔH°rxn from ΔHf°, `q = m·c_p·ΔT`, so 50 mL of 1 M HCl + 50 mL 1 M NaOH must read ≈ +6.8 °C.
7. **Gases**: collect over water (subtract aqueous tension), syringe volume, limewater/splinter/glowing-splint confirmatory tests.
8. **Electrochemistry**: cell EMF from E° (anode/cathode auto-picked), spontaneity (`E>0`), Nernst shift with concentration, electrolysis product prediction (discharge order), Faraday's laws for plating mass/time.
9. **Rates**: rate law, orders, `k(T)` Arrhenius, catalyst effect, surface area/concentration/temperature sliders → clock-reaction timings.
10. **Qualitative analysis**: cation group reagents (H₂S class scheme, NaOH/ammonium hydroxide scheme), anion dry & wet tests, flame colours, confirmatory tests with **exact observed colours**.
11. **Organic tests**: unsaturation (Br₂ water, Baeyer), Tollens/Fehling/Benzidine, iodoform, ester smell, litmus/Liebig, degree of unsaturation from formula.
12. **Safety**: GHS pictograms, H/P statements, NFPA 704, corrosivity, mixing prohibitions (never mix these two), waste class, PPE, exposure limits.
13. **Apparatus behaviour**: a 25 mL pipette delivers 25.00 ±0.04 mL; a beaker is ±5 %; burette reads to 0.05 mL; balance to 0.001 g; thermometer lag. **Uncertainty is what makes it feel real.**
14. **Persistence**: mass is conserved, the beaker has contents after the experiment, you can filter/evaporate/crush the solid you made and test *that*.

If a number isn't needed by items 1–14, it doesn't go in the database (keeps the `.db` small enough for a phone).

---

## 2. Database schema (target: `chemlab.db`, SQLite + JSON twin)

### `species.json` — the periodic table of your bottles (every reagent, one row)
```
id, name, synonyms[], formula, formula_html, hill_formula
cas, pubchem_cid, smiles, inchikey
element_counts {C:2,H:6,O:1}          // for auto-balancing & formula parsing
molar_mass_g_per_mol                  // computed from atomic weights, not copied
state (STP), colour, odour, appearance
melting_pt_C {value, range, source, note}   // real, cited, not invented
boiling_pt_C
density_g_cm3 (+reference T)
solubility_water_g_per_100g {value, at_C[]}  // for temp curves
solvent_solubility {ethanol, ether, ...}
aqueous_ion {charge, formula, colour_hex, colour_name}
thermal_stability_C, decomposes_to[]
acid_base {role, pKa[] or pKb, strength, basicity}
redox {E_pair, E0_V, n_electrons}
thermo {dHf_solid_kJ_mol, dHf_aq, dHf_liquid, dHf_gas, S°, Cp}
ksp, kh (hydrolysis), beta_complex (few)
flame_test {colour, hex, confirmatory_tests[]}
hazard {ghs_pictograms[], h_codes[], p_codes[], nfpa{h,f,r}, signal_word, osha_peppm}
stock_form {bottle: conc %w/w, density, molarity, hydrate, assay %purity}
hygroscopic, storage, incompatibilities[]
is_school_lab_common: bool, hazard_class: 0..3
```

### `reactions.json` — curated recipes (the "experiments" people search for)
```
id, name, category (precipitation|acid-base|redox|gas|organic|analysis|thermochem|electrochem|complex)
equation_balanced "2Na2S2O3 + I2 -> Na2S4O6 + 2NaI", coefficients{}
net_ionic, full_ionic
reactants[{species_id, coeff, phase, physical_form}]
products[{...}]
conditions {temp_C, catalyst, indicator, concentration_range, order_of_addition}
observations[]  {order, sense (sight/smell/heat/sound), text, colour_hex}
energy {dH_rxn_kJ_per_mol, delta_T_expectation_C_per_molL, is_exothermic}
gas {id, vol_L_per_mol, collected_over_water}
precipitate {id, colour_hex, form (flocculent|crystalline), soluble_in[]}
ph_change {from, to, direction}
rate_class (instant|seconds|minutes|hours), rate_law, k_ref
equilibrium {type, K_expression, K_value}
safety {max_scale_mL, exotherm, splash, fume_hood_required}
procedure {steps[], apparatus[], approx_cost, duration_min, skill_level}
curriculum_tags {cbse_class11, cbse_class12, practical_list}
verified: "balanced-checked" (auto-checked by the build script)
```

### `solutions.json` — how to make the bottles
molarity, normality, %, ppm, molality conversions; **exact recipes** for standard/made-up
solutions (0.1 M Na₂CO₃ primary standard, borax buffer, acetate buffer pH 4.5, NH₄Cl/NH₃ pH 9.25,
Fehling A/B, Benedict, Lugol's iodine, buffer pH 4/7/10 for calibrating the pH probe, silver
nitrate 0.05 M for Mohr's method, KMnO₄ 0.02 M for oxalate titration …) + indicator prep
(phenolphthalein 1 % in 50 % ethanol) + pH ranges & colour pairs.

### `equilibria.json`
`pKa`: all polyprotic acids (values + which Ka1/Ka2/Ka3 + T), `Ksp` (~70 sparingly soluble
salts, with formula written so the ion ratio is machine-readable), `Kw(T)` table, hydrolysis,
buffer ranges, complex formation (a handful: [Cu(NH₃)₄]²⁺, [Fe(SCN)]²⁺, [Ag(NH₃)₂]⁺, EDTA).

### `thermochemistry.json`
ΔHf° / S° / Cp for ~120 species (solid/liquid/gas/aq) → engine computes ΔHrxn for *any*
reaction in the DB; enthalpy of solution for common salts (so dissolving NH₄NO₃ is cold,
NaOH is hot); heat of neutralisation; bond enthalpies for organic estimates; heats of
combustion of fuels (methane → octane) for the calorimetry lab.

### `electrochemistry.json`
Standard reduction potentials (~85 half-reactions, with pH/acid-base variants: MnO₄⁻/Mn²⁺ vs
MnO₄⁻/MnO₂), activity series, `E = E° − (0.05916/n)log Q` at 25 °C, standard cells with
expected voltmeter readings (Daniell 1.10 V), electrolysis discharge rules for aqueous NaCl /
CuSO₄ / water, Faraday constants, overpotential notes (why real cells ≠ textbook EMF).

### `kinetics.json`
Rate laws + k at 25 °C + activation energies for the handful of reactions whose *timings* are
worth simulating: iodine clock, peroxide + iodide, thiosulfate + acid (turbidity), Mg + HCl,
大理石-ish carbonate + acid (gas-rate), decomposition of H₂O₂ with MnO₂/yeast, ester hydrolysis.

### `glassware.json` + `techniques.json`
Every item with **capacity, graduation, tolerance, uncertainty**, what it looks like, and its
"physics" for the engine: graduated cylinder ±0.5 %, volumetric flask ±0.1 %, pipette, burette
0.05 mL, thermometer, balance pan, Bunsen/ spirit lamp flame temps, crucible, condenser,
separating funnel, pH probe range/±0.01, conductivity probe, colorimeter. Techniques: filtrate/
residue logic, evaporation-to-crystallise, distillation cut on bp, extraction (K_D), titration
endpoint detection, recrystallisation recovery %.

### `analysis.json`
Qualitative scheme as a **decision tree the engine can walk**: group reagent → observation →
possible ions → next test. Plus flame photometry colours with hex, spot tests, litmus/paper
table, anion tests, organic functional-group tests, and confirmatory tests with the *exact*
product that precipitates.

### `hazards.json` + `mixing_rules.json`
GHS/H/P per species; **incompatibility matrix** (oxidiser + fuel, acid + cyanide, water +
conc H₂SO₄ ordering, Na + water, halogen + ammonia…); allowed max quantity per bottle;
ventilation and PPE rules; waste-disposal class; emergency responses (acid on skin → 15 min
water, not neutralise); the "you will be told off" list — the app must refuse or warn on
things a real teacher would stop (e.g. prep of toxic gases, strong oxidiser + glycerol).

### `reference.json`
Constants (R, F, Nₐ, K_w, molar volume 22.4/24.0 L, STP vs SATP), unit conversions,
log tables the engine needs, IUPAC atomic weights, colour-name→hex map, nomenclature rules
(so the app can *name* a product it computed), and the data-source manifest with licenses.

---

## 3. Where each number comes from (auditable, no invented values)

| Data | Source | Access | License |
|---|---|---|---|
| 118 elements: mass, density, mp/bp, ionisation energies, radius, config, electronegativity, category, discovery | `Bowserinator/Periodic-Table-JSON` | raw GitHub JSON ✅ tested | CC-BY-SA 3.0 (attribution required) |
| Per-compound experimental MP/BP/density/solubility + GHS hazards | PubChem PUG-View `?heading=…` ✅ tested (water density → 200 OK, 13 kB) | REST, 5 req/s max, 500 IDs/request | open (PubChem data not copyrighted; cited annotations are) |
| Molar mass | computed from atomic weights in build script (cross-checked vs PubChem) | — | — |
| Ksp, pKa, E°, ΔHf°, Kw(T), buffer recipes, glassware tolerances | Wikipedia `action=raw` wikitext tables + IUPAC/CRC values, **transcribed and cited per value** | ✅ network works | CC-BY-SA (attribution in manifest) |
| School-lab reaction recipes + observations | CBSE Class 11–12 practical lists + NCERT exemplar + standard qualitative-analysis schemes | curated by me, tagged `curriculum_tags` | facts not copyrightable; text re-worded |
| Flame colours / ion colours | standard reference tables | curated + cited | — |

**Provenance rule for every numeric field**: `{value, units, source, ref_id, confidence}`.
Anything I transcribe by hand gets `confidence: "high|medium"` and a source. Anything the
fetcher pulled from PubChem gets its annotation number so you can re-verify. If I can't find a
value, the field is `null` with `"reason": "not_found"` — I never fill a blank with a guess.

---

## 4. Build pipeline (scripts in `chemlab/scripts/`, idempotent, re-runnable)

```
00_elements.py      fetch periodic-table JSON  -> raw/elements.json
01_pubchem.py       resolve names -> CID, batch, fetch headings, throttle -> raw/pubchem/*.json
02_parse_pubchem.py raw annotations -> normalized property records (units, ranges, source)
03_tables.py        wikitext tables (Ksp/pKa/E°/ΔHf) -> parsed + validated numbers
04_curate.py        my hand-authored layer (species extras, reactions, analysis, hazards)
05_build.py         merge -> chemlab.db + *.json; VALIDATORS below
06_report.py        coverage report: % fields filled, # reactions, # species with cited MP
```

Validators (these are the real QA, run on every build):
- every equation's atoms balance on both sides, charge balances
- every `reactants`/`products` id exists in `species.json`
- coefficients are integers in lowest terms
- molar mass recomputed from formula matches PubChem ±0.05
- ΔHf sign/magnitude sanity, E° ranges, pKa ranges, Ksp exponents sane
- each reaction's computed ΔHrxn is consistent with the hand-written "exothermic" flag
- each hazard entry has ≥1 GHS pictogram iff H-codes present
- no orphan species (in DB but in no reaction) unless `is_school_lab_common`

---

## 5. Deliverables at the end of this phase

```
chemlab/
  PLAN.md  DATA_SPEC.md  DATA_REPORT.md
  data/*.json            <- the 11 databases above
  data/chemlab.db        <- SQLite mirror (ships in the APK, ~1-3 MB)
  raw/ + raw/MANIFEST.json <- originals, licenses, how to re-fetch
  scripts/*.py           <- reproducible pipeline
  spec/engine_formulas.md<- the physics you must implement, with worked examples
  spec/app_architecture.md <- Flutter plan, screens, offline, size budget, update strategy
  spec/roadmap.md
```

## 6. Deliberate exclusions (say no early, not late)
- **No** DFT/molecular-orbital or quantum simulation, no 3D protein/large-molecule docking.
- **No** controlled-substance synthesis. Realistic simulation ≠ instruction manual: the app
  shows *observation + hazard*, and refuses the handful of things a school lab wouldn't run.
- **No** live-updating data in v1 — the `.db` is bundled (offline-first, phone labs have no wifi).
- **No** numeric accuracy claims beyond data quality: a virtual lab that says "you made 87 % yield"
  is fine; one that says "the true value is 87.000 % at ±0.001" is lying. Uncertainties are in the DB.
```

---

## 7. Status: what is actually built (this is the layer the app reads)

Built by `scripts/build_warehouse.py`; validated by `scripts/validate_warehouse.py`
(16 re-derivation checks, all passing, one of them "every apparatus name in every table resolves") and
`scripts/test_chem.py` (114 kernel tests).

```
chemlab/
  PLAN.md                      this file: the plan, kept as the design record
  data_curated/                the source of truth - edit here, then rebuild
    species.py                 442 curated records (387 shelf items + 55 registered so every
                               equation term resolves); compact 6-tuples
    reactions.py               286 records   ┐ both files hold
    reactions2.py              138 records   ┘ (id, NAME, category, reactants, products, observations, extras)
    tables.py                  820 numeric entries: Ksp(with its dissolution equation), pKa/pKb,
                               Kw, E0(87 couples), beta, dHf/S/Cp(138 substances + 33 aqueous ions),
                               dH_solution, flame colours, ion colours, colour_map(84),
                               constants(31), glassware(60 with tolerances), techniques(15 with
                               error models), solubility rules, acid order, dielectric, safety limits
    lab.py                     how a lab behaves: 28 stock bottles, 20 indicators, 10 paper tests,
                               cation group 0-VI tree, anion + organic test tables, GHS pictogram/H/P
                               wording (with explicit unverified-code lists), 23 mixing rules,
                               8 refusal topics, waste classes, storage, 11 emergency procedures,
                               curriculum index (CBSE 11/12 + undergrad), 10 troubleshooting entries,
                               192 apparatus and materials rows (60 class-A glassware rows merged with
                               137 accessories, five of them naming the same piece twice), 8 consumable
                               materials, 15 technique rows, 10 kits
    pubchem_names.py           117 search names for double salts/hydrates (suggestions only -
                               every hit is verified by formula AND molar mass)
  scripts/
    lib/chem.py                the kernel: formula parser (hydrates, brackets, half-water),
                               Hill, molar mass, charge-aware balancer, equation checker
    lib/naming.py              formula -> name, for auto-naming and the resolver's candidates
    normalize_reactions.py     the repair pass: strict()/process detection, FIX table, text fixes,
                               coefficient re-balance, pinned acceptance, duplicate-id report
    fetch_pubchem.py           CID resolution + 25 experimental/GHS headings per compound
    fetch_props.py             computed structure table (SMILES/InChIKey/XLogP/…) + CAS numbers
    add_missing_species.py     registers any formula an equation uses that the inventory lacks
    build_warehouse.py         the whole warehouse, including the ion ledger and the dH cross-check
    validate_warehouse.py      independent re-derivation of every computed number
    test_chem.py               kernel regression tests
  raw/                         originals + MANIFEST.json (sources, licences, endpoints, how to refetch)
  data/                        THE DELIVERABLE
    chemlab.json               7.6 MB - species, reactions, tables, lab, derived, safety_index, index
    chemlab.db                 7.8 MB SQLite - same rows normalised, 20 tables, indexes
    DATA_REPORT.md             sizes, provenance split, validation results, coverage %, defects
    build_log.json             the warnings the build found (kept, not hidden)
  spec/
    DATA_SCHEMA.md             every field, and what the app should do with it
    ENGINE.md                  the computation order: amounts, feasibility, heat, gases, cells,
                               kinetics, error budgets, titration curves, free-play mixing
    SAFETY.md                  the guard: evaluation order, refusal screen, what never to print
```

Numbers to quote: **494 species** (441 curated: 404 with a weighable formula, 33 polymer/mixture rows,
   plus 53 aqueous-ion records the build created so net-ionic equations resolve),
**424 reactions** — 207 machine-balanced equations (123 of them `pinned`, i.e. curated
coefficients that still pass the atom-and-charge ledger) and 217 `process` records;
**255 species** with a PubChem CID verified by formula *and* molar mass, of which 210 carry
SMILES/InChIKey and 191 carry a GHS block with real H/P codes; **703 displacement
predictions** and **73 Ksp→solubility** derivations generated rather than copied.

Deviations from the plan in §5, all deliberate:
- the 11 separate JSON files became one `chemlab.json` plus the SQLite mirror — a phone can
  memory-map one file, and splitting it only created version-skew risk between parts;
- `DATA_SPEC.md` is `spec/DATA_SCHEMA.md`; `spec/engine_formulas.md` is `spec/ENGINE.md`;
  `spec/app_architecture.md` and `spec/roadmap.md` were **not** written, because the
  prototype decision was "data only" — the app is yours to build, and §2-§4 of this plan
  still describe the layering it should sit in;
- `spec/SAFETY.md` is new: once the refusal list became data, the *enforcement order* needed
  writing down, and it belongs with the dataset rather than in app code;
- 3D/ball-and-stick: `pubchem.smiles` + `inchikey` are in the warehouse for **207 of the 582
  records** (42 % of the 492 that are substances, 47 % of the 436 bottles you can weigh), which is
  what a renderer needs; the app prints both strings on the substance sheet and draws nothing. No
  coordinate files were generated — a phone can build them from SMILES, and shipping hundreds of
  MOL files would have been dead weight. The percentage is not higher because structure data was
  only taken for records PubChem's name search hit with both formula and molar mass agreeing.

Still open, in priority order — none of them block starting the app:
1. ΔfH coverage: **111 of 207** balanced equations compute their enthalpy end-to-end (the fix
   that added ΔfH = 0 for elements in their standard state moved this from 81). The other 96 are
   blocked on 97 distinct missing values, and they cluster: KI (8 records), Cu(NO3)2 (4), FeCl3
   (4), MnSO4 (4), CH3COONa (4), H2CO3 (3), KBr (3), then KHSO4 / NaH / K2CO3 at 2 each. Every
   record names what it lacks in `thermo_derived.missing_terms`, with a reason string, so this is
   a fill-in job against a data table and not an app feature.
2. 49 curated CAS numbers disagree with PubChem's list (both are kept on the record as
   `cas_conflict`); worth a manual pass against the bottle in a real lab.
3. Rate constants: the records carry timescales, not k values. If the app wants real
   kinetics screens, the two clock reactions are where to start (they have `time=` and
   concentration data to fit).
4. Reagent-grade purity/assay values (for "how many moles are *really* in this bottle") are
   curated only where the teaching point needs them (NaOH carbonate, KMnO4, thiosulfate).

## 7.4 The app that reads it (`app/`)

The client is built, prompt by prompt, in `app/` — the queue and the delivered notes are in
`app/ROADMAP.md`. Shape: a phone-first PWA (React + TypeScript + Vite), no backend, no account,
the whole warehouse as ~1.27 MB of gzipped JSON next to the bundle, and the same `dist/` wrapped in
an APK with Capacitor (`app/docs/BUILD_ANDROID.md`).

Three rules carry over from the data layer and are enforced in code, not in prose:

1. no number without its provenance line, and an `approx`/`computed`/`rule` number never looks like
   a measurement — a number whose `basis` says `computed` is labelled "computed here", everywhere;
2. a refusal is a result — "nothing happens", "not covered by this data" and "you must not do this
   in a kitchen" render in the same typography as data, and a reaction whose record hides the scale
   has its quantities hidden by the bench *and* by the notebook;
3. everything the app works out (moles, limiting reagent, pH, emf, ΔG, Q vs Ksp, dilutions, hazard
   limits, Δχ, % ionic character, balancing) is a pure tested function in `app/src/lib/` reading the
   shipped records — no handbook value re-typed, no per-substance special case.

`npm run check` in `app/` is the whole contract: `tsc --noEmit`, 276 tests over the *shipped* files
(row counts, the Na–Cl combination row field by field, all 424 reactions swept for what must not be
printed, all 582 species sheets rendering, the practical schemes and the 192-row apparatus register,
the notebook round-trip, the service worker driven against a fake cache), then the build, the transfer
budget (1.365 MB of 1.5 MB) and the parse-and-index budget (204 ms of 1000 ms, on the machine that
built it).

The eighth tab is the one that makes it a lab rather than a lookup table: seven cation groups, 19
anion tests in 3 blocks, 27 organic tests, 10 paper tests, 15 techniques, 10 kits, the 43-experiment
syllabus index, 10 troubleshooting rows, and the apparatus shelf read backwards — what each piece is
for, which kit or technique calls for it, its tolerance in the register's own words, and an explicit
"nothing measured" where the register has no figure. `tests/reach.test.tsx` is the audit that keeps it
a closed loop: it renders every screen of all eight tabs and every section of the Work tab, every sheet
for every record any link can name, round-trips every link the app can write through the real URL
parser, and fails on any stub wording anywhere in the shipped source. Two of its findings were data
findings — a stock bottle naming a species that had no record (`khp`), and heavy water indexed under no
element because `D` is an isotope and not a row — and both were fixed in `data_curated/` and rebuilt.

## 7.5 The periodic layer (added after the first release, in answer to one question)

The question was: *can the whole chemistry be in there, so I can mix anything with the
elements I have and see all the properties?* The first release could not answer that — 41 of
118 elements appeared in no species at all, the element table carried 9 fields, and mixing
two arbitrary things was left to the app. So the plan grew a layer:

| what | as built |
|---|---|
| element records | 118, ~40 cited fields each (was 9, and its temperatures were kelvin numbers mislabelled degC — fixed, with the kelvin kept beside every conversion) |
| shelf records for elements that had none | 87 generated from the element table; radioactive/synthetic ones marked `not_a_shelf_reagent` |
| element → dataset links | every element record lists the species and reactions that involve it |
| species | 494 → 581 → 582 (`khp`, potassium hydrogen phthalate, was named by the app's own stock-bottle row and had no record; the build recomputed 204.222 g/mol from CIAAW weights and the bottle's note says 204.22) |
| oxidation states | assigned by the kernel's rule set on 348 species; per element, `oxidation_states_observed` says which states this dataset actually shows |
| element pairs | 9410 rows in `data/combinations.json.gz` + table `combination`: 72 verified, 3 empirical-ratio matches, 5789 predicted (arithmetic only), 3546 `none` with a reason; 156 carry an emf/log K/ΔG derived from `tables.e0` |
| ion pairs in water | 380 rows in `tables.precipitation_matrix` + table `precip`: 50 by measured Ksp, 275 by a curated rule (256 solubility rules, 17 by the pKa table, Kw, NH4+ acidity), 55 explicitly not covered |
| kernel | `ox_states()`, `criss_cross()`, `pauling_ionicity()`; atomic weights extended from 86 to 119 symbols so any element parses |
| checks | validator 13 → 16 re-derivations; kernel tests 45 → 114 |
| spec | `spec/COMBINATORICS.md`, including the seven things this layer refuses to do |

Three things worth recording about how it was built:

1. **A second element source, vendored not depended-on.** `raw/mendeleev/element_data.json`
   (MIT) supplies oxidation states, Shannon radii, isotopes, phase transitions and the 33
   missing atomic weights, and each column's own metadata states its unit and citation — which
   is why no unit in the periodic layer is a guess. `scripts/vendor_mendeleev.py` reads the
   wheel once; the build needs no packages.
2. **The layer is a rule engine over cited inputs, not a predictor.** The only thermodynamic
   statement it makes about an unmeasured formula is an emf chain from the curated E° table,
   and it is labelled as aqueous-standard-state arithmetic. A `predicted` row can never carry a
   melting point, colour or hazard: the validator rejects the record if it does.
3. **Honesty fixes found by building it**: the kelvin/degC unit bug; `elem_hg`-style id
   collisions; the kernel unable to weigh promethium; superheavy elements quoting *calculated*
   densities as measurements (now `values_are_predicted` + `measured: false`, enforced by a
   check); a rule that called H + phosphate a precipitation (now an acid-base row derived from
   `tables.pka`); and a dict keyed on display text that silently dropped 18 ion pairs.

Open items gained by this layer, in priority order:
5. Only binary combinations are enumerated. A user typing "mix sodium, chlorine *and* oxygen"
   gets the curated records (NaClO, NaClO3, …) rather than a prediction; extending the
   enumeration to ternaries would multiply rows ~10× for mostly meaningless formulas.
6. Unusual valences are outside the enumeration on purpose (main states only, extended to
   fill a gap): `NO`, `NO2`, `Fe3O4`, `Na2O2`, `CaC2` are not generated as combinations,
   though several of them exist as curated species. The note on every row says so.
7. Isotope decay modes and nuclear data are not vendored — the element page shows abundances,
   masses, spins and half-lives, and stops there; no dose or decay-heat maths exists and the
   guard keeps radionuclides off the bench.

Rebuild in one line:

```bash
cd chemlab && python3 scripts/vendor_mendeleev.py <wheel>   # only if raw/mendeleev/element_data.json is missing
python3 scripts/normalize_reactions.py && python3 scripts/add_missing_species.py \
  && python3 scripts/build_warehouse.py && python3 scripts/validate_warehouse.py && python3 scripts/test_chem.py
```
