import { useMemo, useRef, useState } from "react";
import { useApp } from "../state/app.js";
import { openTarget, searchAll, type Found, type FoundPage } from "../lib/searchAll.js";
import { noteToBench } from "../lib/notebook.js";
import "./find.css";

/** One box, the whole warehouse. The kind of every hit is printed because a hit for `Na` and a hit
 *  for `na` are different claims, and because "nothing matches" has to be as readable as "here are
 *  forty things". */
const SING: Record<string, string> = {
  species: "bottle on the shelf",
  element: "element in the table",
  reaction: "reaction record",
  combination: "element pair",
  note: "note of yours",
};
const PLURAL: Record<string, string> = {
  species: "bottles on the shelf",
  element: "elements in the table",
  reaction: "reaction records",
  combination: "element pairs",
  note: "notes of yours",
};
export const kindCount = (kind: string, n: number) => `${n} ${n === 1 ? (SING[kind] ?? kind) : (PLURAL[kind] ?? `${kind}s`)}`;

export function FindBar() {
  const { store, notes, open, close, setTab, setBench } = useApp();
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const box = useRef<HTMLInputElement | null>(null);
  const page = useMemo(() => searchAll(store, notes, q, 40), [store, notes, q]);

  const pick = (hit: Found) => {
    const t = openTarget(store, hit);
    if (!t.ok) {
      setWhy(`“${hit.label}”: ${t.why}`);
      return;
    }
    setWhy(null);
    if (t.note) {
      const n = notes.find((x) => x.id === t.note);
      if (n) {
        setBench(noteToBench(n));
        setTab("bench");
        close();
        setShow(false);
        return;
      }
      setWhy("that note is not in the notebook any more");
      return;
    }
    setShow(false);
    setQ("");
    open(t.sheet!);
  };

  const focused = show && !!q.trim();
  return (
    <div className="findbar">
      <div className="row" style={{ gap: 6 }}>
        <div className="field find-field">
          <input
            ref={box}
            role="searchbox"
            aria-label="search the warehouse"
            placeholder="a name, a formula, a CAS number, an element symbol…"
            value={q}
            onFocus={() => setShow(true)}
            onChange={(e) => {
              setQ(e.target.value);
              setShow(true);
              setWhy(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQ("");
                setShow(false);
              }
            }}
            onBlur={() => window.setTimeout(() => setShow(false), 180)}
          />
        </div>
        {q.trim() ? (
          <button
            className="pill-btn"
            onClick={() => {
              setQ("");
              setWhy(null);
              box.current?.focus();
            }}
          >
            clear
          </button>
        ) : null}
      </div>

      {q.trim() ? <FindCounts q={q} page={page} /> : null}

      {focused ? <FindResults q={q} onPick={pick} page={page} /> : null}

      {why ? (
        <p className="note note-warn">
          {why} · the app will not open a sheet for an id the data does not have
        </p>
      ) : null}
    </div>
  );
}

export function FindCounts({ q, page }: { q: string; page: FoundPage }) {
  return (
    <p className="small find-counts">
      {page.hits.length + page.more} hit{page.hits.length + page.more === 1 ? "" : "s"}
      {page.kinds.length ? `: ${page.kinds.map((k) => kindCount(k.kind, k.count)).join(", ")}` : ""}
      {page.more ? ` · ${page.more} not listed, narrow it` : ""}
      {q.trim().split(/\s+/).length > 1 ? ` · a hit carries at least one of those words, not necessarily all` : ""}
    </p>
  );
}

export function FindResults({ q, onPick, page }: { q: string; onPick: (h: Found) => void; page: FoundPage }) {
  return (
    <ul className="find-hits">
      {page.hits.map((h, i) => (
        <li key={`${h.kind}-${h.id}-${i}`}>
          <button className="find-hit" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(h)}>
            <span className={`chip find-kind k-${h.kind}`}>{h.kind === "combination" ? "pair" : h.kind}</span>
            <span className="find-label mono">{h.label}</span>
            <span className="spacer" />
            <span className="small dim">{h.sub}</span>
          </button>
        </li>
      ))}
      {!page.hits.length ? (
        <li>
          <p className="note">
            nothing in the warehouse matches “{q.trim()}”. The index covers substance names and their
            alternatives, written and Hill formulas, CAS numbers, element symbols and numbers,
            reaction names, their categories and tags, and every element pair — it will not guess past
            that, and a near miss you did not ask for is worse than no answer.
          </p>
        </li>
      ) : null}
    </ul>
  );
}
