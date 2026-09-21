/** Heat and gas, from the numbers the warehouse already carries. Nothing here is a
 *  handbook value the app invented: ΔH comes from the reaction record, Cp and the molar
 *  volumes from tables.constants, the vapour pressure of water from its own table. */
import type { ReactionRec, Store } from "../data/types.js";
import { g } from "./format.js";
import type { Plan } from "./stoich.js";

export interface LedgerTerm {
  token: string;
  species_id: string | null;
  side: "reactant" | "product";
  coefficient: number;
  dHf: number | null;
  contribution_kJ: number | null;
  phase_note?: string | null;
}
export interface Ledger {
  terms: LedgerTerm[];
  sum_kJ: number | null;
  incomplete: boolean;
  missing: string[];
  /** what the record's own ΔH says, and whether it is per the equation or per mole of one term */
  stated_kJ: number | null;
  agrees: boolean | null;
  cross: any | null;
}

/** The enthalpy ledger, re-added by the app out of the per-term dHf values on the record.
 *  Rule 3 says the number the screen prints must be the number the ledger gives, so this is
 *  both the display and the check on the record - and when a term is missing it refuses to
 *  add up to anything at all. */
export function thermoLedger(reaction: ReactionRec): Ledger {
  const terms: LedgerTerm[] = [
    ...(reaction.reactants ?? []).map((t) => ({ t, side: "reactant" as const })),
    ...(reaction.products ?? []).map((t) => ({ t, side: "product" as const })),
  ].map(({ t, side }) => {
    const coeff = (t.coefficient as number) || 1;
    const dHf = (t as any).dHf_kJ_mol ?? null;
    return {
      token: t.token ?? String(t.species_id ?? "?"),
      species_id: t.species_id ?? null,
      side,
      coefficient: coeff,
      dHf: dHf as number | null,
      contribution_kJ: dHf === null || dHf === undefined ? null : (side === "product" ? 1 : -1) * coeff * dHf,
      phase_note: (t as any).dHf_phase_note ?? null,
    };
  });
  const incomplete = terms.some((x) => x.contribution_kJ === null);
  const sum = incomplete ? null : terms.reduce((a, x) => a + (x.contribution_kJ ?? 0), 0);
  const stated = reaction.thermo_derived?.dH_rxn?.value ?? null;
  const agrees = sum === null || stated === null || stated === undefined ? null : Math.abs(sum - stated) <= 0.5;
  return {
    terms,
    sum_kJ: sum === null ? null : Math.round(sum * 100) / 100,
    incomplete,
    missing: terms.filter((x) => x.contribution_kJ === null).map((x) => x.token),
    stated_kJ: stated ?? null,
    agrees,
    cross: reaction.thermo_derived?.cross_check ?? null,
  };
}

export interface HeatResult {
  dH_kJ_per_extent: number | null;
  q_kJ: number | null;
  mass_g: number;
  dT_K: number | null;
  sign: "exothermic" | "endothermic" | null;
  /** which kind of number dH_kJ_per_extent is: re-added from the ledger, or quoted as published */
  dH_kind: "derived" | "curated" | null;
  basis: string[];
  missing_terms?: string[];
  wording?: string;
  ledger?: Ledger;
}

export function runHeat(reaction: ReactionRec, plan: Plan, store: Store, water_mL = 100): HeatResult {
  const basis: string[] = [];
  const ledger = thermoLedger(reaction);
  const cp = (store.doc.tables?.constants?.Cp_water?.value ?? 4.184) as number;
  const mass = plan.rows
    .filter((r) => r.side === "reactant")
    .reduce((a, r) => a + (r.grams_have ?? 0), 0);
  // nearest tabulated temperature, not a silently rounded one
  const dens = store.doc.tables?.water_density ?? {};
  const keys = Object.keys(dens).filter((k) => /^\d+(\.\d+)?$/.test(k)).map(Number).sort((a, b) => a - b);
  const at = keys.length ? keys.reduce((a, b) => (Math.abs(b - 25) < Math.abs(a - 25) ? b : a)) : 20;
  const rho = (dens[String(at)]?.value ?? 0.9982) as number;
  const water_g = water_mL * rho;
  const total_g = mass + water_g;
  const missing_terms = (reaction.thermo_derived?.missing_terms ?? []).map((x: any) =>
    typeof x === "string" ? x : x?.token ?? "?",
  );
  if (plan.extent_mol === null)
    return {
      dH_kJ_per_extent: null,
      q_kJ: null,
      mass_g: total_g,
      dT_K: null,
      sign: null,
      dH_kind: null,
      basis: ["no extent: the amounts on the bench do not resolve to moles, so there is no 'per how much' to multiply by"],
      missing_terms,
      ledger,
    };
  const derived = reaction.thermo_derived?.dH_rxn?.value ?? null;
  const curated = ((reaction.thermo_curated as any)?.dH?.value ?? null) as number | null;
  const unit_coeffs = [...(reaction.reactants ?? []), ...(reaction.products ?? [])].every(
    (t: any) => Math.abs((t.coefficient as number) - 1) < 1e-9,
  );
  let dH: number | null = derived ?? null;
  let kind: "derived" | "curated" | null = dH === null ? null : "derived";
  if (dH === null && curated !== null) {
    if (unit_coeffs) {
      dH = curated;
      kind = "curated";
      basis.push(
        `ΔH comes from the curated ${curated} kJ on the record, not from the ledger, because a term has no ΔfH. Every coefficient here is 1, so it cannot be read as "per mole of product" by mistake - which is the only reason the app will multiply a curated number at all`,
      );
    } else {
      basis.push(
        `the record also carries a published ΔH of ${curated} kJ, but its units say "per mole of reaction as written" while the equation has coefficients other than 1: a figure quoted per mole of product and one quoted per the whole equation differ by exactly that factor here, and the record does not say which it is. So it is shown, not multiplied`,
      );
    }
  } else if (dH === null) {
    basis.push("the record has no ΔH computed from formation data, so the app does not estimate one");
  }
  if (dH === null)
    return {
      dH_kJ_per_extent: null,
      q_kJ: null,
      mass_g: total_g,
      dT_K: null,
      sign: null,
      dH_kind: null,
      basis,
      missing_terms,
      ledger,
    };
  const ext = plan.extent_mol;
  // q keeps the chemist's sign: negative = the reaction gave that much heat out.
  // dT is the other side of the same coin, the change you feel in the beaker, so it is -q.
  const q = dH * ext;
  basis.push(
    `ΔH = ${g(dH, 5)} kJ per extent (${reaction.thermo_derived?.per ?? "one mole of the equation as written"}), extent = ${ext.toFixed(4)} mol`,
  );
  basis.push(
    ledger.agrees === null
      ? "the ledger is incomplete, so nothing was re-added here"
      : ledger.agrees
        ? `the app re-added the per-term ΔfH ledger and got ${g(ledger.sum_kJ!, 5)} kJ, the same as the record`
        : `WARNING: re-adding the ledger gives ${g(ledger.sum_kJ!, 5)} kJ but the record says ${g(dH, 5)} kJ - they do not agree, so treat both as suspect`,
  );
  basis.push(`Cp of water ${cp} J/(g K) from tables.constants; the glass and the air are ignored`);
  basis.push(`q keeps the tabulated sign (${q < 0 ? "minus: heat came out of the reaction" : "plus: heat went into it"}), ΔT is what the beaker feels - the two are opposite by construction`);
  basis.push(`water taken at ${rho} g/mL, the nearest tabulated temperature (${at} °C) in tables.water_density`);
  basis.push(`heat capacity is approximated by that of water alone, ${total_g.toFixed(1)} g total (${mass.toFixed(2)} g of stuff weighed out + ${water_g.toFixed(1)} g of water)`);
  return {
    dH_kJ_per_extent: dH,
    q_kJ: q,
    mass_g: total_g,
    dT_K: total_g > 0 ? (-q * 1000) / (total_g * cp) : null,
    sign: dH < 0 ? "exothermic" : "endothermic",
    dH_kind: kind,
    basis,
    missing_terms,
    ledger,
  };
}

/** dissolving something, when the data has ΔH_solution for it. Deliberately the same shape as
 *  runHeat, so a screen can show either without special-casing which kind of number it is. */
export function solutionHeat(store: Store, species_id: string, moles: number, water_mL = 100): HeatResult {
  const sp = store.speciesById.get(species_id);
  const key = sp?.formula_written ?? sp?.formula ?? "";
  const table = (store.doc.tables?.dh_solution ?? {}) as Record<string, any>;
  const hit = table[key] ?? table[sp?.name ?? ""];
  const cp = (store.doc.tables?.constants?.Cp_water?.value ?? 4.184) as number;
  const mm = sp?.molar_mass?.value ?? null;
  const solute_g = mm !== null ? moles * mm : 0;
  const mass = water_mL * (store.doc.tables?.water_density?.["25"]?.value ?? 0.99705) + solute_g;
  if (!hit?.value)
    return {
      dH_kJ_per_extent: null,
      q_kJ: null,
      mass_g: mass,
      dT_K: null,
      sign: null,
      dH_kind: null,
      basis: [`tables.dh_solution has no entry for ${key || sp?.name || species_id}: that is a gap in the data, not a zero`],
      missing_terms: [],
      wording: "the data cannot say whether this beaker warms or cools",
    };
  const dH = hit.value as number;
  const q = dH * moles;
  const dT = mass > 0 ? (-q * 1000) / (mass * cp) : null; // same sign rule as runHeat
  return {
    dH_kJ_per_extent: dH,
    q_kJ: q,
    mass_g: mass,
    dT_K: dT,
    sign: dH < 0 ? "exothermic" : "endothermic",
    dH_kind: "curated",
    basis: [
      `ΔH_solution ${dH} kJ/mol for ${key}, ${hit.source ?? "curated"}${hit.note ? ` — ${hit.note}` : ""}`,
      `${moles.toFixed(4)} mol × ${dH} kJ/mol = ${q.toFixed(2)} kJ`,
      `${mass.toFixed(1)} g to heat: the water plus ${solute_g.toFixed(2)} g of the solid itself, at Cp ${cp} J/(g K)`,
      "tabulated at infinite dilution; at a real, concentrated solution the magnitude is a little smaller",
    ],
    missing_terms: [],
    wording: dT === null ? "—" : `${g(Math.abs(dT), 3)} K ${dH < 0 ? "warmer" : "cooler"}`,
  };
}

export interface GasResult {
  mol: number;
  V_L: number | null;
  dry_P_kPa: number;
  water_kPa: number | null;
  basis: string[];
  molar_vol_L_mol: number;
  convention: string;
  named: { key: string; value: number } | null;
  vs_air: number | null;
}

const interp = (table: Record<string, any>, T_C: number): number | null => {
  const ks = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (!ks.length) return null;
  if (T_C <= ks[0]) return table[String(ks[0])]?.value ?? null;
  for (let i = 1; i < ks.length; i++) {
    if (T_C <= ks[i]) {
      const a = table[String(ks[i - 1])], b = table[String(ks[i])];
      const t = (T_C - ks[i - 1]) / (ks[i] - ks[i - 1]);
      return (a.value ?? 0) * (1 - t) + (b.value ?? 0) * t;
    }
  }
  return table[String(ks[ks.length - 1])]?.value ?? null;
};

export function gasVolume(
  store: Store,
  mol: number,
  opts: { T_C?: number; P_kPa?: number; overWater?: boolean; molar_mass?: number | null } = {},
): GasResult {
  const T_C = opts.T_C ?? 25;
  const P = opts.P_kPa ?? (store.doc.tables?.constants?.atm?.value ?? 101325) / 1000;
  const K = T_C + 273.15;
  const mmHg_to_kPa = ((store.doc.tables?.constants?.torr?.value ?? 133.322) as number) / 1000;
  const pw_mmHg = store.doc.tables?.aqueous_tension_mmhg ? interp(store.doc.tables.aqueous_tension_mmhg, T_C) : null;
  const pw = pw_mmHg === null ? null : pw_mmHg * mmHg_to_kPa;
  const over = opts.overWater ?? false;
  const dry = over && pw !== null ? P - pw : P;
  const R = (store.doc.tables?.constants?.R?.value ?? 8.314462618) as number;
  // R in J/(mol K) is Pa m3/(mol K); V = nRT/P comes out in m3 when P is in Pa.
  // P is carried in kPa, and 1 m3 = 1000 L, so the two 1000s cancel: nRT / P(kPa) is litres.
  const V = (mol * R * K) / dry;
  const mv = (R * K) / dry; // litres per mole at exactly these conditions
  const NAMED: Record<string, string> = {
    molar_vol_STP_1atm: "STP (0 °C, 1 atm)",
    molar_vol_STP_1bar: "STP (0 °C, 1 bar, IUPAC)",
    molar_vol_RTP_20: "RTP (20 °C, 1 atm)",
    molar_vol_SATP_25: "SATP (25 °C, 1 atm)",
  };
  const consts = (store.doc.tables?.constants ?? {}) as Record<string, any>;
  let named: { key: string; value: number } | null = null;
  let nearest: { key: string; value: number; label: string; off: number } | null = null;
  for (const [key, label] of Object.entries(NAMED)) {
    const c = consts[key];
    if (!c?.value) continue;
    const off = Math.abs(c.value - mv) / mv;
    if (!nearest || off < nearest.off) nearest = { key, value: c.value as number, label, off };
    if (off < 0.005) {
      named = { key, value: c.value as number };
      break;
    }
  }
  const convention = named
    ? `${named!.value} L/mol — ${NAMED[named!.key]}, the tabulated shortcut is valid here (${label_of(consts[named!.key]?.units)})`
    : nearest
      ? `${mv.toFixed(3)} L/mol at ${T_C} °C and ${dry.toFixed(2)} kPa, straight from PV = nRT. The nearest shortcut is ${nearest.label} at ${nearest.value} L/mol, ${g(nearest.off * 100, 2)} % away, because that one is ${label_of(consts[nearest.key]?.units)} and your pressure is not that`
      : `${mv.toFixed(3)} L/mol from PV = nRT`;
  function label_of(units: unknown): string {
    const u = String(units ?? "");
    const m = u.match(/at (.*)$/);
    return m ? m[1] : u;
  }
  const basis = [
    `ideal gas at ${dry.toFixed(2)} kPa and ${K.toFixed(2)} K with R = ${R} J/(mol K)`,
    over && pw !== null
      ? `collected over water at ${T_C} °C: the vapour pressure of water is ${pw.toFixed(2)} kPa, so the gas itself is at ${dry.toFixed(2)} kPa`
      : "assumed dry",
    named ? `the same number as the textbook shortcut: ${mol.toFixed(4)} mol × ${named!.value} L/mol` : "",
    T_C <= 5
      ? `at 0 °C the molar volume is ${consts.molar_vol_STP_1bar?.value ?? 22.711} L/mol at 1 bar (IUPAC STP) but ${consts.molar_vol_STP_1atm?.value ?? 22.414} L/mol at 1 atm — "22.4" belongs to the atmosphere, not to the ice point, and the two differ by 1.3 %`
      : "",
  ].filter(Boolean);
  // relative density to air, from the two gases the data actually carries
  let vs_air: number | null = null;
  if (opts.molar_mass) {
    const n2 = store.speciesById.get("n2")?.molar_mass?.value ?? 28.014;
    const o2 = store.speciesById.get("o2")?.molar_mass?.value ?? 31.998;
    const air = 0.79 * n2 + 0.21 * o2;
    vs_air = opts.molar_mass / air;
    basis.push(`density relative to air: ${opts.molar_mass} ÷ ${air.toFixed(2)} g/mol (0.79 N₂ + 0.21 O₂)`);
  }
  return { mol, V_L: isFinite(V) ? V : null, dry_P_kPa: dry, water_kPa: pw, basis, molar_vol_L_mol: mv, convention, named, vs_air };
}
