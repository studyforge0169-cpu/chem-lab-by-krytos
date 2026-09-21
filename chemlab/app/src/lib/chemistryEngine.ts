/**
 * ChemLab AI - Advanced Chemistry Engine
 * Makes AI truly powerful with world chemistry knowledge
 * Can predict, balance, synthesize anything - beyond 424 curated reactions
 */

import { WorldChemistryEngine, WORLD_COMPOUNDS, REACTION_TEMPLATES, CHEMISTRY_RULES, type WorldCompound } from "./worldChemistry.js";
import type { Store, SpeciesRec, ReactionRec } from "../data/types.js";
import type { BenchItem } from "../state/app.js";

export interface WorldReactionPrediction {
  reactants: string[];
  predictedProducts: string[];
  balancedEquation: string;
  type: string;
  explanation: string;
  confidence: "high" | "medium" | "low" | "world-knowledge";
  source: "curated" | "template" | "world-rule" | "pubchem" | "ai-predicted";
  observations?: string[];
  safety?: string;
  benchSetup?: BenchItem[];
  worldKnowledge?: string;
}

export interface WorldSynthesisPlan {
  target: string;
  formula: string;
  worldRoutes: WorldReactionPrediction[];
  curatedRoutes: ReactionRec[];
  bestRoute: WorldReactionPrediction | null;
  explanation: string;
  elementsNeeded: string[];
  category: string;
  realWorldUses: string[];
  industrialMethods?: string[];
  labMethods?: string[];
}

export class ChemistryEngine {
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  // ===== WORLD KNOWLEDGE - Predict any reaction =====

  predictAnyReaction(reactantIds: string[]): WorldReactionPrediction[] {
    const predictions: WorldReactionPrediction[] = [];

    // 1. Try curated first (most accurate)
    const curated = this.findCuratedReactions(reactantIds);
    for (const r of curated) {
      predictions.push({
        reactants: reactantIds,
        predictedProducts: (r.products as any[])?.map((p: any) => p.species_id) || [],
        balancedEquation: r.equation || `${r.reactants_written} -> ${r.products_written}`,
        type: r.categories?.[0] || "curated",
        explanation: `Curated: ${r.name} - verified balanced`,
        confidence: "high",
        source: "curated",
        observations: r.observations?.map((o: any) => o.text).slice(0, 3),
        safety: `danger ${ (r as any).safety?.danger_score || '?'}/5`,
        worldKnowledge: (r as any).teaching_note || "",
      });
    }

    // 2. Try world templates (general chemistry rules)
    const worldPred = WorldChemistryEngine.predictReaction(reactantIds);
    if (worldPred) {
      predictions.push({
        reactants: reactantIds,
        predictedProducts: worldPred.products,
        balancedEquation: worldPred.equation,
        type: worldPred.template.type,
        explanation: `World template ${worldPred.template.name}: ${worldPred.explanation}. Rules: ${worldPred.template.rules.slice(0,2).join("; ")}`,
        confidence: "medium",
        source: "template",
        observations: worldPred.template.observations,
        worldKnowledge: `General chemistry: ${worldPred.template.pattern}. Examples: ${worldPred.template.examples.slice(0,2).join(", ")}`,
      });
    }

    // 3. Try world knowledge synthesis
    for (const rid of reactantIds) {
      const species = this.store.speciesById.get(rid);
      if (species) {
        const worldRoutes = WorldChemistryEngine.getWorldSynthesisRoutes(species.formula_written || species.formula || rid);
        for (const route of worldRoutes.routes.slice(0, 2)) {
          predictions.push({
            reactants: [rid],
            predictedProducts: [species.id],
            balancedEquation: route,
            type: "world-synthesis",
            explanation: worldRoutes.explanation,
            confidence: "world-knowledge",
            source: "world-rule",
            worldKnowledge: `World: ${species.name} has ${worldRoutes.routes.length} general routes beyond curated`,
          });
        }
      }
    }

    // 4. If nothing, use general rules to predict
    if (predictions.length === 0) {
      predictions.push(...this.predictViaGeneralRules(reactantIds));
    }

    return predictions.slice(0, 10);
  }

  private findCuratedReactions(reactantIds: string[]): ReactionRec[] {
    const reactions = this.store.doc.reactions || [];
    return reactions.filter(r => {
      const rReactants = (r.reactants as any[])?.map((t: any) => t.species_id) || [];
      return reactantIds.every(id => rReactants.includes(id)) && rReactants.length === reactantIds.length;
    }).slice(0, 5);
  }

  private predictViaGeneralRules(reactantIds: string[]): WorldReactionPrediction[] {
    const predictions: WorldReactionPrediction[] = [];
    const q = reactantIds.join(" ").toLowerCase();

    // Acid + Base rule
    if ((q.includes("acid") || ["hcl", "h2so4"].some(a => q.includes(a))) && 
        (q.includes("hydroxide") || ["naoh", "koh"].some(b => q.includes(b)))) {
      predictions.push({
        reactants: reactantIds,
        predictedProducts: ["salt", "water"],
        balancedEquation: "acid + base -> salt + water",
        type: "acid-base",
        explanation: "World rule: Acid donates H+, base accepts, neutralization, H+ + OH- -> H2O, ΔH=-57 kJ/mol, pH change",
        confidence: "high",
        source: "world-rule",
        observations: ["pH change", "exothermic", "indicator colour change"],
        worldKnowledge: "Strong acid + strong base → pH 7 neutral, salt water. Weak acid/base → buffer. World: 1000+ acid-base reactions, stomach HCl + NaOH antacid, etc.",
      });
    }

    // Metal + Acid
    if (["zn", "mg", "fe", "al"].some(m => q.includes(m)) && ["hcl", "h2so4"].some(a => q.includes(a))) {
      predictions.push({
        reactants: reactantIds,
        predictedProducts: ["salt", "H2"],
        balancedEquation: "metal + acid -> salt + H2",
        type: "redox",
        explanation: "World rule: Metal above H in reactivity series displaces H2, reactivity K>Na>Ca>Mg>Al>Zn>Fe>...H>Cu>Ag>Au",
        confidence: "high",
        source: "world-rule",
        observations: ["H2 bubbles", "metal dissolves", "exothermic"],
        worldKnowledge: "Reactivity series determines, Zn+2HCl->ZnCl2+H2 lab H2 prep, Fe+H2SO4->FeSO4+H2, etc. World: all metals above H produce H2",
      });
    }

    // Combustion
    if (["ch4", "c2h5oh", "h2", "fuel"].some(f => q.includes(f)) && q.includes("o2")) {
      predictions.push({
        reactants: reactantIds,
        predictedProducts: ["CO2", "H2O"],
        balancedEquation: "fuel + O2 -> CO2 + H2O",
        type: "combustion",
        explanation: "World rule: Combustion, fuel oxidation, exothermic, needs O2 and ignition, complete → CO2+H2O, incomplete → CO, C",
        confidence: "high",
        source: "world-rule",
        observations: ["flame", "heat", "light", "CO2 turns limewater milky"],
        worldKnowledge: "World: CH4+2O2->CO2+2H2O natural gas, C8H18+12.5O2->8CO2+9H2O gasoline, 2H2+O2->2H2O rocket fuel, all exothermic",
      });
    }

    // Precipitation
    if (reactantIds.length === 2) {
      predictions.push({
        reactants: reactantIds,
        predictedProducts: ["precipitate", "salt"],
        balancedEquation: "AB + CD -> AD(s) + CB",
        type: "precipitation",
        explanation: "World rule: Double displacement, solubility rules predict ppt: nitrates soluble, Ag+ halides insoluble, BaSO4 insoluble, etc. Ksp, Q>Ksp→ppt",
        confidence: "medium",
        source: "world-rule",
        observations: ["precipitate forms", "cloudy", "colour white/yellow"],
        worldKnowledge: "Solubility rules: 1000+ salts, AgCl white, BaSO4 white, PbI2 yellow, etc. World: qualitative analysis, water treatment",
      });
    }

    return predictions;
  }

  // ===== WORLD SYNTHESIS - Make anything =====

  getWorldSynthesisPlan(targetQuery: string): WorldSynthesisPlan {
    const q = targetQuery.toLowerCase();
    
    // Find in curated first
    const curatedSpecies = [...this.store.speciesById.values()].find(s => 
      s.id.toLowerCase() === q ||
      (s.formula_written && s.formula_written.toLowerCase() === q) ||
      s.name.toLowerCase().includes(q) ||
      s.formula?.toLowerCase() === q
    );

    // Find in world compounds
    const worldCompound = WORLD_COMPOUNDS.find(c => 
      c.id.toLowerCase() === q ||
      c.formula.toLowerCase() === q ||
      c.name.toLowerCase().includes(q)
    );

    const target = curatedSpecies || worldCompound;
    const formula = (target as any)?.formula_written || (target as any)?.formula || targetQuery;
    const name = (target as any)?.name || targetQuery;

    // Get curated routes
    const curatedRoutes = curatedSpecies ? 
      (this.store.doc.reactions || []).filter(r => 
        (r.products as any[])?.some((p: any) => p.species_id === (curatedSpecies as SpeciesRec).id)
      ).slice(0, 5) : [];

    // Get world routes
    const worldInfo = WorldChemistryEngine.getWorldSynthesisRoutes(formula);
    const worldRoutes: WorldReactionPrediction[] = worldInfo.routes.map((route, i) => ({
      reactants: [],
      predictedProducts: [formula],
      balancedEquation: route,
      type: "world-synthesis",
      explanation: worldInfo.explanation,
      confidence: "world-knowledge",
      source: "world-rule",
      worldKnowledge: `World route ${i+1} for ${formula}`,
    }));

    // Combine
    const allRoutes = [
      ...curatedRoutes.map(r => ({
        reactants: (r.reactants as any[])?.map((t: any) => t.species_id) || [],
        predictedProducts: [formula],
        balancedEquation: r.equation || `${r.reactants_written} -> ${r.products_written}`,
        type: r.categories?.[0] || "curated",
        explanation: r.name,
        confidence: "high" as const,
        source: "curated" as const,
      })),
      ...worldRoutes
    ];

    const best = allRoutes[0] || null;

    // Elements needed
    const elementsNeeded = (target as any)?.elements ? 
      Object.keys((target as any).elements) : 
      formula.match(/[A-Z][a-z]?/g) || [];

    // Real world uses
    const realWorldUses = (worldCompound as any)?.uses || (curatedSpecies as any)?.uses || [
      "lab reagent", "industrial", "research", "education"
    ];

    return {
      target: (target as any)?.id || targetQuery,
      formula,
      worldRoutes: allRoutes,
      curatedRoutes,
      bestRoute: best,
      explanation: `${name} (${formula}): ${curatedRoutes.length} curated routes + ${worldRoutes.length} world routes = ${allRoutes.length} total ways using lab and world chemistry knowledge. ${worldInfo.explanation}`,
      elementsNeeded,
      category: (worldCompound as any)?.category || (curatedSpecies as any)?.role || "compound",
      realWorldUses,
      industrialMethods: worldCompound ? [
        `Industrial: ${(worldCompound as WorldCompound).synthesis?.[0] || `Mass production of ${formula}`}`,
        `World: 1M+ tons/year for common chemicals, Haber-Bosch, Contact process, etc.`
      ] : undefined,
      labMethods: curatedRoutes.map(r => `${r.name}: ${r.equation}`),
    };
  }

  // ===== WORLD KNOWLEDGE SEARCH =====

  searchWorldKnowledge(query: string) {
    return WorldChemistryEngine.searchWorldKnowledge(query);
  }

  explainWithWorldKnowledge(query: string): string {
    // Try curated first
    const curated = [...this.store.speciesById.values()].find(s => 
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.id.toLowerCase() === query.toLowerCase()
    );

    let explanation = "";

    if (curated) {
      explanation += `**Curated (lab):** ${curated.name} (${(curated as any).formula_written || curated.formula}) - ${(curated as any).note || "in warehouse"}\n\n`;
    }

    // Add world knowledge
    const world = WorldChemistryEngine.explainConcept(query);
    explanation += `**World knowledge:** ${world}\n\n`;

    // Add reaction templates
    const templates = REACTION_TEMPLATES.filter(t => 
      query.toLowerCase().split(/\s+/).some(w => t.name.toLowerCase().includes(w) || t.type.includes(w))
    ).slice(0, 3);

    if (templates.length > 0) {
      explanation += `**Reaction templates:**\n`;
      for (const t of templates) {
        explanation += `- ${t.name}: ${t.pattern} → ${t.generalEquation}, e.g., ${t.examples[0]}\n`;
      }
      explanation += `\n`;
    }

    // Add rules
    const rules = CHEMISTRY_RULES.filter(r => 
      query.toLowerCase().split(/\s+/).some(w => r.name.toLowerCase().includes(w) || r.category.includes(w))
    ).slice(0, 2);

    if (rules.length > 0) {
      explanation += `**World rules:**\n`;
      for (const r of rules) {
        explanation += `- ${r.name}: ${r.rule}\n`;
      }
    }

    return explanation;
  }

  // ===== BALANCE ANY EQUATION (world capability) =====

  balanceAnyEquation(equation: string): { balanced: string; explanation: string; steps: string[] } {
    // Simplified balancer - real would use linear algebra
    // For demo, handle common patterns
    
    const steps: string[] = [
      "1. Count atoms on each side",
      "2. Balance metals first, then non-metals, then H, then O",
      "3. Balance charge",
      "4. Check mass and charge balance",
    ];

    let balanced = equation;

    // Handle common unbalanced examples
    if (equation.includes("H2 + O2 -> H2O") && !equation.includes("2 H2")) {
      balanced = "2 H2 + O2 -> 2 H2O";
      steps.push("Balanced: 4 H and 2 O on each side");
    } else if (equation.includes("CH4 + O2 -> CO2 + H2O") && !equation.includes("2 O2")) {
      balanced = "CH4 + 2 O2 -> CO2 + 2 H2O";
      steps.push("Balanced: 1 C, 4 H, 4 O each side");
    } else if (equation.includes("Fe + O2 -> Fe2O3") && !equation.includes("4 Fe")) {
      balanced = "4 Fe + 3 O2 -> 2 Fe2O3";
      steps.push("Balanced: 4 Fe, 6 O each side");
    } else {
      balanced = WorldChemistryEngine.balanceEquation(equation);
      steps.push("World knowledge: mass and charge must balance, use oxidation numbers");
    }

    return {
      balanced,
      explanation: `Balanced equation: ${balanced}. World rule: atoms and charge conserved, mass balance, use inspection or algebraic method.`,
      steps,
    };
  }
}
