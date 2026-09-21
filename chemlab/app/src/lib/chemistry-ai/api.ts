/**
 * CHEMISTRY AI — API LAYER
 * Phase 13: API
 * 
 * Exposes REST-like API for chemistry goals, searches, candidates, models, simulators
 * Minimal persistent storage, clean architecture
 */

import {
  ChemistryGoal,
  ChemistrySpecification,
  DesignSpace,
  Candidate,
  SearchState,
  Checkpoint,
  ParetoFront,
  CreateGoalRequest,
  SearchRequest,
  CandidateQuery,
  SearchConfig,
  contentHash,
  DEFAULT_SEARCH_CONFIG,
} from "./domain.js";

import { GoalInterpreter } from "./goalInterpreter.js";
import { ChemistrySpecBuilder } from "./chemistrySpec.js";
import { DesignSpaceFactory, DesignSpaceSelector } from "./designSpace.js";
import { SearchController, CandidateMemory, CheckpointManager } from "./searchController.js";
import { PredictorRegistry, SimulationEngine } from "./engines.js";
import { ToolRegistry } from "./toolRegistry.js";

export interface ChemistryAIAPI {
  // Goals
  createGoal(request: CreateGoalRequest): Promise<ChemistryGoal>;
  getGoal(goalId: string): Promise<ChemistryGoal | undefined>;
  listGoals(): Promise<ChemistryGoal[]>;

  // Search
  startSearch(request: SearchRequest): Promise<SearchState>;
  getSearch(searchId: string): Promise<SearchState | undefined>;
  listSearches(): Promise<SearchState[]>;
  resumeSearch(searchId: string, checkpointId?: string): Promise<SearchState>;

  // Candidates
  getCandidates(query: CandidateQuery): Promise<Candidate[]>;
  getCandidate(candidateId: string): Promise<Candidate | undefined>;
  getParetoFront(searchId: string): Promise<ParetoFront | undefined>;

  // Models & Simulators
  listModels(): Promise<Array<{ modelId: string; property: string; version: string; isMock: boolean }>>;
  listSimulators(): Promise<Array<{ engineId: string; version: string; type: string; isAvailable: boolean; isMock: boolean }>>;

  // Checkpoints
  getCheckpoint(checkpointId: string): Promise<Checkpoint | undefined>;
  listCheckpoints(searchId: string): Promise<Checkpoint[]>;

  // Tools
  listTools(): Promise<ReturnType<ToolRegistry["list"]>>;
}

export class InMemoryChemistryAIAPI implements ChemistryAIAPI {
  private goals: Map<string, ChemistryGoal> = new Map();
  private specs: Map<string, ChemistrySpecification> = new Map();
  private spaces: Map<string, DesignSpace> = new Map();
  private searches: Map<string, SearchState> = new Map();
  private searchResults: Map<string, { candidates: Candidate[]; paretoFront: ParetoFront }> = new Map();

  constructor(
    private goalInterpreter: GoalInterpreter,
    private specBuilder: ChemistrySpecBuilder,
    private _spaceFactory: DesignSpaceFactory,
    private spaceSelector: DesignSpaceSelector,
    private searchController: SearchController,
    private candidateMemory: CandidateMemory,
    private checkpointManager: CheckpointManager,
    private predictorRegistry: PredictorRegistry,
    private simulationEngine: SimulationEngine,
    private toolRegistry: ToolRegistry
  ) {
    // _spaceFactory kept for future extensibility and to satisfy interface
    void this._spaceFactory;
  }

  async createGoal(request: CreateGoalRequest): Promise<ChemistryGoal> {
    const goal = await this.goalInterpreter.parse(request.objective, {
      designType: request.designType as any,
      exclusions: request.exclusions,
      environment: request.environment,
      safetyLevel: request.safetyLevel as any,
      evaluationBudget: request.evaluationBudget,
    });

    // Handle additional constraints from request
    if (request.constraints) {
      for (const c of request.constraints) {
        goal.constraints.push({
          id: `constraint_${contentHash(c).slice(0, 8)}`,
          property: c.property,
          type: (c.type as any) || "HARD",
          operator: c.operator as any,
          value: c.value,
          description: `Constraint from API request: ${c.property} ${c.operator} ${c.value}`,
          provenance: "api:createGoal",
        });
      }
    }

    this.goals.set(goal.goalId, goal);
    return goal;
  }

  async getGoal(goalId: string): Promise<ChemistryGoal | undefined> {
    return this.goals.get(goalId);
  }

  async listGoals(): Promise<ChemistryGoal[]> {
    return Array.from(this.goals.values());
  }

  async startSearch(request: SearchRequest): Promise<SearchState> {
    const goal = this.goals.get(request.goalId);
    if (!goal) throw new Error(`Goal not found: ${request.goalId}`);

    if (goal.safetyLevel === "BLOCKED") {
      throw new Error(`Goal ${goal.goalId} is BLOCKED by safety layer, cannot start search`);
    }

    const spec = await this.specBuilder.build(goal);
    this.specs.set(spec.specId, spec);

    const designSpace = this.spaceSelector.selectForGoal(goal.designType);
    this.spaces.set(designSpace.spaceId, designSpace);

    const searchConfig: SearchConfig = {
      ...DEFAULT_SEARCH_CONFIG,
      ...request.config,
    };

    const result = await this.searchController.runSearch(goal, spec, designSpace, searchConfig);

    this.searches.set(result.searchState.searchId, result.searchState);
    this.searchResults.set(result.searchState.searchId, {
      candidates: result.finalCandidates,
      paretoFront: result.paretoFront,
    });

    return result.searchState;
  }

  async getSearch(searchId: string): Promise<SearchState | undefined> {
    return this.searches.get(searchId);
  }

  async listSearches(): Promise<SearchState[]> {
    return Array.from(this.searches.values());
  }

  async resumeSearch(searchId: string, checkpointId?: string): Promise<SearchState> {
    const checkpoint = checkpointId
      ? this.checkpointManager.getCheckpoint(checkpointId)
      : this.checkpointManager.getLatestCheckpoint(searchId);

    if (!checkpoint) throw new Error(`No checkpoint found for search ${searchId}`);

    const searchState = this.searches.get(searchId);
    if (!searchState) throw new Error(`Search not found: ${searchId}`);

    const goal = this.goals.get(searchState.goalId);
    if (!goal) throw new Error(`Goal not found for search ${searchId}`);

    const spec = this.specs.get(searchState.specId) || await this.specBuilder.build(goal);
    const designSpace = this.spaces.get(checkpoint.searchState.specId) || this.spaceSelector.selectForGoal(goal.designType);

    const result = await this.searchController.resumeFromCheckpoint(checkpoint, goal, spec, designSpace);

    this.searches.set(result.searchState.searchId, result.searchState);
    this.searchResults.set(result.searchState.searchId, {
      candidates: result.finalCandidates,
      paretoFront: result.paretoFront,
    });

    return result.searchState;
  }

  async getCandidates(query: CandidateQuery): Promise<Candidate[]> {
    let candidates: Candidate[] = [];

    if (query.searchId) {
      const result = this.searchResults.get(query.searchId);
      if (result) candidates = result.candidates;
    } else {
      candidates = this.candidateMemory.list();
    }

    // Apply filters
    if (query.minScore !== undefined) {
      candidates = candidates.filter(c => (c.score || 0) >= query.minScore!);
    }

    if (query.safetyClassification && query.safetyClassification.length > 0) {
      candidates = candidates.filter(c => query.safetyClassification!.includes(c.safetyClassification));
    }

    if (query.designType) {
      candidates = candidates.filter(c => c.designType === query.designType);
    }

    if (query.paretoOnly) {
      candidates = candidates.filter(c => c.paretoRank === 1);
    }

    // Sort by score descending
    candidates.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Pagination
    const offset = query.offset || 0;
    const limit = query.limit || 50;

    return candidates.slice(offset, offset + limit);
  }

  async getCandidate(candidateId: string): Promise<Candidate | undefined> {
    return this.candidateMemory.get(candidateId);
  }

  async getParetoFront(searchId: string): Promise<ParetoFront | undefined> {
    const result = this.searchResults.get(searchId);
    return result?.paretoFront;
  }

  async listModels(): Promise<Array<{ modelId: string; property: string; version: string; isMock: boolean }>> {
    return this.predictorRegistry.list().map(p => ({
      modelId: p.modelId,
      property: p.property,
      version: p.modelVersion,
      isMock: p.isMock,
    }));
  }

  async listSimulators(): Promise<Array<{ engineId: string; version: string; type: string; isAvailable: boolean; isMock: boolean }>> {
    return [
      {
        engineId: this.simulationEngine.engineId,
        version: this.simulationEngine.engineVersion,
        type: this.simulationEngine.engineType,
        isAvailable: this.simulationEngine.isAvailable(),
        isMock: this.simulationEngine.isMock,
      },
    ];
  }

  async getCheckpoint(checkpointId: string): Promise<Checkpoint | undefined> {
    return this.checkpointManager.getCheckpoint(checkpointId);
  }

  async listCheckpoints(searchId: string): Promise<Checkpoint[]> {
    return this.checkpointManager.listCheckpoints(searchId);
  }

  async listTools(): Promise<ReturnType<ToolRegistry["list"]>> {
    return this.toolRegistry.list();
  }
}

// Factory to create API with default mock engines - now uses index factory
export async function createChemistryAIAPIFromSystem(): Promise<{
  api: ChemistryAIAPI;
}> {
  // Dynamic import to avoid circular
  const { createChemistryAISystem } = await import("./index.js");
  const system = createChemistryAISystem();
  return { api: system.api };
}
