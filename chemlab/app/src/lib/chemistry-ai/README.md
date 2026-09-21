# Chemistry AI — Goal-Driven Computational Chemistry/Design Engine

**SEARCH ENGINE FIRST MILESTONE — Complete pipeline infrastructure with mock/placeholder scientific engines**

## Architecture

```
USER GOAL
↓
GOAL INTERPRETER (deterministic keyword-based, future: LLM)
↓
CHEMISTRY SPECIFICATION (normalized, serializable to JSON)
↓
TASK / CONSTRAINT PLANNER (implicit in spec builder)
↓
DESIGN-SPACE SELECTOR (molecule, polymer, material, etc.)
↓
CANDIDATE GENERATOR (pluggable: random, fragment, evolutionary, bayesian, generative-model adapter, diffusion adapter)
↓
FAST PROPERTY PREDICTORS (registry, mock clearly labeled)
↓
SAFETY / CONSTRAINT FILTER (mandatory)
↓
EXPENSIVE EVALUATION (simulation adapter, returns NOT_AVAILABLE if no real engine)
↓
SCORING ENGINE (multi-objective weighted, Pareto)
↓
SEARCH / OPTIMIZATION CONTROLLER (hierarchical filtering 10000->5000->500->50->10 configurable)
↓
ACTIVE LEARNING LOOP (prediction error tracking, model improvement)
↓
FINAL CANDIDATE SET (ranked, provenance, uncertainty)
↓
REPORT / EXPLANATION (LLM layer explains, never claims experimental validation)
```

Iterative loop: Generate → Evaluate → Learn → Search → Generate → Evaluate → ...

## Design Principles

1. **Separate orchestration from scientific computation** — Scientific engines are plugins/adapters
2. **Never fabricate scientific results** — Mock predictors labeled, simulation returns NOT_AVAILABLE if no real engine
3. **Never silently invent missing target values** — Ambiguity represented explicitly, isExplicit flag
4. **Preserve provenance** — Every candidate, prediction, evaluation has ProvenanceRecord with parentIds, model versions, hashes, seed, iteration
5. **Preserve uncertainty** — UncertaintyRecord propagated through pipeline, confidence intervals
6. **Deterministic & reproducible** — Mulberry32 PRNG, contentHash (FNV-1a), canonicalStringify (sorted keys), versioned configs, seed
7. **Resumable** — Checkpoint contains search state, candidate hashes, model versions, seed, config, hashes, iteration
8. **Minimal storage** — CandidateMemory stores metadata + hash references, large artifacts referenced by hash/path
9. **Safety mandatory** — SafetyEngine classifies SAFE/REVIEW_REQUIRED/RESTRICTED/BLOCKED before operational instructions, audit logging, hazardous patterns
10. **No experimental claims** — Terminology: "highest predicted score", "Pareto candidate", "computationally promising", "high uncertainty", "requires validation"

## Core Domain Models (`domain.ts`)

- **ChemistryGoal**: objective, targetProperties[], constraints[], environment, designType, exclusions, safetyLevel, evaluationBudget, ambiguityFlags, provenance
- **PropertyTarget**: property, target, direction (maximize/minimize/target-range/target-value/any), weight, constraintType (HARD/SOFT), confidence, provenance, isHardConstraint, unit, isExplicit
- **ChemistrySpecification**: specId, goalId, propertyTargets, constraints, environment, designDomain, weights (normalized), toJSON()
- **DesignSpace**: spaceId, domain (molecule/polymer/mixture/material/formulation/catalyst/crystal/surface/user-defined), representationFormat, constraints, bounds, allowedElements, version, provenance
- **DesignRepresentation**: type, format (SMILES/SELFIES/graph/composition/formula/sequence/custom), value, canonicalValue, hash, metadata
- **Candidate**: candidateId, contentHash, representation, designType, generationMethod, parentCandidates, generationIteration, properties, predictions, uncertainty, safetyClassification, provenance, evaluationHistory, isImmutable (true after evaluation), score, paretoRank, generationSeed
- **PredictionResult**: property, predictedValue, uncertainty, confidence, category (PREDICTED/SIMULATED/OBSERVED/NOT_AVAILABLE), modelId, modelVersion, modelType (mock/ml-surrogate/physics-based/empirical/quantum/md/thermodynamic), inferenceTimestamp, provenance, inputHash, isMock, warning (MOCK WARNING)
- **SimulationRequest/Result**: status (SUCCESS/FAILED/NOT_AVAILABLE/TIMEOUT/ERROR), properties, uncertainty, engineId, engineVersion, inputHash, outputHash, runtime, provenance, isMock
- **ConstraintResult**: passed, hardViolations[], softViolations[], penalty, scoreAdjustment, explanation, provenance
- **SafetyResult**: classification (SAFE/REVIEW_REQUIRED/RESTRICTED/BLOCKED), hazardousFlags, restrictedDomains, auditLog, blocked, requiresReview, provenance
- **ScoringResult**: totalScore, objectiveScore, constraintPenalty, feasibilityScore, uncertaintyPenalty, safetyPenalty, costPenalty, diversityBonus, breakdown, weightedProperties, isParetoOptimal, paretoRank, provenance, explanation
- **ParetoFront**: candidates[], objectives[], dominatedCount, iteration
- **ProvenanceRecord**: recordId, goalId, candidateId, parentIds, generationMethod, modelId, modelVersion, engineId, engineVersion, iteration, timestamp, randomSeed, configHash, inputHash, outputHash, version, description, tags
- **UncertaintyRecord**: value 0-1, confidence 0-1, source, breakdown, confidenceInterval, provenance
- **SearchState**: searchId, goalId, specId, iteration, candidateCount, evaluatedCount, rejectedCount, currentParetoFront, bestPredictedCandidates, explorationStats (explorationRate, diversity, avgUncertainty, coverage), convergenceStats (bestScore, avgScore, improvement, iterationsWithoutImprovement, isConverged), modelVersions, budgetConsumption, terminationReason, isComplete, randomSeed, config, provenance
- **SearchConfig**: maxIterations, maxCandidates, candidatesPerIteration, cheapFilterRatio, propertyFilterRatio, simulationRatio, finalCandidateCount, explorationRate, diversityWeight, uncertaintyWeight, performanceWeight, convergenceThreshold, minImprovement, diversityThreshold, uncertaintyThreshold, timeBudgetMs, randomSeed, deterministic
- **Checkpoint**: checkpointId, searchId, iteration, searchState, candidateHashes, modelVersions, randomSeed, config, configHash, provenance
- **CandidateMemoryEntry**: candidateId, contentHash, representationHash, parentHashes, generationMethod, iteration, score, safetyClassification, predictionSummary, evaluationSummary, provenance, storagePath

## Components

### Goal Interpreter (`goalInterpreter.ts`)
- **DeterministicGoalInterpreter**: keyword-based parsing, no LLM yet but interface ready
- Detects: tensile_strength, adhesion, solidification_rate, solubility, melting_point, etc. via PROPERTY_KEYWORDS map
- Detects designType via DESIGN_TYPE_KEYWORDS
- Safety classification: HAZARDOUS_KEYWORDS -> BLOCKED, RESTRICTED_KEYWORDS -> RESTRICTED, toxic/flammable -> REVIEW_REQUIRED, else SAFE
- Extracts numerical targets only if explicitly provided (e.g., "> 1000 MPa"), else isExplicit=false and ambiguity flag
- Preserves ambiguity explicitly

### Chemistry Specification (`chemistrySpec.ts`)
- Converts ChemistryGoal to normalized ChemistrySpecification
- PropertyTarget with weight normalized to sum 1
- Implicit hard constraints from hard targets
- Serializable to JSON via toJSON()
- Validation

### Design Space (`designSpace.ts`)
- **DeterministicDesignSpaceFactory**: creates DesignSpace for domain, default constraints (structural validity, size), default bounds, allowedElements
- **DeterministicCandidateFactory**: creates Candidate with contentHash, provenance, uncertainty 0.5 initial
- **DesignSpaceSelector**: selects appropriate space based on goal
- Supports: molecule, polymer, mixture, material, formulation, catalyst, crystal, surface, user-defined
- Validation

### Candidate Generators (`generators.ts`)
- **CandidateGenerator interface**: generate(context) -> Candidate[]
- **BaseCandidateGenerator**: deterministic, uses Mulberry32 PRNG
- **RandomSamplingGenerator**: random composition from allowedElements, deterministic
- **FragmentBasedGenerator**: fragment-based from allowedFragments or previous candidates
- **EvolutionaryGenerator**: crossover (first half + second half) and mutation, sorts previous by score
- **BayesianOptimizationGenerator**: exploration (high uncertainty) + exploitation (high score), uncertainty weighting
- **GenerativeModelAdapter**: adapter for real generative models, currently mock SMILES-like, clearly labeled, throws if real model expected but not available
- **CompositeCandidateGenerator**: orchestrates multiple strategies based on explorationRate, allocates budget, deduplicates by contentHash
- All mock and clearly labeled for pipeline testing

### Engines (`engines.ts`)
- **ConstraintEngine**: DeterministicConstraintEngine, evaluates HARD/SOFT constraints, operators eq/neq/gt/gte/lt/lte/range/in/not-in/custom, returns ConstraintResult with hardViolations, softViolations, penalty, scoreAdjustment
- **SafetyEngine**: DeterministicSafetyEngine, mandatory, classifies SAFE/REVIEW_REQUIRED/RESTRICTED/BLOCKED, checks hazardous patterns (explosive, chemical weapon, etc.), restricted elements (Pu, U, etc.), hazardous elements (As, Hg, etc.), audit logging, goal evaluation, isBlocked()
- **PredictorRegistry**: registry of PropertyPredictor, MockPropertyPredictor deterministic based on contentHash, returns PredictionResult with uncertainty, confidence, isMock=true, warning MOCK_WARNING, createMockRegistry()
- **SimulationEngine**: interface, MockSimulationEngine returns NOT_AVAILABLE for non-mock candidates to avoid fabricating, returns mock SUCCESS for MOCK candidates for pipeline testing, NotAvailableSimulationEngine returns NOT_AVAILABLE always, isAvailable(), isMock
- **ScoringEngine**: DeterministicScoringEngine, multi-objective: score = weighted objective - constraint - safety - uncertainty - cost + diversity + feasibility, weights from spec, Pareto front extraction via non-dominated sorting, terminology "highest predicted score", "Pareto candidate", etc.

### Search Controller (`searchController.ts`)
- **SearchStateManager**: createInitialState, updateAfterIteration, checkTermination (maxIterations, maxCandidates, convergence, timeBudget)
- **CandidateMemory**: minimal storage, Map contentHash -> Candidate, Map candidateId -> CandidateMemoryEntry, add(), get(), list(), size(), clear(), predictionSummary, evaluationSummary, stores only metadata + hash, large artifacts referenced by path
- **CheckpointManager**: createCheckpoint, getCheckpoint, getLatestCheckpoint, listCheckpoints, contains searchState, candidateHashes, modelVersions, seed, config, hashes, iteration, resumable
- **ActiveLearningController**: tracks predictionErrors (predicted vs actual from simulations), modelImprovement, uncertaintyReduction, update(), getState(), getHistory(), shouldContinueExploration()
- **SearchController**: main orchestrator, runSearch() implements pseudo-flow:
  ```
  initializeSearch()
  while budgetAvailable:
    candidates = generator.generate()
    candidates = structuralFilter()
    predictions = predictorRegistry.predict()
    candidates = constraintEngine.filter()
    candidates = safetyEngine.evaluate()
    selected = selectionStrategy.select() (score + uncertaintyWeight)
    expensiveResults = simulationEngine.evaluate(selected)
    scores = scoringEngine.score()
    searchState.update()
    activeLearning.update()
    checkpointManager.createCheckpoint()
    if stoppingCriteria: break
  return finalCandidates
  ```
  Supports maxIterations, maxCandidates, compute budget, time budget, convergence threshold, min improvement, diversity threshold, uncertainty threshold, explorationRate, diversityWeight, uncertaintyWeight, performanceWeight
- **resumeFromCheckpoint**: restores state and continues

### Tool Registry & Agent (`toolRegistry.ts`)
- **ToolRegistry**: register(), get(), list(), call() with provenance, runtimeMs, status
- **Default tools**: chemistry.goal.parse, chemistry.spec.build, chemistry.design.generate, chemistry.predict, chemistry.constraints.evaluate, chemistry.safety.evaluate, chemistry.simulate, chemistry.search.run, chemistry.search.resume, chemistry.candidates.get, chemistry.pareto.get, dynamically discoverable
- **ChemistryAgent**: orchestrates LLM + tools, processGoal(objective) -> { goal, spec, designSpace, searchResult, report }, generateReport() with IMPORTANT STATUS, methodology, provenance, disclaimer, never claims experimental validation, safety blocking, future LLM integration point
- Architecture: LLM -> Tool Router -> ChemistrySpecification -> SearchController -> Scientific Engines -> Results -> LLM Explanation

### API (`api.ts`)
- **InMemoryChemistryAIAPI**: createGoal(), getGoal(), listGoals(), startSearch(), getSearch(), listSearches(), resumeSearch(), getCandidates(query with minScore, safety, designType, paretoOnly, limit/offset), getCandidate(), getParetoFront(), listModels(), listSimulators(), getCheckpoint(), listCheckpoints(), listTools()
- Minimal persistent storage, in-memory maps, content hash references
- Safety blocking at API level
- Factory createChemistryAISystem() creates complete system with mock engines

## Testing (`__tests__/chemistryAI.test.ts` - 47 tests)

- **GoalInterpreter**: parses tensile strength, adhesion/solidification, does not invent numbers, detects explicit targets, represents ambiguity, blocks hazardous, preserves provenance
- **ChemistrySpecification**: builds spec, normalizes weights, serializable, preserves provenance
- **DesignSpace**: creates space for material, representation with hash, candidate with provenance, multiple domains
- **CandidateGenerator**: deterministic, parent tracking, respects budget
- **ConstraintEngine**: evaluates hard constraints, detects violation
- **SafetyEngine**: SAFE classification, blocks hazardous, detects hazardous goal, audit logging
- **PropertyPredictor**: mock warning, multiple properties, deterministic
- **SimulationEngine**: NOT_AVAILABLE for non-mock, available for pipeline, mock warning
- **ScoringEngine**: scores with predictions, Pareto front extraction
- **SearchController**: end-to-end mock engines, hierarchical filtering configurable, checkpointing
- **ActiveLearning**: tracks prediction errors
- **Determinism**: two runs identical seed -> identical hashes
- **Provenance**: every candidate has provenance, every prediction has provenance & uncertainty
- **API**: creates goal, starts search, lists models/simulators, blocks hazardous
- **End-to-end synthetic**: goal -> spec -> generate -> predict -> filter -> score -> optimize -> checkpoint -> resume -> final report, with disclaimer checks

## Usage

```typescript
import { createChemistryAISystem } from "./lib/chemistry-ai/index.js";

const system = createChemistryAISystem();

// Simple
const report = await system.agent.processGoal("Design a material with extremely high tensile strength");
console.log(report);

// API
const goal = await system.api.createGoal({ objective: "Find a material with rapid solidification and strong adhesion" });
const searchState = await system.api.startSearch({ goalId: goal.goalId, config: { maxIterations: 5, candidatesPerIteration: 100 } });
const candidates = await system.api.getCandidates({ searchId: searchState.searchId, limit: 10 });
const pareto = await system.api.getParetoFront(searchState.searchId);

// Custom search
import { DEFAULT_SEARCH_CONFIG } from "./lib/chemistry-ai/index.js";
const result = await system.searchController.runSearch(goal, spec, space, {
  ...DEFAULT_SEARCH_CONFIG,
  maxIterations: 10,
  candidatesPerIteration: 1000,
  cheapFilterRatio: 0.5, // 10000->5000
  propertyFilterRatio: 0.1, // 5000->500
  simulationRatio: 0.1, // 500->50
  finalCandidateCount: 10,
  explorationRate: 0.3,
});
```

## Safety

- SafetyEngine mandatory before operational instructions
- Classifies SAFE/REVIEW_REQUIRED/RESTRICTED/BLOCKED
- Hazardous patterns: explosive, chemical weapon, nerve agent, toxic gas, illicit drugs, radioactive, etc.
- For BLOCKED: system may continue non-operational analysis but must not produce actionable hazardous synthesis procedures
- Audit logging
- API blocks BLOCKED goals

## Uncertainty & Provenance

- Every candidate: provenance (goalId, parentIds, generationMethod, modelId, engineId, iteration, timestamp, randomSeed, configHash, inputHash, outputHash, version, description, tags)
- Every prediction: uncertainty (value 0-1, confidence, source, breakdown, confidenceInterval), provenance, isMock, warning
- Every simulation: uncertainty, provenance, isMock, status NOT_AVAILABLE if no real engine
- Final report: separates PREDICTED/SIMULATED/OBSERVED/NOT_AVAILABLE, disclaimer, mock warning

## Determinism & Reproducibility

- Mulberry32 deterministic PRNG with seed
- contentHash FNV-1a deterministic
- canonicalStringify sorts keys
- Versioned configs, model versions
- Two runs identical config+seed -> identical baseline results (tested)

## Checkpointing

- Checkpoint contains: search state, candidate references (hashes, not full), model versions, random seed, configuration, hashes, iteration number
- Resumable without restarting from zero
- CheckpointManager

## Extensibility

- DesignSpace: user-defined future domains
- CandidateGenerator: future diffusion-model adapter, domain-specific generator, generative-model adapter interface ready
- PropertyPredictor: PredictorRegistry, custom predictors, modelType mock/ml-surrogate/physics-based/empirical/quantum/md/thermodynamic
- SimulationEngine: adapter for molecular dynamics, quantum chemistry, thermodynamic, reaction prediction, material simulation, custom solvers
- ToolRegistry: dynamically discoverable, future models plugged without changing agent core
- Replaceable plugins: chemistry models/simulators are plugins, not hard-coded

## Limitations (Current MVP - Search Engine First)

- GoalInterpreter is keyword-based deterministic, not LLM (interface ready for LLM)
- Generators are mock deterministic baselines, not real AI (adapters ready for real models)
- Predictors are mock, clearly labeled NOT SCIENTIFICALLY VALIDATED, for pipeline testing only
- Simulation returns NOT_AVAILABLE unless mock test candidate, to avoid fabricating science
- No real chemistry intelligence yet — real models to be plugged progressively after foundation stable
- Do NOT claim real-world chemical discovery accuracy until validated models/data integrated

## Next Steps

- Integrate real LLM for GoalInterpreter (e.g., function calling to parse goals)
- Plug real chemistry models: RDKit, MEGNet, CGCNN, etc. via PropertyPredictor interface
- Plug real simulators: LAMMPS, VASP, Quantum ESPRESSO, etc. via SimulationEngine adapter
- Implement Bayesian optimization with real surrogate (e.g., BoTorch)
- Add diffusion model generator adapter
- Add more design domains: polymer, catalyst, etc. with domain-specific constraints
- Add cost model, experimental data integration
- Add more safety rules, hazardous material database
- Add UI for Chemistry Design Search (new screen)

## Files

- `domain.ts` - Core domain models, hashing, determinism, defaults, disclaimers (600+ lines)
- `goalInterpreter.ts` - GoalInterpreter abstraction (400+ lines)
- `chemistrySpec.ts` - ChemistrySpecification builder (200+ lines)
- `designSpace.ts` - DesignSpace abstraction, candidate factory (300+ lines)
- `generators.ts` - Pluggable CandidateGenerator, 5 strategies + composite (400+ lines)
- `engines.ts` - Constraint, Safety, PredictorRegistry, Simulation, Scoring+Pareto (600+ lines)
- `searchController.ts` - SearchController, SearchStateManager, CandidateMemory, CheckpointManager, ActiveLearning (700+ lines)
- `toolRegistry.ts` - ToolRegistry, ChemistryAgent (500+ lines)
- `api.ts` - API layer, InMemoryChemistryAIAPI (250+ lines)
- `index.ts` - Factory createChemistryAISystem(), exports, demo (200+ lines)
- `demo.ts` - Demo with 4 example goals
- `__tests__/chemistryAI.test.ts` - 47 comprehensive tests

Total: ~4000 lines, 10 files, minimal persistent storage, clean architecture, testable, deterministic, provenance-tracked, safety-enforced
