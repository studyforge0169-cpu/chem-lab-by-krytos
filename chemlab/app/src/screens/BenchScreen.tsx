import { useMemo, useState } from "react";
import { useApp, type BenchItem } from "../state/app.js";
import { decideMix } from "../lib/mix.js";
import { eq, formula, g } from "../lib/format.js";
import { ProvLine } from "../components/Prov.js";
import { FindingList } from "../components/Finding.js";
import { GasPanel, HeatPanel, PrecipitationPanel, QuantitiesPanel, SolutionsPanel } from "./Panels.js";
import { NotebookScreen, SaveNoteButton } from "./NotebookScreen.js";
import "./bench.css";

/** The mixing surface. One rule above all: this screen may only repeat what the data says, and
 *  the status word ("in this dataset" / "by rule" / "not covered") is the first thing it shows,
 *  not a footnote. */

/** quick benches, for someone who wants to see the app answer something immediately. Every id
 *  here is checked against the shipped records by a test, because a starter that names a substance
 *  the warehouse does not have is worse than no starter. */
export const STARTERS: { label: string; ids: string[] }[] = [
  { label: "burn hydrogen", ids: ["h2gas", "o2"] },
  { label: "zinc in copper sulphate", ids: ["zn", "cuso4"] },
  { label: "silver nitrate + sodium chloride", ids: ["agno3", "nacl"] },
  { label: "sodium chloride + potassium nitrate", ids: ["nacl", "kno3"] },
  { label: "potassium fluoride + hydrochloric acid", ids: ["kf", "hcl"] },
  { label: "marble chips in acid", ids: ["caco3", "hcl"] },
];

export function BenchScreen() {
  const { notes } = useApp();
  const [view, setView] = useState<"bench" | "notebook">("bench");
  return (
    <div>
      <div className="mode-row">
        <button className="pill-btn" aria-pressed={view === "bench"} onClick={() => setView("bench")}>
          the bench
        </button>
        <button className="pill-btn" aria-pressed={view === "notebook"} onClick={() => setView("notebook")}>
          the notebook{notes.length ? ` (${notes.length})` : ""}
        </button>
      </div>
      {view === "notebook" ? <NotebookScreen /> : <BenchBody />}
    </div>
  );
}

function BenchBody() {
  const { store, bench, setBench, open, ctx, setTab } = useApp();
  const [pick, setPick] = useState("");
  const [showSolutions, setShowSolutions] = useState(false);
  const set = (i: number, patch: Partial<BenchItem>) =>
    setBench(bench.map((b, j) => (i === j ? { ...b, ...patch } : b)));

  const mix = useMemo(() => decideMix(bench, store, ctx), [bench, store, ctx]);
  const guard = mix.guard;
  /* a bottle the guard refuses has no numbers on this screen at all: not a mole count, not a
     gram figure, not a "how much do I weigh out" - the record is readable, the bench is not */
  const withheld = new Set((guard?.findings ?? []).filter((f) => f.level === "block").flatMap((f) => f.species_ids ?? []));
  const hideScale = !!guard?.reaction?.hide_scale;
  const shownItems = (mix.items ?? []).filter((i) => !withheld.has(i.species?.id ?? ""));
  const hits = useMemo(() => (pick.trim().length > 1 ? store.search(pick, 8) : []), [pick, store]);

  const add = (id: string) => {
    if (bench.some((b) => b.species_id === id)) return;
    setBench([...bench, { species_id: id, qty: 1, unit: "g" as const }].slice(0, 4));
    setPick("");
  };

  return (
    <div>
      <div className="bench-slots">
        {bench.map((b, i) => {
          const s = store.speciesById.get(b.species_id);
          const m = mix.items[i]?.moles;
          return (
            <div className="slot" key={b.species_id}>
              <div className="who">
                <button className="link" style={{ fontSize: 16, fontWeight: 700 }} onClick={() => open({ kind: "species", id: b.species_id })}>
                  {formula(s?.formula_written ?? s?.name ?? b.species_id)}
                </button>
                <span className="small">{s?.name}</span>
                <span className="spacer" />
                <button className="x" aria-label="remove" onClick={() => setBench(bench.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
              <div className="amt">
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={String(b.qty)}
                  onChange={(e) => set(i, { qty: Number(e.target.value) })}
                  aria-label="amount"
                />
                <select value={b.unit} onChange={(e) => set(i, { unit: e.target.value as BenchItem["unit"] })} aria-label="unit">
                  {["g", "mol", "mL", "L"].map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                {b.unit === "mL" || b.unit === "L" ? (
                  <>
                    <span className="small">of</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      placeholder="M"
                      value={b.molarity === undefined ? "" : String(b.molarity)}
                      onChange={(e) => set(i, { molarity: e.target.value === "" ? undefined : Number(e.target.value) })}
                      aria-label="molarity"
                    />
                    <span className="small">mol/L</span>
                  </>
                ) : null}
              </div>
              <p className={`res ${m?.moles === null ? "bad" : ""}`}>
                {m?.moles !== null && m?.moles !== undefined
                  ? `${g(m.moles, 4)} mol${m.grams ? ` · ${g(m.grams, 4)} g` : ""} · ${m.basis}`
                  : (m?.basis ?? "")}
                {m?.warn ? <span className="small"> — {m.warn}</span> : null}
              </p>
            </div>
          );
        })}
      </div>

      {bench.length < 4 ? (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="field">
            <input
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              placeholder="add from the shelf: name or formula"
              aria-label="add a substance"
            />
            <span className="small">{bench.length}/4</span>
          </div>
          {hits.length ? (
            <div className="pt-hits" style={{ position: "static", boxShadow: "none", margin: "8px -12px -12px" }}>
              {hits
                .filter((h: any) => h.kind === "species")
                .map((h: any) => (
                  <button key={h.id} onClick={() => add(h.id)}>
                    <span className="kind">{store.speciesById.get(h.id)?.state ?? ""}</span>
                    <span>
                      <strong>{formula(h.label)}</strong> <span className="small">{h.sub}</span>
                    </span>
                  </button>
                ))}
            </div>
          ) : null}
          {!hits.length ? (
            <div className="add-row">
              {STARTERS.filter((st) => !st.ids.every((id) => bench.some((b) => b.species_id === id))).map((st) => (
                <button key={st.label} className="pill-btn" onClick={() => st.ids.forEach(add)}>
                  try: {st.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="row" style={{ margin: "6px 0 0" }}>
        <button className="pill-btn" aria-pressed={showSolutions} onClick={() => setShowSolutions(!showSolutions)}>
          making a solution
        </button>
        {hideScale ? <span className="chip chip-warn">no quantities on this bench: the record forbids a scale</span> : null}
        {withheld.size ? <span className="chip chip-danger">{withheld.size} bottle(s) shown without any numbers</span> : null}
      </div>
      {showSolutions && !hideScale ? <SolutionsPanel /> : null}

      {guard && guard.findings.length ? (
        <div className="verdict" style={{ borderLeftColor: guard.level === "block" ? "var(--danger)" : "var(--warn)" }}>
          <div className="row">
            <span className="sect" style={{ margin: 0 }}>
              the guard, before anything else
            </span>
            <span className="spacer" />
            <span className={`chip ${guard.level === "block" ? "chip-danger" : guard.level === "warn" ? "chip-warn" : "chip-ok"}`}>
              {guard.level === "block" ? "this bench is refused" : guard.level === "warn" ? "allowed, with warnings" : "nothing to report"}
            </span>
          </div>
          <FindingList findings={guard.findings} idBase="benchmix" />
          <p className="small">
            the verdict below is what the data says about these substances; it is not an instruction to do anything
            {guard.level === "block" ? ", and on a refused bench the quantities are withheld" : ""}.{" "}
            <button className="link" onClick={() => setTab("safety")}>
              the full guard, with the lists and the limits
            </button>
          </p>
        </div>
      ) : null}

      {mix.branch === "empty" ? (
        <p className="note">
          Put one to four things on the bench. The app answers with a curated reaction record if
          one contains exactly these, with the ion-pair matrix if they are all in water, and
          otherwise with what it tried — never with a guess.
        </p>
      ) : null}

      {mix.branch === "reaction" && mix.reaction ? (
        <div className="verdict verdict-v">
          <div className="row">
            <span className="chip chip-ok">in this dataset</span>
            <span className="small">{mix.statusLine}</span>
          </div>
          <h3 style={{ margin: "8px 0 2px", fontSize: 16 }}>{mix.reaction.name}</h3>
          {mix.reaction.equation ? <p className="verdict-eq mono">{eq(mix.reaction.equation)}</p> : (
            <p className="small">{mix.reaction.reactants_written} → {mix.reaction.products_written}</p>
          )}
          <p className="small">{mix.matchNote}</p>
          {mix.reaction.observations?.length ? (
            <>
              <div className="sect">what you would see</div>
              {mix.reaction.observations.map((o, i) => (
                <div className="obs" key={i}>
                  <span className="k">{o.kind.replace("_", " ")}</span>
                  {o.colour_hex ? <span className="swatch" style={{ background: o.colour_hex }} /> : null}
                  <span>{o.text}</span>
                </div>
              ))}
            </>
          ) : null}
          {mix.reaction.thermo_derived?.dH_rxn ? (
            <>
              <div className="sect">heat</div>
              <ProvLine p={mix.reaction.thermo_derived.dH_rxn} label="ΔH" />
              <p className="small">{mix.reaction.thermo_derived.per}</p>
            </>
          ) : mix.reaction.thermo_derived?.missing_terms?.length ? (
            <p className="note" style={{ margin: "8px 0 0" }}>
              No ΔH for this one: the data has no ΔfH for{" "}
              {mix.reaction.thermo_derived.missing_terms
                .map((x: any) => (typeof x === "string" ? x : x?.token ?? "?"))
                .join(", ")}
              .
              A gap, not a zero.
            </p>
          ) : null}
          {mix.reaction.teaching_note ? <p className="note" style={{ marginTop: 8 }}>{mix.reaction.teaching_note}</p> : null}
          {mix.reaction.safety?.danger_score !== undefined && mix.reaction.safety?.danger_score !== null ? (
            <p className="small" style={{ marginTop: 6 }}>
              danger {mix.reaction.safety.danger_score}/5
              {mix.reaction.safety.controls?.length ? ` · controls: ${mix.reaction.safety.controls.join(", ")}` : ""}
              {mix.reaction.safety.max_scale ? ` · max scale ${mix.reaction.safety.max_scale}` : ""}
            </p>
          ) : null}
          {mix.reactions && mix.reactions.length > 1 ? (
            <>
              <div className="sect">{mix.reactions.length - 1} more records fit this set</div>
              {mix.reactions.slice(1).map((m) => (
                <p key={m.r.id} className="small" style={{ margin: "3px 0" }}>
                  <button className="link" onClick={() => open({ kind: "reaction", id: m.r.id })}>
                    {m.r.name}
                  </button>{" "}
                  — {m.note}
                </p>
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      {mix.branch === "reaction" && mix.reaction ? (
        <>
          {hideScale ? null : (
            <>
              <QuantitiesPanel reactionId={mix.reaction.id} items={shownItems} />
              <HeatPanel reactionId={mix.reaction.id} items={shownItems} />
              <GasPanel reactionId={mix.reaction.id} items={shownItems} />
            </>
          )}
        </>
      ) : null}

      {mix.branch === "ions" && mix.pairs?.length ? <PrecipitationPanel pairs={mix.pairs} items={shownItems} /> : null}

      {mix.branch === "ions" ? (
        <div className="verdict verdict-r">
          <div className="row">
            <span className="chip chip-warn">decided by the ion-pair table</span>
            <span className="small">{mix.statusLine}</span>
          </div>
          {(mix.pairs ?? []).map((p, i) => (
            <div className="pair" key={i}>
              <div className="p-head">
                <span className="mono">
                  {store.speciesById.get(p.row.cation_id)?.formula_written} + {store.speciesById.get(p.row.anion_id)?.formula_written}
                </span>
                <span className={`chip ${p.row.outcome === "precipitate" ? "chip-danger" : p.row.outcome ? "chip-ok" : ""}`}>
                  {p.row.outcome ?? "not covered"}
                </span>
                {p.row.basis ? <span className="chip">{p.row.basis}</span> : null}
                {p.row.colour_hex && p.row.outcome === "precipitate" ? <span className="swatch" style={{ background: p.row.colour_hex }} /> : null}
              </div>
              <p className="mono small" style={{ margin: "4px 0" }}>
                {eq(p.row.net_ionic ?? p.row.net_ionic_note ?? "")}
              </p>
              {p.row.product && p.row.outcome === "precipitate" ? (
                <p className="small">
                  the solid is {formula(p.row.product)}
                  {p.row.product_in_dataset ? " (on the shelf)" : " (no record of its own here)"} ·{" "}
                  {g(p.row.molar_mass?.value, 5)} g/mol
                </p>
              ) : null}
              {p.row.colour_note ? <p className="note" style={{ margin: "4px 0" }}>{p.row.colour_note}</p> : null}
              {p.row.ksp ? <ProvLine p={p.row.ksp} label="Ksp" className="small" /> : null}
              {p.row.solubility_g_L ? <ProvLine p={p.row.solubility_g_L} label="solubility" className="small" /> : null}
              {p.row.rule?.statement ? (
                <p className="small">by the rule “{p.row.rule.statement}” — a rule, not a measurement</p>
              ) : null}
              {p.row.note ? <p className="small">{p.row.note}</p> : null}
            </div>
          ))}
          <p className="small">
            Concentrations are not taken into account yet — the Q-vs-Ksp check for the volumes you
            actually mixed is the next panel.
          </p>
        </div>
      ) : null}

      {mix.branch === "nothing" ? (
        <div className="verdict verdict-n">
          <div className="row">
            <span className="chip">not covered by this data</span>
          </div>
          <p className="small" style={{ marginTop: 6 }}>{mix.statusLine}</p>
          {mix.problems.map((p) => (
            <p className="small" key={p}>
              · {p}
            </p>
          ))}
          <p className="note">
            This is the honest answer, not a missing one. The warehouse contains 424 reaction
            records and 380 ion pairs; if your pair is not in them, the app will not invent a
            product for it.
          </p>
        </div>
      ) : null}

      {bench.length ? (
        <div className="row" style={{ gap: 8, marginTop: 10, alignItems: "center" }}>
          <SaveNoteButton mix={mix} />
          <span className="small dim">a note keeps this verdict and these numbers as they read now, with the data build they were read from</span>
        </div>
      ) : null}
    </div>
  );
}
