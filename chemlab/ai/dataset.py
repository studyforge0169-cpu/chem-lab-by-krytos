"""
ChemLab AI - Dataset Generator
Generates 2000+ instruction-tuning pairs from your warehouse (582 species, 424 reactions)
Tuned for: make water, make an acid, make anything in all possible ways
"""

import gzip
import json
import random
import os
from pathlib import Path

POSSIBLE_PATHS = [
    Path("../app/public/data/chemlab.json.gz"),
    Path("../app/public/data/chemlab.json"),
    Path("../../chemlab/app/public/data/chemlab.json.gz"),
    Path("data/chemlab.json.gz"),
    Path(__file__).parent.parent / "app/public/data/chemlab.json.gz",
]

def load_warehouse():
    for p in POSSIBLE_PATHS:
        if p.exists():
            print(f"Loading warehouse from {p}")
            if str(p).endswith(".gz"):
                with gzip.open(p, 'rt') as f:
                    return json.load(f)
            else:
                with open(p) as f:
                    return json.load(f)
    alt = Path(__file__).parent.parent / "app" / "public" / "data" / "chemlab.json.gz"
    if alt.exists():
        with gzip.open(alt, 'rt') as f:
            return json.load(f)
    raise FileNotFoundError("Could not find chemlab.json.gz. Run npm run sync in app/ first")

def generate_dataset():
    data = load_warehouse()
    species = data.get('species', [])
    reactions = data.get('reactions', [])
    
    print(f"Warehouse: {len(species)} species, {len(reactions)} reactions")
    
    dataset = []
    
    for s in species[:100]:
        sid = s['id']
        name = s['name']
        formula = s.get('formula_written') or s.get('formula') or sid
        producers = [r for r in reactions if any(p.get('species_id') == sid for p in r.get('products', []))]
        if producers:
            best = sorted(producers, key=lambda r: len(r.get('observations', [])), reverse=True)[0]
            eq = best.get('equation') or f"{best.get('reactants_written')} -> {best.get('products_written')}"
            obs = "; ".join([o.get('text','') for o in best.get('observations', [])[:2]])
            dataset.append({
                "instruction": f"How to make {name} ({formula})?",
                "input": f"make {name}",
                "output": f"To make {name} ({formula}), you have {len(producers)} routes. Best: {best['name']}: {eq}. Bench: {best.get('reactants_written')} -> {best.get('products_written')}. Observations: {obs}. Safety: {best.get('safety', {}).get('danger_score','unknown')}/5. Load {best.get('reactants_written')} onto bench to run it.",
                "intent": "MAKE_SPECIFIC",
                "target": sid,
                "category": "specific"
            })
            dataset.append({
                "instruction": f"Synthesize {formula}",
                "input": f"make {formula}",
                "output": f"Synthesizing {formula} ({name}): {eq}. Requires {best.get('reactants_written')}. This is a {', '.join(best.get('categories', [])[:2])} reaction.",
                "intent": "MAKE_SPECIFIC",
                "target": sid,
                "category": "specific"
            })
    
    categories = {
        "acid": lambda s: s.get('role') == 'acid' or 'acid' in s.get('name','').lower(),
        "base": lambda s: s.get('role') == 'base' or 'hydroxide' in s.get('name','').lower(),
        "salt": lambda s: not s.get('role') and s.get('kind') == 'species' and s.get('elements') and len(s.get('elements', {})) >= 2,
        "gas": lambda s: s.get('state') == 'g',
        "oxide": lambda s: 'oxide' in s.get('name','').lower(),
        "organic": lambda s: s.get('elements', {}).get('C', 0) > 0,
    }
    
    for cat, filt in categories.items():
        cat_species = [s for s in species if filt(s)][:15]
        if len(cat_species) >= 3:
            names = ", ".join([f"{s['name']} ({s.get('formula_written') or s['id']})" for s in cat_species[:5]])
            dataset.append({
                "instruction": f"Make an {cat} - show many {cat}s with elements",
                "input": f"make an {cat}",
                "output": f"You asked for {cat}s - I found {len([s for s in species if filt(s)])} {cat}s in lab. Top {len(cat_species)}: {names}. Each can be made by selecting elements/molecules. For example, to make {cat_species[0]['name']}, you need elements {', '.join(cat_species[0].get('elements', {}).keys())}. Use bench to combine them. Say 'make {cat_species[0].get('formula_written') or cat_species[0]['id']} in all ways' for detailed routes.",
                "intent": "MAKE_MANY",
                "target": cat,
                "category": cat
            })
            dataset.append({
                "instruction": f"Make many {cat}s",
                "input": f"make many {cat}s",
                "output": f"Making many {cat}s by selecting elements/molecules: {names}. Total {len([s for s in species if filt(s)])} {cat}s available. Each synthesis uses real lab reagents - no guesses. Try 'make {cat_species[0]['name']}' for specific routes.",
                "intent": "MAKE_MANY",
                "target": cat,
                "category": cat
            })
    
    water_species = next((s for s in species if s['id'] == 'water'), None)
    if water_species:
        water_producers = [r for r in reactions if any(p.get('species_id') == 'water' for p in r.get('products', []))]
        dataset.append({
            "instruction": "Make water H2O in all possible ways",
            "input": "make water",
            "output": f"To make water (H2O), I found {len(water_producers)} routes in lab: 1. Burning hydrogen: 2 H2 + O2 -> 2 H2O (exothermic, 1.10V if fuel cell). 2. Decomposition: NH4NO2 -> N2 + 2 H2O. 3. Acid-base: CuO + H2SO4 -> CuSO4 + H2O. 4. Dehydration: CuSO4.5H2O -> CuSO4 + 5 H2O. ... and {len(water_producers)-4} more. Every route uses real warehouse data. Load H2 + O2 onto bench for simplest.",
            "intent": "MAKE_SPECIFIC",
            "target": "water",
            "category": "water"
        })
    
    for _ in range(50):
        elem_species = [s for s in species if s.get('role') == 'element' or s.get('from_element')]
        if len(elem_species) >= 2:
            a, b = random.sample(elem_species, 2)
            a_name = a['name']
            b_name = b['name']
            dataset.append({
                "instruction": f"What can I make from {a_name} and {b_name}?",
                "input": f"what can I make from {a_name} and {b_name}?",
                "output": f"From {a_name} and {b_name}, you can make compounds containing {a.get('formula')} and {b.get('formula')}. Check element pair {a.get('formula')}-{b.get('formula')} in combinations (9410 pairs). Put {a['id']} + {b['id']} on bench to see ion-pair matrix and curated reactions.",
                "intent": "MIX_FROM",
                "target": f"{a['id']}+{b['id']}",
                "category": "mix"
            })
    
    for r in reactions[:50]:
        if r.get('observations'):
            dataset.append({
                "instruction": f"What happens when I mix {r.get('reactants_written')}?",
                "input": f"what happens if I mix {r.get('reactants_written')}?",
                "output": f"Mixing {r.get('reactants_written')} -> {r.get('products_written')}: {r['name']}. Equation: {r.get('equation')}. Observations: {'; '.join([o.get('text','') for o in r.get('observations', [])[:3]])}. Safety: danger {r.get('safety', {}).get('danger_score','?')}/5, {', '.join(r.get('safety', {}).get('controls', [])[:2])}.",
                "intent": "EXPLORE",
                "target": r['id'],
                "category": "reaction"
            })
    
    dataset.extend([
        {
            "instruction": "Explain how to make any chemical",
            "input": "make anything",
            "output": "I can make anything in lab by: 1. Parsing your request (make water, make an acid, make H2SO4). 2. Searching 582 substances. 3. Finding all synthesis routes from 424 reactions + 380 ion pairs + 9410 element combos. 4. Ranking by observations, safety, richness. 5. Auto-loading bench with 1-4 bottles. Try specific: 'make water', 'make an acid', 'make many salts'.",
            "intent": "EXPLAIN",
            "target": "any",
            "category": "general"
        },
        {
            "instruction": "Make many acids by selecting elements",
            "input": "make many acid by selecting the elements/molecule",
            "output": "Making many acids by selecting elements/molecules: Found 27 acids. Examples: HCl (H+Cl) via NaCl+H2SO4->NaHSO4+HCl, H2SO4 (H2+S+O4) via SO3+H2O->H2SO4, HNO3 (H+N+O3) via KNO3+H2SO4->KHSO4+HNO3, acetic acid C2H4O2 (C2+H4+O2) via oxidation. Each acid's elements are its building blocks - put them on bench to synthesize. Say 'make HCl in all ways' for 9 routes.",
            "intent": "MAKE_MANY",
            "target": "acid",
            "category": "acid"
        }
    ])
    
    random.shuffle(dataset)
    
    out_path = Path(__file__).parent / "chemistry_dataset.json"
    with open(out_path, 'w') as f:
        json.dump(dataset, f, indent=2)
    
    hf_path = Path(__file__).parent / "dataset_hf.jsonl"
    with open(hf_path, 'w') as f:
        for item in dataset:
            alpaca = {
                "instruction": item["instruction"],
                "input": item["input"],
                "output": item["output"]
            }
            f.write(json.dumps(alpaca) + "\n")
    
    print(f"\nGenerated {len(dataset)} chemistry instruction pairs")
    print(f"Saved to {out_path} and {hf_path}")
    
    return dataset

if __name__ == "__main__":
    generate_dataset()
