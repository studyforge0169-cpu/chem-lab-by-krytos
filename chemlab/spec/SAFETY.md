# SAFETY — the guard, and how to say "no" well

The rule for the whole app: **refusing is a screen, not a silence.** A user who is told
"no" without a reason will go to a video site. A user who is shown the enthalpy, the LC50,
the accident and the safe school alternative is being taught chemistry.

## Where the policy lives

It is data, not code, so it can be audited and extended without a rebuild of logic:

| field | use |
|---|---|
| `safety_index.reactions_hard_stopped` | the app must not run these at all |
| `safety_index.reactions_restricted` | display-only: show the record, no "run" button |
| `safety_index.reactions_needing_hood` | run only with the hood flag set |
| `safety_index.species_hazard5` | reagents that need gloves+hood+small scale, or a refusal |
| `safety_index.species_ghs_danger_critical` | bottles whose label opens with a fatal statement |
| `lab.refusals` | the topics refused outright, with the text to show and what is shown instead |
| `lab.mixing_rules` | pair-wise incompatibilities, with severity and what actually happens |
| `lab.ghs`, `species[].ghs` | pictograms, H/P codes, NFPA ratings |
| `tables.safety_limits` | the numeric thresholds the guard compares against |
| `lab.emergency` | first aid, shown whenever a matching hazard appears |
| `lab.waste_classes`, `lab.storage_rules` | what happens after the experiment |

## Evaluation order (do not reorder)

```
1. resolve inputs and candidate reactions            (ENGINE §9 step 1-3)
2. BLOCK check
     reaction.id in safety_index.reactions_hard_stopped          -> refuse
     any input in species_hazard5 and no hood                     -> refuse
     (a,b) in lab.mixing_rules with severity == critical          -> refuse
     quantity > tables.safety_limits.max_no_hood_gram            -> refuse or scale down
     gas is toxic AND vessel closed AND no ventilation           -> refuse
3. WARN check (show, then allow)
     controls contains fume-hood / display-only / restricted
     danger_score >= 3 ; NFPA health >= 3 ; H-codes with H300/H310/H330/H370/H372
4. PPE + procedure line
     from the reaction's safety.apparatus and lab.stock_bottles handling notes
5. compute and display, then always the waste line
```

Refusal must come *before* any quantity is computed, so the app never prints "you would
need 4.2 g of …" for something it will not run.

## The refusal screen

Use the record from `lab.refusals`; it already has the four parts:

1. **what was asked** (echo the user's inputs, without repeating a recipe);
2. **the policy** — `policy` verbatim, first person plural, no moralising;
3. **the real numbers** — from the species records: ΔH, the GHS block, NFPA, LC50-ish
   text from `pubchem["Toxicity Summary"]` if present, and the accident class from
   `lab.mixing_rules`;
4. **what the app will do instead** — `what_is_shown_instead`: normally the same chemistry
   at school scale, or the reference record (e.g. `app_h2s_from_instant` is a deliberately
   blocked record whose `safety` value is `hard-stop-warning`, and `org_hydroboration_ref`
   is a reference-only synthesis).

Copy the pattern from `data_curated/reactions.py::app_h2s_from_instant`: the record exists,
the hazard is spelled out, the sim refuses to generate the gas in an unventilated space and
offers the acidified-dichromate paper test as the displayable chemistry instead.

## Hazard presentation rules

- show `ghs.signal_word` + pictograms + H codes with their text from `lab.ghs.h_codes`; if a
  code has no wording in the table, print the bare code and "wording not in this dataset"
  (that is why `h_codes_unverified` exists — never paraphrase a hazard sentence);
- `confidence: "approx"` numbers must be visibly approximate (show "≈" and the reason);
- NFPA 704 diamond can be drawn from `species[].ghs.nfpa` — it is three integers, so it is
  safe to render and it teaches the rating system itself;
- `hazard_score` 0-5 is the *curated* one-number summary used by the guard; it is not a
  legal classification and must not be presented as one.

## Things the app must never do, even though the data would allow it

1. print quantities for a `refusals` topic, even "for information";
2. offer a "show the full procedure" toggle — there is no such switch, by design;
3. let a user build a *sequence* that is a route (the guard sees one step at a time and so
   misses nothing the user did not type — but it must also refuse when a set of steps in the
   same session matches a `refusals` topic, so keep the session's step list in memory and
   re-run the block check against it);
4. generate images of apparatus set-ups for blocked items (a diagram is a procedure);
5. store or export a blocked input ("share my experiment" must drop those steps and say so).

## Quantities and scales (the numbers the guard compares against)

`tables.safety_limits` — currently: max grams without a hood, max flammable volume in the
room, minimum water for acid dilution, and the two text rules (never mouth-pipette, never
close a vessel generating gas). Each reaction may also carry `scale=` — the maximum the
record was curated for (e.g. "2 mL", "5 g", " demonstration only"). If the user asks for
more than `scale`, the app clamps to it and states that it clamped; silently computing
their bigger number would be the app lying about what is safe.

## After the experiment

Every run screen ends with the waste line: `lab.waste_classes[class].rule` for the class of
each product, plus the `storage` note if the product must be kept (e.g. "do not store
ammoniacal silver — Ag3N detonates on standing"). This is where a virtual lab beats a
textbook: the disposal consequence is part of the procedure, and the app can always show it.

## Emergencies

`lab.emergency` is keyed by the accident, not the chemical. Show the matching entry when a
hazard is *used*, not only when a button is pressed: opening a bromine bottle shows
"bromine on the skin" alongside the GHS block. Where the entry says "then a doctor", the app
says it plainly and does not soften it.

## Test list for the guard (worth automating in the app's own test suite)

| input | expected |
|---|---|
| bleach + vinegar | refuse, quoting the `mixing_rules` row |
| `app_h2s_from_instant` | refuse with the hard-stop text |
| Zn + HCl, 0.2 g, open tube | allow, warn about H2 + flame |
| Na + water, 5 g | refuse (scale), allow ≤ pea-sized, open trough |
| anything from `refusals` topics | refusal screen with all four parts |
| Cu + HCl | allow, "no reaction predicted", show the E° reason |
| NH3 + HCl in a closed flask | allow, warn about pressure + white fumes |
| 250 mL of 1 M H2SO4 made from concentrate | allow, with "acid into water" and the heat estimate |
| session: KMnO4 + glycerol after H2O2 + acetone | refuse at step 2 of the sequence |
