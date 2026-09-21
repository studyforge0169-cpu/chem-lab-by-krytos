import { useMemo, useState } from "react";
import { useApp } from "../state/app.js";
import {
  anionScheme,
  cationScheme,
  curriculum,
  kits,
  measuresIn,
  organicTests,
  paperTests,
  practicalGaps,
  techniques,
  troubleshooting,
  type ApparatusRef,
} from "../lib/practical.js";
import { ShelfSection } from "./ShelfApparatus.js";
import { DEFAULT_SHELF_FILTER, shelfRows } from "../lib/apparatusShelf.js";
import "./work.css";

/** The practical work: what you are actually asked to do at a bench, and in what order.
 *
 *  Every piece of glassware is quoted with the tolerance the register carries; every id that the
 *  register does not have is counted and named. Nothing here invents a quantity — the syllabus
 *  entries name reagents, not amounts, so the bench is handed the bottle at the app's usual starting
 *  amount and told that in words.
 */

const SECTIONS = ["schemes", "techniques", "kits", "syllabus", "glassware", "when it goes wrong"] as const;
type Section = (typeof SECTIONS)[number];

export function WorkScreen() {
  const { store } = useApp();
  const [section, setSection] = useState<Section>("schemes");
  const model = useMemo(
    () => ({
      cation: cationScheme(store),
      anion: anionScheme(store),
      organic: organicTests(store),
      paper: paperTests(store),
      tech: techniques(store),
      kits: kits(store),
      cur: curriculum(store),
      trouble: troubleshooting(store),
      gaps: practicalGaps(store),
      shelf: shelfRows(store, DEFAULT_SHELF_FILTER),
    }),
    [store],
  );
  const experiments = model.cur.reduce((a, g) => a + g.experiments.length, 0);

  return (
    <div>
      <div className="card">
        <div className="sect">the practical work</div>
        <p className="small">
          {model.cation.length} cation groups, {model.anion.reduce((a, b) => a + b.tests.length, 0)} anion tests, {model.organic.length} functional-group
          tests, {model.tech.length} techniques, {model.kits.length} kits and {experiments} syllabus experiments — read out of{" "}
          <code>lab.cation_scheme</code>, <code>lab.organic_tests</code>, <code>tables.techniques</code>, <code>lab.kits</code> and{" "}
          <code>lab.curriculum</code>, with the register's tolerances beside every piece of glassware.
        </p>
        <div className="row" style={{ gap: 5, flexWrap: "wrap", marginTop: 8 }}>
          {SECTIONS.map((x) => (
            <button key={x} className="pill-btn" aria-pressed={section === x} onClick={() => setSection(x)}>
              {x}
              {x === "techniques" ? ` (${model.tech.length})` : ""}
              {x === "kits" ? ` (${model.kits.length})` : ""}
              {x === "syllabus" ? ` (${experiments})` : ""}
              {x === "glassware" ? ` (${model.shelf.total})` : ""}
              {x === "when it goes wrong" ? ` (${model.trouble.length})` : ""}
            </button>
          ))}
        </div>
        {model.gaps.length ? (
          <p className="small how">
            {model.gaps.length} of the things these entries ask for are not in <code>tables.apparatus</code>; they are listed at the foot of every
            section, not hidden in it.
          </p>
        ) : null}
      </div>

      {section === "schemes" ? <Schemes cation={model.cation} anion={model.anion} organic={model.organic} paper={model.paper} /> : null}
      {section === "techniques" ? <Techniques rows={model.tech} /> : null}
      {section === "kits" ? <Kits rows={model.kits} techniques={model.tech} /> : null}
      {section === "syllabus" ? <Syllabus groups={model.cur} /> : null}
      {section === "glassware" ? <ShelfSection /> : null}
      {section === "when it goes wrong" ? <Trouble rows={model.trouble} /> : null}

      <GapCard gaps={model.gaps} />
    </div>
  );
}

/* ------------------------------------------------------------------ the analysis schemes */

export function Schemes({
  cation,
  anion,
  organic,
  paper,
}: {
  cation: ReturnType<typeof cationScheme>;
  anion: ReturnType<typeof anionScheme>;
  organic: ReturnType<typeof organicTests>;
  paper: ReturnType<typeof paperTests>;
}) {
  const { open, addToBench, bench } = useApp();
  const [tab, setTab] = useState<"cations" | "anions" | "organic" | "papers">("cations");
  const onBench = new Set(bench.map((b) => b.species_id));
  return (
    <>
      <div className="row" style={{ gap: 5, flexWrap: "wrap", margin: "8px 0" }}>
        {(["cations", "anions", "organic", "papers"] as const).map((x) => (
          <button key={x} className="pill-btn" aria-pressed={tab === x} onClick={() => setTab(x)}>
            {x === "cations" ? `cations (${cation.length} groups)` : x === "anions" ? `anions (${anion.reduce((a, b) => a + b.tests.length, 0)})` : x === "organic" ? `functional group (${organic.length})` : `paper (${paper.length})`}
          </button>
        ))}
      </div>

      {tab === "cations"
        ? cation.map((c, i) => (
            <div className="card" key={c.group}>
              <div className="sect">
                group {i} · {c.group.replace(/^group [IVX0-9]+ ?\(?/i, "").replace(/\)$/, "")}
              </div>
              <p className="work-reagent">
                <strong>{i === 0 ? "before anything else" : `after group ${i - 1}`}:</strong> {c.reagent}
              </p>
              {c.reagent_species.length ? (
                <p className="row work-species">
                  {c.reagent_species.map((sp) => (
                    <span key={sp.id + sp.says} className="chip-wrap">
                      <button className="chip chip-link" onClick={() => onBench.has(sp.id) ? open({ kind: "species", id: sp.id }) : addToBench(sp.id)}>
                        {sp.says} → {onBench.has(sp.id) ? "already on the bench, open it" : "put the bottle on the bench"}
                      </button>
                      {sp.state ? <span className="small dim">{sp.state}</span> : null}
                    </span>
                  ))}
                </p>
              ) : null}
              {c.reagent_species.some((sp) => sp.mismatch) ? (
                <p className="note note-warn">
                  {c.reagent_species.find((sp) => sp.mismatch)!.mismatch}
                </p>
              ) : null}
              {c.precipitate.length ? (
                <table className="t">
                  <thead>
                    <tr>
                      <th>what falls</th>
                      <th>as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.precipitate.map((p) => (
                      <tr key={p.formula}>
                        <td>
                          {p.id ? (
                            <button className="link" onClick={() => p.id && open({ kind: "species", id: p.id })}>
                              {p.formula}
                            </button>
                          ) : (
                            <span className="mono">{p.formula}</span>
                          )}
                        </td>
                        <td className="small">{p.look}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="small dim">nothing is precipitated at this group — {i === 0 ? "the test is on the gas" : "the data names no solid"}</p>
              )}
              {c.gas ? (
                <p className="small">
                  <strong>gas:</strong> {c.gas}
                </p>
              ) : null}
              {c.why ? <p className="work-why">{c.why}</p> : null}
              {c.confirm.length ? (
                <ul className="work-confirm">
                  {c.confirm.map((x) => (
                    <li key={`${x.for ?? ""}-${x.text}`}>
                      {x.for ? <strong>{x.for}: </strong> : null}
                      {x.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small dim">the record carries no confirmatory test for this group, so none is invented here</p>
              )}
              {c.reactions.length ? (
                <p className="row" style={{ gap: 5, flexWrap: "wrap" }}>
                  {c.reactions.map((r) => (
                    <button key={r.id} className="chip chip-link" onClick={() => open({ kind: "reaction", id: r.id })}>
                      {r.name}
                    </button>
                  ))}
                </p>
              ) : null}
            </div>
          ))
        : null}

      {tab === "anions"
        ? anion.map((b) => (
            <div className="card" key={b.block}>
              <div className="sect">{b.block}</div>
              <table className="t">
                <tbody>
                  {b.tests.map((t) => (
                    <tr key={t.anion}>
                      <th className="small">{t.anion}</th>
                      <td className="small">{t.observation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        : null}

      {tab === "organic" ? (
        <div className="card">
          <div className="sect">functional-group tests, as the data writes them</div>
          {organic.map((t, i) => (
            <div className="org-row" key={`${t.group}-${i}`}>
              <p className="row" style={{ gap: 6 }}>
                <span className="chip">{t.group}</span>
                <strong>{t.reagent}</strong>
                <span className="spacer" />
                {t.timescale ? <span className="small mono">{t.timescale}</span> : null}
              </p>
              <p className="small">
                <strong>a yes looks like:</strong> {t.positive}
              </p>
              {t.caution ? <p className="work-why">the trap: {t.caution}</p> : null}
              {t.strength_note ? <p className="note note-warn">{t.strength_note}</p> : null}
              {t.reagent_species.length ? (
                <p className="row" style={{ gap: 5, flexWrap: "wrap" }}>
                  {t.reagent_species.map((sp) => (
                    <button key={sp.id + sp.says} className="chip chip-link" onClick={() => open({ kind: "species", id: sp.id })}>
                      {sp.says} is {sp.label}
                    </button>
                  ))}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {tab === "papers" ? (
        <div className="card">
          <div className="sect">paper, and what a colour on it does and does not mean</div>
          {paper.map((p) => (
            <div className="org-row" key={p.name}>
              <p>
                <strong>{p.name}</strong>
              </p>
              <p className="small">
                {p.how} — <em>{p.positive}</em>
              </p>
              <p className="work-why">{p.note}</p>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ apparatus, shared */

export function AppList({ items, unregistered, prose }: { items: ApparatusRef[]; unregistered: string[]; prose?: string[] }) {
  if (!items.length && !unregistered.length) return <p className="small dim">this entry names no glassware</p>;
  return (
    <>
      <ul className="app-list">
        {items.map((a) => (
          <li key={`${a.from}-${a.id}-${a.raw}`}>
            <span className="app-label">{a.label}</span>
            {a.capacity ? <span className="small mono dim">{a.capacity}</span> : null}
            {a.tolerance ? <span className="small mono">{a.tolerance}</span> : <span className="small dim">no tolerance in the register</span>}
            {a.note ? <span className="small dim">{a.note}</span> : null}
          </li>
        ))}
      </ul>
      {unregistered.length ? (
        <p className="small dim">
          and, in these words, {unregistered.join("; ")} — the register has no row for them
        </p>
      ) : null}
      {prose?.length ? (
        <p className="small dim">
          this entry names its glassware in prose, not by register id: {prose.join(" · ")} — kept as written, and not counted as a gap in the
          register
        </p>
      ) : null}
    </>
  );
}

export function Techniques({ rows }: { rows: ReturnType<typeof techniques> }) {
  const { open } = useApp();
  const [which, setWhich] = useState<string | null>(null);
  return (
    <>
      <div className="row" style={{ gap: 5, flexWrap: "wrap", margin: "8px 0" }}>
        {rows.map((t) => (
          <button key={t.id} className="pill-btn" aria-pressed={which === t.id} onClick={() => setWhich(which === t.id ? null : t.id)}>
            {t.name}
          </button>
        ))}
      </div>
      {rows
        .filter((t) => !which || t.id === which)
        .map((t) => (
          <div className="card" key={t.id}>
            <div className="sect">
              {t.name}
              {t.experiments.length ? <span className="small dim"> · {t.experiments.length} syllabus {t.experiments.length === 1 ? "experiment" : "experiments"}</span> : null}
            </div>
            <p className="small">{t.goal}</p>
            {t.steps.length ? (
              <ol className="work-steps">
                {t.steps.map((st, i) => (
                  <li key={`${t.id}-${i}`}>{st}</li>
                ))}
              </ol>
            ) : (
              <p className="small dim">the data gives this technique no step list — the goal and the apparatus are all there is</p>
            )}
            <AppList items={t.apparatus} unregistered={t.unregistered} prose={t.prose} />
            {measuresIn(t.apparatus) ? <p className="small how">{measuresIn(t.apparatus)}</p> : null}
            {t.extra.map((x) => (
              <p className="work-extra" key={x.label}>
                <strong>{x.label}:</strong> {x.text}
              </p>
            ))}
            {t.reactions.length ? (
              <p className="row" style={{ gap: 5, flexWrap: "wrap" }}>
                {t.reactions.map((r) => (
                  <button key={r.id} className={`chip chip-link ${t.blocked.includes(r.name) ? "chip-danger" : ""}`} onClick={() => open({ kind: "reaction", id: r.id })}>
                    {t.blocked.includes(r.name) ? "shown, not run: " : "a reaction done this way: "}
                    {r.name}
                  </button>
                ))}
              </p>
            ) : null}
            {t.kits.length ? (
              <p className="small dim">
                the kit that carries these pieces: {t.kits.join(", ")} — matched on the register ids, not on the words
              </p>
            ) : null}
          </div>
        ))}
    </>
  );
}

export function Kits({ rows, techniques: techs }: { rows: ReturnType<typeof kits>; techniques: ReturnType<typeof techniques> }) {
  const tolTotal = rows.reduce((a, k) => a + k.with_measures, 0);
  return (
    <>
      <div className="card">
        <div className="sect">what a kit is</div>
        <p className="small">
          {rows.length} lists of glassware, {tolTotal} of whose {rows.reduce((a, k) => a + k.items.length, 0)} resolved pieces carry a tolerance in
          the register. A technique is "in" a kit when both name the same registered item — not when their words look alike.
        </p>
      </div>
      {rows.map((k) => (
        <div className="card" key={k.id}>
          <div className="sect">
            {k.name} · {k.items.length} in the register, {k.unregistered.length} not
          </div>
          <AppList items={k.items} unregistered={k.unregistered} />
          {k.techniques.length ? (
            <p className="small">
              the techniques that use it: {k.techniques.join(", ")}
            </p>
          ) : (
            <p className="small dim">
              no technique in <code>tables.techniques</code> names any of these items by register id — for {techs.length} techniques checked
            </p>
          )}
        </div>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ the syllabus index */

export function Syllabus({ groups }: { groups: ReturnType<typeof curriculum> }) {
  const { open, addToBench, bench, setTab } = useApp();
  const [group, setGroup] = useState<string>(groups[0]?.group ?? "");
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const onBench = new Set(bench.map((b) => b.species_id));
  const shown = groups.find((g) => g.group === group);
  return (
    <>
      <div className="row" style={{ gap: 5, flexWrap: "wrap", margin: "8px 0" }}>
        {groups.map((g) => (
          <button key={g.group} className="pill-btn" aria-pressed={g.group === group} onClick={() => setGroup(g.group)}>
            {g.group} ({g.experiments.length})
          </button>
        ))}
      </div>
      {shown?.experiments.map((e, ei) => {
        const full = showAll[`${group}-${ei}`];
        const sp = full ? e.species : e.species.slice(0, 4);
        return (
          <div className="card" key={`${group}-${e.name}`}>
            <div className="sect">
              {e.name}
              {e.minutes ? <span className="small dim"> · about {e.minutes} min</span> : <span className="small dim"> · the data names no duration</span>}
            </div>
            {e.safety ? <p className="note note-warn">{e.safety}</p> : null}
            {e.note ? <p className="work-why">{e.note}</p> : null}
            {e.reactions.length ? (
              <ul className="rx-pick">
                {e.reactions.map((r) => (
                  <li key={r.id}>
                    <button className="link" onClick={() => open({ kind: "reaction", id: r.id })} disabled={r.missing}>
                      {r.missing ? `the syllabus names ${r.id}, which the file does not have` : r.name}
                    </button>
                    {!r.missing && !r.route ? <span className="chip chip-danger">route withheld by the guard — no procedure is printed</span> : null}
                    {!r.missing && r.why_no_route ? <span className="small dim">{r.why_no_route}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small dim">this entry names no reaction: it is a skill, not a mixture</p>
            )}
            {e.species.length ? (
              <>
                <p className="small">
                  the bottles this starts from — <strong>the syllabus entry gives no amounts</strong>, so the bench gets each one at 1 g to edit, and
                  nothing is computed until you type what you actually measured
                </p>
                <ul className="rx-pick">
                  {sp.map((x) => (
                    <li key={x.id} className="row" style={{ gap: 6 }}>
                      <span className="mono">{x.label}</span>
                      <span className="small">{x.name}</span>
                      <span className="spacer" />
                      {x.blocked ? (
                        <span className="chip chip-danger">not offered: {x.blocked}</span>
                      ) : (
                        <button
                          className="pill-btn"
                          onClick={() => {
                            addToBench(x.id);
                            setTab("bench");
                          }}
                        >
                          {onBench.has(x.id) ? "on the bench" : "put on the bench"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {e.species.length > 4 && !full ? (
                  <button className="link" onClick={() => setShowAll({ ...showAll, [`${group}-${ei}`]: true })}>
                    this needs {e.species.length} bottles and the bench holds 4 — show the rest
                  </button>
                ) : null}
                {full && e.species.length > 4 ? <p className="small dim">the bench still holds four at a time; take them on and off as you go</p> : null}
              </>
            ) : null}
            <AppList items={e.apparatus} unregistered={e.unregistered} />
          </div>
        );
      })}
    </>
  );
}

export function Trouble({ rows }: { rows: ReturnType<typeof troubleshooting> }) {
  return (
    <>
      {rows.map((t) => (
        <div className="card" key={t.symptom}>
          <div className="sect">{t.symptom}</div>
          <ul className="work-confirm">
            {t.causes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="work-why">{t.fix}</p>
          {t.techniques.length ? <p className="small dim">the words of this entry name: {t.techniques.join(", ")}</p> : null}
        </div>
      ))}
    </>
  );
}

function GapCard({ gaps }: { gaps: ReturnType<typeof practicalGaps> }) {
  if (!gaps.length) return null;
  const byKind = new Map<string, number>();
  for (const g of gaps) byKind.set(g.kind, (byKind.get(g.kind) ?? 0) + 1);
  const refs = new Map<string, string[]>();
  for (const g of gaps) refs.set(g.ref, [...(refs.get(g.ref) ?? []), g.where]);
  return (
    <div className="card">
      <div className="sect">what the practical layer asks for that the register does not have</div>
      <p className="small">
        {gaps.length} references ({[...byKind.entries()].map(([k, n]) => `${n} ${k}`).join(", ")}). They are listed instead of hidden because a kit
        you cannot assemble is a fact about the data, not about you — most of these are household or non-measuring items, which the tolerance
        register has no reason to carry, and the fix is in the source table.
      </p>
      <table className="t">
        <thead>
          <tr>
            <th>named as</th>
            <th>by</th>
          </tr>
        </thead>
        <tbody>
          {[...refs.entries()].map(([ref, where]) => (
            <tr key={ref}>
              <td className="mono">{ref}</td>
              <td className="small dim">{where.slice(0, 3).join("; ")}{where.length > 3 ? ` and ${where.length - 3} more` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
