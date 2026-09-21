import type { ReactNode } from "react";
import { useApp } from "../state/app.js";
import { FindingRow } from "../components/Finding.js";
import { guardSpecies } from "../lib/guard.js";
import { weighable } from "../lib/filters.js";
import { chargeText, formula, g, joinList, stateWord } from "../lib/format.js";
import { ProvLine } from "../components/Prov.js";
import "./sheet.css";

/** The whole record for one thing on the shelf. Two design decisions are worth naming:
 *  the GHS block is rendered as wording, not as codes, because "H314" means nothing on a
 *  phone screen at 11 pm; and every absent property is still a row, showing the reason the
 *  warehouse has no number, so a gap is never mistaken for "zero" or "safe". */

function Sect({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="sect">{title}</div>
      <dl className="kv">{children}</dl>
    </>
  );
}
function T({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
function P({ label, p }: { label: string; p?: any }) {
  if (!p) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <ProvLine p={p} />
      </dd>
    </>
  );
}

const PICTO: Record<string, string> = {
  "Acute Toxic": "☠",
  Corrosive: "🧪",
  Irritant: "❗",
  "Compressed Gas": "🛢",
  "Flammable": "🔥",
  Oxidiser: "⭕",
  "Health Hazard": "✚",
  Environment: "🌊",
  Explosive: "💥",
};

export function SpeciesSheet({ id }: { id: string }) {
  const { store, open, addToBench, bench, setTab, ctx } = useApp();
  const s = store.speciesById.get(id);
  if (!s) return <p className="note note-warn">No species record for “{id}”.</p>;
  const gv = guardSpecies(s, store, ctx);
  const g0: any = s.ghs ?? {};
  const pc: any = s.pubchem ?? {};
  const ptext: Record<string, string> = g0.p_text ?? {};
  const reactions = store.reactionsBySpecies.get(s.id) ?? [];
  const canWeigh = weighable(s);
  const blocked = !!s.not_a_shelf_reagent;
  const ox = s.oxidation_states ?? {};

  return (
    <article>
      <header className="es-head">
        {s.colour_hex || (s as any).swatch_hex ? (
          <span className="es-swatch" style={{ background: s.colour_hex ?? (s as any).swatch_hex }} />
        ) : null}
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <h2>
            {formula(s.formula_written ?? s.formula ?? s.name)}{" "}
            <span className="small">{s.name}</span>
          </h2>
          <div className="row" style={{ gap: 4 }}>
            <span className="chip">{s.kind === "species" ? "substance" : s.kind.replace("_", " ")}</span>
            {s.state ? <span className="chip">{stateWord(s.state)}</span> : null}
            {typeof (s as any).charge === "number" ? (
              <span className="chip mono">charge {chargeText((s as any).charge)}</span>
            ) : null}
            {s.colour_description || s.colour ? (
              <span className="chip">
                <span className="swatch" style={{ background: s.colour_hex ?? "#888" }} /> {s.colour_description ?? s.colour}
              </span>
            ) : s.colour_missing ? (
              <span className="chip">{String(s.colour_missing)}</span>
            ) : null}
            <span className={`hz hz-${s.hazard_score ?? 0}`}>hazard {s.hazard_score ?? "–"}</span>
          </div>
        </div>
        <div className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
          <button
            className="pill-btn"
            disabled={blocked || !canWeigh}
            onClick={() => {
              addToBench(s.id);
              setTab("bench");
            }}
            title={
              blocked
                ? s.shelf_block_reason ?? "not a shelf reagent"
                : canWeigh
                  ? "put a beaker of this on the bench"
                  : `${s.kind} records have no formula to weigh`
            }
          >
            {bench.some((b) => b.species_id === s.id) ? "on the bench ✓" : "add to bench"}
          </button>
          {s.from_element ? (
            <button className="pill-btn" onClick={() => open({ kind: "element", symbol: s.from_element! })}>
              element {s.from_element} →
            </button>
          ) : null}
        </div>
      </header>

      {blocked ? (
        <p className="note note-danger ss-block">
          <strong>Not on the bench.</strong> {s.shelf_block_reason ?? s.availability ?? "this element is not a reagent"}
        </p>
      ) : null}
      {!canWeigh ? (
        <p className="note note-warn ss-block">
          <strong>No stoichiometry from this record.</strong> {s.kind === "mixture" || s.kind === "polymer"
            ? "A mixture or a polymer has no fixed formula, so the app will not invent a molar mass: use it for the demonstration it belongs to."
            : s.kind === "alias"
              ? "This is a pointing record for a name someone might type; the substance itself is elsewhere on the shelf."
              : "This record is a note, not a bottle."}
        </p>
      ) : null}
      {s.availability && !blocked ? <p className="note">{s.availability}</p> : null}

      <Sect title="the label">
        <T label="CAS">
          <span className="mono">{s.cas ?? "—"}</span>
          {s.cas_provenance?.source ? <span className="small"> · {String(s.cas_provenance.source)}</span> : null}
        </T>
        {s.cas_conflict ? (
          <T label="CAS conflict">
            <span className="note note-warn" style={{ margin: 0 }}>
              this record says <code>{(s.cas_conflict as any).curated}</code> and PubChem lists{" "}
              <code>{((s.cas_conflict as any).pubchem ?? []).join(", ") || "nothing"}</code>. Both are kept: a
              registry number is a name, not a property, and a mismatch is worth reading rather than hiding.
            </span>
          </T>
        ) : null}
        {(s as any).name_candidates?.length ? <T label="also called">{(s as any).name_candidates.join(" · ")}</T> : null}
        {s.formula_shared_with?.length ? (
          <T label="same formula">
            {s.formula_shared_with.map((o) => (
              <button key={o} className="link" onClick={() => open({ kind: "species", id: o })}>
                {store.speciesById.get(o)?.formula_written ?? o}
              </button>
            ))}
            <span className="small"> · different record, same atoms — state and strength differ</span>
          </T>
        ) : null}
        <P label="molar mass" p={s.molar_mass} />
        {s.elements && Object.keys(s.elements).length ? (
          <T label="analysis">
            <span className="mono small">
              {Object.entries(s.elements)
                .map(([el, n]) => `${el}${n > 1 ? n : ""}`)
                .join(" ")}
            </span>
          </T>
        ) : null}
        {(s.formula_written ?? s.formula) && s.molar_mass?.value ? (
          <T label="per 100 g">
            <span className="small mono">{g(100 / (s.molar_mass.value as number), 4)} mol</span>
            <span className="small"> · computed here from the mass above</span>
          </T>
        ) : null}
      </Sect>

      <Sect title="numbers">
        <P label="melting point" p={s.props_mp} />
        <P label="boiling point" p={s.props_bp} />
        <P label="density" p={s.props_den} />
        <P label="solubility" p={s.props_sol} />
        {(s.props_sol as any)?.text ? <T label="solubility, in words">{(s.props_sol as any).text}</T> : null}
        <P label="pKa" p={s.props_ka} />
        {Array.isArray((s.props_ka as any)?.values) && (s.props_ka as any).values.length ? (
          <T label="pKa steps">
            <span className="mono">{(s.props_ka as any).values.map((v: number) => g(v, 4)).join(" · ")}</span>
          </T>
        ) : null}
        <P label="ΔfH (aq ion)" p={(s as any).props_dhf} />
        <P label="heat capacity" p={(s as any).heat_capacity_molar} />
        <P label="Δ fusion" p={(s as any).fusion_heat} />
        <P label="Δ vapourisation" p={(s as any).vapourisation_heat} />
        {(s as any).odour || s.props_odour ? <T label="odour">{(s as any).odour ?? s.props_odour}</T> : null}
        {s.flame ? (
          <T label="flame test">
            <span className="mono">{typeof s.flame === "string" ? s.flame : JSON.stringify(s.flame)}</span>
          </T>
        ) : null}
        {!s.props_mp && !s.props_bp && !s.props_den ? (
          <T label="properties">
            <span className="small">
              the warehouse has no measured melting point, boiling point or density for this record —
              that is a gap in the data, not a property of the substance
            </span>
          </T>
        ) : null}
      </Sect>

      {Object.keys(ox).length ? (
        <Sect title="oxidation states, assigned by the kernel">
          <T label="per element">
            <table className="t tag-table">
              <tbody>
                {Object.entries(ox).map(([el, st]) => (
                  <tr key={el}>
                    <td className="mono">
                      <button className="link" onClick={() => open({ kind: "element", symbol: el })}>
                        {el}
                      </button>
                    </td>
                    <td className="mono">
                      {(st as number[])
                        .map((x) => (x < 0 ? `−${Math.abs(x)}` : `+${x}`))
                        .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.oxidation_states_basis ? <p className="small">basis: {s.oxidation_states_basis}</p> : null}
            {s.oxidation_states_unresolved?.length ? (
              <p className="note note-warn" style={{ margin: "4px 0 0" }}>
                unresolved: {s.oxidation_states_unresolved.join(", ")} —{" "}
              {s.oxidation_states_note ?? "mixed valence, or a structure the rule set will not guess"}
              </p>
            ) : null}
          </T>
        </Sect>
      ) : null}

      {s.ghs ? (
        <Sect title="the label's warnings">
          <T label="signal word">
            <span className={`chip ${g0.signal_word === "Danger" ? "chip-danger" : "chip-warn"}`}>
              {g0.signal_word ?? "none"}
            </span>
          </T>
          {g0.pictograms?.length ? (
            <T label="pictograms">
              <div className="ghs">
                {g0.pictograms.map((p: string) => (
                  <span key={p} title={p}>
                    <span className="pictogram">
                      <span>{PICTO[p] ?? "⚠"}</span>
                    </span>
                    <span className="small" style={{ display: "block", textAlign: "center" }}>
                      {p}
                    </span>
                  </span>
                ))}
              </div>
            </T>
          ) : null}
          {g0.h_codes?.length ? (
            <T label="H statements">
              {g0.h_codes.map((h: any) => (
                <div className="statement" key={h.code}>
                  <b>{h.code}</b>
                  <span>{h.text}</span>
                </div>
              ))}
            </T>
          ) : null}
          {g0.p_codes?.length ? (
            <T label="P statements">
              {g0.p_codes.map((c: string) => (
                <div className="statement" key={c}>
                  <b>{c}</b>
                  <span>{ptext[c] ?? c}</span>
                </div>
              ))}
            </T>
          ) : null}
          {g0.hazard_classes?.length ? (
            <T label="classes">{joinList(g0.hazard_classes.map((x: any) => (typeof x === "string" ? x : x?.name)))}</T>
          ) : null}
          {g0.nfpa ? (
            <T label="NFPA 704">
              <span className="mono small">
                {joinList([
                  `health ${g0.nfpa.health ?? "–"}`,
                  `fire ${g0.nfpa.fire ?? "–"}`,
                  `instability ${g0.nfpa.instability ?? g0.nfpa.inst ?? "–"}`,
                  g0.nfpa.special ? `special ${g0.nfpa.special}` : "",
                ])}
              </span>
            </T>
          ) : null}
          <T label="source">
            <span className="small">{g0.source ?? "curated with the record"}</span>
          </T>
        </Sect>
      ) : (
        <p className="note">
          No GHS block in the warehouse for this record. The guard treats an unclassified
          substance as unknown, never as harmless.
        </p>
      )}

      <div className="sect">the guard, for this bottle</div>
      <div className="guard-for">
        {gv.findings.length ? (
          gv.findings.map((f, i) => <FindingRow key={i} f={f} />)
        ) : (
          <p className="small">
            nothing in the five safety lists names this record and its own hazard score is {s.hazard_score ?? "absent"}, so the guard has no finding
            about it — which is not the same as it being harmless: the shelf has {store.species.filter((x) => x.hazard_score == null).length} records
            with no score at all.
          </p>
        )}
        <div className="row" style={{ gap: 6, flexWrap: "wrap", margin: "6px 0" }}>
          {gv.first_aid.length ? (
            <button className="pill-btn" onClick={() => setTab("safety")}>
              {gv.first_aid.length} first-aid entr{gv.first_aid.length === 1 ? "y" : "ies"}
            </button>
          ) : (
            <span className="chip">no first-aid entry for it</span>
          )}
          {gv.waste.length ? <span className="chip">{gv.waste.map((w) => w.cls).join(" · ")}</span> : <span className="chip">no waste class covers it</span>}
          {gv.storage.length ? <span className="chip">{gv.storage.map((w) => w.rule).join(" · ")}</span> : <span className="chip">no cabinet rule for it</span>}
        </div>
        {gv.first_aid.length ? (
          <details className="quiet" open={gv.badge === "danger"}>
            <summary>if it goes wrong, and why these entries were picked</summary>
            {gv.first_aid.map((a) => (
              <p key={a.key} className="small">
                <strong>{a.key}</strong> — {a.text} <em>({a.why})</em>
              </p>
            ))}
          </details>
        ) : null}
        {gv.waste.length ? (
          <details className="quiet">
            <summary>where it goes afterwards</summary>
            {gv.waste.map((w) => (
              <p key={w.cls} className="small">
                <strong>{w.cls}</strong> — {w.rule} <em>({w.via})</em>
                <br />
                <span className="dim">{w.why}</span>
              </p>
            ))}
          </details>
        ) : null}
        {gv.storage.length ? (
          <details className="quiet">
            <summary>where it lives on the shelf</summary>
            {gv.storage.map((w) => (
              <p key={w.rule} className="small">
                <strong>{w.rule}</strong> — {w.why} <em>({w.via})</em>
              </p>
            ))}
          </details>
        ) : null}
      </div>

      {pc.cid ? (
        <Sect title="3D and structure">
          <T label="PubChem CID">
            <a href={`https://pubchem.ncbi.nlm.nih.gov/compound/${pc.cid}`} target="_blank" rel="noreferrer">
              {pc.cid}
            </a>
            <span className="small"> · fetched {pc.fetched?.slice(0, 10)}</span>
          </T>
          {pc.smiles ? (
            <T label="SMILES">
              <code className="small">{pc.smiles}</code>
              <p className="small">
                a ball-and-stick model is built from this string on the phone — the warehouse ships
                the identifier, not 494 coordinate files
              </p>
            </T>
          ) : null}
          {pc.inchikey ? (
            <T label="InChIKey">
              <code className="small">{pc.inchikey}</code>
            </T>
          ) : null}
          {pc.formula_pubchem || pc.mw_pubchem ? (
            <T label="PubChem says">
              <span className="mono small">
                {joinList([pc.formula_pubchem && `formula ${pc.formula_pubchem}`, pc.mw_pubchem && `MW ${pc.mw_pubchem}`])}
              </span>
            </T>
          ) : null}
          {pc.props_source ? <T label="how">{pc.props_source}</T> : null}
          {pc.Solubility ? <T label="solubility, as published">{JSON.stringify(pc.Solubility).slice(0, 300)}</T> : null}
        </Sect>
      ) : null}

      {reactions.length ? (
        <Sect title={`in ${reactions.length} reaction records`}>
          <T label="tap to open">
            <div className="row" style={{ gap: 4 }}>
              {reactions.slice(0, 24).map((r: any) => (
                <button key={r.id} className="pill-btn" onClick={() => open({ kind: "reaction", id: r.id })}>
                  {r.name}
                </button>
              ))}
              {reactions.length > 24 ? <span className="small">+{reactions.length - 24}</span> : null}
            </div>
          </T>
        </Sect>
      ) : null}

      {s.note ? (
        <>
          <div className="sect">the note that came with it</div>
          <p className="small" style={{ lineHeight: 1.55 }}>
            {s.note}
          </p>
        </>
      ) : null}
      {s.derived_record ? (
        <p className="note">
          This ion row was created by the build so that net-ionic equations resolve; its mass
          ignores the electron mass, exactly as the handbooks do.
        </p>
      ) : null}
    </article>
  );
}
