import { useMemo, useState } from "react";
import { useApp } from "../state/app.js";
import { bufferPH, classify, indicatorsFor, solutionPH, titrate } from "../lib/ph.js";
import { Computed } from "../components/Prov.js";
import { formula, g, sci } from "../lib/format.js";
import { CellMode, SeriesMode } from "./CellModes.js";
import { SaveNoteButton } from "./NotebookScreen.js";
import type { CalcMode } from "../state/app.js";
import "./calc.css";

/** pH, buffers and titration curves. One picker at the top, three questions underneath, and
 *  every number traceable to the constant it came from. */

function Pick({
  value,
  onPick,
  placeholder,
}: {
  value: string | null;
  onPick: (id: string) => void;
  placeholder: string;
}) {
  const { store, open } = useApp();
  const [q, setQ] = useState("");
  const hits = useMemo(() => (q.trim().length > 1 ? store.search(q, 6).filter((h) => h.kind === "species") : []), [q, store]);
  const picked = value ? store.speciesById.get(value) : null;
  if (picked)
    return (
      <div className="pick pick-done">
        <button className="link" onClick={() => open({ kind: "species", id: picked.id })}>
          {formula(picked.formula_written ?? picked.name)}
        </button>
        <span className="small">{picked.name}</span>
        <button className="x" aria-label="clear" onClick={() => onPick("")}>
          ×
        </button>
      </div>
    );
  return (
    <div className="pick">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {hits.length ? (
        <div className="pick-hits">
          {hits.map((h) => (
            <button
              key={h.id}
              onClick={() => {
                onPick(h.id);
                setQ("");
              }}
            >
              <span className="mono">{formula(h.label)}</span>
              <span className="small">{h.sub}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const Num = ({
  label,
  value,
  onChange,
  width = "5.5em",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width?: string;
}) => (
  <span className="num">
    <span className="small">{label}</span>
    <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" style={{ width, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: ".35em" }} />
  </span>
);

function Gap({ text }: { text: string }) {
  return (
    <div className="card gap-card">
      <div className="sect">the data does not cover this</div>
      <p className="small">{text}</p>
    </div>
  );
}

function Curve({
  points,
  eqs,
  bands,
}: {
  points: { V_mL: number; pH: number }[];
  eqs: { V_mL: number; pH: number }[];
  bands: { lo: number; hi: number; hex: string; name: string }[];
}) {
  const W = 320;
  const H = 168;
  const pad = { l: 26, r: 8, t: 10, b: 22 };
  const Vmax = Math.max(points[points.length - 1]?.V_mL ?? 1, 1e-6);
  const xs = (v: number) => pad.l + (v / Vmax) * (W - pad.l - pad.r);
  const ys = (p: number) => H - pad.b - (p / 14) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${xs(p.V_mL).toFixed(1)},${ys(p.pH).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="curve" role="img" aria-label="pH against volume of titrant">
      {[0, 7, 14].map((p) => (
        <g key={p}>
          <line x1={pad.l} x2={W - pad.r} y1={ys(p)} y2={ys(p)} stroke="var(--line)" strokeWidth={p === 7 ? 1.2 : 0.6} strokeDasharray={p === 7 ? "3 3" : undefined} />
          <text x={2} y={ys(p) + 3} fontSize="8" fill="var(--dim)">
            {p}
          </text>
        </g>
      ))}
      {bands.map((b) => (
        <rect key={b.name} x={pad.l} y={ys(b.hi)} width={W - pad.l - pad.r} height={Math.max(1.5, ys(b.lo) - ys(b.hi))} fill={b.hex} opacity="0.16" />
      ))}
      {eqs.map((e, i) => (
        <g key={i}>
          <line x1={xs(e.V_mL)} x2={xs(e.V_mL)} y1={pad.t} y2={H - pad.b} stroke="var(--accent)" strokeWidth="0.8" strokeDasharray="2 3" />
          <circle cx={xs(e.V_mL)} cy={ys(e.pH)} r="2.6" fill="var(--accent)" />
          <text x={xs(e.V_mL) + 3} y={pad.t + 8} fontSize="7.5" fill="var(--dim)">
            {g(e.V_mL, 3)} mL
          </text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" />
      <text x={W - pad.r} y={H - 6} fontSize="7.5" fill="var(--dim)" textAnchor="end">
        {g(Vmax, 3)} mL of titrant
      </text>
      <text x={pad.l} y={H - 6} fontSize="7.5" fill="var(--dim)">
        0
      </text>
    </svg>
  );
}

const MODES: { id: CalcMode; label: string }[] = [
  { id: "solution", label: "a solution" },
  { id: "buffer", label: "a buffer" },
  { id: "titration", label: "a titration" },
  { id: "cell", label: "a cell" },
  { id: "series", label: "the series" },
];

function ModeTabs({ mode, setMode }: { mode: CalcMode; setMode: (m: CalcMode) => void }) {
  return (
    <div className="mode-row">
      {MODES.map((m) => (
        <button key={m.id} className="pill-btn" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function CalcScreen() {
  const { store, calcMode: mode, setCalcMode: setMode, cellPair: pair, setCellPair: setPair } = useApp();
  const [id, setId] = useState<string>("aceticacid");
  const [conj, setConj] = useState<string>("");
  const [M, setM] = useState("0.1");
  const [Mb, setMb] = useState("0.1");
  const [mL, setMl] = useState("25");
  const [tM, setTM] = useState("0.1");
  const [T, setT] = useState("25");
  const conc = Number(M) || 0;
  const opts = { T_C: Number(T) || 25 };

  const sol = useMemo(() => (id ? solutionPH(store, id, conc, opts) : null), [id, conc, T, store]);
  const buf = useMemo(
    () => (mode === "buffer" && id && conj ? bufferPH(store, id, conj, conc, Number(Mb) || 0, opts) : null),
    [mode, id, conj, conc, Mb, T, store],
  );
  const curve = useMemo(
    () =>
      mode === "titration"
        ? titrate(store, {
            analyte_id: id,
            analyte_M: conc,
            analyte_mL: Number(mL) || 0,
            titrant_M: Number(tM) || 0.1,
            T_C: Number(T) || 25,
          })
        : null,
    [mode, id, conc, mL, tM, T, store],
  );
  const fits = useMemo(() => (curve && "points" in curve ? indicatorsFor(curve, store) : []), [curve, store]);
  const cls = useMemo(() => classify(store, store.speciesById.get(id)), [id, store]);

  if (mode === "cell" || mode === "series")
    return (
      <div>
        <ModeTabs mode={mode} setMode={setMode} />
        {mode === "cell" ? <CellMode pair={pair} setPair={setPair} /> : <SeriesMode onPair={(p) => { setPair(p); setMode("cell"); }} />}
      </div>
    );

  return (
    <div>
      <ModeTabs mode={mode} setMode={setMode} />

      <div className="card">
        <div className="sect">{mode === "buffer" ? "the weak acid" : mode === "titration" ? "in the flask" : "what is in the beaker"}</div>
        <Pick value={id || null} onPick={setId} placeholder="search the shelf: name or formula" />
        {cls ? (
          <p className="small" style={{ marginTop: 6 }}>
            read as a {cls.kind}: {cls.pKs.length ? `${cls.pKs.map((p, i) => `pK${i + 1} ${g(p, 4)}`).join(", ")}` : "no pK in the data, taken as fully dissociated"}
            {" · "}
            <span className="prov-src">{cls.from}</span>
          </p>
        ) : (
          <p className="small" style={{ marginTop: 6 }}>
            no pKa or pKb on this record — the app will say so rather than guess.
          </p>
        )}
        <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
          <Num label="mol/L" value={M} onChange={setM} width="4.5em" />
          {mode !== "titration" ? <Num label="°C" value={T} onChange={setT} width="3.5em" /> : null}
          {mode === "buffer" ? <Num label="conj. mol/L" value={Mb} onChange={setMb} width="4.5em" /> : null}
          {mode === "titration" ? <Num label="flask mL" value={mL} onChange={setMl} width="4em" /> : null}
          {mode === "titration" ? <Num label="buret mol/L" value={tM} onChange={setTM} width="4.5em" /> : null}
        </div>
        {mode === "buffer" ? (
          <>
            <div className="sect">the conjugate base, as a real bottle</div>
            <Pick value={conj || null} onPick={setConj} placeholder="e.g. CH3COONa, Na2CO3" />
          </>
        ) : null}
      </div>

      {mode === "solution" && sol && "gap" in sol ? <Gap text={sol.gap} /> : null}
      {mode === "solution" && sol && "pH" in sol ? (
        <>
          <div className="card ph-big">
            <div>
              <span className="ph-num">{sol.pH.toFixed(2)}</span>
              <span className="small"> pH, computed</span>
            </div>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <span className="small">[H+] {sci(sol.h, 3)} mol/L</span>
              <span className="small">[OH−] {sci(sol.oh, 3)} mol/L</span>
              <span className="small">pOH {g(sol.pOH, 3)}</span>
              <span className="small">
                {g(sol.alpha * 100, sol.alpha < 0.02 ? 2 : 3)} % of the {sol.solute.kind} has reacted with the water
              </span>
            </div>
            {sol.trust.map((t) => (
              <p className="note note-warn" key={t}>
                {t}
              </p>
            ))}
            {sol.basis.map((b) => (
              <p className="small" key={b}>
                · {b}
              </p>
            ))}
            <p className="small">
              neutral at {sol.Kw.T_C} °C is pH {g(sol.Kw.pKw / 2, 2)}, from tables.kw —{" "}
              <span className="prov-src">{sol.Kw.source}, confidence {sol.Kw.confidence}</span>
            </p>
            <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
              <SaveNoteButton
                label="save this solution to the notebook"
                extras={[
                  { label: "pH", value: sol.pH.toFixed(2), unit: "", basis: "computed from what is in the bottle, not from the label" },
                  { label: "[H+]", value: sci(sol.h, 3), unit: "mol/L", basis: "charge balance solved on the shipped Ka and Kw" },
                  { label: "[OH−]", value: sci(sol.oh, 3), unit: "mol/L", basis: "Kw / [H+]" },
                  { label: "α", value: g(sol.alpha * 100, 4), unit: "% reacted with the water", basis: `Ka from the species record for ${sol.solute.name} (${sol.solute.species_id}), source ${sol.solute.source}` },
                ]}
              />
              <span className="small dim">the note keeps the pH with the bottle that produced it, so the number stays traceable</span>
            </div>
          </div>
        </>
      ) : null}

      {mode === "buffer" && !conj ? <p className="small">pick the conjugate's bottle and the screen will do both the exact balance and the Henderson–Hasselbalch figure, side by side.</p> : null}
      {mode === "buffer" && buf && "gap" in buf ? <Gap text={buf.gap} /> : null}
      {mode === "buffer" && buf && "pH" in buf ? (
        <div className="card ph-big">
          <div>
            <span className="ph-num">{buf.pH.toFixed(2)}</span>
            <span className="small"> pH of the buffer, computed</span>
            {!buf.trustworthy ? <span className="chip chip-warn">past the point where a buffer is a buffer</span> : null}
          </div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            {buf.hh_pH !== null ? <span className="small">Henderson–Hasselbalch says {buf.hh_pH.toFixed(2)} ({g(Math.abs(buf.hh_pH - buf.pH), 3)} away)</span> : null}
            {buf.ratio !== null ? <span className="small">base : acid = {g(buf.ratio, 3)} : 1</span> : null}
            {buf.capacity_mol_per_L_per_pH !== null ? (
              <span className="small">
                it takes {sci(buf.capacity_mol_per_L_per_pH, 2)} mol of strong acid or base per litre to move it one pH unit
              </span>
            ) : null}
          </div>
          {buf.span_mL_of_1M ? (
            <p className="small">
              one litre swallows {g(buf.span_mL_of_1M.to_acid, 3)} mmol of added acid before the acetate is used up, and {g(buf.span_mL_of_1M.to_base, 3)} mmol of
              added base before the acid is — beyond that it is just a dilute solution of a salt
            </p>
          ) : null}
          {buf.notes.map((n) => (
            <p className="note note-warn" key={n}>
              {n}
            </p>
          ))}
          {buf.basis.map((b) => (
            <p className="small" key={b}>
              · {b}
            </p>
          ))}
        </div>
      ) : null}

      {mode === "titration" && curve && "gap" in curve ? <Gap text={curve.gap} /> : null}
      {mode === "titration" && curve && "points" in curve ? (
        <>
          <div className="card">
            <div className="sect">
              {curve.analyte.formula} against {curve.titrant === "strong_base" ? "sodium hydroxide" : "hydrochloric acid"} {g(curve.titrant_M, 3)} mol/L
            </div>
            <Curve
              points={curve.points}
              eqs={curve.equivalences}
              bands={fits.filter((f) => f.fits).map((f) => ({ lo: f.pH_low, hi: f.pH_high, hex: f.base_hex ?? "#888", name: f.name }))}
            />
            {curve.equivalences.map((e) => (
              <p className="small" key={e.which_proton}>
                equivalence {e.which_proton}: {g(e.V_mL, 4)} mL, pH {e.pH.toFixed(2)}, and through the last half per cent of it the curve runs from pH {g(e.jump_from_pH, 2)} to {g(e.jump_to_pH, 2)}
              </p>
            ))}
            {curve.notes.map((n) => (
              <p className="note" key={n}>
                {n}
              </p>
            ))}
            {curve.basis.map((b) => (
              <p className="small" key={b}>
                · {b}
              </p>
            ))}
          </div>

          <div className="card">
            <div className="sect">the indicator, chosen by the jump</div>
            <table className="t ind">
              <thead>
                <tr>
                  <th>indicator</th>
                  <th>range</th>
                  <th>colour at the end</th>
                  <th>error</th>
                </tr>
              </thead>
              <tbody>
                {fits.map((f) => (
                  <tr key={f.name} className={f.fits ? "ok" : "no"}>
                    <td>
                      {f.name}
                      {f.note ? <span className="small"> — {f.note}</span> : null}
                    </td>
                    <td className="mono">
                      {g(f.pH_low, 3)}–{g(f.pH_high, 3)}
                    </td>
                    <td>
                      <span className="sw" style={{ background: f.acid_hex }} />
                      <span className="small">→</span>
                      <span className="sw" style={{ background: f.base_hex }} />
                    </td>
                    <td>{f.error_mL === null ? "never turns" : `${f.error_mL > 0 ? "+" : ""}${g(f.error_mL, 2)} mL${f.error_percent !== null ? ` (${g(f.error_percent, 2)} %)` : ""}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small">
              "error" is how far past the equivalence volume this indicator actually changes colour on this curve, computed from the curve itself — a colour change is a
              pH, and a pH is a volume once the curve is drawn.
            </p>
          </div>
        </>
      ) : null}

      <p className="small" style={{ margin: "10px 2px" }}>
        <Computed value="model" unit="" basis="charge balance + mass balance + the tabulated pK, solved by bisection; activities ignored, so 25 °C dilute work only" />
        {" "}
        Every pH on this screen is a calculation over the shipped constants. It is what a pH meter would read in an ideal solution at {opts.T_C} °C, and no activity
        correction, no electrode and no CO2 from the air is in it.
      </p>
    </div>
  );
}

