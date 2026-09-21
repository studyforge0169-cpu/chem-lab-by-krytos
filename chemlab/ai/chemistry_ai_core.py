"""
CHEMISTRY AI — PYTHON CORE (Mirror of TS implementation)
Goal-driven computational chemistry/design engine — SEARCH ENGINE FIRST

Implements same pipeline as TS version but in Python for backend integration
"""

import hashlib
import json
import random
import time
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any, Optional, Tuple
from enum import Enum

# ============================================================================
# ENUMS
# ============================================================================

class OptimizationDirection(str, Enum):
    MAXIMIZE = "maximize"
    MINIMIZE = "minimize"
    TARGET_RANGE = "target-range"
    TARGET_VALUE = "target-value"
    ANY = "any"

class ConstraintType(str, Enum):
    HARD = "HARD"
    SOFT = "SOFT"

class DesignDomain(str, Enum):
    MOLECULE = "molecule"
    POLYMER = "polymer"
    MIXTURE = "mixture"
    MATERIAL = "material"
    FORMULATION = "formulation"
    CATALYST = "catalyst"
    CRYSTAL = "crystal"
    SURFACE = "surface"
    USER_DEFINED = "user-defined"

class SafetyClassification(str, Enum):
    SAFE = "SAFE"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    RESTRICTED = "RESTRICTED"
    BLOCKED = "BLOCKED"

class GenerationMethod(str, Enum):
    RANDOM = "random"
    FRAGMENT = "fragment"
    EVOLUTIONARY = "evolutionary"
    BAYESIAN = "bayesian"
    GRAPH = "graph"
    GENERATIVE_MODEL = "generative-model"
    MOCK = "mock-deterministic"

# ============================================================================
# UTILITIES - DETERMINISTIC
# ============================================================================

def content_hash(obj: Any) -> str:
    """Deterministic FNV-1a hash"""
    s = json.dumps(obj, sort_keys=True, default=str)
    h = 2166136261
    for c in s:
        h ^= ord(c)
        h = (h * 16777619) & 0xFFFFFFFF
    return format(h, '08x')

def deterministic_random(seed: int):
    """Mulberry32 deterministic PRNG"""
    def rand():
        nonlocal seed
        seed = (seed + 0x6D2B79F5) & 0xFFFFFFFF
        t = seed
        t = (t ^ (t >> 15)) * (t | 1) & 0xFFFFFFFF
        t ^= t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return rand

MOCK_WARNING = "MOCK PREDICTOR - NOT SCIENTIFICALLY VALIDATED - FOR PIPELINE TESTING ONLY"
SAFETY_DISCLAIMER = "COMPUTATIONAL PREDICTIONS ONLY - NOT EXPERIMENTALLY VALIDATED"

# ============================================================================
# DOMAIN MODELS
# ============================================================================

@dataclass
class TargetProperty:
    property: str
    direction: OptimizationDirection
    target_value: Optional[Any] = None
    unit: Optional[str] = None
    importance_weight: float = 1.0
    constraint_type: ConstraintType = ConstraintType.SOFT
    confidence: float = 0.6
    provenance: str = ""
    is_explicit: bool = False
    ambiguity: Optional[str] = None

@dataclass
class ChemistryGoal:
    goal_id: str
    objective: str
    target_properties: List[TargetProperty]
    design_type: DesignDomain
    safety_level: SafetyClassification
    exclusions: List[str] = field(default_factory=list)
    ambiguity_flags: List[str] = field(default_factory=list)
    raw_input: str = ""
    created_at: str = ""
    provenance: Dict[str, Any] = field(default_factory=dict)

@dataclass
class Candidate:
    candidate_id: str
    content_hash: str
    representation: str
    design_type: DesignDomain
    generation_method: GenerationMethod
    parent_candidates: List[str] = field(default_factory=list)
    generation_iteration: int = 0
    predictions: List[Dict[str, Any]] = field(default_factory=list)
    score: float = 0.0
    safety_classification: SafetyClassification = SafetyClassification.SAFE
    provenance: Dict[str, Any] = field(default_factory=dict)
    uncertainty: float = 0.5

# ============================================================================
# GOAL INTERPRETER
# ============================================================================

PROPERTY_KEYWORDS = {
    "tensile strength": ("tensile_strength", "MPa", OptimizationDirection.MAXIMIZE),
    "adhesion": ("adhesion", None, OptimizationDirection.MAXIMIZE),
    "solidification": ("solidification_rate", None, OptimizationDirection.MAXIMIZE),
    "rapid solidification": ("solidification_rate", None, OptimizationDirection.MAXIMIZE),
}

HAZARDOUS_KEYWORDS = ["explosive", "chemical weapon", "bioweapon", "detonate", "bomb"]

class GoalInterpreter:
    def parse(self, objective: str) -> ChemistryGoal:
        lower = objective.lower()
        
        # Safety
        safety = SafetyClassification.SAFE
        for kw in HAZARDOUS_KEYWORDS:
            if kw in lower:
                safety = SafetyClassification.BLOCKED
        
        # Properties
        targets = []
        ambiguities = []
        for kw, (prop, unit, direction) in PROPERTY_KEYWORDS.items():
            if kw in lower:
                targets.append(TargetProperty(
                    property=prop,
                    direction=direction,
                    unit=unit,
                    provenance=f"keyword:{kw}",
                    is_explicit=False
                ))
        
        if not targets:
            ambiguities.append(f"No explicit property targets in: {objective[:100]}")
            targets.append(TargetProperty(
                property="general_performance",
                direction=OptimizationDirection.MAXIMIZE,
                confidence=0.3,
                provenance="fallback:ambiguous"
            ))
        
        # Design type
        design_type = DesignDomain.MATERIAL
        if "molecule" in lower:
            design_type = DesignDomain.MOLECULE
        
        goal_id = f"goal_{content_hash({'obj': objective, 'ts': time.time()})[:12]}_{int(time.time())}"
        
        return ChemistryGoal(
            goal_id=goal_id,
            objective=objective,
            target_properties=targets,
            design_type=design_type,
            safety_level=safety,
            ambiguity_flags=ambiguities,
            raw_input=objective,
            created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            provenance={"description": f"Goal parsed from {objective[:50]}", "tags": ["goal-interpreter"]}
        )

# ============================================================================
# GENERATORS (MOCK DETERMINISTIC)
# ============================================================================

class CandidateGenerator:
    def __init__(self, seed=42):
        self.seed = seed
    
    def generate(self, spec, design_space, previous, budget, iteration) -> List[Candidate]:
        rand = deterministic_random(self.seed + iteration)
        candidates = []
        elements = ["Fe", "Al", "C", "O", "Si"]
        
        for i in range(min(budget, 100)):
            comp = "".join([f"{elements[int(rand()*len(elements))]}{int(rand()*3)+1}" for _ in range(2)])
            value = f"{comp}_ITER{iteration}_IDX{i}"
            chash = content_hash({"rep": value, "iter": iteration, "seed": self.seed})
            cand_id = f"cand_{chash[:8]}_{iteration}_{self.seed}"
            
            candidates.append(Candidate(
                candidate_id=cand_id,
                content_hash=chash,
                representation=value,
                design_type=DesignDomain.MATERIAL,
                generation_method=GenerationMethod.RANDOM,
                generation_iteration=iteration,
                provenance={"description": f"Generated via random iter {iteration}"}
            ))
        
        return candidates

# ============================================================================
# PREDICTORS (MOCK)
# ============================================================================

class MockPredictor:
    def __init__(self, property_name: str):
        self.property = property_name
        self.model_id = f"mock-{property_name}"
        self.is_mock = True
    
    def predict(self, candidate: Candidate) -> Dict[str, Any]:
        seed = int(candidate.content_hash[:8], 16) if candidate.content_hash[:8].isalnum() else 42
        rand = deterministic_random(seed)()
        value = 100 + rand * 900 if self.property == "tensile_strength" else rand * 10
        
        return {
            "property": self.property,
            "predicted_value": value,
            "confidence": 0.6,
            "is_mock": True,
            "warning": MOCK_WARNING,
            "model_id": self.model_id,
            "uncertainty": 0.3 + rand * 0.3
        }

class PredictorRegistry:
    def __init__(self):
        self.predictors: Dict[str, MockPredictor] = {}
    
    def register(self, prop: str):
        self.predictors[prop] = MockPredictor(prop)
    
    def predict(self, candidate: Candidate, properties: List[str]) -> List[Dict[str, Any]]:
        return [self.predictors[p].predict(candidate) for p in properties if p in self.predictors]
    
    @staticmethod
    def create_mock(properties: List[str]):
        reg = PredictorRegistry()
        for p in properties:
            reg.register(p)
        return reg

# ============================================================================
# SAFETY ENGINE
# ============================================================================

class SafetyEngine:
    def evaluate(self, candidate: Candidate) -> Dict[str, Any]:
        rep_lower = candidate.representation.lower()
        classification = SafetyClassification.SAFE
        flags = []
        
        for kw in HAZARDOUS_KEYWORDS:
            if kw in rep_lower:
                flags.append(kw)
                classification = SafetyClassification.BLOCKED
        
        return {
            "classification": classification,
            "hazardous_flags": flags,
            "blocked": classification == SafetyClassification.BLOCKED,
            "explanation": f"Classified as {classification}, flags: {flags}"
        }

# ============================================================================
# SEARCH CONTROLLER
# ============================================================================

class SearchController:
    def __init__(self, generator, predictor_registry, safety_engine):
        self.generator = generator
        self.predictor_registry = predictor_registry
        self.safety_engine = safety_engine
    
    def run_search(self, goal: ChemistryGoal, budget_per_iter=10, max_iters=2):
        all_candidates = []
        
        for iteration in range(max_iters):
            # Generate
            candidates = self.generator.generate(None, None, all_candidates, budget_per_iter, iteration)
            
            # Predict
            for cand in candidates:
                props = [tp.property for tp in goal.target_properties]
                preds = self.predictor_registry.predict(cand, props)
                cand.predictions = preds
                # Simple scoring: sum of predicted values
                cand.score = sum([p["predicted_value"] if isinstance(p["predicted_value"], (int, float)) else 0 for p in preds])
            
            # Safety filter
            safe_candidates = []
            for cand in candidates:
                safety = self.safety_engine.evaluate(cand)
                if not safety["blocked"]:
                    safe_candidates.append(cand)
            
            # Sort by score
            safe_candidates.sort(key=lambda c: c.score, reverse=True)
            all_candidates.extend(safe_candidates)
            
            print(f"[Search] Iter {iteration+1}: Generated {len(candidates)}, Safe {len(safe_candidates)}, Best score {safe_candidates[0].score if safe_candidates else 0:.2f}")
        
        # Final top
        all_candidates.sort(key=lambda c: c.score, reverse=True)
        final = all_candidates[:10]
        
        return {
            "final_candidates": final,
            "total_generated": len(all_candidates),
            "iterations": max_iters
        }

# ============================================================================
# DEMO
# ============================================================================

def run_demo():
    interpreter = GoalInterpreter()
    generator = CandidateGenerator(seed=42)
    registry = PredictorRegistry.create_mock(["tensile_strength", "adhesion", "solidification_rate"])
    safety = SafetyEngine()
    controller = SearchController(generator, registry, safety)
    
    objectives = [
        "Design a material with extremely high tensile strength.",
        "Find a material with rapid solidification and strong adhesion.",
    ]
    
    for obj in objectives:
        print("\n" + "="*80)
        print(f"OBJECTIVE: {obj}")
        print("="*80)
        goal = interpreter.parse(obj)
        print(f"Goal ID: {goal.goal_id}, Safety: {goal.safety_level}, Targets: {[tp.property for tp in goal.target_properties]}")
        
        if goal.safety_level == SafetyClassification.BLOCKED:
            print(f"BLOCKED: {goal.objective}")
            continue
        
        result = controller.run_search(goal, budget_per_iter=20, max_iters=2)
        print(f"\nTop candidates:")
        for i, cand in enumerate(result["final_candidates"][:3]):
            print(f"  {i+1}. {cand.candidate_id}: {cand.representation[:50]} Score={cand.score:.2f} Predictions={cand.predictions}")

if __name__ == "__main__":
    run_demo()
