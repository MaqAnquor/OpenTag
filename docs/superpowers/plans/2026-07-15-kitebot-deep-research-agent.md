# KiteBot Deep-Research Agent (Phase 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Python `agent/` service to OpenTag — a `deepagents` deep-research agent (planner + virtual filesystem + Tavily web research, optional Notion/Linear internal sources) served over AG-UI — and point KiteBot's channel host at it via `AGENT_URL`.

**Architecture:** A standalone FastAPI/uvicorn service (`agent/`, Python 3.12, `uv`). `agent.py` builds a `create_deep_agent` graph; `main.py` serves it over AG-UI with `add_langgraph_fastapi_endpoint(LangGraphAGUIAgent(graph, config), path="/")` on `:8123`; `tools.py` provides the Tavily `research()` tool. The Phase-1 channel host is unchanged except `AGENT_URL` → `http://localhost:8123/`. A spike resolves whether KiteBot's forwarded generative-UI tools render as cards (primary) or need a markdown fallback.

**Tech stack:** Python 3.12, `uv`, `deepagents>=0.3.5`, `ag-ui-langgraph>=0.0.23`, `copilotkit>=0.1.76`, `langchain-openai`, `tavily-python`, `fastapi`, `uvicorn`, `pytest`.

**Spec:** `docs/superpowers/specs/2026-07-15-kitebot-deep-research-agent-design.md`
**Model default:** `gpt-5.5` (locked, matches Phase 1).

---

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `agent/pyproject.toml` | create | Python deps + uv project + py-modules |
| `agent/agent.py` | create | `build_agent()` → `create_deep_agent(...)` graph |
| `agent/tools.py` | create | Tavily `research()` + `internet_search` tools |
| `agent/main.py` | create | FastAPI + `/health` + AG-UI endpoint + uvicorn |
| `agent/.env.example` | create | `OPENAI_API_KEY`, `TAVILY_API_KEY`, `OPENAI_MODEL`, `SERVER_PORT` |
| `agent/.gitignore` | create | `.venv`, `__pycache__`, `.env`, `/reports` |
| `agent/tests/test_tools.py` | create | unit-test `research()`/search with mocked Tavily |
| `agent/tests/test_health.py` | create | `/health` via FastAPI TestClient |
| `agent/tools.py` (internal sources) | modify (Task 6) | optional Notion/Linear MCP tools, env-gated |
| `.env.example` (root) | modify | add `TAVILY_API_KEY`, `OPENAI_MODEL`, `AGENT_URL`→`:8123` note |
| `package.json` | modify | `"agent"` convenience script |
| `README.md`, `setup.md` | modify | deep-agent section + three-process run |
| `app/managed.ts` / `app/index.ts` | modify (Task 5, only if spike says fallback) | markdown-report rendering |

---

## Task 1: Scaffold the Python agent service (boots + /health)

**Files:** Create `agent/pyproject.toml`, `agent/agent.py`, `agent/tools.py`, `agent/main.py`, `agent/.gitignore`.

- [ ] **Step 1: `agent/pyproject.toml`**

```toml
[project]
name = "kitebot-research-agent"
version = "0.1.0"
description = "KiteBot Deep Research Agent — CopilotKit Deep Agents (LangGraph) over AG-UI"
requires-python = ">=3.12"
dependencies = [
  "ag-ui-langgraph>=0.0.23",
  "copilotkit>=0.1.76",
  "deepagents>=0.3.5",
  "fastapi>=0.115.14",
  "langchain>=1.2.4",
  "langchain-openai>=1.1.7",
  "python-dotenv>=1.2.1",
  "tavily-python>=0.3.0",
  "uvicorn[standard]>=0.40.0",
]

[dependency-groups]
dev = ["pytest>=8.0.0", "httpx>=0.27.0"]

[tool.setuptools]
py-modules = ["agent", "main", "tools"]
```

- [ ] **Step 2: `agent/tools.py`** — port the showcase `tools.py` verbatim (the `_do_internet_search` helper, the `@tool internet_search`, and the thread-isolated `@tool research`), changing only the default model fallback `"gpt-5.2"` → `"gpt-5.5"` in the two `os.environ.get("OPENAI_MODEL", ...)` calls. (Full source: `examples/showcases/deep-agents/agent/tools.py` — fetched into the spec's grounding; copy it exactly with that one substitution.)

- [ ] **Step 3: `agent/agent.py`** — port the showcase `agent.py` verbatim, with two edits: default model `"gpt-5.2"` → `"gpt-5.5"`; keep `MAIN_SYSTEM_PROMPT`, `build_agent()`, `create_deep_agent(model=llm, system_prompt=MAIN_SYSTEM_PROMPT, tools=[research], middleware=[CopilotKitMiddleware()], checkpointer=MemorySaver())`, and the `.with_config({"recursion_limit": 100})` return.

- [ ] **Step 4: `agent/main.py`** — port the showcase `main.py`, changing: the `LangGraphAGUIAgent(name="kitebot_research", description="KiteBot deep research assistant — plans, searches, and synthesizes cited briefs", ...)`; keep `/health` (update `"service": "kitebot-research-agent"`), the `copilotkit_customize_config(emit_tool_calls=[...])` + `recursion_limit`, and `add_langgraph_fastapi_endpoint(..., path="/")`. Default `SERVER_PORT` `8123`.

- [ ] **Step 5: `agent/.gitignore`**

```
.venv/
__pycache__/
*.pyc
.env
/reports/
```

- [ ] **Step 6: Install + boot**

Run: `cd agent && uv sync`
Expected: resolves all deps (Python 3.12), creates `.venv` + `uv.lock`.
Run (with `OPENAI_API_KEY` + `TAVILY_API_KEY` in `agent/.env`): `cd agent && uv run python -c "from agent import build_agent; build_agent(); print('OK')"`
Expected: prints `[AGENT] Deep Research Agent created…` then `OK` (no import/build errors).

- [ ] **Step 7: Health check**

Run: `cd agent && uv run uvicorn main:app --port 8123 &` then `curl -s localhost:8123/health`
Expected: `{"status":"ok","service":"kitebot-research-agent","version":"1.0.0"}`. Stop the server.

- [ ] **Step 8: Commit**

```bash
git add agent/pyproject.toml agent/agent.py agent/tools.py agent/main.py agent/.gitignore agent/uv.lock
git commit -m "feat(agent): scaffold Python deepagents deep-research service (AG-UI on :8123)"
```

---

## Task 2: Agent env example + Python tests

**Files:** Create `agent/.env.example`, `agent/tests/test_tools.py`, `agent/tests/test_health.py`.

- [ ] **Step 1: `agent/.env.example`**

```
# KiteBot deep-research agent (agent/) — served over AG-UI on SERVER_PORT.
# The channel host / self-hosted bot points AGENT_URL at http://localhost:8123/
OPENAI_API_KEY=sk-...
# Web research (required). Get one at https://tavily.com
TAVILY_API_KEY=tvly-...
# OpenAI model (defaults to gpt-5.5, matching the rest of OpenTag).
# OPENAI_MODEL=gpt-5.5
# Server bind (defaults 0.0.0.0:8123).
# SERVER_HOST=0.0.0.0
# SERVER_PORT=8123
```

- [ ] **Step 2: Write `agent/tests/test_tools.py` (failing first)**

```python
import agent.tools as tools  # if import path differs under pytest, use `import tools`


def test_do_internet_search_formats_results(monkeypatch):
    class FakeClient:
        def __init__(self, api_key): pass
        def search(self, **kwargs):
            return {"results": [
                {"url": "https://x.com", "title": "X", "content": "c" * 5000},
            ]}
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    monkeypatch.setattr(tools, "TavilyClient", FakeClient)
    out = tools._do_internet_search("q", max_results=1)
    assert out == [{"url": "https://x.com", "title": "X", "content": "c" * 3000}]


def test_do_internet_search_missing_key(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    import pytest
    with pytest.raises(RuntimeError, match="TAVILY_API_KEY"):
        tools._do_internet_search("q")


def test_do_internet_search_swallows_errors(monkeypatch):
    class BoomClient:
        def __init__(self, api_key): pass
        def search(self, **kwargs): raise ValueError("boom")
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    monkeypatch.setattr(tools, "TavilyClient", BoomClient)
    out = tools._do_internet_search("q")
    assert out == [{"error": "boom"}]
```

- [ ] **Step 3: Run tests to verify they pass against the ported code**

Run: `cd agent && uv run pytest tests/test_tools.py -v`
Expected: PASS. (These pin the ported `_do_internet_search` behavior: 3000-char truncation, missing-key raise, error-swallow. If the import path fails, adjust to `import tools` and add `[tool.pytest.ini_options] pythonpath = ["."]` to `pyproject.toml`.)

- [ ] **Step 4: Write `agent/tests/test_health.py`**

```python
from fastapi.testclient import TestClient


def test_health_ok(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    import main
    client = TestClient(main.app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
```

- [ ] **Step 5: Run it**

Run: `cd agent && uv run pytest tests/ -v`
Expected: all PASS. (Building the agent at import time requires the two env vars — hence the `monkeypatch.setenv` before `import main`. If `import main` triggers a real model/network call, mark this test to stub `build_agent`; note the adjustment.)

- [ ] **Step 6: Commit**

```bash
git add agent/.env.example agent/tests/
git commit -m "test(agent): env example + pytest for research tool and health endpoint"
```

---

## Task 3: Standalone AG-UI smoke (agent answers over the AGENT_URL contract)

**Files:** none (verification only). Requires real `OPENAI_API_KEY` + `TAVILY_API_KEY`.

- [ ] **Step 1: Boot the agent**

Run: `cd agent && uv run uvicorn main:app --port 8123`

- [ ] **Step 2: POST an AG-UI run and confirm a research turn**

Drive one AG-UI run against `POST http://localhost:8123/` (the same endpoint `SanitizingHttpAgent`/`AGENT_URL` uses). Use the AG-UI run payload shape (a `threadId`, `runId`, and `messages: [{role:"user", content:"Research the current state of AG-UI"}]`). Confirm the SSE stream emits: a `write_todos` (plan), one or more `research` tool calls, and a final assistant message synthesizing a brief. (If constructing the raw payload is fiddly, use `@ag-ui/client`'s `HttpAgent` from a tiny node script pointed at `http://localhost:8123/` — mirrors exactly what the channel host does.)
Expected: a plan forms, research runs, a synthesized report returns. This proves the agent satisfies the `AGENT_URL` contract independent of Slack/Intelligence.

- [ ] **Step 3: Record the result** in the PR notes (no commit).

---

## Task 4: Rendering spike — do KiteBot's forwarded tools reach the deep agent?

**Files:** none (investigation). This gates Task 5.

- [ ] **Step 1: Point the channel host at the Python agent**

Set `AGENT_URL=http://localhost:8123/` in the root `.env`. Run `agent` (:8123) + the bot (`pnpm dev` self-hosted, or `pnpm channel` if live Intelligence creds are available). @mention KiteBot: `research the AG-UI protocol and summarize`.

- [ ] **Step 2: Observe tool invocation**

Determine whether the deep agent CALLS KiteBot's forwarded generative-UI tools (`render_table`/`show_links`/etc.) — i.e. do rich cards appear — or whether it only returns prose/markdown (the report). If unclear from behavior, inspect: does `add_langgraph_fastapi_endpoint` + `CopilotKitMiddleware` surface per-run AG-UI frontend tools to the `create_deep_agent` model? Check `ag_ui_langgraph` + `copilotkit` installed source for frontend-tool passthrough.

- [ ] **Step 3: Decide the path and record it**

- **PRIMARY** — cards render: Task 5 is a no-op (rendering already works); note it and skip.
- **FALLBACK** — only prose returns: proceed to Task 5 to render the report markdown in the channel.

Document the finding in the PR. (No code committed in this task.)

---

## Task 5: (Conditional) Markdown-report rendering in the channel host

**Only if Task 4 → FALLBACK.** Files: `app/managed.ts` (+ `app/index.ts` for parity).

- [ ] **Step 1: Render the returned report**

The deep agent's final assistant message is markdown (it writes `/reports/final_report.md` and summarizes). channels-ui renders markdown in a `Section`, so the default post already shows it. If the turn returns *only* a terse message with the report in the agent's virtual filesystem, add a channel-side step in `onMention` to post the final assistant text as a `Section` (and, if sources are present in the run state, a `show_links` block). Keep this minimal and platform-agnostic.

- [ ] **Step 2: Test + commit** — add a unit test asserting the report text is posted; `pnpm check-types` + `pnpm test` green.

```bash
git add app/managed.ts app/index.ts app/**/__tests__/*
git commit -m "feat: render deep-agent markdown report in the channel (fallback path)"
```

---

## Task 6: Optional internal sources (Notion + Linear MCP)

**Files:** `agent/tools.py` (add MCP-backed tools), `agent/agent.py` (conditionally include them), `agent/pyproject.toml` (add `langchain-mcp-adapters`).

- [ ] **Step 1: Add `langchain-mcp-adapters` to deps; `uv sync`.**

- [ ] **Step 2: In `agent/tools.py`, add an env-gated builder**

```python
def internal_source_tools() -> list:
    """Notion + Linear MCP tools, included only when their env is present.
    Reuses OpenTag's Phase-1 MCP servers so the agent can research the team's
    own docs/issues alongside the web. Returns [] when unconfigured."""
    tools_list = []
    # Build MCP client tools via langchain_mcp_adapters when LINEAR_API_KEY /
    # NOTION_MCP_AUTH_TOKEN are set (URLs mirror runtime.ts: LINEAR_MCP_URL,
    # NOTION_MCP_URL). Wrap failures so a down MCP never breaks agent startup.
    return tools_list
```

Fill in with `langchain_mcp_adapters` HTTP client wiring mirroring `runtime.ts`'s transports (Linear hosted MCP with bearer `LINEAR_API_KEY`; Notion sidecar with bearer `NOTION_MCP_AUTH_TOKEN`). Gate each on its env var; on connect failure, log and skip (never crash startup).

- [ ] **Step 3: In `agent/agent.py`**, set `main_tools = [research, *internal_source_tools()]` and extend `MAIN_SYSTEM_PROMPT` with one line: prefer the team's Notion/Linear for internal questions, the web for external.

- [ ] **Step 4: Test** — `agent/tests/test_tools.py`: assert `internal_source_tools()` returns `[]` when env is unset (RED-GREEN: set the env with a stub client → returns tools). `uv run pytest`.

- [ ] **Step 5: Commit**

```bash
git add agent/tools.py agent/agent.py agent/pyproject.toml agent/uv.lock agent/tests/
git commit -m "feat(agent): optional Notion/Linear MCP internal research sources (env-gated)"
```

---

## Task 7: Root env & docs

**Files:** `.env.example`, `package.json`, `README.md`, `setup.md`.

- [ ] **Step 1: Root `.env.example`** — add a "Deep-research agent (agent/)" note: `TAVILY_API_KEY`, `OPENAI_MODEL` already documented, and that `AGENT_URL` should point at `http://localhost:8123/` when using the Python deep agent (vs the TS `runtime.ts`).

- [ ] **Step 2: `package.json`** — add `"agent": "cd agent && uv run uvicorn main:app --port ${AGENT_PORT:-8123}"` (a convenience wrapper; document that it needs `uv`).

- [ ] **Step 3: `README.md` + `setup.md`** — add a "Deep research (LangGraph deep agent)" section: what it is (deepagents planner + web research), how to run it (`uv sync` + `pnpm agent`), the `TAVILY_API_KEY` requirement, and that it's an alternative brain to `runtime.ts` — set `AGENT_URL` to `:8123`. Note the now-three-process local setup (agent + bot + Intelligence).

- [ ] **Step 4: Commit**

```bash
git add .env.example package.json README.md setup.md
git commit -m "docs: document the deep-research agent (agent/) run + env"
```

---

## Task 8: Full verification

- [ ] **Step 1:** `cd agent && uv run pytest tests/ -v` → all pass.
- [ ] **Step 2:** `cd agent && uv run uvicorn main:app --port 8123` + `curl localhost:8123/health` → ok.
- [ ] **Step 3:** Phase-1 TS gates unaffected: `pnpm check-types` + `pnpm test` → green.
- [ ] **Step 4 (needs creds):** end-to-end — `AGENT_URL`→`:8123`, run the agent + KiteBot, `@mention KiteBot research <topic>` → a synthesized, sourced brief returns in the channel (as cards or markdown per Task 4).

---

## Notes for the executor
- Port the three Python files from `examples/showcases/deep-agents/agent/{agent,tools,main}.py` **verbatim** except: default model `gpt-5.2`→`gpt-5.5`, agent `name`/`description`/health `service` renamed to KiteBot, `SERVER_PORT` default 8123. Do not redesign the deepagents logic.
- `uv` is the toolchain; if absent, install via the official image/script (see the langgraph-python Dockerfile pattern for Phase 3).
- The rendering spike (Task 4) MUST run before Task 5 — do not build the fallback speculatively.
- End-to-end verification depends on the same live Intelligence creds Phase 1 still needs; the standalone AG-UI smoke (Task 3) is the CI-able proof.
