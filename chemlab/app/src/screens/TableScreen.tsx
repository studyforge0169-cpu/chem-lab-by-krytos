import { useMemo, useState } from "react";
import { useApp } from "../state/app.js";
import { cellOf, GRID } from "./grid.js";
import { legendFor, MODES, tileColour, type Mode } from "./colour.js";
import { g } from "../lib/format.js";
import "./table.css";

/** The periodic table, from the records: 118 tiles, five colour modes, and the two honesty
 *  marks the data asks for - an "≈" on a mass nobody has weighed as a bulk number, and a
 *  purple dot on an element whose values are calculated. */
export function TableScreen() {
  const { store, open } = useApp();
  const [mode, setMode] = useState<Mode>("category");
  const [q, setQ] = useState("");
  const els = store.elements;

  const hits = useMemo(() => (q.trim().length > 1 ? store.search(q, 9) : []), [q, store]);
  const hitSymbols = useMemo(() => new Set(hits.filter((h: any) => h.kind === "element").map((h: any) => h.id)), [hits]);
  const legend = useMemo(() => legendFor(els, mode), [els, mode]);

  const byCell = useMemo(() => {
    const m = new Map<string, (typeof els)[number]>();
    for (const e of els) m.set(`${cellOf(e).row}:${cellOf(e).col}`, e);
    return m;
  }, [els]);

  const tile = (e: (typeof els)[number]) => {
    const c = tileColour(e, mode);
    const approx = e.atomic_mass?.confidence === "approx" || e.mass_uncertainty?.value === null && e.atomic_mass?.note;
    return (
      <button
        key={e.symbol}
        className={`tile ${c.nodata ? "tile-nodata" : ""} ${hitSymbols.has(e.symbol) ? "tile-hit" : ""}`}
        style={{ ["--tile-bg" as any]: c.bg }}
        onClick={() => open({ kind: "element", symbol: e.symbol })}
        title={`${e.name} · ${c.legend}`}
        aria-label={`${e.name}, number ${e.number}`}
      >
        <span className="n">{e.number}</span>
        <span className="s">{e.symbol}</span>
        <span className="m">
          {approx && e.atomic_mass?.confidence === "approx" ? "≈" : ""}
          {g(e.atomic_mass?.value, 5)}
        </span>
        {e.values_are_predicted ? <span className="dot dot-pred" /> : e.radioactive ? <span className="dot" /> : null}
        {e.not_a_shelf_reagent ? <span className="ring" /> : null}
      </button>
    );
  };

  return (
    <div>
      <div className="pt-ctrl">
        <div className="pt-search">
          <div className="field">
            <input
              value={q}
              onChange={(ev) => setQ(ev.target.value)}
              placeholder="search: name, symbol, formula, CAS"
              aria-label="search the warehouse"
            />
            {q ? (
              <button className="pill-btn" onClick={() => setQ("")}>
                clear
              </button>
            ) : null}
          </div>
          {hits.length ? (
            <div className="pt-hits">
              {hits.map((h: any) => (
                <button
                  key={`${h.kind}:${h.id}`}
                  onClick={() => {
                    if (h.kind === "element") open({ kind: "element", symbol: h.id });
                    else if (h.kind === "species") open({ kind: "species", id: h.id });
                    else if (h.kind === "reaction") open({ kind: "reaction", id: h.id });
                    else if (h.kind === "combination") open({ kind: "combination", pair: h.id });
                    setQ("");
                  }}
                >
                  <span className="kind">{h.kind}</span>
                  <span>
                    <strong>{h.label}</strong> <span className="small">{h.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="row" style={{ gap: 4, margin: "8px 0 2px" }}>
        {MODES.map((m) => (
          <button key={m.id} className="pill-btn" aria-pressed={mode === m.id} title={m.hint} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="small" style={{ margin: "2px 0 6px" }}>
        {MODES.find((m) => m.id === mode)?.hint} · tap any tile for the whole record
      </p>

      <div className="pt-wrap" style={{ ["--tile" as any]: "min(4.9vw, 52px)" }}>
        <div className="pt" role="grid" aria-label="periodic table">
          {Array.from({ length: GRID.rows }, (_, i) => i + 1).map((row) => {
            if (row === 8) return <div key="gap" className="pt-row-gap" />;
            const cells: React.ReactNode[] = [];
            for (let col = 1; col <= GRID.cols; col++) {
              const e = byCell.get(`${row}:${col}`);
              if (e) cells.push(tile(e));
              else if (row === 9 && col === 1)
                cells.push(
                  <div key="lbl6" className="pt-f-label">
                    lanthanides 58–71
                  </div>,
                );
              else if (row === 10 && col === 1)
                cells.push(
                  <div key="lbl7" className="pt-f-label">
                    actinides 90–103
                  </div>,
                );
              else cells.push(<span key={`${row}-${col}`} />);
            }
            return <div key={row} className="pt-row" style={{ display: "contents" }}>{cells}</div>;
          })}
        </div>
      </div>

      <div className="pt-legend">
        {mode === "en" || mode === "mp" ? (
          <span>
            <i className={`pt-scale ${mode === "mp" ? "pt-scale-cold" : ""}`} style={{ width: 120, height: 8, borderRadius: 4 }} />
            low
          </span>
        ) : null}
        {legend
          .slice(0, mode === "en" || mode === "mp" ? 2 : 99)
          .map((l) => (
            <span key={l.label}>
              <i style={{ background: l.bg }} />
              {l.label} · {l.n}
            </span>
          ))}
        <span>
          <i style={{ background: "var(--predicted)" }} />
          values predicted (Z ≥ 100) · {els.filter((e) => e.values_are_predicted).length}
        </span>
        <span>
          <i style={{ boxShadow: "inset 0 0 0 2px rgba(255,255,255,.6)", background: "transparent" }} />
          not a shelf reagent · {els.filter((e) => e.not_a_shelf_reagent).length}
        </span>
      </div>
    </div>
  );
}
