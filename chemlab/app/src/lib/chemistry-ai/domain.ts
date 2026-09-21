/**
 * CHEMISTRY AI — CORE DOMAIN MODELS
 * Phase 1: Core domain models for goal-driven computational chemistry/design engine
 * 
 * Architecture: USER GOAL -> GOAL INTERPRETER -> CHEM SPEC -> DESIGN SPACE -> GENERATOR -> PREDICTORS -> SAFETY/CONSTRAINT -> SIMULATION -> SCORING -> SEARCH -> ACTIVE LEARNING -> FINAL CANDIDATES -> REPORT
 * 
 * Rules:
 * - Never fabricate scientific results
 * - Preserve provenance & uncertainty
 * - Deterministic & reproducible
 * - Safety layer mandatory
 * - Every candidate immutable after evaluation
 * - Predictions labeled as computational, not experimental
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export type OptimizationDirection = "maximize" | "minimize" | "target-range" | "target-value" | "any";
export type ConstraintType = "HARD" | "SOFT";
export type DesignDomain = "molecule" | "polymer" | "mixture" | "material" | "formulation" | "catalyst" | "crystal" | "surface" | "user-defined";
export type SafetyClassification = "SAFE" | "REVIEW_REQUIRED" | "RESTRICTED" | "BLOCKED";
export type GenerationMethod = "random" | "fragment" | "evolutionary" | "bayesian" | "graph" | "generative-model" | "diffusion" | "domain-specific" | "crossover" | "mutation" | "interpolation" | "mock-deterministic";
export type EvaluationStage = "STRUCTURAL" | "FAST_PREDICT" | "CONSTRAINT" | "SAFETY" | "SIMULATION" | "VERIFICATION";
export type PredictionCategory = "PREDICTED" | "SIMULATED" | "OBSERVED" | "NOT_AVAILABLE";
export type ModelType = "mock" | "ml-surrogate" | "physics-based" | "empirical" | "quantum" | "md" | "thermodynamic";

// ============================================================================
// UTILITY: DETERMINISTIC HASHING & CANONICAL SERIALIZATION
// ============================================================================

/**
 * Simple deterministic hash for content addressing (FNV-1a variant, deterministic across runs)
 * Not cryptographically secure, but deterministic and reproducible
 */
export function contentHash(obj: unknown): string {
  const str = canonicalStringify(obj);
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Convert to hex, 8 chars
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function canonicalStringify(obj: unknown): string {
  if (obj === null) return "null";
  if (obj === undefined) return "null";
  if (typeof obj === "string") return JSON.stringify(obj);
  if (typeof obj === "number") {
    if (!isFinite(obj)) return "null";
    return JSON.stringify(obj);
  }
  if (typeof obj === "boolean") return obj ? "true" : "false";
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalStringify).join(",") + "]";
  }
  if (typeof obj === "object") {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const parts = keys.map(k => {
      const v = (obj as Record<string, unknown>)[k];
      if (v === undefined) return null;
      return JSON.stringify(k) + ":" + canonicalStringify(v);
    }).filter(Boolean);
    return "{" + parts.join(",") + "}";
  }
  return "null";
}

export function deterministicRandom(seed: number): () => number {
  // Mulberry32 deterministic PRNG
  let s = seed >>> 0;
  return function() {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashToSeed(hashStr: string): number {
  let seed = 0;
  for (let i = 0; i < hashStr.length; i++) {
    seed = (seed * 31 + hashStr.charCodeAt(i)) >>> 0;
  }
  return seed || 1;
}

// ============================================================================
// GOAL & SPECIFICATION
// ============================================================================

export interface TargetProperty {
  property: string; // e.g., "tensile_strength", "adhesion", "solubility"
  targetValue?: number | [number, number] | string; // single, range, or categorical
  direction: OptimizationDirection;
  unit?: string;
  importanceWeight: number; // 0-1
  constraintType: ConstraintType;
  confidence: number; // 0-1, how confident we are in this target interpretation
  provenance: string; // where this target came from
  isExplicit: boolean; // true if user explicitly provided, false if inferred
  ambiguity?: string; // if ambiguous, describe ambiguity
}

export interface Constraint {
  id: string;
  property: string;
  type: ConstraintType;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not-in" | "range" | "custom";
  value: unknown;
  unit?: string;
  description: string;
  provenance: string;
  penaltyWeight?: number; // for soft constraints
}

export interface EnvironmentalCondition {
  temperature?: { value: number; unit: string; range?: [number, number] };
  pressure?: { value: number; unit: string; range?: [number, number] };
  pH?: { value: number; range?: [number, number] };
  humidity?: { value: number; unit: string };
  solvent?: string;
  atmosphere?: string;
  other?: Record<string, unknown>;
}

export interface ChemistryGoal {
  goalId: string;
  objective: string; // original natural language
  parsedObjective: string; // cleaned
  targetProperties: TargetProperty[];
  constraints: Constraint[];
  environment?: EnvironmentalCondition;
  designType: DesignDomain;
  formulationType?: string;
  requestedScale?: "lab" | "pilot" | "industrial" | "theoretical" | string;
  exclusions: string[];
  safetyLevel: SafetyClassification;
  evaluationBudget?: {
    maxIterations?: number;
    maxCandidates?: number;
    maxTimeMs?: number;
    computeBudget?: string;
  };
  uncertaintyRequirements?: {
    maxUncertainty?: number;
    requireConfidenceInterval?: boolean;
    minConfidence?: number;
  };
  ambiguityFlags: string[]; // explicit list of ambiguities
  rawInput: string;
  createdAt: string;
  version: string;
  provenance: ProvenanceRecord;
}

export interface PropertyTarget {
  property: string;
  target?: number | [number, number] | string;
  direction: OptimizationDirection;
  weight: number;
  constraintType: ConstraintType;
  confidence: number;
  source: string;
  provenance: ProvenanceRecord;
  unit?: string;
  isHardConstraint: boolean;
}

export interface ChemistrySpecification {
  specId: string;
  goalId: string;
  description: string;
  propertyTargets: PropertyTarget[];
  constraints: Constraint[];
  environment?: EnvironmentalCondition;
  designDomain: DesignDomain;
  exclusions: string[];
  safetyLevel: SafetyClassification;
  evaluationBudget: Required<NonNullable<ChemistryGoal["evaluationBudget"]>>;
  uncertaintyRequirements: NonNullable<ChemistryGoal["uncertaintyRequirements"]>;
  weights: Record<string, number>; // property -> weight, normalized
  createdAt: string;
  version: string;
  provenance: ProvenanceRecord;
  rawGoal: ChemistryGoal;
  // Serializable
  toJSON(): Record<string, unknown>;
}

// ============================================================================
// DESIGN SPACE & CANDIDATE
// ============================================================================

export interface DesignRepresentation {
  type: DesignDomain;
  format: string; // e.g., "SMILES", "SELFIES", "graph", "composition", "formula", "sequence", "custom"
  value: string | Record<string, unknown>; // actual representation
  canonicalValue: string; // canonical serialized form for hashing
  hash: string; // content hash
  metadata?: Record<string, unknown>;
}

export interface DesignConstraint {
  id: string;
  description: string;
  type: ConstraintType;
  check: (candidate: Candidate) => ConstraintCheckResult;
}

export interface ConstraintCheckResult {
  passed: boolean;
  violation?: string;
  penalty: number;
  details?: Record<string, unknown>;
}

export interface DesignSpace {
  spaceId: string;
  domain: DesignDomain;
  description: string;
  representationFormat: string;
  constraints: DesignConstraint[];
  bounds?: Record<string, [number, number] | string[] | unknown>; // property bounds
  allowedElements?: string[];
  allowedFragments?: string[];
  maxSize?: number;
  minSize?: number;
  version: string;
  provenance: ProvenanceRecord;
}

export interface EvaluationRecord {
  evaluationId: string;
  stage: EvaluationStage;
  timestamp: string;
  predictions: PredictionResult[];
  constraintResult?: ConstraintResult;
  safetyResult?: SafetyResult;
  simulationResult?: SimulationResult;
  passed: boolean;
  reason?: string;
  runtimeMs: number;
  provenance: ProvenanceRecord;
}

export interface Candidate {
  candidateId: string;
  contentHash: string; // hash of representation
  representation: DesignRepresentation;
  designType: DesignDomain;
  generationMethod: GenerationMethod;
  parentCandidates: string[]; // candidateIds
  generationIteration: number;
  properties: Record<string, unknown>; // intrinsic properties
  predictions: PredictionResult[];
  uncertainty: UncertaintyRecord;
  safetyClassification: SafetyClassification;
  provenance: ProvenanceRecord;
  evaluationHistory: EvaluationRecord[];
  isImmutable: boolean; // true once evaluation record created
  createdAt: string;
  version: string;
  metadata?: Record<string, unknown>;
  // For tracking
  score?: number;
  paretoRank?: number;
  generationSeed: number;
}

// ============================================================================
// PREDICTION & SIMULATION
// ============================================================================

export interface PredictionResult {
  predictionId: string;
  property: string;
  predictedValue: number | string | boolean | unknown;
  unit?: string;
  uncertainty: UncertaintyRecord;
  confidence: number; // 0-1
  category: PredictionCategory;
  modelId: string;
  modelVersion: string;
  modelType: ModelType;
  inferenceTimestamp: string;
  runtimeMs: number;
  provenance: ProvenanceRecord;
  inputHash: string;
  isMock: boolean; // true if placeholder/mock predictor
  warning?: string; // e.g., "MOCK PREDICTOR - NOT SCIENTIFICALLY VALIDATED"
}

export interface SimulationRequest {
  requestId: string;
  candidateId: string;
  candidateHash: string;
  properties: string[]; // which properties to simulate
  engineId: string;
  parameters: Record<string, unknown>;
  priority: number;
  createdAt: string;
  provenance: ProvenanceRecord;
}

export interface SimulationResult {
  resultId: string;
  requestId: string;
  candidateId: string;
  status: "SUCCESS" | "FAILED" | "NOT_AVAILABLE" | "TIMEOUT" | "ERROR";
  properties: Record<string, { value: unknown; unit?: string; uncertainty?: UncertaintyRecord }>;
  uncertainty: UncertaintyRecord;
  engineId: string;
  engineVersion: string;
  engineType: string;
  inputHash: string;
  outputHash: string;
  runtimeMs: number;
  timestamp: string;
  provenance: ProvenanceRecord;
  errorMessage?: string;
  isMock: boolean;
  warning?: string;
}

// ============================================================================
// CONSTRAINT & SAFETY
// ============================================================================

export interface ConstraintResult {
  resultId: string;
  candidateId: string;
  passed: boolean;
  hardViolations: ConstraintViolation[];
  softViolations: ConstraintViolation[];
  penalty: number; // 0-1, sum of soft penalties
  scoreAdjustment: number; // negative if violations
  explanation: string;
  timestamp: string;
  provenance: ProvenanceRecord;
}

export interface ConstraintViolation {
  constraintId: string;
  property: string;
  type: ConstraintType;
  expected: unknown;
  actual: unknown;
  penalty: number;
  message: string;
}

export interface SafetyResult {
  resultId: string;
  candidateId: string;
  goalId?: string;
  classification: SafetyClassification;
  hazardousFlags: string[];
  restrictedDomains: string[];
  incompatibleConditions: string[];
  auditLog: SafetyAuditEntry[];
  explanation: string;
  timestamp: string;
  provenance: ProvenanceRecord;
  blocked: boolean; // true if BLOCKED
  requiresReview: boolean;
}

export interface SafetyAuditEntry {
  timestamp: string;
  check: string;
  result: SafetyClassification;
  details: string;
  flagged: boolean;
}

// ============================================================================
// SCORING & PARETO
// ============================================================================

export interface ScoringResult {
  scoreId: string;
  candidateId: string;
  totalScore: number;
  objectiveScore: number; // weighted objective satisfaction
  constraintPenalty: number;
  feasibilityScore: number;
  uncertaintyPenalty: number;
  safetyPenalty: number;
  costPenalty: number;
  diversityBonus: number;
  breakdown: Record<string, number>; // property -> score contribution
  weightedProperties: Record<string, number>;
  timestamp: string;
  provenance: ProvenanceRecord;
  explanation: string;
  isParetoOptimal: boolean;
  paretoRank?: number;
}

export interface ParetoFront {
  frontId: string;
  candidates: string[]; // candidateIds
  objectives: string[]; // property names
  dominatedCount: number;
  timestamp: string;
  iteration: number;
}

// ============================================================================
// PROVENANCE, UNCERTAINTY, SEARCH STATE, CHECKPOINT
// ============================================================================

export interface ProvenanceRecord {
  recordId: string;
  goalId?: string;
  candidateId?: string;
  parentIds: string[];
  generationMethod?: GenerationMethod;
  modelId?: string;
  modelVersion?: string;
  engineId?: string;
  engineVersion?: string;
  iteration: number;
  timestamp: string;
  randomSeed: number;
  configHash: string;
  inputHash: string;
  outputHash?: string;
  version: string;
  description: string;
  tags: string[];
}

export interface UncertaintyRecord {
  uncertaintyId: string;
  value: number; // 0-1, 0 = certain, 1 = highly uncertain
  confidence: number; // 0-1
  source: string; // e.g., "model", "data", "goal-ambiguity", "simulation"
  breakdown?: Record<string, number>; // source -> uncertainty contribution
  confidenceInterval?: [number, number];
  timestamp: string;
  provenance: ProvenanceRecord;
}

export interface SearchState {
  searchId: string;
  goalId: string;
  specId: string;
  iteration: number;
  candidateCount: number;
  evaluatedCount: number;
  rejectedCount: number;
  currentParetoFront: string[]; // candidateIds
  bestPredictedCandidates: string[]; // candidateIds
  explorationStats: {
    explorationRate: number;
    diversity: number;
    avgUncertainty: number;
    coverage: number;
  };
  convergenceStats: {
    bestScore: number;
    avgScore: number;
    improvement: number;
    iterationsWithoutImprovement: number;
    isConverged: boolean;
  };
  modelVersions: Record<string, string>;
  budgetConsumption: {
    candidatesGenerated: number;
    candidatesEvaluated: number;
    simulationsRun: number;
    timeElapsedMs: number;
    computeBudgetUsed: number;
  };
  terminationReason?: string;
  isComplete: boolean;
  createdAt: string;
  updatedAt: string;
  randomSeed: number;
  config: SearchConfig;
  provenance: ProvenanceRecord;
}

export interface SearchConfig {
  maxIterations: number;
  maxCandidates: number;
  candidatesPerIteration: number;
  cheapFilterRatio: number; // e.g., 0.5 = keep 50% after cheap filter
  propertyFilterRatio: number;
  simulationRatio: number; // fraction to send to expensive simulation
  finalCandidateCount: number;
  explorationRate: number; // 0-1, 0 = exploit only, 1 = explore only
  diversityWeight: number;
  uncertaintyWeight: number;
  performanceWeight: number;
  convergenceThreshold: number;
  minImprovement: number;
  diversityThreshold: number;
  uncertaintyThreshold: number;
  timeBudgetMs?: number;
  computeBudget?: number;
  randomSeed: number;
  deterministic: boolean;
}

export interface Checkpoint {
  checkpointId: string;
  searchId: string;
  iteration: number;
  searchState: SearchState;
  candidateHashes: string[]; // references, not full candidates
  modelVersions: Record<string, string>;
  randomSeed: number;
  config: SearchConfig;
  configHash: string;
  timestamp: string;
  provenance: ProvenanceRecord;
}

export interface CandidateMemoryEntry {
  candidateId: string;
  contentHash: string;
  representationHash: string;
  parentHashes: string[];
  generationMethod: GenerationMethod;
  iteration: number;
  score?: number;
  safetyClassification: SafetyClassification;
  predictionSummary: Record<string, { value: unknown; confidence: number; isMock: boolean }>;
  evaluationSummary: {
    stagesPassed: EvaluationStage[];
    stagesFailed: EvaluationStage[];
    finalPassed: boolean;
  };
  provenance: ProvenanceRecord;
  createdAt: string;
  storagePath?: string; // for large artifacts, referenced by hash/path
}

// ============================================================================
// API TYPES
// ============================================================================

export interface CreateGoalRequest {
  objective: string;
  designType?: DesignDomain;
  constraints?: Array<{ property: string; operator: string; value: unknown; type?: ConstraintType }>;
  environment?: EnvironmentalCondition;
  exclusions?: string[];
  evaluationBudget?: ChemistryGoal["evaluationBudget"];
  safetyLevel?: SafetyClassification;
}

export interface SearchRequest {
  goalId: string;
  config?: Partial<SearchConfig>;
}

export interface CandidateQuery {
  searchId?: string;
  minScore?: number;
  safetyClassification?: SafetyClassification[];
  designType?: DesignDomain;
  limit?: number;
  offset?: number;
  paretoOnly?: boolean;
}

// ============================================================================
// TOOL REGISTRY
// ============================================================================

export interface ToolDefinition {
  toolId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  version: string;
  isMock: boolean;
}

export interface ToolCall {
  callId: string;
  toolId: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: "PENDING" | "SUCCESS" | "FAILED";
  timestamp: string;
  runtimeMs: number;
  provenance: ProvenanceRecord;
}

// ============================================================================
// REPORT
// ============================================================================

export interface ChemistryDesignReport {
  reportId: string;
  searchId: string;
  goalId: string;
  goal: ChemistryGoal;
  specification: ChemistrySpecification;
  searchState: SearchState;
  topCandidates: CandidateReport[];
  paretoFront: ParetoFront;
  methodology: {
    generatorsUsed: string[];
    predictorsUsed: Array<{ modelId: string; isMock: boolean; warning?: string }>;
    simulatorsUsed: Array<{ engineId: string; status: string; isMock: boolean }>;
    constraintChecks: number;
    safetyChecks: number;
  };
  importantStatus: {
    predictions: string; // e.g., "COMPUTATIONAL PREDICTIONS ONLY - NOT EXPERIMENTALLY VALIDATED"
    simulations: string;
    experimentalValidation: "NOT_PERFORMED" | "AVAILABLE" | "PARTIAL";
    mockWarning?: string;
  };
  provenance: ProvenanceRecord;
  createdAt: string;
  disclaimer: string;
}

export interface CandidateReport {
  candidateId: string;
  rank: number;
  representation: DesignRepresentation;
  designType: DesignDomain;
  predictedProperties: Array<{
    property: string;
    value: unknown;
    unit?: string;
    uncertainty: UncertaintyRecord;
    confidence: number;
    category: PredictionCategory;
    isMock: boolean;
  }>;
  constraintStatus: ConstraintResult;
  safetyStatus: SafetyResult;
  scoring: ScoringResult;
  generationMethod: GenerationMethod;
  parentCandidates: string[];
  evidence: {
    predictions: PredictionResult[];
    simulations: SimulationResult[];
    evaluations: EvaluationRecord[];
  };
  provenance: ProvenanceRecord;
  disclaimer: string;
}

// ============================================================================
// DEFAULTS & FACTORIES
// ============================================================================

export function createProvenance(overrides: Partial<ProvenanceRecord> & { description: string }): ProvenanceRecord {
  const now = new Date().toISOString();
  return {
    recordId: `prov_${contentHash({ ...overrides, ts: now }).slice(0, 8)}_${Date.now()}`,
    parentIds: [],
    iteration: 0,
    timestamp: now,
    randomSeed: 0,
    configHash: contentHash(overrides),
    inputHash: contentHash(overrides),
    version: "1.0.0",
    tags: [],
    ...overrides,
  };
}

export function createUncertainty(value: number, source: string, provenance: ProvenanceRecord): UncertaintyRecord {
  return {
    uncertaintyId: `unc_${contentHash({ value, source, ts: Date.now() }).slice(0, 8)}`,
    value: Math.max(0, Math.min(1, value)),
    confidence: 1 - Math.max(0, Math.min(1, value)),
    source,
    timestamp: new Date().toISOString(),
    provenance,
  };
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  maxIterations: 10,
  maxCandidates: 10000,
  candidatesPerIteration: 1000,
  cheapFilterRatio: 0.5, // 10000 -> 5000
  propertyFilterRatio: 0.1, // 5000 -> 500
  simulationRatio: 0.1, // 500 -> 50
  finalCandidateCount: 10,
  explorationRate: 0.3,
  diversityWeight: 0.2,
  uncertaintyWeight: 0.2,
  performanceWeight: 0.6,
  convergenceThreshold: 0.001,
  minImprovement: 0.01,
  diversityThreshold: 0.1,
  uncertaintyThreshold: 0.5,
  randomSeed: 42,
  deterministic: true,
};

export const SAFETY_DISCLAIMER = `
IMPORTANT STATUS:
- All predictions are COMPUTATIONAL PREDICTIONS ONLY
- No experimental validation has been performed unless explicitly stated
- Mock predictors are clearly labeled and NOT scientifically validated
- Candidates require laboratory validation before any real-world use
- Hazardous chemistry is blocked by safety layer
- Never treat computational candidates as experimentally proven
`;

export const MOCK_WARNING = "MOCK PREDICTOR - NOT SCIENTIFICALLY VALIDATED - FOR PIPELINE TESTING ONLY";
