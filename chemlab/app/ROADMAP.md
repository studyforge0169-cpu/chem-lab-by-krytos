# ChemLab app — the build roadmap, as a queue of prompts

The data layer (`../data/chemlab.json.gz`, `chemlab.db`, `combinations.json.gz`) is finished
and validated. This is the app that reads it. It is built one prompt at a time; each prompt
below is a self-contained instruction with acceptance criteria and a check that must pass. The
status column is updated as each one lands, so this file is also the progress report.

**Shape of the thing.** A phone-first PWA (React + TypeScript + Vite). Installable, offline
after first load, ships the whole warehouse as ~1 MB of gzipped JSON — no backend, no
account, no network needed to run an experiment. The same code wraps into an `.apk` with
Capacitor later (prompt 12 documents it); nothing in here is web-only in spirit.

**Three rules inherited from the data layer, enforced in the UI:**

1. Never print a number without its provenance line, and never print `approx`/`predicted`
   as if it were measured. The colour, size and wording of a *rule* must differ from a
   *measurement*.
2. A refusal is a result. "Nothing happens", "not covered by this data" and "you must not do
   this in a kitchen" are all answers the app shows in full, in the same typography as data.
3. Anything the app computes (moles, limiting reagent, pH, emf, ΔG, Q vs Ksp, dilutions) is
   computed in `src/lib/` from the shipped records — pure functions, unit-tested, never
   hard-coded per substance. The app never re-typies a value from a handbook.

## The queue

| # | prompt | builds | status |
|---|---|---|---|
| 1 | scaffold, data pipeline, typed store, app shell | loads 1 MB gz in <2 s, 118/581/424 rows indexed, `tsc` + `vitest` + `build` green | ✅ done — store, indexes, manifest, shell; `npm run sync` + `load.ts` inflate 1 MB in ~40 ms in tests |
| 2 | periodic table screen | all 118 elements, 5 colour modes, search, honest `≈`/predicted markers, one-thumb layout | ✅ done — 118 tiles, 5 colour modes, search, predicted/approx markers, one-thumb layout |
| 3 | element sheet | every field the record holds, grouped, with provenance; blocked elements readable, not selectable | ✅ done — every field the record holds, grouped with provenance; blocked elements read-only |
| 4 | shelf + substance sheet | 581 records browsable and searchable, filters, GHS label, hazards, oxidation states, PubChem link | ✅ done — 581 records, filters with live counts, GHS label, hazards, oxidation states, PubChem link |
| 5 | the bench: mix things | 1–4 substances → reaction record or ion-pair matrix row, equation, observations, status word | ✅ done — bench decides: curated record → ion-pair matrix → honest 'not covered', with refusals |
| 6 | quantities | moles/mass/volume, limiting reagent, yield, dilutions from real bottles, glassware error budget | ✅ done — moles/limiting reagent/yield, glassware and balance error budget, dilutions from real bottles |
| 7 | heat and gas | ΔH of the run, beaker temperature, gas collected over water, honest "ΔfH missing" path | ✅ done — ΔH ledger re-added and cross-checked, beaker ΔT, gas over water with vapour correction |
| 8 | pH, buffers, titration, precipitations at real volumes | pH from pKa (quadratic), buffer maths, curve + indicator choice, Q vs Ksp | ✅ done — pKa solved by charge/mass balance (not the shortcut), buffers with capacity, titration curves with indicator errors priced, Q vs Ksp at the bench volumes |
| 9 | electrochemistry | two half-cells → emf, n, log K, ΔG, which is the anode; displacement series | ✅ done — cell.ts derives n by balancing both halves against the ion records (76 of 87 couples), 23-electrode grid, 703-row series with the shipped n=2 assumption shown against the real n; two new modes on the calc tab |
| 10 | the safety guard | refusal screen, hazard badges, first aid, waste and storage, what must never be printed | ✅ done — `guard.ts` decides from `safety_index`/`lab.mixing_rules`/`tables.safety_limits`; 23 block lists, 16 of 23 mixing rules actionable, 0 unknown control tokens over all 424 records; refusals shown as results, quantities withheld where the record hides them |
| 11 | every element pair + the notebook | 9410 combination rows browsable by status; saved runs, export/import | ✅ done — `combos.ts` + a browser on the shelf tab over all 9410 rows (pair/status/emf filters, formula, states, mass, Δχ, % ionic, emf chain, the `why`), and `notebook.ts` saving runs to localStorage with JSON export/import that round-trips |
| 12 | ship it | offline service worker, manifest + icons, install path, perf budget, Capacitor/Android notes, docs | ✅ done — hand-written worker (cache-first data, network-first manifest, cross-origin requests refused), icons drawn from the swatch palette by `scripts/make-icons.mjs`, manifest + shortcuts, **1.345 MB of 1.5 MB** over the wire and **168 ms** of parse+index, `docs/BUILD_ANDROID.md`; the worker is driven in a test against a fake cache |
| 13 | every reaction + one search box | 424 records browsable by category/tag/facet/hazard with a computed coverage census; one header search over the whole warehouse | ✅ done — a 7th tab, 24 facets whose counts are computed from the rows, a census table, and a search box that covers the warehouse *and* your notebook |
| 14 | the practical work | cation/anion/organic schemes, 15 techniques, 10 kits, the syllabus index, troubleshooting, each with the guard on it | ✅ done — an 8th tab (`work`) with six sections over `src/lib/practical.ts`; every apparatus quoted with the register's own tolerance, unresolvable ids counted and named, and 0 gaps left in the file |
| 15 | close the loop | apparatus and materials shelf both ways, and a reachability audit of every path in the app | ✅ done — `glassware (192)` as the 6th Work section reading the register backwards, plus `tests/reach.test.tsx`: 24 tests that render every screen and every sheet of all 582 substances, 424 reactions, 118 elements and 9410 pair links, and sweep the source for stub text |
| 16 | ask it for a substance | say what you want, and the lab answers with every way it can make it — routes searched over the shipped records, guard on every step, quantities from the real bottles | ⏳ |

Order is deliberate: the table first (it is the thing that makes this lab different and needs
no chemistry engine), then the shelf, then mixing, then each calculator. Nothing in prompts 2–8
depends on a server.

---

## Prompt 1 — scaffold, data pipeline, typed store

> Build the React + TypeScript + Vite app in `chemlab/app`. Write `scripts/sync-data.mjs` so
> that it copies `../data/chemlab.json.gz` and `../data/combinations.json.gz` into
> `public/data/` and writes `public/data/manifest.json` with byte size, sha256, row counts and
> the build timestamp of each — the app must be able to say which build of the data it is
> showing. `src/data/load.ts` fetches the gz, decompresses with `DecompressionStream` (with a
> clear error if the browser cannot), parses once, and returns a store with the indexes the
> screens need: by id, by Hill formula, by element symbol, name/formula/CAS search tokens, and
> the two lookup maps the bench will want (`precipitation_matrix`, combinations by element
> pair). `src/data/types.ts` models the records exactly as built — a `Prov<T>` for every
> `{value, units, source, ref_id, confidence}` field, and nothing in the UI may read
> `.value` without going through the component that also renders the provenance. `src/App.tsx`
> is the shell: a phone layout, a bottom tab bar (Table, Shelf, Bench, Safety, More), a header
> that shows the data build date, and a loading/error screen that tells the truth about which
> step failed. Pure functions live in `src/lib/`. Verify: `tsc --noEmit`, `vitest run` with
> tests that read the *real* shipped gz file and assert counts and spot values (NaCl
> 58.44 g/mol, 118 elements, 380 ion pairs, 9410 combinations), and `vite build`.

## Prompt 2 — periodic table screen

> Render all 118 elements as a real periodic-table grid (18 columns, lanthanides/actinides on
> their own rows), each tile with symbol, name, number, standard atomic weight and the phase at
> 298 K. Colour modes the user can switch: category, phase, metal/nonmetal, electronegativity,
> melting point — the last two as a legend with the actual scale, and gaps where no value
> exists must render as "no data", not as the lowest colour. Search box that jumps to the tile.
> A tile for an element with `values_are_predicted` gets a visible "predicted" marker, and one
> with `approx` confidence gets `≈` on its mass. Tapping a tile opens the element sheet (next
> prompt). Keyboard/pointer hover is a bonus; touch is the requirement. Verify: 118 tiles in
> the DOM, one per element, and `tsc`/`vitest`/`build` green.

## Prompt 3 — element sheet

> A bottom sheet (drag-dismiss, full-height on small screens) that shows everything the record
> holds, in this order: identity (number, symbol, name, category, group/period/block,
> established, discovery), atom (mass + CIAAW uncertainty, isotopes with abundances and spins,
> ionisation series as a table, electron affinity, radii on both scales, electronegativities
> side by side and never averaged), thermodynamics (melt/boil with the kelvin value beside
> them, sublimation note, fusion/vaporisation, heat capacities, critical/triple point),
> structure (lattice, lattice constant), reactivity (oxidation states: main/extended/observed,
> labelled as three different things; Shannon radii per coordination and spin), occurrence
> (crust, sea, appearance, CAS), the human text (summary, name origin, occurrence, uses), and
> the links to this dataset (species and reactions that involve the element — tappable). Every
> numeric row shows its provenance in small type and the confidence word. If
> `not_a_shelf_reagent`, an unmissable notice: readable, not usable on the bench.
> Verify: the sheet renders for the three hardest cases — Fe (radii, isotopes, ox states),
> As (sublimation note), Og (predicted flag) — with no missing-key crashes.

## Prompt 4 — the shelf

> Browse all 581 records: search on name, formula (any writing: `CuSO4`, `CuSO4.5H2O`,
> `O4SCu`), CAS and symbol list; filters for kind (substance/aqueous ion/mixture/element
> bottle), state, and hazard ≥ 3; sort by name/hazard/molar mass. The row shows formula
> written, colour swatch when the data has one, molar mass and a hazard badge. The substance
> sheet shows: the label (name, formula, CAS with any `cas_conflict` warning, state, colour),
> the numbers (mp/bp/density/solubility/pKa with provenance and units), oxidation states per
> element with the basis line and the unresolved note when the kernel refused, the GHS block
> (signal word, pictogram, H and P statements as real text, not codes only), NFPA if present,
> PubChem identifiers with the note that a 3D view comes from `smiles`, and for `mixture` /
> `alias` / `note` rows the reason they cannot be weighed. An "add to bench" button appears
> only for weighable, non-blocked records. Verify: every species id in the warehouse renders
> its sheet without an exception (test does it by looping the store).

## Prompt 5 — the bench

> The mixing surface: up to four things, each with an amount in grams, moles, or mL of a stock
> solution, in any order. On every change, decide what happens using the data only: (a) a
> curated reaction record whose reactant set matches (order-insensitive, coefficient-agnostic)
> → show it as *in this dataset*, with its equation, observations, timescale, hazard and
> teaching notes; (b) all-aqueous pair → the precipitation matrix row: outcome, basis word
> ("measured Ksp" vs "solubility rule" vs "pKa table"), the net-ionic equation, colour only
> when the row has one, and the `why` text for `null` outcomes; (c) nothing matches → the
> honest empty state: what was tried and why the answer is "not covered", never a guess.
> Links into quantities/heat/pH panels appear once a mixture is decided. Verify: the five
> canonical cases produce the right branch — `H2 + O2` (verified), `CuSO4 + Zn` (verified,
> displacement), `AgNO3 + NaCl` (Ksp row), `NaCl + KNO3` (rule: nothing), `NaF + HCl` (acid on
> the salt of a weak acid), plus one unpaired case that must land in the empty state.

## Prompt 6 — quantities

> Moles ↔ mass ↔ volume for every term in the chosen reaction; limiting reagent from the
> balanced coefficients; theoretical yield and, when the user enters what they actually got,
> the percentage; solution prep from the real stock bottles (`lab.stock_bottles`, with their
> concentration caveats) and dilution arithmetic; then the error budget: for each measured
> quantity the app offers a piece of glassware from `tables.glassware` and propagates the
> tolerance through to the answer, because "how many significant figures is this?" is a real
> question in a practical exam. All of it as pure functions in `src/lib/stoich.ts`, tested
> against the kernel's locked numbers (CuSO4·5H2O 249.677, Mohr's salt 392.125, Daniell-style
> stoichiometry, one limiting-reagent case with an excess). Verify with vitest, not by eye.

## Prompt 7 — heat and gas

> ΔH of the run from `thermo_derived` when the dataset has it (with the term-by-term ledger
> shown, and the `missing_terms` list when it does not); what that means for the beaker
> (mass of solution, Cp of water, ΔT, and the honest note that heat loss to the glass is not
> modelled); for a gas, the volume at lab conditions, collected over water with the vapour
> pressure correction from `tables.aqueous_tension_mmhg`, molar volume with the named
> convention, and the density of the gas relative to air. No invented numbers anywhere: if a
> term is missing the panel says which and links to the reaction's `thermo_curated` value.
> Verify: burning 1 g of Mg and the `KNO3` recrystallisation case reproduce the hand numbers
> in the test.

## Prompt 8 — pH, buffers, titration, precipitation at real volumes

> pH from the pKa table with the quadratic (not `√(Ka·c)`), for acids, bases and salts of weak
> acids; buffer pH and how much it resists (both with the range where the answer stops being
> trustworthy); a titration curve generated point by point with the equivalence volume and the
> indicator chosen from `lab.indicators` by range overlap, and the trap notes shown when the
> wrong indicator is picked; the Q-vs-Ksp decision for the bench mixture at the actual volumes
> mixed — this is where "the rule says soluble" and a real cloudiness can both be true, so the
> panel must say which regime the user is in. Verify: pH 0.1 M acetic = 2.88, the half-neutralisation
> point equals pKa, and CaSO4 at 1e-3 M does not precipitate while at 0.1 M it does.

## Prompt 9 — electrochemistry

> Pick two half-cells out of `tables.e0`; the app writes the cell, names anode and cathode,
> gives E_cell, balances electrons by finding n from the two half equations, and then
> log K = nE/0.0591 and ΔG = −nFE, with the constant and the convention quoted from
> `tables.constants`. The 703-row displacement series becomes a browsable table (metal in
> solution vs metal strip: yes/no/emf). The combination rows that carry `predicted_emf` are
> reachable from the element pair, labelled as aqueous-standard-state arithmetic that says
> nothing about rate. Verify: the Daniell cell = 1.104 V, the Na–Cl row's log K reproduces
> 68.8, and every "spontaneous" verdict in `derived.displacement` re-derives from the two E°
> values in the test.

**Delivered.** `src/lib/cell.ts` + `src/screens/CellModes.tsx`, wired into the calc tab as two more
modes ("a cell", "the series"). What it does:

- **n is derived, never copied.** Each half is balanced against the 53 `aqueous_ion` records: the
  side strings are parsed, H and O are allowed to move to water, and the electron count falls out
  of the charge difference — `MnO4-/Mn2+` comes to 5 e⁻ because MnO₄⁻ is −1 and Mn²⁺ is +2, and
  the screen prints that sentence next to the number. The cell's n is the lcm of the two halves, and
  the multipliers that cancel them are printed too. 76 of the 87 couples balance this way; the other
  11 say why (`CuCl/Cu` needs an anion the key never names) and take their log K and ΔG away with
  them rather than guessing an n.
- **The verification the prompt asked for, in `tests/cell.test.ts` (17 tests):** Daniell = 1.104 V
  with n = 2 and log K 37.3; the Na–Cl row's 68.8 reproduces as the app's *per mole of electrons* number —
  the row's own source string says "n = 1 e- per formula unit", so the cell written for 2 Na gives 137.6 and
  the screen prints both figures side by side rather than letting the factor of two look like a dispute;
  `ClO3-/Cl-` derives n = 6; `Hg22+/Hg` reads mercury as Hg₂²⁺ only after the ion records vote for it;
  the whole 87-row table is swept for the properties that matter (`2 H+/H2` gives 2 e⁻ not 1, a bare
  element with digits reads its charge off the digits, `Fe(OH)3/Fe(OH)2` balances in base) and the
  result that no cell is ever printed running backwards; `displacementRows` re-derives all 703 rows
  and reports 703 agree, 0 disagree, 0 verdicts moved.
- **The 703 rows and the app's own grid are different things, and the screen says so.** The data has
  one row per *element* pair; the table has 23 element electrodes and several couples for the same
  metal (`Cu+/Cu`, `Cu2+/Cu`), so the choice of couple moves the number. The series screen lists both:
  what the shipped row says and what the app gets from the E° values, with the element pair's
  combination rows underneath, each opening the sheet that carries the `why` for a `none` verdict.
- **Q, pH and the bench.** Concentrations come from typed fields or from the bench bottles (grams and
  mL → mol/L by `mix.decideMix`'s volumes, never from an assumed litre); every ion with no source
  stands at 1 mol/L with a basis line saying so. A pH field drives both H⁺ and OH⁻ from `tables.kw`
  at the chosen temperature, and the screen states the slope as V per pH unit with the count of
  protons in the equation — the permanganate/zinc cell is worth 0.0947 V per pH unit, four times the
  textbook 0.0592, which is the sort of thing a table of standard potentials hides.
- **Nothing is styled as a measurement that isn't one.** Every E° carries its curated provenance line;
  the emf is labelled as a difference of those; `predicted_emf` rows keep the `predicted` chip; Ksp
  ties are reported at 1e-12 V and the exact 0.000 V ties in the table (Ni²⁺/Ni against itself) render
  "no direction" rather than a coin flip. 10^383 prints as `10^383.5` with "no decimal expansion",
  because Infinity is the same lie in the other direction.

## Prompt 10 — the safety guard

> A guard that runs *before* anything is shown as possible: `safety_index` lists (hard stop /
> restricted / hood / hazard-5) decide what the bench will accept; `lab.refusals` renders the
> refusal screen with the reason and the safe alternative; GHS and `hazard_score` drive the
> badges; `lab.emergency` gives first aid for the substance actually chosen, `lab.waste_classes`
> says where it goes, `lab.storage_rules` says where it lives, and `tables.safety_limits` says
> what "too much" means. The app must never print a synthesis route the data marks as
> prohibited, and never show a quantity for something with `not_a_shelf_reagent`. Verify: the
> guard's decision function is pure and tested for every blocked list plus a false-positive
> check (NaCl must pass).

**Delivered.** `src/lib/guard.ts` (the decision), `src/screens/SafetyScreen.tsx`, and the guard
wired into the bench, the reaction sheet and the substance sheet. What it does:

- **One pure function, four entry points.** `guardBench(bench, store, ctx, rxId?)`,
  `guardReaction`, `guardSpecies` and `controlCensus` all read only the shipped records plus a
  three-field context — `hood`, `supervised`, `room_flammable_mL` — which is on the Safety tab and
  in localStorage (`chemlab.guard_ctx.v1`), because whether you have a fume hood is a fact about
  your room and changes the answer. Nothing in the guard knows a substance's name.
- **A finding is a record, not a colour.** `{level, head, text, action, from, limit, species_ids}`:
  `level` block/warn/note, `action` what to do instead, and `from` the exact key path in the data
  (`tables.safety_limits.max_no_hood_gram`, `safety_index.species_hazard5`, `lab.mixing_rules[7]`…),
  printed under every finding. The limit's own provenance is re-printed through `ProvLine`, so a
  policy limit reads as a policy: *"curated (school-lab practice limits) · they are policy, not
  nature."*
- **`checked` distinguishes "within the limit" from "nothing to check".** NaCl 20 g + KNO₃ 10 g
  with the hood off comes out clear: the gram cap is *within the limit*, the flammable-room total is
  *nothing to check*, and the last line says all 23 mixing rules were tested and none of them match
  the two bottles. Water alone against the acid-dilution minimum is `checked: false` — "this only
  bites when a concentrated acid is being diluted" — rather than a false alarm.
- **Quantities are measured through the bottle, not assumed.** 40 mL of the HCl stock is judged
  against `max_no_hood_gram` as *18 g across 1 hazard-3-or-listed substance* (molarity × volume ×
  molar mass from the record), and the dilution rule counts *2 volumes each way against the 4 the
  data sets*, both ways because the data's sentence says "each way".
- **The mixing rules are matched by phrase, and the app says which ones it cannot use.**
  `ruleApplicability` puts each rule's parenthetical examples first (`bleach + acid (any: HCl,
  vinegar, H2SO4)`), then the rule's own phrases, then significant words — with class words
  ("acid", "base", "salt") never allowed to stand in for a named substance, and a token shorter
  than four letters accepted only as an exact formula. 16 of the 23 rules can act on a bench; the
  other 7 (they are about heat, the vessel, light, skin or air) are listed with the reason, on the
  Safety tab, instead of being silently dropped.
- **Controls: no unknown tokens.** `CONTROL_VOCABULARY` is a 14-token list and
  `controlCensus` sweeps all 424 records: **0 controls the app has no rule for**. A token that did
  appear in the data but not the vocabulary would be rendered as "this app has no rule for it".
- **A refusal is the result.** For `app_bleach_acid_warning` and `app_bleach_ammonia` the reaction
  sheet keeps the equation, the observations and the energy, and takes away the route and every
  quantity, in a card that names what is missing ("what is not printed here"). The bench shows
  "no quantities on this bench: the record forbids a scale" and "2 bottle(s) shown without any
  numbers", and the *notebook* refuses to write them back in. `not_a_shelf_reagent` bottles
  (`elem_tc`, the display-only and video-only records) are unreadable as a procedure and readable
  as data.
- **First aid, waste and storage are derived from the same record, never looked up by name.**
  `firstAidFrom` returns the GHS H-code advice the species actually carries (H318 on sodium
  chloride says "if swallows", so that is what prints); `wasteFor` and `storageFor` go through the
  element's waste class and the hazard list, and say which link made it apply — "the element Pb in
  the class title is in this record".
- **Verified by `tests/guard.test.ts` (23) and 19 render tests**: every blocked list, the NaCl
  false-positive check, the room total with an empty bench, the gram cap through the stock bottle,
  the dilution ratio, first aid with and without a label, and a sweep over all 424 reactions
  asserting that every `hide_scale` record says what it withheld and leaks no apparatus string and
  no "g per mole of reaction" into the DOM.

## Prompt 11 — every element pair, and the notebook

> The combinations browser: filter the 9410 rows by pair, by status (verified / empirical /
> predicted / none), by "has an emf"; a row shows the formula the valence rules give, the
> states used, mass, Δχ, % ionic character, the emf chain when present, and the `why` for
> `none` — with the status word rendered in the same honest style as everywhere else. Then the
> notebook: save a mixture with its inputs and every verdict the app made, list and reopen
> them, export as JSON, import back. Nothing leaves the device (localStorage), and the export
> includes the data build id so an old note says which data it was made against. Verify: the
> export/import round-trip test and a Na–Cl row check.

**Delivered.** `src/lib/combos.ts` + `src/screens/CombosScreen.tsx` (the browser, reached from the
Shelf tab's second mode, "every pair"), `src/screens/CombinationSheet.tsx` (the pair's sheet, now
what every `combination` link on the table, the series and the cell screens opens), and
`src/lib/notebook.ts` + `src/screens/NotebookScreen.tsx` (the notebook, the Bench tab's second
mode).

- **The browser holds all 9410 rows and admits it cannot show them.** The default page caps at 200
  rows with a "show 800" step and a 2000 ceiling — "a phone screen is not a spreadsheet" — and the
  line above the list always says how many matched: `every pair in the file: 9410 · 9,410 rows match
  the filters, the first 200 are listed below`. Filters: the four status words with their counts on
  the button, "has an emf (156)", "has a verdict (156)", a sort by pair / mass / emf / % ionic / Δχ
  with a direction toggle, and a query that reads element symbols **case-first** so `CuSO4` is
  Cu+S+O and not the nonsense C+U+S+O that lower-casing first gives. A run of symbols is matched as
  an atom set first; when no row is made of exactly those atoms the app shows the two-element pair
  instead and says it did.
- **Every row shows the whole model, and the status word is the data's.** Formula (with the reduced
  Hill formula when the valence choice needed reducing), the oxidation states used, mass, Δχ,
  % ionic, and the emf chain when present — `emf 4.068 V`, `log K 68.8`, `ΔG -392.5 kJ/mol of
  product`, `verdict: combination strongly favoured`, each with its own `ProvLine` and the row's own
  `note`/`why` underneath. A `none` row prints the data's sentence ("He is a noble gas: no binary
  compound of it exists under lab conditions, so there is nothing to mix") in the same typography as
  a number, and the 5789 `predicted` rows print their `why_no_verdict` so the majority of the file
  never looks like a blank row.
- **The legend is the point of the screen**: the four words with what each buys you, plus the audit
  line the app computes for itself — 75 rows point at a shelf record, 156 carry an emf, 9410 rows
  exist — checked against the file's own `meta` block, with a warning printed if they ever disagree.
  Right now they agree, and the check is in the test so it stays true.
- **A pair sheet ends in the cells that pair could be.** If both elements have a metal-strip couple
  the app lists *every* couple pair from `tables.e0` (Cu–Cl gives Cu⁺/Cu and Cu²⁺/Cu against
  chlorine, sorted by emf) and tapping one loads the cell builder; if one of them is not a strip,
  it re-reads the two couples the row itself names and says that is where they came from. If there
  is nothing to compare, it says there is nothing to compare rather than inventing an electrode.
- **The notebook saves the verdict, not just the mixture.** `captureNote` freezes the bench
  (substance, amount, unit, the molarity the bottle carries), the mix's branch/status/status line,
  every guard finding with its `from`, the numbers with their bases, the context (hood, supervision,
  room flammables) and the data build. Saved runs live in `chemlab.notebook.v1` on the device and
  the export is a JSON file headed `{app: "chemlab-notebook", version: 1, exported_utc, build_id}`.
  Reopening puts the bottles back, restores the context, and shows the verdict as saved next to the
  verdict the app reaches today, with "written against different data" when the build id differs.
  `export as JSON` / `import a file` are on the notebook card; there is no server to send anything
  to. The bench, the pH card and the cell card each have their own save button.
- **Import never throws and never drops quietly.** `decodeNotes` reports `not JSON: …`, `no notes
  array in this file`, `the file says it is from "other-lab", not from chemlab-notebook`,
  `written by notebook version 3; this app reads up to 1`, `note 3 ("…"): not an object, dropped`
  and keeps everything it did understand; a bare array of notes opens fine, an empty array is an
  empty notebook, and a hand-broken localStorage entry cannot crash the app on the way in because
  the store reads it through the same decoder.
- **A note must not undo a refusal.** If the guard hides the scale, `captureNote` records
  `quantities · withheld · the guard hides the scale for this reaction (…)` instead of the moles,
  and any bottle named by a blocking finding is written as withheld even when the rest of the bench
  is scalable.
- **Verified by `tests/combos.test.ts` (19), `tests/notebook.test.ts` (22) and 10 new render
  tests**: the Na–Cl row field by field against the file (58.44 g/mol, Δχ 2.23, 71.2 % ionic with
  its "rule of thumb" note, 4.068 V from `Na+/Na` and `Cl2/Cl-`, log K 68.8 per mole of electrons,
  −392.5 kJ/mol of product, `nacl` on the shelf, no reaction record with it as a product); the
  status counts 72 / 3 / 5789 / 3546 summing to 9410; every emf row carrying log K *and* ΔG *and* a
  verdict; no `none` row carrying a formula and no `none` row without a reason; 0 dead species
  links out of 75; sort direction and the cap; the export/import round trip through a real file; and
  both sheets rendering with no `undefined`, no `NaN` and no `[object Object]`.

## Prompt 12 — ship it

> Service worker: precache the shell and the data files, cache-first for data, network-first
> for the manifest, with a "new data available" note when `manifest.json` changes; install
> prompt and `display: standalone`; icons generated from the element swatch palette, an adaptive
> mask, and no external font or CDN (the preview iframe has no network and neither should the
> app need one). A perf budget the CI can check: first paint from cold on the built bundle,
> total transfer ≤ 1.5 MB, JSON parse + index < 1 s on a mid-range phone (measured with
> `performance.now()` around the loader and asserted in a test as a sanity bound). Then the
> Android path: `docs/BUILD_ANDROID.md` with the exact Capacitor commands, and README/PLAN
> updated so the data layer and the app agree on what exists. Verify: `vite build`, the
> budget test, and an offline check by serving `dist` with the network disabled in devtools.

**Delivered.** `public/sw.js` (by hand, so the rules are readable), `public/manifest.webmanifest`,
`scripts/make-icons.mjs`, `scripts/prune-dist.mjs`, `scripts/gen-sw.mjs`, `src/lib/sw.ts` +
`src/components/Ship.tsx`, `src/lib/links.ts`, and `docs/BUILD_ANDROID.md`.

- **The budget is measured, not claimed.** `npm run build` ends with the two scripts that decide
  what ships, and `tests/ship.test.ts` recomputes the whole number from the files on disk:
  **1.345 MB** gzipped for the first load — 374 KB app, 19 KB CSS, and 1.27 MB of the warehouse,
  which is 95 % of the payload and the honest shape of it. The `.gz` files are counted as they are,
  not re-gzipped to flatter the figure. Parse + index of all 9 410 combination rows and 581 species:
  **168 ms** here, against a 1 000 ms bound the same test asserts, and the *Data* tab prints the
  real numbers from the loader's own timings.
- **`scripts/prune-dist.mjs` takes 16.4 MB back out.** `npm run sync` keeps an uncompressed JSON
  copy for the dev server and for reading in an editor, but the loader asks for the `.gz` and only
  falls back, so shipping both means a phone carries two copies. There is a test asserting the plain
  JSON is *not* in `dist`, and one asserting the loader still prefers the `.gz`, so the two cannot
  drift apart.
- **The precache list is generated from the build, and checked against it.** `gen-sw.mjs` rewrites
  `public/sw.js`'s placeholder with the files actually in `dist` and names the shell cache after
  `manifest.json`'s `build_id`, so a new build cannot serve an old shell. `tests/ship.test.ts` fails
  if the worker's list and the files on disk disagree in either direction — that is the failure mode
  of hand-maintained precache lists, and it is silent in a browser.
- **The worker was tested by running it, not by reading it.** `tests/sw.test.ts` loads `dist/sw.js`
  into a fake scope with a fake `caches`, `fetch` and `clients`, and drives it: the data files are
  answered from the cache with **no network call at all**; an uncached one is fetched exactly once and
  then kept; a cross-origin request (a font, a CDN, anything) is refused with `Response.error()`; a
  cold start with no network still serves `index.html` for any path; `caches` from an older build are
  deleted on activate. **This harness found a real bug**: `manifestResponse` read the cached manifest
  *after* storing the fresh one, so `stored` was always the new build id and "new data available"
  could never fire. The cached copy is now read first, and the test asserts both the ordering and the
  message.
- **The update path ends in the UI, and the seam between them is a tested function.** The worker's
  messages are folded by `applyShipMessage` (pure), and `newDataAvailable` / `shipPill` /
  `shipSummary` decide what the header pill and the *Data* card say — the same functions the test
  feeds the worker's own messages into, so a change in message shape fails a test instead of quietly
  showing the user nothing. The app never reloads itself: a waiting version is offered, in words
  ("data af49… was fetched; nothing on screen changed"), and the reload button is the user's.
- **Icons drawn by the build, from the app's own colours.** `make-icons.mjs` rasterises the nine
  `--cat-*` swatches into 192/512/maskable-512/apple-touch/favicon PNGs (a hand-written PNG encoder —
  no image dependency in this repo) plus the same shape as SVG; the maskable variant keeps every tile
  inside a circle's inscribed square. `tests/ship.test.ts` reads the PNG headers and checks each file
  is the size the manifest declares, that a `maskable` entry exists, and that `theme_color`,
  `background_color` and the page's `theme-color` are all the CSS `--bg` value — so the icon palette
  and the app palette cannot drift.
- **Deep links, because the manifest's shortcuts needed them.** `src/lib/links.ts` is one parser for
  `?tab=`, `?bench=nacl:20g,hcl:5mL@2`, `?species=`, `?pair=`; it refuses a unit it does not know
  rather than guessing, caps at four bottles and says so, and reports what it could not read instead of
  dropping it. The header's "copy a link to what is on screen" writes the same format, and a test
  checks the manifest's shortcut URLs parse with it, so the shortcuts cannot rot into 404s.
- **Android, in one file.** `docs/BUILD_ANDROID.md` gives both paths: *Add to Home screen* (nothing
  to build), and the exact Capacitor commands with the icon swap, the `assembleDebug`/`bundleRelease`
  lines, the note that no permission is needed and that the APK is ~4 MB because 2.6 MB of it is this
  app. It states the one command that updates the science and rebuilds the phone copy.
- **Checked, in this order**: `node --check dist/sw.js` (a worker with a syntax error fails silently
  on the phone, not loudly here), the built `index.html` has no cross-origin `src`/`href`, the built
  CSS has no `url(http` and no `@import`, and `npm run check` is green: `tsc --noEmit`,
  **205 tests in 13 files**, the build. What I could not do here is the airplane-mode test on a real
  phone — the offline behaviour is verified by driving the worker against a fake cache, and the doc
  tells the user how to check it on theirs in thirty seconds.

## Prompt 13 — every reaction, and one search box

> The reactions browser: all 424 records, browsable the way a teacher picks a practical — by the
> data's own `categories`, by `tags`, by `record_type` (equation vs process), by what the record can
> answer (has a balanced equation, has ΔH — curated or re-added from the ledger, has kinetics /
> equilibrium / electrochem extras, lists observations, has a `teaching_note`), and by hazard (danger
> ≥ 3, needs a hood, blocked, has controls). Sort by name, danger, |ΔH| or category. Every row prints
> what the record *has* and opens the reaction sheet that already exists; the coverage census above the
> list is computed from the rows, not written by hand, so the browser never looks like a complete
> catalogue when it is not. Then one search box in the header over the whole warehouse — elements,
> substances, reactions, element pairs and saved notebook entries — through the index in
> `src/data/search.ts`, with the kind of every hit printed, because a hit for `Na` and a hit for
> `na` are not the same claim. Verify: the census numbers match a sweep of the file; every id the
> browser links to exists; the query "nacl" returns the substance, the Na–Cl pair row and the
> precipitation reaction; a query with no hits says so in the same typography as a hit.

**Delivered.** `src/lib/reactBrowser.ts`, `src/screens/ReactionsScreen.tsx` (+ `reactions.css`),
`src/lib/searchAll.ts`, `src/components/FindBar.tsx` (+ `find.css`), a 7th tab (`repeat(7,1fr)`) and a
4th manifest shortcut. New tests: `tests/reactbrowser.test.ts` (23) and 8 more in `render.test.tsx` —
**237 tests in 14 files**, `tsc --noEmit` clean, build measured at **1.352 MB** (up 4 KB).

- **24 facets, in the three groups a person actually thinks in** — *what you see* (a gas, a
  precipitate, a colour change, light or a flame, heat you can feel, a sound, a timescale), *what the
  record can answer* (a balanced equation, ΔH re-added from the ledger, ΔH as published, both and
  whether they agree, a named temperature, a timescale, K, E°, a yield, a teaching note), and *hazard
  and control* (danger ≥ 3, controls, needs a hood, a maximum scale, a refusal, named apparatus). Each
  button prints its count, and the test asserts every one of those counts against a sweep of the file
  done inside the test, so a facet cannot quietly stop meaning anything.
- **The census table under the list is the same arithmetic, in words**: "a hazard score 79/424 — the
  others carry none, which is not the same as carrying none", "a refusal 2/424", "a curriculum
  appearance 0/424".
- **The counts count values, not keys.** The first draft advertised 207 re-added ΔH figures; the data
  has `thermo_derived.dH_rxn` *present* on 207 records and a *number* on 111 — the same trap as
  `predicted_emf` in prompt 11. True numbers now pinned: curated 29, both 25, any ΔH 115, colour
  change 227 (not 269, which is how many observation *lines* there are), danger ≥ 3 is 42, hood 4.
- **A facet that returns zero is kept when zero is the truth**: "the atom count disagrees" matches
  nothing, because the build re-counted all 207 equations and all 207 balance. It stays as a tripwire —
  if a rebuilt record stops balancing, that filter starts returning rows.
- **Sorting respects absence.** Danger ascending runs 2 → 3 (the file's lowest score is 2; nothing here
  is scored harmless) and the 345 records with no score go last in *both* directions — an absent figure
  is not a zero, and that was the first bug the sort test caught.
- **One box, four stores, and the kind of every hit printed.** `nacl` → "40 hits: 8 bottles on the
  shelf, 31 reaction records, 1 element pair"; `7732-18-5`, `H2O` and `water` reach the same bottle, as
  does `rectified spirit` → ethanol (285 species carry aliases). The index is a word-set match, not a
  phrase match, so a multi-word query says "a hit carries at least one of those words, not necessarily
  all" rather than pretending to be precise; the cap reports what it left out; and zero hits is a
  sentence about what the index covers, in the same type as a hit.
- **Your notebook is searchable, and its hits behave differently on purpose**: a saved run is not a
  record, so tapping one puts the bottles back on the bench instead of opening a sheet. `openTarget` is
  a function, not a switch inside the component, so the routing itself is what the test covers —
  including a hit whose id the data does not have, which is refused in words instead of opening blank.
- **What is deliberately not hidden:** the browser shows `no ΔH in the record` on 309 of the rows and
  the census says why, and the search will not guess a substance from a near miss.
- **Could not check here**: no browser in this sandbox, so the thumb-feel of seven 51 px tabs at 320 px
  and the drop-list under a soft keyboard are unverified by eye; the screens are verified by rendering
  them (120 rows, no `undefined`/`NaN` in the markup, every row's name reaching a sheet that exists) and
  the preview on :8080 serves the build for you to feel.
- **One data gap, deliberately not patched in a screen**: four apparatus names in reaction records —
  `filter-paper`, `lid`, `nichrome-loop`, `white-paper-cross` — are not in `tables.apparatus`, while
  `safety.unregistered_apparatus`, the field whose job is exactly to say so, is empty on all 424. The
  browser prints the count and the names; the fix goes in `data_curated/tables.py` and is scheduled
  with prompt 15's sweep, and `tests/reactbrowser.test.ts` fails until that list is emptied.

## Prompt 14 — the practical work: schemes, techniques, kits and the syllabus index

> The part that makes it a lab and not a lookup table: `lab.cation_scheme` (group 0–VI as a guided
> run: reagent, what precipitates and why, the confirmatory tests), `lab.anion_scheme`,
> `lab.organic_tests`, `lab.paper_tests`, `tables.techniques` (15, with their apparatus and steps),
> `lab.kits` (10), `lab.curriculum` (the CBSE/undergrad index) and `lab.troubleshooting` — each one
> reachable, each step showing the observation the data expects next to the box you tick, each
> experiment offering "put these bottles on the bench" (which runs the guard before it lets you),
> every piece of glassware quoted with the tolerance the data carries, and no procedure printed for a
> record the guard blocks. Verify: every `react`/`app` id named by a kit, technique or curriculum
> entry resolves to a real record, and the ones that do not are listed as gaps in the data rather than
> hidden; the cation tree's group reagents are the same bottle ids the shelf has.

**Delivered.** `src/lib/practical.ts` (all of it, over the shipped document — nothing re-typed from a
handbook) and `src/screens/WorkScreen.tsx` + `work.css`, wired as the 8th tab; `src/lib/guard.ts` reused,
so a scheme step that would mix bleach with acid says so before it shows you the beaker. New tests:
`tests/practical.test.ts` (12) and 3 more in `render.test.tsx` — **252 tests in 15 files** at the end of
this prompt, `tsc --noEmit` clean.

- **What the tab holds, and what the file actually answers.** 7 cation groups (0–VI) with the reagent,
  the precipitate, the reason and the confirmatory tests; 3 anion blocks; 27 organic tests; 10 paper
  tests; 15 techniques of which 3 carry real step lists and 12 name only their apparatus; 10 kits;
  4 curriculum groups holding 43 experiments (`[11, 17, 4, 11]`); 10 troubleshooting rows. Every one of
  the 62 reaction ids the schemes and kits name resolves to a record the app can open.
- **The quantity a technique asks for is quoted with the glassware's own error.** `measuresIn()` looks
  up each apparatus row and, if the row carries a tolerance, says "± 0.1 mL out of 25.0 mL, 0.40 % of
  its own capacity" next to the step that uses it. A burette has a published tolerance; a funnel has
  none, and the screen prints "no tolerance in the register" rather than inventing one.
- **A refusal is a result, including here.** A curriculum experiment whose reaction the guard blocks
  shows the block and the reason, and the "put these bottles on the bench" button is not offered — a
  test proves it by mutating a copy of the document so a blocked reaction sits inside a kit.
- **Nothing free-text is assumed to be a sentence.** `lab.cation_scheme` group VI stores `confirm` as
  a dict keyed by the ion it confirms, so `prose()` renders str / list / dict alike (keeping the key in
  front of the value) and `confirmItems()` keeps the ion attached to its test. An earlier render printed
  `[object Object]` for exactly that row; there is a test that fails if it comes back.

## Prompt 15 — close the loop: the apparatus shelf, and an audit of every path

> The last two surfaces and one hard sweep. The apparatus and materials shelf: `tables.apparatus`
> (159) and `tables.materials` — what each piece is for, what it costs in error, what it must not be
> used for, and which techniques and kits call for it, in both directions. Then the audit: every
> screen reachable from every other, every link in the app pointing at a record that exists, no stub
> text left anywhere, README/PLAN/ROADMAP and `docs/` agreeing on what exists, and `npm run check`
> (typecheck, every test, the build, the transfer budget, the parse budget) green from a clean
> checkout with `public/` regenerated from `../data`. Verify: an automated reachability test walks the
> whole app from the six-and-one tabs and reports zero dead ids and zero "later prompt" strings.

**Delivered.** `src/lib/apparatusShelf.ts` + `src/screens/ShelfApparatus.tsx` (+ `shelfApparatus.css`),
as the 6th Work section — the register read backwards — and `tests/reach.test.tsx` (24 tests).
**276 tests in 16 files**, `tsc --noEmit` clean, build measured at **1.365 MB** (993 KB + 252 KB of
that is the two gzipped data files), data build id `efa5ab05e93e`.

- **The shelf, backwards.** `shelfRows()` walks `tables.apparatus` — 192 rows, assembled by merging the
  60 class-A glassware rows with 137 curated accessories, five of which name the same piece twice —
  and for each piece collects which techniques call for it, which kits list it, how many
  curriculum experiments need it and which reaction records name it. 27 rows carry a tolerance, with
  its source and confidence; the other 165 say "nothing measured". A note that reads like a limit
  ("not for hot liquids") is lifted onto its own line as a limit, because that is what it is.
  Three rows are asked for by a technique, 78 sit in a kit, 17 in the syllabus index and 99 are named
  by a reaction record; 29 are asked for by nothing at all, and the screen says so rather than dropping
  them. `materials()` does the same for the 8 consumables, naming the reactions and kits that ask for
  each.
- **Reachable both ways, as asked.** The section is in `Work`'s pill list (`glassware (192)`) and the
  same rows back every apparatus chip inside the techniques, kits and schemes; a test asserts the
  register's own census is the number printed on the pill, so the count cannot drift from the rows.
- **The audit is the thing that found the bugs.** It renders every screen for all eight tabs, every
  sheet for every record the app can link to (582 substances, 424 reactions, 118 elements, all the
  combination rows and sampled bench pairs), round-trips every link the app can write through the real
  URL parser, and then strips comments out of `src/`, `index.html`, `public/sw.js` and the manifest and
  fails on `later prompt`, `not implemented`, `TODO`, `coming soon`, `to be written`, `placeholder text`
  or a bare `prompt N`. That last sweep immediately caught a capability chip worded as "not implemented
  by this app" — honest in meaning, indistinguishable from a stub in wording, so the chip now says
  "the guard has no rule for it".
- **And it found two real ones in the data, which is where they were fixed.** A `lab.stock_bottles`
  row named species `khp` — potassium hydrogen phthalate, the primary standard — and the shelf had no
  such record, so the bottle could never be put on the bench: `data_curated/species.py` gained the
  row, the build computed 204.222 g/mol from CIAAW weights (the bottle's own note says 204.22, and
  that agreement is the check), and the warehouse is 581 → **582** species. The other: heavy water's
  `elements` map says `D: 2`, which is not an element row, so the element index never listed `d2o`
  under hydrogen; `scripts/lib/periodic.py` now maps isotope shorthand to its parent element **for the
  index only**, and `d2o` keeps its D count because that is what makes its molar mass 20.03 rather than
  18.02. The audit allows D and T only because `H.isotopes_natural` really lists mass numbers 2 and 3.

Two gaps are already known and must be fixed in the data, not in a screen. (1) The four apparatus
names above: add them to `data_curated/tables.py` with `tolerance: null` and rebuild — the tripwire is
"the ids the browser links to" in `tests/reactbrowser.test.ts`. (2) Any `lab.kits`, technique or
`lab.curriculum` id prompt 14 finds dangling gets the same treatment: the table changes, the build id
changes, and the screens are re-measured rather than excused.

## Prompt 16 — ask for a substance, get every way the lab can make it

> The last missing surface is the one the whole warehouse was assembled for: a box you can type into.
> "make water", "i want an acid", "give me something that glows", "make silver chloride the way they do
> it industrially" — and the app answers with **the routes**, not with a chat. `src/lib/planner.ts`
> takes the words, resolves them to target species through the shipped names, formulas, CAS numbers and
> element/class buckets, then searches for every way the warehouse can produce each target, and shows the
> search itself: what it tried, what it refused, what it could not reach, and how far it looked.
>
> What "the lab" means, measured, because this prompt lives or dies on these numbers: 424 reaction
> records, of which **207 have both sides resolved to species ids** (the 217 process records describe
> things an equation cannot carry — rusting, a group-separation scheme — and are shown as procedures with
> no yield offered); those 207 produce **151 distinct species**, so the other **431** records on the
> shelf have no producing reaction in this data at all; **129** of the 151 are makeable in a single step
> from the 439 cupboard rows (24 stock bottles plus every weighable solid/liquid/gas/aqueous record);
> 42 targets have three or more routes and `water` alone has 64 producer records; the guard blocks 2
> reactions outright. The planner must print all of that ceiling as plainly as it prints a plan — "the
> lab can make 151 of its own 582 records" is the honest answer to "it should make anything".
>
> A route is a **tree, not a sentence**: each step names the reaction record it comes from, the bottles
> it needs (each either already in the cupboard or produced by a step below it), the quantities this app
> computes from the real stock concentrations and the glassware's own tolerance, the observations the
> record promises, and the guard's verdict on that step before the next one is allowed. Ranking is by
> what the data supports — fewest steps, fewest hazard-3 pieces, whether every term has a curated value,
> whether an emf or ΔH closes end-to-end — and the ranking is printed as numbers with their reason, never
> as "best". `khp`, `h2so4`, `agno3`, `o2`, `kmno4`, `caco3`, `water` each get a test that walks the whole
> route tree and finds no step whose input is neither on the shelf nor made above it.
>
> Two refusals are results here, and are the point. (1) A target nothing produces: the planner says the
> warehouse has no producing reaction for it, names the record count it searched, and offers what it
> *can* do with that substance (its bottle sheet, the reactions that consume it). (2) A target only
> reachable by a blocked or hood-required route: the plan is shown, the step that fails is where it
> stops, and the quantities for that step are withheld — the same rule the bench and the notebook
> already obey. No step may be invented to close a gap: if the last hop is missing, the tree ends in an
> explicit "nothing here makes `X`" leaf.
>
> Verify: a phrase set (say 40 sentences, half of them deliberately unmappable) run through the parser
> resolves to the target ids the data actually has or says it could not resolve, with no silent guess —
> an ambiguous phrase returns the candidates as chips, and the number of candidates is the number of
> candidates the file supports, asserted from a sweep; every plan renders at 320 px without a horizontal
> scroll and every "run it on the bench" handoff lands on a bench that the guard has already cleared;
> enumeration is bounded (a `cap` on nodes visited) and a test asserts the bound is what a full sweep of
> `water` needs, so the phone never waits on an unbounded search; `npm run check` green from a clean
> checkout.

## Notes from building it (things the data layer had to answer for)

- **Prompt 6/7 found a real gap in the warehouse.** `tables.THERMO` carried ΔfH = 0 for H₂, O₂,
  N₂, Cl₂, Br₂, I₂, S and C but not for the metals — so 126 reaction ledgers said "no dHf entry
  for Mg" when the missing term was an element in its standard state, where zero is a definition,
  not a measurement. `data_curated/tables.py` now adds those zeros (entropy and heat capacity
  deliberately left null: those *are* measurements and are not curated here). Complete ledgers went
  from 81/207 to 111/207 and the build's curated-vs-derived cross-check still reports 13 agree, 0
  disagree.
- **A mislabelled constant.** `molar_vol_SATP_25` was 24.789 "L/mol at 298.15 K, 1 atm": 24.789 is
  the value at 1 **bar** (at 1 atm it is 24.46). The units string is now corrected, and the app's gas
  panel refuses to call an arbitrary T and P a "convention" — it names the tabulated one only when
  the numbers actually coincide within 0.5 %, and otherwise says how far away the nearest shortcut
  is and why.
- **`thermo_curated.dH` is per mole of product, not per the equation as written** for several records
  (MgO −601.6 vs the ledger's −1203.4 for `2 Mg + O2`). The build already stores a `cross_check`
  naming the basis it matched on; the heat panel quotes the curated figure only when every
  coefficient is 1, and says why when it will not.
- **A hang the render test caught.** `groupCount()` with an empty group spun forever on zero-width
  regex matches, which the bench hits whenever an ion pair has no Ksp row. Guarded, and now covered
  by a test that renders the Q-vs-Ksp card.
- **Prompt 9 found a second ambiguity the table text cannot settle on its own.** `resolveSide` has to
  read `MnO4-` as permanganate and `Hg22+` as mercury(I), and both readings of those strings are
  arithmetically legal. The `aqueous_ion` records are now the tie-breaker in code, so the couple keys
  stay as published while the app resolves them — no re-typing of the 87 keys was needed.
- **A display string must never be a lookup key.** Prettifying labels to Cu²⁺ broke the concentration
  match and silently left Q at 1, and it took a test that moves the pH field to notice. The engine now
  keeps two fields on every side: the caret-canonical label it matches on, and the pretty one it shows.
- **`derived.displacement.logK` assumes n = 2 for every pair** (its own note says so). For most pairs
  that is the truth; for the 96 rows where the app's couple choice lands on `ClO3-/Cl-` or
  `MnO4-/Mn2+`, the shipped figure is exactly a third of the derived one. The series screen shows
  both numbers and the reason, instead of quietly reproducing the assumption — and the data row is
  left alone, since it is labelled, not wrong.

- **Prompt 11 found three ways the browser could have lied, and fixed them in the code, not the copy.**
  The combinations file has 9410 rows but only 6903 pairs — a third of the pairs carry several
  oxidation-state choices — so `combosByPair` is keyed under both the sorted key and the string the
  row itself carries, or a link from the reaction table to `Mn-B` finds nothing. `predicted_emf` is
  a key on *every* row and null on 9254 of them, so counting rows that have the key would have
  printed 9410 rows with an emf; the app counts non-null values and gets 156, which is what the
  file's header claims. And `g(2.23, 2)` printed Δχ as 2.2: two significant figures rounded a
  two-decimal data value into a different number, so Δχ now prints at three.
- **The app's own confidence label was wrong on 480 warehouse records and 5864 combination
  masses.** `confidence: "high"` rendered as "as published", but those records also carry
  `basis: "computed"` — molar masses re-added from CIAAW weights are confident and they are not
  published measurements. `view()` now prints "computed here" whenever the basis (or the source,
  where there is no basis) says the build did the arithmetic, which is rule 1 doing its job on a
  label nobody had looked at.
- **The notebook inherits the guard's refusals.** Making "save this to the notebook" work on a
  refused bench meant deciding what a note is for: it is a record of what the app said, so a note
  that quietly wrote the withheld grams back in would have undone the refusal the moment the user
  reopened it. There is a test for exactly that, and it fails if someone makes captureNote helpful
  again.

- **Prompts 14 and 15 emptied the apparatus gaps, in the table rather than on the screen.** The
  reaction records named 32 pieces of kit that had no register row (`retort_stand`, `wire_gauze`,
  `decanter`, …), and `tables.apparatus` grew from 159 to **192** rows by appending 132 curated
  accessories to `data_curated/lab.py` — each with `tolerance_mL: null` and a source line saying the
  row records what the thing is *for*, not a measured error. The build's splitter
  (`APPARATUS_KIND.split_apparatus`) now routes anything it cannot resolve to an `unknown` bucket, so a
  junk token can never reappear as a display name, and `Wash_Bottle`-style labels are gone because a
  record's display name is its id tidied (`re.sub(r"[_-]+", " ", aid).title()`). The data gate now
  catches this class of bug itself: `check_safety_links` in `validate_warehouse.py` used to treat a kit's
  membership as registration (`gl = apparatus | kit ids`), which is why 32 dangling ids could pass the
  validator for a whole prompt. It now checks every id-shaped apparatus token in the reactions, the kits,
  the syllabus index and the techniques against the register and `materials` alone — 192 rows, 16 checks,
  0 failures — and skips prose, because "a porcelain dish with an inverted funnel" is a sentence, not a
  reference.
- **Three tokens were wrong in the source, not in the app.** `TECHNIQUES["filtration"]` asked for
  `filter_paper_q`, a name no row had, so it now asks for `filter-paper`; the melting-point
  determination in the syllabus index asks for `capillary_tubes` where the register says
  `capillary-tubes`; and the same experiment asks for a `thiele-tube`, which had no row at all until
  one was written into `ACCESSORIES` with the description the register keeps. Fixed in
  `data_curated/tables.py` / `lab.py`, rebuilt, and
  `npm run sync` — dangling references across the whole document are now 0, which the audit asserts
  independently of the build.
- **A gap list is only honest if it says what it counted.** `practicalGaps()` first reported 38 gaps
  because kit membership was treated as registration. The real number was 32 missing kit ids, and the
  rest were technique fields that are sentences rather than references: one technique, `sublimation`,
  whose apparatus list reads "a porcelain dish, an inverted funnel, a cotton plug". Both halves were
  re-measured — the 32 are answered in the register now, and the sentence is rendered as prose and not
  counted as a gap — and `practicalGaps()` returns nothing. The test pins the kit reference count at 92
  and `practicalGaps(store)` at `[]`, so neither number can drift back.

- **The register had 192 rows and was hiding five pieces of it.** `tables.apparatus` is assembled by
  writing the 137 `lab.ACCESSORIES` rows over the 60 `tables.GLASSWARE` rows, and five ids are in both
  tables (`bunsen`, `desiccator`, `eudiometer`, `kipp`, `woulff`). The write-over did not merge: the
  eudiometer lost its 50 mL capacity and 0.2 mL graduation, the Kipp's apparatus lost its 2 L, and the
  class-A notes ("lid slid, not lifted; 5 min cooling before opening or the vacuum sucks the lid down
  hard") were replaced by a shorter sentence. The shelf would have shown five honest-looking blanks
  where the shipped file had numbers. `build_warehouse.py` now keeps the glass row's figures and name,
  takes the accessory's kind only where the glass row has none, and joins the two notes with `·` — the
  row count stays 192, and the 27 rows that carry a tolerance are untouched, because none of those
  five does.
- **Two things the sweep said about the app's own wording.** A capability chip in Safety read "not
  implemented by this app", which is a truthful sentence about scope and reads exactly like a stub; it
  says "the guard has no rule for it" now, beside the count of tokens the guard does act on. And the
  reactions browser's apparatus census carried the phrase "prompt 14 reads it from there" inside a
  user-visible string — a build queue has no business in a screen, so the sentence names the register
  instead. Both are the kind of thing only a sweep over every file finds.
