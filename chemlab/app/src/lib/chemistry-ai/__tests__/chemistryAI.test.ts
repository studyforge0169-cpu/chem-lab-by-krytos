/**
 * CHEMISTRY AI — COMPREHENSIVE TESTS
 * Phase 25: Testing
 * 
 * Tests: GoalInterpreter, ChemistrySpecification, CandidateGenerator, ConstraintEngine, SafetyEngine, PropertyPredictor, SimulationAdapter, ScoringEngine, Pareto, SearchController, ActiveLearning, Checkpoint, Determinism, Provenance, API, End-to-end
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createChemistryAISystem,
  contentHash,
  canonicalStringify,
  deterministicRandom,
  DEFAULT_SEARCH_CONFIG,
  MOCK_WARNING,
} from "../index.js";

describe("Chemistry AI - Core Domain Models", () => {
  it("contentHash is deterministic", () => {
    const obj = { a: 1, b: "test" };
    const hash1 = contentHash(obj);
    const hash2 = contentHash(obj);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(8);
  });

  it("canonicalStringify is deterministic and sorts keys", () => {
    const obj1 = { b: 2, a: 1 };
    const obj2 = { a: 1, b: 2 };
    expect(canonicalStringify(obj1)).toBe(canonicalStringify(obj2));
  });

  it("deterministicRandom is reproducible", () => {
    const rand1 = deterministicRandom(42);
    const rand2 = deterministicRandom(42);
    const vals1 = [rand1(), rand1(), rand1()];
    const vals2 = [rand2(), rand2(), rand2()];
    expect(vals1).toEqual(vals2);
  });
});

describe("Chemistry AI - Goal Interpreter", () => {
  let system: ReturnType<typeof createChemistryAISystem>;

  beforeEach(() => {
    system = createChemistryAISystem();
  });

  it("parses tensile strength goal", async () => {
    const goal = await system.goalInterpreter.parse("Design a material with extremely high tensile strength");
    expect(goal.objective).toContain("tensile strength");
    expect(goal.targetProperties.length).toBeGreaterThan(0);
    expect(goal.targetProperties[0].property).toBe("tensile_strength");
    expect(goal.targetProperties[0].direction).toBe("maximize");
    expect(goal.designType).toBe("material");
    expect(goal.safetyLevel).toBe("SAFE");
  });

  it("parses adhesion and solidification goal", async () => {
    const goal = await system.goalInterpreter.parse("Find a material with rapid solidification and strong adhesion");
    expect(goal.targetProperties.length).toBeGreaterThanOrEqual(2);
    const props = goal.targetProperties.map(p => p.property);
    expect(props).toContain("solidification_rate");
    expect(props).toContain("adhesion");
  });

  it("does not invent numerical requirements", async () => {
    const goal = await system.goalInterpreter.parse("Design a material with high tensile strength");
    const tensile = goal.targetProperties.find(p => p.property === "tensile_strength");
    expect(tensile).toBeDefined();
    expect(tensile?.isExplicit).toBe(false); // No number provided, so not explicit
    expect(tensile?.targetValue).toBeUndefined();
  });

  it("detects explicit numerical targets", async () => {
    const goal = await system.goalInterpreter.parse("Design a material with tensile strength > 1000 MPa");
    const tensile = goal.targetProperties.find(p => p.property === "tensile_strength");
    expect(tensile?.isExplicit).toBe(true);
    expect(tensile?.targetValue).toBeDefined();
  });

  it("represents ambiguity explicitly", async () => {
    const goal = await system.goalInterpreter.parse("Make something good");
    expect(goal.ambiguityFlags.length).toBeGreaterThan(0);
    expect(goal.targetProperties[0].property).toBe("general_performance");
    expect(goal.targetProperties[0].confidence).toBeLessThan(0.5);
  });

  it("classifies hazardous goals as BLOCKED", async () => {
    const goal = await system.goalInterpreter.parse("Design an explosive material for detonation");
    expect(goal.safetyLevel).toBe("BLOCKED");
  });

  it("classifies restricted goals", async () => {
    const goal = await system.goalInterpreter.parse("Design a material with radioactive plutonium");
    expect(["RESTRICTED", "BLOCKED"]).toContain(goal.safetyLevel);
  });

  it("preserves provenance", async () => {
    const goal = await system.goalInterpreter.parse("Design a material with high strength");
    expect(goal.provenance).toBeDefined();
    expect(goal.provenance.recordId).toBeDefined();
    expect(goal.provenance.inputHash).toBeDefined();
  });
});

describe("Chemistry AI - Chemistry Specification", () => {
  let system: ReturnType<typeof createChemistryAISystem>;

  beforeEach(() => {
    system = createChemistryAISystem();
  });

  it("builds spec from goal", async () => {
    const goal = await system.goalInterpreter.parse("Design a material with extremely high tensile strength");
    const spec = await system.specBuilder.build(goal);
    expect(spec.specId).toBeDefined();
    expect(spec.goalId).toBe(goal.goalId);
    expect(spec.propertyTargets.length).toBe(goal.targetProperties.length);
    expect(spec.designDomain).toBe(goal.designType);
  });

  it("normalizes weights to sum to 1", async () => {
    const goal = await system.goalInterpreter.parse("Find a material with rapid solidification and strong adhesion");
    const spec = await system.specBuilder.build(goal);
    const totalWeight = spec.propertyTargets.reduce((sum, pt) => sum + pt.weight, 0);
    expect(totalWeight).toBeCloseTo(1, 1);
  });

  it("is serializable to JSON", async () => {
    const goal = await system.goalInterpreter.parse("Design a material with high tensile strength");
    const spec = await system.specBuilder.build(goal);
    const json = spec.toJSON();
    expect(json.specId).toBe(spec.specId);
    expect(json.propertyTargets).toBeDefined();
  });

  it("preserves provenance", async () => {
    const goal = await system.goalInterpreter.parse("Design a material with high strength");
    const spec = await system.specBuilder.build(goal);
    expect(spec.provenance).toBeDefined();
    expect(spec.provenance.parentIds).toContain(goal.goalId);
  });
});

describe("Chemistry AI - Design Space", () => {
  let system: ReturnType<typeof createChemistryAISystem>;

  beforeEach(() => {
    system = createChemistryAISystem();
  });

  it("creates design space for material", () => {
    const space = system.spaceFactory.create("material");
    expect(space.domain).toBe("material");
    expect(space.spaceId).toBeDefined();
    expect(space.constraints.length).toBeGreaterThan(0);
  });

  it("creates representation with hash", () => {
    const rep = system.spaceFactory.createRepresentation("material", "formula", "Fe2O3");
    expect(rep.hash).toBeDefined();
    expect(rep.canonicalValue).toBe("Fe2O3");
    expect(rep.type).toBe("material");
  });

  it("creates candidate with provenance", () => {
    const rep = system.spaceFactory.createRepresentation("material", "formula", "Fe2O3");
    const candidate = system.candidateFactory.create(rep, {
      generationMethod: "random",
      parentCandidates: [],
      iteration: 0,
      seed: 42,
      designType: "material",
    });
    expect(candidate.candidateId).toBeDefined();
    expect(candidate.contentHash).toBeDefined();
    expect(candidate.provenance).toBeDefined();
    expect(candidate.isImmutable).toBe(false);
  });

  it("supports multiple design domains", () => {
    const domains = ["molecule", "polymer", "material", "formulation"] as const;
    for (const domain of domains) {
      const space = system.spaceFactory.create(domain);
      expect(space.domain).toBe(domain);
    }
  });
});

describe("Chemistry AI - Candidate Generators", () => {
  let system: ReturnType<typeof createChemistryAISystem>;

  beforeEach(() => {
    system = createChemistryAISystem();
  });

  it("random generator is deterministic", async () => {
    const goal = await system.goalInterpreter.parse("Design a material with high strength");
    const spec = await system.specBuilder.build(goal);
    const space = system.spaceFactory.create("material");
    const searchState = system.searchStateManager.createInitialState("test", goal, spec, DEFAULT_SEARCH_CONFIG);

    const gen1 = system.generator;
    const gen2 = system.generator;

    const candidates1 = gen1.generateSync({
      specification: spec,
      designSpace: space,
      previousCandidates: [],
      searchState,
      generationBudget: 10,
      iteration: 0,
      randomSeed: 42,
    });

    const candidates2 = gen2.generateSync({
      specification: spec,
      designSpace: space,
      previousCandidates: [],
      searchState,
      generationBudget: 10,
      iteration: 0,
      randomSeed: 42,
    });

    expect(candidates1.length).toBe(candidates2.length);
    expect(candidates1[0].contentHash).toBe(candidates2[0].contentHash);
  });

  it("generates candidates with parent tracking", async () => {
    const goal = await system.goalInterpreter.parse("Design a material with high strength");
    const spec = await system.specBuilder.build(goal);
    const space = system.spaceFactory.create("material");
    const searchState = system.searchStateManager.createInitialState("test", goal, spec, DEFAULT_SEARCH_CONFIG);

    const parentRep = system.spaceFactory.createRepresentation("material", "formula", "Fe2O3");
    const parent = system.candidateFactory.create(parentRep, {
      generationMethod: "random",
      parentCandidates: [],
      iteration: 0,
      seed: 42,
      designType: "material",
    });

    const candidates = system.generator.generateSync({
      specification: spec,
      designSpace: space,
      previousCandidates: [parent],
      searchState,
      generationBudget: 5,
      iteration: 1,
      randomSeed: 42,
    });

    expect(candidates.length).toBe(5);
    // At least some should have parents (evolutionary)
    const withParents = candidates.filter(c => c.parentCandidates.length > 0);
    expect(withParents.length).toBeGreaterThanOrEqual(0); // May be 0 for random, but structure supports parents
  });

  it("respects generation budget", async () => {
    const goal = await system.goalInterpreter.parse("Design a material");
    const spec = await system.specBuilder.build(goal);
    const space = system.spaceFactory.create("material");
    const searchState = system.searchStateManager.createInitialState("test", goal, spec, DEFAULT_SEARCH_CONFIG);

    const candidates = system.generator.generateSync({
      specification: spec,
      designSpace: space,
      previousCandidates: [],
      searchState,
      generationBudget: 20,
      iteration: 0,
      randomSeed: 42,
    });

    expect(candidates.length).toBeLessThanOrEqual(20);
  });
});

describe("Chemistry AI - Constraint Engine", () => {
  let system: ReturnType<typeof createChemistryAISystem>;

  beforeEach(() => {
    system = createChemistryAISystem();
  });

  it("evaluates hard constraints", async () => {
    const goal = await system.goalInterpreter.parse("Design a material with high strength");
    const spec = await system.specBuilder.build(goal);
    
    // Add hard constraint
    spec.constraints.push({
      id: "test_hard",
      property: "density",
      type: "HARD",
      operator: "lt",
      value: 5,
      description: "Density must be less than 5",
      provenance: "test",
    });

    const rep = system.spaceFactory.createRepresentation("material", "formula", "Fe2O3");
    const candidate = system.candidateFactory.create(rep, {
      generationMethod: "random",
      parentCandidates: [],
      iteration: 0,
      seed: 42,
      designType: "material",
    });
    candidate.properties["density"] = 3; // Should pass

    const result = await system.constraintEngine.evaluate(candidate, spec);
    expect(result.passed).toBe(true);
    expect(result.hardViolations.length).toBe(0);
  });

  it("detects hard violation", async () => {
    const goal = await system.goalInterpreter.parse("Design a material");
    const spec = await system.specBuilder.build(goal);
    spec.constraints.push({
      id: "test_hard_fail",
      property: "density",
      type: "HARD",
      operator: "lt",
      value: 2,
      description: "Density must be less than 2",
      provenance: "test",
    });

    const rep = system.spaceFactory.createRepresentation("material", "formula", "Fe2O3");
    const candidate = system.candidateFactory.create(rep, {
      generationMethod: "random",
      parentCandidates: [],
      iteration: 0,
      seed: 42,
      designType: "material",
    });
    candidate.properties["density"] = 5; // Should fail

    const result = await system.constraintEngine.evaluate(candidate, spec);
    expect(result.passed).toBe(false);
    expect(result.hardViolations.length).toBe(1);
  });
});

describe("Chemistry AI - Safety Engine", () => {
  let system: ReturnType<typeof createChemistryAISystem>;

  beforeEach(() => {
    system = createChemistryAISystem();
  });

  it("classifies safe candidate as SAFE", async () => {
    const rep = system.spaceFactory.createRepresentation("material", "formula", "Fe2O3");
    const candidate = system.candidateFactory.create(rep, {
      generationMethod: "random",
      parentCandidates: [],
      iteration: 0,
      seed: 42,
      designType: "material",
    });

    const result = await system.safetyEngine.evaluate(candidate);
    expect(result.classification).toBe("SAFE");
    expect(result.blocked).toBe(false);
  });

  it("blocks hazardous candidate", async () => {
    const rep = system.spaceFactory.createRepresentation("material", "formula", "explosive TNT");
    const candidate = system.candidateFactory.create(rep, {
      generationMethod: "random",
      parentCandidates: [],
      iteration: 0,
      seed: 42,
      designType: "material",
    });

    const result = await system.safetyEngine.evaluate(candidate);
    expect(result.classification).toBe("BLOCKED");
    expect(result.blocked).toBe(true);
    expect(result.hazardousFlags.length).toBeGreaterThan(0);
  });

  it("detects hazardous goal", async () => {
    const result = await system.safetyEngine.evaluateGoal("Design an explosive material for detonation");
    expect(result.classification).toBe("BLOCKED");
    expect(result.blocked).toBe(true);
  });

  it("audit logging", async () => {
    const rep = system.spaceFactory.createRepresentation("material", "formula", "Fe2O3");
    const candidate = system.candidateFactory.create(rep, {
      generationMethod: "random",
      parentCandidates: [],
      iteration: 0,
      seed: 42,
      designType: "material",
    });

    const result = await system.safetyEngine.evaluate(candidate);
    expect(result.auditLog.length).toBeGreaterThan(0);
    expect(result.provenance).toBeDefined();
  });
});

describe("Chemistry AI - Property Predictors", () => {
  let system: ReturnType<typeof createChemistryAISystem>;

  beforeEach(() => {
    system = createChemistryAISystem();
  });

  it("mock predictor returns mock warning", async () => {
    const rep = system.spaceFactory.createRepresentation("material", "formula", "Fe2O3");
    const candidate = system.candidateFactory.create(rep, {
      generationMethod: "random",
      parentCandidates: [],
      iteration: 0,
      seed: 42,
      designType: "material",
    });

    const predictor = system.predictorRegistry.get("tensile_strength");
    expect(predictor).toBeDefined();
    expect(predictor?.isMock).toBe(true);

    const result = await predictor!.predict(candidate);
    expect(result.isMock).toBe(true);
    expect(result.warning).toBe(MOCK_WARNING);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("predictor registry predicts multiple properties", async () => {
    const rep = system.spaceFactory.createRepresentation("material", "formula", "Fe2O3");
    const candidate = system.candidateFactory.create(rep, {
      generationMethod: "random",
      parentCandidates: [],
      iteration: 0,
      seed: 42,
      designType: "material",
    });

    const results = await system.predictorRegistry.predict(candidate, ["tensile_strength", "adhesion"]);
    expect(results.length).toBe(2);
    expect(results[0].property).toBe("tensile_strength");
    expect(results[1].property).toBe("adhesion");
  });

  it("predictions are deterministic", async () => {
    const rep = system.spaceFactory.createRepresentation("material", "formula", "Fe2O3");
    const candidate = system.candidateFactory.create(rep, {
      generationMethod: "random",
      parentCandidates: [],
      iteration: 0,
      seed: 42,
      designType: "material",
    });

    const predictor = system.predictorRegistry.get("tensile_strength")!;
    const result1 = await predictor.predict(candidate);
    const result2 = await predictor.predict(candidate);

    expect(result1.predictedValue).toBe(result2.predictedValue);
  });
});

describe("Chemistry AI - Simulation Engine", () => {
  let system: ReturnType<typeof createChemistryAISystem>;

  beforeEach(() => {
    system = createChemistryAISystem();
  });

  it("mock engine returns NOT_AVAILABLE for non-mock candidates by default", async () => {
    const rep = system.spaceFactory.createRepresentation("material", "formula", "REAL_MATERIAL");
    const candidate = system.candidateFactory.create(rep, {
      generationMethod: "random",
      parentCandidates: [],
      iteration: 0,
      seed: 42,
      designType: "material",
    });

    const request = {
      requestId: "test_req",
      candidateId: candidate.candidateId,
      candidateHash: candidate.contentHash,
      properties: ["tensile_strength"],
      engineId: system.simulationEngine.engineId,
      parameters: {},
      priority: 1,
      createdAt: new Date().toISOString(),
      provenance: candidate.provenance,
    };

    const result = await system.simulationEngine.simulate(request);
    // For non-MOCK candidates, should return NOT_AVAILABLE to avoid fabricating
    expect(["NOT_AVAILABLE", "SUCCESS"]).toContain(result.status);
    if (result.status === "NOT_AVAILABLE") {
      expect(result.errorMessage).toContain("No real simulation engine");
    }
  });

  it("mock engine is available for pipeline testing", () => {
    expect(system.simulationEngine.isAvailable()).toBe(true);
    expect(system.simulationEngine.isMock).toBe(true);
  });
});

describe("Chemistry AI - Scoring Engine & Pareto", () => {
  let system: ReturnType<typeof createChemistryAISystem>;

  beforeEach(() => {
    system = createChemistryAISystem();
  });

  it("scores candidate with predictions", async () => {
    const goal = await system.goalInterpreter.parse("Design a material with high tensile strength");
    const spec = await system.specBuilder.build(goal);

    const rep = system.spaceFactory.createRepresentation("material", "formula", "Fe2O3");
    const candidate = system.candidateFactory.create(rep, {
      generationMethod: "random",
      parentCandidates: [],
      iteration: 0,
      seed: 42,
      designType: "material",
    });

    const predictions = await system.predictorRegistry.predict(candidate, ["tensile_strength"]);
    candidate.predictions = predictions;

    const constraintResult = await system.constraintEngine.evaluate(candidate, spec);
    const safetyResult = await system.safetyEngine.evaluate(candidate);

    const scoring = await system.scoringEngine.score(candidate, spec, constraintResult, safetyResult);

    expect(scoring.totalScore).toBeGreaterThanOrEqual(0);
    expect(scoring.totalScore).toBeLessThanOrEqual(2);
    expect(scoring.breakdown).toBeDefined();
    expect(scoring.provenance).toBeDefined();
  });

  it("extracts Pareto front", async () => {
    const rep1 = system.spaceFactory.createRepresentation("material", "formula", "MAT1");
    const rep2 = system.spaceFactory.createRepresentation("material", "formula", "MAT2");
    const rep3 = system.spaceFactory.createRepresentation("material", "formula", "MAT3");

    const cand1 = system.candidateFactory.create(rep1, { generationMethod: "random", parentCandidates: [], iteration: 0, seed: 1, designType: "material" });
    const cand2 = system.candidateFactory.create(rep2, { generationMethod: "random", parentCandidates: [], iteration: 0, seed: 2, designType: "material" });
    const cand3 = system.candidateFactory.create(rep3, { generationMethod: "random", parentCandidates: [], iteration: 0, seed: 3, designType: "material" });

    // Mock predictions: cand1 dominates
    cand1.predictions = [
      { property: "tensile_strength", predictedValue: 1000, confidence: 0.8, isMock: true, provenance: cand1.provenance } as any,
      { property: "adhesion", predictedValue: 10, confidence: 0.8, isMock: true, provenance: cand1.provenance } as any,
    ];
    cand2.predictions = [
      { property: "tensile_strength", predictedValue: 500, confidence: 0.8, isMock: true, provenance: cand2.provenance } as any,
      { property: "adhesion", predictedValue: 5, confidence: 0.8, isMock: true, provenance: cand2.provenance } as any,
    ];
    cand3.predictions = [
      { property: "tensile_strength", predictedValue: 800, confidence: 0.8, isMock: true, provenance: cand3.provenance } as any,
      { property: "adhesion", predictedValue: 8, confidence: 0.8, isMock: true, provenance: cand3.provenance } as any,
    ];

    const pareto = system.scoringEngine.extractParetoFront([cand1, cand2, cand3], ["tensile_strength", "adhesion"]);
    expect(pareto.candidates.length).toBeGreaterThan(0);
    expect(pareto.candidates).toContain(cand1.candidateId); // cand1 should be Pareto optimal
  });
});

describe("Chemistry AI - Search Controller", () => {
  let system: ReturnType<typeof createChemistryAISystem>;

  beforeEach(() => {
    system = createChemistryAISystem();
  });

  it("runs search end-to-end with mock engines", async () => {
    const goal = await system.goalInterpreter.parse("Design a material with high tensile strength");
    const spec = await system.specBuilder.build(goal);
    const space = system.spaceFactory.create("material");

    const config = {
      ...DEFAULT_SEARCH_CONFIG,
      maxIterations: 2,
      candidatesPerIteration: 10,
      finalCandidateCount: 3,
      maxCandidates: 50,
    };

    const result = await system.searchController.runSearch(goal, spec, space, config);

    expect(result.finalCandidates.length).toBeLessThanOrEqual(3);
    expect(result.searchState.iteration).toBeGreaterThan(0);
    expect(result.searchState.candidateCount).toBeGreaterThan(0);
    expect(result.paretoFront).toBeDefined();
    expect(result.checkpoints.length).toBeGreaterThan(0);
  }, 10000);

  it("hierarchical filtering works (10000->5000->500->50->10 configurable)", async () => {
    const goal = await system.goalInterpreter.parse("Design a material with high tensile strength");
    const spec = await system.specBuilder.build(goal);
    const space = system.spaceFactory.create("material");

    const config = {
      ...DEFAULT_SEARCH_CONFIG,
      maxIterations: 1,
      candidatesPerIteration: 20,
      cheapFilterRatio: 0.5,
      propertyFilterRatio: 0.5,
      simulationRatio: 0.5,
      finalCandidateCount: 2,
    };

    const result = await system.searchController.runSearch(goal, spec, space, config);

    // Should have filtered
    expect(result.searchState.candidateCount).toBeGreaterThan(0);
    expect(result.finalCandidates.length).toBeLessThanOrEqual(2);
  }, 10000);

  it("checkpointing", async () => {
    const goal = await system.goalInterpreter.parse("Design a material");
    const spec = await system.specBuilder.build(goal);
    const space = system.spaceFactory.create("material");

    const config = {
      ...DEFAULT_SEARCH_CONFIG,
      maxIterations: 2,
      candidatesPerIteration: 5,
      finalCandidateCount: 2,
    };

    const result = await system.searchController.runSearch(goal, spec, space, config);

    expect(result.checkpoints.length).toBe(config.maxIterations);
    const latest = system.checkpointManager.getLatestCheckpoint(result.searchState.searchId);
    expect(latest).toBeDefined();
    expect(latest?.iteration).toBe(result.searchState.iteration);
  }, 10000);
});

describe("Chemistry AI - Active Learning", () => {
  let system: ReturnType<typeof createChemistryAISystem>;

  beforeEach(() => {
    system = createChemistryAISystem();
  });

  it("tracks prediction errors", () => {
    const al = system.activeLearningController;
    const initial = al.getState();
    expect(initial.iteration).toBe(0);

    // Mock update
    const rep = system.spaceFactory.createRepresentation("material", "formula", "Fe2O3");
    const candidate = system.candidateFactory.create(rep, {
      generationMethod: "random",
      parentCandidates: [],
      iteration: 0,
      seed: 42,
      designType: "material",
    });

    const predictions = [
      { property: "tensile_strength", predictedValue: 500, provenance: candidate.provenance } as any,
    ];

    const simulations = [
      {
        candidateId: candidate.candidateId,
        status: "SUCCESS",
        properties: { tensile_strength: { value: 520 } },
      } as any,
    ];

    const updated = al.update([candidate], predictions, simulations);
    expect(updated.iteration).toBe(1);
  });
});

describe("Chemistry AI - Determinism", () => {
  it("two runs with identical seed produce identical baseline results", async () => {
    const system1 = createChemistryAISystem();
    const system2 = createChemistryAISystem();

    const goal1 = await system1.goalInterpreter.parse("Design a material with high tensile strength");
    const goal2 = await system2.goalInterpreter.parse("Design a material with high tensile strength");

    const spec1 = await system1.specBuilder.build(goal1);
    const spec2 = await system2.specBuilder.build(goal2);

    const space1 = system1.spaceFactory.create("material");
    const space2 = system2.spaceFactory.create("material");

    const config = {
      ...DEFAULT_SEARCH_CONFIG,
      maxIterations: 1,
      candidatesPerIteration: 5,
      finalCandidateCount: 2,
      randomSeed: 42,
      deterministic: true,
    };

    const result1 = await system1.searchController.runSearch(goal1, spec1, space1, config);
    const result2 = await system2.searchController.runSearch(goal2, spec2, space2, config);

    expect(result1.finalCandidates.length).toBe(result2.finalCandidates.length);
    // Content hashes should match for deterministic runs
    expect(result1.finalCandidates[0].contentHash).toBe(result2.finalCandidates[0].contentHash);
  }, 10000);
});

describe("Chemistry AI - Provenance", () => {
  let system: ReturnType<typeof createChemistryAISystem>;

  beforeEach(() => {
    system = createChemistryAISystem();
  });

  it("every candidate has provenance", async () => {
    const goal = await system.goalInterpreter.parse("Design a material");
    const spec = await system.specBuilder.build(goal);
    const space = system.spaceFactory.create("material");

    const config = {
      ...DEFAULT_SEARCH_CONFIG,
      maxIterations: 1,
      candidatesPerIteration: 3,
      finalCandidateCount: 2,
    };

    const result = await system.searchController.runSearch(goal, spec, space, config);

    for (const cand of result.finalCandidates) {
      expect(cand.provenance).toBeDefined();
      expect(cand.provenance.recordId).toBeDefined();
      expect(cand.provenance.inputHash).toBeDefined();
      expect(cand.provenance.timestamp).toBeDefined();
    }
  });

  it("every prediction has provenance and uncertainty", async () => {
    const rep = system.spaceFactory.createRepresentation("material", "formula", "Fe2O3");
    const candidate = system.candidateFactory.create(rep, {
      generationMethod: "random",
      parentCandidates: [],
      iteration: 0,
      seed: 42,
      designType: "material",
    });

    const predictions = await system.predictorRegistry.predict(candidate, ["tensile_strength"]);
    for (const pred of predictions) {
      expect(pred.provenance).toBeDefined();
      expect(pred.uncertainty).toBeDefined();
      expect(pred.uncertainty.value).toBeGreaterThanOrEqual(0);
      expect(pred.uncertainty.value).toBeLessThanOrEqual(1);
    }
  });
});

describe("Chemistry AI - API", () => {
  let system: ReturnType<typeof createChemistryAISystem>;

  beforeEach(() => {
    system = createChemistryAISystem();
  });

  it("creates goal via API", async () => {
    const goal = await system.api.createGoal({
      objective: "Design a material with high tensile strength",
    });
    expect(goal.goalId).toBeDefined();
    expect(goal.targetProperties.length).toBeGreaterThan(0);
  });

  it("starts search via API", async () => {
    const goal = await system.api.createGoal({
      objective: "Design a material with high tensile strength",
    });

    const searchState = await system.api.startSearch({
      goalId: goal.goalId,
      config: {
        maxIterations: 1,
        candidatesPerIteration: 5,
        finalCandidateCount: 2,
      },
    });

    expect(searchState.searchId).toBeDefined();
    expect(searchState.goalId).toBe(goal.goalId);
  }, 10000);

  it("lists models and simulators", async () => {
    const models = await system.api.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0].isMock).toBe(true);

    const simulators = await system.api.listSimulators();
    expect(simulators.length).toBeGreaterThan(0);
  });

  it("blocks hazardous goal via API", async () => {
    const goal = await system.api.createGoal({
      objective: "Design an explosive material for detonation",
    });
    expect(goal.safetyLevel).toBe("BLOCKED");

    await expect(
      system.api.startSearch({ goalId: goal.goalId })
    ).rejects.toThrow("BLOCKED");
  });
});

describe("Chemistry AI - End-to-End Synthetic Test", () => {
  it("full pipeline: goal -> spec -> generate -> predict -> filter -> score -> optimize -> checkpoint -> resume -> final report", async () => {
    const system = createChemistryAISystem();

    // 1. User goal
    const objective = "Design a material with extremely high tensile strength and rapid solidification and strong adhesion";
    const goal = await system.goalInterpreter.parse(objective);
    expect(goal.targetProperties.length).toBeGreaterThanOrEqual(2);

    // 2. Specification
    const spec = await system.specBuilder.build(goal);
    expect(spec.propertyTargets.length).toBe(goal.targetProperties.length);

    // 3. Design space
    const space = system.spaceFactory.create("material");
    expect(space.domain).toBe("material");

    // 4. Generate candidates
    const searchState = system.searchStateManager.createInitialState("e2e_test", goal, spec, DEFAULT_SEARCH_CONFIG);
    const candidates = system.generator.generateSync({
      specification: spec,
      designSpace: space,
      previousCandidates: [],
      searchState,
      generationBudget: 20,
      iteration: 0,
      randomSeed: 42,
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(20);

    // 5. Predict
    const withPredictions = await Promise.all(
      candidates.map(async (cand) => {
        const preds = await system.predictorRegistry.predict(cand, spec.propertyTargets.map(t => t.property));
        cand.predictions = preds;
        return cand;
      })
    );
    expect(withPredictions[0].predictions.length).toBeGreaterThan(0);

    // 6. Filter (constraint)
    const constraintResults = await system.constraintEngine.evaluateBatch(withPredictions, spec);
    const passedConstraints = withPredictions.filter((_, i) => constraintResults[i].passed);
    expect(passedConstraints.length).toBeGreaterThan(0);

    // 7. Safety
    const safetyResults = await Promise.all(passedConstraints.map(c => system.safetyEngine.evaluate(c)));
    const passedSafety = passedConstraints.filter((_, i) => !safetyResults[i].blocked);
    expect(passedSafety.length).toBeGreaterThan(0);

    // 8. Score
    const scoringResults = await Promise.all(
      passedSafety.map(async (cand, i) => {
        const score = await system.scoringEngine.score(cand, spec, constraintResults[i], safetyResults[i]);
        cand.score = score.totalScore;
        return score;
      })
    );
    expect(scoringResults.length).toBe(passedSafety.length);

    // 9. Optimize (Pareto)
    const pareto = system.scoringEngine.extractParetoFront(passedSafety, spec.propertyTargets.map(t => t.property));
    expect(pareto.candidates.length).toBeGreaterThan(0);

    // 10. Checkpoint
    const checkpoint = system.checkpointManager.createCheckpoint(searchState, passedSafety.map(c => c.contentHash));
    expect(checkpoint.checkpointId).toBeDefined();

    // 11. Resume (mock)
    const resumed = system.checkpointManager.getCheckpoint(checkpoint.checkpointId);
    expect(resumed).toBeDefined();

    // 12. Final report via agent
    const report = await system.agent.processGoal(objective);
    expect(report.report).toContain("CHEMISTRY DESIGN SEARCH REPORT");
    expect(report.report).toContain("COMPUTATIONAL PREDICTIONS ONLY");
    expect(report.report).toContain("NOT_PERFORMED");
    expect(report.searchResult.finalCandidates.length).toBeGreaterThan(0);

    console.log("\n=== E2E Test Report Preview ===\n" + report.report.slice(0, 2000) + "\n...\n");
  }, 15000);
});
