import { useMemo, useState } from "react";
import { useApp } from "../state/app.js";
import { ProvLine } from "../components/Prov.js";
import {
  COMBO_SORTS,
  COMBO_STATUSES,
  DEFAULT_FILTER,
  STATUS_MEANING,
  comboAudit,
  filterCombos,
  type ComboFilter,
} from "../lib/combos.js";
import "./combos.css";

/** Every pair of elements in the warehouse: 9410 rows, browsable on a phone.
 *
 *  The list is capped on purpose - 9410 rows is a million pixels of nothing useful on a handset -
 *  so the screen says what it cut and lets the filters do the narrowing.
 */

const CHIP_FOR: Record<string, string> = { verified: "chip-ok", empirical: "chip-ok", predicted: "chip-pred", none: "chip" };

export function CombosScreen() {
  const { store, open } = useApp();
  const [f, setF] = useState<ComboFilter>(DEFAULT_FILTER);
  const set = <K extends keyof ComboFilter>(k: K, v: ComboFilter[K]) => setF((p) => ({ ...p, [k]: v }));
  const page = useMemo(() => filterCombos(store, f), [store, f]);
  const audit = useMemo(() => comboAudit(store), [store]);
  const next = Math.min(2000, f.limit * 4);

  return (
    <div>
      <div className="card">
        <div className="sect">every pair of elements</div>
        <p className="small">
          {page.total.toLocaleString()} rows: for each pair, the formula their common oxidation states allow and what is real about it. The status
          word in front of every row is the data's, not this app's guess.
        </p>
        <div className="field" style={{ marginTop: 8 }}>
          <input placeholder="na cl, or NaCl, or peroxide…" value={f.q} onChange={(e) => set("q", e.target.value)} />
        </div>
        <div className="row" style={{ gap: 5, flexWrap: "wrap", marginTop: 8 }}>
          {COMBO_STATUSES.map((s) => (
            <button key={s} className="pill-btn" aria-pressed={f.status === s} onClick={() => set("status", s)}>
              {s === "all" ? "all" : `${s} (${audit.byStatus[s] ?? 0})`}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 5, flexWrap: "wrap", marginTop: 6 }}>
          <button className="pill-btn" aria-pressed={f.hasEmf} onClick={() => set("hasEmf", !f.hasEmf)}>
            has an emf ({audit.with_emf})
          </button>
          <button className="pill-btn" aria-pressed={f.hasVerdict} onClick={() => set("hasVerdict", !f.hasVerdict)}>
            has a verdict ({audit.with_verdict})
          </button>
          <span className="spacer" />
          <select className="sel" value={f.sort} onChange={(e) => set("sort", e.target.value as ComboFilter["sort"])} aria-label="sort by">
            {COMBO_SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button className="pill-btn" aria-pressed={f.desc} onClick={() => set("desc", !f.desc)}>
            {f.desc ? "↓ high first" : "↑ low first"}
          </button>
        </div>
        <p className="small how">
          {page.how} · {page.matched.toLocaleString()} row{page.matched === 1 ? "" : "s"} match the filters
          {page.truncated ? `, the first ${page.rows.length} are listed below` : ""}
        </p>
        {page.truncated ? (
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <button className="link" onClick={() => set("limit", next)}>
              show {next}
            </button>
            {f.limit > DEFAULT_FILTER.limit ? (
              <button className="link" onClick={() => set("limit", DEFAULT_FILTER.limit)}>
                back to {DEFAULT_FILTER.limit}
              </button>
            ) : null}
            <span className="small">{next >= 2000 ? "2000 is the cap: narrow it with a pair or a status" : "a phone screen is not a spreadsheet"}</span>
          </div>
        ) : null}
      </div>

      {audit.disagreements.length ? (
        <p className="note note-warn">
          the file's own header and its rows disagree: {audit.disagreements.join("; ")}. The app shows what it counted in the rows.
        </p>
      ) : null}
      {audit.dead_links.length ? (
        <p className="note note-warn">
          {audit.dead_links.length} rows point at a species record that is not on the shelf ({audit.dead_links.slice(0, 3).join(", ")}
          {audit.dead_links.length > 3 ? ", …" : ""}) — the app says so instead of inventing the substance.
        </p>
      ) : null}

      <div className="combo-list">
        {page.rows.map((r) => (
          <button
            key={`${r.pair}-${r.formula}-${r.status}`}
            className={`combo-row st-${r.status}`}
            onClick={() => open({ kind: "combination", pair: r.pair })}
          >
            <span className="row">
              <span className={`chip ${CHIP_FOR[r.status] ?? "chip"}`}>{r.status}</span>
              <span className="mono combo-pair">{r.pair}</span>
              <span className="spacer" />
              <span className="mono combo-formula">{r.formula}</span>
            </span>
            <span className="row combo-sub">
              <span className="small">{r.states}</span>
              <span className="spacer" />
              <span className="small">{r.mass}</span>
              <span className="small">{r.dchi}</span>
              <span className="small">{r.ionic}</span>
              {r.emf ? <span className="chip chip-pred">{r.emf}</span> : null}
            </span>
            {r.verdict ? (
              <span className="small combo-verdict">
                verdict: {r.verdict}
                {r.logK ? ` · log K ${r.logK}` : ""}
              </span>
            ) : null}
            {r.why || r.why_no_verdict ? <span className="small combo-why">{r.why ?? r.why_no_verdict}</span> : null}
          </button>
        ))}
        {!page.rows.length ? (
          <p className="note">
            nothing in the file matches those filters, and that is an answer:{" "}
            {f.status === "verified"
              ? "no compound of this pair has a record in the warehouse"
              : f.status === "none"
                ? "the data does not say this pair is impossible, which is not the same as saying it is possible"
                : "the pair or the text is not in the data at all"}
            .
          </p>
        ) : null}
      </div>

      <div className="card">
        <div className="sect">what the four statuses mean</div>
        <dl className="kv">
          {Object.entries(STATUS_MEANING).map(([k, v]) => (
            <div key={k} className="kv-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="small">
          {audit.pointing_at_a_species} rows carry a pointer to a substance on the shelf, {audit.with_emf} carry an emf computed from two tabulated
          couples, and {audit.rows.toLocaleString()} rows exist in total.
        </p>
      </div>
    </div>
  );
}

/** the emf chain of a row: every link with its own provenance line */
export function ComboEmfChain({ raw }: { raw: any }) {
  if (!raw?.predicted_emf) return null;
  return (
    <div className="card">
      <div className="sect">the emf chain on this row</div>
      <p className="small">
        <ProvLine p={raw.predicted_emf} label="emf" />
      </p>
      {raw.log_k ? (
        <p className="small">
          <ProvLine p={raw.log_k} label="log K" />
        </p>
      ) : (
        <p className="small">no log K on this row, so the emf is not being used to claim an equilibrium</p>
      )}
      {raw.delta_g_kJ_per_mol ? (
        <p className="small">
          <ProvLine p={raw.delta_g_kJ_per_mol} label="ΔG" />
        </p>
      ) : null}
      <p className="note">
        aqueous standard-state arithmetic on two tabulated potentials. It says nothing about rate, nothing about what the solid looks like, and
        nothing about whether anything would be visible in a beaker.
      </p>
    </div>
  );
}
