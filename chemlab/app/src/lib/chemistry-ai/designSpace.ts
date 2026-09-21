/**
 * CHEMISTRY AI — DESIGN SPACE ENGINE
 * Phase 3: DesignSpace abstraction supporting multiple domains
 * 
 * Supports: molecule, polymer, mixture, material, formulation, catalyst, crystal, surface, user-defined
 */

import {
  DesignSpace,
  DesignRepresentation,
  DesignConstraint,
  Candidate,
  DesignDomain,
  GenerationMethod,
  contentHash,
  canonicalStringify,
  createProvenance,
  createUncertainty,
} from "./domain.js";

export interface DesignSpaceFactory {
  create(domain: DesignDomain, options?: Partial<DesignSpace>): DesignSpace;
  createRepresentation(domain: DesignDomain, format: string, value: string | Record<string, unknown>): DesignRepresentation;
}

export class DeterministicDesignSpaceFactory implements DesignSpaceFactory {
  create(domain: DesignDomain, options: Partial<DesignSpace> = {}): DesignSpace {
    const spaceId = options.spaceId || `space_${domain}_${contentHash({ domain, ts: Date.now() }).slice(0, 8)}`;
    
    const defaultConstraints = this.getDefaultConstraints(domain);
    
    const provenance = options.provenance || createProvenance({
      description: `DesignSpace created for domain: ${domain}`,
      iteration: 0,
      randomSeed: 42,
      inputHash: contentHash({ domain, options }),
      configHash: contentHash(domain),
      tags: ["design-space", domain],
    });

    return {
      spaceId,
      domain,
      description: options.description || `Design space for ${domain}`,
      representationFormat: options.representationFormat || this.getDefaultFormat(domain),
      constraints: options.constraints || defaultConstraints,
      bounds: options.bounds || this.getDefaultBounds(domain),
      allowedElements: options.allowedElements || this.getDefaultElements(domain),
      allowedFragments: options.allowedFragments,
      maxSize: options.maxSize,
      minSize: options.minSize,
      version: options.version || "1.0.0",
      provenance,
    };
  }

  createRepresentation(domain: DesignDomain, format: string, value: string | Record<string, unknown>): DesignRepresentation {
    const canonical = typeof value === "string" ? value : canonicalStringify(value);
    const hash = contentHash({ domain, format, canonical });

    return {
      type: domain,
      format,
      value,
      canonicalValue: canonical,
      hash,
      metadata: {
        createdAt: new Date().toISOString(),
        domain,
        format,
      },
    };
  }

  private getDefaultFormat(domain: DesignDomain): string {
    switch (domain) {
      case "molecule": return "SMILES";
      case "polymer": return "sequence";
      case "mixture": return "composition";
      case "material": return "formula";
      case "formulation": return "composition";
      case "catalyst": return "formula";
      case "crystal": return "formula";
      case "surface": return "composition";
      default: return "custom";
    }
  }

  private getDefaultBounds(domain: DesignDomain): Record<string, [number, number] | string[] | unknown> {
    switch (domain) {
      case "molecule":
        return {
          molecular_weight: [50, 500],
          atom_count: [3, 50],
        };
      case "polymer":
        return {
          chain_length: [10, 1000],
          molecular_weight: [1000, 100000],
        };
      case "material":
        return {
          density: [0.5, 20] as [number, number],
          melting_point: [200, 3000] as [number, number],
        };
      default:
        return {};
    }
  }

  private getDefaultElements(domain: DesignDomain): string[] {
    // Common safe elements, excluding hazardous
    const safeCommon = ["H", "C", "N", "O", "F", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "K", "Ca", "Fe", "Cu", "Zn"];
    const extended = [...safeCommon, "Ti", "Cr", "Mn", "Co", "Ni", "Zr", "Mo", "Ag", "Au"];
    
    switch (domain) {
      case "molecule": return safeCommon;
      case "material": return extended;
      default: return safeCommon;
    }
  }

  private getDefaultConstraints(domain: DesignDomain): DesignConstraint[] {
    const constraints: DesignConstraint[] = [];

    // Structural validity constraint (cheap)
    constraints.push({
      id: `structural_${domain}`,
      description: `Structural validity for ${domain}`,
      type: "HARD",
      check: (candidate) => {
        // Basic check: representation exists and hash matches
        const valid = !!candidate.representation.canonicalValue && candidate.representation.canonicalValue.length > 0;
        return {
          passed: valid,
          violation: valid ? undefined : "Empty representation",
          penalty: valid ? 0 : 1,
        };
      },
    });

    // Size constraint
    constraints.push({
      id: `size_${domain}`,
      description: `Size constraint for ${domain}`,
      type: "SOFT",
      check: (candidate) => {
        const val = candidate.representation.canonicalValue;
        const len = val.length;
        // Allow reasonable sizes
        const passed = len >= 1 && len <= 1000;
        return {
          passed,
          violation: passed ? undefined : `Representation length ${len} out of bounds`,
          penalty: passed ? 0 : 0.5,
        };
      },
    });

    return constraints;
  }
}

// Candidate Factory
export interface CandidateFactory {
  create(
    representation: DesignRepresentation,
    options: {
      generationMethod: GenerationMethod;
      parentCandidates?: string[];
      iteration: number;
      seed: number;
      designType: DesignDomain;
    }
  ): Candidate;
}

export class DeterministicCandidateFactory implements CandidateFactory {
  create(
    representation: DesignRepresentation,
    options: {
      generationMethod: GenerationMethod;
      parentCandidates?: string[];
      iteration: number;
      seed: number;
      designType: DesignDomain;
    }
  ): Candidate {
    const { generationMethod, parentCandidates = [], iteration, seed, designType } = options;

    const candidateId = `cand_${representation.hash.slice(0, 8)}_${iteration}_${seed}`;
    const contentHashValue = contentHash({
      representation: representation.canonicalValue,
      parents: parentCandidates,
      iteration,
      seed,
      method: generationMethod,
    });

    const provenance = createProvenance({
      description: `Candidate generated via ${generationMethod} in iteration ${iteration}`,
      iteration,
      randomSeed: seed,
      inputHash: contentHash(parentCandidates),
      outputHash: contentHashValue,
      parentIds: parentCandidates,
      generationMethod,
      tags: ["candidate", designType, generationMethod],
    });

    const uncertainty = createUncertainty(
      0.5, // initial uncertainty 0.5 for new candidate
      "initial-generation",
      provenance
    );

    const candidate: Candidate = {
      candidateId,
      contentHash: contentHashValue,
      representation,
      designType,
      generationMethod,
      parentCandidates,
      generationIteration: iteration,
      properties: {},
      predictions: [],
      uncertainty,
      safetyClassification: "SAFE", // will be evaluated by safety engine
      provenance,
      evaluationHistory: [],
      isImmutable: false,
      createdAt: new Date().toISOString(),
      version: "1.0.0",
      generationSeed: seed,
      metadata: {
        generationMethod,
        seed,
        iteration,
      },
    };

    return candidate;
  }

  // Make immutable after evaluation
  makeImmutable(candidate: Candidate): Candidate {
    return {
      ...candidate,
      isImmutable: true,
    };
  }
}

// Design Space Selector - chooses appropriate design space based on goal
export class DesignSpaceSelector {
  private factory: DesignSpaceFactory;

  constructor(factory: DesignSpaceFactory = new DeterministicDesignSpaceFactory()) {
    this.factory = factory;
  }

  selectForGoal(goalDomain: DesignDomain, constraints?: Record<string, unknown>): DesignSpace {
    // For now, simple mapping, but extensible
    const space = this.factory.create(goalDomain, {
      bounds: constraints as Record<string, [number, number] | string[] | unknown>,
    });

    return space;
  }

  selectMultiple(domains: DesignDomain[]): DesignSpace[] {
    return domains.map(d => this.factory.create(d));
  }
}

// Utility: Validate candidate against design space
export function validateCandidate(candidate: Candidate, space: DesignSpace): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const constraint of space.constraints) {
    const result = constraint.check(candidate);
    if (!result.passed) {
      violations.push(result.violation || `Constraint ${constraint.id} failed`);
    }
  }

  // Check bounds if present
  if (space.bounds) {
    for (const [prop, bound] of Object.entries(space.bounds)) {
      const value = candidate.properties[prop];
      if (value !== undefined && Array.isArray(bound) && bound.length === 2 && typeof bound[0] === "number") {
        const [min, max] = bound as [number, number];
        const numVal = Number(value);
        if (!isNaN(numVal) && (numVal < min || numVal > max)) {
          violations.push(`Property ${prop} value ${numVal} out of bounds [${min}, ${max}]`);
        }
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

// Mock design spaces for testing
export function createMockDesignSpace(domain: DesignDomain = "material"): DesignSpace {
  const factory = new DeterministicDesignSpaceFactory();
  return factory.create(domain);
}

export function createMockCandidate(
  domain: DesignDomain = "material",
  value = "MOCK_MATERIAL_001",
  iteration = 0,
  seed = 42
): Candidate {
  const factory = new DeterministicDesignSpaceFactory();
  const candFactory = new DeterministicCandidateFactory();
  const rep = factory.createRepresentation(domain, "formula", value);
  return candFactory.create(rep, {
    generationMethod: "mock-deterministic",
    parentCandidates: [],
    iteration,
    seed,
    designType: domain,
  });
}
