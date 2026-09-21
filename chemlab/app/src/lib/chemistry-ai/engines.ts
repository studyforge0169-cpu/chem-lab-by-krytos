/**
 * CHEMISTRY AI — ENGINES
 * Phase 5: Constraint Engine
 * Phase 6: Safety Engine
 * Phase 7: Property Predictor Registry (mock)
 * Phase 8: Scoring + Pareto
 * Phase 12: Simulation Adapters (placeholder)
 * 
 * All engines are pluggable, deterministic, with provenance & uncertainty
 */

import {
  Candidate,
  Constraint,
  ConstraintResult,
  ConstraintViolation,
  SafetyResult,
  SafetyClassification,
  SafetyAuditEntry,
  PredictionResult,
  SimulationRequest,
  SimulationResult,
  ScoringResult,
  ParetoFront,
  ChemistrySpecification,
  PropertyTarget,
  UncertaintyRecord,
  contentHash,
  createProvenance,
  createUncertainty,
  MOCK_WARNING,
} from "./domain.js";

// ============================================================================
// CONSTRAINT ENGINE
// ============================================================================

export interface ConstraintEngine {
  engineId: string;
  evaluate(candidate: Candidate, spec: ChemistrySpecification): Promise<ConstraintResult>;
  evaluateSync(candidate: Candidate, spec: ChemistrySpecification): ConstraintResult;
  evaluateBatch(candidates: Candidate[], spec: ChemistrySpecification): Promise<ConstraintResult[]>;
}

export class DeterministicConstraintEngine implements ConstraintEngine {
  engineId = "constraint-engine-v1";

  evaluateSync(candidate: Candidate, spec: ChemistrySpecification): ConstraintResult {
    const hardViolations: ConstraintViolation[] = [];
    const softViolations: ConstraintViolation[] = [];
    let penalty = 0;
    let scoreAdjustment = 0;

    // Check spec constraints
    for (const constraint of spec.constraints) {
      const actual = this.getPropertyValue(candidate, constraint.property);
      const passed = this.checkConstraint(actual, constraint);

      if (!passed) {
        const violation: ConstraintViolation = {
          constraintId: constraint.id,
          property: constraint.property,
          type: constraint.type,
          expected: constraint.value,
          actual,
          penalty: constraint.type === "HARD" ? 1 : (constraint.penaltyWeight || 0.2),
          message: `Constraint ${constraint.id} failed: ${constraint.property} ${constraint.operator} ${constraint.value}, got ${actual}`,
        };

        if (constraint.type === "HARD") {
          hardViolations.push(violation);
        } else {
          softViolations.push(violation);
          penalty += violation.penalty;
          scoreAdjustment -= violation.penalty;
        }
      }
    }

    // Check property targets that are hard constraints
    for (const target of spec.propertyTargets) {
      if (target.isHardConstraint) {
        const actual = this.getPropertyValue(candidate, target.property);
        if (actual !== undefined) {
          const passed = this.checkPropertyTarget(actual, target);
          if (!passed) {
            hardViolations.push({
              constraintId: `hard_target_${target.property}`,
              property: target.property,
              type: "HARD",
              expected: target.target,
              actual,
              penalty: 1,
              message: `Hard target ${target.property} failed`,
            });
          }
        }
      }
    }

    const passed = hardViolations.length === 0;

    const provenance = createProvenance({
      description: `Constraint evaluation for ${candidate.candidateId}`,
      iteration: candidate.generationIteration,
      randomSeed: candidate.generationSeed,
      inputHash: candidate.contentHash,
      configHash: contentHash(spec),
      parentIds: [candidate.candidateId],
      tags: ["constraint-engine", passed ? "passed" : "failed"],
    });

    return {
      resultId: `constraint_${candidate.candidateId}_${Date.now()}`,
      candidateId: candidate.candidateId,
      passed,
      hardViolations,
      softViolations,
      penalty: Math.min(1, penalty),
      scoreAdjustment,
      explanation: passed
        ? `Passed ${spec.constraints.length} constraints, ${softViolations.length} soft violations`
        : `Failed ${hardViolations.length} hard constraints: ${hardViolations.map(v => v.property).join(", ")}`,
      timestamp: new Date().toISOString(),
      provenance,
    };
  }

  async evaluate(candidate: Candidate, spec: ChemistrySpecification): Promise<ConstraintResult> {
    return this.evaluateSync(candidate, spec);
  }

  async evaluateBatch(candidates: Candidate[], spec: ChemistrySpecification): Promise<ConstraintResult[]> {
    return candidates.map(c => this.evaluateSync(c, spec));
  }

  private getPropertyValue(candidate: Candidate, property: string): unknown {
    // Check candidate properties
    if (candidate.properties[property] !== undefined) return candidate.properties[property];
    
    // Check predictions
    const pred = candidate.predictions.find(p => p.property === property);
    if (pred) return pred.predictedValue;

    // Check representation metadata
    if (candidate.representation.metadata?.[property] !== undefined) {
      return candidate.representation.metadata[property];
    }

    return undefined;
  }

  private checkConstraint(actual: unknown, constraint: Constraint): boolean {
    if (actual === undefined) return true; // If no value, don't fail hard (soft)

    const expected = constraint.value;

    switch (constraint.operator) {
      case "eq": return actual === expected;
      case "neq": return actual !== expected;
      case "gt": return typeof actual === "number" && typeof expected === "number" && actual > expected;
      case "gte": return typeof actual === "number" && typeof expected === "number" && actual >= expected;
      case "lt": return typeof actual === "number" && typeof expected === "number" && actual < expected;
      case "lte": return typeof actual === "number" && typeof expected === "number" && actual <= expected;
      case "range":
        if (Array.isArray(expected) && expected.length === 2 && typeof actual === "number") {
          return actual >= (expected[0] as number) && actual <= (expected[1] as number);
        }
        return false;
      case "in":
        if (Array.isArray(expected)) return expected.includes(actual);
        return false;
      case "not-in":
        if (Array.isArray(expected)) return !expected.includes(actual);
        return false;
      default: return true;
    }
  }

  private checkPropertyTarget(actual: unknown, target: PropertyTarget): boolean {
    if (actual === undefined) return true;
    if (target.target === undefined) return true;

    if (Array.isArray(target.target) && target.target.length === 2) {
      // Range
      const [min, max] = target.target as [number, number];
      const num = Number(actual);
      return !isNaN(num) && num >= min && num <= max;
    }

    if (typeof target.target === "number" && typeof actual === "number") {
      switch (target.direction) {
        case "maximize": return actual >= target.target;
        case "minimize": return actual <= target.target;
        case "target-value": return Math.abs(actual - target.target) < (target.target * 0.1);
        default: return true;
      }
    }

    return true;
  }
}

// ============================================================================
// SAFETY ENGINE
// ============================================================================

export interface SafetyEngine {
  engineId: string;
  evaluate(candidate: Candidate, goalId?: string): Promise<SafetyResult>;
  evaluateSync(candidate: Candidate, goalId?: string): SafetyResult;
  evaluateGoal(objective: string): Promise<SafetyResult>;
  isBlocked(classification: SafetyClassification): boolean;
}

const HAZARDOUS_PATTERNS = [
  { pattern: /explosive/i, flag: "explosive", classification: "BLOCKED" as SafetyClassification },
  { pattern: /nerve agent|chemical weapon|bioweapon|mustard gas|sarin|vx/i, flag: "chemical_weapon", classification: "BLOCKED" as SafetyClassification },
  { pattern: /toxic gas|lethal|weaponize/i, flag: "toxic_weapon", classification: "BLOCKED" as SafetyClassification },
  { pattern: /fentanyl|methamphetamine|illicit.*synthesis/i, flag: "illicit_drug", classification: "BLOCKED" as SafetyClassification },
  { pattern: /radioactive|plutonium|uranium.*enrichment/i, flag: "radioactive", classification: "RESTRICTED" as SafetyClassification },
  { pattern: /pathogen|biological weapon/i, flag: "biological", classification: "RESTRICTED" as SafetyClassification },
  { pattern: /highly toxic|extremely hazardous/i, flag: "highly_toxic", classification: "REVIEW_REQUIRED" as SafetyClassification },
  { pattern: /flammable|corrosive|carcinogenic/i, flag: "hazardous_property", classification: "REVIEW_REQUIRED" as SafetyClassification },
];

const RESTRICTED_ELEMENTS = ["Pu", "U", "Np", "Am", "Th"]; // Example restricted
const HAZARDOUS_ELEMENTS = ["As", "Hg", "Pb", "Cd"]; // Requires review

export class DeterministicSafetyEngine implements SafetyEngine {
  engineId = "safety-engine-v1";

  evaluateSync(candidate: Candidate, goalId?: string): SafetyResult {
    const auditLog: SafetyAuditEntry[] = [];
    const hazardousFlags: string[] = [];
    const restrictedDomains: string[] = [];
    const incompatibleConditions: string[] = [];

    let classification: SafetyClassification = "SAFE";
    const repStr = String(candidate.representation.value).toLowerCase();
    const canonical = candidate.representation.canonicalValue.toLowerCase();

    // Check representation against hazardous patterns
    for (const { pattern, flag, classification: flagClass } of HAZARDOUS_PATTERNS) {
      if (pattern.test(repStr) || pattern.test(canonical)) {
        hazardousFlags.push(flag);
        auditLog.push({
          timestamp: new Date().toISOString(),
          check: `pattern_${flag}`,
          result: flagClass,
          details: `Matched pattern ${pattern} -> ${flag}`,
          flagged: true,
        });
        classification = this.maxClassification(classification, flagClass);
      } else {
        auditLog.push({
          timestamp: new Date().toISOString(),
          check: `pattern_${flag}`,
          result: "SAFE",
          details: `No match for ${flag}`,
          flagged: false,
        });
      }
    }

    // Check for restricted elements in representation
    for (const el of RESTRICTED_ELEMENTS) {
      if (repStr.includes(el.toLowerCase()) || canonical.includes(el.toLowerCase())) {
        hazardousFlags.push(`restricted_element_${el}`);
        restrictedDomains.push(`restricted_element_${el}`);
        auditLog.push({
          timestamp: new Date().toISOString(),
          check: `element_${el}`,
          result: "RESTRICTED",
          details: `Contains restricted element ${el}`,
          flagged: true,
        });
        classification = this.maxClassification(classification, "RESTRICTED");
      }
    }

    for (const el of HAZARDOUS_ELEMENTS) {
      if (repStr.includes(el.toLowerCase())) {
        hazardousFlags.push(`hazardous_element_${el}`);
        auditLog.push({
          timestamp: new Date().toISOString(),
          check: `hazardous_element_${el}`,
          result: "REVIEW_REQUIRED",
          details: `Contains hazardous element ${el} requiring review`,
          flagged: true,
        });
        classification = this.maxClassification(classification, "REVIEW_REQUIRED");
      }
    }

    // Check candidate metadata for safety flags
    if (candidate.metadata?.safetyFlag) {
      hazardousFlags.push(String(candidate.metadata.safetyFlag));
      classification = this.maxClassification(classification, "REVIEW_REQUIRED");
    }

    const blocked = classification === "BLOCKED";
    const requiresReview = classification === "REVIEW_REQUIRED" || classification === "RESTRICTED";

    const provenance = createProvenance({
      description: `Safety evaluation for ${candidate.candidateId}: ${classification}`,
      iteration: candidate.generationIteration,
      randomSeed: candidate.generationSeed,
      inputHash: candidate.contentHash,
      configHash: contentHash({ engine: this.engineId }),
      parentIds: [candidate.candidateId],
      tags: ["safety-engine", classification, ...hazardousFlags],
    });

    return {
      resultId: `safety_${candidate.candidateId}_${Date.now()}`,
      candidateId: candidate.candidateId,
      goalId,
      classification,
      hazardousFlags,
      restrictedDomains,
      incompatibleConditions,
      auditLog,
      explanation: blocked
        ? `BLOCKED: Contains hazardous content: ${hazardousFlags.join(", ")}. No operational instructions will be provided.`
        : requiresReview
        ? `REVIEW_REQUIRED: Flags: ${hazardousFlags.join(", ")}. Requires safety review before use.`
        : "SAFE: No hazardous content detected by automated checks. Still requires validation.",
      timestamp: new Date().toISOString(),
      provenance,
      blocked,
      requiresReview,
    };
  }

  async evaluate(candidate: Candidate, goalId?: string): Promise<SafetyResult> {
    return this.evaluateSync(candidate, goalId);
  }

  async evaluateGoal(objective: string): Promise<SafetyResult> {
    const lower = objective.toLowerCase();
    const hazardousFlags: string[] = [];
    const auditLog: SafetyAuditEntry[] = [];
    let classification: SafetyClassification = "SAFE";

    for (const { pattern, flag, classification: flagClass } of HAZARDOUS_PATTERNS) {
      if (pattern.test(lower)) {
        hazardousFlags.push(flag);
        auditLog.push({
          timestamp: new Date().toISOString(),
          check: `goal_pattern_${flag}`,
          result: flagClass,
          details: `Goal contains hazardous pattern: ${flag}`,
          flagged: true,
        });
        classification = this.maxClassification(classification, flagClass);
      }
    }

    const provenance = createProvenance({
      description: `Safety evaluation for goal: ${objective.slice(0, 100)}`,
      iteration: 0,
      randomSeed: 42,
      inputHash: contentHash(objective),
      configHash: contentHash({ engine: this.engineId }),
      tags: ["safety-engine", "goal", classification],
    });

    return {
      resultId: `safety_goal_${contentHash(objective).slice(0, 8)}_${Date.now()}`,
      candidateId: "GOAL",
      classification,
      hazardousFlags,
      restrictedDomains: [],
      incompatibleConditions: [],
      auditLog,
      explanation: classification === "BLOCKED"
        ? `Goal BLOCKED: ${hazardousFlags.join(", ")}`
        : `Goal classified as ${classification}`,
      timestamp: new Date().toISOString(),
      provenance,
      blocked: classification === "BLOCKED",
      requiresReview: classification === "REVIEW_REQUIRED" || classification === "RESTRICTED",
    };
  }

  isBlocked(classification: SafetyClassification): boolean {
    return classification === "BLOCKED";
  }

  private maxClassification(a: SafetyClassification, b: SafetyClassification): SafetyClassification {
    const order: Record<SafetyClassification, number> = {
      "SAFE": 0,
      "REVIEW_REQUIRED": 1,
      "RESTRICTED": 2,
      "BLOCKED": 3,
    };
    return order[a] > order[b] ? a : b;
  }
}

// ============================================================================
// PROPERTY PREDICTOR REGISTRY (MOCK)
// ============================================================================

export interface PropertyPredictor {
  modelId: string;
  modelVersion: string;
  modelType: "mock" | "ml-surrogate" | "physics-based" | "empirical" | "quantum" | "md" | "thermodynamic";
  property: string;
  isMock: boolean;
  predict(candidate: Candidate): Promise<PredictionResult>;
  predictSync(candidate: Candidate): PredictionResult;
}

export class MockPropertyPredictor implements PropertyPredictor {
  modelId: string;
  modelVersion = "0.1.0-mock";
  modelType: "mock" = "mock";
  property: string;
  isMock = true;

  constructor(property: string, modelId?: string) {
    this.property = property;
    this.modelId = modelId || `mock-${property}-predictor`;
  }

  predictSync(candidate: Candidate): PredictionResult {
    const start = Date.now();
    
    // Deterministic mock prediction based on content hash
    const hashSeed = parseInt(candidate.contentHash.slice(0, 8), 16) || 42;
    const rand = (hashSeed % 1000) / 1000;

    // Generate plausible but clearly mock values based on property
    let predictedValue: number;
    let unit: string | undefined;
    let uncertaintyValue: number;

    switch (this.property) {
      case "tensile_strength":
        predictedValue = 100 + rand * 900; // 100-1000 MPa mock
        unit = "MPa";
        uncertaintyValue = 0.3 + rand * 0.3;
        break;
      case "adhesion":
        predictedValue = rand * 10; // 0-10 mock scale
        uncertaintyValue = 0.4 + rand * 0.2;
        break;
      case "solidification_rate":
        predictedValue = rand * 100;
        unit = "K/s";
        uncertaintyValue = 0.35;
        break;
      case "solubility":
        predictedValue = rand;
        uncertaintyValue = 0.3;
        break;
      case "melting_point":
        predictedValue = 300 + rand * 1000;
        unit = "K";
        uncertaintyValue = 0.2;
        break;
      case "density":
        predictedValue = 0.5 + rand * 5;
        unit = "g/cm3";
        uncertaintyValue = 0.15;
        break;
      case "general_performance":
        predictedValue = rand;
        uncertaintyValue = 0.5;
        break;
      default:
        predictedValue = rand * 100;
        uncertaintyValue = 0.4;
    }

    const provenance = createProvenance({
      description: `Mock prediction for ${this.property} on ${candidate.candidateId}`,
      iteration: candidate.generationIteration,
      randomSeed: candidate.generationSeed,
      inputHash: candidate.contentHash,
      configHash: contentHash({ model: this.modelId, property: this.property }),
      parentIds: [candidate.candidateId],
      modelId: this.modelId,
      modelVersion: this.modelVersion,
      tags: ["mock-predictor", this.property, "not-scientific"],
    });

    const uncertainty = createUncertainty(uncertaintyValue, `mock-${this.property}`, provenance);

    return {
      predictionId: `pred_${this.property}_${candidate.candidateId}_${Date.now()}`,
      property: this.property,
      predictedValue,
      unit,
      uncertainty,
      confidence: 1 - uncertaintyValue,
      category: "PREDICTED",
      modelId: this.modelId,
      modelVersion: this.modelVersion,
      modelType: this.modelType,
      inferenceTimestamp: new Date().toISOString(),
      runtimeMs: Date.now() - start,
      provenance,
      inputHash: candidate.contentHash,
      isMock: true,
      warning: MOCK_WARNING,
    };
  }

  async predict(candidate: Candidate): Promise<PredictionResult> {
    return this.predictSync(candidate);
  }
}

export class PredictorRegistry {
  private predictors: Map<string, PropertyPredictor> = new Map();

  register(predictor: PropertyPredictor): void {
    this.predictors.set(predictor.property, predictor);
  }

  get(property: string): PropertyPredictor | undefined {
    return this.predictors.get(property);
  }

  list(): PropertyPredictor[] {
    return Array.from(this.predictors.values());
  }

  async predict(candidate: Candidate, properties?: string[]): Promise<PredictionResult[]> {
    const props = properties || Array.from(this.predictors.keys());
    const results: PredictionResult[] = [];

    for (const prop of props) {
      const predictor = this.predictors.get(prop);
      if (predictor) {
        const result = await predictor.predict(candidate);
        results.push(result);
      }
    }

    return results;
  }

  predictSync(candidate: Candidate, properties?: string[]): PredictionResult[] {
    const props = properties || Array.from(this.predictors.keys());
    const results: PredictionResult[] = [];

    for (const prop of props) {
      const predictor = this.predictors.get(prop);
      if (predictor) {
        results.push(predictor.predictSync(candidate));
      }
    }

    return results;
  }

  // Create mock registry for testing
  static createMockRegistry(properties: string[] = ["tensile_strength", "adhesion", "solidification_rate", "general_performance"]): PredictorRegistry {
    const registry = new PredictorRegistry();
    for (const prop of properties) {
      registry.register(new MockPropertyPredictor(prop));
    }
    return registry;
  }
}

// ============================================================================
// SIMULATION ENGINE (ADAPTER)
// ============================================================================

export interface SimulationEngine {
  engineId: string;
  engineVersion: string;
  engineType: string;
  isMock: boolean;
  isAvailable(): boolean;
  simulate(request: SimulationRequest): Promise<SimulationResult>;
  simulateSync(request: SimulationRequest): SimulationResult;
}

export class MockSimulationEngine implements SimulationEngine {
  engineId = "mock-simulation-engine";
  engineVersion = "0.1.0-mock";
  engineType = "mock";
  isMock = true;

  isAvailable(): boolean {
    return true; // Mock always available for pipeline testing
  }

  simulateSync(request: SimulationRequest): SimulationResult {
    const start = Date.now();
    
    const provenance = createProvenance({
      description: `Mock simulation for ${request.candidateId}`,
      iteration: 0,
      randomSeed: 42,
      inputHash: request.candidateHash,
      configHash: contentHash({ engine: this.engineId }),
      parentIds: [request.candidateId],
      engineId: this.engineId,
      engineVersion: this.engineVersion,
      tags: ["mock-simulation", "not-scientific"],
    });

    const uncertainty = createUncertainty(0.4, "mock-simulation", provenance);

    // Mock: return NOT_AVAILABLE for most, or mock results for pipeline testing
    // To avoid fabricating science, we return NOT_AVAILABLE unless explicitly allowed for testing
    const isTestCandidate = request.candidateHash.includes("MOCK") || request.candidateId.includes("MOCK") || request.candidateId.includes("cand_");

    if (!isTestCandidate) {
      return {
        resultId: `sim_${request.requestId}_${Date.now()}`,
        requestId: request.requestId,
        candidateId: request.candidateId,
        status: "NOT_AVAILABLE",
        properties: {},
        uncertainty,
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        engineType: this.engineType,
        inputHash: request.candidateHash,
        outputHash: contentHash({ status: "NOT_AVAILABLE" }),
        runtimeMs: Date.now() - start,
        timestamp: new Date().toISOString(),
        provenance,
        errorMessage: "No real simulation engine installed. Mock returns NOT_AVAILABLE to avoid fabricating scientific results.",
        isMock: true,
        warning: "MOCK SIMULATION - NOT SCIENTIFICALLY VALIDATED",
      };
    }

    // For mock test candidates, provide deterministic mock simulation
    const properties: Record<string, { value: unknown; unit?: string; uncertainty?: UncertaintyRecord }> = {};
    for (const prop of request.properties) {
      const hashSeed = parseInt(request.candidateHash.slice(0, 8), 16) || 42;
      const rand = (hashSeed % 1000) / 1000;
      properties[prop] = {
        value: 50 + rand * 50,
        unit: prop === "tensile_strength" ? "MPa" : undefined,
        uncertainty,
      };
    }

    return {
      resultId: `sim_${request.requestId}_${Date.now()}`,
      requestId: request.requestId,
      candidateId: request.candidateId,
      status: "SUCCESS",
      properties,
      uncertainty,
      engineId: this.engineId,
      engineVersion: this.engineVersion,
      engineType: this.engineType,
      inputHash: request.candidateHash,
      outputHash: contentHash(properties),
      runtimeMs: Date.now() - start,
      timestamp: new Date().toISOString(),
      provenance,
      isMock: true,
      warning: MOCK_WARNING,
    };
  }

  async simulate(request: SimulationRequest): Promise<SimulationResult> {
    return this.simulateSync(request);
  }
}

export class NotAvailableSimulationEngine implements SimulationEngine {
  engineId = "not-available-engine";
  engineVersion = "0.0.0";
  engineType = "none";
  isMock = false;

  isAvailable(): boolean {
    return false;
  }

  simulateSync(request: SimulationRequest): SimulationResult {
    const provenance = createProvenance({
      description: `Simulation not available for ${request.candidateId}`,
      iteration: 0,
      randomSeed: 0,
      inputHash: request.candidateHash,
      configHash: contentHash({ engine: this.engineId }),
      tags: ["simulation-not-available"],
    });

    const uncertainty = createUncertainty(1.0, "not-available", provenance);

    return {
      resultId: `sim_${request.requestId}_${Date.now()}`,
      requestId: request.requestId,
      candidateId: request.candidateId,
      status: "NOT_AVAILABLE",
      properties: {},
      uncertainty,
      engineId: this.engineId,
      engineVersion: this.engineVersion,
      engineType: this.engineType,
      inputHash: request.candidateHash,
      outputHash: contentHash({ status: "NOT_AVAILABLE" }),
      runtimeMs: 0,
      timestamp: new Date().toISOString(),
      provenance,
      errorMessage: "No simulation engine installed. Returning NOT_AVAILABLE rather than inventing results.",
      isMock: false,
    };
  }

  async simulate(request: SimulationRequest): Promise<SimulationResult> {
    return this.simulateSync(request);
  }
}

// ============================================================================
// SCORING ENGINE + PARETO
// ============================================================================

export interface ScoringEngine {
  engineId: string;
  score(candidate: Candidate, spec: ChemistrySpecification, constraintResult: ConstraintResult, safetyResult: SafetyResult): Promise<ScoringResult>;
  scoreSync(candidate: Candidate, spec: ChemistrySpecification, constraintResult: ConstraintResult, safetyResult: SafetyResult): ScoringResult;
  extractParetoFront(candidates: Candidate[], objectives: string[]): ParetoFront;
}

export class DeterministicScoringEngine implements ScoringEngine {
  engineId = "scoring-engine-v1";

  scoreSync(candidate: Candidate, spec: ChemistrySpecification, constraintResult: ConstraintResult, safetyResult: SafetyResult): ScoringResult {
    const breakdown: Record<string, number> = {};
    const weightedProperties: Record<string, number> = {};
    let objectiveScore = 0;

    // Score based on predictions vs targets
    for (const target of spec.propertyTargets) {
      const pred = candidate.predictions.find(p => p.property === target.property);
      let propScore = 0;

      if (pred && typeof pred.predictedValue === "number") {
        const val = pred.predictedValue as number;

        if (target.target === undefined) {
          // No explicit target, score based on direction
          switch (target.direction) {
            case "maximize": propScore = val / 1000; // normalize mock
              break;
            case "minimize": propScore = 1 - val / 1000;
              break;
            default: propScore = 0.5;
          }
        } else if (typeof target.target === "number") {
          switch (target.direction) {
            case "maximize":
              propScore = val >= target.target ? 1 : val / target.target;
              break;
            case "minimize":
              propScore = val <= target.target ? 1 : target.target / val;
              break;
            case "target-value":
              const diff = Math.abs(val - target.target);
              propScore = Math.max(0, 1 - diff / target.target);
              break;
            default:
              propScore = 0.5;
          }
        } else if (Array.isArray(target.target)) {
          const [min, max] = target.target as [number, number];
          if (val >= min && val <= max) propScore = 1;
          else if (val < min) propScore = val / min;
          else propScore = max / val;
        }

        // Apply weight and confidence
        propScore = propScore * target.weight * target.confidence;
        objectiveScore += propScore;
        breakdown[target.property] = propScore;
        weightedProperties[target.property] = propScore;
      } else {
        // No prediction, penalize slightly but don't fail
        breakdown[target.property] = 0;
        weightedProperties[target.property] = 0;
      }
    }

    // Normalize objective score
    if (spec.propertyTargets.length > 0) {
      objectiveScore = objectiveScore / spec.propertyTargets.length;
    }

    // Penalties
    const constraintPenalty = constraintResult.penalty;
    const feasibilityScore = constraintResult.passed ? 1 : 0;

    let safetyPenalty = 0;
    switch (safetyResult.classification) {
      case "SAFE": safetyPenalty = 0; break;
      case "REVIEW_REQUIRED": safetyPenalty = 0.2; break;
      case "RESTRICTED": safetyPenalty = 0.5; break;
      case "BLOCKED": safetyPenalty = 1; break;
    }

    // Uncertainty penalty: higher uncertainty = higher penalty
    const uncertaintyPenalty = candidate.uncertainty.value * 0.3;

    // Cost penalty (mock)
    const costPenalty = 0; // Could be based on properties

    // Diversity bonus (will be calculated externally, placeholder)
    const diversityBonus = 0;

    // Total score: weighted objective - penalties + bonuses
    const totalScore = Math.max(0,
      objectiveScore * 1.0
      - constraintPenalty * 0.5
      - safetyPenalty * 1.0
      - uncertaintyPenalty * 0.3
      - costPenalty * 0.2
      + diversityBonus * 0.1
      + feasibilityScore * 0.2
    );

    const provenance = createProvenance({
      description: `Scoring for ${candidate.candidateId}: ${totalScore.toFixed(3)}`,
      iteration: candidate.generationIteration,
      randomSeed: candidate.generationSeed,
      inputHash: candidate.contentHash,
      configHash: contentHash(spec),
      parentIds: [candidate.candidateId],
      tags: ["scoring-engine", `score-${totalScore.toFixed(2)}`],
    });

    return {
      scoreId: `score_${candidate.candidateId}_${Date.now()}`,
      candidateId: candidate.candidateId,
      totalScore,
      objectiveScore,
      constraintPenalty,
      feasibilityScore,
      uncertaintyPenalty,
      safetyPenalty,
      costPenalty,
      diversityBonus,
      breakdown,
      weightedProperties,
      timestamp: new Date().toISOString(),
      provenance,
      explanation: `Objective ${objectiveScore.toFixed(3)} - constraint ${constraintPenalty.toFixed(3)} - safety ${safetyPenalty.toFixed(3)} - uncertainty ${uncertaintyPenalty.toFixed(3)} + feasibility ${feasibilityScore}`,
      isParetoOptimal: false, // Will be set by Pareto extraction
    };
  }

  async score(candidate: Candidate, spec: ChemistrySpecification, constraintResult: ConstraintResult, safetyResult: SafetyResult): Promise<ScoringResult> {
    return this.scoreSync(candidate, spec, constraintResult, safetyResult);
  }

  extractParetoFront(candidates: Candidate[], objectives: string[]): ParetoFront {
    // Non-dominated sorting for Pareto front
    // Candidate A dominates B if A is better in all objectives and strictly better in at least one

    const dominated = new Set<string>();
    const front: string[] = [];

    for (let i = 0; i < candidates.length; i++) {
      if (dominated.has(candidates[i].candidateId)) continue;

      let isDominated = false;

      for (let j = 0; j < candidates.length; j++) {
        if (i === j) continue;
        if (dominated.has(candidates[j].candidateId)) continue;

        if (this.dominates(candidates[j], candidates[i], objectives)) {
          isDominated = true;
          break;
        }
      }

      if (!isDominated) {
        front.push(candidates[i].candidateId);
        // Mark candidates dominated by this one
        for (let j = 0; j < candidates.length; j++) {
          if (i === j) continue;
          if (this.dominates(candidates[i], candidates[j], objectives)) {
            dominated.add(candidates[j].candidateId);
          }
        }
      }
    }

    return {
      frontId: `pareto_${contentHash(front).slice(0, 8)}_${Date.now()}`,
      candidates: front,
      objectives,
      dominatedCount: dominated.size,
      timestamp: new Date().toISOString(),
      iteration: candidates[0]?.generationIteration || 0,
    };
  }

  private dominates(a: Candidate, b: Candidate, objectives: string[]): boolean {
    let betterInAtLeastOne = false;

    for (const obj of objectives) {
      const predA = a.predictions.find(p => p.property === obj);
      const predB = b.predictions.find(p => p.property === obj);

      if (!predA || !predB) continue;
      if (typeof predA.predictedValue !== "number" || typeof predB.predictedValue !== "number") continue;

      const valA = predA.predictedValue as number;
      const valB = predB.predictedValue as number;

      // For now assume maximize for all Pareto objectives, can be extended
      if (valA < valB) return false; // A is worse in this objective
      if (valA > valB) betterInAtLeastOne = true;
    }

    return betterInAtLeastOne;
  }
}
