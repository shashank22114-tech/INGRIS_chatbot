import os
import json
import torch
import asyncio
import uuid
import pdfplumber
from typing import Optional
from fastapi import FastAPI, HTTPException, Header, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import AutoTokenizer, AutoModelForCausalLM

# ---------- GPT-2 CONFIG ----------
MODEL_DIR = os.environ.get("MODEL_DIR", "./gpt2-groundwater")
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

app = FastAPI(title="Groundwater GPT-2 + RAG")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- GPT-2 ----------
class GenRequest(BaseModel):
    question: str

@app.on_event("startup")
def load_model():
    global tokenizer, model, model_lock
    print(f"Loading GPT-2 from {MODEL_DIR}...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
    model = AutoModelForCausalLM.from_pretrained(MODEL_DIR)
    model.to(DEVICE)
    model.eval()
    model_lock = asyncio.Lock()
    print("✅ GPT-2 loaded.")

async def gpt2_generate(question: str, context: str):
    prompt = f"### Context:\n{context}\n\n### Human: {question}\n### Assistant:"
    inputs = tokenizer(prompt, return_tensors="pt").to(DEVICE)

    async with model_lock:
        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=120,
                temperature=0.7,
                top_k=50,
                top_p=0.9,
                do_sample=True,
                pad_token_id=tokenizer.eos_token_id,
                eos_token_id=tokenizer.eos_token_id,
            )

    text = tokenizer.decode(outputs[0], skip_special_tokens=True)
    return text.split("### Assistant:")[-1].strip()

# ---------- JSON DATA ----------
GROUNDWATER_JSON = "data/groundwater.json"

def search_json(question: str):
    if not os.path.exists(GROUNDWATER_JSON):
        return ""

    with open(GROUNDWATER_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    q_lower = question.lower()
    year = None
    for token in question.split():
        if token.isdigit() and len(token) == 4:
            year = token
            break

    matches = []
    for entry in data:
        district = str(entry.get("district", "")).lower()
        season = str(entry.get("season", "")).lower()
        if district in q_lower or (year and year in season):
            matches.append(
                f"In {entry.get('district')} ({entry.get('season')}): "
                f"GWL={entry.get('gwl')} m, pH={entry.get('pH')}, "
                f"TDS={entry.get('TDS')} mg/L, Classification={entry.get('Classification')}."
            )
    return "\n".join(matches[:5])

# ---------- PDF STORAGE ----------
PDF_STORE = "pdf_texts"
PDF_INDEX = os.path.join(PDF_STORE, "index.json")
os.makedirs(PDF_STORE, exist_ok=True)
if not os.path.exists(PDF_INDEX):
    with open(PDF_INDEX, "w", encoding="utf-8") as f:
        json.dump({}, f)

@app.post("/ingest_pdf")
async def ingest_pdf(file: UploadFile = File(...)):
    contents = await file.read()
    temp_id = uuid.uuid4().hex
    pdf_path = os.path.join(PDF_STORE, f"{temp_id}.pdf")
    txt_path = os.path.join(PDF_STORE, f"{temp_id}.txt")

    with open(pdf_path, "wb") as f:
        f.write(contents)

    extracted = ""
    with pdfplumber.open(pdf_path) as pdf:
        for p in pdf.pages:
            t = p.extract_text()
            if t:
                extracted += t + "\n"

    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(extracted)

    with open(PDF_INDEX, "r", encoding="utf-8") as f:
        idx = json.load(f)
    idx[temp_id] = {"filename": file.filename, "path": txt_path}
    with open(PDF_INDEX, "w", encoding="utf-8") as f:
        json.dump(idx, f)

    os.remove(pdf_path)
    return {"id": temp_id, "file": file.filename, "snippet": extracted[:300]}

def search_pdfs(question: str):
    with open(PDF_INDEX, "r", encoding="utf-8") as f:
        idx = json.load(f)

    q_lower = question.lower()
    results = []
    for pid, meta in idx.items():
        with open(meta["path"], "r", encoding="utf-8") as rf:
            text = rf.read().lower()
        if any(word in text for word in q_lower.split()):
            snippet = text[:400]
            results.append(f"From {meta['filename']}: {snippet}")
    return "\n".join(results[:3])

# ---------- MAIN CHAT ----------
@app.post("/chat")
async def chat(req: GenRequest):
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Empty question")

    # 1. Retrieve from JSON + PDFs
    context_json = search_json(question)
    context_pdf = search_pdfs(question)
    context = (context_json + "\n" + context_pdf).strip() or "No relevant context found."

    # 2. Generate with GPT-2
    answer = await gpt2_generate(question, context)
    return {"reply": answer, "context_used": context}
