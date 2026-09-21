/**
 * CHEMISTRY AI — CANDIDATE GENERATION SYSTEM
 * Phase 4: Pluggable CandidateGenerator interface
 * 
 * Strategies: Random, Fragment-based, Evolutionary, Bayesian, Graph-based, Generative-model adapter, Diffusion adapter, Domain-specific
 * Initially: safe deterministic baseline generators
 */

import {
  Candidate,
  DesignSpace,
  ChemistrySpecification,
  GenerationMethod,
  SearchState,
  deterministicRandom,
} from "./domain.js";
import { DeterministicDesignSpaceFactory, DeterministicCandidateFactory } from "./designSpace.js";

export interface GenerationContext {
  specification: ChemistrySpecification;
  designSpace: DesignSpace;
  previousCandidates: Candidate[];
  searchState: SearchState;
  generationBudget: number;
  iteration: number;
  randomSeed: number;
}

export interface CandidateGenerator {
  generatorId: string;
  method: GenerationMethod;
  generate(context: GenerationContext): Promise<Candidate[]>;
  generateSync(context: GenerationContext): Candidate[];
  isMock: boolean;
}

// Base class for deterministic generators
export abstract class BaseCandidateGenerator implements CandidateGenerator {
  abstract generatorId: string;
  abstract method: GenerationMethod;
  abstract isMock: boolean;

  protected spaceFactory = new DeterministicDesignSpaceFactory();
  protected candidateFactory = new DeterministicCandidateFactory();

  abstract generateSync(context: GenerationContext): Candidate[];

  async generate(context: GenerationContext): Promise<Candidate[]> {
    return this.generateSync(context);
  }

  protected createRandom(seed: number): () => number {
    return deterministicRandom(seed);
  }

  protected createCandidate(
    value: string | Record<string, unknown>,
    context: GenerationContext,
    parentIds: string[] = [],
    methodOverride?: GenerationMethod
  ): Candidate {
    const rep = this.spaceFactory.createRepresentation(
      context.designSpace.domain,
      context.designSpace.representationFormat,
      value
    );

    return this.candidateFactory.create(rep, {
      generationMethod: methodOverride || this.method,
      parentCandidates: parentIds,
      iteration: context.iteration,
      seed: context.randomSeed,
      designType: context.designSpace.domain,
    });
  }
}

// 1. Random/controlled sampling - deterministic baseline
export class RandomSamplingGenerator extends BaseCandidateGenerator {
  generatorId = "random-sampling";
  method: GenerationMethod = "random";
  isMock = true; // Mock for pipeline testing, clearly labeled

  generateSync(context: GenerationContext): Candidate[] {
    const { generationBudget, iteration, randomSeed, designSpace } = context;
    const rand = this.createRandom(randomSeed + iteration);
    const candidates: Candidate[] = [];

    const elements = designSpace.allowedElements || ["H", "C", "N", "O", "Fe", "Al"];
    const budget = Math.min(generationBudget, 100); // cap for safety

    for (let i = 0; i < budget; i++) {
      // Deterministic random composition
      const numElements = 2 + Math.floor(rand() * 3); // 2-4 elements
      const composition: string[] = [];
      for (let j = 0; j < numElements; j++) {
        const el = elements[Math.floor(rand() * elements.length)];
        const count = 1 + Math.floor(rand() * 3);
        composition.push(count === 1 ? el : `${el}${count}`);
      }
      const formula = composition.join("");

      // Add iteration and index for uniqueness but deterministic
      const value = `${formula}_ITER${iteration}_IDX${i}_SEED${randomSeed}`;

      const candidate = this.createCandidate(value, context, [], "random");
      candidates.push(candidate);
    }

    return candidates;
  }
}

// 2. Fragment-based generation - deterministic
export class FragmentBasedGenerator extends BaseCandidateGenerator {
  generatorId = "fragment-based";
  method: GenerationMethod = "fragment";
  isMock = true;

  generateSync(context: GenerationContext): Candidate[] {
    const { generationBudget, iteration, randomSeed, designSpace, previousCandidates } = context;
    const rand = this.createRandom(randomSeed + iteration * 2);
    const candidates: Candidate[] = [];

    const fragments = designSpace.allowedFragments || ["CH3", "OH", "NH2", "COOH", "C6H5", "CH2", "O", "Fe", "Al2O3", "SiO2"];
    const budget = Math.min(generationBudget, 100);

    // If we have previous candidates, use their fragments
    const sourceFragments = previousCandidates.length > 0
      ? previousCandidates.slice(0, 5).map(c => String(c.representation.value).split("_")[0])
      : fragments;

    for (let i = 0; i < budget; i++) {
      const numFrags = 2 + Math.floor(rand() * 2);
      const selected: string[] = [];
      for (let j = 0; j < numFrags; j++) {
        const frag = sourceFragments[Math.floor(rand() * sourceFragments.length)];
        selected.push(frag);
      }
      const value = selected.join("-") + `_FRAG_ITER${iteration}_IDX${i}`;

      const parents = previousCandidates.length > 0 ? [previousCandidates[i % previousCandidates.length].candidateId] : [];
      const candidate = this.createCandidate(value, context, parents, "fragment");
      candidates.push(candidate);
    }

    return candidates;
  }
}

// 3. Evolutionary search - crossover and mutation, deterministic
export class EvolutionaryGenerator extends BaseCandidateGenerator {
  generatorId = "evolutionary";
  method: GenerationMethod = "evolutionary";
  isMock = true;

  generateSync(context: GenerationContext): Candidate[] {
    const { generationBudget, iteration, randomSeed, previousCandidates } = context;
    const rand = this.createRandom(randomSeed + iteration * 3);
    const candidates: Candidate[] = [];

    if (previousCandidates.length === 0) {
      // Fallback to random if no parents
      const fallback = new RandomSamplingGenerator();
      return fallback.generateSync(context);
    }

    const budget = Math.min(generationBudget, 100);
    // Sort previous by score if available, take top 50% as parents
    const sorted = [...previousCandidates].sort((a, b) => (b.score || 0) - (a.score || 0));
    const parents = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 2)));

    for (let i = 0; i < budget; i++) {
      const parent1 = parents[Math.floor(rand() * parents.length)];
      const parent2 = parents[Math.floor(rand() * parents.length)];

      // Crossover: combine representations
      const rep1 = String(parent1.representation.value);
      const rep2 = String(parent2.representation.value);
      
      // Simple deterministic crossover: take first half of rep1 + second half of rep2
      const mid1 = Math.floor(rep1.length / 2);
      const mid2 = Math.floor(rep2.length / 2);
      let childRep: string;

      if (rand() < 0.5) {
        // Crossover
        childRep = rep1.slice(0, mid1) + rep2.slice(mid2);
      } else {
        // Mutation: change one character/element
        const chars = rep1.split("");
        const mutIdx = Math.floor(rand() * chars.length);
        const elements = ["H", "C", "O", "N", "Fe"];
        chars[mutIdx] = elements[Math.floor(rand() * elements.length)];
        childRep = chars.join("");
      }

      childRep = `${childRep}_EVO_ITER${iteration}_IDX${i}`;

      const candidate = this.createCandidate(childRep, context, [parent1.candidateId, parent2.candidateId], "evolutionary");
      candidates.push(candidate);
    }

    return candidates;
  }
}

// 4. Bayesian optimization - placeholder that does random but with uncertainty weighting
export class BayesianOptimizationGenerator extends BaseCandidateGenerator {
  generatorId = "bayesian-optimization";
  method: GenerationMethod = "bayesian";
  isMock = true;

  generateSync(context: GenerationContext): Candidate[] {
    const { generationBudget, iteration, randomSeed, previousCandidates } = context;
    const rand = this.createRandom(randomSeed + iteration * 4);
    const candidates: Candidate[] = [];

    const budget = Math.min(generationBudget, 50); // Smaller budget for expensive method

    // Prefer candidates with high uncertainty (exploration) + high score (exploitation)
    const scored = previousCandidates.length > 0
      ? [...previousCandidates].sort((a, b) => {
          const scoreA = (a.score || 0) + a.uncertainty.value * 0.5;
          const scoreB = (b.score || 0) + b.uncertainty.value * 0.5;
          return scoreB - scoreA;
        })
      : [];

    for (let i = 0; i < budget; i++) {
      let baseRep: string;
      let parents: string[] = [];

      if (scored.length > 0 && rand() < 0.7) {
        // Exploit near promising candidates
        const parent = scored[Math.floor(rand() * Math.min(5, scored.length))];
        baseRep = String(parent.representation.value);
        parents = [parent.candidateId];
        // Add small variation
        baseRep = `${baseRep}_BAYES_VAR${Math.floor(rand() * 100)}`;
      } else {
        // Explore new region
        baseRep = `BAYES_EXPLORE_${iteration}_${i}_${Math.floor(rand() * 10000)}`;
      }

      const value = `${baseRep}_BAYES_ITER${iteration}_IDX${i}`;
      const candidate = this.createCandidate(value, context, parents, "bayesian");
      candidates.push(candidate);
    }

    return candidates;
  }
}

// 5. Generative-model adapter - interface, returns mock but structure ready for real model
export class GenerativeModelAdapter extends BaseCandidateGenerator {
  generatorId = "generative-model-adapter";
  method: GenerationMethod = "generative-model";
  isMock = true;

  private realModelAvailable = false; // Set to true when real model plugged in

  generateSync(context: GenerationContext): Candidate[] {
    if (this.realModelAvailable) {
      // In future, call real generative model here
      throw new Error("Real generative model not yet implemented - adapter ready");
    }

    // Mock: generate plausible-looking representations
    const { generationBudget, iteration, randomSeed } = context;
    const rand = this.createRandom(randomSeed + iteration * 5);
    const candidates: Candidate[] = [];
    const budget = Math.min(generationBudget, 50);

    for (let i = 0; i < budget; i++) {
      // Mock generative: produce SMILES-like strings deterministically
      const mockSmiles = this.generateMockSmiles(rand, i);
      const value = `${mockSmiles}_GEN_ITER${iteration}_IDX${i}_MOCK`;

      const candidate = this.createCandidate(value, context, [], "generative-model");
      candidate.metadata = {
        ...candidate.metadata,
        isMock: true,
        warning: "MOCK GENERATIVE MODEL - NOT SCIENTIFICALLY VALIDATED",
      };
      candidates.push(candidate);
    }

    return candidates;
  }

  private generateMockSmiles(rand: () => number, idx: number): string {
    const atoms = ["C", "O", "N", "C", "C", "O"];
    const bonds = ["", "=", ""];
    let smiles = "";
    const len = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < len; i++) {
      smiles += atoms[Math.floor(rand() * atoms.length)];
      if (i < len - 1) smiles += bonds[Math.floor(rand() * bonds.length)];
    }
    return smiles + `_MOCK${idx}`;
  }
}

// Composite generator - orchestrates multiple strategies
export class CompositeCandidateGenerator implements CandidateGenerator {
  generatorId = "composite";
  method: GenerationMethod = "domain-specific";
  isMock = true;

  private generators: CandidateGenerator[];

  constructor(generators?: CandidateGenerator[]) {
    this.generators = generators || [
      new RandomSamplingGenerator(),
      new FragmentBasedGenerator(),
      new EvolutionaryGenerator(),
      new BayesianOptimizationGenerator(),
    ];
  }

  async generate(context: GenerationContext): Promise<Candidate[]> {
    return this.generateSync(context);
  }

  generateSync(context: GenerationContext): Candidate[] {
    const { generationBudget, searchState } = context;
    const explorationRate = searchState?.config?.explorationRate ?? 0.3;

    // Allocate budget based on exploration vs exploitation
    const exploreBudget = Math.floor(generationBudget * explorationRate);
    const exploitBudget = generationBudget - exploreBudget;

    const allCandidates: Candidate[] = [];

    // Exploration: random + fragment
    const explorePerGen = Math.floor(exploreBudget / 2);
    if (explorePerGen > 0) {
      const randomGen = this.generators.find(g => g.method === "random");
      const fragmentGen = this.generators.find(g => g.method === "fragment");
      
      if (randomGen) {
        allCandidates.push(...randomGen.generateSync({
          ...context,
          generationBudget: explorePerGen,
        }));
      }
      if (fragmentGen) {
        allCandidates.push(...fragmentGen.generateSync({
          ...context,
          generationBudget: exploreBudget - explorePerGen,
        }));
      }
    }

    // Exploitation: evolutionary + bayesian
    const exploitPerGen = Math.floor(exploitBudget / 2);
    if (exploitPerGen > 0) {
      const evoGen = this.generators.find(g => g.method === "evolutionary");
      const bayesGen = this.generators.find(g => g.method === "bayesian");

      if (evoGen && context.previousCandidates.length > 0) {
        allCandidates.push(...evoGen.generateSync({
          ...context,
          generationBudget: exploitPerGen,
        }));
      }
      if (bayesGen) {
        allCandidates.push(...bayesGen.generateSync({
          ...context,
          generationBudget: exploitBudget - exploitPerGen,
        }));
      }
    }

    // If not enough candidates (e.g., no previous), fill with random
    if (allCandidates.length < generationBudget) {
      const filler = new RandomSamplingGenerator();
      const needed = generationBudget - allCandidates.length;
      allCandidates.push(...filler.generateSync({
        ...context,
        generationBudget: needed,
      }));
    }

    // Ensure deterministic uniqueness by content hash
    const unique = new Map<string, Candidate>();
    for (const cand of allCandidates) {
      if (!unique.has(cand.contentHash)) {
        unique.set(cand.contentHash, cand);
      }
    }

    return Array.from(unique.values()).slice(0, generationBudget);
  }
}

// Factory
export function createCandidateGenerator(method: GenerationMethod = "random"): CandidateGenerator {
  switch (method) {
    case "random": return new RandomSamplingGenerator();
    case "fragment": return new FragmentBasedGenerator();
    case "evolutionary": return new EvolutionaryGenerator();
    case "bayesian": return new BayesianOptimizationGenerator();
    case "generative-model": return new GenerativeModelAdapter();
    default: return new CompositeCandidateGenerator();
  }
}

export function createCompositeGenerator(): CandidateGenerator {
  return new CompositeCandidateGenerator();
}
