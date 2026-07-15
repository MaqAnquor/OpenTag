# KiteBot Deep-Research Agent — Phase 2 (LangGraph deepagents brain)

**Date:** 2026-07-15
**Branch:** `jerel/copilotkit-channels-intelligence-40037b` (stacks on Phase 1)
**Status:** Design — awaiting review

## Context / north star

Phase 1 shipped KiteBot on the CopilotKit Channels + Intelligence stack: a channel host
(`app/managed.ts`) that runs the bot over the Intelligence Realtime Gateway and calls an
AG-UI agent at `AGENT_URL` (today the TS `runtime.ts` triage backend). **Phase 2 replaces
that brain with a Python LangGraph *deepagents* deep-research agent** — the LangChain
co-marketing objective — living in the OpenTag repo as a second service. Phase 3 (Railway
one-click) deploys both. Decisions locked with the user: **Python**, **in-repo `agent/`**,
**deep-research agent** (planner + sub-agents + web), **web-first with optional internal
Notion/Linear sources**, rendered through KiteBot's Phase-1 generative-UI cards.

## Grounding (canonical references)

- **`examples/showcases/deep-agents/agent/`** — a real `create_deep_agent` research
  assistant (agent.py + tools.py + main.py + pyproject.toml + **railway.toml** + uv.lock).
  This is the agent-shape reference.
- **`examples/integrations/langgraph-python/serve.py`** — serves a LangGraph graph over
  **AG-UI** via `add_langgraph_fastapi_endpoint(app, LangGraphAGUIAgent(graph=…), path="/")`
  on uvicorn. This is the `AGENT_URL` contract reference.

## Target architecture (Phase 2)

A new **Python service** in `agent/`, run alongside the existing processes:

- **`agent/agent.py`** — `build_agent()` → `create_deep_agent(model=ChatOpenAI(...),
  system_prompt=RESEARCH_PROMPT, tools=[research, …], middleware=[CopilotKitMiddleware()],
  checkpointer=MemorySaver())`. deepagents supplies the planner (`write_todos`) + virtual
  filesystem (`read_file`/`write_file`) built-ins; the agent plans, researches, and writes a
  report to `/reports/final_report.md`.
- **`agent/tools.py`** — `research(query)` web tool over **Tavily** (`TAVILY_API_KEY`),
  ported from the showcase. **Optional internal sources:** additional tools that query the
  team's **Notion + Linear MCP** (the same servers Phase 1 wired), added to `main_tools`
  only when their env is present — so the story is "deep research across the web *and* your
  team's docs/issues," and web-only still works without them.
- **`agent/main.py`** — `graph = build_agent()` (the importable graph).
- **`agent/serve.py`** — FastAPI app + CORS + `/health` + `add_langgraph_fastapi_endpoint(
  app, LangGraphAGUIAgent(name="kitebot-research", description=…, graph=graph), path="/")`,
  `uvicorn` on `AGENT_PORT` (default 8123). **This URL is what `AGENT_URL` points at.**
- **`agent/pyproject.toml`** (uv) — deps: `deepagents>=0.3.5`, `ag-ui-langgraph>=0.0.23`,
  `copilotkit>=0.1.76`, `langchain>=1.2.4`, `langchain-openai`, `tavily-python`,
  `fastapi`, `uvicorn[standard]` (+ `langchain-mcp-adapters` if internal sources are in).
  Python 3.12, `uv` toolchain.

**Wiring:** the Phase-1 channel host is unchanged except that `AGENT_URL` now targets the
Python service (e.g. `http://localhost:8123/`). `runtime.ts` (the TS BuiltInAgent triage)
stays in the repo as a lighter alternative brain; the deep-research agent becomes the
default/co-marketing brain.

### Output rendering — the key integration point (and risk)

KiteBot renders rich Slack cards by forwarding its channel-side generative-UI tools
(`render_table`, `show_links`, `issue_card`, `render_chart`, …) to the agent as **AG-UI
frontend tools** on every run; the model calls them and the channel renders. In Phase 1 the
TS `BuiltInAgent` invoked these via `convertInputToTanStackAI`.

**Open risk (verify FIRST in implementation):** does a `create_deep_agent` graph served via
`LangGraphAGUIAgent` + `CopilotKitMiddleware` expose those *per-run forwarded* frontend
tools to its LLM so it can call them? The showcase uses `CopilotKitMiddleware` for
generative UI, which is promising, but KiteBot forwards tools over AG-UI rather than via a
Next.js `useCopilotAction` frontend. Two outcomes:
- **Primary (if forwarded tools reach the model):** the deep agent calls KiteBot's render
  tools → rich cards, exactly like Phase 1.
- **Fallback (if not):** the agent writes a markdown report; the channel posts it as
  markdown (channels-ui renders markdown). Less rich but functional. A thin channel-side
  adapter could also translate the final report into a `show_status`/`show_links` card.

This risk is the first implementation task — a spike to confirm which path holds before
building the full agent.

## Env & scripts

- New env: `TAVILY_API_KEY` (required for web research), `OPENAI_MODEL` (default
  **`gpt-5.5`**, matching Phase 1), `AGENT_PORT` (default 8123). Reuses `OPENAI_API_KEY`. `AGENT_URL` in the channel host →
  `http://localhost:8123/`. Optional internal sources reuse Phase 1's `LINEAR_API_KEY` /
  `NOTION_*` vars.
- `agent/.env.example` (or extend the root one) documents the above.
- Running locally is now three processes: `agent` (Python deep agent, :8123) + `pnpm channel`
  (or `pnpm dev`) + the Intelligence side. Add a documented run command for the Python
  service (`uv run uvicorn serve:app --port 8123`, wrapped in a script).

## Testing

- Python is a **new toolchain** in this TS repo. Use `uv` + `pytest`.
- `agent/tests/test_tools.py` — unit-test `research()` with a mocked `TavilyClient`
  (success + missing-key + empty-results), and the internal-source tool gating.
- `agent/tests/test_serve.py` — assert `/health` returns ok and the AG-UI endpoint mounts.
- Manual smoke: start the agent, point `AGENT_URL` at it, `@mention KiteBot research <topic>`
  → confirm a plan (todos) forms, research runs, and a synthesized brief returns (as cards
  if the primary rendering path holds, else markdown).

## Verification (definition of done)

1. `uv run` boots `agent/serve.py`; `GET /health` → ok.
2. `pytest` green in `agent/`.
3. With `AGENT_URL` → the Python service, an end-to-end `research` turn through KiteBot
   returns a synthesized, sourced brief in the channel.
4. Phase-1 TS gates still green (`pnpm check-types`, `pnpm test`) — the channel host is
   unchanged.

## Out of scope (later)

- **Phase 3:** Railway one-click template (multi-service: Python agent + channel host;
  the showcase's `railway.toml` + a Dockerfile are the references).
- Deep-agent evals / continuous-learning.

## Open questions / confirmations

1. **Rendering path** — resolved by the first spike (forwarded tools vs markdown fallback);
   no user input needed unless the fallback materially changes the demo.
2. **Model default** — RESOLVED: `gpt-5.5` (matches Phase 1).
3. **Internal sources** — RESOLVED: web-first with Notion/Linear as optional.
