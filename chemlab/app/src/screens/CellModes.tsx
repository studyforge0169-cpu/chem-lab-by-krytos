import { useMemo, useState } from "react";
import { useApp } from "../state/app.js";
import { decideMix } from "../lib/mix.js";
import { buildCell, cellGrid, displacementRows, fromBottles, halfCells, type CellResult, type HalfCell } from "../lib/cell.js";
import { Computed, ProvLine } from "../components/Prov.js";
import { g, ionLabel } from "../lib/format.js";
import type { Prov } from "../data/types.js";
import type { CellPair } from "../state/app.js";
import { SaveNoteButton } from "./NotebookScreen.js";

/** The two electrochemistry modes of the Calc screen: build one cell, or walk the whole
 *  displacement series. Every number here comes out of src/lib/cell.ts, which reads tables.e0 -
 *  nothing is typed into this file. */

/* the pair and the mode live in app state, so the pair browser can hand a pair to the cell
   builder instead of the cell builder keeping a private copy nobody else can see */

const Num = ({
  label,
  value,
  onChange,
  width = "5em",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width?: string;
}) => (
  <span className="num">
    <span className="small">{label}</span>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode="decimal"
      aria-label={label}
      style={{ width, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: ".35em" }}
    />
  </span>
);

function ElectrodeSelect({ all, value, onChange, other }: { all: HalfCell[]; value: string; onChange: (v: string) => void; other: string }) {
  return (
    <select
      className="sel"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={other === "left" ? "the electrode you think is the anode" : "the electrode you think is the cathode"}
    >
      <option value="">choose an electrode…</option>
      {all.map((h) => (
        <option key={h.key} value={h.key} disabled={h.key === other && false}>
          {h.key} · {h.E0 >= 0 ? "+" : ""}
          {g(h.E0, 4)} V
          {n_tag(h)}
        </option>
      ))}
    </select>
  );
}
const n_tag = (h: HalfCell) => (h.n === null ? " · electrons not derivable" : "");

/** the table stores every couple as a reduction; the anode of a cell runs the other way */
function flip(eq: string): string {
  const i = eq.indexOf("->");
  return i < 0 ? eq : `${eq.slice(i + 2).trim()} -> ${eq.slice(0, i).trim()}`;
}

function HalfRow({ h, role, backwards }: { h: HalfCell; role: string; backwards?: boolean }) {
  const shown = backwards ? flip(h.half_equation) : h.half_equation;
  return (
    <div className="half">
      <div className="row">
        <span className="chip">{role}</span>
        <span className="mono">{h.key}</span>
        <span className="spacer" />
        {h.n !== null ? <span className="small">{h.n} e⁻</span> : <span className="chip chip-warn">no n</span>}
      </div>
      <p className="mono eq">{shown}</p>
      <p className="small">
        <ProvLine p={{ value: h.E0, units: h.units, source: h.source, ref_id: h.ref_id, confidence: h.confidence, note: h.note ?? undefined } as Prov<number>} />
      </p>
      <p className="small">{h.n_how}</p>
    </div>
  );
}

export function CellMode({ pair, setPair }: { pair: CellPair; setPair: (p: CellPair) => void }) {
  const { store, bench, open } = useApp();
  const all = useMemo(() => halfCells(store), [store]);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [pH, setPH] = useState("");
  const [T, setT] = useState("25");
  const [madeUp, setMadeUp] = useState("");
  const [lines, setLines] = useState<string[]>([]);

  const result = useMemo(() => {
    if (!pair.a || !pair.b) return null;
    const conc: Record<string, number> = {};
    for (const [k, v] of Object.entries(typed)) {
      const n = Number(v);
      if (v.trim() !== "" && isFinite(n) && n > 0) conc[k] = n;
    }
    return buildCell(store, pair.a, pair.b, { conc, pH: pH.trim() === "" ? null : Number(pH), T_C: Number(T) || 25 });
  }, [store, pair, typed, pH, T]);

  const ions = result && "q_terms" in result ? result.q_terms.filter((t) => t.kind === "ion") : [];
  const fromBench = () => {
    if (!result || !("q_terms" in result)) return;
    const mix = decideMix(bench, store);
    const bottles = mix.items.map((i) => ({
      formula: i.species?.formula_written ?? i.species?.formula ?? "",
      moles: i.moles.moles ?? 0,
      name: i.species?.name ?? i.species?.id ?? "",
    }));
    const poured = mix.items.filter((i) => (i.item.unit ?? "g") === "mL").reduce((a, i) => a + Number(i.item.qty || 0), 0);
    const total = Number(madeUp) || poured;
    const r = fromBottles(bottles, total, result.q_terms.filter((t) => t.kind === "ion").map((t) => ({ species: t.species, element: t.element })));
    setTyped((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(r.conc)) next[k] = String(Number(v.toPrecision(6)));
      return next;
    });
    const out: string[] = [];
    if (!bottles.length) out.push("nothing is on the bench, so there is no concentration here to take");
    else if (total <= 0) out.push("the bench has grams but no volumes: Q needs a concentration, so give the volume the beaker was made up to");
    else out.push(...r.lines);
    if (total > 0 && r.unknown.length) out.push(`nothing on the bench carries ${r.unknown.map((u) => ionLabel(u)).join(" or ")}, so those stay at 1 mol/L`);
    setLines(out);
  };

  if (result && "gap" in result)
    return (
      <div>
        <div className="card gap-card">
          <div className="sect">no cell to build from that</div>
          <p className="small">{result.gap}</p>
        </div>
        <Picker all={all} pair={pair} hint="" setPair={setPair} quick={(p) => setPair(p)} />
      </div>
    );

  if (!pair.a || !pair.b)
    return (
      <Picker
        all={all}
        pair={pair}
        setPair={(p) => {
          setPair(p);
          setTyped({});
          setLines([]);
        }}
        hint={`any two of the ${all.length} half cells in the tabulated series. The app works out which one is the anode, how many electrons cross, and what the cell is worth.`}
        quick={(p) => setPair(p)}
      />
    );
  if (!result) return null;
  const r = result as CellResult;
  const moved = r.Q !== null && r.Q !== 1;
  return (
    <div>
      <Picker
        all={all}
        pair={pair}
        setPair={(p) => {
          setPair(p);
          setTyped({});
          setLines([]);
        }}
        hint=""
        quick={(p) => {
          setPair(p);
          setTyped({});
          setLines([]);
        }}
      />

      <div className="card cell-big">
        <div className="sect">
          {moved ? `the voltage at the concentrations you gave` : "the standard voltage, every ion at 1 mol/L"}
        </div>
        <div>
          <span className="ph-num">{r.E_cell !== null ? r.E_cell.toFixed(3) : "—"}</span>
          <span className="small"> V, computed</span>
          {moved ? <span className="small"> · E° {g(r.E0_cell, 4)} V</span> : null}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="chip">anode {ionLabel(r.anode.key)}</span>
          <span className="chip">cathode {ionLabel(r.cathode.key)}</span>
          {r.n !== null ? <span className="chip">n = {r.n}</span> : <span className="chip chip-warn">n not derivable</span>}
          {r.Q !== null ? <span className="chip">Q = {r.Q.toExponential(2)}</span> : null}
          {r.flipped ? <span className="chip chip-warn">flipped: you had the ends round</span> : null}
        </div>
        <p className="mono eq big">{r.equation}</p>
        <p className="small mono">{r.cell_notation}</p>
        <dl className="kv">
          <dt>log K, for the equation above</dt>
          <dd>
            <Computed value={r.logK === null ? "not printed" : g(r.logK, 4)} unit={r.logK === null ? "" : "at 25 °C"} basis={`log K = nE°/${g(r.slope_V, 5)} V, n from the two half equations${r.n === null ? " — and n is not derivable here" : ""}`} />
          </dd>
          <dt>log K per mole of electrons</dt>
          <dd>
            <Computed value={r.logK_per_e === null ? "—" : g(r.logK_per_e, 4)} unit="" basis="the same cell written for one formula unit: this is the number the element-pair rows carry" />
          </dd>
          <dt>K</dt>
          <dd>
            <Computed
              value={r.K_display}
              unit={r.K === null ? "— no decimal expansion: past the largest number a float holds" : "dimensionless"}
              basis="10^log K"
            />
          </dd>
          <dt>ΔG°</dt>
          <dd>
            <Computed value={r.dG_kJ === null ? "not printed" : g(r.dG_kJ, 4)} unit={r.dG_kJ === null ? "" : "kJ/mol"} basis="ΔG = −nFE°, F from tables.constants" />
          </dd>
        </dl>
        <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
          <SaveNoteButton
            label="save this cell to the notebook"
            extras={[
              { label: "E_cell", value: r.E_cell === null ? "not printed" : r.E_cell.toFixed(4), unit: "V", basis: moved ? "Nernst, from the concentrations on the bench" : "standard: every ion at 1 mol/L" },
              { label: "n", value: r.n === null ? "not derivable from the half equations" : String(r.n), unit: "", basis: "electrons the two half equations exchange" },
              { label: "log K", value: r.logK === null ? "not printed" : g(r.logK, 4), unit: "", basis: "nE°/0.05916 V at 25 °C" },
              { label: "ΔG°", value: r.dG_kJ === null ? "not printed" : g(r.dG_kJ, 4), unit: "kJ/mol", basis: "−nFE°, F from tables.constants" },
            ]}
          />
          <span className="small dim">the note saves the cell as you have it set now, including which concentrations were used</span>
        </div>
        {r.notes.map((n) => (
          <p className="note note-warn" key={n}>
            {n}
          </p>
        ))}
      </div>

      <div className="card">
        <div className="sect">the two halves, and where n came from</div>
        <HalfRow h={r.anode} role="oxidised: gives electrons" backwards />
        <HalfRow h={r.cathode} role="reduced: takes them" />
        {r.basis.map((b) => (
          <p className="small" key={b}>
            · {b}
          </p>
        ))}
      </div>

      <div className="card">
        <div className="sect">what is in the beakers</div>
        {ions.length ? (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {ions.map((t) => (
              <Num key={t.species} label={`${ionLabel(t.species)} mol/L${t.exp > 1 ? `^${t.exp}` : ""}`} value={typed[t.species] ?? ""} onChange={(v) => setTyped((p) => ({ ...p, [t.species]: v }))} width="4.5em" />
            ))}
          </div>
        ) : (
          <p className="small">nothing in this cell is an ion in solution, so there is no concentration to type and no Nernst shift: the voltage is the tabulated one.</p>
        )}
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          <Num label="pH" value={pH} onChange={setPH} width="3.5em" />
          <Num label="°C" value={T} onChange={setT} width="3.5em" />
          <span className="small">{Math.abs(r.ph_shift) > 0 ? `this cell moves ${Math.abs(r.ph_shift)} ${r.ph_shift > 0 ? "OH⁻" : "H⁺"} per reaction, so pH is worth something here` : "this cell neither makes nor uses protons, so the pH field would change nothing"}</span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          <Num label="made up to (mL)" value={madeUp} onChange={setMadeUp} width="4.5em" />
          <button className="pill-btn" onClick={fromBench}>
            take the concentrations from the bench
          </button>
          {Object.keys(typed).length ? (
            <button className="pill-btn" onClick={() => { setTyped({}); setLines([]); }}>
              clear
            </button>
          ) : null}
        </div>
        {lines.map((l) => (
          <p className="small" key={l}>
            · {l}
          </p>
        ))}
        <p className="small">
          a blank box is 1 mol/L — the standard state the tabulated potentials are quoted at, not a guess. Solids and the water itself count as 1 whatever you type.
        </p>
      </div>

      {r.combo ? (
        <div className="card">
          <div className="sect">the same cell in the element-pair rows</div>
          <div className="row">
            <button className="link mono" onClick={() => open({ kind: "combination", pair: r.combo!.pair })}>
              {r.combo.pair} → {ionLabel(r.combo.formula)}
            </button>
            <span className="spacer" />
            <span className="chip chip-pred">{r.combo.status}</span>
          </div>
          <dl className="kv">
            <dt>predicted emf</dt>
            <dd>{r.combo.emf === null ? "—" : `${g(r.combo.emf, 4)} V`}</dd>
            <dt>log K on the row</dt>
            <dd>{r.combo.logK === null ? "—" : `${g(r.combo.logK, 4)} · ${r.combo.logK_agrees === true ? "the app reproduces it from the two potentials" : r.combo.logK_agrees === false ? "the app gets a different number, and the basis lines above show the arithmetic" : "no log K on the row to compare with"}`}</dd>
            <dt>ΔG on the row</dt>
            <dd>{r.combo.dG === null ? "—" : `${g(r.combo.dG, 4)} kJ/mol`}</dd>
            <dt>verdict</dt>
            <dd>{r.combo.verdict ?? "the row carries no verdict"}</dd>
          </dl>
          <p className="small">{r.combo.note}</p>
          <p className="note">
            this is aqueous standard-state arithmetic. It says the products are far below the energy of the elements and nothing whatever about rate: sodium in chlorine gas needs a spark, and a
            zinc strip in copper sulfate needs a minute, not a century — the numbers on this screen cannot tell those two apart.
          </p>
        </div>
      ) : null}

      <p className="small" style={{ margin: "10px 2px" }}>
        <Computed value="model" unit="" basis="E°cell from tables.e0, n from the two balanced half equations, log K and ΔG from those, Q from the concentrations typed above" />{" "}
        Every figure on this card is arithmetic on the tabulated potentials. Nothing here is a measurement of a real cell, and internal resistance, overpotential and rate are not in it.
      </p>
    </div>
  );
}

const QUICK: { label: string; p: CellPair }[] = [
  { label: "Daniell: zinc in copper sulfate", p: { a: "Zn2+/Zn", b: "Cu2+/Cu" } },
  { label: "sodium in chlorine", p: { a: "Na+/Na", b: "Cl2/Cl-" } },
  { label: "aluminium against silver", p: { a: "Al3+/Al", b: "Ag+/Ag" } },
  { label: "permanganate and zinc", p: { a: "MnO4-/Mn2+", b: "Zn2+/Zn" } },
  { label: "the air cathode, in base", p: { a: "Zn2+/Zn", b: "O2/OH- (base)" } },
];

function Picker({ all, pair, setPair, hint, quick }: { all: HalfCell[]; pair: CellPair; setPair: (p: CellPair) => void; hint: string; quick?: (p: CellPair) => void }) {
  return (
    <div className="card">
      <div className="sect">the left end, then the right</div>
      {hint ? <p className="small">{hint}</p> : null}
      <div className="row col">
        <ElectrodeSelect all={all} value={pair.a} other={pair.b} onChange={(v) => setPair({ ...pair, a: v })} />
        <ElectrodeSelect all={all} value={pair.b} other={pair.a} onChange={(v) => setPair({ ...pair, b: v })} />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <button className="pill-btn" onClick={() => setPair({ a: pair.b, b: pair.a })}>
          swap the ends
        </button>
        <span className="spacer" />
        <span className="small">{all.filter((h) => h.n !== null).length} of {all.length} rows have a derivable electron count</span>
      </div>
      {quick ? (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {QUICK.map((q) => (
            <button key={q.label} className="pill-btn" onClick={() => quick(q.p)}>
              {q.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SeriesMode({ onPair }: { onPair: (p: CellPair) => void }) {
  const { store, open } = useApp();
  const grid = useMemo(() => cellGrid(store), [store]);
  const shipped = useMemo(() => displacementRows(store), [store]);
  const [strip, setStrip] = useState("Zn2+/Zn");
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => grid.rows.filter((r) => r.strip_key === strip).sort((x, y) => y.E - x.E), [grid, strip]);
  const chosen = grid.electrodes.find((h) => h.key === strip);
  const element = chosen ? chosen.red.name.trim() : "";
  const combos = useMemo(
    () => ((store.combos ?? []) as any[]).filter((c) => c.predicted_emf && (c.elements ?? []).includes(element)).slice(0, showAll ? 40 : 10),
    [store, element, showAll],
  );
  const yes = rows.filter((r) => r.spontaneous).length;
  return (
    <div>
      <div className="card">
        <div className="sect">which metal strip pulls which ion out of solution</div>
        <select className="sel" value={strip} onChange={(e) => setStrip(e.target.value)} aria-label="the strip in the beaker">
          {grid.electrodes.map((h) => (
            <option key={h.key} value={h.key}>
              {ionLabel(h.red.nice)} — {h.key} · {h.E0 >= 0 ? "+" : ""}
              {g(h.E0, 4)} V
            </option>
          ))}
        </select>
        <p className="small" style={{ marginTop: 6 }}>
          {rows.length} beakers to try against {ionLabel(chosen?.red.nice ?? "")}: {yes} of them go. Tap one to build that cell.
        </p>
        <div className="series-list">
          {rows.map((r) => (
            <button
              key={r.ion_key}
              className={`series-row ${r.spontaneous ? "yes" : "no"}`}
              onClick={() => onPair({ a: r.strip_key, b: r.ion_key })}
            >
              <span className="mono">
                {ionLabel(r.strip)} in {ionLabel(r.ion)}
              </span>
              <span className={`chip ${r.spontaneous ? "chip-ok" : r.borderline ? "chip-warn" : ""}`}>{r.spontaneous ? "comes down" : r.borderline ? "too close" : "stays in"}</span>
              <span className="spacer" />
              <span className="small">
                {r.E >= 0 ? "+" : ""}
                {g(r.E, 3)} V{r.n !== null ? ` · log K ${g(r.logK ?? 0, 3)}` : " · n not derivable"}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="sect">against the shipped series</div>
        <dl className="kv">
          <dt>rows in the data</dt>
          <dd>{shipped.rows.length}</dd>
          <dt>re-derived from the two E° values</dt>
          <dd>
            {shipped.agree} of {shipped.rows.length} agree · {shipped.disagree.length} differ · {shipped.sign_mismatch.length} verdicts move
          </dd>
          <dt>cells in the app's grid</dt>
          <dd>
            {grid.rows.length} over {grid.electrodes.length} element electrodes, both directions
          </dd>
          <dt>cannot be balanced</dt>
          <dd>{grid.skipped.length ? grid.skipped.map((s) => s.key).join(", ") : "none"}</dd>
        </dl>
        <p className="note">
          the shipped table quotes log K with n assumed to be 2 for both halves. The app balances the halves instead, so where an element gives up three electrons the number is different — and the
          sign, which the note in the data says is the part that matters, is the same: {shipped.sign_mismatch.length} verdicts moved out of {shipped.rows.length}.
        </p>
        <p className="small">
          the grid is narrower than the table on purpose: it lists an element only when the row is a strip of that element against a solution of its own ion, so reference electrodes (calomel,
          silver/silver chloride) and ion/ion couples are left out. {shipped.rows.length - grid.rows.length} of the shipped rows involve a species of that kind, or a second couple for the same metal.
        </p>
      </div>

      <div className="card">
        <div className="sect">
          the element-pair rows for {ionLabel(element)}
        </div>
        {combos.length ? (
          <>
            {combos.map((c) => (
              <button key={c.pair} className="series-row" onClick={() => open({ kind: "combination", pair: c.pair })}>
                <span className="mono">{c.pair} → {c.formula}</span>
                <span className="chip chip-pred">{c.status}</span>
                <span className="spacer" />
                <span className="small">
                  {g(c.predicted_emf.value, 4)} V · log K {g(c.log_k?.value ?? 0, 3)}
                  {c.delta_g_kJ_per_mol?.value !== undefined && c.delta_g_kJ_per_mol?.value !== null ? ` · ΔG ${g(c.delta_g_kJ_per_mol.value, 4)} kJ/mol` : ""}
                </span>
              </button>
            ))}
            <div className="row" style={{ marginTop: 6 }}>
              <button className="pill-btn" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "fewer" : `${combos.length} shown, tap for more`}
              </button>
            </div>
          </>
        ) : (
          <p className="small">no element-pair row for {element} carries a predicted emf, so there is nothing to show — which is a gap in the data, not a verdict.</p>
        )}
        <p className="note">
          these are aqueous standard-state figures, built by subtracting two tabulated potentials. They say nothing about rate, nothing about the structure of the solid, and nothing about whether
          anything would be visible in a beaker: a million-fold K and a spark that never arrives are both compatible with them.
        </p>
      </div>
    </div>
  );
}
