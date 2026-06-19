# ML Research Mapper

Type an ML research topic in plain English and get back a full map of the field: the most relevant papers, structured summaries, a research landscape, an interactive relationship graph, open problems, and personalized reading plans.

arXiv handles retrieval; an LLM reads, ranks, and synthesizes.

## What it does

Enter a topic like `retrieval augmented generation`, and the app runs an 8-stage pipeline:

1. **Topic expansion** — turns your topic into several focused arXiv queries

2. **Retrieve** — pulls candidate papers from arXiv and dedupes them

3. **Rerank** — the LLM scores each paper for relevance and keeps the best

4. **Extract** — pulls problem / method / results / contribution / limitations from each paper

5. **Synthesize** — builds a landscape: clusters, tensions, and an overview

6. **Graph** — maps typed relationships between papers (builds_on, contrasts_with, shares_method, applies_to)

7. **Gap finder** — aggregates limitations into open problems and unexplored gaps

8. **Reading plans** — generates beginner / PhD / industry reading orders

Progress streams to the UI stage by stage, so you watch each step complete.

## Stack

- **Backend:** FastAPI, the `arxiv` SDK, and Groq (Llama 3.3 70B) for all LLM calls

- **Frontend:** Next.js, Tailwind CSS, and React Flow for the interactive graph

- **LLM provider:** Groq's free tier (fast inference, no credit card)

## Project structure

```
research-mapper/
├── backend/
│   ├── main.py            # FastAPI server + streaming pipeline
│   ├── llm.py             # all LLM calls (expand, rerank, extract, synthesize, graph, gaps, plans)
│   ├── arxiv_client.py    # arXiv retrieval + dedupe
│   ├── requirements.txt
│   └── .env               # your API key (not committed)
└── frontend/
    └── app/
        └── page.tsx       # the entire UI
```

## Setup

You'll need Python 3.10+, Node.js 18+, and a free Groq API key from [console.groq.com](https://console.groq.com/).

### 1. Backend

```
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Mac/Linux
pip install -r requirements.txt
```

Create `backend/.env` with your key:

```
GROQ_API_KEY=your-groq-key-here
```

Start the server:

```
uvicorn main:app --reload --port 8000
```

Check [http://localhost:8000](http://localhost:8000/) — it should return `{"status":"ok"}`.

### 2. Frontend

In a second terminal:

```
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000/), type a topic, and click **Map field**.

## Running it day to day

Both servers must run at once, in two terminals:

- **Terminal 1:** `cd backend` → activate venv → `uvicorn main:app --reload --port 8000`

- **Terminal 2:** `cd frontend` → `npm run dev`

Then open [http://localhost:3000](http://localhost:3000/).

## Notes

- The free Groq tier is rate-limited (30 requests/min, daily token caps). The backend throttles and retries automatically, so a full search takes roughly a minute.

- A single search makes ~15-20 LLM calls. If you hit daily limits, switch the model string in `llm.py` to `llama-3.1-8b-instant` for a larger daily allowance (lower quality), or add billing.

- Summaries come from an open-weights model, so they're useful for mapping but less polished than a frontier model would produce.

## Possible next steps

- **Living maps:** persist searches in SQLite and merge new arXiv papers into saved maps over time

- **Real citations:** replace LLM-inferred relationships with Semantic Scholar citation data

- **Evolution timeline:** group papers by year and narrate how the field developed
