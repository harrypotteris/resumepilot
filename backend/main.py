import os
import re
import json
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rag import client, embed, INDEX_PATH

MODEL = os.environ["NVIDIA_MODEL"]

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SKIP_KINDS = {"file", "checkbox"}

SYSTEM = """You fill out job application forms for one candidate, using ONLY the resume context provided.

Return ONLY a JSON object, no prose, no markdown:
{"answers": [{"idx": <int>, "value": <string or null>, "confidence": <number 0-1>}]}

Rules:
- Include one entry for every field idx you are given.
- Use ONLY facts stated in the resume context. Never invent or guess. If the answer is not clearly in the resume, value is null.
- For fields with "options" (select, radio-group), value must be exactly one of the option labels, or null.
- For custom-dropdown fields without options, give the plain text value to pick (for example a country or a degree name), or null.
- Text fields want just the value (a name, a city, a number), not a sentence.
- Textarea / open-ended questions: write 2-4 sentences from resume facts only.
- Sensitive or demographic fields (gender, race, ethnicity, disability, veteran status, religion, sexual orientation, age, marital status): value null.
- Legal declarations, referral source, work authorization, salary, notice period: value null unless the resume states it.
- Given name = first name, family name = last name. Local/native-script name fields: null.
- Do not answer password fields.
- confidence reflects how directly the resume supports the value."""


class FillRequest(BaseModel):
    url: str
    fields: list[dict]


def load_index():
    with open(INDEX_PATH, encoding="utf-8") as f:
        idx = json.load(f)
    M = np.array(idx["vectors"], dtype=np.float32)
    M /= np.linalg.norm(M, axis=1, keepdims=True)
    return idx["chunks"], M


def build_context(items, k=2, max_chars=9000):
    chunks, M = load_index()
    queries = [f"{f.get('section', '')} {f.get('label', '')}".strip() or "resume" for f in items]
    Q = np.array(embed(queries, "query"), dtype=np.float32)
    Q /= np.linalg.norm(Q, axis=1, keepdims=True)
    scores = Q @ M.T
    picked = [0] + [i for i, c in enumerate(chunks) if c.startswith(("SECTION: Education", "SECTION: Personal"))]
    for row in scores:
        for i in np.argsort(-row)[:k]:
            if int(i) not in picked:
                picked.append(int(i))
    text, total = [], 0
    for i in picked:
        if total + len(chunks[i]) > max_chars:
            break
        text.append(chunks[i])
        total += len(chunks[i])
    return "\n\n---\n\n".join(text)


def compact(i, f):
    d = {
        "idx": i,
        "label": f.get("label", ""),
        "kind": f.get("kind", ""),
        "section": f.get("section", ""),
        "required": f.get("required", False),
    }
    if f.get("options"):
        d["options"] = [o.get("label", "") for o in f["options"]]
    if f.get("kind") == "custom-dropdown" and f.get("value"):
        d["current"] = f["value"]
    return d


def parse_json(s):
    m = re.search(r"\{.*\}", s, re.S)
    if not m:
        raise ValueError("model returned no JSON: " + s[:200])
    return json.loads(m.group(0))

BLOCK = re.compile(
    r"hear about|how did you|referr|previously worked|former employee|sponsor|authori[sz]ed|work permit|visa|"
    r"gender|race|ethnic|veteran|disabilit|religio|sexual|marital|salary|compensation|notice period|"
    r"convicted|criminal|relative",
    re.I,
)


@app.post("/fill")
def fill(req: FillRequest):
    items = [(i, f) for i, f in enumerate(req.fields) if f.get("kind") not in SKIP_KINDS]
    if not items:
        return {"received": len(req.fields), "answers": []}
    try:
        context = build_context([f for _, f in items])
        payload = json.dumps([compact(i, f) for i, f in items], ensure_ascii=False)
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"RESUME CONTEXT:\n{context}\n\nFORM FIELDS:\n{payload}"},
            ],
            temperature=0,
            max_tokens=4000,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        data = parse_json(resp.choices[0].message.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    by_idx = {}
    for a in data.get("answers", []):
        try:
            by_idx[int(a.get("idx"))] = a
        except (TypeError, ValueError):
            pass
    print("MODEL ANSWERS:", json.dumps(data, ensure_ascii=False)[:3000])
    answers = []
    for i, f in items:
        a = by_idx.get(i, {})
        answers.append({
            "idx": i,
            "id": f.get("id") or f.get("name"),
            "label": f.get("label"),
            "kind": f.get("kind"),
            "value": None if BLOCK.search(f.get("label") or "") else a.get("value"),
            "confidence": a.get("confidence"),
        })
    return {"received": len(req.fields), "answers": answers}


@app.get("/health")
def health():
    return {"ok": True}