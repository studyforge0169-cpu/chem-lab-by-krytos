/**
 * CHEMISTRY AI — GOAL INTERPRETER
 * Phase 2: Translates natural-language objectives into structured ChemistryGoal
 * 
 * Rules:
 * - Do NOT invent numerical requirements when user hasn't supplied them
 * - Represent ambiguity explicitly
 * - Deterministic & reproducible
 * - Safety classification mandatory
 */

import {
  ChemistryGoal,
  TargetProperty,
  Constraint,
  EnvironmentalCondition,
  DesignDomain,
  SafetyClassification,
  ProvenanceRecord,
  contentHash,
  createProvenance,
  OptimizationDirection,
  ConstraintType,
} from "./domain.js";

export interface GoalInterpreter {
  parse(objective: string, options?: ParseOptions): Promise<ChemistryGoal>;
  parseSync(objective: string, options?: ParseOptions): ChemistryGoal;
}

export interface ParseOptions {
  designType?: DesignDomain;
  safetyLevel?: SafetyClassification;
  evaluationBudget?: ChemistryGoal["evaluationBudget"];
  exclusions?: string[];
  environment?: EnvironmentalCondition;
  randomSeed?: number;
}

// Known property keywords mapping
const PROPERTY_KEYWORDS: Record<string, { property: string; unit?: string; direction?: OptimizationDirection }> = {
  "tensile strength": { property: "tensile_strength", unit: "MPa", direction: "maximize" },
  "tensile": { property: "tensile_strength", unit: "MPa", direction: "maximize" },
  "strength": { property: "strength", direction: "maximize" },
  "high strength": { property: "tensile_strength", unit: "MPa", direction: "maximize" },
  "extremely high tensile strength": { property: "tensile_strength", unit: "MPa", direction: "maximize" },
  "adhesion": { property: "adhesion", direction: "maximize" },
  "adhesive": { property: "adhesion", direction: "maximize" },
  "solidification": { property: "solidification_rate", direction: "maximize" },
  "rapid solidification": { property: "solidification_rate", direction: "maximize" },
  "solubility": { property: "solubility", direction: "maximize" },
  "stability": { property: "stability", direction: "maximize" },
  "thermal stability": { property: "thermal_stability", direction: "maximize" },
  "melting point": { property: "melting_point", unit: "K", direction: "any" },
  "boiling point": { property: "boiling_point", unit: "K", direction: "any" },
  "density": { property: "density", unit: "g/cm3", direction: "any" },
  "hardness": { property: "hardness", direction: "maximize" },
  "elastic modulus": { property: "elastic_modulus", unit: "GPa", direction: "maximize" },
  "conductivity": { property: "conductivity", direction: "maximize" },
  "electrical conductivity": { property: "electrical_conductivity", direction: "maximize" },
  "thermal conductivity": { property: "thermal_conductivity", unit: "W/mK", direction: "maximize" },
  "corrosion resistance": { property: "corrosion_resistance", direction: "maximize" },
  "biocompatibility": { property: "biocompatibility", direction: "maximize" },
  "toxicity": { property: "toxicity", direction: "minimize" },
  "cost": { property: "cost", direction: "minimize" },
  "weight": { property: "weight", direction: "minimize" },
  "lightweight": { property: "density", unit: "g/cm3", direction: "minimize" },
  "flexibility": { property: "flexibility", direction: "maximize" },
  "ductility": { property: "ductility", direction: "maximize" },
  "brittleness": { property: "brittleness", direction: "minimize" },
  "transparency": { property: "transparency", direction: "maximize" },
  "band gap": { property: "band_gap", unit: "eV", direction: "any" },
  "magnetic": { property: "magnetism", direction: "maximize" },
};

const DESIGN_TYPE_KEYWORDS: Record<string, DesignDomain> = {
  "material": "material",
  "polymer": "polymer",
  "molecule": "molecule",
  "mixture": "mixture",
  "formulation": "formulation",
  "catalyst": "catalyst",
  "crystal": "crystal",
  "surface": "surface",
  "coating": "material",
  "alloy": "material",
  "composite": "material",
  "ceramic": "material",
  "metal": "material",
  "substance": "molecule",
  "compound": "molecule",
  "adhesive": "formulation",
};

const HAZARDOUS_KEYWORDS = [
  "explosive", "toxic gas", "nerve agent", "chemical weapon", "bioweapon",
  "mustard gas", "sarin", "vx", "highly toxic", "lethal", "weaponize",
  "detonate", "bomb", "illicit", "meth", "fentanyl", "dangerous synthesis"
];

const RESTRICTED_KEYWORDS = [
  "radioactive", "plutonium", "uranium enrichment", "enriched uranium",
  "pathogen", "biological weapon"
];

export class DeterministicGoalInterpreter implements GoalInterpreter {
  private seed: number;

  constructor(seed = 42) {
    this.seed = seed;
  }

  parseSync(objective: string, options: ParseOptions = {}): ChemistryGoal {
    if (!objective || typeof objective !== "string" || objective.trim().length === 0) {
      throw new Error("Objective must be a non-empty string");
    }

    const rawInput = objective;
    const cleaned = this.cleanObjective(objective);
    const lower = cleaned.toLowerCase();

    // Detect safety classification first (mandatory)
    const safety = this.classifySafety(lower, options.safetyLevel);

    // Detect design type
    const designType = this.detectDesignType(lower, options.designType);

    // Extract target properties
    const { targets, ambiguities } = this.extractProperties(lower, cleaned);

    // Extract constraints (numerical if explicitly provided)
    const constraints = this.extractConstraints(lower, cleaned, options);

    // Extract environment
    const environment = this.extractEnvironment(lower, options.environment);

    // Exclusions
    const exclusions = options.exclusions || this.extractExclusions(lower);

    // Check for hazardous intent
    const hazardousFlags = this.detectHazardous(lower);
    const finalSafety = hazardousFlags.length > 0 ? this.elevateSafety(safety, hazardousFlags) : safety;

    const goalId = `goal_${contentHash({ objective: cleaned, ts: Date.now(), seed: this.seed }).slice(0, 12)}_${Date.now()}`;

    const provenance: ProvenanceRecord = createProvenance({
      description: `Goal parsed from: "${cleaned.slice(0, 100)}"`,
      iteration: 0,
      randomSeed: options.randomSeed ?? this.seed,
      inputHash: contentHash(rawInput),
      configHash: contentHash(options),
      tags: ["goal-interpreter", "deterministic", designType, finalSafety],
    });

    const goal: ChemistryGoal = {
      goalId,
      objective: cleaned,
      parsedObjective: cleaned,
      targetProperties: targets,
      constraints,
      environment,
      designType,
      formulationType: undefined,
      requestedScale: "theoretical",
      exclusions,
      safetyLevel: finalSafety,
      evaluationBudget: {
        maxIterations: options.evaluationBudget?.maxIterations ?? 10,
        maxCandidates: options.evaluationBudget?.maxCandidates ?? 1000,
        maxTimeMs: options.evaluationBudget?.maxTimeMs ?? 60000,
        computeBudget: options.evaluationBudget?.computeBudget ?? "low",
      },
      uncertaintyRequirements: {
        maxUncertainty: 0.5,
        requireConfidenceInterval: false,
        minConfidence: 0.5,
      },
      ambiguityFlags: ambiguities,
      rawInput,
      createdAt: new Date().toISOString(),
      version: "1.0.0",
      provenance,
    };

    return goal;
  }

  async parse(objective: string, options?: ParseOptions): Promise<ChemistryGoal> {
    // Async wrapper for future LLM integration
    return this.parseSync(objective, options);
  }

  private cleanObjective(obj: string): string {
    return obj.trim().replace(/\s+/g, " ").slice(0, 2000);
  }

  private classifySafety(lower: string, override?: SafetyClassification): SafetyClassification {
    if (override) return override;

    for (const kw of HAZARDOUS_KEYWORDS) {
      if (lower.includes(kw)) return "BLOCKED";
    }
    for (const kw of RESTRICTED_KEYWORDS) {
      if (lower.includes(kw)) return "RESTRICTED";
    }

    // Check for potentially hazardous but reviewable
    if (lower.includes("toxic") || lower.includes("hazardous") || lower.includes("flammable") || lower.includes("corrosive")) {
      return "REVIEW_REQUIRED";
    }

    return "SAFE";
  }

  private elevateSafety(current: SafetyClassification, flags: string[]): SafetyClassification {
    if (flags.some(f => HAZARDOUS_KEYWORDS.includes(f))) return "BLOCKED";
    if (current === "SAFE" && flags.length > 0) return "REVIEW_REQUIRED";
    if (current === "REVIEW_REQUIRED") return "RESTRICTED";
    return current;
  }

  private detectHazardous(lower: string): string[] {
    const found: string[] = [];
    for (const kw of [...HAZARDOUS_KEYWORDS, ...RESTRICTED_KEYWORDS]) {
      if (lower.includes(kw)) found.push(kw);
    }
    return found;
  }

  private detectDesignType(lower: string, override?: DesignDomain): DesignDomain {
    if (override) return override;

    for (const [kw, domain] of Object.entries(DESIGN_TYPE_KEYWORDS)) {
      if (lower.includes(kw)) return domain;
    }

    // Default: material for strength/adhesion, molecule for chemical property
    if (lower.includes("tensile") || lower.includes("adhesion") || lower.includes("solidification") || lower.includes("strength")) {
      return "material";
    }
    if (lower.includes("chemical property") || lower.includes("solubility") || lower.includes("molecule")) {
      return "molecule";
    }

    return "material"; // sensible default, but marked as ambiguous if needed
  }

  private extractProperties(lower: string, original: string): { targets: TargetProperty[]; ambiguities: string[] } {
    const targets: TargetProperty[] = [];
    const ambiguities: string[] = [];
    const seen = new Set<string>();

    // Sort keywords by length descending to match longer phrases first
    const sortedKeywords = Object.keys(PROPERTY_KEYWORDS).sort((a, b) => b.length - a.length);

    for (const kw of sortedKeywords) {
      if (lower.includes(kw) && !seen.has(PROPERTY_KEYWORDS[kw].property)) {
        const mapping = PROPERTY_KEYWORDS[kw];
        const prop = mapping.property;

        // Check if numerical target explicitly provided near this keyword
        const { value, isExplicit, ambiguity } = this.extractNumericalTarget(lower, original, kw);

        const target: TargetProperty = {
          property: prop,
          targetValue: value,
          direction: mapping.direction || "maximize",
          unit: mapping.unit,
          importanceWeight: 1.0, // default, will be normalized later
          constraintType: "SOFT" as ConstraintType,
          confidence: isExplicit ? 0.9 : 0.6,
          provenance: `keyword:${kw}`,
          isExplicit,
          ambiguity,
        };

        targets.push(target);
        seen.add(prop);

        if (ambiguity) ambiguities.push(ambiguity);
      }
    }

    // If no properties detected, mark ambiguity
    if (targets.length === 0) {
      ambiguities.push(`No explicit property targets detected in objective: "${original.slice(0, 100)}". Representing as ambiguous general exploration.`);
      // Add a generic target with low confidence, direction any, to allow search to proceed
      targets.push({
        property: "general_performance",
        targetValue: undefined,
        direction: "maximize",
        importanceWeight: 1.0,
        constraintType: "SOFT",
        confidence: 0.3,
        provenance: "fallback:ambiguous",
        isExplicit: false,
        ambiguity: "No specific property mentioned, using general performance as placeholder",
      });
    }

    // Normalize weights
    const totalWeight = targets.reduce((sum, t) => sum + t.importanceWeight, 0);
    if (totalWeight > 0) {
      for (const t of targets) {
        t.importanceWeight = t.importanceWeight / totalWeight;
      }
    }

    return { targets, ambiguities };
  }

  private extractNumericalTarget(lower: string, _original: string, keyword: string): { value?: number | [number, number] | string; isExplicit: boolean; ambiguity?: string } {
    // Look for patterns like "tensile strength > 1000 MPa" or "melting point 300-400K" near keyword
    const idx = lower.indexOf(keyword);
    if (idx === -1) return { value: undefined, isExplicit: false };

    const contextWindow = lower.slice(Math.max(0, idx - 50), Math.min(lower.length, idx + 100));
    
    // Pattern: number + unit, or range
    const rangeMatch = contextWindow.match(/(\d+(?:\.\d+)?)\s*[-–to]+\s*(\d+(?:\.\d+)?)/);
    if (rangeMatch) {
      const low = parseFloat(rangeMatch[1]);
      const high = parseFloat(rangeMatch[2]);
      if (!isNaN(low) && !isNaN(high)) {
        return { value: [low, high] as [number, number], isExplicit: true };
      }
    }

    const numMatch = contextWindow.match(/(\d+(?:\.\d+)?)\s*(mpa|gpa|k|g\/cm3|ev|%|w\/mk)?/i);
    if (numMatch) {
      const num = parseFloat(numMatch[1]);
      if (!isNaN(num)) {
        return { value: num, isExplicit: true };
      }
    }

    // Check for qualitative modifiers that imply direction but not number
    if (contextWindow.includes("extremely high") || contextWindow.includes("very high") || contextWindow.includes("maximum")) {
      return { value: undefined, isExplicit: false, ambiguity: `Qualitative modifier found near "${keyword}" but no numerical target: "${contextWindow.slice(0, 50)}"` };
    }

    return { value: undefined, isExplicit: false };
  }

  private extractConstraints(lower: string, __original: string, _options: ParseOptions = {}): Constraint[] {
    const constraints: Constraint[] = [];
    void __original;
    // From options if provided - budget constraints handled elsewhere
    // Extract temperature constraints if mentioned
    const tempMatch = lower.match(/temperature\s*(?:at|of)?\s*(\d+(?:\.\d+)?)\s*(k|c|°c)?/);
    if (tempMatch) {
      constraints.push({
        id: `constraint_temp_${Date.now()}`,
        property: "temperature",
        type: "HARD",
        operator: "eq",
        value: parseFloat(tempMatch[1]),
        unit: tempMatch[2] || "K",
        description: `Temperature constraint from objective`,
        provenance: "goal-interpreter:temperature",
      });
    }

    // Add more constraint extraction as needed, but DO NOT invent

    return constraints;
  }

  private extractEnvironment(lower: string, override?: EnvironmentalCondition): EnvironmentalCondition | undefined {
    if (override) return override;

    const env: EnvironmentalCondition = {};
    let hasEnv = false;

    const tempMatch = lower.match(/(\d+(?:\.\d+)?)\s*k\b/);
    if (tempMatch) {
      env.temperature = { value: parseFloat(tempMatch[1]), unit: "K" };
      hasEnv = true;
    }

    if (lower.includes("room temperature")) {
      env.temperature = { value: 298, unit: "K" };
      hasEnv = true;
    }

    if (lower.includes("high pressure") || lower.includes("high-pressure")) {
      env.pressure = { value: 10, unit: "atm", range: [1, 100] };
      hasEnv = true;
    }

    return hasEnv ? env : undefined;
  }

  private extractExclusions(lower: string): string[] {
    const exclusions: string[] = [];

    // Pattern: "excluding X", "without X", "no X"
    const exclPatterns = [
      /excluding\s+([a-z0-9\s,]+)/g,
      /without\s+([a-z0-9\s,]+)/g,
      /no\s+([a-z0-9]+)/g,
    ];

    for (const pattern of exclPatterns) {
      const matches = lower.matchAll(pattern);
      for (const m of matches) {
        if (m[1]) {
          const items = m[1].split(/,|and/).map(s => s.trim()).filter(Boolean);
          exclusions.push(...items);
        }
      }
    }

    return exclusions;
  }
}

// Factory
export function createGoalInterpreter(seed = 42): GoalInterpreter {
  return new DeterministicGoalInterpreter(seed);
}
