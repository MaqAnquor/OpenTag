# KiteBot Railway One-Click Template (Phase 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the KiteBot stack one-click deployable to Railway via a `.railway/railway.ts` Infrastructure-as-Code file defining 3 wired services (Python deep-research `agent`, `notion-mcp` sidecar, TS `channel` host), plus per-service build config and README deploy docs.

**Architecture:** Railway IaC (`railway/iac` SDK) declares all 3 services from this one repo (isolated monorepo via per-service `rootDirectory`), their build/start/health, non-secret env + inter-service reference-variable wiring, and secrets via `preserve()` (deployer sets values in Railway). Applied with `railway config apply`. Secrets + the "Deploy on Railway" button + the live deploy are the deployer's steps (need `railway login`).

**Tech Stack:** Railway IaC (`railway` npm SDK v3.5.7, `railway/iac`), TypeScript, nixpacks (agent + node services), the existing `pnpm channel` / `pnpm notion-mcp` scripts and the `agent/` uv project.

## Global Constraints
- Secrets are NEVER written into `.railway/railway.ts` or any committed file — declared via `preserve()` and set by the deployer in Railway. Only non-secret wiring/defaults are literal.
- Reference-variable wiring uses literal Railway `${{service.VAR}}` strings in env values (resolved by Railway at deploy) — service names: `agent`, `notion-mcp`, `channel`.
- Model default stays `gpt-5.5`; channel name default `kitebot` (consistent with Phases 1–2).
- Do not disturb the Phase-1/2 gates: `pnpm check-types`, `pnpm test`, and `agent` pytest must stay green. `.railway/` is outside the root tsconfig `include`, so it won't affect `pnpm check-types`.

---

## Task 1: Railway IaC definition + SDK dependency

**Files:**
- Create: `.railway/railway.ts`
- Modify: `package.json` (add `railway` devDependency)

**Interfaces:**
- Produces: a `.railway/railway.ts` that `railway config plan/apply` consumes; 3 services named `agent`, `notion-mcp`, `channel`.

- [ ] **Step 1: Add the `railway` SDK devDependency**

Run: `pnpm add -D railway@^3.5.7`
Expected: adds `railway` to `devDependencies`; `pnpm-lock.yaml` updates; resolves cleanly.

- [ ] **Step 2: Create `.railway/railway.ts`**

```ts
import { defineRailway, github, preserve, project, service } from "railway/iac";

// KiteBot on CopilotKit Intelligence — one-click Railway topology.
// Three services build from this repo; the Python agent uses rootDirectory "agent".
// Inter-service URLs use Railway reference variables (${{svc.VAR}}), resolved at
// deploy over private networking. SECRETS are declared with preserve() so applying
// never clobbers deployer-set values — set their actual values in the Railway UI
// (see README "Deploy to Railway").
const REPO = "CopilotKit/OpenTag";

export default defineRailway(() => {
  // Notion MCP sidecar — streamable-HTTP MCP server on $PORT.
  const notionMcp = service("notion-mcp", {
    source: github(REPO),
    start: "pnpm notion-mcp",
    env: {
      // secrets (set in Railway UI):
      NOTION_TOKEN: preserve(),
      NOTION_MCP_AUTH_TOKEN: preserve(),
    },
  });

  // Python deep-research agent — deepagents over AG-UI (uvicorn, /health).
  const agent = service("agent", {
    source: github(REPO, { rootDirectory: "agent" }),
    start: "uvicorn main:app --host 0.0.0.0 --port $PORT",
    healthcheck: "/health",
    env: {
      OPENAI_MODEL: "gpt-5.5",
      // internal research source (optional Notion), wired to the sidecar:
      NOTION_MCP_URL:
        "http://${{notion-mcp.RAILWAY_PRIVATE_DOMAIN}}:${{notion-mcp.PORT}}/mcp",
      // secrets (set in Railway UI): OPENAI_API_KEY required; others optional:
      OPENAI_API_KEY: preserve(),
      TAVILY_API_KEY: preserve(),
      NOTION_MCP_AUTH_TOKEN: preserve(),
      LINEAR_API_KEY: preserve(),
    },
  });

  // KiteBot channel host — runs the bot over the Intelligence Realtime Gateway.
  const channel = service("channel", {
    source: github(REPO),
    start: "pnpm channel",
    env: {
      // brain: points at the agent service over private networking:
      AGENT_URL: "http://${{agent.RAILWAY_PRIVATE_DOMAIN}}:${{agent.PORT}}/",
      INTELLIGENCE_CHANNEL_NAME: "kitebot",
      // secrets (set in Railway UI):
      INTELLIGENCE_GATEWAY_WS_URL: preserve(),
      INTELLIGENCE_API_KEY: preserve(),
      INTELLIGENCE_ORG_ID: preserve(),
      INTELLIGENCE_PROJECT_ID: preserve(),
      INTELLIGENCE_CHANNEL_ID: preserve(),
    },
  });

  return project("kitebot", { resources: [notionMcp, agent, channel] });
});
```

- [ ] **Step 3: Type-check the IaC file against the real `railway/iac` types**

Run: `pnpm exec tsc --noEmit --strict --module nodenext --moduleResolution nodenext --skipLibCheck .railway/railway.ts`
Expected: no errors (the `railway/iac` exports `defineRailway`, `github`, `preserve`, `project`, `service` per the SDK's `dist/iac/index.d.ts`). If `preserve` or `github` is not exported under this SDK version, check `node_modules/railway/dist/iac/index.d.ts` and adjust the import/usage to the actual export names; if composite `${{...}}` literal env strings are rejected by the env value type, keep them as plain strings (they are strings) — the type is `string`, so literals pass.

- [ ] **Step 4: Confirm the Phase-1/2 gate is unaffected**

Run: `pnpm check-types`
Expected: PASS (`.railway/` is not in the root tsconfig `include`, so this is unchanged from main).

- [ ] **Step 5: Commit**

```bash
git add .railway/railway.ts package.json pnpm-lock.yaml
git commit -m "feat(deploy): Railway IaC — agent + notion-mcp + channel services, wired"
```

---

## Task 2: Per-service build config for the agent

**Files:**
- Create: `agent/railway.toml`

**Interfaces:**
- Consumes: nothing. Produces: a per-service config Railway reads if a deployer configures the `agent` service with config path `/agent/railway.toml` instead of (or alongside) IaC.

- [ ] **Step 1: Create `agent/railway.toml`** (patterned on the deep-agents showcase; nixpacks builds the `uv` project)

```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8123}"
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 5
```

- [ ] **Step 2: Sanity-check TOML validity**

Run: `pnpm exec node -e "const fs=require('fs');const s=fs.readFileSync('agent/railway.toml','utf8');if(!/builder\s*=\s*\"nixpacks\"/.test(s)||!/healthcheckPath\s*=\s*\"\/health\"/.test(s))throw new Error('bad toml');console.log('railway.toml ok')"`
Expected: `railway.toml ok`.

- [ ] **Step 3: Commit**

```bash
git add agent/railway.toml
git commit -m "feat(deploy): agent/railway.toml (nixpacks + uvicorn + /health)"
```

---

## Task 3: README "Deploy to Railway" section + secrets checklist

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the service names + secrets from Task 1. Produces: deployer-facing docs.

- [ ] **Step 1: Add a "Deploy to Railway (one-click)" section to `README.md`**

Insert a section covering, accurately to the 3 services:
- **What deploys:** 3 services from this repo — `agent` (Python deep-research, `rootDirectory: agent`), `notion-mcp` (`pnpm notion-mcp`), `channel` (`pnpm channel`); the `channel` reaches `agent` and `agent` reaches `notion-mcp` over Railway private networking (auto-wired by the IaC).
- **Deploy via IaC (recommended):**
  ```bash
  npm i -g @railway/cli   # or: brew install railway
  railway login
  railway link            # create/select a Railway project
  railway config apply    # provisions agent + notion-mcp + channel from .railway/railway.ts
  ```
- **Set the secrets** (Railway → each service → Variables) — grouped checklist:
  - `agent`: `OPENAI_API_KEY` (required), `TAVILY_API_KEY` (optional — enables web research), `NOTION_MCP_AUTH_TOKEN` (must match `notion-mcp`), `LINEAR_API_KEY` (optional).
  - `notion-mcp`: `NOTION_TOKEN`, `NOTION_MCP_AUTH_TOKEN` (same value as `agent`).
  - `channel`: `INTELLIGENCE_GATEWAY_WS_URL`, `INTELLIGENCE_API_KEY`, `INTELLIGENCE_ORG_ID`, `INTELLIGENCE_PROJECT_ID`, `INTELLIGENCE_CHANNEL_ID` (from your CopilotKit Intelligence project/channel). `INTELLIGENCE_CHANNEL_NAME` defaults to `kitebot`.
- **"Deploy on Railway" button (optional):** to get a literal one-click button, publish this repo as a Railway template (Railway dashboard → Templates → New, or `railway` template flow) — that requires your Railway account — then add the generated button:
  `[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/<your-template-id>)`
- **Note:** applying the IaC creates the services + wiring; KiteBot goes live only once the secrets are set and the channel connects (dashboard flips *Waiting for runtime → live*).

- [ ] **Step 2: Verify the section references only real service names + env vars**

Run: `grep -nE "notion-mcp|INTELLIGENCE_(GATEWAY_WS_URL|API_KEY|ORG_ID|PROJECT_ID|CHANNEL_ID|CHANNEL_NAME)|OPENAI_API_KEY|NOTION_MCP_AUTH_TOKEN|railway config apply" README.md`
Expected: all present; cross-check names byte-match `.railway/railway.ts`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(deploy): README Deploy-to-Railway section + secrets checklist"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Phase-1/2 gates unaffected**

Run: `pnpm check-types && pnpm test` and `cd agent && OPENAI_API_KEY=sk-dummy uv run pytest tests/ -q`
Expected: TS check-types PASS + all TS tests pass; agent tests pass. (This phase adds only deploy config + docs + a devDep; no source behavior changes.)

- [ ] **Step 2: IaC file resolves against the SDK**

Run: `pnpm exec tsc --noEmit --strict --module nodenext --moduleResolution nodenext --skipLibCheck .railway/railway.ts`
Expected: no errors.

- [ ] **Step 3 (MANUAL — needs the deployer's Railway auth):** `railway login && railway link && railway config plan` validates the topology against a real Railway project, and `railway config apply` + setting the secrets deploys it live. Cannot run in this environment (unauthenticated; secrets are the deployer's). Flag for the maintainer.

---

## Notes for the executor
- Secrets never get literal values in any committed file — `preserve()` only. If a reviewer sees a real key, that's a defect.
- If `railway/iac` under v3.5.7 differs from the documented API (export names, `github` options, env value types), adapt to the installed `node_modules/railway/dist/iac/index.d.ts` and note the deviation — the DSL shape here matches the Railway IaC reference but the SDK is the source of truth.
- The literal `${{svc.VAR}}` env strings are intentional (Railway reference variables); do not "resolve" them to typed refs unless the SDK requires it.
- Live deploy + the published "Deploy on Railway" button are out of scope (need the deployer's Railway login + secrets) — same live-creds gate as the Phase-2 smoke test.
