# KiteBot Railway One-Click Template (Phase 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the KiteBot stack one-click deployable to Railway via a `.railway/railway.ts` Infrastructure-as-Code file defining 3 wired services (Python deep-research `agent`, `notion-mcp` sidecar, TS `channel` host), plus per-service build config and README deploy docs.

**Architecture:** Railway IaC (`railway/iac` SDK) declares all 3 services from this one repo (isolated monorepo via per-service `rootDirectory`), their build/start/health, non-secret env + inter-service reference-variable wiring, and secrets via `preserve()` (deployer sets values in Railway). Applied with `railway config apply`. Secrets + the "Deploy on Railway" button + the live deploy are the deployer's steps (need `railway login`).

**Tech Stack:** Railway IaC (`railway` npm SDK v3.5.7, `railway/iac`), TypeScript, nixpacks (agent + node services), the existing `pnpm channel` / `pnpm notion-mcp` scripts and the `agent/` uv project.

> **Implementation note (updated after code review).** The shipped implementation diverged from the
> first-draft snippets below; the code blocks in this plan have been updated to match what landed.
> Key changes made during CR, all reflected in the authoritative [`.railway/railway.ts`](../../../.railway/railway.ts):
> - Services reached over private networking bind `::` (not `0.0.0.0`) — Railway private DNS is IPv6.
>   The `notion-mcp` sidecar's launcher (`scripts/start-notion-mcp.ts`) gained a `NOTION_MCP_HOST` arg
>   (default `127.0.0.1`) which the IaC sets to `::`.
> - Ports are pinned (`agent` `PORT=8123`, `notion-mcp` `NOTION_MCP_PORT=3001`) and dialed via
>   `${{svc.<VAR>}}` so listen/dial ports always agree.
> - **No `agent/railway.toml`** — Railway forbids a service being managed by both IaC and
>   config-as-code, so the agent's build+deploy config lives entirely in the IaC (Task 2 changed).
> - `OPENAI_MODEL` is **not** managed by the IaC (the agent defaults to `gpt-5.5`), so a UI override
>   survives `config apply`. `NOTION_MCP_AUTH_TOKEN` is set once on `notion-mcp` and referenced by the
>   agent. `tsx` + `dotenv` + `@notionhq/notion-mcp-server` moved to `dependencies` (runtime-required).

## Global Constraints
- Secrets are NEVER written into `.railway/railway.ts` or any committed file — declared via `preserve()` and set by the deployer in Railway. Only non-secret wiring/defaults are literal.
- Reference-variable wiring uses literal Railway `${{service.VAR}}` strings in env values (resolved by Railway at deploy) — service names: `agent`, `notion-mcp`, `channel`.
- Model default stays `gpt-5.5` (via the agent's own default, not pinned in the IaC — so it stays
  overridable); channel name default `kitebot` (consistent with Phases 1–2).
- Do not disturb the Phase-1/2 gates: `pnpm check-types`, `pnpm test`, and `agent` pytest must stay green. `.railway/` is outside the root tsconfig `include`, so it won't affect `pnpm check-types`.

---

## Task 1: Railway IaC definition + SDK dependency

**Files:**
- Create: `.railway/railway.ts`
- Modify: `package.json` (add `railway` devDependency)

**Interfaces:**
- Produces: a `.railway/railway.ts` that `railway config plan/apply` consumes; 3 services named `agent`, `notion-mcp`, `channel`.

- [ ] **Step 1: Add the `railway` SDK devDependency (and reclassify runtime deps)**

Run: `pnpm add -D railway@^3.5.7`
Expected: adds `railway` to `devDependencies`; `pnpm-lock.yaml` updates; resolves cleanly.
Also move `tsx`, `dotenv`, and `@notionhq/notion-mcp-server` from `devDependencies` to
`dependencies` — the `channel` and `notion-mcp` services run them at runtime (`tsx app/managed.ts`,
`import "dotenv/config"`, and the sidecar binary), so a production-only install must include them.

- [ ] **Step 2: Create `.railway/railway.ts`** (final, as shipped)

```ts
import { defineRailway, github, preserve, project, service } from "railway/iac";

// KiteBot on CopilotKit Intelligence — one-click Railway topology. See the file's
// own header for the two topology invariants (pinned ports; bind :: for private
// networking). SECRETS are declared with preserve(); non-secret wiring is literal.
const REPO = "CopilotKit/OpenTag";

export default defineRailway(() => {
  // Notion MCP sidecar. Pin NOTION_MCP_PORT (the launcher binds it, not $PORT) and
  // NOTION_MCP_HOST=:: (the upstream server defaults to 127.0.0.1, unreachable
  // across containers). Optional feature; REQUIRES its two tokens if deployed.
  const notionMcp = service("notion-mcp", {
    source: github(REPO),
    start: "pnpm notion-mcp",
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    env: {
      NOTION_MCP_PORT: "3001",
      NOTION_MCP_HOST: "::",
      NOTION_TOKEN: preserve(),
      NOTION_MCP_AUTH_TOKEN: preserve(),
    },
  });

  // Python deep-research agent. Build+deploy config lives here (single source of
  // truth) — NO agent/railway.toml. Bind :: for private networking; pin PORT.
  const agent = service("agent", {
    source: github(REPO, { rootDirectory: "agent" }),
    build: { builder: "NIXPACKS" },
    deploy: {
      startCommand: "uvicorn main:app --host :: --port ${PORT:-8123}",
      healthcheckPath: "/health",
      healthcheckTimeout: 300,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
    env: {
      PORT: "8123",
      // OPENAI_MODEL intentionally NOT set (agent defaults to gpt-5.5; stays overridable).
      NOTION_MCP_URL:
        "http://${{notion-mcp.RAILWAY_PRIVATE_DOMAIN}}:${{notion-mcp.NOTION_MCP_PORT}}/mcp",
      NOTION_MCP_AUTH_TOKEN: "${{notion-mcp.NOTION_MCP_AUTH_TOKEN}}",
      OPENAI_API_KEY: preserve(),
      TAVILY_API_KEY: preserve(),
      LINEAR_API_KEY: preserve(),
    },
  });

  // KiteBot channel host — runs the bot over the Intelligence Realtime Gateway.
  const channel = service("channel", {
    source: github(REPO),
    start: "pnpm channel",
    env: {
      AGENT_URL: "http://${{agent.RAILWAY_PRIVATE_DOMAIN}}:${{agent.PORT}}/",
      // INTELLIGENCE_CHANNEL_NAME left unmanaged (app/managed.ts defaults it to
      // "kitebot") so a UI override survives config apply, like OPENAI_MODEL.
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

## Task 2: Agent build/deploy config (in the IaC) + sidecar host binding

> **Changed during CR.** The original plan created `agent/railway.toml`. That is wrong: Railway
> forbids a service being managed by both IaC and config-as-code, and `railway config plan` errors
> when it finds a `railway.toml` for an IaC-managed service. So the agent's build+deploy config
> lives entirely in `.railway/railway.ts` (Task 1's `build` + `deploy` blocks), and there is **no**
> `agent/railway.toml`.

**Files:**
- Modify: `scripts/start-notion-mcp.ts` (add `NOTION_MCP_HOST` so the sidecar can bind `::` on Railway)

**Interfaces:**
- Consumes: the `agent` service's `build`/`deploy` config declared in Task 1. Produces: a sidecar
  launcher that binds a configurable host.

- [ ] **Step 1: Add a `NOTION_MCP_HOST` arg to `scripts/start-notion-mcp.ts`**

Validate it like the existing `NOTION_MCP_PORT` (it's passed to a `shell: true` spawn), default to
`127.0.0.1` (preserves local behavior = the upstream server's own default), and pass it as
`--host <host>` to the spawned `@notionhq/notion-mcp-server`. The IaC's `notion-mcp` service sets
`NOTION_MCP_HOST: "::"` so on Railway the sidecar is reachable over the IPv6 private network.

- [ ] **Step 2: Confirm no `agent/railway.toml` exists**

Run: `test ! -e agent/railway.toml && echo "no toml (correct)"`
Expected: `no toml (correct)`.

- [ ] **Step 3: Commit** (folded into the CR fix commit)

```bash
git add scripts/start-notion-mcp.ts
git commit -m "fix(deploy): sidecar binds NOTION_MCP_HOST (:: on Railway)"
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
  - `agent`: `OPENAI_API_KEY` (required), `TAVILY_API_KEY` (optional — enables web research), `LINEAR_API_KEY` (optional). (`NOTION_MCP_AUTH_TOKEN` is referenced from `notion-mcp`, not set here.)
  - `notion-mcp`: `NOTION_TOKEN`, `NOTION_MCP_AUTH_TOKEN` (both required for the service to start; the agent reads the auth token via a reference variable). To skip Notion, remove this service from `resources` and the agent's `NOTION_MCP_URL`/`NOTION_MCP_AUTH_TOKEN`.
  - `channel`: `INTELLIGENCE_GATEWAY_WS_URL`, `INTELLIGENCE_API_KEY`, `INTELLIGENCE_ORG_ID`, `INTELLIGENCE_PROJECT_ID`, `INTELLIGENCE_CHANNEL_ID` (from your CopilotKit Intelligence project/channel). `INTELLIGENCE_CHANNEL_NAME` defaults to `kitebot`. The agent's `OPENAI_MODEL` (default `gpt-5.5`) can be overridden in the `agent` service's Variables.
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
