# ENGINE — how to turn the warehouse into a lab that behaves

The data answers "what is it worth"; this file says what to compute and in what order.
Everything here is deliberately implementable from `data/chemlab.json` alone, with no
hidden constants: if a number is needed and the warehouse does not have it, the honest
output is "not modelled", and that is a feature.

## 0. Amounts first, always

```
n = c·V          (solution, from a stock bottle: c = 1000·ρ·w%/M)
n = m/M          (solid, M from species.molar_mass)
n = V/24.0 L·mol⁻¹ (gas measured at RTP - use tables.constants.molar_vol_RTP_20, and say
                    which convention you used: 22.414 at STP(1 atm), 22.711 at STP(1 bar),
                    24.055 at 20 °C, 24.789 at 25 °C - a classic 1.5 % exam error)
```
Then for one reaction record:

```
extent ξ = min over terms of (n_i / ν_i)      (ν from reaction.<side>[].coefficient)
n_left(i) = n_i − ν_i·ξ
m(i) = n_left(i) · M(i)
```
Report ξ and the limiting species. `reaction.grams_per_mol_rxn` is there so a UI can show
"this equation says 316 g of KMnO4 per 2 mol" without recomputing, but the amount maths
belongs to the engine.

Never let a `kind: mixture` species into this loop; offer it only as a demo.

## 1. What you see (rendering)

Order of assembly for one run:

1. solution colours from `species.colour_hex` mixed by absorbance weighting
   (`Beer-Lambert`-ish: `T = Π 10^(-ε_i·c_i·l)` is overkill; `c_i/(c_i+0.02)` weighting is
   enough and looks right);
2. `appears.precipitates` → a solid layer whose colour comes from
   `tables.ion_colour`/`colour_map` and whose amount is `min(Q vs Ksp)`;
3. `appears.gases` → bubbles + the gas-test row from `lab.paper_tests`;
4. `observations[]` codes: `p g c h f s l t n` — render each in its own channel (a colour
   change is animated, a smell/hiss is a caption with a "can't be simulated" mark). Never
   paste them as prose; the codes exist so the app can *draw* them;
5. `heat` → the temperature readout from §3, and a "beaker is warm" hint if ΔT > 5 °C.

## 2. Will it react, and how far

- **Acid/base**: from `tables.pka`/`pkb`. A reaction is "quantitative" when
  `logK = pKa(conjugate acid of base) − pKa(acid) > 3`.
- **Precipitation**: `Q = Π[ion]^ν` compared with `tables.ksp[id].Ksp`. Use activities only
  if you also model ionic strength; otherwise say the number is a concentration product.
- **Redox**: ΔE° = E°(cathode) − E°(anode) from `tables.e0`;
  `logK = nΔE°/0.05916`; spontaneous if ΔE° > ~0.1 V, "won't go" below ~0.05 V without
  overpotential. `derived.displacement` already gives the metal/metal-ion table; use it
  rather than a memorised series, and quote the two couples it came from.
- **Complex formation**: `tables.beta` — this is why NH3 dissolves AgCl and why CN⁻ pulls
  Cu²⁺ out of a sulfide test. Compare `logβ` against the precipitation `logK` when both are
  possible; the bigger wins, which is a real teaching point.
- **Hydrolysis / pH of salts**: use `pka` of the conjugate partner; the dataset marks each
  species with `role` (acid/base/salt) so the tree is data-driven.

## 3. Heat

```
ΔH_rxn = Σν·ΔfH(products) − Σν·ΔfH(reactants)          from tables.thermo / thermo_ion
ΔT = −ΔH_rxn·ξ / (Σ m_i·Cp_i + C_calorimeter)
```
`Cp` per substance from `tables.thermo[...].Cp`, or `Cp_water` for anything aqueous; the
vessel's water equivalent from `tables.apparatus` (`beaker_250` ≈ 150 g of glass ×
0.835 J/g/K). For dissolution use `tables.dh_solution` directly, and note its sign
(NH4NO3 cools, NaOH heats).

Three honesty rules the engine must keep:
1. if any term's ΔfH is missing (`thermo_derived.missing_terms`), say the enthalpy is not
   computed and offer the curated value if `thermo_curated.dH` exists;
2. if `cross_check.verdict` starts with "basis-caveat", tell the user the equation states
   no phase and the standard-state sum is what you got;
3. never present a temperature the apparatus could not measure — ΔT < 0.5 °C with a
   school thermometer is "no measurable rise", which *is* the result.

## 4. Gases

```
V_gas = n_gas·R·T/P                            (ideal; say so)
collected over water: P_dry = P_bar − P_aq(T)  (tables.aqueous_tension_mmhg)
soluble gases (NH3, HCl, SO2, CO2 partly) must NOT be shown collected over water -
species.sol / the 'solubility' text is the reason, and the app should explain it
```
Ignition/limiting checks: H₂ + O₂ in a closed vessel, CO in an unvented room, and any
`danger >= 4` gas go through the guard first (`spec/SAFETY.md`).

## 5. Electrochemistry

```
E_cell = E°_cell − (0.05916/n)·logQ            (25 °C; use tables.constants for other T)
Q from the reaction's own ions/electrons; n from reaction.electrochem.n_electrons
m_electrode = (I·t/F)·M/z                   (Faraday; grams_per_mol_rxn helps sanity-check)
```
Add the two things a real cell always shows: internal resistance/polarisation (a
salt-bridge cell sags under load: model `V = E − I·R_int` with R_int ≈ 1-3 kΩ for a school
cell — flag it as an assumption, not a data value) and overpotential on gas electrodes
(H₂ on Zn ≈ 0.7 V, on Pt ≈ 0), because otherwise "why didn't it work" is unanswerable.

## 6. Kinetics

```
rate = k·Πc_i^order ; k(T) = A·exp(−Ea/RT)
```
The dataset carries timescales (`kinetics.time`) rather than rate constants for most
records — use them as the *displayed* rate ("the cross disappears in 42 s") and only
compute a k where the record has numbers for it. For the thiosulfate clock, the standard
treatment (`rate ∝ 1/t`) is exactly what the record models; keep it and show why.
Temperature: with one `time` at one `T` and a quoted Ea the app can scale by Arrhenius;
without Ea, show "faster/slower, not by how much" instead of inventing an activation energy.

## 7. Error budgets (the part that makes it feel real)

For any measurement, look up the vessel: `tables.glassware[i].tolerance_mL` and
`relative_uncertainty_percent`.

```
burette 50 mL: ±0.05 mL per reading, 2 readings → ±0.10 mL → on 25.00 mL = 0.4 %
pipette 25 mL: ±0.04 mL → 0.16 %
balance (analytical ±0.0001 g; school ±0.01 g): on 0.4000 g KHP → 0.025 % vs 2.5 %
gas syringe 100 mL: ±0.5 mL + aqueous tension + the levels-not-matched bias
```
Report the result as `value ± combined uncertainty` and rank the contributors. Then add
the systematic ones the data knows about: `techniques[*].physics` and
`techniques[*].error_model` (wash losses in gravimetry, indicator end-point vs equivalence
point `lab.indicators`, indicator error `ΔpH → volume error` near a steep curve).

## 8. Titration curves

For a mono/diprotic acid at concentration c:

```
[H+] from charge balance with Ka1, Ka2 (tables.pka) and Kw (tables.kw)
solve numerically (bisection on pH 0-14 is fine on a phone); pH buffer regions fall out
end-point pH = pH at the equivalence volume; pick the indicator whose range contains it
(lab.indicators: pH_low..pH_high), and show why methyl orange fails for ethanoic/NaOH
```
Do not use `pH = ½(pKa − log c)` as the answer — the warehouse already computed the
quadratic version in `derived.weak_acid_ph`, which is what to display when the shortcut is
being taught as wrong.

## 9. Mixing two arbitrary things (the free-play mode)

The app's most dangerous screen, so the pipeline is strict:

1. resolve every input to a species id (formula → `index.by_formula`, name →
   `species.name`/`alias`);
2. find candidate reactions: any record whose reactant set is a subset of what's present
   (also try net-ionic forms; `tag:ionic` records exist for that);
3. run the §2 feasibility tests on each candidate; pick those with logK > 3;
4. run the guard (§SAFETY) before computing anything;
5. if nothing matches: say "no reaction is predicted from the data" and show which test
   failed (solubility? redox potential? pKa?). "Nothing happened" is a result worth
   explaining, e.g. why `Cu + HCl` does nothing while `Zn + HCl` does — with the E° numbers.

## 10. What the engine must refuse to do

- balance an equation the data typed as `process`;
- give a yield for a `reference-only` or `restricted` record;
- fill a null number "from experience";
- show a mechanism arrow-pushing as fact when the record's `confidence` is `approx`;
- run any synthesis listed in `lab.refusals` — see `spec/SAFETY.md` for the response text.
