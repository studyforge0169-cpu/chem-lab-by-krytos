/**
 * CHEMISTRY AI — TOOL REGISTRY & CHEMISTRY AGENT
 * Phase 23: Agent/LLM Layer, Phase 24: Tool Registry
 * 
 * LLM is responsible for understanding intent, translating to structured goals,
 * selecting design domains, explaining results. NOT the numerical simulator.
 * 
 * Architecture: LLM -> Tool Router -> ChemistrySpecification -> SearchController -> Scientific Engines -> Results -> LLM Explanation
 */

import {
  ToolDefinition,
  ToolCall,
  ChemistryGoal,
  ChemistrySpecification,
  DesignSpace,
  Candidate,
  SearchState,
  ParetoFront,
  contentHash,
  createProvenance,
} from "./domain.js";

import { GoalInterpreter } from "./goalInterpreter.js";
import { ChemistrySpecBuilder } from "./chemistrySpec.js";
import { DesignSpaceFactory, DesignSpaceSelector } from "./designSpace.js";
import { CandidateGenerator } from "./generators.js";
import { PredictorRegistry, SimulationEngine, ConstraintEngine, SafetyEngine, ScoringEngine } from "./engines.js";
import { SearchController } from "./searchController.js";

// ============================================================================
// TOOL REGISTRY
// ============================================================================

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private handlers: Map<string, (input: Record<string, unknown>) => Promise<Record<string, unknown>>> = new Map();

  register(tool: ToolDefinition, handler: (input: Record<string, unknown>) => Promise<Record<string, unknown>>): void {
    this.tools.set(tool.toolId, tool);
    this.handlers.set(tool.toolId, handler);
  }

  get(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async call(toolId: string, input: Record<string, unknown>): Promise<ToolCall> {
    const tool = this.tools.get(toolId);
    if (!tool) throw new Error(`Tool not found: ${toolId}`);

    const handler = this.handlers.get(toolId);
    if (!handler) throw new Error(`No handler for tool: ${toolId}`);

    const callId = `toolcall_${toolId}_${contentHash({ input, ts: Date.now() }).slice(0, 8)}_${Date.now()}`;
    const start = Date.now();

    const provenance = createProvenance({
      description: `Tool call ${toolId}`,
      iteration: 0,
      randomSeed: 42,
      inputHash: contentHash(input),
      configHash: contentHash(tool),
      tags: ["tool-call", toolId],
    });

    try {
      const output = await handler(input);
      const runtimeMs = Date.now() - start;

      return {
        callId,
        toolId,
        input,
        output,
        status: "SUCCESS",
        timestamp: new Date().toISOString(),
        runtimeMs,
        provenance,
      };
    } catch (error) {
      const runtimeMs = Date.now() - start;
      return {
        callId,
        toolId,
        input,
        output: { error: String(error) },
        status: "FAILED",
        timestamp: new Date().toISOString(),
        runtimeMs,
        provenance,
      };
    }
  }

  // Create default registry with chemistry tools
  static createDefaultRegistry(
    goalInterpreter: GoalInterpreter,
    specBuilder: ChemistrySpecBuilder,
    _spaceFactory: DesignSpaceFactory,
    _spaceSelector: DesignSpaceSelector,
    _generator: CandidateGenerator,
    predictorRegistry: PredictorRegistry,
    constraintEngine: ConstraintEngine,
    safetyEngine: SafetyEngine,
    _scoringEngine: ScoringEngine,
    simulationEngine: SimulationEngine,
    searchController: SearchController
  ): ToolRegistry {
    const registry = new ToolRegistry();
    void _spaceFactory;
    void _spaceSelector;
    void _generator;
    void _scoringEngine;

    // chemistry.goal.parse
    registry.register(
      {
        toolId: "chemistry.goal.parse",
        name: "Parse Chemistry Goal",
        description: "Parse natural language objective into structured ChemistryGoal",
        inputSchema: { objective: "string", designType: "string?" },
        outputSchema: { goal: "ChemistryGoal" },
        version: "1.0.0",
        isMock: false,
      },
      async (input) => {
        const objective = input.objective as string;
        const goal = await goalInterpreter.parse(objective, {
          designType: input.designType as any,
        });
        return { goal };
      }
    );

    // chemistry.spec.build
    registry.register(
      {
        toolId: "chemistry.spec.build",
        name: "Build Chemistry Specification",
        description: "Convert ChemistryGoal into normalized ChemistrySpecification",
        inputSchema: { goal: "ChemistryGoal" },
        outputSchema: { specification: "ChemistrySpecification" },
        version: "1.0.0",
        isMock: false,
      },
      async (input) => {
        const goal = input.goal as ChemistryGoal;
        const spec = await specBuilder.build(goal);
        return { specification: spec.toJSON() };
      }
    );

    // chemistry.design.generate
    registry.register(
      {
        toolId: "chemistry.design.generate",
        name: "Generate Candidates",
        description: "Generate candidate designs from specification and design space",
        inputSchema: { specification: "ChemistrySpecification", designSpace: "DesignSpace", budget: "number" },
        outputSchema: { candidates: "Candidate[]" },
        version: "1.0.0",
        isMock: true,
      },
      async (_input) => {
        // Mock implementation for tool registry
        void _input;
        return { candidates: [], warning: "Use SearchController for full generation pipeline" };
      }
    );

    // chemistry.predict
    registry.register(
      {
        toolId: "chemistry.predict",
        name: "Predict Properties",
        description: "Predict properties for candidates using registered predictors",
        inputSchema: { candidate: "Candidate", properties: "string[]" },
        outputSchema: { predictions: "PredictionResult[]" },
        version: "1.0.0",
        isMock: true,
      },
      async (input) => {
        const candidate = input.candidate as Candidate;
        const properties = input.properties as string[];
        const predictions = await predictorRegistry.predict(candidate, properties);
        return { predictions };
      }
    );

    // chemistry.constraints.evaluate
    registry.register(
      {
        toolId: "chemistry.constraints.evaluate",
        name: "Evaluate Constraints",
        description: "Evaluate candidates against constraints",
        inputSchema: { candidate: "Candidate", specification: "ChemistrySpecification" },
        outputSchema: { constraintResult: "ConstraintResult" },
        version: "1.0.0",
        isMock: false,
      },
      async (input) => {
        const candidate = input.candidate as Candidate;
        const spec = input.specification as ChemistrySpecification;
        const result = await constraintEngine.evaluate(candidate, spec);
        return { constraintResult: result };
      }
    );

    // chemistry.safety.evaluate
    registry.register(
      {
        toolId: "chemistry.safety.evaluate",
        name: "Evaluate Safety",
        description: "Classify candidate safety, mandatory before operational instructions",
        inputSchema: { candidate: "Candidate" },
        outputSchema: { safetyResult: "SafetyResult" },
        version: "1.0.0",
        isMock: false,
      },
      async (input) => {
        const candidate = input.candidate as Candidate;
        const result = await safetyEngine.evaluate(candidate);
        return { safetyResult: result };
      }
    );

    // chemistry.simulate
    registry.register(
      {
        toolId: "chemistry.simulate",
        name: "Simulate Candidate",
        description: "Run expensive simulation (MD, quantum, etc.) - adapter for real engines",
        inputSchema: { candidate: "Candidate", properties: "string[]" },
        outputSchema: { simulationResult: "SimulationResult" },
        version: "1.0.0",
        isMock: true,
      },
      async (input) => {
        const candidate = input.candidate as Candidate;
        const properties = (input.properties as string[]) || [];
        
        if (!simulationEngine.isAvailable()) {
          return {
            simulationResult: {
              status: "NOT_AVAILABLE",
              warning: "No real simulation engine installed, returning NOT_AVAILABLE rather than inventing results",
            },
          };
        }

        const request = {
          requestId: `req_${candidate.candidateId}_${Date.now()}`,
          candidateId: candidate.candidateId,
          candidateHash: candidate.contentHash,
          properties,
          engineId: simulationEngine.engineId,
          parameters: {},
          priority: 1,
          createdAt: new Date().toISOString(),
          provenance: createProvenance({
            description: `Simulation request for ${candidate.candidateId}`,
            iteration: 0,
            randomSeed: 42,
            inputHash: candidate.contentHash,
            configHash: contentHash({ engine: simulationEngine.engineId }),
            tags: ["simulation-request"],
          }),
        };

        const result = await simulationEngine.simulate(request);
        return { simulationResult: result };
      }
    );

    // chemistry.search.run
    registry.register(
      {
        toolId: "chemistry.search.run",
        name: "Run Chemistry Search",
        description: "Run full computational chemistry design search pipeline",
        inputSchema: { goal: "ChemistryGoal", specification: "ChemistrySpecification", designSpace: "DesignSpace" },
        outputSchema: { finalCandidates: "Candidate[]", searchState: "SearchState", paretoFront: "ParetoFront" },
        version: "1.0.0",
        isMock: false,
      },
      async (input) => {
        const goal = input.goal as ChemistryGoal;
        const _spec = input.specification as ChemistrySpecification;
        void _spec;
        const space = input.designSpace as DesignSpace;

        // Reconstruct spec with toJSON method if needed
        const fullSpec = specBuilder.buildSync(goal);

        const result = await searchController.runSearch(goal, fullSpec, space);
        return {
          finalCandidates: result.finalCandidates,
          searchState: result.searchState,
          paretoFront: result.paretoFront,
          checkpoints: result.checkpoints.length,
        };
      }
    );

    // chemistry.search.resume
    registry.register(
      {
        toolId: "chemistry.search.resume",
        name: "Resume Search",
        description: "Resume a checkpointed search",
        inputSchema: { checkpointId: "string" },
        outputSchema: { searchState: "SearchState" },
        version: "1.0.0",
        isMock: false,
      },
      async (input) => {
        return { message: "Resume functionality requires checkpoint manager", checkpointId: input.checkpointId };
      }
    );

    // chemistry.candidates.get
    registry.register(
      {
        toolId: "chemistry.candidates.get",
        name: "Get Candidate",
        description: "Get candidate details by ID",
        inputSchema: { candidateId: "string" },
        outputSchema: { candidate: "Candidate" },
        version: "1.0.0",
        isMock: false,
      },
      async (input) => {
        return { candidateId: input.candidateId, message: "Requires candidate memory" };
      }
    );

    // chemistry.pareto.get
    registry.register(
      {
        toolId: "chemistry.pareto.get",
        name: "Get Pareto Front",
        description: "Get Pareto-optimal candidates",
        inputSchema: { searchId: "string" },
        outputSchema: { paretoFront: "ParetoFront" },
        version: "1.0.0",
        isMock: false,
      },
      async (input) => {
        return { searchId: input.searchId, message: "Requires search state" };
      }
    );

    return registry;
  }
}

// ============================================================================
// CHEMISTRY AGENT - ORCHESTRATES LLM + TOOLS
// ============================================================================

export interface ChemistryAgentConfig {
  goalInterpreter: GoalInterpreter;
  specBuilder: ChemistrySpecBuilder;
  spaceFactory: DesignSpaceFactory;
  spaceSelector: DesignSpaceSelector;
  toolRegistry: ToolRegistry;
  searchController: SearchController;
}

export class ChemistryAgent {
  private config: ChemistryAgentConfig;

  constructor(config: ChemistryAgentConfig) {
    this.config = config;
  }

  // Main entry: user objective -> final report
  async processGoal(objective: string): Promise<{
    goal: ChemistryGoal;
    specification: ChemistrySpecification;
    designSpace: DesignSpace;
    searchResult: { finalCandidates: Candidate[]; searchState: SearchState; paretoFront: ParetoFront };
    report: string;
  }> {
    console.log(`[ChemistryAgent] Processing goal: "${objective.slice(0, 100)}"`);

    // 1. Parse goal (LLM would do this, here deterministic)
    const goal = await this.config.goalInterpreter.parse(objective);
    console.log(`[ChemistryAgent] Parsed goal ${goal.goalId}: ${goal.targetProperties.length} targets, safety ${goal.safetyLevel}`);

    // Safety check on goal
    if (goal.safetyLevel === "BLOCKED") {
      throw new Error(`Goal BLOCKED by safety layer: ${goal.objective}. Hazardous objective detected. No operational instructions will be provided.`);
    }

    // 2. Build specification
    const specification = await this.config.specBuilder.build(goal);
    console.log(`[ChemistryAgent] Built spec ${specification.specId}: ${specification.propertyTargets.length} property targets`);

    // 3. Select design space
    const designSpace = this.config.spaceSelector.selectForGoal(goal.designType);
    console.log(`[ChemistryAgent] Selected design space ${designSpace.spaceId} for domain ${designSpace.domain}`);

    // 4. Run search
    const searchResult = await this.config.searchController.runSearch(goal, specification, designSpace);
    console.log(`[ChemistryAgent] Search complete: ${searchResult.finalCandidates.length} final candidates`);

    // 5. Generate report (LLM would explain, here deterministic)
    const report = this.generateReport(goal, specification, searchResult);

    return {
      goal,
      specification,
      designSpace,
      searchResult,
      report,
    };
  }

  private generateReport(
    goal: ChemistryGoal,
    spec: ChemistrySpecification,
    searchResult: { finalCandidates: Candidate[]; searchState: SearchState; paretoFront: ParetoFront }
  ): string {
    const { finalCandidates, searchState, paretoFront } = searchResult;

    let report = `
CHEMISTRY DESIGN SEARCH REPORT
==============================

Goal: ${goal.objective}
Goal ID: ${goal.goalId}
Safety: ${goal.safetyLevel}
Design Type: ${goal.designType}

Specification ID: ${spec.specId}
Property Targets:
${spec.propertyTargets.map(pt => `  - ${pt.property}: ${pt.direction} (weight ${pt.weight.toFixed(2)}, confidence ${pt.confidence.toFixed(2)}) target=${JSON.stringify(pt.target)}`).join("\n")}

Constraints: ${spec.constraints.length}
Exclusions: ${spec.exclusions.join(", ") || "none"}

Search ID: ${searchState.searchId}
Iterations: ${searchState.iteration}
Candidates Generated: ${searchState.budgetConsumption.candidatesGenerated}
Candidates Evaluated: ${searchState.budgetConsumption.candidatesEvaluated}
Termination: ${searchState.terminationReason || "completed"}

Top Computational Candidates (${finalCandidates.length}):
`;

    for (let i = 0; i < finalCandidates.length; i++) {
      const cand = finalCandidates[i];
      report += `
Candidate ${i + 1} (Rank ${i + 1}):
  ID: ${cand.candidateId}
  Representation: ${cand.representation.canonicalValue.slice(0, 100)} (${cand.representation.format})
  Design Type: ${cand.designType}
  Generation Method: ${cand.generationMethod}
  Score: ${(cand.score || 0).toFixed(4)} (highest predicted score)
  Safety: ${cand.safetyClassification}
  Uncertainty: ${cand.uncertainty.value.toFixed(3)} (confidence ${(cand.uncertainty.confidence * 100).toFixed(1)}%)
  Parent Candidates: ${cand.parentCandidates.join(", ") || "none (initial generation)"}
  Generation Iteration: ${cand.generationIteration}
  Predicted Properties:
${cand.predictions.map(p => `    - ${p.property}: ${p.predictedValue} ${p.unit || ""} (confidence ${(p.confidence * 100).toFixed(1)}%, ${p.isMock ? "MOCK - NOT VALIDATED" : "model " + p.modelId})`).join("\n")}
  Provenance: ${cand.provenance.description}
  Disclaimer: Computational prediction only, requires experimental validation
`;
    }

    report += `
Pareto Front (${paretoFront.candidates.length} candidates):
  Objectives: ${paretoFront.objectives.join(", ")}
  Candidates: ${paretoFront.candidates.join(", ")}
  Dominated: ${paretoFront.dominatedCount}

IMPORTANT STATUS:
  Predictions: COMPUTATIONAL PREDICTIONS ONLY - NOT EXPERIMENTALLY VALIDATED
  Simulations: ${searchState.budgetConsumption.simulationsRun > 0 ? `${searchState.budgetConsumption.simulationsRun} simulations run (mock engines)` : "No real simulators - mock returned NOT_AVAILABLE where appropriate"}
  Experimental Validation: NOT_PERFORMED
  Mock Warning: This search used MOCK PREDICTORS clearly labeled as NOT SCIENTIFICALLY VALIDATED - for pipeline testing only. Real chemistry models must be plugged in for scientific accuracy.

Methodology:
  - Goal Interpreter: Deterministic keyword-based (future: LLM)
  - Design Space: ${spec.designDomain}
  - Generators: Random, Fragment, Evolutionary, Bayesian (mock deterministic)
  - Predictors: Mock predictors (clearly labeled)
  - Safety: Mandatory filtering, ${goal.safetyLevel}
  - Scoring: Multi-objective weighted, Pareto extraction
  - Search: Hierarchical filtering 10000->5000->500->50->10 configurable

Provenance:
  - Goal: ${goal.provenance.recordId}
  - Spec: ${spec.provenance.recordId}
  - Search: ${searchState.provenance.recordId}
  - Random Seed: ${searchState.randomSeed} (deterministic, reproducible)

Disclaimer:
  ${goal.safetyLevel === "BLOCKED" ? "GOAL BLOCKED - No operational chemistry instructions provided" : "This is a computational design engine. Candidates are computationally promising but require laboratory validation. Never treat as experimentally proven. Hazardous chemistry blocked by safety layer."}

Generated: ${new Date().toISOString()}
`;

    return report;
  }

  // Explain results (LLM layer would do this)
  async explainResults(searchResult: { finalCandidates: Candidate[]; searchState: SearchState }): Promise<string> {
    return this.generateReport(
      { objective: "Explain results", goalId: "explain", targetProperties: [], constraints: [], designType: "material", exclusions: [], safetyLevel: "SAFE", ambiguityFlags: [], rawInput: "", createdAt: new Date().toISOString(), version: "1.0.0", provenance: createProvenance({ description: "explain", iteration: 0, randomSeed: 0, inputHash: "", configHash: "", tags: [] }), parsedObjective: "" } as ChemistryGoal,
      { specId: "explain", goalId: "explain", description: "explain", propertyTargets: [], constraints: [], designDomain: "material", exclusions: [], safetyLevel: "SAFE", evaluationBudget: { maxIterations: 1, maxCandidates: 1, maxTimeMs: 1, computeBudget: "low" }, uncertaintyRequirements: {}, weights: {}, createdAt: new Date().toISOString(), version: "1.0.0", provenance: createProvenance({ description: "explain", iteration: 0, randomSeed: 0, inputHash: "", configHash: "", tags: [] }), rawGoal: null as any, toJSON: () => ({}) } as ChemistrySpecification,
      searchResult as any
    );
  }
}
