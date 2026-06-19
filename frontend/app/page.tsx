"use client";

import { useState, useEffect, useRef } from "react";
import ReactFlow, { Background, Controls } from "reactflow";
import "reactflow/dist/style.css";

const STAGES = [
  { key: "expand", label: "Expand topic into queries" },
  { key: "retrieve", label: "Retrieve papers from arXiv" },
  { key: "rerank", label: "Rerank by relevance" },
  { key: "extract", label: "Extract structured summaries" },
  { key: "synthesize", label: "Synthesize landscape" },
  { key: "graph", label: "Build relationship graph" },
  { key: "gaps", label: "Detect open problems & gaps" },
  { key: "plans", label: "Build reading plans" },
];

const EDGE_COLORS = {
  builds_on: "#34d399",
  contrasts_with: "#f87171",
  shares_method: "#60a5fa",
  applies_to: "#c084fc",
};

// ---- Animated starfield drawn on a canvas ----
function Starfield() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    let w, h;
    let stars = [];

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      const count = Math.floor((w * h) / 6000);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random() * 0.8 + 0.2, // depth → size & speed
        tw: Math.random() * Math.PI * 2, // twinkle phase
      }));
    }
    resize();
    window.addEventListener("resize", resize);

    function frame() {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        s.tw += 0.02;
        s.y += s.z * 0.15; // slow drift downward
        if (s.y > h) s.y = 0;
        const alpha = 0.4 + Math.sin(s.tw) * 0.4;
        const size = s.z * 1.6;
        ctx.beginPath();
        ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(190, 210, 255, ${alpha})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    frame();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="rm-stars" />;
}

export default function Home() {
  const [topic, setTopic] = useState("");
  const [stageStatus, setStageStatus] = useState({});
  const [papers, setPapers] = useState([]);
  const [landscape, setLandscape] = useState(null);
  const [graph, setGraph] = useState(null);
  const [gaps, setGaps] = useState(null);
  const [plans, setPlans] = useState(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState("landscape");

  async function runSearch() {
    if (!topic.trim() || running) return;
    setRunning(true);
    setStageStatus({});
    setPapers([]);
    setLandscape(null);
    setGraph(null);
    setGaps(null);
    setPlans(null);

    try {
      const res = await fetch("http://localhost:8000/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          handleEvent(JSON.parse(line.slice(6)));
        }
      }
    } catch (err) {
      alert("Connection error: " + err.message);
    }
    setRunning(false);
  }

  function handleEvent(evt) {
    const { stage, status, data } = evt;
    setStageStatus((prev) => ({ ...prev, [stage]: status }));
    if (stage === "error") {
      alert("Pipeline error: " + (data?.message || "unknown"));
      setRunning(false);
      return;
    }
    if (stage === "extract" && status === "progress")
      setPapers((prev) => [...prev, data]);
    if (stage === "synthesize" && status === "done") setLandscape(data);
    if (stage === "graph" && status === "done") setGraph(data);
    if (stage === "gaps" && status === "done") setGaps(data);
    if (stage === "plans" && status === "done") setPlans(data);
  }

  function flowData() {
    if (!graph?.nodes) return { nodes: [], edges: [] };
    const n = graph.nodes.length;
    const nodes = graph.nodes.map((node, i) => {
      const angle = (2 * Math.PI * i) / n;
      const radius = 260;
      return {
        id: String(node.id),
        position: {
          x: 340 + radius * Math.cos(angle),
          y: 300 + radius * Math.sin(angle),
        },
        data: {
          label: node.title.slice(0, 38) + (node.title.length > 38 ? "…" : ""),
        },
        style: {
          fontSize: 11,
          width: 170,
          padding: 8,
          borderRadius: 10,
          border: "1px solid rgba(120,160,255,0.4)",
          background: "rgba(20,26,48,0.92)",
          color: "#dbe4ff",
          boxShadow: "0 0 14px rgba(80,120,255,0.25)",
        },
      };
    });
    const edges = (graph.edges || []).map((e, i) => ({
      id: `e${i}`,
      source: String(e.source),
      target: String(e.target),
      label: e.label,
      animated: e.type === "builds_on",
      style: { stroke: EDGE_COLORS[e.type] || "#7c8db5" },
      labelStyle: { fontSize: 9, fill: "#aab8e0" },
      labelBgStyle: { fill: "rgba(15,20,40,0.85)" },
    }));
    return { nodes, edges };
  }

  const hasResults = landscape || graph || gaps || plans || papers.length > 0;
  const { nodes, edges } = flowData();

  const TABS = [
    ["landscape", "Landscape"],
    ["graph", "Graph"],
    ["gaps", "Gaps & Problems"],
    ["plans", "Reading Plans"],
    ["papers", `Papers (${papers.length})`],
  ];

  return (
    <div className="rm-root">
      <Starfield />
      <div className="rm-vignette" />

      <main className="rm-main">
        {/* Hero */}
        <header className="rm-hero">
          <div className="rm-eyebrow">arXiv · mapped</div>
          <h1 className="rm-title">ML Research Mapper</h1>
          <p className="rm-sub">
            Chart an entire research field from a single search. Papers become
            constellations; the model reads, ranks, and connects them.
          </p>
        </header>

        {/* Search */}
        <div className="rm-searchwrap">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="e.g. retrieval-augmented generation"
            className="rm-input"
          />
          <button onClick={runSearch} disabled={running} className="rm-btn">
            {running ? "Mapping…" : "Map field"}
          </button>
        </div>

        {/* Pipeline */}
        <div className="rm-pipeline">
          {STAGES.map((s, i) => {
            const st = stageStatus[s.key];
            const state =
              st === "done"
                ? "done"
                : st === "running" || st === "progress"
                ? "active"
                : "idle";
            return (
              <div key={s.key} className={`rm-stage rm-${state}`}>
                <span className="rm-node">
                  <span className="rm-node-core" />
                </span>
                <span className="rm-stage-label">{s.label}</span>
              </div>
            );
          })}
        </div>

        {/* Results */}
        {hasResults && (
          <section className="rm-results">
            <div className="rm-tabs">
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={"rm-tab " + (tab === key ? "rm-tab-on" : "")}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Landscape */}
            {tab === "landscape" && landscape && (
              <div className="rm-fade">
                <p className="rm-overview">{landscape.overview}</p>
                <h3 className="rm-h3">Clusters</h3>
                <div className="rm-grid2">
                  {landscape.clusters?.map((c, i) => (
                    <div
                      key={i}
                      className="rm-card"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <div className="rm-card-title">{c.name}</div>
                      <div className="rm-card-body">{c.description}</div>
                    </div>
                  ))}
                </div>
                {landscape.tensions?.length > 0 && (
                  <>
                    <h3 className="rm-h3">Tensions</h3>
                    <ul className="rm-list">
                      {landscape.tensions.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {/* Graph */}
            {tab === "graph" && (
              <div className="rm-fade">
                {graph ? (
                  <>
                    <div className="rm-legend">
                      {Object.entries(EDGE_COLORS).map(([type, color]) => (
                        <span key={type} className="rm-legend-item">
                          <span
                            className="rm-legend-line"
                            style={{ background: color }}
                          />
                          {type.replace("_", " ")}
                        </span>
                      ))}
                    </div>
                    <div className="rm-graph">
                      <ReactFlow nodes={nodes} edges={edges} fitView>
                        <Background color="rgba(120,150,255,0.15)" gap={22} />
                        <Controls />
                      </ReactFlow>
                    </div>
                  </>
                ) : (
                  <p className="rm-muted">Building graph…</p>
                )}
              </div>
            )}

            {/* Gaps */}
            {tab === "gaps" && gaps && (
              <div className="rm-fade rm-grid2">
                <div>
                  <h3 className="rm-h3">Open Problems</h3>
                  <ul className="rm-list">
                    {gaps.open_problems?.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="rm-h3">Unexplored Gaps</h3>
                  <ul className="rm-list">
                    {gaps.gaps?.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Reading plans */}
            {tab === "plans" && plans && (
              <div className="rm-fade rm-grid3">
                {["beginner", "phd", "industry"].map((level) => (
                  <div key={level}>
                    <h3 className="rm-h3 rm-cap">{level}</h3>
                    <ol className="rm-plan">
                      {plans[level]?.map((item, i) => (
                        <li key={i} className="rm-card">
                          <div className="rm-card-title">
                            {i + 1}. {item.title}
                          </div>
                          <div className="rm-card-body">{item.why}</div>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}

            {/* Papers */}
            {tab === "papers" && (
              <div className="rm-fade rm-papers">
                {(() => {
                    const list = Array.isArray(papers) ? papers : Object.values(papers || {});
                    return list.slice().sort((a, b) => (b?.score || 0) - (a?.score || 0)).map((p, i) => (
                    <div key={i} className="rm-card">
                      <div className="rm-paper-head">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rm-paper-title"
                        >
                          {p.title}
                        </a>
                        <span className="rm-score">
                          {p.score} · {p.year}
                        </span>
                      </div>
                      <dl className="rm-fields">
                        <div><dt>Problem</dt><dd>{p.problem}</dd></div>
                        <div><dt>Method</dt><dd>{p.method}</dd></div>
                        <div><dt>Results</dt><dd>{p.results}</dd></div>
                        <div><dt>Contribution</dt><dd>{p.contribution}</dd></div>
                        <div><dt>Limitations</dt><dd>{p.limitations}</dd></div>
                      </dl>
                    </div>
                  ));
                    })()
                </div>
            )}
          </section>
        )}

        <footer className="rm-footer">
          Built with arXiv + Groq · {STAGES.length}-stage pipeline
        </footer>
      </main>

      <style jsx global>{`
        :root {
          --bg: #060912;
          --panel: rgba(18, 24, 44, 0.7);
          --border: rgba(110, 140, 220, 0.22);
          --text: #e6ecff;
          --muted: #9aa7d0;
          --accent: #7aa2ff;
          --accent2: #b388ff;
        }
        * { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 0;
          background: var(--bg);
          color: var(--text);
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI",
            sans-serif;
        }
        .rm-root {
          position: relative;
          min-height: 100vh;
          overflow-x: hidden;
          background:
            radial-gradient(1200px 600px at 70% -10%, rgba(80,70,180,0.25), transparent),
            radial-gradient(900px 500px at 10% 10%, rgba(40,90,180,0.18), transparent),
            var(--bg);
        }
        .rm-stars {
          position: fixed;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: 0;
          pointer-events: none;
        }
        .rm-vignette {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background: radial-gradient(
            ellipse at center,
            transparent 55%,
            rgba(0, 0, 0, 0.55) 100%
          );
        }
        .rm-main {
          position: relative;
          z-index: 1;
          max-width: 1080px;
          margin: 0 auto;
          padding: 72px 24px 60px;
        }

        /* Hero */
        .rm-hero { text-align: center; margin-bottom: 40px; }
        .rm-eyebrow {
          display: inline-block;
          font-size: 12px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--accent);
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 5px 14px;
          margin-bottom: 22px;
          background: rgba(120, 150, 255, 0.06);
        }
        .rm-title {
          font-size: clamp(40px, 7vw, 76px);
          line-height: 1.02;
          font-weight: 800;
          margin: 0 0 18px;
          letter-spacing: -0.02em;
          background: linear-gradient(120deg, #fff 10%, #a9bcff 50%, #c9a9ff 90%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          text-shadow: 0 0 40px rgba(120, 140, 255, 0.25);
        }
        .rm-sub {
          max-width: 560px;
          margin: 0 auto;
          color: var(--muted);
          font-size: 16px;
          line-height: 1.6;
        }

        /* Search */
        .rm-searchwrap {
          display: flex;
          gap: 10px;
          max-width: 680px;
          margin: 0 auto 44px;
        }
        .rm-input {
          flex: 1;
          background: var(--panel);
          backdrop-filter: blur(8px);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 16px 18px;
          color: var(--text);
          font-size: 15px;
          outline: none;
          transition: border-color 0.25s, box-shadow 0.25s;
        }
        .rm-input::placeholder { color: #6c79a3; }
        .rm-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 4px rgba(122, 162, 255, 0.15),
            0 0 30px rgba(122, 162, 255, 0.25);
        }
        .rm-btn {
          border: none;
          border-radius: 14px;
          padding: 0 26px;
          font-size: 15px;
          font-weight: 600;
          color: #0a0e1c;
          cursor: pointer;
          background: linear-gradient(120deg, #9db6ff, #c4a6ff);
          transition: transform 0.18s, box-shadow 0.25s, opacity 0.2s;
          box-shadow: 0 0 24px rgba(140, 160, 255, 0.4);
        }
        .rm-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 0 36px rgba(160, 150, 255, 0.6);
        }
        .rm-btn:disabled { opacity: 0.55; cursor: default; }

        /* Pipeline */
        .rm-pipeline {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px 32px;
          max-width: 720px;
          margin: 0 auto 56px;
        }
        .rm-stage { display: flex; align-items: center; gap: 12px; }
        .rm-node {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          border: 1px solid var(--border);
          flex-shrink: 0;
          transition: all 0.3s;
        }
        .rm-node-core {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #39426b;
          transition: all 0.3s;
        }
        .rm-stage-label { font-size: 14px; color: var(--muted); transition: color 0.3s; }
        .rm-idle .rm-node-core { background: #39426b; }
        .rm-active .rm-node {
          border-color: var(--accent);
          box-shadow: 0 0 14px rgba(122, 162, 255, 0.7);
        }
        .rm-active .rm-node-core {
          background: var(--accent);
          animation: rm-pulse 1s ease-in-out infinite;
        }
        .rm-active .rm-stage-label { color: var(--text); }
        .rm-done .rm-node {
          border-color: #34d399;
          box-shadow: 0 0 12px rgba(52, 211, 153, 0.5);
        }
        .rm-done .rm-node-core { background: #34d399; }
        .rm-done .rm-stage-label { color: #cfe9dd; }
        @keyframes rm-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.5); opacity: 0.6; }
        }

        /* Results */
        .rm-results {
          background: var(--panel);
          backdrop-filter: blur(10px);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 8px 26px 30px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
        }
        .rm-tabs {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
          border-bottom: 1px solid var(--border);
          margin-bottom: 24px;
        }
        .rm-tab {
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          color: var(--muted);
          font-size: 14px;
          font-weight: 600;
          padding: 16px 14px;
          cursor: pointer;
          margin-bottom: -1px;
          transition: color 0.2s, border-color 0.2s;
        }
        .rm-tab:hover { color: var(--text); }
        .rm-tab-on { color: var(--text); border-bottom-color: var(--accent); }

        .rm-overview { color: #c9d3f5; line-height: 1.7; font-size: 15.5px; margin: 6px 0 26px; }
        .rm-h3 {
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: var(--accent);
          margin: 24px 0 14px;
        }
        .rm-cap { text-transform: capitalize; letter-spacing: 0.04em; }

        .rm-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .rm-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; }
        @media (max-width: 760px) {
          .rm-grid2, .rm-grid3 { grid-template-columns: 1fr; }
          .rm-pipeline { grid-template-columns: 1fr; }
          .rm-searchwrap { flex-direction: column; }
          .rm-btn { padding: 14px; }
        }

        .rm-card {
          background: rgba(28, 35, 62, 0.6);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 16px 18px;
          transition: transform 0.22s, box-shadow 0.22s, border-color 0.22s;
          animation: rm-rise 0.5s ease both;
        }
        .rm-card:hover {
          transform: translateY(-3px);
          border-color: rgba(140, 170, 255, 0.5);
          box-shadow: 0 0 28px rgba(100, 130, 255, 0.28);
        }
        .rm-card-title { font-weight: 700; color: #eef2ff; margin-bottom: 6px; }
        .rm-card-body { font-size: 13.5px; color: var(--muted); line-height: 1.55; }
        @keyframes rm-rise {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .rm-list { padding-left: 18px; margin: 0; }
        .rm-list li { color: #c2cdf0; font-size: 14px; line-height: 1.5; margin-bottom: 9px; }
        .rm-muted { color: var(--muted); font-size: 14px; }

        .rm-plan { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }

        .rm-legend { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 14px; font-size: 12px; color: var(--muted); }
        .rm-legend-item { display: flex; align-items: center; gap: 7px; }
        .rm-legend-line { width: 18px; height: 2px; display: inline-block; border-radius: 2px; }
        .rm-graph {
          height: 600px;
          border: 1px solid var(--border);
          border-radius: 16px;
          overflow: hidden;
          background: rgba(8, 12, 26, 0.6);
        }

        .rm-papers { display: flex; flex-direction: column; gap: 14px; }
        .rm-paper-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
        .rm-paper-title { color: #eef2ff; font-weight: 700; text-decoration: none; }
        .rm-paper-title:hover { color: var(--accent); }
        .rm-score {
          flex-shrink: 0;
          font-size: 12px;
          color: var(--accent);
          background: rgba(122, 162, 255, 0.12);
          border: 1px solid var(--border);
          padding: 3px 9px;
          border-radius: 8px;
        }
        .rm-fields { margin: 12px 0 0; display: flex; flex-direction: column; gap: 6px; }
        .rm-fields div { font-size: 13.5px; line-height: 1.5; }
        .rm-fields dt { display: inline; font-weight: 700; color: #aebbe6; }
        .rm-fields dt::after { content: ":  "; }
        .rm-fields dd { display: inline; margin: 0; color: var(--muted); }

        .rm-fade { animation: rm-fadein 0.4s ease both; }
        @keyframes rm-fadein { from { opacity: 0; } to { opacity: 1; } }

        .rm-footer { text-align: center; color: #5a688f; font-size: 12px; margin-top: 40px; letter-spacing: 0.05em; }

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation: none !important; transition: none !important; }
        }
      `}</style>
    </div>
  );
}