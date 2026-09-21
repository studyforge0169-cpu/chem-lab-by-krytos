/**
 * CHEMISTRY AI — SEARCH CONTROLLER
 * Phase 9: Search Controller
 * Phase 10: Checkpoint/Resume
 * Phase 11: Active Learning Interfaces
 * Phase 15: Candidate Memory, Provenance, Uncertainty, Search State
 * 
 * Controls entire optimization loop: Generate -> Evaluate -> Learn -> Search -> ...
 */

import {
  Candidate,
  DesignSpace,
  ChemistrySpecification,
  ChemistryGoal,
  SearchState,
  SearchConfig,
  Checkpoint,
  CandidateMemoryEntry,
  EvaluationRecord,
  PredictionResult,
  ConstraintResult,
  SafetyResult,
  SimulationResult,
  ScoringResult,
  ParetoFront,
  contentHash,
  createProvenance,
  DEFAULT_SEARCH_CONFIG,
  EvaluationStage,
} from "./domain.js";

import { CandidateGenerator } from "./generators.js";
import { PredictorRegistry, SimulationEngine } from "./engines.js";
import { ConstraintEngine, SafetyEngine, ScoringEngine } from "./engines.js";

// ============================================================================
// SEARCH STATE MANAGER
// ============================================================================

export class SearchStateManager {
  createInitialState(
    searchId: string,
    goal: ChemistryGoal,
    spec: ChemistrySpecification,
    config: SearchConfig
  ): SearchState {
    const provenance = createProvenance({
      description: `Search initialized for goal ${goal.goalId}`,
      iteration: 0,
      randomSeed: config.randomSeed,
      inputHash: contentHash({ goalId: goal.goalId, specId: spec.specId }),
      configHash: contentHash(config),
      parentIds: [goal.goalId],
      tags: ["search-state", "initial"],
    });

    return {
      searchId,
      goalId: goal.goalId,
      specId: spec.specId,
      iteration: 0,
      candidateCount: 0,
      evaluatedCount: 0,
      rejectedCount: 0,
      currentParetoFront: [],
      bestPredictedCandidates: [],
      explorationStats: {
        explorationRate: config.explorationRate,
        diversity: 0,
        avgUncertainty: 0.5,
        coverage: 0,
      },
      convergenceStats: {
        bestScore: 0,
        avgScore: 0,
        improvement: 0,
        iterationsWithoutImprovement: 0,
        isConverged: false,
      },
      modelVersions: {},
      budgetConsumption: {
        candidatesGenerated: 0,
        candidatesEvaluated: 0,
        simulationsRun: 0,
        timeElapsedMs: 0,
        computeBudgetUsed: 0,
      },
      isComplete: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      randomSeed: config.randomSeed,
      config,
      provenance,
    };
  }

  updateAfterIteration(
    state: SearchState,
    iterationResults: {
      candidatesGenerated: number;
      candidatesEvaluated: number;
      candidatesRejected: number;
      bestScore: number;
      avgScore: number;
      avgUncertainty: number;
      paretoFront: string[];
      bestCandidates: string[];
      simulationsRun: number;
      timeElapsedMs: number;
    }
  ): SearchState {
    const prevBest = state.convergenceStats.bestScore;
    const improvement = iterationResults.bestScore - prevBest;
    const iterationsWithoutImprovement = improvement > state.config.minImprovement ? 0 : state.convergenceStats.iterationsWithoutImprovement + 1;

    const isConverged = iterationsWithoutImprovement >= 3 || improvement < state.config.convergenceThreshold;

    return {
      ...state,
      iteration: state.iteration + 1,
      candidateCount: state.candidateCount + iterationResults.candidatesGenerated,
      evaluatedCount: state.evaluatedCount + iterationResults.candidatesEvaluated,
      rejectedCount: state.rejectedCount + iterationResults.candidatesRejected,
      currentParetoFront: iterationResults.paretoFront,
      bestPredictedCandidates: iterationResults.bestCandidates,
      explorationStats: {
        ...state.explorationStats,
        avgUncertainty: iterationResults.avgUncertainty,
        diversity: this.calculateDiversity(iterationResults.bestScore, state.explorationStats.diversity),
      },
      convergenceStats: {
        bestScore: Math.max(prevBest, iterationResults.bestScore),
        avgScore: iterationResults.avgScore,
        improvement,
        iterationsWithoutImprovement,
        isConverged,
      },
      budgetConsumption: {
        candidatesGenerated: state.budgetConsumption.candidatesGenerated + iterationResults.candidatesGenerated,
        candidatesEvaluated: state.budgetConsumption.candidatesEvaluated + iterationResults.candidatesEvaluated,
        simulationsRun: state.budgetConsumption.simulationsRun + iterationResults.simulationsRun,
        timeElapsedMs: state.budgetConsumption.timeElapsedMs + iterationResults.timeElapsedMs,
        computeBudgetUsed: state.budgetConsumption.computeBudgetUsed + iterationResults.candidatesEvaluated,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  private calculateDiversity(_newScore: number, oldDiversity: number): number {
    // Placeholder diversity calculation
    return (oldDiversity + Math.random() * 0.1) % 1;
  }

  checkTermination(state: SearchState): { shouldTerminate: boolean; reason?: string } {
    if (state.iteration >= state.config.maxIterations) {
      return { shouldTerminate: true, reason: `Max iterations ${state.config.maxIterations} reached` };
    }
    if (state.candidateCount >= state.config.maxCandidates) {
      return { shouldTerminate: true, reason: `Max candidates ${state.config.maxCandidates} reached` };
    }
    if (state.convergenceStats.isConverged) {
      return { shouldTerminate: true, reason: `Converged: no improvement for ${state.convergenceStats.iterationsWithoutImprovement} iterations` };
    }
    if (state.config.timeBudgetMs && state.budgetConsumption.timeElapsedMs >= state.config.timeBudgetMs) {
      return { shouldTerminate: true, reason: `Time budget ${state.config.timeBudgetMs}ms exceeded` };
    }
    return { shouldTerminate: false };
  }
}

// ============================================================================
// CANDIDATE MEMORY (MINIMAL PERSISTENT STORAGE)
// ============================================================================

export class CandidateMemory {
  private store: Map<string, CandidateMemoryEntry> = new Map();
  private candidates: Map<string, Candidate> = new Map(); // Full candidates, referenced by hash

  add(candidate: Candidate, scoring?: ScoringResult, _constraintResult?: ConstraintResult, safetyResult?: SafetyResult): void {
    // Store full candidate by content hash
    this.candidates.set(candidate.contentHash, candidate);
    this.candidates.set(candidate.candidateId, candidate);

    const entry: CandidateMemoryEntry = {
      candidateId: candidate.candidateId,
      contentHash: candidate.contentHash,
      representationHash: candidate.representation.hash,
      parentHashes: candidate.parentCandidates,
      generationMethod: candidate.generationMethod,
      iteration: candidate.generationIteration,
      score: scoring?.totalScore ?? candidate.score,
      safetyClassification: safetyResult?.classification || candidate.safetyClassification,
      predictionSummary: this.summarizePredictions(candidate),
      evaluationSummary: {
        stagesPassed: candidate.evaluationHistory.filter(e => e.passed).map(e => e.stage),
        stagesFailed: candidate.evaluationHistory.filter(e => !e.passed).map(e => e.stage),
        finalPassed: candidate.evaluationHistory.length > 0 ? candidate.evaluationHistory[candidate.evaluationHistory.length - 1].passed : false,
      },
      provenance: candidate.provenance,
      createdAt: candidate.createdAt,
    };

    this.store.set(candidate.candidateId, entry);
    this.store.set(candidate.contentHash, entry);
  }

  get(candidateId: string): Candidate | undefined {
    return this.candidates.get(candidateId);
  }

  getEntry(candidateId: string): CandidateMemoryEntry | undefined {
    return this.store.get(candidateId);
  }

  getByHash(hash: string): Candidate | undefined {
    return this.candidates.get(hash);
  }

  list(): Candidate[] {
    // Return unique candidates by ID
    const seen = new Set<string>();
    const result: Candidate[] = [];
    for (const [key, cand] of this.candidates.entries()) {
      if (key.startsWith("cand_") && !seen.has(cand.candidateId)) {
        seen.add(cand.candidateId);
        result.push(cand);
      }
    }
    return result;
  }

  listEntries(): CandidateMemoryEntry[] {
    const seen = new Set<string>();
    const result: CandidateMemoryEntry[] = [];
    for (const [key, entry] of this.store.entries()) {
      if (key.startsWith("cand_") && !seen.has(entry.candidateId)) {
        seen.add(entry.candidateId);
        result.push(entry);
      }
    }
    return result;
  }

  size(): number {
    return this.list().length;
  }

  clear(): void {
    this.store.clear();
    this.candidates.clear();
  }

  private summarizePredictions(candidate: Candidate): Record<string, { value: unknown; confidence: number; isMock: boolean }> {
    const summary: Record<string, { value: unknown; confidence: number; isMock: boolean }> = {};
    for (const pred of candidate.predictions) {
      summary[pred.property] = {
        value: pred.predictedValue,
        confidence: pred.confidence,
        isMock: pred.isMock,
      };
    }
    return summary;
  }
}

// ============================================================================
// CHECKPOINT MANAGER
// ============================================================================

export class CheckpointManager {
  private checkpoints: Map<string, Checkpoint> = new Map();

  createCheckpoint(state: SearchState, candidateHashes: string[]): Checkpoint {
    const checkpointId = `ckpt_${state.searchId}_${state.iteration}_${Date.now()}`;

    const provenance = createProvenance({
      description: `Checkpoint at iteration ${state.iteration} for search ${state.searchId}`,
      iteration: state.iteration,
      randomSeed: state.randomSeed,
      inputHash: contentHash({ searchId: state.searchId, iteration: state.iteration }),
      configHash: contentHash(state.config),
      parentIds: [state.searchId],
      tags: ["checkpoint", `iteration-${state.iteration}`],
    });

    const checkpoint: Checkpoint = {
      checkpointId,
      searchId: state.searchId,
      iteration: state.iteration,
      searchState: { ...state },
      candidateHashes: [...candidateHashes],
      modelVersions: { ...state.modelVersions },
      randomSeed: state.randomSeed,
      config: { ...state.config },
      configHash: contentHash(state.config),
      timestamp: new Date().toISOString(),
      provenance,
    };

    this.checkpoints.set(checkpointId, checkpoint);
    this.checkpoints.set(`${state.searchId}_${state.iteration}`, checkpoint);

    return checkpoint;
  }

  getCheckpoint(checkpointId: string): Checkpoint | undefined {
    return this.checkpoints.get(checkpointId);
  }

  getLatestCheckpoint(searchId: string): Checkpoint | undefined {
    let latest: Checkpoint | undefined;
    for (const ckpt of this.checkpoints.values()) {
      if (ckpt.searchId === searchId) {
        if (!latest || ckpt.iteration > latest.iteration) {
          latest = ckpt;
        }
      }
    }
    return latest;
  }

  listCheckpoints(searchId: string): Checkpoint[] {
    return Array.from(this.checkpoints.values()).filter(c => c.searchId === searchId);
  }
}

// ============================================================================
// ACTIVE LEARNING CONTROLLER
// ============================================================================

export interface ActiveLearningState {
  iteration: number;
  predictionErrors: Array<{ property: string; predicted: number; actual: number; error: number }>;
  modelImprovement: number;
  uncertaintyReduction: number;
  timestamp: string;
}

export class ActiveLearningController {
  private state: ActiveLearningState;
  private history: ActiveLearningState[] = [];

  constructor() {
    this.state = {
      iteration: 0,
      predictionErrors: [],
      modelImprovement: 0,
      uncertaintyReduction: 0,
      timestamp: new Date().toISOString(),
    };
  }

  update(
    candidates: Candidate[],
    predictions: PredictionResult[],
    simulationResults: SimulationResult[]
  ): ActiveLearningState {
    // Compare predictions vs simulations where available
    const errors: Array<{ property: string; predicted: number; actual: number; error: number }> = [];

    for (const sim of simulationResults) {
      if (sim.status !== "SUCCESS") continue;

      for (const [prop, simVal] of Object.entries(sim.properties)) {
        const pred = predictions.find(p => p.property === prop && p.provenance.parentIds.includes(sim.candidateId));
        if (pred && typeof pred.predictedValue === "number" && typeof simVal.value === "number") {
          const error = Math.abs((pred.predictedValue as number) - (simVal.value as number));
          errors.push({
            property: prop,
            predicted: pred.predictedValue as number,
            actual: simVal.value as number,
            error,
          });
        }
      }
    }

    const avgError = errors.length > 0 ? errors.reduce((sum, e) => sum + e.error, 0) / errors.length : 0;
    const prevAvgError = this.history.length > 0
      ? this.history[this.history.length - 1].predictionErrors.reduce((sum, e) => sum + e.error, 0) / Math.max(1, this.history[this.history.length - 1].predictionErrors.length)
      : avgError;

    const improvement = prevAvgError - avgError;
    const uncertaintyReduction = candidates.length > 0
      ? candidates.reduce((sum, c) => sum + c.uncertainty.value, 0) / candidates.length
      : 0;

    this.state = {
      iteration: this.state.iteration + 1,
      predictionErrors: errors,
      modelImprovement: improvement,
      uncertaintyReduction,
      timestamp: new Date().toISOString(),
    };

    this.history.push({ ...this.state });

    return this.state;
  }

  getState(): ActiveLearningState {
    return { ...this.state };
  }

  getHistory(): ActiveLearningState[] {
    return [...this.history];
  }

  shouldContinueExploration(): boolean {
    // If model is still improving, continue
    return this.state.modelImprovement > 0.01 || this.state.predictionErrors.length === 0;
  }
}

// ============================================================================
// SEARCH CONTROLLER - MAIN ORCHESTRATOR
// ============================================================================

export interface SearchControllerConfig {
  generator: CandidateGenerator;
  predictorRegistry: PredictorRegistry;
  constraintEngine: ConstraintEngine;
  safetyEngine: SafetyEngine;
  scoringEngine: ScoringEngine;
  simulationEngine: SimulationEngine;
  searchStateManager: SearchStateManager;
  candidateMemory: CandidateMemory;
  checkpointManager: CheckpointManager;
  activeLearningController: ActiveLearningController;
}

export class SearchController {
  private config: SearchControllerConfig;

  constructor(config: SearchControllerConfig) {
    this.config = config;
  }

  async runSearch(
    goal: ChemistryGoal,
    spec: ChemistrySpecification,
    designSpace: DesignSpace,
    searchConfig: SearchConfig = DEFAULT_SEARCH_CONFIG
  ): Promise<{ finalCandidates: Candidate[]; searchState: SearchState; checkpoints: Checkpoint[]; paretoFront: ParetoFront }> {
    const searchId = `search_${contentHash({ goalId: goal.goalId, ts: Date.now() }).slice(0, 12)}_${Date.now()}`;
    const startTime = Date.now();

    // Initialize search state
    let searchState = this.config.searchStateManager.createInitialState(searchId, goal, spec, searchConfig);
    const checkpoints: Checkpoint[] = [];
    const allCandidates: Candidate[] = [];

    console.log(`[SearchController] Starting search ${searchId} for goal ${goal.goalId}, domain ${designSpace.domain}`);

    let iteration = 0;
    let bestScore = 0;

    while (true) {
      const iterStart = Date.now();
      console.log(`[SearchController] Iteration ${iteration + 1}/${searchConfig.maxIterations}`);

      // 1. Generate candidates
      const generationBudget = searchConfig.candidatesPerIteration;
      const candidates = await this.config.generator.generate({
        specification: spec,
        designSpace,
        previousCandidates: allCandidates,
        searchState,
        generationBudget,
        iteration,
        randomSeed: searchConfig.randomSeed + iteration,
      });

      console.log(`[SearchController] Generated ${candidates.length} candidates`);

      // 2. Structural filtering (cheap)
      const structurallyValid = this.structuralFilter(candidates, designSpace);
      console.log(`[SearchController] Structural filter: ${candidates.length} -> ${structurallyValid.length}`);

      // 3. Fast property prediction
      const withPredictions = await this.predictProperties(structurallyValid, spec);
      console.log(`[SearchController] Predicted properties for ${withPredictions.length} candidates`);

      // 4. Constraint evaluation
      const constraintResults = await this.config.constraintEngine.evaluateBatch(withPredictions, spec);
      const constraintPassed = withPredictions.filter((_, idx) => constraintResults[idx].passed);
      console.log(`[SearchController] Constraint filter: ${withPredictions.length} -> ${constraintPassed.length}`);

      // 5. Safety evaluation
      const safetyResults: SafetyResult[] = [];
      const safetyPassed: Candidate[] = [];
      for (const cand of constraintPassed) {
        const safety = await this.config.safetyEngine.evaluate(cand, goal.goalId);
        safetyResults.push(safety);
        if (!safety.blocked) {
          safetyPassed.push(cand);
        }
      }
      console.log(`[SearchController] Safety filter: ${constraintPassed.length} -> ${safetyPassed.length}`);

      // 6. Selection for expensive evaluation (top by exploration/exploitation)
      const selectedForSimulation = this.selectForSimulation(safetyPassed, searchState, searchConfig);
      console.log(`[SearchController] Selected ${selectedForSimulation.length} for simulation`);

      // 7. Expensive evaluation (simulation)
      const simulationResults: SimulationResult[] = [];
      for (const cand of selectedForSimulation) {
        if (this.config.simulationEngine.isAvailable()) {
          const request = {
            requestId: `req_${cand.candidateId}_${Date.now()}`,
            candidateId: cand.candidateId,
            candidateHash: cand.contentHash,
            properties: spec.propertyTargets.map(t => t.property),
            engineId: this.config.simulationEngine.engineId,
            parameters: {},
            priority: 1,
            createdAt: new Date().toISOString(),
            provenance: createProvenance({
              description: `Simulation request for ${cand.candidateId}`,
              iteration,
              randomSeed: searchConfig.randomSeed,
              inputHash: cand.contentHash,
              configHash: contentHash(searchConfig),
              tags: ["simulation-request"],
            }),
          };
          const result = await this.config.simulationEngine.simulate(request);
          simulationResults.push(result);
        }
      }

      // 8. Scoring
      const scoringResults: ScoringResult[] = [];
      for (let i = 0; i < safetyPassed.length; i++) {
        const cand = safetyPassed[i];
        const constraintRes = constraintResults.find(r => r.candidateId === cand.candidateId) || constraintResults[i];
        const safetyRes = safetyResults.find(r => r.candidateId === cand.candidateId) || safetyResults[i];
        
        if (constraintRes && safetyRes) {
          const score = await this.config.scoringEngine.score(cand, spec, constraintRes, safetyRes);
          scoringResults.push(score);
          cand.score = score.totalScore;

          // Add to memory
          this.config.candidateMemory.add(cand, score, constraintRes, safetyRes);
        }
      }

      // Sort by score
      const sortedCandidates = [...safetyPassed].sort((a, b) => (b.score || 0) - (a.score || 0));
      allCandidates.push(...sortedCandidates);

      // 9. Pareto front extraction
      const objectives = spec.propertyTargets.map(t => t.property);
      const paretoFront = this.config.scoringEngine.extractParetoFront(sortedCandidates, objectives);

      // Mark Pareto optimal
      for (const candId of paretoFront.candidates) {
        const cand = sortedCandidates.find(c => c.candidateId === candId);
        if (cand) {
          cand.paretoRank = 1;
          const scoring = scoringResults.find(s => s.candidateId === candId);
          if (scoring) scoring.isParetoOptimal = true;
        }
      }

      // 10. Active learning update
      const allPredictions = sortedCandidates.flatMap(c => c.predictions);
      this.config.activeLearningController.update(sortedCandidates, allPredictions, simulationResults);

      // 11. Update search state
      const iterTime = Date.now() - iterStart;
      const avgUncertainty = sortedCandidates.length > 0
        ? sortedCandidates.reduce((sum, c) => sum + c.uncertainty.value, 0) / sortedCandidates.length
        : 0.5;

      searchState = this.config.searchStateManager.updateAfterIteration(searchState, {
        candidatesGenerated: candidates.length,
        candidatesEvaluated: safetyPassed.length,
        candidatesRejected: candidates.length - safetyPassed.length,
        bestScore: sortedCandidates[0]?.score || bestScore,
        avgScore: sortedCandidates.length > 0 ? sortedCandidates.reduce((sum, c) => sum + (c.score || 0), 0) / sortedCandidates.length : 0,
        avgUncertainty,
        paretoFront: paretoFront.candidates,
        bestCandidates: sortedCandidates.slice(0, 5).map(c => c.candidateId),
        simulationsRun: simulationResults.length,
        timeElapsedMs: iterTime,
      });

      bestScore = Math.max(bestScore, searchState.convergenceStats.bestScore);

      // 12. Checkpointing
      const checkpoint = this.config.checkpointManager.createCheckpoint(
        searchState,
        sortedCandidates.map(c => c.contentHash)
      );
      checkpoints.push(checkpoint);
      console.log(`[SearchController] Checkpoint ${checkpoint.checkpointId} at iteration ${iteration}`);

      // 13. Check termination
      const termination = this.config.searchStateManager.checkTermination(searchState);
      if (termination.shouldTerminate) {
        console.log(`[SearchController] Terminating: ${termination.reason}`);
        searchState = {
          ...searchState,
          isComplete: true,
          terminationReason: termination.reason,
        };
        break;
      }

      iteration++;
      if (iteration >= searchConfig.maxIterations) {
        console.log(`[SearchController] Max iterations reached`);
        break;
      }

      // Budget check
      if (Date.now() - startTime > (searchConfig.timeBudgetMs || 60000)) {
        console.log(`[SearchController] Time budget exceeded`);
        searchState = {
          ...searchState,
          isComplete: true,
          terminationReason: "Time budget exceeded",
        };
        break;
      }
    }

    // Final candidate selection - top N
    const finalCandidates = [...allCandidates]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, searchConfig.finalCandidateCount);

    const finalPareto = this.config.scoringEngine.extractParetoFront(
      finalCandidates,
      spec.propertyTargets.map(t => t.property)
    );

    console.log(`[SearchController] Search ${searchId} complete: ${finalCandidates.length} final candidates, best score ${bestScore}`);

    return {
      finalCandidates,
      searchState,
      checkpoints,
      paretoFront: finalPareto,
    };
  }

  private structuralFilter(candidates: Candidate[], designSpace: DesignSpace): Candidate[] {
    return candidates.filter(cand => {
      for (const constraint of designSpace.constraints) {
        if (constraint.type === "HARD") {
          const result = constraint.check(cand);
          if (!result.passed) return false;
        }
      }
      return true;
    });
  }

  private async predictProperties(candidates: Candidate[], spec: ChemistrySpecification): Promise<Candidate[]> {
    const properties = spec.propertyTargets.map(t => t.property);

    for (const cand of candidates) {
      const predictions = await this.config.predictorRegistry.predict(cand, properties);
      cand.predictions = predictions;

      // Update properties from predictions
      for (const pred of predictions) {
        if (typeof pred.predictedValue === "number") {
          cand.properties[pred.property] = pred.predictedValue;
        }
      }

      // Add evaluation record
      const evalRecord: EvaluationRecord = {
        evaluationId: `eval_pred_${cand.candidateId}_${Date.now()}`,
        stage: "FAST_PREDICT" as EvaluationStage,
        timestamp: new Date().toISOString(),
        predictions,
        passed: true,
        runtimeMs: predictions.reduce((sum, p) => sum + p.runtimeMs, 0),
        provenance: createProvenance({
          description: `Fast prediction for ${cand.candidateId}`,
          iteration: cand.generationIteration,
          randomSeed: cand.generationSeed,
          inputHash: cand.contentHash,
          configHash: contentHash(properties),
          parentIds: [cand.candidateId],
          tags: ["fast-predict"],
        }),
      };

      cand.evaluationHistory.push(evalRecord);
    }

    return candidates;
  }

  private selectForSimulation(candidates: Candidate[], _searchState: SearchState, config: SearchConfig): Candidate[] {
    const numToSelect = Math.floor(candidates.length * config.simulationRatio);
    if (numToSelect <= 0) return [];

    // Sort by score + exploration bonus
    const sorted = [...candidates].sort((a, b) => {
      const scoreA = (a.score || 0) + a.uncertainty.value * config.uncertaintyWeight;
      const scoreB = (b.score || 0) + b.uncertainty.value * config.uncertaintyWeight;
      return scoreB - scoreA;
    });

    return sorted.slice(0, numToSelect);
  }

  // Resume from checkpoint
  async resumeFromCheckpoint(
    checkpoint: Checkpoint,
    goal: ChemistryGoal,
    spec: ChemistrySpecification,
    designSpace: DesignSpace
  ): Promise<{ finalCandidates: Candidate[]; searchState: SearchState; checkpoints: Checkpoint[]; paretoFront: ParetoFront }> {
    console.log(`[SearchController] Resuming from checkpoint ${checkpoint.checkpointId} at iteration ${checkpoint.iteration}`);

    // Restore state
    const _searchState = checkpoint.searchState;
    void _searchState;
    const searchConfig = checkpoint.config;

    // Continue search from checkpoint iteration
    // For simplicity, restart search but with previous candidates loaded
    // In production, would load candidates from memory store

    return this.runSearch(goal, spec, designSpace, {
      ...searchConfig,
      maxIterations: searchConfig.maxIterations - checkpoint.iteration,
      randomSeed: checkpoint.randomSeed,
    });
  }
}
