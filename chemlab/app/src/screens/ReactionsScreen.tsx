import { useMemo, useState } from "react";
import { useApp } from "../state/app.js";
import {
  coverageCensus,
  DEFAULT_REACT_FILTER,
  deadLinks,
  FACETS,
  filterReactions,
  type ReactFilter,
} from "../lib/reactBrowser.js";
import "./reactions.css";

/** All 424 reaction records, browsable.
 *
 *  The facets are the questions a person actually asks when choosing a practical — will it make a
 *  gas, does the record carry a ΔH, is it something you must not do at a kitchen bench — and every
 *  count next to a facet is counted from the rows in front of the app, not from a header field.
 */

const GROUPS = ["what you see", "what the record can answer", "hazard and control"] as const;

export function ReactionsScreen() {
  const { store, open } = useApp();
  const [f, setF] = useState<ReactFilter>(DEFAULT_REACT_FILTER);
  const set = <K extends keyof ReactFilter>(k: K, v: ReactFilter[K]) => setF((p) => ({ ...p, [k]: v }));
  const page = useMemo(() => filterReactions(store, f), [store, f]);
  const census = useMemo(() => coverageCensus(store), [store]);
  const dead = useMemo(() => deadLinks(store), [store]);
  const all = store.doc.reactions ?? [];
  const nEq = all.filter((r) => r.record_type === "equation").length;
  const next = Math.min(all.length, f.limit * 3);
  const toggleFacet = (id: string) => set("facets", f.facets.includes(id) ? f.facets.filter((x) => x !== id) : [...f.facets, id]);

  return (
    <div>
      <div className="card">
        <div className="sect">every reaction in the warehouse</div>
        <p className="small">
          {page.total} records: {nEq} carry a written equation and {page.total - nEq} are procedures with no equation to balance. The difference is a
          filter here, not a footnote.
        </p>
        <div className="field" style={{ marginTop: 8 }}>
          <input placeholder="name, equation, reactant, tag, teaching note…" value={f.q} onChange={(e) => set("q", e.target.value)} />
        </div>
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <select className="sel" value={f.cat} onChange={(e) => set("cat", e.target.value)} aria-label="category">
            <option value="all">any category ({page.cats.length} words in use)</option>
            {page.cats.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} · {c.count}
              </option>
            ))}
          </select>
          <select className="sel" value={f.type} onChange={(e) => set("type", e.target.value as ReactFilter["type"])} aria-label="record type">
            <option value="all">equations and processes</option>
            <option value="equation">the {nEq} with a written equation</option>
            <option value="process">process records: a procedure, no equation</option>
          </select>
        </div>
        {page.tags.length ? (
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <select className="sel" value={f.tag} onChange={(e) => set("tag", e.target.value)} aria-label="tag">
              <option value="">any tag ({page.tags.length} of {(store.doc.reactions ?? []).flatMap((r) => r.tags ?? []).length} in use shown)</option>
              {page.tags.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} · {t.count}
                </option>
              ))}
            </select>
            <select className="sel" value={f.sort} onChange={(e) => set("sort", e.target.value as ReactFilter["sort"])} aria-label="sort by">
              <option value="name">by name</option>
              <option value="danger">by danger score</option>
              <option value="dH">by size of ΔH</option>
              <option value="category">by category, then name</option>
              <option value="observations">by how much there is to see</option>
            </select>
            <button className="pill-btn" aria-pressed={f.desc} onClick={() => set("desc", !f.desc)}>
              {f.desc ? "↓ most first" : "↑ least first"}
            </button>
          </div>
        ) : null}

        {GROUPS.map((g) => (
          <div key={g} className="facet-group">
            <span className="facet-group-label">{g}</span>
            <div className="row" style={{ gap: 5, flexWrap: "wrap" }}>
              {FACETS.filter((x) => x.group === g).map((x) => (
                <button key={x.id} className="pill-btn" aria-pressed={f.facets.includes(x.id)} onClick={() => toggleFacet(x.id)}>
                  {x.label} ({page.facetCounts[x.id] ?? 0})
                </button>
              ))}
            </div>
          </div>
        ))}

        <p className="small how">
          {page.how}
          {page.truncated ? ` · the first ${page.rows.length} are below` : ""}
        </p>
        {page.active.length ? (
          <ul className="facet-why">
            {page.active.map((a) => (
              <li key={a.label}>
                <strong>{a.label}</strong> — {a.why}
              </li>
            ))}
          </ul>
        ) : null}
        {page.truncated ? (
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <button className="link" onClick={() => set("limit", next)}>
              show {next}
            </button>
            {f.limit > DEFAULT_REACT_FILTER.limit ? (
              <button className="link" onClick={() => set("limit", DEFAULT_REACT_FILTER.limit)}>
                back to {DEFAULT_REACT_FILTER.limit}
              </button>
            ) : null}
            <button
              className="link"
              onClick={() =>
                setF({ ...DEFAULT_REACT_FILTER, q: f.q })
              }
            >
              clear the filters
            </button>
          </div>
        ) : null}
      </div>

      {dead.length ? (
        <p className="note note-danger">
          {dead.length} links in this screen would go nowhere ({dead.slice(0, 3).join("; ")}
          {dead.length > 3 ? ", …" : ""}) — that is a gap in the data, and the app says so instead of printing a broken row.
        </p>
      ) : null}

      <div className="rx-list">
        {page.rows.map((r) => (
          <button key={r.id} className={`rx-row ${r.blocked ? "rx-blocked" : r.danger !== null && r.danger >= 3 ? "rx-loud" : ""}`} onClick={() => open({ kind: "reaction", id: r.id })}>
            <span className="row">
              <span className={`chip ${r.blocked ? "chip-danger" : r.danger !== null && r.danger >= 3 ? "chip-warn" : r.equation ? "chip-ok" : "chip"}`}>
                {r.blocked ? "you must not do this" : r.typeLabel}
              </span>
              <span className="rx-name">{r.name}</span>
              {r.danger !== null ? <span className="spacer" /> : null}
              {r.danger !== null ? <span className="small mono">danger {r.danger}/5</span> : null}
            </span>
            {r.equation ? <span className="mono rx-eq">{r.equation}</span> : <span className="small dim">{r.reactants.join(" + ")} → {r.products.join(" + ")}</span>}
            <span className="row rx-sub">
              {r.dH ? <span className="mono">ΔH {r.dH} kJ</span> : <span className="small dim">no ΔH in the record</span>}
              {r.dHFrom ? <span className="small dim">{r.dHFrom}</span> : null}
              <span className="spacer" />
              {r.hood ? <span className="chip chip-warn">hood</span> : null}
              {r.scale ? <span className="chip chip-warn">scale capped</span> : null}
              {r.controls.length ? <span className="small dim">{r.controls.length} control{r.controls.length === 1 ? "" : "s"}</span> : null}
            </span>
            {r.obs.length ? (
              <span className="small rx-obs">
                {r.obs
                  .filter((o) => o.kind !== "narrative" && o.kind !== "note")
                  .slice(0, 2)
                  .map((o) => `${o.kind.replace(/_/g, " ")}: ${o.text}`)
                  .join(" · ") || r.obs[0].text}
              </span>
            ) : null}
            {r.has.length ? (
              <span className="rx-has">
                {r.has.slice(0, 4).map((h) => (
                  <span key={h} className="chip chip-pred rx-has-chip">
                    {h}
                  </span>
                ))}
                {r.has.length > 4 ? <span className="small dim">+{r.has.length - 4} more the record answers</span> : null}
              </span>
            ) : null}
            <span className="small dim">{r.cats.join(" · ")}{r.tags.length ? ` · ${r.tags.join(", ")}` : ""}</span>
          </button>
        ))}
        {!page.rows.length ? (
          <p className="note">
            no record in the file answers all of that at once
            {page.active.length ? ` — the conditions you chose are printed above, and one of them is the one nothing satisfies` : ""}. That is a
            fact about the 424 records, not a missing answer: {census.filter((c) => c.count < page.total).length} of the {census.length} fields this
            screen can filter on are not filled in on every record.
          </p>
        ) : null}
      </div>

      <div className="card">
        <div className="sect">what the file can answer, counted from the rows</div>
        <table className="t">
          <thead>
            <tr>
              <th>field</th>
              <th>records</th>
              <th>and the rest</th>
            </tr>
          </thead>
          <tbody>
            {census.map((c) => (
              <tr key={c.field}>
                <td>{c.field}</td>
                <td className="mono">
                  {c.count}/{page.total}
                </td>
                <td className="small dim">{c.rest}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small">
          These are the numbers a filter's count comes from, so a row of zeros here means the app has nothing to sort by — not that the reaction
          does not happen.
        </p>
      </div>
    </div>
  );
}
