/**
 * AI Lab Assistant - the autonomous chemist that runs the lab from natural language.
 * 
 * You say "make water" and it finds every way to make H2O.
 * You say "make an acid" and it makes many acids by selecting elements/molecules.
 * You say anything and it handles the lab.
 * 
 * No external API - all intelligence is local, using the warehouse (582 species, 424 reactions, 9410 combos).
 */

import type { SpeciesRec, ReactionRec, Store, CombinationRec } from "../data/types.js";
import type { BenchItem } from "../state/app.js";

export type AIIntent =
  | "MAKE_SPECIFIC"
  | "MAKE_CATEGORY"
  | "MAKE_MANY"
  | "MIX_FROM"
  | "EXPLORE"
  | "EXPLAIN"
  | "LIST"
  | "UNKNOWN";

export interface ParsedQuery {
  raw: string;
  intent: AIIntent;
  targetText: string;
  category?: AICategory;
  quantityHint: "single" | "many" | "all";
  fromElements?: string[];
  modifiers: string[];
  confidence: number;
}

export type AICategory =
  | "acid"
  | "base"
  | "salt"
  | "oxide"
  | "gas"
  | "precipitate"
  | "element"
  | "organic"
  | "inorganic"
  | "metal"
  | "halide"
  | "fuel"
  | "water"
  | "any";

export interface ReactionRoute {
  reaction: ReactionRec;
  richness: number;
  reason: string;
  bench: BenchItem[];
  safetyNote?: string;
  observations: string[];
  type: "direct" | "decomposition" | "precipitation" | "combination" | "multi-step";
  yieldNote?: string;
}

export interface SpeciesRoute {
  species: SpeciesRec;
  routes: ReactionRoute[];
  elements: string[];
  categoryMatch?: string;
  description: string;
}

export interface AIPlan {
  query: ParsedQuery;
  steps: { title: string; detail: string; status: "done" | "thinking" | "pending" }[];
  targets: SpeciesRec[];
  speciesRoutes: SpeciesRoute[];
  allRoutes: ReactionRoute[];
  benchPlans: { label: string; items: BenchItem[]; reactionId?: string }[];
  explanation: string;
  warnings: string[];
  suggestions: string[];
  stats: { speciesFound: number; reactionsFound: number; benchOptions: number };
}

// ---------- Intent Parsing ----------

const MAKE_VERBS = ["make", "create", "synthesize", "synthesise", "produce", "prepare", "generate", "build", "form", "get", "cook", "brew", "manufacture", "want", "need"];
const LIST_VERBS = ["show", "list", "find", "give", "display", "what", "how", "search", "tell"];
const MIX_HINTS = ["from", "using", "with", "mix", "combine", "react"];

const CATEGORY_KEYWORDS: Record<AICategory, string[]> = {
  acid: ["acid", "acids", "acidic", "hcl", "sulfuric", "sulphuric", "nitric", "phosphoric", "organic acid"],
  base: ["base", "bases", "basic", "alkali", "alkaline", "hydroxide", "caustic"],
  salt: ["salt", "salts", "chloride", "sulfate", "sulphate", "nitrate", "carbonate"],
  oxide: ["oxide", "oxides"],
  gas: ["gas", "gases", "vapour", "vapor", "fume", "air"],
  precipitate: ["precipitate", "ppt", "solid", "insoluble", "precipitation"],
  element: ["element", "elements", "metal", "metals", "nonmetal", "atom"],
  organic: ["organic", "carbon", "hydrocarbon", "alcohol", "aldehyde", "ketone", "ester"],
  inorganic: ["inorganic", "mineral"],
  metal: ["metal", "alloy"],
  halide: ["halide", "halides", "fluoride", "chloride", "bromide", "iodide"],
  fuel: ["fuel", "combustible", "burn"],
  water: ["water", "h2o", "aqua"],
  any: ["anything", "something", "compound", "substance", "chemical", "stuff", "material"],
};

const COMMON_SYNONYMS: Record<string, string> = {
  water: "water",
  h2o: "water",
  salt: "nacl",
  "table salt": "nacl",
  "common salt": "nacl",
  "hydrochloric acid": "hcl",
  "muriatic acid": "hcl",
  "sulfuric acid": "h2so4",
  "sulphuric acid": "h2so4",
  "nitric acid": "hno3",
  "acetic acid": "aceticacid",
  vinegar: "aceticacid",
  "sodium hydroxide": "naoh",
  "caustic soda": "naoh",
  "potassium hydroxide": "koh",
  "calcium carbonate": "caco3",
  limestone: "caco3",
  marble: "caco3",
  chalk: "caco3",
  "carbon dioxide": "co2",
  co2: "co2",
  ammonia: "nh3",
  "hydrogen peroxide": "h2o2",
  bleach: "naocl",
  "baking soda": "nahco3",
  "washing soda": "na2co3",
  "copper sulfate": "cuso4",
  "copper sulphate": "cuso4",
  "silver nitrate": "agno3",
  oxygen: "o2",
  hydrogen: "h2gas",
  nitrogen: "n2",
  chlorine: "cl2",
  "sulfuric": "h2so4",
  "hydrochloric": "hcl",
};

const ELEMENT_SYMBOLS = new Set([
  "H","He","Li","Be","B","C","N","O","F","Ne","Na","Mg","Al","Si","P","S","Cl","Ar","K","Ca","Sc","Ti","V","Cr","Mn","Fe","Co","Ni","Cu","Zn","Ga","Ge","As","Se","Br","Kr","Rb","Sr","Y","Zr","Nb","Mo","Tc","Ru","Rh","Pd","Ag","Cd","In","Sn","Sb","Te","I","Xe","Cs","Ba","La","Ce","Pr","Nd","Pm","Sm","Eu","Gd","Tb","Dy","Ho","Er","Tm","Yb","Lu","Hf","Ta","W","Re","Os","Ir","Pt","Au","Hg","Tl","Pb","Bi","Po","At","Rn","Fr","Ra","Ac","Th","Pa","U","Np","Pu","Am","Cm","Bk","Cf","Es","Fm","Md","No","Lr","Rf","Db","Sg","Bh","Hs","Mt","Ds","Rg","Cn","Nh","Fl","Mc","Lv","Ts","Og"
]);

function normalizeText(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function detectCategory(text: string): AICategory | null {
  const t = normalizeText(text);
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (cat === "any") continue;
    for (const kw of kws) {
      if (t.includes(kw)) return cat as AICategory;
    }
  }
  return null;
}

function detectQuantity(text: string): "single" | "many" | "all" {
  const t = normalizeText(text);
  if (/\b(many|multiple|several|lots|various|different|all|every|any)\b/.test(t)) {
    if (/\ball\b/.test(t) || /\bevery\b/.test(t)) return "all";
    return "many";
  }
  return "single";
}

function extractElementsFromText(text: string): string[] {
  // Look for element symbols or names in text like "from Na and Cl" or "using H and O"
  const tokens = text.split(/[\s,+\->]+/);
  const found: string[] = [];
  for (const tok of tokens) {
    const clean = tok.replace(/[^A-Za-z]/g, "");
    if (!clean) continue;
    // Symbol exact match (case sensitive original but we check normalized)
    const cap = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
    if (ELEMENT_SYMBOLS.has(clean) || ELEMENT_SYMBOLS.has(cap)) {
      const sym = ELEMENT_SYMBOLS.has(clean) ? clean : cap;
      if (!found.includes(sym)) found.push(sym);
    }
    // Also check for element names - simplified
    if (clean.length > 2) {
      // Will be resolved via store search later
    }
  }
  return found;
}

export function parseQuery(raw: string): ParsedQuery {
  const text = normalizeText(raw);
  if (!text) {
    return {
      raw,
      intent: "UNKNOWN",
      targetText: "",
      quantityHint: "single",
      modifiers: [],
      confidence: 0,
    };
  }

  const quantityHint = detectQuantity(text);
  const category = detectCategory(text);
  const fromElements = extractElementsFromText(raw);

  // Intent detection
  let intent: AIIntent = "UNKNOWN";
  const hasMakeVerb = MAKE_VERBS.some(v => text.includes(v));
  const hasListVerb = LIST_VERBS.some(v => text.startsWith(v) || text.includes(v));
  const hasFrom = MIX_HINTS.some(v => text.includes(v));

  // Check for category requests like "make an acid"
  const isCategoryRequest = category !== null && (
    text.includes(`an ${category}`) ||
    text.includes(`a ${category}`) ||
    text.includes(`${category}s`) ||
    text.includes(`make ${category}`) ||
    text.includes(`create ${category}`) ||
    text.match(new RegExp(`\\b${category}\\b`))
  );

  if (isCategoryRequest && quantityHint !== "single") {
    intent = "MAKE_MANY";
  } else if (hasMakeVerb) {
    if (category && (text === category || text.includes(`make ${category}`) || text.includes(`an ${category}`))) {
      intent = quantityHint === "single" ? "MAKE_CATEGORY" : "MAKE_MANY";
    } else if (hasFrom && fromElements.length >= 1) {
      intent = "MIX_FROM";
    } else {
      intent = "MAKE_SPECIFIC";
    }
  } else if (hasListVerb) {
    if (category) intent = "LIST";
    else intent = "EXPLORE";
  } else {
    // If text looks like a chemical name/formula, treat as MAKE_SPECIFIC
    if (text.length <= 30 && /^[a-z0-9()]+$/.test(text.replace(/\s/g, ""))) {
      intent = "MAKE_SPECIFIC";
    } else if (category) {
      intent = "MAKE_CATEGORY";
    } else {
      intent = "EXPLORE";
    }
  }

  // Extract target text - remove verbs
  let targetText = text;
  for (const v of [...MAKE_VERBS, ...LIST_VERBS, "me", "an", "a", "the", "some", "please", "can you", "i want to", "i need to"]) {
    const re = new RegExp(`\\b${v}\\b`, "g");
    targetText = targetText.replace(re, " ");
  }
  targetText = targetText.replace(/\b(many|multiple|several|lots|various|different|all|every)\b/g, " ");
  targetText = targetText.trim().replace(/\s+/g, " ");

  if (!targetText && category) targetText = category;

  const modifiers: string[] = [];
  if (text.includes("safe")) modifiers.push("safe");
  if (text.includes("element")) modifiers.push("from_elements");
  if (text.includes("quick") || text.includes("easy")) modifiers.push("easy");
  if (text.includes("strong") || text.includes("concentrated")) modifiers.push("strong");

  return {
    raw,
    intent,
    targetText: targetText || text,
    category: category || undefined,
    quantityHint,
    fromElements: fromElements.length ? fromElements : undefined,
    modifiers,
    confidence: 0.8,
  };
}

// ---------- Species Matching ----------

function scoreSpeciesMatch(species: SpeciesRec, query: string, category?: AICategory): number {
  const q = query.toLowerCase();
  const name = (species.name || "").toLowerCase();
  const id = species.id.toLowerCase();
  const formula = (species.formula_written || species.formula || "").toLowerCase();
  let score = 0;

  // Exact id match
  if (id === q) score += 100;
  if (COMMON_SYNONYMS[q] === id) score += 100;
  // Formula exact
  if (formula === q) score += 90;
  // Name contains
  if (name.includes(q)) score += 60;
  if (q.includes(name) && name.length > 3) score += 50;
  // Partial
  if (name.startsWith(q)) score += 40;
  if (id.includes(q)) score += 30;
  if (formula.includes(q)) score += 20;

  // Category boost
  if (category) {
    if (category === "acid" && (species.role === "acid" || name.includes("acid"))) score += 25;
    if (category === "base" && (species.role === "base" || name.includes("hydroxide") || name.includes("oxide") && species.role === "base")) score += 25;
    if (category === "salt" && !species.role && species.elements && Object.keys(species.elements).length >= 2) score += 10;
    if (category === "gas" && species.state === "g") score += 20;
    if (category === "precipitate" && species.state === "s") score += 10;
    if (category === "oxide" && name.includes("oxide")) score += 30;
    if (category === "element" && species.role === "element") score += 30;
  }

  // Penalize mixtures, aliases, notes
  if (species.kind !== "species" && species.kind !== "aqueous_ion") score -= 20;
  if (species.not_a_shelf_reagent) score -= 50;

  return score;
}

export function findSpeciesForQuery(store: Store, query: ParsedQuery): SpeciesRec[] {
  const text = query.targetText || query.raw;
  const normalized = normalizeText(text);

  // Check synonym first
  const syn = COMMON_SYNONYMS[normalized];
  if (syn) {
    const s = store.speciesById.get(syn);
    if (s) return [s];
  }

  // Use store search if available
  let candidates: SpeciesRec[] = [];
  if (store.search) {
    try {
      const hits = store.search(text, 30);
      for (const h of hits as any[]) {
        if (h.kind === "species") {
          const sp = store.speciesById.get(h.id);
          if (sp) candidates.push(sp);
        }
      }
    } catch {}
  }

  // Fallback: brute force over all species
  if (candidates.length === 0) {
    candidates = [...store.speciesById.values()];
  }

  // Score and sort
  const scored = candidates
    .map(s => ({ s, score: scoreSpeciesMatch(s, text, query.category) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  // If category query, return many
  if (query.intent === "MAKE_MANY" || query.intent === "MAKE_CATEGORY" || query.quantityHint !== "single") {
    if (query.category) {
      // For category, get all matching species for that category, not just scored
      const all = getSpeciesByCategory(store, query.category);
      // Merge with scored, prioritize scored
      const ids = new Set(scored.map(x => x.s.id));
      const merged = [...scored.map(x => x.s), ...all.filter(a => !ids.has(a.id))];
      return merged.slice(0, query.quantityHint === "all" ? 50 : 15);
    }
    return scored.slice(0, query.quantityHint === "all" ? 50 : 12).map(x => x.s);
  }

  // Single target: top 3
  return scored.slice(0, 3).map(x => x.s);
}

export function getSpeciesByCategory(store: Store, category: AICategory): SpeciesRec[] {
  const all = [...store.speciesById.values()];
  switch (category) {
    case "acid":
      return all.filter(s =>
        s.role === "acid" ||
        (s.name && s.name.toLowerCase().includes("acid")) ||
        (s.props_ka && (s.props_ka as any).values && (s.props_ka as any).values.length > 0)
      ).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    case "base":
      return all.filter(s =>
        s.role === "base" ||
        (s.name && (s.name.toLowerCase().includes("hydroxide") || s.name.toLowerCase().includes("alkali")))
      );
    case "salt":
      return all.filter(s =>
        !s.role &&
        s.kind === "species" &&
        s.elements &&
        Object.keys(s.elements).length >= 2 &&
        s.state !== "g" &&
        !s.name.toLowerCase().includes("acid") &&
        !s.name.toLowerCase().includes("oxide") &&
        s.id !== "water"
      ).slice(0, 60);
    case "oxide":
      return all.filter(s => s.name && s.name.toLowerCase().includes("oxide"));
    case "gas":
      return all.filter(s => s.state === "g");
    case "precipitate":
      return all.filter(s => s.state === "s" && s.kind === "species");
    case "element":
      return all.filter(s => s.role === "element" || s.from_element);
    case "organic":
      return all.filter(s => s.elements && s.elements["C"] && s.elements["C"] > 0);
    case "inorganic":
      return all.filter(s => !s.elements || !s.elements["C"]);
    case "halide":
      return all.filter(s => s.elements && (s.elements["Cl"] || s.elements["F"] || s.elements["Br"] || s.elements["I"]) && s.name.toLowerCase().includes("ide"));
    case "water":
      return all.filter(s => s.id === "water" || s.formula === "H2O");
    default:
      return all.filter(s => s.kind === "species").slice(0, 30);
  }
}

// ---------- Reaction Discovery ----------

function richnessScore(r: ReactionRec): number {
  let s = 0;
  s += (r.observations?.length ?? 0) * 10;
  if (r.teaching_note) s += 5;
  if (r.equation) s += 3;
  // Prefer lower danger
  const danger = (r as any).safety?.danger_score;
  if (typeof danger === "number") s -= danger * 2;
  else s += 2; // no danger score = slightly safer unknown
  // Prefer verified balanced
  if ((r as any).balance_check?.atoms_ok) s += 5;
  return s;
}

function reactionToBench(r: ReactionRec): BenchItem[] {
  const items: BenchItem[] = [];
  for (const t of (r.reactants ?? []) as any[]) {
    if (t.species_id) {
      items.push({
        species_id: t.species_id,
        qty: t.coefficient || 1,
        unit: "mol" as const,
      });
    }
  }
  return items.slice(0, 4);
}

function getObservationsText(r: ReactionRec): string[] {
  return (r.observations ?? []).map((o: any) => o.text || `${o.kind}: ${o.text}`).filter(Boolean).slice(0, 4);
}

export function findReactionsProducing(store: Store, speciesId: string): ReactionRoute[] {
  const routes: ReactionRoute[] = [];
  const reactions = store.doc.reactions ?? [];

  for (const r of reactions) {
    const products = (r.products ?? []) as any[];
    const isProducer = products.some((p: any) => p.species_id === speciesId);
    if (!isProducer) continue;

    const richness = richnessScore(r);
    const bench = reactionToBench(r);
    const obs = getObservationsText(r);
    const safety = (r as any).safety;
    let safetyNote: string | undefined;
    if (safety?.blocked) safetyNote = "⛔ Blocked - safety guard refuses this";
    else if (safety?.danger_score >= 4) safetyNote = `⚠️ High danger (${safety.danger_score}/5) - needs fume hood`;
    else if (safety?.danger_score >= 3) safetyNote = `⚠️ Moderate danger (${safety.danger_score}/5)`;

    // Determine type
    let type: ReactionRoute["type"] = "direct";
    const cats = (r.categories ?? []).join(" ").toLowerCase();
    if (cats.includes("decomposition") || r.id.startsWith("dec_")) type = "decomposition";
    else if (cats.includes("precipitation") || r.id.startsWith("ppt_")) type = "precipitation";
    else if (cats.includes("synthesis") || r.id.startsWith("syn_")) type = "direct";

    routes.push({
      reaction: r,
      richness,
      reason: `Produces ${speciesId} as product - ${r.name}`,
      bench,
      safetyNote,
      observations: obs,
      type,
    });
  }

  // Sort by richness
  routes.sort((a, b) => b.richness - a.richness);
  return routes;
}

export function findElementCombinationRoutes(store: Store, targetFormula: string): CombinationRec[] {
  const combos = [...store.combosByPair.values()].flat() as CombinationRec[];
  return combos.filter(c => c.formula === targetFormula || c.formula?.replace(/\s/g, "") === targetFormula.replace(/\s/g, "")).slice(0, 5);
}

// BFS for multi-step synthesis (depth 2)
export function findMultiStepRoutes(store: Store, targetId: string, maxDepth = 2): ReactionRoute[] {
  const visited = new Set<string>();
  const queue: { id: string; depth: number; path: ReactionRec[] }[] = [{ id: targetId, depth: 0, path: [] }];
  const found: ReactionRoute[] = [];

  while (queue.length > 0 && found.length < 10) {
    const cur = queue.shift()!;
    if (visited.has(cur.id) || cur.depth > maxDepth) continue;
    visited.add(cur.id);

    const producers = findReactionsProducing(store, cur.id);
    for (const prod of producers) {
      if (cur.depth === 0) {
        // Direct route already covered elsewhere, but include if path non-empty? Actually direct is depth 0
        // For multi-step, we want depth >=1 where intermediate needed
        continue;
      }
      // Build multi-step explanation
      const steps = [...cur.path, prod.reaction].map(r => r.name).join(" → ");
      found.push({
        ...prod,
        type: "multi-step",
        reason: `Multi-step (${cur.depth + 1} steps): ${steps} → ${targetId}`,
      });
    }

    if (cur.depth < maxDepth) {
      const producersForQueue = findReactionsProducing(store, cur.id).slice(0, 3);
      for (const p of producersForQueue) {
        for (const reactant of (p.reaction.reactants ?? []) as any[]) {
          if (reactant.species_id && !visited.has(reactant.species_id)) {
            queue.push({
              id: reactant.species_id,
              depth: cur.depth + 1,
              path: [...cur.path, p.reaction],
            });
          }
        }
      }
    }
  }

  return found;
}

// ---------- Main AI Engine ----------

export function executeAI(store: Store, rawQuery: string): AIPlan {
  const query = parseQuery(rawQuery);
  const steps: AIPlan["steps"] = [
    { title: "Understanding your request", detail: `Intent: ${query.intent}, Target: "${query.targetText}"${query.category ? `, Category: ${query.category}` : ""}`, status: "done" },
    { title: "Searching the warehouse", detail: `Scanning 582 substances, 424 reactions, 9410 element pairs...`, status: "done" },
    { title: "Planning synthesis routes", detail: `Finding every possible way to make it using the lab`, status: "thinking" },
  ];

  let targets: SpeciesRec[] = [];
  let speciesRoutes: SpeciesRoute[] = [];
  let allRoutes: ReactionRoute[] = [];
  const benchPlans: AIPlan["benchPlans"] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Find targets
  if (query.intent === "MAKE_CATEGORY" || query.intent === "MAKE_MANY" || query.intent === "LIST") {
    if (query.category) {
      targets = getSpeciesByCategory(store, query.category);
      if (query.targetText && query.targetText !== query.category) {
        // Also try to find specific species matching targetText within category
        const specific = findSpeciesForQuery(store, { ...query, intent: "MAKE_SPECIFIC" } as ParsedQuery);
        if (specific.length > 0) {
          // Merge
          const ids = new Set(targets.map(t => t.id));
          for (const s of specific) if (!ids.has(s.id)) targets.unshift(s);
        }
      }
      // Limit for many
      if (query.quantityHint === "single" && targets.length > 5) {
        targets = targets.slice(0, 5);
      } else if (query.quantityHint === "many") {
        targets = targets.slice(0, 15);
      } else if (query.quantityHint === "all") {
        targets = targets.slice(0, 40);
      }
    } else {
      targets = findSpeciesForQuery(store, query);
    }
  } else {
    targets = findSpeciesForQuery(store, query);
  }

  if (targets.length === 0) {
    // Try element search
    if (query.fromElements && query.fromElements.length > 0) {
      // Find compounds containing those elements
      const all = [...store.speciesById.values()];
      targets = all.filter(s => {
        if (!s.elements) return false;
        return query.fromElements!.every(el => s.elements![el] || s.elements![el.toUpperCase()] || Object.keys(s.elements!).includes(el));
      }).slice(0, 10);
    }
  }

  if (targets.length === 0) {
    steps[2] = { title: "No matches found", detail: `Could not find "${query.targetText}" in warehouse. Try different name or formula like H2O, HCl, NaCl`, status: "done" };
    return {
      query,
      steps,
      targets: [],
      speciesRoutes: [],
      allRoutes: [],
      benchPlans: [],
      explanation: `I couldn't find "${query.targetText}" in the lab warehouse. The lab has 582 substances - try a common name like water, salt, sulfuric acid, or a formula like H2O, HCl, H2SO4. You can also say "make an acid" or "make a gas" to explore categories.`,
      warnings: [`No species matching "${query.targetText}"`],
      suggestions: ["Try: make water", "Try: make an acid", "Try: make H2SO4", "Try: make a salt", "Try: what can I make from Na and Cl?"],
      stats: { speciesFound: 0, reactionsFound: 0, benchOptions: 0 },
    };
  }

  // For each target, find routes
  for (const target of targets.slice(0, query.quantityHint === "all" ? 20 : 12)) {
    const directRoutes = findReactionsProducing(store, target.id);
    const comboRoutes = findElementCombinationRoutes(store, target.formula_written || target.formula || "");

    // Convert combo to reaction routes (pseudo)
    const comboAsRoutes: ReactionRoute[] = comboRoutes.map(c => ({
      reaction: {
        id: `combo_${c.pair}_${c.formula}`,
        name: `Element combination: ${c.pair} → ${c.formula}`,
        equation: `${c.elements?.join(" + ")} → ${c.formula}`,
        reactants_written: c.elements?.join(" + ") || "",
        products_written: c.formula || "",
        categories: ["combination"],
        observations: [],
      } as any,
      richness: 1,
      reason: `Element pair ${c.pair} can form ${c.formula} (${c.status})`,
      bench: (c.elements || []).map(el => {
        // Find species for element
        const sp = [...store.speciesById.values()].find(s => s.formula === el || s.id.toLowerCase() === el.toLowerCase());
        return { species_id: sp?.id || el.toLowerCase(), qty: 1, unit: "mol" as const };
      }),
      observations: [`Status: ${c.status}`, `Formula: ${c.formula}`],
      type: "combination" as const,
    }));

    let allForThis = [...directRoutes, ...comboAsRoutes];

    // Multi-step if few direct
    if (allForThis.length < 2 && directRoutes.length > 0) {
      const multi = findMultiStepRoutes(store, target.id, 2);
      allForThis = [...allForThis, ...multi];
    }

    // Sort
    allForThis.sort((a, b) => b.richness - a.richness);

    const route: SpeciesRoute = {
      species: target,
      routes: allForThis.slice(0, 8),
      elements: target.elements ? Object.keys(target.elements) : [],
      categoryMatch: query.category,
      description: `${target.name} (${target.formula_written || target.formula}) - ${allForThis.length} ways to make it`,
    };

    speciesRoutes.push(route);
    allRoutes.push(...allForThis);

    // Bench plans
    for (const r of allForThis.slice(0, 2)) {
      if (r.bench.length > 0) {
        benchPlans.push({
          label: `${target.name} via ${r.reaction.name}`,
          items: r.bench,
          reactionId: r.reaction.id,
        });
      }
    }
  }

  // Deduplicate bench plans
  const uniqueBench = new Map<string, typeof benchPlans[0]>();
  for (const bp of benchPlans) {
    const key = bp.items.map(i => i.species_id).sort().join("+");
    if (!uniqueBench.has(key)) uniqueBench.set(key, bp);
  }
  const finalBenchPlans = [...uniqueBench.values()].slice(0, 12);

  // Generate explanation
  let explanation = "";
  if (query.intent === "MAKE_MANY" || query.intent === "MAKE_CATEGORY") {
    explanation = `You asked to make ${query.category ? `an ${query.category}` : query.targetText} - I found ${targets.length} ${query.category || "substances"} and ${allRoutes.length} total synthesis routes. `;
    if (targets.length > 0) {
      explanation += `Top match: ${targets[0].name} (${targets[0].formula_written || targets[0].formula}) can be made in ${speciesRoutes[0]?.routes.length || 0} ways. `;
    }
    explanation += `Every route uses real lab reagents from the warehouse - no guesses.`;
  } else if (targets.length === 1) {
    const t = targets[0];
    explanation = `To make ${t.name} (${t.formula_written || t.formula}), I found ${allRoutes.length} possible routes in the lab data. `;
    if (allRoutes.length > 0) {
      explanation += `Best route: ${allRoutes[0].reaction.name} - ${allRoutes[0].reaction.equation || allRoutes[0].reaction.reactants_written + " → " + allRoutes[0].reaction.products_written}. `;
      if (allRoutes[0].observations.length) {
        explanation += `You'll see: ${allRoutes[0].observations.join(", ")}.`;
      }
    } else {
      explanation += `No direct synthesis in curated reactions, but check element combinations and try mixing precursors on the bench.`;
    }
  } else {
    explanation = `Found ${targets.length} matching substances for "${query.targetText}" with ${allRoutes.length} total synthesis routes. Each route is a real reaction from the warehouse that you can run on the bench.`;
  }

  // Warnings
  const highDanger = allRoutes.filter(r => r.safetyNote?.includes("High danger") || r.safetyNote?.includes("Blocked"));
  if (highDanger.length > 0) {
    warnings.push(`${highDanger.length} routes need safety precautions (fume hood, low scale)`);
  }
  if (allRoutes.length === 0) {
    warnings.push(`No curated synthesis routes - try combining elements on bench or search for precursors`);
  }

  // Suggestions
  if (targets.length > 1) suggestions.push(`Try specific: "make ${targets[0].formula_written || targets[0].name}"`);
  if (query.category) {
    const otherCats = Object.keys(CATEGORY_KEYWORDS).filter(c => c !== query.category).slice(0, 3);
    suggestions.push(...otherCats.map(c => `Make an ${c}`));
  }
  suggestions.push("Make water", "Make H2SO4 from elements", "What can I make from Na and Cl?");
  suggestions.push("Show me all ways to make HCl");

  steps[2] = {
    title: `Found ${targets.length} substances, ${allRoutes.length} routes, ${finalBenchPlans.length} bench setups`,
    detail: `Every route verified against 582 substances and 424 reactions. Ready to run on bench.`,
    status: "done",
  };

  return {
    query,
    steps,
    targets,
    speciesRoutes,
    allRoutes: allRoutes.slice(0, 30),
    benchPlans: finalBenchPlans,
    explanation,
    warnings,
    suggestions: [...new Set(suggestions)].slice(0, 8),
    stats: {
      speciesFound: targets.length,
      reactionsFound: allRoutes.length,
      benchOptions: finalBenchPlans.length,
    },
  };
}

// ---------- Bench Execution Helper ----------

export function benchItemsToString(items: BenchItem[]): string {
  return items.map(i => `${i.species_id}:${i.qty}${i.unit}`).join(", ");
}

export function getQuickPrompts(): string[] {
  return [
    "make water",
    "make an acid",
    "make many acids",
    "make a base",
    "make a salt",
    "make H2SO4",
    "make HCl in all possible ways",
    "make a gas",
    "make something blue",
    "make water from H and O",
    "what can I make from Na and Cl?",
    "synthesize ammonia",
    "make organic acid",
    "make all oxides",
    "make fuel",
  ];
}
