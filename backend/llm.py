import os
import json
import time
import threading
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
MODEL = "llama-3.1-8b-instant"

# --- Rate limiter: free tier allows 30 requests/min. Cap at 1 every 2.5s. ---
_last_call = [0.0]
_lock = threading.Lock()
MIN_GAP = 2.5  # seconds between calls


def _throttle():
    with _lock:
        elapsed = time.time() - _last_call[0]
        if elapsed < MIN_GAP:
            time.sleep(MIN_GAP - elapsed)
        _last_call[0] = time.time()


def _retryable(msg: str) -> bool:
    """True if the error is a transient rate-limit or overload we should retry."""
    return ("429" in msg or "rate" in msg.lower()
            or "503" in msg or "502" in msg or "overload" in msg.lower())


def _call(system: str, user: str, max_tokens: int = 2000) -> str:
    """Single text-in, text-out call to Groq, with throttle + retry."""
    for attempt in range(4):
        _throttle()
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                temperature=0.3,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            )
            return resp.choices[0].message.content
        except Exception as e:
            msg = str(e)
            if _retryable(msg):
                wait = 15 * (attempt + 1)
                print(f"Transient error ({msg[:40]}...), waiting {wait}s "
                      f"(attempt {attempt + 1})...")
                time.sleep(wait)
                continue
            raise
    raise RuntimeError("Groq unavailable after retries. Wait a minute and retry.")


def _call_json(system: str, user: str, max_tokens: int = 2000):
    """Call Groq and parse its reply as JSON. Forces JSON output mode.
    Retries on transient errors AND on truncated/invalid JSON."""
    sys_json = system + "\n\nYou must respond with a single valid JSON value only."
    for attempt in range(4):
        _throttle()
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                temperature=0.3,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": sys_json},
                    {"role": "user", "content": user},
                ],
            )
            return json.loads(resp.choices[0].message.content)
        except json.JSONDecodeError as e:
            print(f"--- JSON parse failed (attempt {attempt + 1}): {e}")
            time.sleep(3)
            continue
        except Exception as e:
            msg = str(e)
            print(f"--- ERROR: {msg[:200]}")
            if _retryable(msg):
                wait = 15 * (attempt + 1)
                print(f"Transient error, waiting {wait}s (attempt {attempt + 1})...")
                time.sleep(wait)
                continue
            raise
    raise RuntimeError("Groq returned invalid JSON after retries. Try again.")


# ---------- Stage 0: Topic Expansion ----------
def expand_topic(topic: str) -> list:
    system = "You expand ML research topics into focused arXiv search queries."
    user = f"""
Topic: {topic}

Return ONLY a JSON array of 5 short search query strings (2-5 words each),
covering the core topic, 2-3 key subfields, and one related area.
Example format: ["query one", "query two", "query three"]
"""
    result = _call_json(system, user, max_tokens=500)
    # Safety: if the model wrapped the list in an object, dig the list out.
    if isinstance(result, dict):
        for v in result.values():
            if isinstance(v, list):
                result = v
                break
    if not isinstance(result, list):
        result = [topic]
    if topic not in result:
        result.append(topic)
    return result


# ---------- Stage 2: Rerank ----------
def rerank(topic: str, papers: list):
    listing = "\n".join(
        f"[{i}] {p['title']}\n{p['summary'][:300]}" for i, p in enumerate(papers)
    )
    system = "You are an expert ML researcher judging paper relevance to a topic."
    user = f"""
Topic: {topic}

Papers:
{listing}

Return ONLY a JSON array of objects with exactly these keys:
[{{"index": <int>, "score": <int 0-100>, "reason": "<one short sentence>"}}]
Score by how central each paper is to the topic.
"""
    result = _call_json(system, user, max_tokens=8000)
    # Groq JSON mode returns an object; dig out the array if wrapped.
    if isinstance(result, dict):
        for v in result.values():
            if isinstance(v, list):
                return v
    return result


# ---------- Stage 3: Extract ----------
def extract(paper: dict):
    system = "You extract structured summaries from ML papers."
    user = f"""
Title: {paper['title']}
Abstract: {paper['summary']}

Return ONLY a flat JSON object with exactly these five string keys:
"problem", "method", "results", "contribution", "limitations".
Each value is 1-2 plain-language sentences. For "limitations", state what the
paper does NOT solve or where it falls short (infer if not explicit).
"""
    return _call_json(system, user, max_tokens=1200)


# ---------- Stage 4: Synthesize landscape ----------
def synthesize(topic: str, extractions: list):
    blob = "\n\n".join(
        f"Paper: {e['title']}\nProblem: {e['problem']}\nMethod: {e['method']}\n"
        f"Contribution: {e['contribution']}"
        for e in extractions
    )
    system = "You synthesize a research landscape across many ML papers."
    user = f"""
Topic: {topic}

Paper summaries:
{blob}

Return ONLY a JSON object with exactly these keys:
- "clusters": array of objects {{"name": str, "description": str, "paper_titles": [str]}}
- "tensions": array of strings (competing approaches or disagreements)
- "overview": one paragraph string summarizing the field
"""
    return _call_json(system, user, max_tokens=6000)


# ---------- Stage 5: Graph ----------
def build_graph(topic: str, extractions: list):
    listing = "\n".join(
        f"[{i}] {e['title']}\nMethod: {e['method']}\nContribution: {e['contribution']}"
        for i, e in enumerate(extractions)
    )
    system = "You map relationships between ML papers as a graph."
    user = f"""
Topic: {topic}

Papers (with index):
{listing}

Return ONLY a JSON object with one key "edges": an array of objects
{{"source": <int index>, "target": <int index>, "type": <string>, "label": <string>}}.
"type" must be one of: builds_on, contrasts_with, shares_method, applies_to.
"label" is a 3-6 word description. Aim for 1-3 edges per paper.
Indices must refer to the papers listed above.
"""
    return _call_json(system, user, max_tokens=3000)


# ---------- Feature: Gap Finder ----------
def find_gaps(topic: str, extractions: list, clusters: list):
    lims = "\n".join(f"- {e['title']}: {e['limitations']}" for e in extractions)
    cluster_names = ", ".join(
        c["name"] if isinstance(c, dict) else str(c) for c in clusters
    )
    system = "You identify unsolved problems and unexplored gaps in an ML field."
    user = f"""
Topic: {topic}
Clusters present: {cluster_names}

Per-paper limitations:
{lims}

Return ONLY a JSON object with exactly these keys:
- "open_problems": array of strings (recurring unsolved challenges)
- "gaps": array of strings (directions or combinations NOT yet explored)
Be specific and concrete.
"""
    return _call_json(system, user, max_tokens=2000)


# ---------- Feature: Reading Plans ----------
def reading_plans(topic: str, extractions: list):
    listing = "\n".join(f"- {e['title']}: {e['contribution']}" for e in extractions)
    system = "You design reading plans for different audiences in an ML field."
    user = f"""
Topic: {topic}

Available papers:
{listing}

Return ONLY a JSON object with exactly these keys: "beginner", "phd", "industry".
Each is an array of objects {{"title": str, "why": str}} — an ordered reading list
of 3-5 papers FROM THE LIST ABOVE, with a one-line reason for that audience.
"""
    return _call_json(system, user, max_tokens=2500)