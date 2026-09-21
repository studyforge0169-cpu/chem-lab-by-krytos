import { useMemo, useState } from "react";
import { useApp } from "../state/app.js";
import { DEFAULT_QUERY, filterShelf, weighable, type ShelfQuery } from "../lib/filters.js";
import { formula, g, stateWord } from "../lib/format.js";
import { CombosScreen } from "./CombosScreen.js";
import "./shelf.css";

const KINDS: [ShelfQuery["kind"], string][] = [
  ["all", "everything"],
  ["species", "substances"],
  ["aqueous_ion", "ions"],
  ["element", "element bottles"],
  ["mixture", "mixtures"],
  ["other", "aliases & notes"],
];

/** The tab: the shelf's own records, or the 9410 element pairs. Same thumb, two different files. */
export function ShelfScreen() {
  const [view, setView] = useState<"records" | "pairs">("records");
  return (
    <div>
      <div className="mode-row" style={{ marginBottom: 8 }}>
        <button className="pill-btn" aria-pressed={view === "records"} onClick={() => setView("records")}>
          the shelf
        </button>
        <button className="pill-btn" aria-pressed={view === "pairs"} onClick={() => setView("pairs")}>
          every pair
        </button>
      </div>
      {view === "pairs" ? <CombosScreen /> : <ShelfRecords />}
    </div>
  );
}

/** Every record the shelf holds, browsable four ways at once. The hazard column is the data's
 *  own 0-5 score, not a colour the UI invented. */
function ShelfRecords() {
  const { store, open } = useApp();
  const [query, setQuery] = useState<ShelfQuery>(DEFAULT_QUERY);
  const set = <K extends keyof ShelfQuery>(k: K, v: ShelfQuery[K]) => setQuery((q) => ({ ...q, [k]: v }));
  const rows = useMemo(() => filterShelf(store, query), [store, query]);
  const total = store.species.length;

  return (
    <div>
      <div className="shelf-bar">
        <div className="field">
          <input
            value={query.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="name, formula, CAS - CuSO4.5H2O works"
            aria-label="search the shelf"
          />
          {query.q ? (
            <button className="pill-btn" onClick={() => set("q", "")}>
              clear
            </button>
          ) : null}
        </div>
        <div className="shelf-filters">
          {KINDS.map(([k, label]) => (
            <button key={k} className="pill-btn" aria-pressed={query.kind === k} onClick={() => set("kind", k)}>
              {label}
            </button>
          ))}
          <span className="spacer" />
          <button
            className="pill-btn"
            aria-pressed={query.weighable}
            title="only what you can put on a balance"
            onClick={() => set("weighable", !query.weighable)}
          >
            weighable
          </button>
        </div>
        <div className="shelf-filters">
          {(["any", "s", "l", "g", "aq"] as const).map((st) => (
            <button key={st} className="pill-btn" aria-pressed={query.state === st} onClick={() => set("state", st)}>
              {st === "any" ? "any state" : stateWord(st)}
            </button>
          ))}
          <span style={{ width: 8 }} />
          {(["any", 2, 3, 5] as const).map((h) => {
            const n =
              h === "any"
                ? store.species.length
                : store.species.filter((s) => (s.hazard_score ?? 0) >= h).length;
            return (
              <button key={String(h)} className="pill-btn" aria-pressed={query.hazard === h} onClick={() => set("hazard", h)}>
                {h === "any" ? "any hazard" : `hazard ≥ ${h} · ${n}`}
              </button>
            );
          })}
          <span className="spacer" />
          <select
            value={query.sort}
            onChange={(e) => set("sort", e.target.value as ShelfQuery["sort"])}
            aria-label="sort"
            style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8, padding: ".3em" }}
          >
            <option value="name">by name</option>
            <option value="hazard">by hazard</option>
            <option value="mass">by molar mass</option>
          </select>
        </div>
        <p className="small" style={{ margin: "7px 0 0" }}>
          {rows.length === total ? `all ${total} records` : `${rows.length} of ${total}`}
          {rows.length >= 200 ? " · first 200, keep typing to narrow" : ""} ·{" "}
          {store.species.filter((s) => weighable(s)).length} can be weighed
        </p>
      </div>

      <div className="shelf-list">
        {rows.map((s) => (
          <button key={s.id} className="shelf-row" onClick={() => open({ kind: "species", id: s.id })}>
            {s.colour_hex ? (
              <span className="swatch" style={{ background: s.colour_hex }} title={s.colour_description ?? s.colour ?? ""} />
            ) : null}
            <span className="f mono">{formula(s.formula_written ?? s.formula ?? s.name)}</span>
            <span className="nm">
              {s.name}
              {s.state ? ` · ${stateWord(s.state)}` : ""}
              {s.from_element ? ` · element ${s.from_element}` : ""}
            </span>
            <span className={`hz hz-${s.hazard_score ?? 0}`}>{s.hazard_score ?? "–"}</span>
            <span className="mm">{g(s.molar_mass?.value, 5)}</span>
          </button>
        ))}
        {!rows.length ? (
          <p className="note note-warn">
            Nothing matches. The shelf has {total} records — an empty result here is the app
            saying this substance is not in the warehouse, not that it does not exist.
          </p>
        ) : null}
      </div>
    </div>
  );
}
