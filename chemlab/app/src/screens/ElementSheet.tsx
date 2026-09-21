import type { ReactNode } from "react";
import { useApp } from "../state/app.js";
import type { Prov } from "../data/types.js";
import { ProvLine } from "../components/Prov.js";
import { formula, g, ionSymbol, joinList, oxList, stateWord } from "../lib/format.js";

/** Everything the warehouse knows about one element, in the order a person actually asks:
 *  what is it → what is its atom like → what does it do to heat → how does it react → where is
 *  it → what is it in this lab for. A field with no value is shown as a row that says why. */

function P({ label, p }: { label: string; p?: Prov | null }) {
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
function T({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
function Sect({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="sect">{title}</div>
      <dl className="kv">{children}</dl>
    </>
  );
}

export function ElementSheet({ symbol }: { symbol: string }) {
  const { store, open } = useApp();
  const e = store.elementBySymbol.get(symbol);
  if (!e) return <p className="note note-warn">No element record for “{symbol}”.</p>;
  const ds = e.dataset ?? (undefined as any);
  const ll = e.longest_lived_isotope as any;
  const rawIe = e.ionisation_kJ_mol as any;
  const ies: any[] = Array.isArray(rawIe) ? rawIe : rawIe ? [rawIe] : [];
  const oxRow = (label: string, xs?: number[] | null, note?: string) =>
    xs === undefined ? null : (
      <T label={label}>
        {xs && xs.length ? (
          <span className="mono">{oxList(xs)}</span>
        ) : (
          <span className="small">none in this data</span>
        )}
        {note ? <span className="small"> · {note}</span> : null}
      </T>
    );

  return (
    <article className="elem-sheet">
      <header className="es-head">
        <span className="es-swatch" style={{ background: e.colour_hex ?? "var(--cat-unknown)" }} aria-hidden />
        <div>
          <h2>
            {e.name} <span className="small mono">({e.symbol}, {e.number})</span>
          </h2>
          <div className="row" style={{ gap: 4 }}>
            <span className="chip">{e.category}</span>
            <span className="chip">{stateWord(e.phase_at_298K?.toLowerCase()) || e.phase_at_298K}</span>
            {e.radioactive ? <span className="chip chip-warn">radioactive</span> : null}
            {e.monoisotopic ? <span className="chip">monoisotopic</span> : null}
            {e.values_are_predicted ? <span className="chip chip-pred">values predicted</span> : null}
            {e.atomic_mass?.confidence === "approx" ? <span className="chip chip-warn">mass ≈</span> : null}
          </div>
        </div>
      </header>

      {e.not_a_shelf_reagent ? (
        <p className="note note-danger">
          <strong>Not a shelf reagent.</strong> {e.name} can be read about and its properties
          compared, but this lab will not put a bottle of it on the bench
          {e.radioactive ? " — it is radioactive and no quantities exist for it" : ""}.
        </p>
      ) : null}
      {e.prediction_note ? (
        <p className="note note-warn">
          <strong>Predicted, not measured.</strong> {e.prediction_note}
        </p>
      ) : null}

      <Sect title="identity">
        <P label="atomic weight" p={e.atomic_mass} />
        <P label="uncertainty" p={e.mass_uncertainty} />
        {typeof e.atomic_mass?.isotopic_mass_u === "number" ? (
          <T label="isotopic mass">
            <span className="mono">{g(e.atomic_mass.isotopic_mass_u as number, 8)} u</span>
            {e.atomic_mass.isotopic_mass_note ? (
              <span className="small"> · {e.atomic_mass.isotopic_mass_note as string}</span>
            ) : null}
          </T>
        ) : null}
        <T label="CAS">
          <span className="mono">{e.cas ?? "—"}</span>
        </T>
        <T label="appearance">{e.appearance ? String(e.appearance) : <span className="small">not described</span>}</T>
        <T label="position">
          <span className="mono">
            {joinList([
              e.group ? `group ${e.group}` : "f-block",
              e.period ? `period ${e.period}` : "",
              e.block ? `${e.block}-block` : "",
            ])}
          </span>
        </T>
        {e.established ? <T label="established">{String(e.established)}</T> : null}
        {e.discovered_by || e.discovery_year ? (
          <T label="discovered">
            {joinList([
              e.discovered_by ?? "",
              typeof e.discovery_year === "object" ? "" : String(e.discovery_year ?? ""),
            ])}
          </T>
        ) : null}
        {e.name_origin ? <T label="name">{e.name_origin}</T> : null}
      </Sect>

      <Sect title="the atom">
        <T label="configuration">
          <span className="mono">{e.electron_configuration ?? "—"}</span>
        </T>
        {e.shells?.length ? (
          <T label="shells">
            <span className="mono">{e.shells.join(" · ")}</span>
          </T>
        ) : null}
        <P label="χ Pauling" p={e.electronegativity_pauling} />
        <P label="χ Allen" p={e.electronegativity_allen} />
        <P label="e⁻ affinity" p={e.electron_affinity} />
        <P label="radius (calc)" p={e.atomic_radius_pm} />
        <P label="covalent" p={e.covalent_radius_pm} />
        <P label="metallic" p={e.metallic_radius_pm} />
        <P label="van der Waals" p={e.vdw_radius_pm} />
        <P label="polarisability" p={e.polarisability_bohr3} />
        {ies.length ? (
          <T label={`ionisation (${ies.length})`}>
            <table className="t">
              <thead>
                <tr>
                  <th>shell</th>
                  <th>kJ/mol</th>
                  <th>source</th>
                </tr>
              </thead>
              <tbody>
                {ies.map((p: any, i: number) => (
                  <tr key={i}>
                    <td>
                      I<sub>{i + 1}</sub>
                    </td>
                    <td>
                      {typeof p === "object" && p ? <ProvLine p={p as Prov} /> : <span className="mono">{g(Number(p), 6)}</span>}
                    </td>
                    <td className="small">{typeof p === "object" && p ? (p as any).source ?? "" : "element table"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {typeof ies[0] !== "object" ? (
              <p className="small">
                successive ionisation energies as the element table gives them; the jump between
                two rows is the shell change, and that jump is the teaching point
              </p>
            ) : null}
          </T>
        ) : null}
      </Sect>

      <Sect title="heat and state">
        {e.kelvin_note ? (
          <T label="">
            <span className="small">{e.kelvin_note}</span>
          </T>
        ) : null}
        <P label="melting point" p={e.mel_point} />
        <P label="boiling point" p={e.boil_point} />
        {e.boil_below_melt_note ? (
          <T label="sublimes">
            <span className="note note-warn" style={{ margin: 0 }}>
              {e.boil_below_melt_note}
            </span>
          </T>
        ) : null}
        <P label="critical temp" p={e.critical_temp} />
        <P label="triple point" p={e.triple_point} />
        <P label="Δ fusion" p={e.fusion_heat_kJ_mol} />
        <P label="Δ vapourisation" p={e.vaporisation_heat_kJ_mol} />
        <P label="Cp molar" p={e.heat_capacity_molar} />
        <P label="Cp specific" p={e.heat_capacity_specific} />
        <P label="thermal λ" p={e.thermal_conductivity} />
      </Sect>

      <Sect title="structure">
        <T label="lattice">
          {e.lattice_structure ? (
            typeof e.lattice_structure === "object" && "value" in e.lattice_structure ? (
              <ProvLine p={e.lattice_structure as Prov<string>} />
            ) : (
              String((e.lattice_structure as any).value ?? e.lattice_structure)
            )
          ) : (
            <span className="small">not in the data</span>
          )}
        </T>
        <P label="lattice constant" p={e.lattice_constant} />
      </Sect>

      <Sect title="how it reacts">
        {oxRow("common states", e.oxidation_states_main, e.oxidation_states_source ?? e.oxidation_states_provenance)}
        {oxRow("also reported", e.oxidation_states_extended)}
        {oxRow("in this dataset", e.oxidation_states_observed, ds?.species_count ? `from ${ds.species_count} species here` : undefined)}
        {e.ionic_radii?.length ? (
          <T label={`ionic radii (${e.ionic_radii.length})`}>
            <table className="t">
              <thead>
                <tr>
                  <th>ion</th>
                  <th>coord</th>
                  <th>spin</th>
                  <th>pm</th>
                  <th>cryst.</th>
                </tr>
              </thead>
              <tbody>
                {e.ionic_radii.map((r, i) => (
                  <tr key={i}>
                    <td className="mono">{ionSymbol(e.symbol, r.charge)}</td>
                    <td>{r.coordination ?? "—"}</td>
                    <td>{r.spin ?? "—"}</td>
                    <td>{g(r.radius_pm, 3)}</td>
                    <td>{g(r.crystal_radius_pm ?? null, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <span className="small">{e.ionic_radii[0]?.source}</span>
          </T>
        ) : null}
      </Sect>

      <Sect title="where it comes from">
        <P label="crust" p={e.abundance_crust_ppm} />
        <P label="sea water" p={e.abundance_sea_mg_L} />
        {e.occurrence ? <T label="obtained">{e.occurrence}</T> : null}
        {e.uses ? <T label="uses">{e.uses}</T> : null}
      </Sect>

      <Sect title={`isotopes${e.isotopes_natural?.length ? ` (${e.isotopes_natural.length})` : ""}`}>
        {e.isotopes_natural?.length ? (
          <T label="natural">
            <table className="t">
              <thead>
                <tr>
                  <th>A</th>
                  <th>mass / u</th>
                  <th>abundance</th>
                  <th>spin</th>
                </tr>
              </thead>
              <tbody>
                {e.isotopes_natural.map((iso) => (
                  <tr key={iso.mass_number}>
                    <td className="mono">
                      {e.symbol}-{iso.mass_number}
                    </td>
                    <td>{g(iso.mass_u, 9)}</td>
                    <td>
                      {iso.abundance_percent === null || iso.abundance_percent === undefined
                        ? "—"
                        : `${g(iso.abundance_percent, 5)}${
                            iso.abundance_uncertainty ? ` ± ${g(iso.abundance_uncertainty, 2)}` : ""
                          } %`}
                    </td>
                    <td>{iso.spin ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <span className="small">
              {e.isotopes_stable_count ? `${e.isotopes_stable_count} stable · ` : ""}
              {e.isotopes_natural[0]?.source ?? ""}
            </span>
          </T>
        ) : null}
        {ll ? (
          <T label="longest-lived">
            <span className="mono">
              {e.symbol}-{typeof ll === "object" ? (ll as any).mass_number : ll}
              {typeof ll === "object" && ll.half_life
                ? ` · ${g(Number(ll.half_life), 4)} ${(ll.half_life_units ?? "").trim()}`
                : ""}
            </span>
            {typeof ll === "object" && ll.note ? <span className="small"> · {ll.note}</span> : null}
            {typeof ll === "object" && ll.source ? <span className="small"> · {ll.source}</span> : null}
          </T>
        ) : null}
        {!e.isotopes_natural?.length && !e.longest_lived_isotope ? (
          <T label="isotopes">
            <span className="small">no isotope table for this element in the data</span>
          </T>
        ) : null}
      </Sect>

      <Sect title={`in this lab (${ds?.species_count ?? 0} substances, ${ds?.reaction_count ?? 0} reactions)`}>
        {ds?.species_ids?.length ? (
          <T label="species">
            <div className="row" style={{ gap: 4 }}>
              {ds.species_ids.slice(0, 40).map((id: string) => {
                const s = store.speciesById.get(id);
                const isElement = ds.elemental_species?.includes(id);
                return (
                  <button
                    key={id}
                    className={`pill-btn ${isElement ? "chip-ok" : ""}`}
                    onClick={() => open({ kind: "species", id })}
                  >
                    {formula(s?.formula_written ?? id)}
                  </button>
                );
              })}
              {ds.species_ids.length > 40 ? <span className="small">+{ds.species_ids.length - 40} more</span> : null}
            </div>
          </T>
        ) : null}
        {ds?.reaction_ids?.length ? (
          <T label="reactions">
            <div className="row" style={{ gap: 4 }}>
              {ds.reaction_ids.slice(0, 18) .map((id: string) => (
                <button key={id} className="pill-btn" onClick={() => open({ kind: "reaction", id })}>
                  {store.reactionById.get(id)?.name ?? id}
                </button>
              ))}
              {ds.reaction_ids.length > 18 ? <span className="small">+{ds.reaction_ids.length - 18} more</span> : null}
            </div>
          </T>
        ) : null}
        {ds?.weighable === false ? (
          <T label="bench">
            <span className="small">{ds.note ?? "no weighable formula for this element"}</span>
          </T>
        ) : null}
        {!ds?.species_count ? (
          <T label="species">
            <span className="small">
              nothing in this dataset contains {e.name} — the shelf record was generated from
              the element table instead
            </span>
          </T>
        ) : null}
      </Sect>

      {e.summary ? (
        <>
          <div className="sect">in its own words</div>
          <p className="small" style={{ lineHeight: 1.55 }}>
            {e.summary}
          </p>
        </>
      ) : null}
      <p className="note">
        Source of the element numbers: {e.standard_atomic_weight_source ?? "see each field"} — every
        row above carries its own citation, and a blank row means the data has no value rather
        than a zero.
      </p>
    </article>
  );
}
