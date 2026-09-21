import { useMemo, useRef, useState } from "react";
import { useApp } from "../state/app.js";
import {
  captureNote,
  decodeNotes,
  encodeNotes,
  noteStale,
  noteToBench,
  summarizeNote,
  type Note,
  type NoteNumber,
} from "../lib/notebook.js";
import { g } from "../lib/format.js";
import type { MixResult } from "../lib/mix.js";
import "./notebook.css";

/** The notebook: what was on the bench, what the app said about it, and which build of the data
 *  said it. It never leaves the device - localStorage for the running list, and a file you save
 *  yourself for anything else. */

/** One button, used by the bench and by both calculators: it records what the screen has already
 *  worked out, rather than making the notebook work it out again and risk disagreeing. */
export function SaveNoteButton({ mix, extras, label }: { mix?: MixResult; extras?: NoteNumber[]; label?: string }) {
  const { store, bench, ctx, notes, setNotes } = useApp();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  if (!bench.length) return null;
  return (
    <span className="row" style={{ gap: 6 }}>
      <button
        className="pill-btn"
        onClick={() => {
          const note = captureNote(bench, store, ctx, { mix, extras });
          setNotes([note, ...notes].slice(0, 200));
          setSavedAt(note.saved_utc);
        }}
      >
        {savedAt ? "saved ✓" : (label ?? "save this to the notebook")}
      </button>
      {savedAt ? (
        <span className="small dim">
          kept on this device only, against data build {String(store.buildId ?? "?").slice(0, 8)}
        </span>
      ) : null}
    </span>
  );
}

export function NotebookScreen() {
  const { store, notes, setNotes, setBench, setCtx, setTab, open } = useApp();
  const [showProblems, setShowProblems] = useState<string[]>([]);
  const [header, setHeader] = useState<{ exported_utc: string | null; build_id: string | null; version: number | null } | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  const [wipe, setWipe] = useState(false);
  const buildId = String(store.buildId ?? "");
  const staleCount = useMemo(() => notes.filter((n) => noteStale(n, buildId)).length, [notes, buildId]);

  const download = () => {
    const text = encodeNotes(notes, buildId);
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `chemlab-notebook-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setShowProblems([]);
    } catch (e) {
      setShowProblems([`this browser refused the download: ${String((e as Error)?.message ?? e)}. The JSON is below instead.`]);
    }
  };

  const read = (f: File | null) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const res = decodeNotes(String(r.result ?? ""), buildId);
      const byId = new Map(notes.map((n) => [n.id, n]));
      for (const n of res.notes) byId.set(n.id, n);
      setNotes([...byId.values()].slice(0, 200));
      setHeader({ exported_utc: res.header.exported_utc, build_id: res.header.build_id, version: res.header.version });
      setShowProblems(res.problems);
    };
    r.onerror = () => setShowProblems([`the file could not be read: ${String(r.error ?? "unknown")}`]);
    r.readAsText(f);
  };

  return (
    <div>
      <div className="card">
        <div className="sect">the notebook</div>
        <p className="small">
          {notes.length} saved run{notes.length === 1 ? "" : "s"}, in this browser's own storage. Nothing is uploaded anywhere: the app has no server
          to upload to. {staleCount ? `${staleCount} of them were written against different data and say so.` : "None of them predate this data build."}
        </p>
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <button className="pill-btn" onClick={download} disabled={!notes.length}>
            export as JSON
          </button>
          <button className="pill-btn" onClick={() => file.current?.click()}>
            import a file
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              read(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          {notes.length ? (
            wipe ? (
              <button
                className="link"
                onClick={() => {
                  setNotes([]);
                  setShowProblems([]);
                  setWipe(false);
                }}
              >
                yes, delete all {notes.length}
              </button>
            ) : (
              <button className="link" onClick={() => setWipe(true)}>
                clear them all
              </button>
            )
          ) : null}
        </div>
        {header ? (
          <p className="small dim">
            last file read: exported {header.exported_utc ?? "no timestamp"} by build {String(header.build_id ?? "?").slice(0, 8) || "?"}, notebook
            version {header.version ?? "?"}
          </p>
        ) : null}
        {showProblems.length ? (
          <div className="note note-warn">
            <strong>what the reader could not make sense of</strong>
            {showProblems.map((p) => (
              <p key={p} className="small">
                · {p}
              </p>
            ))}
            <p className="small">anything it did understand is in the list; nothing was silently dropped.</p>
          </div>
        ) : null}
      </div>

      {notes.length ? (
        <div className="note-list">
          {notes.map((n) => (
            <NoteCard key={n.id} n={n} stale={noteStale(n, buildId)} onOpen={() => { setBench(noteToBench(n)); setCtx(n.ctx); setTab("bench"); }} onSheet={(id) => open({ kind: "reaction", id })} onDelete={() => setNotes(notes.filter((x) => x.id !== n.id))} />
          ))}
        </div>
      ) : (
        <p className="note">
          nothing saved yet. The bench, the pH calculator and the cell builder each have a save button that puts the whole verdict in here — the
          inputs, the numbers, the guard's findings and the data build they came from.
        </p>
      )}
    </div>
  );
}

function NoteCard({
  n,
  stale,
  onOpen,
  onSheet,
  onDelete,
}: {
  n: Note;
  stale: boolean;
  onOpen: () => void;
  onSheet: (id: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className={`note-card ${stale ? "stale" : ""}`}>
      <div className="row">
        <strong>{n.title}</strong>
        <span className="spacer" />
        <span className={`chip ${n.guard.blocked ? "chip-danger" : n.guard.level === "warn" ? "chip-warn" : "chip-ok"}`}>
          {n.guard.blocked ? "refused" : n.guard.level === "warn" ? "warned" : "clear"}
        </span>
      </div>
      <p className="small dim">
        {n.saved_utc} · {n.verdict.status === "none" ? "nothing decided" : n.verdict.status} ·{" "}
        {n.data.build_id ? `build ${n.data.build_id.slice(0, 8)}` : "no build id"}
        {stale ? " · written against different data" : ""}
      </p>
      <p className="small">{summarizeNote(n)}</p>
      <details>
        <summary>the verdict as it was saved</summary>
        <p className="small">{n.verdict.status_line}</p>
        {n.verdict.match_note ? <p className="small dim">{n.verdict.match_note}</p> : null}
        {n.verdict.reaction_name ? (
          <p className="small">
            <button className="link" onClick={() => n.verdict.reaction_id && onSheet(n.verdict.reaction_id)}>
              {n.verdict.reaction_name}
            </button>{" "}
            <span className="dim">(the record as it reads now, which may have moved)</span>
          </p>
        ) : null}
        {n.numbers.length ? (
          <dl className="kv">
            {n.numbers.map((x, i) => (
              <div key={i} className="kv-row">
                <dt>{x.label}</dt>
                <dd>
                  <span className="mono">
                    {x.value} {x.unit}
                  </span>
                  <p className="small dim">{x.basis}</p>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="small dim">no numbers were recorded with this one</p>
        )}
        {n.guard.findings.length ? (
          <div className="sub">
            <p className="sub-h">what the guard said</p>
            {n.guard.findings.map((f, i) => (
              <p key={i} className="small">
                <span className={`chip ${f.level === "block" ? "chip-danger" : f.level === "warn" ? "chip-warn" : "chip"}`}>{f.level}</span>{" "}
                <strong>{f.head}</strong> — {f.text} <em>{f.from}</em>
              </p>
            ))}
          </div>
        ) : null}
      </details>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <button className="pill-btn" onClick={onOpen}>
          put it back on the bench
        </button>
        <button className="link" onClick={onDelete}>
          delete
        </button>
      </div>
    </div>
  );
}

/** a number the app printed, ready for the notebook's record of it */
export function num(label: string, value: number | null | undefined, unit: string, basis: string, dp = 4): NoteNumber {
  return { label, value: value === null || value === undefined ? "not printed" : g(value, dp), unit, basis };
}
