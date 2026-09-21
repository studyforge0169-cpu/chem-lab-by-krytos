import { useApp } from "../state/app.js";
import { ProvLine } from "../components/Prov.js";
import { ComboEmfChain } from "./CombosScreen.js";
import { STATUS_MEANING, pairCells, rowModel } from "../lib/combos.js";
import { formula, g, ionLabel } from "../lib/format.js";

/** One element pair, every row the file has for it.
 *
 *  A pair can have several rows - different oxidation-state choices give different formulas - so
 *  the sheet prints all of them rather than picking the prettiest.
 */
export function CombinationSheet({ pair }: { pair: string }) {
  const { store, open, close, setTab, setCellPair, setCalcMode } = useApp();
  const rows = store.combosByPair.get(pair) ?? store.combos.filter((c) => c.pair === pair);
  if (!rows.length)
    return (
      <div className="card">
        <div className="sect">no row for that pair</div>
        <p className="small">
          <code>{pair}</code> is not in the combination file. The app will not describe a pair it has no row for.
        </p>
      </div>
    );

  const els = rows[0].elements ?? pair.split("-");
  const cells = pairCells(store, els as string[], (rows[0].predicted_emf as any)?.couples);
  const el = (sym: string) => store.elementBySymbol.get(sym);

  return (
    <div>
      <header className="ss-hd">
        <h2>
          {els.map((e) => formula(e)).join(" + ")} <span className="chip">{pair}</span>
        </h2>
        <p className="small dim">{els.map((e) => el(e)?.name ?? e).join(" and ")}</p>
        <div className="row" style={{ gap: 6 }}>
          {els.map((e) => (
            <button key={e} className="pill-btn" onClick={() => open({ kind: "element", symbol: e })}>
              {e} · {el(e)?.name ?? "not in the element table"}
            </button>
          ))}
        </div>
      </header>

      <p className="small">
        {rows.length} row{rows.length === 1 ? "" : "s"} in the file for this pair. Each one is a different claim, so each carries its own status word.
      </p>

      {rows.map((c, i) => {
        const m = rowModel(store, c);
        return (
          <div className="card" key={`${c.pair}-${i}`}>
            <div className="row">
              <span className={`chip ${c.status === "verified" || c.status === "empirical" ? "chip-ok" : c.status === "predicted" ? "chip-pred" : "chip"}`}>
                {c.status}
              </span>
              <span className="spacer" />
              <span className="small">{m.states}</span>
            </div>
            <p className="mono combo-big">{c.formula ? ionLabel(c.formula) : "no formula the valence rules allow"}</p>
            {(c as any).name ? <p className="small">{String((c as any).name)}</p> : null}
            {c.formula_reduced && c.formula_reduced !== c.formula ? (
              <p className="small mono">reduced from the states used: {c.formula_reduced}</p>
            ) : null}

            <dl className="kv">
              <div className="kv-row">
                <dt>molar mass</dt>
                <dd>
                  <ProvLine p={c.molar_mass as any} />
                </dd>
              </div>
              <div className="kv-row">
                <dt>Δχ</dt>
                <dd>
                  <ProvLine p={c.electronegativity_difference as any} />
                </dd>
              </div>
              <div className="kv-row">
                <dt>% ionic</dt>
                <dd>
                  <ProvLine p={c.percent_ionic_character as any} />
                </dd>
              </div>
              {(c as any).state ? (
                <div className="kv-row">
                  <dt>state used</dt>
                  <dd className="small">{String((c as any).state)}</dd>
                </div>
              ) : null}
              {(c as any).properties_available ? (
                <div className="kv-row">
                  <dt>properties</dt>
                  <dd className="small">{String((c as any).properties_available)}</dd>
                </div>
              ) : null}
            </dl>

            {m.verdict ? <p className="small">the row's verdict: <strong>{m.verdict}</strong></p> : null}
            {m.why ? <p className="note note-warn">{m.why}</p> : null}
            {m.why_no_verdict ? <p className="note">{m.why_no_verdict}</p> : null}
            {m.note ? <p className="small">{m.note}</p> : null}
            {c.species_id && m.species ? (
              <p className="small">
                on the shelf:{" "}
                <button className="link" onClick={() => open({ kind: "species", id: c.species_id! })}>
                  {m.species.name}
                </button>{" "}
                <span className="dim">
                  —{" "}
                  {c.status === "verified"
                    ? "a verified row means the record and this row are the same substance"
                    : "this row's formula is the empirical ratio of that record, so its properties are quoted from there and were not measured on this ratio"}
                </span>
              </p>
            ) : c.species_id ? (
              <p className="note note-warn">
                this row points at <code>{c.species_id}</code>, which is not on the shelf. The link is broken in the data, not in the app.
              </p>
            ) : null}

            {(c.reaction_ids ?? []).length ? (
              <p className="small">
                {(c.reaction_ids as string[]).map((id, j) => (
                  <span key={id}>
                    {j ? " · " : ""}
                    <button className="link" onClick={() => open({ kind: "reaction", id })}>
                      {store.reactionById.get(id)?.name ?? id}
                    </button>
                  </span>
                ))}
              </p>
            ) : c.status === "verified" ? (
              <p className="small dim">no reaction record in the file has this pair as its product</p>
            ) : null}

            {(c as any).other_reactions_of_this_pair?.length ? (
              <p className="small">
                other reactions of {pair}:{" "}
                {((c as any).other_reactions_of_this_pair as string[]).slice(0, 6).map((id, j) => (
                  <span key={id}>
                    {j ? ", " : ""}
                    <button className="link" onClick={() => open({ kind: "reaction", id })}>
                      {store.reactionById.get(id)?.name ?? id}
                    </button>
                  </span>
                ))}
                {(c as any).other_reactions_note ? <em> {(c as any).other_reactions_note}</em> : null}
              </p>
            ) : null}

            <ComboEmfChain raw={c} />
          </div>
        );
      })}

      {cells.length ? (
        <div className="card">
          <div className="sect">the cells this pair could be</div>
          <p className="small">
            {cells.some((c) => c.from_row)
              ? "not both elements are metal strips, so the app has no element electrodes to compare here: these are the two couples the row itself names, re-read from tables.e0 and subtracted the same way"
              : "every element electrode in the half-cell table for these two elements, both ways round. Where a metal has more than one couple the app lists each instead of choosing one for you"}
          </p>
          <div className="combo-cells">
            {cells.map((c) => (
              <button
                key={`${c.a.key}|${c.b.key}`}
                className="combo-cellrow"
                onClick={() => {
                  setCellPair({ a: c.a.key, b: c.b.key });
                  setCalcMode("cell");
                  setTab("calc");
                  close();
                }}
              >
                <span className="mono">{c.a.key}</span>
                <span className="spacer" />
                <span className="mono">{c.b.key}</span>
                <span className="spacer" />
                <strong>{g(c.E, 4)} V</strong>
              </button>
            ))}
          </div>
          <p className="small dim">tapping one opens the cell builder with these two electrodes and the n, log K and ΔG derived there</p>
        </div>
      ) : (
        <p className="note">
          neither element of this pair has a metal-strip couple in <code>tables.e0</code>, so there is no cell to build from it and the app will not
          invent one.
        </p>
      )}

      <p className="note">
        {STATUS_MEANING[rows[0].status] ?? "this row carries a status the app has no legend for, so it is printed as it is"}
        {" · "}
        an emf on a row is aqueous standard-state arithmetic: it says nothing about rate, nothing about what the solid looks like, and nothing about
        whether you would see anything happen.
      </p>
    </div>
  );
}
