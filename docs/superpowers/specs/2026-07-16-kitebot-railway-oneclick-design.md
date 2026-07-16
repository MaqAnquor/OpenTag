# KiteBot Railway One-Click Template — Phase 3

**Date:** 2026-07-16
**Branch:** new branch off `main` (Phases 1 & 2 merged in PR #6)
**Status:** Design — awaiting review

## Context / north star

Phases 1 & 2 (merged) gave OpenTag a KiteBot channel host on the Intelligence Gateway
(`app/managed.ts`) and a Python LangGraph deepagents deep-research backend (`agent/`).
Phase 3 makes the whole stack **one-click deployable to Railway** — the "one-click install"
objective. Decisions locked with the user: feature the **Python deep-research agent** as the
backend, **include the Notion MCP sidecar**, and deliver it as an **`.railway/railway.ts`
Infrastructure-as-Code** file (all services in one TypeScript definition) plus README
deploy/button steps.

## Grounding (Railway mechanics — verified via Railway docs)

- **Config-as-Code** (`railway.json`/`.toml`) is **per-service** (build/start/health) and its
  path is absolute from repo root.
- **Infrastructure-as-Code** (`.railway/railway.ts`, `railway/iac` SDK) defines the **whole
  project — every service + its build/start/health + env + inter-service wiring — in one
  file**, applied with `railway config apply` (CLI, needs `railway login` + `railway link`).
- **Reference variables** wire services: a service reads another's private domain via
  `svc.env.RAILWAY_PRIVATE_DOMAIN` (compiles to `${{svc.RAILWAY_PRIVATE_DOMAIN}}`); Railway
  resolves `${{other.PORT}}`-style refs at deploy.
- **Isolated monorepo:** each service sets a `rootDirectory`; the Python `agent/` and the TS
  root are independent build roots.
- A literal **"Deploy on Railway" button** requires a *published* template (created in a
  Railway account) — **needs auth**, so this phase authors the repo config + button steps but
  cannot publish the template or deploy live from this environment.
- Reference: the deep-agents showcase ships `railway.toml` (nixpacks + uvicorn + `/health`).

## Target architecture — 3 services in `.railway/railway.ts`

All three build from this repo (`source: github("CopilotKit/OpenTag")`), differing by
`rootDirectory` + start command:

1. **`agent`** — Python deep-research service. `rootDirectory: "agent"`, nixpacks,
   `start: "uvicorn main:app --host 0.0.0.0 --port $PORT"`, `healthcheck: "/health"`.
2. **`notion-mcp`** — Notion MCP sidecar. root repo, `start: "pnpm notion-mcp"`, listens on
   `$PORT` (the script honors `NOTION_MCP_PORT`/`PORT`).
3. **`channel`** — TS channel host. root repo, `start: "pnpm channel"`. Connects out to the
   Intelligence gateway; no inbound public port needed.

**Wiring (env in `railway.ts`, non-secret refs):**
- `channel.env.AGENT_URL = "http://${{agent.RAILWAY_PRIVATE_DOMAIN}}:${{agent.PORT}}/"`
- `agent.env.NOTION_MCP_URL = "http://${{notion-mcp.RAILWAY_PRIVATE_DOMAIN}}:${{notion-mcp.PORT}}/mcp"`
- `agent.env.OPENAI_MODEL = "gpt-5.5"` (and any other non-secret defaults)

**Secrets (deployer sets in the Railway UI; NOT stored in `railway.ts` — the IaC file
declares/preserves them, never contains values):**
- `agent`: `OPENAI_API_KEY` (required), `TAVILY_API_KEY` (optional), `NOTION_MCP_AUTH_TOKEN`,
  optional `LINEAR_API_KEY`.
- `notion-mcp`: `NOTION_TOKEN`, `NOTION_MCP_AUTH_TOKEN` (shared with `agent`).
- `channel`: `INTELLIGENCE_GATEWAY_WS_URL`, `INTELLIGENCE_API_KEY`, `INTELLIGENCE_ORG_ID`,
  `INTELLIGENCE_PROJECT_ID`, `INTELLIGENCE_CHANNEL_ID`, `INTELLIGENCE_CHANNEL_NAME`.

## Artifacts

- **`.railway/railway.ts`** — `defineRailway` returning `project("kitebot", { resources: [agent, notionMcp, channel] })`
  with the three `service(...)` definitions, `rootDirectory`, build/start/health, the
  reference-variable wiring above, non-secret env, and secrets via `preserve()` (so applying
  doesn't clobber deployer-set values).
- **`agent/railway.toml`** (optional per-service belt) — nixpacks + uvicorn + `/health`,
  patterned on the showcase, in case a deployer uses per-service config instead of IaC.
- **`README.md` "Deploy to Railway"** — two documented paths: (a) `railway login && railway
  link && railway config apply` (IaC), and (b) publish a Railway template from the repo → get
  a "Deploy on Railway" button (steps + the button markdown, noting it needs the deployer's
  Railway account). Plus the full **secrets checklist** grouped by service.
- **`railway` devDependency** (or documented `npx`) so `.railway/railway.ts` type-resolves and
  `railway config plan` works.

## Verification (definition of done)

1. `.railway/railway.ts` type-checks against the `railway/iac` types (`tsc`/`railway config
   plan --json` dry parse; the latter needs auth — mark manual).
2. The README deploy steps + secrets checklist are complete and accurate to the 3 services.
3. Phase 1/2 gates unaffected (`pnpm check-types`, `pnpm test`, agent pytest still green).

## Out of scope / manual (needs the deployer's Railway auth + secrets)

- **Publishing the template + the live deploy** — `railway login`, `railway config apply`, and
  setting the secret values in Railway are the deployer's steps (this environment is
  unauthenticated and cannot enter secrets). This is the same live-creds gate as the Phase-2
  smoke test.

## Open questions / to verify in the plan

1. **Composite reference-variable env in the IaC DSL** — whether `AGENT_URL`/`NOTION_MCP_URL`
   are best expressed as literal `"...${{svc.VAR}}..."` strings (Railway resolves at deploy)
   or via the DSL's typed `svc.env.*` refs (which may not compose into a URL string). Resolve
   against the `railway/iac` reference during implementation; prefer the literal `${{...}}`
   form if typed refs don't concatenate.
2. **`agent` builder** — nixpacks auto-detects the `uv` project, or an explicit Dockerfile is
   needed (the showcase used nixpacks + a `startCommand`). Verify; fall back to a Dockerfile if
   nixpacks can't resolve the `uv`/Python 3.12 toolchain.
