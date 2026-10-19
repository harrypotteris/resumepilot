import os
import re
import sys
import json
import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.environ["NVIDIA_API_KEY"],
)
EMBED_MODEL = os.environ["NVIDIA_EMBED_MODEL"]

HERE = os.path.dirname(os.path.abspath(__file__))
RESUME_PATH = os.path.join(HERE, "resume.txt")
INDEX_PATH = os.path.join(HERE, "index.json")


def clean_latex(t):
    # read simple text macros (\name, \phone, \emaila ...) before dropping the preamble
    macros = {k: v for k, v in re.findall(r"\\newcommand\{\\(\w+)\}\{([^{}]*)\}", t) if "#" not in v}
    if "\\begin{document}" in t:
        t = t.split("\\begin{document}", 1)[1]
    for k, v in macros.items():
        t = re.sub(r"\\" + k + r"(?![a-zA-Z])", lambda m, v=v: v, t)

    t = re.sub(r"(?m)^\s*%.*$", "", t)                        # comment lines
    t = re.sub(r"(?<!\\)%.*", "", t)                           # trailing comments
    t = re.sub(r"\\includegraphics(\[[^\]]*\])?\{[^{}]*\}", "", t)
    t = re.sub(r"\\(?:begin|end)\{[^{}]*\}(\{[^{}]*\})*(\[[^\]]*\])?", "", t)
    t = t.replace("\\hline", "").replace("mailto:", "")
    t = re.sub(r"\\parbox\{[^{}]*\}", "", t)
    t = re.sub(r"(?<!\\)&", " | ", t)                          # table cell separators
    t = re.sub(r"\\textsuperscript\{([^{}]*)\}", r"^\1", t)
    t = re.sub(r"\\section\*?\{([^{}]*)\}", r"\n\nSECTION: \1\n", t)
    t = t.replace("\\resumeProject", "\n\nPROJECT: ")
    t = t.replace("\\resumeSubheading", "\n\nENTRY: ").replace("\\resumePOR", "\n\nENTRY: ")
    t = re.sub(r"\\href\{([^{}]*)\}\{([^{}]*)\}", r"\2 (\1)", t)
    for _ in range(3):
        t = re.sub(r"\\(?:textbf|textit|emph|underline|textsc|small|footnotesize)\{([^{}]*)\}", r"\1", t)
    t = re.sub(r"\\resumeItem\s*\{([^{}]*)\}\s*\{([^{}]*)\}", r"\1 \2\n", t)
    t = t.replace("\\item", "\n- ")
    t = t.replace("\\&", "&").replace("\\%", "%").replace("\\_", "_").replace("\\#", "#")
    t = t.replace("\\\\", "\n")
    t = t.replace("\\times", " x ").replace("\\sim", "~").replace("\\rightarrow", "->")
    t = re.sub(r"\\[a-zA-Z]+\*?", "", t)                       # leftover commands
    t = t.replace("$", "").replace("{", " ").replace("}", " ")
    t = re.sub(r"[ \t]+", " ", t)
    return t


def chunk(text, max_chars=1200):
    units = re.split(r"\n\s*(?=(?:PROJECT|SECTION|ENTRY):)", text)
    chunks = []
    for u in units:
        u = re.sub(r"\n\s*\n+", "\n", u).strip()
        if not u:
            continue
        cur = ""
        for line in u.split("\n"):
            if cur and len(cur) + len(line) > max_chars:
                chunks.append(cur.strip())
                cur = ""
            cur += line + "\n"
        if cur.strip():
            chunks.append(cur.strip())
    return [c for c in chunks if len(c) > 20]


def embed(texts, kind):
    """kind is 'passage' for documents and 'query' for questions."""
    out = []
    for i in range(0, len(texts), 16):
        r = client.embeddings.create(
            model=EMBED_MODEL,
            input=texts[i:i + 16],
            encoding_format="float",
            extra_body={"input_type": kind},
        )
        out += [d.embedding for d in r.data]
    return out


def build_index():
    with open(RESUME_PATH, encoding="utf-8") as f:
        text = clean_latex(f.read())
    chunks = chunk(text)
    vectors = embed(chunks, "passage")
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump({"chunks": chunks, "vectors": vectors}, f)
    print(f"Indexed {len(chunks)} chunks.")


def search(query, k=3):
    with open(INDEX_PATH, encoding="utf-8") as f:
        idx = json.load(f)
    M = np.array(idx["vectors"], dtype=np.float32)
    M /= np.linalg.norm(M, axis=1, keepdims=True)
    q = np.array(embed([query], "query")[0], dtype=np.float32)
    q /= np.linalg.norm(q)
    scores = M @ q
    top = np.argsort(-scores)[:k]
    return [(float(scores[i]), idx["chunks"][i]) for i in top]


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "build":
        build_index()
    else:
        query = " ".join(sys.argv[1:]) or "embedded systems experience"
        for score, text in search(query):
            print(f"--- score {score:.3f} ---\n{text}\n")