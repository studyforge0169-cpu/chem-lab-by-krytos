import { useMemo } from "react";
import { useApp } from "../state/app.js";
import { Computed, ProvLine } from "../components/Prov.js";
import { FindingList } from "../components/Finding.js";
import { formula, g, ionLabel } from "../lib/format.js";
import { controlRule, guardReaction, guardSpecies } from "../lib/guard.js";
import "./reaction.css";

/** One reaction record, everything in it, in the order a person reads it: what happens, what it
 *  costs in energy, what the data says about danger - and, when the data says the "how" is not
 *  for a bench, the fields the app is withholding are named instead of quietly dropped.
 */

const OBS_KIND: Record<string, string> = {
  light: "light",
  colour_change: "colour",
  timescale: "time",
  note: "note",
  gas: "gas",
  solid: "solid",
  heat: "heat",
  sound: "sound",
  precipitate: "solid",
  temperature: "heat",
};

function TermList({ terms, side, hideScale }: { terms: any[]; side: string; hideScale: boolean }) {
  const { open } = useApp();
  if (!terms.length) return null;
  return (
    <div className="terms">
      <p className="sub-h">{side}</p>
      {terms.map((t, i) => (
        <div key={`${t.token}-${i}`} className="term">
          <button className="link mono" onClick={() => t.species_id && open({ kind: "species", id: t.species_id })}>
            {t.coefficient !== 1 ? `${t.coefficient} ` : ""}
            {formula(t.token)}
          </button>
          {t.phase ? <span className="chip">{t.phase}</span> : null}
          {!hideScale && typeof t.grams_per_mol_rxn === "number" ? (
            <span className="small">
              <Computed
                value={g(t.grams_per_mol_rxn, 5)}
                unit="g per mole of reaction"
                basis={`${t.coefficient} × the molar mass on the ${t.species_id ?? t.token} record, which is itself computed from CIAAW atomic weights`}
              />
            </span>
          ) : null}
          {t.dHf_phase_note ? <p className="small dim">{t.dHf_phase_note}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function ReactionSheet({ id }: { id: string }) {
  const { store, ctx, open, addToBench, setTab } = useApp();
  const rx = store.reactionById.get(id);
  const g0 = useMemo(() => guardReaction(rx, store, ctx), [rx, store, ctx]);
  const terms = useMemo(() => {
    if (!rx) return [];
    return [...(rx.reactants ?? []), ...(rx.products ?? [])]
      .map((t: any) => t.species_id)
      .filter(Boolean)
      .map((sid: string) => store.speciesById.get(sid))
      .filter(Boolean) as any[];
  }, [rx, store]);
  const blockedTerms = useMemo(() => terms.filter((s) => s.not_a_shelf_reagent || guardSpecies(s, store, ctx).findings.some((f) => f.level === "block")), [terms, store, ctx]);

  if (!rx)
    return (
      <div className="card">
        <div className="sect">no such record</div>
        <p className="small">
          <code>{id}</code> is not in the shipped reaction set. The app will not show you a reaction it cannot find.
        </p>
      </div>
    );

  const bc: any = (rx as any).balance_check ?? null;
  const ref: any = (rx as any).reference && typeof (rx as any).reference === "object" ? (rx as any).reference : null;
  const cur: any = (rx as any).thermo_curated ?? null;
  const der: any = (rx as any).thermo_derived ?? null;
  const suppressed = [
    g0.suppress_route ? "the apparatus and materials lists (`safety.apparatus`, `safety.materials`)" : null,
    g0.hide_scale ? "any quantity to weigh or measure, and the bench link that would carry them" : null,
    g0.hide_scale ? "the scale the record allows (`safety.max_scale`)" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="rs">
      <header className="rs-hd">
        <h2>{rx.name}</h2>
        <div className="row" style={{ gap: 5, flexWrap: "wrap" }}>
          <span className="chip">{rx.record_type}</span>
          {(rx.categories ?? []).map((c) => (
            <span key={c} className="chip">
              {c}
            </span>
          ))}
          {(rx.tags ?? []).map((t) => (
            <span key={t} className="chip">
              #{t}
            </span>
          ))}
          {g0.danger_score !== null ? <span className={`chip ${g0.danger_score >= 3 ? "chip-danger" : "chip-warn"}`}>danger {g0.danger_score}/5</span> : null}
        </div>
      </header>

      {g0.findings.some((f) => f.level !== "note") ? (
        <div className="card">
          <div className="sect">what the safety layer says first</div>
          <FindingList findings={g0.findings} idBase="rx" />
        </div>
      ) : null}

      {suppressed.length ? (
        <div className="card withheld">
          <div className="sect">what is not printed here</div>
          <p className="small">
            the record contains all of this and the app is withholding it:
            <ul className="plain">
              {suppressed.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            What stays on screen is the equation, the energy, the observations and the accident history, because that is the part worth knowing.
          </p>
        </div>
      ) : null}

      {rx.equation ? (
        <div className="card">
          <div className="sect">the equation as the record writes it</div>
          <p className="mono rs-eq">{ionLabel(rx.equation)}</p>
          {rx.reactants_written || rx.products_written ? (
            <p className="small mono dim">
              as published: {rx.reactants_written} → {rx.products_written}
            </p>
          ) : null}
          {bc ? (
            <p className="small">
              {bc.atoms_ok ? (
                <span className="chip chip-ok">atoms balance</span>
              ) : (
                <span className="chip chip-danger">does not balance</span>
              )}{" "}
              <span className="dim">
                charge {((bc.charge ?? []) as number[]).join(" vs ")} · counted {Object.keys(bc.elements ?? {}).length} elements
                {(bc.problems ?? []).length ? ` · problems: ${(bc.problems as string[]).join("; ")}` : ""}
              </span>
            </p>
          ) : null}
          {rx.solver ? (
            <p className="small dim">
              balanced by the build's solver
              {typeof rx.solver === "object" && (rx.solver as any).method ? ` (${(rx.solver as any).method})` : ""}; the app never re-balances a
              curated equation by hand
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="card">
        <TermList terms={(rx.reactants ?? []) as any[]} side="goes in" hideScale={g0.hide_scale} />
        <TermList terms={(rx.products ?? []) as any[]} side="comes out" hideScale={g0.hide_scale} />
      </div>

      {rx.observations?.length ? (
        <div className="card">
          <div className="sect">what you would see</div>
          {rx.observations.map((o, i) => (
            <p key={i} className="rs-obs">
              <span className="chip">{OBS_KIND[o.kind] ?? o.kind}</span> {o.text}
            </p>
          ))}
        </div>
      ) : null}

      {cur || der ? (
        <div className="card">
          <div className="sect">the energy in it</div>
          {cur?.dH ? (
            <p className="rs-line">
              <span className="rs-lab">as curated</span>
              <ProvLine p={cur.dH} />
              {cur.per ? <span className="small dim"> · {cur.per}</span> : null}
            </p>
          ) : null}
          {der?.dH_rxn ? (
            <p className="rs-line">
              <span className="rs-lab">re-derived by the build</span>
              <ProvLine p={der.dH_rxn} />
            </p>
          ) : null}
          {der?.missing_terms?.length ? (
            <p className="note note-warn">
              the ledger is short {der.missing_terms.length} term{der.missing_terms.length === 1 ? "" : "s"}:
              <ul className="plain">
                {(der.missing_terms as any[]).map((t, i) => (
                  <li key={i}>
                    <span className="mono">{typeof t === "string" ? t : t?.token}</span>
                    {typeof t === "object" && t?.reason ? <span className="dim"> — {String(t.reason)}</span> : null}
                  </li>
                ))}
              </ul>
              that is why the numbers above may not agree, and the derived one is the weaker of the two.
            </p>
          ) : null}
          {cur?.dH?.value != null && der?.dH_rxn?.value != null ? (
            <p className="small dim">
              <Computed
                value={`${g(der.dH_rxn.value - cur.dH.value, 4)} kJ`}
                unit="between the two"
                basis="curated figure minus the ledger's sum; the basis each one is written on is quoted above, and a difference of a factor of the leading coefficient is the usual reason"
              />
            </p>
          ) : null}
        </div>
      ) : null}

      {rx.teaching_note || rx.reference || rx.note ? (
        <div className="card">
          {rx.teaching_note ? <p className="find-text">{rx.teaching_note}</p> : null}
          {rx.note ? <p className="find-text">{String(rx.note)}</p> : null}
          {ref ? (
            <p className="small from">
              no citation sits on this record. what <code>reference</code> holds is the fields the build read off the source line, and the app shows
              them as-is rather than dressing them up as a source:{" "}
              <span className="mono">
                {Object.entries(ref)
                  .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : String(v)}`)
                  .join(", ")}
              </span>
            </p>
          ) : (
            <p className="small from">this record carries no reference field at all, so there is nothing to quote for it</p>
          )}
        </div>
      ) : null}

      {!g0.suppress_route && ((rx as any).safety?.apparatus?.length || (rx as any).safety?.materials?.length) ? (
        <div className="card">
          <div className="sect">what the record says you need</div>
          {(rx as any).safety?.apparatus?.length ? <p className="small">apparatus: {(rx as any).safety.apparatus.join(", ")}</p> : null}
          {(rx as any).safety?.materials?.length ? <p className="small">materials: {(rx as any).safety.materials.join(", ")}</p> : null}
          {(rx as any).safety?.unregistered_apparatus?.length ? (
            <p className="note note-warn">
              the record names apparatus the data has no entry for: <span className="mono">{(rx as any).safety.unregistered_apparatus.join(", ")}</span>{" "}
              — so the app cannot tell you where you would get it or what its tolerance is.
            </p>
          ) : null}
        </div>
      ) : null}

      {g0.controls.length ? (
        <div className="card">
          <div className="sect">the controls on this record, one by one</div>
          {g0.controls.map((t) => {
            const r = controlRule(t);
            return (
              <p key={t} className="rs-ctrl">
                <span className="mono">{t}</span>{" "}
                <span className={`chip ${!r ? "chip-warn" : r.level === "block" ? "chip-danger" : r.level === "warn" ? "chip-warn" : "chip"}`}>
                  {r ? (r.level === "block" ? "stops the bench" : r.level === "warn" ? "warns" : "notes") : "this app has no rule for it"}
                </span>
                <em>{r?.what ?? "shown to you as the data writes it, uninterpreted"}</em>
              </p>
            );
          })}
          {(rx as any).safety?.max_scale ? (
            <p className="small">
              the largest scale the record allows: <strong>{String((rx as any).safety.max_scale)}</strong> — the app quotes it, it cannot check your
              glassware against it
            </p>
          ) : (
            <p className="small dim">the record sets no scale limit; the limits in tables.safety_limits still apply and are on the Safety tab</p>
          )}
        </div>
      ) : null}

      {blockedTerms.length ? (
        <p className="note note-danger">
          {blockedTerms.length} substance{blockedTerms.length === 1 ? "" : "s"} in this equation is not a shelf reagent (
          {blockedTerms.map((s) => s.name).join(", ")}), so no quantity is printed for it anywhere in this app.
        </p>
      ) : null}

      <div className="row" style={{ gap: 6, marginTop: 10 }}>
        {g0.hide_scale ? (
          <span className="chip chip-danger">the bench route is closed on this record</span>
        ) : (
          <button
            className="pill-btn"
            onClick={() => {
              for (const t of (rx.reactants ?? []) as any[]) if (t.species_id) addToBench(t.species_id);
              setTab("bench");
            }}
          >
            put the {((rx.reactants ?? []) as any[]).length} reactants on the bench
          </button>
        )}
        {((rx.reactants ?? []) as any[]).map((t) => (
          <button key={t.species_id ?? t.token} className="pill-btn" onClick={() => t.species_id && open({ kind: "species", id: t.species_id })}>
            {formula(t.token)} on the shelf
          </button>
        ))}
      </div>
    </div>
  );
}
