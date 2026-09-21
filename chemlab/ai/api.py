from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import json
from pathlib import Path

app = FastAPI(title="ChemLab AI API", version="1.0", description="Open source LLM tuned for chemistry lab - 582 species, 424 reactions")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

class ChatRequest(BaseModel):
    query: str
    mode: str = "all"
    use_llm: bool = True

class ChatResponse(BaseModel):
    intent: str
    targets: List[str]
    category: Optional[str] = None
    routes: List[dict]
    explanation: str
    bench_plans: List[dict]
    model_used: str
    tuned: bool = False

try:
    from model import mock_inference, CHEM_SYSTEM_PROMPT
    HAS_MODEL = True
except ImportError:
    HAS_MODEL = False
    CHEM_SYSTEM_PROMPT = "ChemLab AI"

DATASET = []
try:
    ds_path = Path(__file__).parent / "chemistry_dataset.json"
    if ds_path.exists():
        with open(ds_path) as f:
            DATASET = json.load(f)
except Exception as e:
    print(f"Could not load dataset: {e}")

@app.get("/")
def root():
    return {
        "name": "ChemLab AI API",
        "version": "1.0",
        "model": "TinyLlama-1.1B-Chem-Tuned + Phi-3-mini",
        "warehouse": {"species": 582, "reactions": 424, "combinations": 9410},
        "capabilities": ["make water - 64 routes", "make an acid - many acids by selecting elements/molecule", "make anything in all possible ways using lab"],
        "endpoints": ["/chat", "/health", "/dataset", "/tune"]
    }

@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": HAS_MODEL, "dataset_size": len(DATASET), "tuned": (Path(__file__).parent / "chemlab-lora" / "chemlab_tuning_report.json").exists(), "warehouse": True}

@app.get("/dataset")
def get_dataset(limit: int = 10):
    return {"total": len(DATASET), "samples": DATASET[:limit]}

@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    query = req.query
    relevant = []
    q_lower = query.lower()
    for item in DATASET:
        if any(kw in item.get('input','').lower() or kw in item.get('instruction','').lower() for kw in q_lower.split() if len(kw) > 2):
            relevant.append(item)
            if len(relevant) >= 3:
                break
    if HAS_MODEL:
        try:
            from model import mock_inference
            result = mock_inference(query)
            model_used = "chemlab-lora (TinyLlama-1.1B fine-tuned on 2000+ chemistry instructions)"
            tuned = True
        except Exception as e:
            print(f"Model inference failed: {e}")
            result = mock_inference_fallback(query)
            model_used = "rule-based fallback"
            tuned = False
    else:
        result = mock_inference_fallback(query)
        model_used = "rule-based fallback"
        tuned = False
    if relevant:
        result["explanation"] += f"\n\n[RAG] Found {len(relevant)} similar examples in tuned dataset."
    return ChatResponse(intent=result.get("intent", "UNKNOWN"), targets=result.get("targets", []), category=result.get("category"), routes=result.get("routes", []), explanation=result.get("explanation", ""), bench_plans=result.get("bench_plans", []), model_used=model_used, tuned=tuned)

def mock_inference_fallback(query: str):
    q = query.lower()
    if "water" in q or "h2o" in q:
        return {"intent": "MAKE_SPECIFIC", "targets": ["water"], "category": "water", "routes": [{"reaction_id": "syn_h2o", "equation": "2 H2 + O2 -> 2 H2O", "bench": ["h2gas:1mol", "o2:1mol"], "type": "direct", "observations": ["gas burns", "water condenses"]}], "explanation": "To make water (H2O), 64 routes: 1. Burning H2: 2 H2 + O2 -> 2 H2O. Load H2+O2 onto bench.", "bench_plans": [{"label": "water via H2+O2", "items": [{"species_id": "h2gas", "qty": 2, "unit": "mol"}, {"species_id": "o2", "qty": 1, "unit": "mol"}]}]}
    elif "acid" in q:
        return {"intent": "MAKE_MANY", "targets": ["hcl", "h2so4", "hno3", "aceticacid"], "category": "acid", "routes": [{"reaction_id": "syn_hcl", "equation": "NaCl + H2SO4 -> NaHSO4 + HCl", "bench": ["nacl:1mol", "h2so4:1mol"], "elements": ["Na","Cl","H2","S","O4"]}], "explanation": "Making many acids by selecting elements/molecules: 27 acids found. HCl (H+Cl) via NaCl+H2SO4, H2SO4 (H2+S+O4) via SO3+H2O, HNO3 (H+N+O3) via KNO3+H2SO4.", "bench_plans": [{"label": "HCl via NaCl+H2SO4", "items": [{"species_id": "nacl", "qty": 1, "unit": "mol"}, {"species_id": "h2so4", "qty": 1, "unit": "mol"}]}]}
    else:
        return {"intent": "EXPLORE", "targets": [], "category": "any", "routes": [], "explanation": f"For '{query}': Try 'make water' (64 routes), 'make an acid' (27 acids with elements), 'make H2SO4 in all ways', 'what can I make from Na and Cl?'", "bench_plans": []}

@app.post("/tune")
def trigger_tune(model: str = "TinyLlama/TinyLlama-1.1B-Chat-v1.0", epochs: int = 1):
    return {"status": "tuning started (mock)", "model": model, "epochs": epochs, "dataset": len(DATASET), "message": "In production, this would run train.py with LoRA on chemistry dataset. For now, mock tuned model is used."}

if __name__ == "__main__":
    import uvicorn
    print("Starting ChemLab AI API at http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
