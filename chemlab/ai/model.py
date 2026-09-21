"""
ChemLab AI - Inference with tuned model
"""

import argparse
import json
from pathlib import Path

try:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    import torch
    HAS_TRANSFORMERS = True
except ImportError:
    HAS_TRANSFORMERS = False

CHEM_SYSTEM_PROMPT = """You are ChemLab AI, an autonomous chemist controlling a virtual lab.
WAREHOUSE: 582 substances, 424 reactions, 9410 element pairs, 380 ion pairs
CAPABILITIES: make water (64 routes), make an acid (many acids by selecting elements), make anything in all possible ways
RULES: Only use curated reactions, no hallucinations, give bench setup, safety, observations
"""

def mock_inference(query):
    q = query.lower()
    if "water" in q or "h2o" in q:
        return {
            "intent": "MAKE_SPECIFIC",
            "targets": ["water"],
            "category": "water",
            "routes": [
                {"reaction_id": "syn_h2o", "equation": "2 H2 + O2 -> 2 H2O", "bench": ["h2gas:1mol", "o2:1mol"], "type": "direct", "observations": ["colourless gas burns", "water condenses"]},
                {"reaction_id": "dec_cuso4", "equation": "CuSO4.5H2O -> CuSO4 + 5 H2O", "bench": ["cuso4_5h2o:1mol"], "type": "decomposition"},
            ],
            "explanation": f"To make water (H2O), I found 64 routes in lab. Best: Burning hydrogen 2 H2 + O2 -> 2 H2O. Bench: H2 + O2. You'll see water condense. Safety: exothermic, use small scale.",
            "bench_plans": [{"label": "water via H2+O2", "items": [{"species_id": "h2gas", "qty": 2, "unit": "mol"}, {"species_id": "o2", "qty": 1, "unit": "mol"}]}]
        }
    elif "acid" in q:
        many = "many" in q or "all" in q or "an acid" in q
        return {
            "intent": "MAKE_MANY" if many else "MAKE_CATEGORY",
            "targets": ["hcl", "h2so4", "hno3", "aceticacid", "formicacid"],
            "category": "acid",
            "routes": [
                {"reaction_id": "syn_hcl", "equation": "NaCl + H2SO4 -> NaHSO4 + HCl", "bench": ["nacl:1mol", "h2so4:1mol"], "elements": ["Na","Cl","H2","S","O4"]},
                {"reaction_id": "syn_h2so4", "equation": "SO3 + H2O -> H2SO4", "bench": ["so3:1mol", "water:1mol"], "elements": ["S","O3","H2","O"]},
            ],
            "explanation": "Making many acids by selecting elements/molecules: Found 27 acids. HCl (H+Cl) via NaCl+H2SO4, H2SO4 (H2+S+O4) via SO3+H2O, HNO3 (H+N+O3) via KNO3+H2SO4, acetic acid C2H4O2 via oxidation. Each acid's elements are building blocks.",
            "bench_plans": [
                {"label": "HCl via NaCl+H2SO4", "items": [{"species_id": "nacl", "qty": 1, "unit": "mol"}, {"species_id": "h2so4", "qty": 1, "unit": "mol"}]},
                {"label": "H2SO4 via SO3+H2O", "items": [{"species_id": "so3", "qty": 1, "unit": "mol"}, {"species_id": "water", "qty": 1, "unit": "mol"}]},
            ]
        }
    else:
        return {
            "intent": "EXPLORE",
            "targets": [],
            "category": "any",
            "routes": [],
            "explanation": f"I understand you want '{query}'. Try: make water, make an acid, make many acids, make H2SO4 in all ways, what can I make from Na and Cl?",
            "bench_plans": []
        }

def run_model(model_path, query):
    if not HAS_TRANSFORMERS:
        return mock_inference(query)
    try:
        print(f"Loading model {model_path}...")
        tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
        model = AutoModelForCausalLM.from_pretrained(
            model_path,
            torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
            device_map="auto" if torch.cuda.is_available() else None,
            trust_remote_code=True,
        )
        prompt = f"{CHEM_SYSTEM_PROMPT}\n\nUser: {query}\nAssistant: "
        inputs = tokenizer(prompt, return_tensors="pt")
        print("Generating...")
        with torch.no_grad():
            outputs = model.generate(**inputs, max_new_tokens=512, temperature=0.7, do_sample=True, top_p=0.9)
        response = tokenizer.decode(outputs[0], skip_special_tokens=True)
        if "Assistant:" in response:
            response = response.split("Assistant:")[-1].strip()
        print(f"\nModel response:\n{response}\n")
        try:
            import re
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
        except:
            pass
        return {"intent": "MAKE_SPECIFIC", "targets": [], "category": "any", "routes": [], "explanation": response, "bench_plans": []}
    except Exception as e:
        print(f"Model inference failed: {e}, using mock")
        return mock_inference(query)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="TinyLlama/TinyLlama-1.1B-Chat-v1.0")
    parser.add_argument("--query", default="make water")
    parser.add_argument("--api", action="store_true")
    args = parser.parse_args()
    if args.api:
        from api import app
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8000)
    else:
        result = run_model(args.model, args.query)
        print(json.dumps(result, indent=2))
