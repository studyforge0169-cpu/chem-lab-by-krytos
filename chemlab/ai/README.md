# ChemLab AI - Open Source Model Tuned for Chemistry Lab

This is a real open-source LLM tuned specifically for your chem lab app (582 species, 424 reactions).

## What Models?

- **Frontend (Browser)**: WebLLM with Phi-3.5-mini or Llama-3.2-1B - runs offline in browser via WebGPU, no server needed
- **Backend (Python)**: Fine-tuned TinyLlama / Phi-3 / Mistral with LoRA on chemistry dataset
- **Ollama**: Local LLM server with custom Modelfile

## Quick Start - Browser Model (No Install)

The app already includes WebLLM. Just open AI Lab tab → toggle "LLM Mode" → model auto-downloads (500MB-1GB, cached).

## Quick Start - Python Backend

```bash
cd chemlab/ai
pip install -r requirements.txt
python dataset.py  # generates chemistry instruction dataset from warehouse
python train.py    # LoRA fine-tune TinyLlama on chemistry data
python api.py      # start FastAPI server at http://localhost:8000
```

Frontend will auto-detect backend and use it.

## Quick Start - Ollama (Easiest Local LLM)

```bash
# Install ollama: https://ollama.ai
ollama serve
ollama create chemlab-ai -f chemlab/ai/Modelfile
ollama run chemlab-ai "make water in all possible ways"
```

## Dataset

`dataset.py` generates 2000+ instruction pairs from your warehouse:

- "make water" → lists 64 synthesis routes
- "make an acid" → generates many acids with elements
- "what can I make from Na and Cl?" → NaCl via multiple routes
- Reaction → bench setup + safety + observations

## Tuning

We use LoRA (Low-Rank Adaptation) to tune small models for chemistry:

- Base: TinyLlama-1.1B-Chat or Phi-3-mini-4k
- Dataset: 2000+ chemistry instructions from your warehouse
- Task: Intent parsing + reaction retrieval + bench planning
- Output: Structured JSON that drives the lab

The tuned model knows:
- 582 species names, formulas, properties
- 424 reaction equations and conditions
- Categories: acid, base, salt, oxide, gas, etc.
- Safety: danger scores, fume hood, max scale
- Bench: how to load 1-4 bottles to make anything

## Architecture

```
User: "make H2SO4 in all ways"
  ↓
[WebLLM / Python LLM / Ollama] - tuned for chemistry
  ↓ parses intent + retrieves relevant reactions
  ↓ outputs JSON: {intent, targets, reactions}
  ↓
[aiLab.ts] - existing rule-based executor (fallback + bench)
  ↓
Bench auto-loads + shows observations + safety
```

Hybrid: LLM for understanding, rule-based for execution (no hallucinated reactions).
