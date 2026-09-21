/**
 * CHEMISTRY AI — CHEMISTRY SPECIFICATION
 * Phase: Chemistry Specification - normalized intermediate representation
 * Converts ChemistryGoal into machine-readable requirements
 */

import {
  ChemistryGoal,
  ChemistrySpecification,
  PropertyTarget,
  Constraint,
  TargetProperty,
  contentHash,
  createProvenance,
  DEFAULT_SEARCH_CONFIG,
} from "./domain.js";

export interface ChemistrySpecBuilder {
  build(goal: ChemistryGoal): Promise<ChemistrySpecification>;
  buildSync(goal: ChemistryGoal): ChemistrySpecification;
}

export class DeterministicChemistrySpecBuilder implements ChemistrySpecBuilder {
  buildSync(goal: ChemistryGoal): ChemistrySpecification {
    const specId = `spec_${goal.goalId}_${contentHash({ goalId: goal.goalId, ts: Date.now() }).slice(0, 8)}`;

    // Convert TargetProperty to PropertyTarget
    const propertyTargets: PropertyTarget[] = goal.targetProperties.map(tp => this.convertTargetProperty(tp, goal));

    // Normalize weights
    const totalWeight = propertyTargets.reduce((sum, pt) => sum + pt.weight, 0);
    const normalizedTargets = propertyTargets.map(pt => ({
      ...pt,
      weight: totalWeight > 0 ? pt.weight / totalWeight : 1 / propertyTargets.length,
    }));

    const weights: Record<string, number> = {};
    for (const pt of normalizedTargets) {
      weights[pt.property] = pt.weight;
    }

    // Merge constraints
    const constraints = [...goal.constraints];

    // Add implicit constraints from property targets that are hard
    for (const tp of goal.targetProperties) {
      if (tp.constraintType === "HARD" && tp.targetValue !== undefined) {
        const existing = constraints.find(c => c.property === tp.property);
        if (!existing) {
          constraints.push({
            id: `implicit_${tp.property}`,
            property: tp.property,
            type: "HARD",
            operator: this.getOperatorForDirection(tp.direction),
            value: tp.targetValue,
            description: `Implicit hard constraint from target property ${tp.property}`,
            provenance: `spec-builder:implicit-from-${tp.property}`,
          });
        }
      }
    }

    const provenance = createProvenance({
      description: `ChemistrySpecification built from goal ${goal.goalId}`,
      iteration: 0,
      randomSeed: goal.provenance.randomSeed,
      inputHash: contentHash(goal),
      configHash: contentHash({ goalId: goal.goalId }),
      parentIds: [goal.goalId],
      goalId: goal.goalId,
      tags: ["chemistry-spec", goal.designType],
    });

    const spec: ChemistrySpecification = {
      specId,
      goalId: goal.goalId,
      description: `Specification for: ${goal.objective}`,
      propertyTargets: normalizedTargets,
      constraints,
      environment: goal.environment,
      designDomain: goal.designType,
      exclusions: goal.exclusions,
      safetyLevel: goal.safetyLevel,
      evaluationBudget: {
        maxIterations: goal.evaluationBudget?.maxIterations ?? DEFAULT_SEARCH_CONFIG.maxIterations,
        maxCandidates: goal.evaluationBudget?.maxCandidates ?? DEFAULT_SEARCH_CONFIG.maxCandidates,
        maxTimeMs: goal.evaluationBudget?.maxTimeMs ?? 60000,
        computeBudget: goal.evaluationBudget?.computeBudget ?? "low",
      },
      uncertaintyRequirements: {
        maxUncertainty: goal.uncertaintyRequirements?.maxUncertainty ?? 0.5,
        requireConfidenceInterval: goal.uncertaintyRequirements?.requireConfidenceInterval ?? false,
        minConfidence: goal.uncertaintyRequirements?.minConfidence ?? 0.5,
      },
      weights,
      createdAt: new Date().toISOString(),
      version: "1.0.0",
      provenance,
      rawGoal: goal,
      toJSON() {
        return {
          specId: this.specId,
          goalId: this.goalId,
          description: this.description,
          propertyTargets: this.propertyTargets.map(pt => ({
            property: pt.property,
            target: pt.target,
            direction: pt.direction,
            weight: pt.weight,
            constraintType: pt.constraintType,
            confidence: pt.confidence,
            isHardConstraint: pt.isHardConstraint,
            unit: pt.unit,
          })),
          constraints: this.constraints,
          environment: this.environment,
          designDomain: this.designDomain,
          exclusions: this.exclusions,
          safetyLevel: this.safetyLevel,
          evaluationBudget: this.evaluationBudget,
          uncertaintyRequirements: this.uncertaintyRequirements,
          weights: this.weights,
          createdAt: this.createdAt,
          version: this.version,
        };
      },
    };

    return spec;
  }

  async build(goal: ChemistryGoal): Promise<ChemistrySpecification> {
    return this.buildSync(goal);
  }

  private convertTargetProperty(tp: TargetProperty, goal: ChemistryGoal): PropertyTarget {
    const provenance = createProvenance({
      description: `PropertyTarget for ${tp.property} from goal ${goal.goalId}`,
      iteration: 0,
      randomSeed: goal.provenance.randomSeed,
      inputHash: contentHash(tp),
      configHash: contentHash({ property: tp.property }),
      parentIds: [goal.goalId],
      tags: ["property-target", tp.property, tp.direction],
    });

    return {
      property: tp.property,
      target: tp.targetValue,
      direction: tp.direction,
      weight: tp.importanceWeight,
      constraintType: tp.constraintType,
      confidence: tp.confidence,
      source: tp.provenance,
      provenance,
      unit: tp.unit,
      isHardConstraint: tp.constraintType === "HARD",
    };
  }

  private getOperatorForDirection(direction: string): Constraint["operator"] {
    switch (direction) {
      case "maximize": return "gte";
      case "minimize": return "lte";
      case "target-value": return "eq";
      case "target-range": return "range";
      default: return "gte";
    }
  }
}

export function createChemistrySpecBuilder(): ChemistrySpecBuilder {
  return new DeterministicChemistrySpecBuilder();
}

// Utility to validate spec
export function validateSpecification(spec: ChemistrySpecification): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!spec.specId) errors.push("Missing specId");
  if (!spec.goalId) errors.push("Missing goalId");
  if (!spec.propertyTargets || spec.propertyTargets.length === 0) errors.push("No property targets");
  if (!spec.designDomain) errors.push("Missing designDomain");

  for (const pt of spec.propertyTargets) {
    if (!pt.property) errors.push("PropertyTarget missing property name");
    if (pt.weight < 0 || pt.weight > 1) errors.push(`Invalid weight for ${pt.property}: ${pt.weight}`);
    if (pt.confidence < 0 || pt.confidence > 1) errors.push(`Invalid confidence for ${pt.property}: ${pt.confidence}`);
  }

  // Check weights sum to ~1
  const totalWeight = spec.propertyTargets.reduce((sum, pt) => sum + pt.weight, 0);
  if (Math.abs(totalWeight - 1) > 0.01 && spec.propertyTargets.length > 0) {
    errors.push(`Weights sum to ${totalWeight}, expected ~1`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
