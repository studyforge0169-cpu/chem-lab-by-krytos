import { useMemo, useState } from "react";
import { useApp } from "../state/app.js";
import {
  DEFAULT_SHELF_FILTER,
  materials,
  shelfCensus,
  shelfRows,
  type ShelfFilter,
} from "../lib/apparatusShelf.js";
import { CONF_LABEL } from "../lib/format.js";
import "./shelfApparatus.css";

/** The apparatus and materials shelf: the register read backwards. */
export function ShelfSection() {
  const { store, open } = useApp();
  const [f, setF] = useState<ShelfFilter>(DEFAULT_SHELF_FILTER);
  const set = <K extends keyof ShelfFilter>(k: K, v: ShelfFilter[K]) => setF((p) => ({ ...p, [k]: v }));
  const page = useMemo(() => shelfRows(store, f), [store, f]);
  const census = useMemo(() => shelfCensus(store), [store]);
  const mats = useMemo(() => materials(store), [store]);
  const next = Math.min(page.total, f.limit * 3);

  return (
    <>
      <div className="card">
        <div className="sect">the apparatus register, backwards</div>
        <p className="small">
          {census.total} rows in <code>tables.apparatus</code>, {census.with_tolerance} of them with a tolerance and {census.cited} with the
          register's own source line for it. {census.nothing_asks} are named by nothing in the file — a spare or a stale row, and the app prints which
          rather than pretending.
        </p>
        <div className="row sa-census">
          {[
            ["asked for by a technique", census.measured_by_a_technique],
            ["in a kit list", census.in_a_kit],
            ["in a syllabus entry", census.in_the_syllabus],
            ["named on a reaction record", census.named_by_a_reaction],
            ["nothing asks for them", census.nothing_asks],
          ].map(([label, n]) => (
            <span key={String(label)} className="sa-count">
              <strong className="mono">{n}</strong>
              <span className="small dim">{label}</span>
            </span>
          ))}
        </div>
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <div className="field" style={{ flex: 1, minWidth: 160, margin: 0 }}>
            <input placeholder="name, id, note, kit…" value={f.q} onChange={(e) => set("q", e.target.value)} aria-label="search the register" />
          </div>
          <select className="sel" value={f.kind} onChange={(e) => set("kind", e.target.value)} aria-label="kind">
            <option value="all">any kind ({page.kinds.length})</option>
            {page.kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.kind} · {k.count}
              </option>
            ))}
          </select>
          <select className="sel" value={f.use} onChange={(e) => set("use", e.target.value as ShelfFilter["use"])} aria-label="what to show">
            <option value="all">everything</option>
            <option value="measured">the {census.with_tolerance} with a tolerance</option>
            <option value="unmeasured">the {census.total - census.with_tolerance} without one</option>
            <option value="unused">the {census.nothing_asks} nothing asks for</option>
          </select>
        </div>
        <p className="small how">
          {page.matched} of {page.total} rows match
          {page.truncated ? ` · the first ${page.rows.length} are below` : ""} · a tolerance is quoted in the register's own words, and where the
          register has none the row says so instead of leaving the column empty
        </p>
        {page.truncated ? (
          <div className="row" style={{ gap: 8 }}>
            <button className="link" onClick={() => set("limit", next)}>
              show {next}
            </button>
            {f.limit > DEFAULT_SHELF_FILTER.limit ? (
              <button className="link" onClick={() => set("limit", DEFAULT_SHELF_FILTER.limit)}>
                back to {DEFAULT_SHELF_FILTER.limit}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="sa-list">
        {page.rows.map((r) => (
          <div className="sa-row" key={r.id}>
            <p className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <strong>{r.label}</strong>
              <span className="chip">{r.kind}</span>
              <span className="spacer" />
              {r.tolerance ? (
                <span className="chip chip-ok mono">{r.tolerance}</span>
              ) : (
                <span className="chip mono">no tolerance</span>
              )}
            </p>
            <p className="row sa-dims" style={{ gap: 8, flexWrap: "wrap" }}>
              {r.capacity ? <span className="small mono">{r.capacity}</span> : null}
              {r.graduation ? <span className="small mono dim">{r.graduation}</span> : null}
              {r.relative_error ? <span className="small mono">{r.relative_error}</span> : null}
              {r.tolerance_source ? <span className="small dim">source: {r.tolerance_source}</span> : null}
              {r.tolerance_confidence ? (
                <span className="small dim">confidence: {CONF_LABEL[r.tolerance_confidence] ?? r.tolerance_confidence}</span>
              ) : null}
              <span className="small dim">{r.from}</span>
            </p>
            {r.note ? <p className="small sa-note">{r.note}</p> : null}
            {r.limits ? <p className="note note-warn sa-limits">the register's own warning: {r.limits}</p> : null}
            <p className="row" style={{ gap: 5, flexWrap: "wrap" }}>
              {r.used_by.techniques.map((x) => (
                <span key={x} className="chip chip-pred">
                  technique: {x}
                </span>
              ))}
              {r.used_by.kits.map((x) => (
                <span key={x} className="chip chip-pred">
                  kit: {x}
                </span>
              ))}
              {r.used_by.experiments ? <span className="chip chip-pred">{r.used_by.experiments} syllabus {r.used_by.experiments === 1 ? "entry" : "entries"}</span> : null}
              {r.used_by.reactions ? <span className="chip chip-pred">{r.used_by.reactions} reaction records</span> : null}
              {!r.used_by.techniques.length && !r.used_by.kits.length && !r.used_by.experiments && !r.used_by.reactions ? (
                <span className="chip">nothing in the file asks for it</span>
              ) : null}
            </p>
          </div>
        ))}
        {!page.rows.length ? (
          <p className="note">
            no register row matches that. {page.total - page.matched} of the {page.total} rows were filtered out, not removed: change the kind or the
            use and they come back.
          </p>
        ) : null}
      </div>

      <div className="card">
        <div className="sect">what a procedure reaches for that is not glassware</div>
        <p className="small">
          {mats.length} entries in <code>tables.materials</code>. They are consumables and test solutions, so the register carries no tolerance for
          them and none is implied here.
        </p>
        <table className="t">
          <thead>
            <tr>
              <th>material</th>
              <th>named by</th>
            </tr>
          </thead>
          <tbody>
            {mats.map((m) => (
              <tr key={m.name}>
                <td className="mono">{m.name}</td>
                <td className="small">
                  {m.reactions.length ? (
                    <>
                      {m.reactions.slice(0, 3).map((r, i) => (
                        <span key={r.id}>
                          {i ? "; " : ""}
                          <button className="link" onClick={() => open({ kind: "reaction", id: r.id })}>
                            {r.name}
                          </button>
                        </span>
                      ))}
                      {m.reactions.length > 3 ? ` and ${m.reactions.length - 3} more` : ""}
                    </>
                  ) : (
                    <span className="dim">no reaction record in the file names it</span>
                  )}
                  {m.kits.length ? ` · in the ${m.kits.join(", ")} kit list` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
