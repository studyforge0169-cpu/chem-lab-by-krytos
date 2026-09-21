# chemlab — the data layer for a virtual chemistry lab on a phone

Two things live here: the **data and specs**, and the **phone app that reads them**
(`app/` — React + TypeScript + Vite, eight tabs, installable, fully offline, 276 tests,
1.37 MB over the wire). The data is the part that has to be right; the app is the part that makes
it usable one thumb at a time. 582 species, 424 reaction records, all
118 elements with ~40 cited properties each, the numeric reference tables
(Ksp/pKa/E0/ΔfH/glassware tolerances), the lab-behaviour layer (stock bottles, indicators,
the salt-analysis tree, GHS, waste, first aid, the CBSE/undergrad practical index, a
192-row apparatus and materials register (60 class-A glassware rows merged with 137 curated
accessories, 27 of them carrying a published tolerance and the rest saying they have none), 15
techniques, 10 kits and 43 syllabus experiments) and an explicit refusal list — plus four specs that say how to compute with it
and where the guard sits.

## Start here

| file | what it is |
|---|---|
| `data/DATA_REPORT.md` | sizes, provenance split, what the build verified, coverage %, the periodic layer, and the defects it found and kept |
| `data/chemlab.json` | the warehouse, one file (9.2 MB; `chemlab.json.gz` is 993 KB) |
| `data/chemlab.db` | the same rows as SQLite, 24 tables, indexed (18.8 MB; gz 1.89 MB) — for querying the warehouse from a notebook or a script; the app does not ship it |
| `data/chemlab.json.gz` | **what the app ships**: the whole warehouse in one gzipped file — 204 ms to inflate, parse and index on the machine that builds it, and that figure has not been measured on a phone |
| `data/combinations.json.gz` | the element-pair table, 9 410 rows, loaded with it (252 KB gzipped) |
| `spec/DATA_SCHEMA.md` | every field, with a jsonc sample of each record type |
| `spec/ENGINE.md` | the computation order: amounts → feasibility → heat → gases → cells → kinetics → error budgets → titration curves → free-play mixing |
| `spec/COMBINATORICS.md` | the periodic layer: element records, generated bottles, oxidation states, every element pair, every ion pair, and what may be claimed for each |
| `spec/SAFETY.md` | the guard: evaluation order, the refusal screen, what must never be printed |
| `PLAN.md` | the design record, including §7 "what is actually built" and what is still open |
| `app/ROADMAP.md` | the app: fifteen prompts, each with its acceptance criteria, and what landed when each was done |
| `app/docs/BUILD_ANDROID.md` | the two ways onto a phone: install as a PWA, or wrap the same `dist/` in an APK |

## "Can I mix anything, with any element, and see all the properties?"

That question is the reason the periodic layer exists, and the answer has three parts.

1. **Any element.** 118 element records — mass with its CIAAW uncertainty, radii, both
   electronegativity scales, the ionisation series, electron affinity, heat capacities,
   fusion and vaporisation enthalpies, lattice structure, melt and boil (degC, with the
   kelvin value beside it), crust and sea abundance, common *and* extended oxidation states,
   Shannon ionic radii per coordination number, natural isotopes with abundances and spins,
   CAS number, appearance, summary, uses, a UI swatch — and `dataset`, which lists the
   species and reactions in this warehouse that involve that element.
2. **Any element as a bottle.** 87 elements had no record at all, so the build generated a
   standard-state shelf entry for each (Ti, Ga, Se, Xe, U …), copying the element's own cited
   numbers. Radioactive and synthetic ones are marked `not_a_shelf_reagent`: readable, not
   selectable.
3. **Any pair.** 9410 rows — every element pair and every formula their common valences
   allow — classified `verified` (a substance in this dataset: 72 of them, with the real
   properties and the preparation reactions linked), `empirical`, `predicted` (only
   arithmetic: mass, Δχ, Pauling ionic character, and where both binary electrode couples
   exist an emf, log K and ΔG) or `none` with the reason. Separately, 380 cation–anion pairs
   decide what happens when two solutions are mixed: 50 by a measured Ksp (with the solubility
   computed from it), 256 by the curated solubility rules — labelled as rules, never shown as
   measurements — 19 by the pKa table (gas evolved, nothing at all, or partly the hydrogen
   salt), and 55 rows that say "not covered" instead of guessing.

The honest limit: this is *what the data can answer*, not quantum chemistry. Nothing here
predicts the properties of an unmeasured substance, and every row that is a rule or a
prediction says so in the record itself.

## Rebuild after editing anything in `data_curated/`

```bash
python3 scripts/vendor_mendeleev.py <wheel>   # only if raw/mendeleev/element_data.json is missing
python3 scripts/normalize_reactions.py        # repairs equation text, re-balances, reports failures
python3 scripts/add_missing_species.py        # registers any formula an equation uses that the inventory lacks
python3 scripts/build_warehouse.py            # -> data/chemlab.json, chemlab.db, combinations.json, DATA_REPORT.md
python3 scripts/validate_warehouse.py         # 16 independent re-derivations: must print "16 passed, 0 failed"
python3 scripts/test_chem.py                  # 114 kernel tests: must print "114 passed, 0 failed"
```

`build_log.json` lists every warning the build raised. A non-empty warning list is not a
failure — 90 species are mixtures, polymers, aliases or notes with no formula to weigh, and
49 curated CAS numbers disagree with PubChem's list. Those are findings the app should
surface, not hide.

## Two rules that make this dataset different from a scraped one

1. **Every number carries its provenance** — `{value, units, source, ref_id, confidence}` —
   and a `null` always comes with a reason. Missing data is never filled in with something
   plausible, and `confidence: "approx"` must be shown as approximate.
2. **Anything computable is computed.** Molar masses, atom and charge balance, reaction
   enthalpies, Ksp→solubility, the 703-entry displacement table (from E°, not from a
   mnemonic), oxidation-state assignment, the valence criss-cross and all stoichiometric
   masses come from `scripts/lib/chem.py`. That is what makes the data mechanically
   checkable — and it is how real errors got caught: `hill()` assumed every carbon compound
   has hydrogen so `CCl4` crashed; `molar_mass` was called on a parser that could not read
   hydrate dots, which would have left every `CuSO4.5H2O` unweighed; `strip_charge` read
   `Ag(NH3)2+` as a 2+ ion; `balance()` accepted `H2 -> H2` as a reaction; the element layer
   once shipped kelvin numbers in a degC field (iron "melting at 1811 °C"); and a curated ΔH
   for KClO3 decomposition does not reproduce from the CRC formation data (flagged, not
   hidden — see the ΔH cross-check in `data/DATA_REPORT.md`).

## Loading it on the phone

`data/chemlab.db` is the shipping artefact: copy it into assets, open it read-only, and the
screens are ordinary queries — `element` and `isotope` for the periodic table, `species` for
the shelf and the bottle sheet, `reaction` + `term` for a run, `observation` for what
appears, `h_code`/`p_code` for the label, `ksp`/`pka`/`e0`/`thermo` for anything the engine
must compute, `precip` for "what happens when these two solutions meet", `combination` for
"what can these two elements make", `mixing_rule` and `refusal` for the guard. The full
record (including provenance on every number) is in the `json` column of `species`,
`reaction`, `element`, `combination` and `precip`, so a list query stays cheap and a detail
screen stays complete. `chemlab.json.gz` (993 KB) is the same data for a React Native / JS
app that would rather load one blob than run SQL; `combinations.json.gz` (252 KB) is loaded
only when somebody actually mixes two elements.

The 217 `process` records are the honest form for chemistry an equation cannot express
(rusting, fractional distillation, a group-separation scheme). The engine must not try to
balance them, and the app must not offer a yield on them.

## Running the app

```bash
cd app
npm install
npm run sync        # ../data/*.gz -> public/data/, with the build id and sha256 of what was copied
npm run dev         # http://localhost:5173 - no service worker in dev, so a reload is real
npm run check       # tsc --noEmit, then vitest (276 tests), then the build and the size budgets
npm run serve -- --port 4173     # the built dist/ on 0.0.0.0, for a phone on the same wifi
```

`npm run check` (typecheck → every test → the build and its budgets) is the gate every prompt had to
pass. Two of its files are worth naming, because they are what keeps the app honest rather than merely
green:

- `tests/reach.test.tsx` renders every screen for all eight tabs and every Work section, every sheet
  for every record the app can link to (582 species, 424 reactions, 118 elements, the whole 9410-row
  combination set, sampled bench pairs), round-trips every link through the real URL parser, and then
  strips the comments out of `src/`, `index.html`, `public/sw.js` and the manifest and fails on any
  `later prompt`, `not implemented`, `TODO`, `coming soon`, `to be written`, `placeholder text` or bare
  `prompt N`. It is the sweep that found the missing KHP record and the `D2O`-under-hydrogen index
  gap, and both were fixed in `data_curated/` and rebuilt rather than patched in a screen.
- `tests/practical.test.ts` and the shelf census test pin the apparatus numbers: 192 register rows,
  27 of them with a tolerance, 92 of 92 kit references resolving, `practicalGaps()` empty. A facet
  count on a screen has to agree with a sweep of the file done inside the test.

The eight tabs are `table · shelf · bench · calc · safety · reactions · work · more`; the Work tab
carries six sections (`schemes · techniques (15) · kits (10) · syllabus (43) · glassware (192) ·
when it goes wrong (10)`). Nothing in the app fetches anything from a network it does not ship.
