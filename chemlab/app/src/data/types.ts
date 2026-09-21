/** The shapes of `../data/chemlab.json.gz` and `combinations.json.gz`, as built.
 *
 *  Nothing here re-declares a unit or a value: the warehouse already carries provenance on
 *  every number, so the UI type for one is `Prov<T>` and the only way to render it is through
 *  `<Prov>`, which prints the source and the confidence with the value. Unknown keys are
 *  allowed on purpose: the data layer grows fields, and a screen must not crash on one. */

export type Confidence = "high" | "med" | "low" | "approx";

/** Every numeric fact in the warehouse. `value: null` plus `missing` is a real answer. */
export interface Prov<T = number> {
  value: T | null;
  units?: string;
  source?: string;
  ref_id?: string | null;
  confidence?: Confidence;
  /** why it is missing, when value is null */
  missing?: string;
  note?: string;
  /** false on fields that are calculated for an element nobody has weighed */
  measured?: boolean;
  basis?: string;
  /** kelvin, kept beside every degC conversion */
  kelvin?: number;
  [k: string]: unknown;
}

export interface IonRadius {
  charge: number;
  coordination: string | null;
  spin: string | null;
  radius_pm: number | null;
  crystal_radius_pm?: number | null;
  source?: string;
  confidence?: Confidence;
}

export interface Isotope {
  mass_number: number;
  mass_u: number | null;
  abundance_percent: number | null;
  abundance_uncertainty?: number | null;
  spin?: string | null;
  half_life?: string | null;
  source?: string;
  confidence?: Confidence;
}

export interface ElementDatasetLinks {
  species_ids: string[];
  species_count: number;
  elemental_species?: string[];
  reaction_ids: string[];
  reaction_count: number;
  weighable?: boolean;
  note?: string;
}

export interface ElementRec {
  number: number;
  symbol: string;
  name: string;
  established?: string;
  category?: string;
  phase_at_298K?: string;
  group?: number | null;
  period?: number;
  block?: string;
  atomic_mass: Prov;
  mass_uncertainty?: Prov;
  monoisotopic?: boolean;
  radioactive?: boolean;
  not_a_shelf_reagent?: boolean;
  values_are_predicted?: boolean;
  prediction_note?: string;
  longest_lived_isotope?: string;
  electron_configuration?: string;
  shells?: number[];
  electronegativity_pauling?: Prov;
  electronegativity_allen?: Prov;
  electron_affinity?: Prov;
  ionisation_kJ_mol?: Prov[] | Prov;
  atomic_radius_pm?: Prov;
  covalent_radius_pm?: Prov;
  metallic_radius_pm?: Prov;
  vdw_radius_pm?: Prov;
  polarisability_bohr3?: Prov;
  density?: Prov;
  heat_capacity_molar?: Prov;
  heat_capacity_specific?: Prov;
  thermal_conductivity?: Prov;
  lattice_structure?: Prov<string> | Prov;
  lattice_constant?: Prov;
  mel_point?: Prov;
  boil_point?: Prov;
  critical_temp?: Prov;
  triple_point?: Prov;
  is_sublimation?: boolean;
  boil_below_melt_note?: string;
  kelvin_note?: string;
  fusion_heat_kJ_mol?: Prov;
  vaporisation_heat_kJ_mol?: Prov;
  oxidation_states_main?: number[] | null;
  oxidation_states_extended?: number[] | null;
  oxidation_states_observed?: number[] | null;
  oxidation_states_provenance?: string;
  oxidation_states_source?: string;
  ionic_radii?: IonRadius[];
  isotopes_natural?: Isotope[];
  isotopes_stable_count?: number;
  standard_atomic_weight_source?: string;
  abundance_crust_ppm?: Prov;
  abundance_sea_mg_L?: Prov;
  cas?: string | null;
  appearance?: string | null;
  colour_hex?: string | null;
  summary?: string | null;
  name_origin?: string | null;
  occurrence?: string | null;
  uses?: string | null;
  discovered_by?: string | null;
  discovery_year?: Prov<number> | number | null;
  dataset?: ElementDatasetLinks;
  [k: string]: unknown;
}

export interface GhsBlock {
  signal_word?: string | null;
  pictograms?: string[];
  h_codes?: { code: string; text: string; cat?: string; text_authoritative?: string }[];
  p_codes?: { code: string; text: string }[];
  source?: string;
  [k: string]: unknown;
}

export interface SpeciesRec {
  id: string;
  name: string;
  kind: "species" | "aqueous_ion" | "mixture" | "alias" | "polymer" | "note" | string;
  state?: "s" | "l" | "g" | "aq" | "v" | "soln" | null;
  formula?: string | null;
  formula_written?: string | null;
  formula_shared_with?: string[];
  elements?: Record<string, number>;
  ion?: { charge: number; formula?: string | null };
  molar_mass?: Prov | null;
  cas?: string | null;
  cas_provenance?: Record<string, unknown>;
  cas_conflict?: Record<string, unknown>;
  colour?: string | null;
  colour_description?: string | null;
  colour_hex?: string | null;
  colour_resolved_from?: string;
  flame?: Record<string, unknown>;
  ghs?: GhsBlock | null;
  hazard_score?: number | null;
  nfpa?: Record<string, unknown>;
  pubchem?: Record<string, unknown>;
  props_mp?: Prov;
  props_bp?: Prov;
  props_den?: Prov;
  props_sol?: Prov & { text?: string };
  props_ka?: Prov & { values?: number[] };
  props_odour?: string;
  odour?: string;
  oxidation_states?: Record<string, number[]>;
  oxidation_states_basis?: string;
  oxidation_states_unresolved?: string[];
  oxidation_states_note?: string;
  availability?: string;
  from_element?: string;
  not_a_shelf_reagent?: boolean;
  shelf_block_reason?: string;
  derived_record?: boolean;
  note?: string;
  [k: string]: unknown;
}

export interface TermRec {
  coefficient: number;
  token: string;
  species_id: string | null;
  phase?: string | null;
  solvent?: string | null;
  formula?: string | null;
  moles?: number;
  molar_mass?: number | null;
  grams_per_mol_rxn?: number | null;
  display_name?: string;
  dHf_kJ_mol?: number | null;
  dHf_phase?: string | null;
  dHf_phase_note?: string;
  dHf_source?: string;
  [k: string]: unknown;
}

export interface Observation {
  code?: string;
  kind: "gas" | "precipitate" | "colour_change" | "heat" | "light" | "sound" | "flame"
    | "timescale" | "narrative" | "note" | string;
  text: string;
  colour?: string;
  colour_hex?: string;
  [k: string]: unknown;
}

export interface ReactionRec {
  id: string;
  name: string;
  record_type: "equation" | "process" | string;
  categories?: string[];
  tags?: string[];
  equation?: string | null;
  reactants_written?: string | null;
  products_written?: string | null;
  reactants?: TermRec[];
  products?: TermRec[];
  appears?: string[];
  observations?: Observation[];
  thermo_curated?: (Prov & { per?: string }) | null;
  thermo_derived?: {
    dH_rxn?: Prov;
    per?: string;
    missing_terms?: string[];
    term_detail?: Record<string, unknown>;
    cross_check?: Record<string, unknown>;
  } | null;
  safety?: {
    danger_score?: number;
    controls?: string[];
    max_scale?: string | null;
    apparatus?: string[];
    materials?: string[];
    blocked?: boolean;
    [k: string]: unknown;
  } | null;
  teaching_note?: string | null;
  reference?: string | null;
  solver?: Record<string, unknown>;
  balance_check?: Record<string, unknown>;
  kinetics?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface PrecipRow {
  cation: string;
  anion: string;
  cation_id: string;
  anion_id: string;
  product: string;
  product_hill: string;
  coefficients: [number, number];
  molar_mass: Prov;
  outcome:
    | "precipitate"
    | "no visible change"
    | "acid on the salt of a weak acid"
    | "no acid-base reaction"
    | "neutralisation"
    | "ammonia released"
    | null;
  basis: string | null;
  ksp?: Prov & { [k: string]: unknown };
  ksp_key?: string;
  dissolution_equation?: string;
  solubility_mol_L?: Prov;
  solubility_g_L?: Prov;
  rule?: { solubility?: string; statement?: string; exceptions_apply_to?: string[] | null };
  confidence?: Confidence;
  gas?: string;
  conjugate_acid?: string;
  odour?: string;
  pKa_of_conjugate_acid?: Prov;
  no_reaction?: boolean;
  partial_protonation?: boolean;
  species_id?: string;
  product_name?: string;
  product_in_dataset?: boolean;
  product_solubility_on_record?: Prov & { text?: string };
  colour?: string;
  colour_hex?: string | null;
  colour_note?: string;
  net_ionic?: string | null;
  net_ionic_note?: string;
  note?: string;
  why?: string;
  [k: string]: unknown;
}

export interface EmfBlock {
  E: Prov;
  n?: number | null;
  log_k?: Prov;
  delta_G_kJ?: Prov;
  anode?: string;
  cathode?: string;
  couples?: Record<string, unknown>;
  verdict?: string | null;
  note?: string;
  [k: string]: unknown;
}

export interface CombinationRec {
  pair: string;
  elements: [string, string];
  formula: string | null;
  formula_hill: string | null;
  formula_reduced?: string | null;
  states?: [number, number] | null;
  status: "verified" | "empirical" | "predicted" | "none" | string;
  why?: string | null;
  note?: string | null;
  molar_mass?: Prov | null;
  electronegativity_difference?: Prov | null;
  percent_ionic_character?: Prov | null;
  predicted_emf?: EmfBlock | null;
  /** present on the 156 rows that carry an emf: log K per mole of electrons, not per formula unit */
  log_k?: Prov | null;
  delta_g_kJ_per_mol?: Prov | null;
  why_no_verdict?: string | null;
  verdict?: string | null;
  reaction_ids: string[];
  species_id?: string | null;
  [k: string]: unknown;
}

export interface WarehouseDoc {
  meta: {
    name?: string;
    version?: string;
    generated?: string;
    counts?: Record<string, number>;
    licenses?: { dataset: string; license: string; attribution?: string }[];
    conventions?: Record<string, string>;
    [k: string]: unknown;
  };
  elements: ElementRec[];
  species: SpeciesRec[];
  reactions: ReactionRec[];
  tables: Record<string, any> & { precipitation_matrix?: Record<string, PrecipRow> };
  lab: Record<string, any>;
  derived: Record<string, any>;
  safety_index: Record<string, any>;
  index: {
    colour_map: Record<string, string>;
    by_formula: Record<string, string[]>;
    hazard_order?: Record<string, unknown>;
    categories?: Record<string, unknown>;
    gas_tests?: Record<string, unknown>;
    [k: string]: unknown;
  };
  combinations_note?: string;
  [k: string]: unknown;
}

export type SearchFn = (q: string, limit?: number) => any[];

/** The parsed warehouse plus the indexes. Screens read this and never re-derive it. */
export interface Store {
  doc: WarehouseDoc;
  manifest: { generated: string; build_id: string; files: Record<string, any> } | null;
  buildId: string;
  dataGenerated: string;
  elements: ElementRec[];
  elementBySymbol: Map<string, ElementRec>;
  elementByNumber: Map<number, ElementRec>;
  species: SpeciesRec[];
  speciesById: Map<string, SpeciesRec>;
  reactions: ReactionRec[];
  reactionById: Map<string, ReactionRec>;
  reactionsBySpecies: Map<string, ReactionRec[]>;
  precip: Map<string, PrecipRow>;
  precipList: PrecipRow[];
  precipByProduct: Map<string, PrecipRow[]>;
  ionOf: Map<string, { role: "cation" | "anion"; key: string; other: string }>;
  combos: CombinationRec[];
  combosByPair: Map<string, CombinationRec[]>;
  /** the `meta` block of the combinations file, kept so the browser can check its own row counts
   *  against what the file claims and say so when they disagree */
  combosMeta?: any;
  combosByStatus: Map<string, number>;
  counts: Record<string, number>;
  search: SearchFn;
  [k: string]: unknown;
}

export interface CombinationsDoc {
  meta?: Record<string, unknown>;
  combinations: CombinationRec[];
}
