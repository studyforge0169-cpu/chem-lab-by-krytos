import { useMemo, useState } from "react";
import { useApp } from "../state/app.js";
import { combineRelative, gasVolume, pickBalance, pickGlassware, reactionPlan, runHeat, sigFigs, solutionFromSolid } from "../lib/stoich-panels.js";
import { Computed, ProvLine } from "../components/Prov.js";
import { formula, g, sci } from "../lib/format.js";
import type { IonPair, MixItem } from "../lib/mix.js";
import { precipCheck, rowFromMatrix, solidMolarMass, type Contribution } from "../lib/qsp.js";
import { groupCount } from "../lib/chem.js";

/** The panels under a verdict: how much, how hot, how much gas, and how precisely any of it
 *  was measured. Every number is labelled as computed and says which record it came from. */

export function QuantitiesPanel({ reactionId, items }: { reactionId: string; items: MixItem[] }) {
  const { store, open } = useApp();
  const [actual, setActual] = useState("");
  const reaction = store.reactionById.get(reactionId);
  const plan = useMemo(
    () => (reaction ? reactionPlan(reaction, items as any, actual === "" ? undefined : Number(actual)) : null),
    [reaction, items, actual],
  );
  if (!reaction || !plan) return null;

  const weighings = plan.rows
    .filter((r) => r.side === "reactant" && (r.grams_have ?? 0) > 0)
    .map((r) => pickBalance(store, r.grams_have!));
  const combined = combineRelative(weighings.map((w) => w.relative_percent));
  const worstWeighing = weighings.length
    ? weighings.reduce((a, b) => ((b.relative_percent ?? 0) > (a.relative_percent ?? 0) ? b : a))
    : null;

  return (
    <div className="card">
      <div className="sect">how much</div>
      <table className="t">
        <thead>
          <tr>
            <th>term</th>
            <th>coeff</th>
            <th>g/mol</th>
            <th>moles</th>
            <th>grams</th>
          </tr>
        </thead>
        <tbody>
          {plan.rows.map((r, i) => (
            <tr key={i} style={plan.limiting.includes(r.species_id ?? "") ? { background: "color-mix(in srgb, var(--warn) 12%, transparent)" } : undefined}>
              <td>
                <button className="link" onClick={() => r.species_id && open({ kind: "species", id: r.species_id })}>
                  {formula(store.speciesById.get(r.species_id ?? "")?.formula_written ?? r.label)}
                </button>{" "}
                <span className="small">{r.label}</span>
                {r.side === "product" ? <span className="small"> →</span> : null}
              </td>
              <td>{g(r.coefficient, 3)}</td>
              <td>{g(r.molar_mass, 5)}</td>
              <td>
                {r.have_mol !== null ? g(r.have_mol, 4) : r.need_mol !== null ? <span className="small">needs {g(r.need_mol, 4)}</span> : "—"}
              </td>
              <td>
                {r.side === "product"
                  ? r.grams_yield !== null
                    ? <Computed value={g(r.grams_yield, 4)} unit="g" basis="extent × coefficient × molar mass" />
                    : "—"
                  : r.grams_have !== null
                    ? g(r.grams_have, 4)
                    : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small" style={{ marginTop: 6 }}>
        {plan.extent_mol === null ? (
          "no extent: at least one amount on the bench could not become moles"
        ) : (
          <>
            extent of reaction{" "}
            <Computed value={g(plan.extent_mol, 4)} unit="mol" basis={`min(moles ÷ coefficient), ${plan.per}`} />{" "}
            · limiting:{" "}
            {plan.limiting.length
              ? plan.limiting.map((id) => store.speciesById.get(id)?.formula_written ?? id).join(", ")
              : "nothing runs out first"}
          </>
        )}
      </p>
      {plan.rows.some((r) => r.side === "reactant" && (r.left_mol ?? 0) > 1e-9) ? (
        <p className="small">
          left over:{" "}
          {plan.rows
            .filter((r) => r.side === "reactant" && (r.left_mol ?? 0) > 1e-9)
            .map((r) => `${formula(r.label)} ${g(r.left_mol, 3)} mol`)
            .join(", ")}
        </p>
      ) : null}
      <div className="field" style={{ marginTop: 8 }}>
        <span className="small">actually obtained (g)</span>
        <input value={actual} onChange={(e) => setActual(e.target.value)} inputMode="decimal" style={{ width: "6em", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: ".35em" }} />
        {plan.percent !== null && plan.percent !== undefined ? (
          <span className={"chip " + (plan.percent > 100 ? "chip-warn" : "chip-ok")}>
            {plan.percent > 100
              ? `over 100 %: ${g(plan.percent, 3)} % — the solid is still wet, or the wrong thing was weighed`
              : `yield ${g(plan.percent, 3)} %`}
          </span>
        ) : null}
      </div>
      {combined.rss !== null && worstWeighing ? (
        <p className="small">
          weighing on a {worstWeighing.name.toLowerCase()} (readable to {g(worstWeighing.readability_g, 3)} g, ±
          {g(worstWeighing.uncertainty_g, 3)} g once you count the tare) is {g(worstWeighing.relative_percent, 2)} % on its
          own mass; together the weighings carry about {g(combined.rss, 2)} %, so the honest extent is{" "}
          <span className="mono">{plan.extent_mol !== null ? sigFigs(plan.extent_mol, combined.rss) : "—"}</span> mol and
          not the six digits the arithmetic printed.
        </p>
      ) : null}
      {combined.flag ? <p className="note note-warn">{combined.flag}</p> : null}
      {plan.notes.map((n) => (
        <p className="note" key={n}>{n}</p>
      ))}
    </div>
  );
}

export function HeatPanel({ reactionId, items }: { reactionId: string; items: MixItem[] }) {
  const { store, open } = useApp();
  const [water, setWater] = useState("100");
  const reaction = store.reactionById.get(reactionId);
  const plan = useMemo(() => (reaction ? reactionPlan(reaction, items as any) : null), [reaction, items]);
  if (!reaction || !plan) return null;
  const heat = runHeat(reaction, plan, store, Number(water) || 0);
  const ledger = heat.ledger;
  const cross = ledger?.cross;
  return (
    <div className="card">
      <div className="sect">heat</div>
      {ledger && ledger.terms.length ? (
        <table className="t">
          <thead>
            <tr>
              <th>term</th>
              <th>side</th>
              <th>× n</th>
              <th>ΔfH</th>
              <th>contribution</th>
            </tr>
          </thead>
          <tbody>
            {ledger.terms.map((t, i) => (
              <tr key={`${t.token}-${i}`}>
                <td>
                  <button
                    className="link"
                    onClick={() => t.species_id && open({ kind: "species", id: t.species_id })}
                  >
                    {formula(t.token)}
                  </button>
                </td>
                <td className="small">{t.side === "product" ? "+" : "−"}</td>
                <td>{g(t.coefficient, 3)}</td>
                <td>
                  {t.dHf === null ? (
                    <span className="chip chip-warn">not curated</span>
                  ) : (
                    g(t.dHf, 5)
                  )}
                </td>
                <td>{t.contribution_kJ === null ? "—" : `${g(t.contribution_kJ, 5)} kJ`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {ledger && ledger.terms.some((t) => t.phase_note) ? (
        <p className="small">
          phases: {[...new Set(ledger.terms.filter((t) => t.phase_note).map((t) => `${t.token} — ${t.phase_note}`))].join(" · ")}
        </p>
      ) : null}
      {cross ? (
        <p className="small">
          cross-check against the published figure: {g(cross.curated, 5)} kJ is what the curation
          carries, {cross.comparison_basis}; the ledger on that same basis is{" "}
          {g(cross.derived_on_that_basis, 5)} kJ ({g(cross.abs_diff_kJ, 3)} kJ apart) —{" "}
          <em>{String(cross.verdict ?? "").toLowerCase()}</em>
          {cross.verdict !== "agree" ? <span className="chip chip-warn"> not a clean agreement</span> : null}
        </p>
      ) : null}
      {heat.dH_kJ_per_extent === null ? (
        <>
          <p className="note note-warn">
            No ΔH for this run:{" "}
            {heat.missing_terms?.length
              ? `the data has no ΔfH for ${heat.missing_terms.join(", ")} — which is a hole in the table, not a zero`
              : "no formation data was curated for it"}
            . The app will not put a number here that the warehouse does not support, and it will
            not add up a ledger with a term missing from it.
          </p>
          {(reaction.thermo_curated as any)?.dH ? (
            <p className="small">
              The record does carry a curated ΔH of{" "}
              <ProvLine p={(reaction.thermo_curated as any).dH} label="as published" /> — but the units say{" "}
              {(reaction.thermo_curated as any).dH.units ?? "per mole of reaction as written"}, and whether
              that is per mole of product or per the equation as written changes the answer by a
              factor of {g(Math.max(...(reaction.reactants ?? []).map((t: any) => t.coefficient || 1), 1), 3)}. So it
              is quoted here and not multiplied by your amounts.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <div className="field" style={{ marginBottom: 6 }}>
            <span className="small">water in the beaker (mL)</span>
            <input value={water} onChange={(e) => setWater(e.target.value)} inputMode="decimal" style={{ width: "5.5em", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: ".35em" }} />
          </div>
          <div className="row">
            <Computed
              value={`${g(heat.q_kJ, 4)}`}
              unit="kJ"
              basis={
                heat.dH_kind === "curated"
                  ? `curated ΔH ${g(heat.dH_kJ_per_extent, 5)} kJ × extent ${g(plan.extent_mol, 4)} mol`
                  : `ledger ΔH ${g(heat.dH_kJ_per_extent, 5)} kJ × extent ${g(plan.extent_mol, 4)} mol`
              }
            />
            <span className="spacer" />
            <span className={"chip " + (heat.sign === "exothermic" ? "chip-warn" : "")}>{heat.sign === "exothermic" ? "gives out heat" : heat.sign === "endothermic" ? "takes in heat" : "heat unknown"}</span>
            {heat.dH_kind === "curated" ? <span className="chip">as published — not computed here</span> : null}
          </div>
          <p className="small">
            mass {g(heat.mass_g, 4)} g · ΔT ≈ <strong>{heat.dT_K === null ? "—" : `${g(Math.abs(heat.dT_K), 3)} K ${heat.dT_K > 0 ? "warmer" : "cooler"}`}</strong>{" "}
            {heat.dT_K !== null && Math.abs(heat.dT_K) > 40 ? "— which is why this is done dilute, and why you would feel it" : ""}
          </p>
          {heat.dT_K !== null && Math.abs(heat.dT_K) > 75 ? (
            <p className="note note-warn">
              The water boils long before this temperature is reached: {g(Math.abs(heat.dT_K) - 75, 3)} K
              of it would leave as steam and take the heat with it. What you would actually see is a
              beaker that boils dry, not a number — and this calculation is the reason to use more
              water or a smaller amount.
            </p>
          ) : null}
          {heat.basis.map((b) => (
            <p className="small" key={b}>· {b}</p>
          ))}
          <p className="note">
            Nothing here models heat going into the glass, the air or the stirring rod, and the
            enthalpies are for 25 °C standard states. A real beaker ends up cooler than this number
            says: it is an upper bound, not a prediction.
          </p>
        </>
      )}
    </div>
  );
}

export function GasPanel({ reactionId, items }: { reactionId: string; items: MixItem[] }) {
  const { store } = useApp();
  const [T, setT] = useState("25");
  const [over, setOver] = useState(true);
  const reaction = store.reactionById.get(reactionId);
  const gasRows = useMemo(() => {
    if (!reaction) return [];
    const plan = reactionPlan(reaction, items as any);
    return (reaction.products ?? [])
      .filter((t) => (store.speciesById.get(t.species_id ?? "")?.state ?? "").match(/^(g|v)$/))
      .map((t) => {
        const mol = (plan.extent_mol ?? 0) * (t.coefficient || 1);
        const sp = store.speciesById.get(t.species_id ?? "");
        return { t, mol, sp, res: gasVolume(store, mol, { T_C: Number(T) || 25, overWater: over, molar_mass: sp?.molar_mass?.value ?? null }) };
      });
  }, [reaction, items, store, T, over]);
  if (!reaction) return null;
  if (!gasRows.length)
    return (
      <div className="card">
        <div className="sect">gas</div>
        <p className="small">This record produces no gas, so there is nothing to collect.</p>
      </div>
    );
  return (
    <div className="card">
      <div className="sect">gas</div>
      <div className="row">
        <span className="small">at</span>
        <input value={T} onChange={(e) => setT(e.target.value)} inputMode="decimal" style={{ width: "4em", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: ".3em" }} />
        <span className="small">°C</span>
        <button className="pill-btn" aria-pressed={over} onClick={() => setOver(!over)}>
          collected over water
        </button>
      </div>
      {gasRows.map(({ t, mol, res, sp }) => (
        <div key={t.token} className="row" style={{ marginTop: 6 }}>
          <span className="mono">{formula(t.token)}</span>
          <span className="small">{g(mol, 4)} mol</span>
          <Computed value={g(res.V_L, 4)} unit="L" basis="ideal gas, R from tables.constants" />
          {res.water_kPa !== null ? <span className="small">minus {g(res.water_kPa, 3)} kPa of water vapour → {g(res.dry_P_kPa, 4)} kPa dry</span> : null}
          {res.vs_air !== null ? (
            <span className="chip">{res.vs_air > 1.1 ? "heavier than air" : res.vs_air < 0.9 ? "lighter than air" : "about air"}</span>
          ) : null}
          {sp?.ghs ? <span className="chip chip-warn">check its label before you make it</span> : null}
        </div>
      ))}
      {gasRows[0] ? gasRows[0].res.basis.map((b) => <p className="small" key={b}>· {b}</p>) : null}
      <p className="small">
        The same answer with the shortcut a textbook uses is{" "}
        {g((gasRows[0]?.mol ?? 0) * (gasRows[0]?.res.molar_vol_L_mol ?? 24.8), 4)} L — molar volume{" "}
        {g(gasRows[0]?.res.molar_vol_L_mol ?? 24.8, 4)} L/mol at {gasRows[0]?.res.convention}. The two
        agree to within the rounding, which is the point of quoting the convention.
      </p>
    </div>
  );
}

export function SolutionsPanel() {
  const { store } = useApp();
  const bottles: any[] = store.doc.lab?.stock_bottles ?? [];
  const [mode, setMode] = useState<"bottle" | "solid">("bottle");
  const [bi, setBi] = useState(0);
  const [V, setV] = useState("250");
  const [M, setM] = useState("1");
  const [solid, setSolid] = useState("NaCl");
  const b = bottles[bi];
  const vol = Number(V) || 0;
  const mol = Number(M) || 0;

  const solidHits = useMemo(() => {
    const q = solid.trim().toLowerCase();
    if (q.length < 2) return null;
    return (
      store.species.find((x) => (x.formula_written ?? "").toLowerCase() === q && (x.state ?? "") === "s") ??
      store.species.find((x) => (x.formula_written ?? "").toLowerCase() === q) ??
      null
    );
  }, [solid, store]);

  const fromSolid = useMemo(
    () => (mode === "solid" ? solutionFromSolid(store, solidHits ?? undefined, vol, mol) : null),
    [mode, solidHits, vol, mol, store],
  );

  const fromBottle = useMemo(() => {
    if (mode !== "bottle" || !b) return null;
    const need_mol = (vol / 1000) * mol;
    const haveM = b.molarity || null;
    const need_mL = haveM ? (need_mol / haveM) * 1000 : null;
    const glass = need_mL ? pickGlassware(store, need_mL) : null;
    const flask = pickGlassware(store, vol);
    const err = combineRelative([glass?.relative_percent ?? null, flask?.relative_percent ?? null]);
    return { need_mol, haveM, need_mL, glass, flask, err };
  }, [mode, b, vol, mol, store]);

  if (!bottles.length && mode === "bottle") return null;
  return (
    <div className="card">
      <div className="sect">making a solution</div>
      <div className="row">
        <button className="pill-btn" aria-pressed={mode === "bottle"} onClick={() => setMode("bottle")}>
          from a concentrate
        </button>
        <button className="pill-btn" aria-pressed={mode === "solid"} onClick={() => setMode("solid")}>
          from a solid
        </button>
      </div>
      {mode === "bottle" ? (
        <select value={bi} onChange={(e) => setBi(Number(e.target.value))} style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: ".4em", width: "100%", marginTop: 8 }}>
          {bottles.map((x, i) => (
            <option key={x.label} value={i}>
              {x.label}
              {x.molarity ? ` (${x.molarity} M)` : x.percent_w_w ? ` (${x.percent_w_w} % w/w)` : ""}
            </option>
          ))}
        </select>
      ) : (
        <div className="field" style={{ marginTop: 8 }}>
          <span className="small">solid (formula, as written on the jar)</span>
          <input value={solid} onChange={(e) => setSolid(e.target.value)} style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: ".35em", width: "12em" }} />
          {solidHits ? (
            <span className="small">
              {solidHits.name} · M = {g(solidHits.molar_mass?.value, 5)} g/mol (computed from the formula, not copied)
            </span>
          ) : (
            <span className="small">no species in the data has that exact formula — try CuSO4.5H2O, Na2CO3, KHC4H4O6</span>
          )}
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <span className="small">make</span>
        <input value={V} onChange={(e) => setV(e.target.value)} inputMode="decimal" style={{ width: "5em", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: ".35em" }} />
        <span className="small">mL of</span>
        <input value={M} onChange={(e) => setM(e.target.value)} inputMode="decimal" style={{ width: "4.5em", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: ".35em" }} />
        <span className="small">mol/L</span>
      </div>

      {fromBottle?.need_mL !== null && fromBottle?.need_mL !== undefined ? (
        <p className="small" style={{ marginTop: 6 }}>
          measure <strong>{g(fromBottle.need_mL, 4)} mL</strong> of the bottle ({fromBottle.haveM} M) and make up to {V} mL
          — <Computed value={g(fromBottle.need_mol, 4)} unit="mol" basis="C₁V₁ = C₂V₂, C₁ taken from the bottle's own label" />.
          {fromBottle.glass ? ` A ${fromBottle.glass.name.toLowerCase()} measures that (±${g(fromBottle.glass.tolerance_mL, 3)} mL).` : ""}
          {fromBottle.flask ? ` A ${fromBottle.flask.name.toLowerCase()} makes up the volume (±${g(fromBottle.flask.tolerance_mL, 3)} mL).` : ""}
          {fromBottle.err.rss !== null ? ` Together about ${g(fromBottle.err.rss, 2)} % on the concentration you write on the bottle.` : ""}
        </p>
      ) : null}
      {mode === "bottle" && b?.note ? <p className="note note-warn">{b.note}</p> : null}

      {fromSolid ? (
        <p className="small" style={{ marginTop: 6 }}>
          weigh <strong>{g(fromSolid.grams, fromSolid.balance.digits ?? 4)} g</strong>{" "}
          <Computed value={g(fromSolid.moles, 4)} unit="mol" basis="V × C, then × the molar mass the app computed from the formula" /> —{" "}
          {solidHits?.hydrated ? "the waters of crystallisation are already in that molar mass, which is the whole reason the number looks odd" : "dissolve in a little water first, then make up to the mark in a "}
          {fromSolid.flask.id !== "none" ? <>{fromSolid.flask.name.toLowerCase()} (±{g(fromSolid.flask.tolerance_mL, 3)} mL)</> : "flask you do not have"}
          {fromSolid.error.rss !== null ? `; total about ${g(fromSolid.error.rss, 2)} %` : ""}.
        </p>
      ) : null}
      {fromSolid?.honest ? <p className="small">{fromSolid.honest}</p> : null}
      {fromSolid && fromSolid.balance.relative_percent !== null && fromSolid.balance.relative_percent > 1 ? (
        <p className="note note-warn">
          on a {fromSolid.balance.name.toLowerCase()} that mass is {g(fromSolid.balance.relative_percent, 2)} % of the reading —
          either weigh more and dilute a known factor, or use an analytical balance.
        </p>
      ) : null}
      <p className="note">
        Both answers are only as good as the label. A "1 M" made from a fuming concentrate is 1 M to
        within a couple of per cent until it is standardised against something dry — which is why a
        volumetric flask is calibrated to contain and a burette to deliver.
      </p>
    </div>
  );
}


/** Will the mixture in front of you actually cloud over? The shelf rules answer "is this salt
 *  soluble" - a statement about one saturated solution. What the bench asks is different: the
 *  ions are in a known number of millilitres at a known number of moles, so the ion product can
 *  be computed and compared with the tabulated Ksp. Both answers can be true at once, and this
 *  card says which regime you are in instead of picking a winner. */
export function PrecipitationPanel({ pairs, items }: { pairs: IonPair[]; items: MixItem[] }) {
  const { store, open } = useApp();
  const poured = items.filter((i) => (i.item.unit ?? "g") === "mL");
  const [extra, setExtra] = useState("");
  const total_mL = Number(extra) || poured.reduce((a, i) => a + Number(i.item.qty || 0), 0);
  const moles_of = (species_id: string, ion: string) => {
    const it = items.find((x) => x.species?.id === species_id);
    if (!it?.moles?.moles) return 0;
    const written = it.species?.formula_written ?? it.species?.formula ?? "";
    return it.moles.moles * (groupCount(written, ion) ?? 1);
  };
  if (!pairs.length) return null;
  return (
    <div className="card">
      <div className="sect">at these volumes</div>
      {total_mL <= 0 ? (
        <>
          <p className="small">
            Q needs a concentration, and grams do not carry one. Give the volumes you mixed — or the
            volume the beaker was made up to — and this card can compare the ion product with Ksp.
          </p>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="small">made up to (mL)</span>
            <input value={extra} onChange={(e) => setExtra(e.target.value)} inputMode="decimal" style={{ width: "5em", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: ".35em" }} />
          </div>
        </>
      ) : (
        <div className="row" style={{ gap: 8, marginBottom: 4 }}>
          <span className="small">the beaker holds {g(total_mL, 4)} mL</span>
          <span className="spacer" />
          <button className="pill-btn" onClick={() => setExtra("")}>
            from the bench
          </button>
        </div>
      )}
      {pairs.map((p) => {
        const { row, gap } = rowFromMatrix(p.row);
        const cation = row?.ions[0]?.formula ?? "";
        const anion = row?.ions[1]?.formula ?? "";
        const contributions: Contribution[] = [
          { label: store.speciesById.get(p.from[0])?.formula_written ?? p.from[0], ion: cation, moles: moles_of(p.from[0], cation), from_species_id: p.from[0] },
          { label: store.speciesById.get(p.from[1])?.formula_written ?? p.from[1], ion: anion, moles: moles_of(p.from[1], anion), from_species_id: p.from[1] },
        ];
        const r = row && total_mL > 0 ? precipCheck(store, String(p.row.product), contributions, total_mL, { ...row, molar_mass: solidMolarMass(p.row) }) : null;
        const chip = r?.verdict === "precipitate" ? "chip-warn" : r?.verdict === "nothing" ? "chip-ok" : "";
        return (
          <div key={`${p.from[0]}|${p.from[1]}`} style={{ marginTop: 8 }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {(() => {
                const solid = store.species.find((x) => (x.formula_written ?? "") === String(p.row.product ?? ""));
                return solid ? (
                  <button className="link mono" onClick={() => open({ kind: "species", id: solid.id })}>
                    {formula(String(p.row.product))}
                  </button>
                ) : (
                  <span className="mono">{formula(String(p.row.product ?? ""))}</span>
                );
              })()}
              {r ? (
                <span className={"chip " + chip}>
                  {r.verdict === "precipitate" ? "comes down" : r.verdict === "nothing" ? "stays in solution" : r.verdict === "marginal" ? "too close to call" : "cannot say"}
                </span>
              ) : (
                <span className="chip">no Ksp to compare against</span>
              )}
              {r?.ratio !== null && r?.ratio !== undefined ? (
                <span className="small">Q is {r.ratio >= 1 ? g(r.ratio, 3) : `1/${g(1 / r.ratio, 3)}`}× Ksp</span>
              ) : null}
              {r?.Q !== null && r?.Q !== undefined ? <span className="small">Q = {r.Q.toExponential(2)}</span> : null}
            </div>
            {gap ? <p className="small">{gap}</p> : null}
            {r?.regime ? <p className="small">{r.regime}</p> : null}
            {r?.precipitated_mol_per_L ? (
              <p className="small">
                what comes down: {g(r.precipitated_mol_per_L * (total_mL / 1000), 3)} mol in the beaker
                {r.precipitated_g_per_L !== null ? ` — about ${g((r.precipitated_g_per_L * total_mL) / 1000, 3)} g dry` : ""}
                {r.completeness_percent !== null ? `, ${g(r.completeness_percent, 4)} % of the limiting ion` : ""}
              </p>
            ) : null}
            {r?.after ? (
              <p className="small">
                still dissolved: {r.after.map((a) => `${a.ion} ${sci(a.mol_per_L, 2)} mol/L`).join(", ")}
                {" — "}
                {"that leftover is what \"insoluble\" means"}
              </p>
            ) : null}
            {r && r.water_to_add_mL !== null && r.water_to_add_mL > 0.05 ? (
              <p className="small">it redissolves once the beaker is past {g(total_mL + r.water_to_add_mL, 4)} mL</p>
            ) : null}
            {r?.more_ion_needed_mol ? (
              <p className="small">another {g(r.more_ion_needed_mol * 1000, 3)} mmol of the second ion would start it</p>
            ) : null}
            {r?.notes.map((n) => (
              <p className="small" key={n}>
                · {n}
              </p>
            ))}
            {r?.basis.map((b) => (
              <p className="small prov-src" key={b}>
                {b}
              </p>
            ))}
          </div>
        );
      })}
      <p className="small">
        Nothing on this card is the solubility rule. The rule says whether a saturated solution of a
        salt is concentrated or dilute; this says what these moles in this much water do, and the
        two can disagree honestly — a "soluble" salt still precipitates if you pour enough of it.
      </p>
    </div>
  );
}
