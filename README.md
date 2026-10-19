# ResumePilot

A small Chrome extension that helps fill in job application forms from your resume.

> **Just a learning project.** I built this casually to learn how browser extensions, RAG and LLM apps fit together. It's not polished or production-ready, it has only been tried on a few forms (mostly Workday), and it will probably break on some sites. Use it at your own risk and always review what it fills in.

## What it does

1. The extension scans the application form on the page (labels, field types, dropdown options).
2. It sends those fields to a small local backend.
3. The backend looks up the most relevant parts of your resume and asks an LLM for answers.
4. A few sensitive fields (gender, race, visa, salary and similar) are blocked in code and never filled.
5. The extension fills in the rest and highlights them in green. It **never submits** the form, so you check everything yourself.

If your resume doesn't say something, the field is left empty and nothing is guessed.

## Rough setup

You'll need Python and Chrome, plus an NVIDIA API key (or edit `llm.py` to use another provider).

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env        # then add your own key
# put your resume text in backend/resume.txt
python rag.py build         # builds the search index from your resume
python -m uvicorn main:app --reload --port 8000
```

Then open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick this folder. Open an application page and press F5 once.

## Notes

- Your resume text and the form fields are sent to the LLM provider, so don't use it with anything you wouldn't want to share with them.
- `resume.txt`, `.env` and the generated index stay on your machine and are not in this repo.
- Ideas I may try later: more sites (Greenhouse, Lever), multi-entry sections like education and experience, and resume upload.
