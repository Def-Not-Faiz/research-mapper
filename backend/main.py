import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from arxiv_client import fetch_many
import llm

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchRequest(BaseModel):
    topic: str
    keep: int = 10


def event(stage: str, status: str, data=None):
    return f"data: {json.dumps({'stage': stage, 'status': status, 'data': data})}\n\n"


@app.post("/api/search")
def search(req: SearchRequest):

    def run():
        try:
            # 1. Expand topic
            yield event("expand", "running")
            queries = llm.expand_topic(req.topic)
            yield event("expand", "done", queries)

            # 2. Fetch papers
            yield event("retrieve", "running")
            papers = fetch_many(queries, per_query=6)
            yield event("retrieve", "done", len(papers))

            # 3. Rank
            yield event("rerank", "running")
            ranked = llm.rerank(req.topic, papers)
            ranked.sort(key=lambda x: x["score"], reverse=True)

            top = []
            for r in ranked[: req.keep]:
                idx = r["index"]
                if idx < 0 or idx >= len(papers):
                    continue  # skip bad indices from the LLM
                p = papers[idx]
                p["score"] = r["score"]
                top.append(p)

            yield event("rerank", "done", len(top))

            # 4. Extract
            yield event("extract", "running")
            extractions = []

            for p in top:
                e = llm.extract(p)
                e["title"] = p["title"]
                e["year"] = p["year"]
                e["score"] = p["score"]
                e["url"] = p["url"]
                extractions.append(e)
                yield event("extract", "progress", e)

            yield event("extract", "done", len(extractions))

            # 5. Synthesize
            yield event("synthesize", "running")
            landscape = llm.synthesize(req.topic, extractions)
            yield event("synthesize", "done", landscape)

            # 6. Graph
            yield event("graph", "running")
            graph = llm.build_graph(req.topic, extractions)

            graph["nodes"] = [
                {"id": i, "title": e["title"], "year": e["year"], "score": e["score"]}
                for i, e in enumerate(extractions)
            ]

            yield event("graph", "done", graph)

            # 7. Gaps
            yield event("gaps", "running")
            gaps = llm.find_gaps(req.topic, extractions, landscape.get("clusters", []))
            yield event("gaps", "done", gaps)

            # 8. Plans
            yield event("plans", "running")
            plans = llm.reading_plans(req.topic, extractions)
            yield event("plans", "done", plans)

            # Final output
            yield event("complete", "done", {
                "papers": extractions,
                "landscape": landscape,
                "graph": graph,
                "gaps": gaps,
                "plans": plans,
            })
        except Exception as e:
            import traceback
            traceback.print_exc()
            yield event("error", "failed", {"message": str(e)})

    return StreamingResponse(run(), media_type="text/event-stream")

@app.get("/")
def health():
    return {"status": "ok"}