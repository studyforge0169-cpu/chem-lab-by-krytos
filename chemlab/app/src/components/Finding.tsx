import type { Finding, LimitCheck } from "../lib/guard.js";
import { ProvLine } from "./Prov.js";
import "./prov.css";

/** One guard finding, rendered the same way everywhere it appears: the data's words, the key it
 *  came from, and the number it was measured against with its provenance still attached. */

const CHIP: Record<Finding["level"], { cls: string; word: string }> = {
  block: { cls: "chip-danger", word: "refused" },
  warn: { cls: "chip-warn", word: "warned" },
  note: { cls: "chip", word: "checked" },
};

function LimitLine({ l }: { l: LimitCheck }) {
  return (
    <p className="small">
      the limit:{" "}
      {l.limit === null ? (
        <span className="chip">no value in the data</span>
      ) : (
        <ProvLine p={{ value: l.limit, units: l.units, source: l.source, confidence: l.confidence, note: l.note } as any} />
      )}
      {l.note ? <span className="small"> · {l.note}</span> : null}
    </p>
  );
}

export function FindingRow({ f }: { f: Finding }) {
  const c = CHIP[f.level];
  return (
    <div className={`find find-${f.level}`}>
      <div className="row">
        <span className={`chip ${c.cls}`}>{c.word}</span>
        <strong>{f.head}</strong>
      </div>
      <p className="find-text">{f.text}</p>
      {f.action ? <p className="find-action">{f.action}</p> : null}
      {f.via ? (
        <p className="small mono">
          matched: {f.via}
        </p>
      ) : null}
      {f.limit ? <LimitLine l={f.limit} /> : null}
      <p className="small from">
        from <code>{f.from}</code>
        {f.ref_id ? ` · record ${f.ref_id}` : ""}
      </p>
    </div>
  );
}

/** the block-and-warn findings, with the clean ones folded away underneath */
export function FindingList({ findings, idBase }: { findings: Finding[]; idBase: string }) {
  const loud = findings.filter((f) => f.level !== "note");
  const quiet = findings.filter((f) => f.level === "note");
  return (
    <>
      {loud.length ? loud.map((f, i) => <FindingRow key={`${idBase}l${i}`} f={f} />) : null}
      {quiet.length ? (
        <details className="quiet">
          <summary>
            {quiet.length} thing{quiet.length === 1 ? "" : "s"} the guard checked and found clean
          </summary>
          {quiet.map((f, i) => (
            <FindingRow key={`${idBase}q${i}`} f={f} />
          ))}
        </details>
      ) : null}
      {!loud.length && !quiet.length ? <p className="small">the guard found nothing to say about this</p> : null}
    </>
  );
}
