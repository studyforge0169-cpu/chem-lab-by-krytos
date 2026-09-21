import { useMemo, useState } from "react";
import { useApp } from "../state/app.js";
import { Computed, ProvLine } from "../components/Prov.js";
import { FindingList } from "../components/Finding.js";
import { ionLabel } from "../lib/format.js";
import {
  CONTROL_VOCABULARY,
  controlCensus,
  guardBench,
  ruleApplicability,
  safetyLists,
  type GuardCtx,
} from "../lib/guard.js";
import "./safety.css";

/** The safety tab. It is not a warning page you scroll past: it is the guard's own working, on
 *  show - what it knows, what it refuses, what it cannot see, and the numbers it measures you
 *  against with their sources attached. */

function Toggle({
  on,
  onClick,
  yes,
  no,
}: {
  on: boolean;
  onClick: () => void;
  yes: string;
  no: string;
}) {
  return (
    <button className="pill-btn" aria-pressed={on} onClick={onClick}>
      {on ? "✓ " : ""}
      {on ? yes : no}
    </button>
  );
}

function ContextCard({ ctx, setCtx }: { ctx: GuardCtx; setCtx: (c: GuardCtx) => void }) {
  return (
    <div className="card">
      <div className="sect">where the work is actually happening</div>
      <p className="small">
        The guard reads these three answers before it decides anything, and it prints them back at you wherever it used them. Nothing here is a
        suggestion: say you have a hood and the hazard-5 refusal turns into a warning, because that is what the data's rule says.
      </p>
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <Toggle on={ctx.hood} onClick={() => setCtx({ ...ctx, hood: !ctx.hood })} yes="a fume hood is available" no="no fume hood" />
        <Toggle
          on={ctx.supervised}
          onClick={() => setCtx({ ...ctx, supervised: !ctx.supervised })}
          yes="a teacher or chemist is here"
          no="nobody supervising"
        />
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label className="small" htmlFor="room-flam">
          flammable solvent already open in the room (mL)
        </label>
        <input
          id="room-flam"
          inputMode="decimal"
          value={String(ctx.room_flammable_mL)}
          onChange={(e) => {
            const v = Number(e.target.value.replace(/[^0-9.]/g, ""));
            setCtx({ ...ctx, room_flammable_mL: Number.isFinite(v) ? Math.max(0, v) : 0 });
          }}
        />
      </div>
      <p className="note">
        the room total matters because the limit in the data is about the room, not the beaker: vapour heavier than air walks across the floor to a
        flame.
      </p>
    </div>
  );
}

function BenchCard() {
  const { store, bench, ctx, setTab } = useApp();
  const v = useMemo(() => guardBench(bench, store, ctx, null), [bench, store, ctx]);
  if (!bench.length)
    return (
      <div className="card">
        <div className="sect">the bench, guarded</div>
        <p className="small">
          Nothing is on the bench. The guard is still the thing that decides what goes on it, so when a bottle lands here its whole reasoning shows
          up next to it — put something on the bench and come back.
        </p>
      </div>
    );
  return (
    <div className="card">
      <div className="sect">
        the bench, guarded ·{" "}
        <span className={`chip ${v.level === "block" ? "chip-danger" : v.level === "warn" ? "chip-warn" : "chip-ok"}`}>
          {v.level === "block" ? "refused" : v.level === "warn" ? "proceed warned" : "nothing to report"}
        </span>
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        {v.bottles.map((b) => (
          <span key={b.species_id} className={`chip ${b.badge === "danger" ? "chip-danger" : b.badge === "warn" ? "chip-warn" : "chip"}`}>
            {ionLabel(b.name)}
            {b.hazard_score !== null ? ` · hazard ${b.hazard_score}/5` : ""}
          </span>
        ))}
      </div>
      <FindingList findings={v.findings} idBase="bench" />
      {v.bottles.some((b) => b.first_aid.length || b.waste.length || b.storage.length) ? (
        <>
          <div className="sect">for the bottles actually on this bench</div>
          {v.bottles.map((b) => (
            <div key={b.species_id} className="bottle">
              <strong>{ionLabel(b.name)}</strong>
              {b.pictograms.length ? <p className="small">{b.pictograms.join(" · ")}</p> : <p className="small">no GHS label on this record</p>}
              {b.h_codes.length ? <p className="small mono">{b.h_codes.join(" ")}</p> : null}
              {b.first_aid.length ? (
                <div className="sub">
                  <p className="sub-h">if it goes wrong</p>
                  {b.first_aid.map((a) => (
                    <p key={a.key} className="small">
                      <strong>{a.key}</strong> — {a.text} <em>({a.why})</em>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="small">nothing in the emergency file names this substance or its hazards, so there is nothing here to quote</p>
              )}
              {b.waste.length ? (
                <div className="sub">
                  <p className="sub-h">where it goes</p>
                  {b.waste.map((w) => (
                    <p key={w.cls} className="small">
                      <strong>{w.cls}</strong> — {w.rule} <em>({w.via})</em>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="small">no waste class in the data covers this record: the lab's own procedure decides, not this app</p>
              )}
              {b.storage.length ? (
                <div className="sub">
                  <p className="sub-h">where it lives</p>
                  {b.storage.map((w) => (
                    <p key={w.rule} className="small">
                      <strong>{w.rule}</strong> — {w.why} <em>({w.via})</em>
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </>
      ) : null}
      <p className="small">
        the mix itself is decided on the bench;{" "}
        <button className="link" onClick={() => setTab("bench")}>
          go and look
        </button>
        .
      </p>
    </div>
  );
}

function RefusalsCard() {
  const { store } = useApp();
  const list: any[] = (store.doc.lab as any)?.refusals ?? [];
  return (
    <div className="card">
      <div className="sect">what this app will not print, and why</div>
      <p className="small">
        these are the data's own words. The app has no opinion of its own to add, and it is not a lock you can talk it out of — the reasoning is the
        point.
      </p>
      {list.map((r) => (
        <div key={r.topic} className="refusal">
          <strong>{r.topic}</strong>
          {r.examples ? <p className="small">seen in: {r.examples}</p> : null}
          <p className="find-text">{r.policy}</p>
          {r.what_is_shown_instead ? <p className="find-action">shown instead: {r.what_is_shown_instead}</p> : null}
        </div>
      ))}
      {!list.length ? <p className="note">the shipped file carries no refusals, which would itself be worth worrying about</p> : null}
    </div>
  );
}

function LimitsCard() {
  const { store, bench, ctx } = useApp();
  const lim: any = (store.doc.tables as any)?.safety_limits ?? {};
  const v = useMemo(() => guardBench(bench, store, ctx, null), [bench, store, ctx]);
  const keys = Object.keys(lim);
  const inForce = new Map(v.limits.map((l) => [l.key, l]));
  return (
    <div className="card">
      <div className="sect">what &ldquo;too much&rdquo; means here</div>
      <p className="small">
        every limit the guard can apply, straight out of <code>tables.safety_limits</code>. The data calls them policy: they are what a school bench
        decided it could survive, not a law of nature, and the app refuses to quietly round them.
      </p>
      <dl className="kv">
        {keys.map((k) => {
          const p = lim[k];
          const live = inForce.get(k);
          const isList = Array.isArray(p?.value);
          return (
            <div key={k} className="kv-row">
              <dt className="mono">{k}</dt>
              <dd>
                {isList ? (
                  <ul className="plain">
                    {(p.value as any[]).map((x: any, i: number) => (
                      <li key={i}>{Array.isArray(x) ? x.join(" + ") : String(x)}</li>
                    ))}
                  </ul>
                ) : p?.value === null || p?.value === undefined ? (
                  <span className="small">
                    the table lists this with no number{p?.note ? ` — ${p.note}` : ""}. {`"lab.emergency"`} carries the text instead, below
                  </span>
                ) : (
                  <>
                    <ProvLine p={p} />
                    {live ? (
                      <p className="small">
                        {live.checked ? (
                          <>
                            this bench: {live.measured}
                            {live.over ? <span className="chip chip-warn"> over</span> : <span className="chip chip-ok"> within</span>}
                          </>
                        ) : (
                          <>this bench: {live.measured}</>
                        )}
                      </p>
                    ) : (
                      <p className="small">not applied to a bench with nothing on it</p>
                    )}
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {v.standing.length ? (
        <div className="sub">
          <p className="sub-h">standing rules, applied whatever is on the bench</p>
          <ul className="plain">
            {v.standing.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function EmergencyCard() {
  const { store } = useApp();
  const em: Record<string, string> = (store.doc.lab as any)?.emergency ?? {};
  const keys = Object.keys(em);
  const [q, setQ] = useState("");
  const hits = keys.filter((k) => !q.trim() || (k + em[k]).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="card">
      <div className="sect">first aid, as the data has it</div>
      <p className="small">
        {keys.length} entries. The bench version of this screen picks the ones that apply to the bottle you chose and says why it picked them; here
        they all are, because reading them before you need one is the whole point.
      </p>
      <div className="field" style={{ margin: "8px 0" }}>
        <input placeholder="search: burn, spill, fume, eye…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {hits.map((k) => (
        <div key={k} className="aid">
          <strong>{k}</strong>
          <p className="find-text">{em[k]}</p>
        </div>
      ))}
      {!hits.length ? <p className="note">nothing in the emergency file matches “{q}”. That is a gap in the data, not in the search.</p> : null}
    </div>
  );
}

function ListsCard() {
  const { store } = useApp();
  const lists = useMemo(() => safetyLists(store), [store]);
  const census = useMemo(() => controlCensus(store), [store]);
  const rules = useMemo(() => ruleApplicability(store), [store]);
  const si: any = store.doc.safety_index ?? {};
  return (
    <div className="card">
      <div className="sect">the lists themselves</div>
      <p className="small mono">{si.rule ?? "the shipped file carries no rule string, so the guard is running on the lists alone"}</p>
      {lists.map((l) => (
        <details key={l.key} className="list">
          <summary>
            <strong>{l.label}</strong> · {l.ids.length} <span className="small">{l.what}</span>
          </summary>
          <ul className="plain">
            {l.ids.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        </details>
      ))}
      <div className="sub">
        <p className="sub-h">what the reaction records ask for, and whether this app knows how to do it</p>
        <ul className="plain">
          {census.map((c) => (
            <li key={c.token}>
              <span className="mono">{c.token}</span> ×{c.count}{" "}
              <span className={`chip ${c.known ? "chip-ok" : "chip-warn"}`}>{c.known ? "the guard acts on it" : "the guard has no rule for it"}</span>{" "}
              <em>{c.what}</em>
            </li>
          ))}
        </ul>
        <p className="small">
          the app's vocabulary has {CONTROL_VOCABULARY.length} tokens and the data uses {census.length}, so{" "}
          {census.filter((c) => !c.known).length ? "the ones marked above are shown to you unhandled" : "nothing in the data is being silently ignored"}
          .
        </p>
      </div>
      <div className="sub">
        <p className="sub-h">mixing rules the app can and cannot enforce</p>
        <p className="small">
          {rules.actionable} of {rules.total} rules name two substances the shelf holds, so those are the ones the guard can act on. The rest are about
          heat, vessels, light and skin: printed here so they are not forgotten, but the app has no way to see them.
        </p>
        <ul className="plain">
          {rules.rows.map((r) => (
            <li key={`${r.with}+${r.and}`}>
              <span className={`chip ${r.actionable ? "chip-ok" : "chip"}`}>{r.actionable ? "enforced" : "cannot see it"}</span> <strong>{r.with}</strong> +{" "}
              <strong>{r.and}</strong> <em>{r.action}</em>
              <p className="small">{r.why}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function SafetyScreen() {
  const { store, ctx, setCtx, bench } = useApp();
  const g0 = useMemo(() => guardBench(bench, store, ctx, null), [bench, store, ctx]);
  return (
    <div>
      <div className="card guard-head">
        <div className="sect">the guard</div>
        <p className="guard-level">
          <span className={`chip ${g0.level === "block" ? "chip-danger" : g0.level === "warn" ? "chip-warn" : "chip-ok"}`}>
            {g0.level === "block" ? "this bench is refused" : g0.level === "warn" ? "allowed, with warnings" : "nothing on this bench is refused"}
          </span>
        </p>
        <p className="small">
          the guard runs before the app shows anything as possible: the lists, the labels, the pairings and the quantities below are what it looked
          at, in that order.
        </p>
        <ul className="plain checks">
          {g0.checks.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        {g0.unknown_controls.length ? (
          <p className="note note-warn">
            control tokens in the data this app does not implement: <span className="mono">{g0.unknown_controls.join(", ")}</span>. They are shown to
            you as-is rather than treated as nothing.
          </p>
        ) : null}
      </div>
      <ContextCard ctx={ctx} setCtx={setCtx} />
      <BenchCard />
      <LimitsCard />
      <RefusalsCard />
      <ListsCard />
      <EmergencyCard />
      <p className="note">
        every number on this screen is a policy the data carries, with its source and its confidence;{" "}
        <Computed value={`${bench.length}`} unit="bottles" basis="what is on the bench right now, straight from the bench state" />. Nothing on this
        tab is advice about a substance the warehouse does not have a record for.
      </p>
    </div>
  );
}
