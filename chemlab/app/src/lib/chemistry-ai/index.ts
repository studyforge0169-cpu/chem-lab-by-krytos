/**
 * CHEMISTRY AI — MAIN EXPORT
 * Complete pipeline infrastructure with mock/placeholder scientific engines
 * 
 * Architecture: USER GOAL -> GOAL INTERPRETER -> CHEM SPEC -> DESIGN SPACE -> GENERATOR -> PREDICTORS -> SAFETY/CONSTRAINT -> SIMULATION -> SCORING -> SEARCH -> ACTIVE LEARNING -> FINAL CANDIDATES -> REPORT
 * 
 * This is the SEARCH ENGINE FIRST milestone - real chemistry models plugged in progressively
 */

// Domain
export * from "./domain.js";

// Goal Interpreter
export * from "./goalInterpreter.js";

// Chemistry Specification
export * from "./chemistrySpec.js";

// Design Space
export * from "./designSpace.js";

// Generators
export * from "./generators.js";

// Engines (Constraint, Safety, Predictors, Simulation, Scoring)
export * from "./engines.js";

// Search Controller
export * from "./searchController.js";

// Tool Registry & Agent
export * from "./toolRegistry.js";

// API
export * from "./api.js";

// Factory to create complete system
import { DeterministicGoalInterpreter, createGoalInterpreter } from "./goalInterpreter.js";
import { DeterministicChemistrySpecBuilder, createChemistrySpecBuilder } from "./chemistrySpec.js";
import { DeterministicDesignSpaceFactory, DesignSpaceSelector, DeterministicCandidateFactory } from "./designSpace.js";
import { createCompositeGenerator, createCandidateGenerator } from "./generators.js";
import {
  DeterministicConstraintEngine,
  DeterministicSafetyEngine,
  DeterministicScoringEngine,
  PredictorRegistry,
  MockSimulationEngine,
} from "./engines.js";
import {
  SearchStateManager,
  CandidateMemory,
  CheckpointManager,
  ActiveLearningController,
  SearchController,
} from "./searchController.js";
import { ToolRegistry, ChemistryAgent } from "./toolRegistry.js";
import { InMemoryChemistryAIAPI } from "./api.js";
import { DEFAULT_SEARCH_CONFIG } from "./domain.js";

export interface ChemistryAISystem {
  goalInterpreter: DeterministicGoalInterpreter;
  specBuilder: DeterministicChemistrySpecBuilder;
  spaceFactory: DeterministicDesignSpaceFactory;
  spaceSelector: DesignSpaceSelector;
  candidateFactory: DeterministicCandidateFactory;
  generator: ReturnType<typeof createCompositeGenerator>;
  predictorRegistry: PredictorRegistry;
  constraintEngine: DeterministicConstraintEngine;
  safetyEngine: DeterministicSafetyEngine;
  scoringEngine: DeterministicScoringEngine;
  simulationEngine: MockSimulationEngine;
  searchStateManager: SearchStateManager;
  candidateMemory: CandidateMemory;
  checkpointManager: CheckpointManager;
  activeLearningController: ActiveLearningController;
  searchController: SearchController;
  toolRegistry: ToolRegistry;
  agent: ChemistryAgent;
  api: InMemoryChemistryAIAPI;
}

export function createChemistryAISystem(): ChemistryAISystem {
  const goalInterpreter = new DeterministicGoalInterpreter(42);
  const specBuilder = new DeterministicChemistrySpecBuilder();
  const spaceFactory = new DeterministicDesignSpaceFactory();
  const spaceSelector = new DesignSpaceSelector(spaceFactory);
  const candidateFactory = new DeterministicCandidateFactory();
  const generator = createCompositeGenerator();
  const predictorRegistry = PredictorRegistry.createMockRegistry([
    "tensile_strength",
    "adhesion",
    "solidification_rate",
    "solubility",
    "melting_point",
    "density",
    "general_performance",
    "hardness",
    "elastic_modulus",
    "thermal_conductivity",
  ]);
  const constraintEngine = new DeterministicConstraintEngine();
  const safetyEngine = new DeterministicSafetyEngine();
  const scoringEngine = new DeterministicScoringEngine();
  const simulationEngine = new MockSimulationEngine();
  const searchStateManager = new SearchStateManager();
  const candidateMemory = new CandidateMemory();
  const checkpointManager = new CheckpointManager();
  const activeLearningController = new ActiveLearningController();

  const searchController = new SearchController({
    generator,
    predictorRegistry,
    constraintEngine,
    safetyEngine,
    scoringEngine,
    simulationEngine,
    searchStateManager,
    candidateMemory,
    checkpointManager,
    activeLearningController,
  });

  const toolRegistry = ToolRegistry.createDefaultRegistry(
    goalInterpreter,
    specBuilder,
    spaceFactory,
    spaceSelector,
    generator,
    predictorRegistry,
    constraintEngine,
    safetyEngine,
    scoringEngine,
    simulationEngine,
    searchController
  );

  const agent = new ChemistryAgent({
    goalInterpreter,
    specBuilder,
    spaceFactory,
    spaceSelector,
    toolRegistry,
    searchController,
  });

  const api = new InMemoryChemistryAIAPI(
    goalInterpreter,
    specBuilder,
    spaceFactory,
    spaceSelector,
    searchController,
    candidateMemory,
    checkpointManager,
    predictorRegistry,
    simulationEngine,
    toolRegistry
  );

  return {
    goalInterpreter,
    specBuilder,
    spaceFactory,
    spaceSelector,
    candidateFactory,
    generator,
    predictorRegistry,
    constraintEngine,
    safetyEngine,
    scoringEngine,
    simulationEngine,
    searchStateManager,
    candidateMemory,
    checkpointManager,
    activeLearningController,
    searchController,
    toolRegistry,
    agent,
    api,
  };
}

// Quick test/demo
export async function runDemoGoal(objective: string): Promise<string> {
  const system = createChemistryAISystem();
  try {
    const result = await system.agent.processGoal(objective);
    return result.report;
  } catch (error) {
    return `Error processing goal: ${error}`;
  }
}

// Export version and disclaimer
export const CHEMISTRY_AI_VERSION = "1.0.0-mvp-search-engine-first";
export const CHEMISTRY_AI_DISCLAIMER = `
CHEMISTRY AI v${CHEMISTRY_AI_VERSION}
SEARCH ENGINE FIRST MILESTONE

This system implements the complete pipeline infrastructure with mock/placeholder scientific engines.
- Deterministic, reproducible, provenance-tracked, uncertainty-aware
- Safety layer mandatory
- Mock predictors clearly labeled as NOT SCIENTIFICALLY VALIDATED
- Simulation returns NOT_AVAILABLE when no real engine installed
- Never presents computational predictions as experimentally validated facts
- Real chemistry models/simulators are replaceable plugins to be integrated progressively

Architecture ready for:
- Molecular dynamics, quantum chemistry, thermodynamic, reaction prediction, material simulation
- Real ML surrogate models
- Diffusion models, generative models
- Custom scientific solvers
`;

export { DEFAULT_SEARCH_CONFIG };
export { createGoalInterpreter, createChemistrySpecBuilder, createCandidateGenerator };
