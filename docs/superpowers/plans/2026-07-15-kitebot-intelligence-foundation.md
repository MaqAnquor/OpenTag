# KiteBot on CopilotKit Intelligence — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate OpenTag off the deprecated `@copilotkit/bot*` packages onto `@copilotkit/channels*`, drop Redis, rename the bot to KiteBot, and add a unified v2 `CopilotRuntime` Intelligence channel host that connects the provisioned `kitebot` channel.

**Architecture:** Two env-driven processes. `runtime.ts` stays the AG-UI agent backend (`CopilotSseRuntime` + `BuiltInAgent` "triage", `:8200`). A new `app/managed.ts` is the channel host: a `CopilotRuntime` in *intelligence* mode that declares one `createChannel({ name: "kitebot" })` whose agent is an `HttpAgent` pointed at `AGENT_URL`. Channel activation happens when `createCopilotNodeListener` builds its handler; `listener.channels.ready()` awaits it. The existing `app/index.ts` self-hosted Slack path is retained.

**Tech Stack:** TypeScript (ESM, NodeNext), `@copilotkit/runtime@^1.62.3` (`/v2`, `/v2/node`), `@copilotkit/channels*@^0.1.x`, `@copilotkit/channels-intelligence`, `@ag-ui/client`, `tsx`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-07-15-kitebot-intelligence-foundation-design.md`

---

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `package.json` | modify | deps: `bot*`→`channels*`, drop redis-store, add channels-intelligence; scripts: add `channel`, drop `demo:restart`; description |
| `tsconfig.json`, `vitest.config.ts` | modify | `jsxImportSource` → `@copilotkit/channels-ui` |
| `app/demo-restart.tsx` | delete | Redis demo (dropped) |
| `docker-compose.yml` | delete | Redis-only helper (dropped) |
| `app/**/*.ts(x)`, `runtime.ts` | modify | import specifier `@copilotkit/bot`→`@copilotkit/channels` |
| `slack-app-manifest.yaml`, `slack-app-manifest.json` | modify | display name → KiteBot |
| `runtime.ts`, `app/context/app-context.ts`, `app/index.ts` | modify | persona → KiteBot |
| `app/managed.ts` | create | Intelligence channel host (unified `CopilotRuntime`) |
| `app/managed.test.ts` | create | unit test for the channel wiring |
| `.env.example` | modify | add `INTELLIGENCE_*`, remove Redis block |
| `README.md`, `setup.md` | modify | bot→channels, lead with Intelligence, drop Redis, KiteBot mentions |

---

## Task 1: Dependency & build-config migration

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json:17`
- Modify: `vitest.config.ts:6`

- [ ] **Step 1: Rewrite the dependency block in `package.json`**

Replace the `dependencies` block's CopilotKit entries and the `description`. The full `dependencies` object becomes:

```json
  "dependencies": {
    "@copilotkit/channels": "^0.1.1",
    "@copilotkit/channels-discord": "^0.1.1",
    "@copilotkit/channels-intelligence": "^0.1.1",
    "@copilotkit/channels-slack": "^0.1.2",
    "@copilotkit/channels-telegram": "^0.1.1",
    "@copilotkit/channels-ui": "^0.1.1",
    "@copilotkit/channels-whatsapp": "^0.1.1",
    "@copilotkit/runtime": "^1.62.3",
    "@tanstack/ai": "^0.32.0",
    "@tanstack/ai-mcp": "^0.1.3",
    "@tanstack/ai-openai": "^0.15.2",
    "@slack/bolt": "^4.2.0",
    "@slack/types": "^2.21.1",
    "playwright": "^1.49.0",
    "zod": "^3.25.76"
  },
```

And update `description` (line 5) to:

```json
  "description": "OpenTag — an open-source, self-hosted alternative to Claude in Slack: run your own AI agent on your infrastructure, with your model and your tools. Built on @copilotkit/channels; also runs on Discord, Telegram & WhatsApp.",
```

- [ ] **Step 2: Update the `scripts` block in `package.json`**

Add a `channel` script and remove `demo:restart`. The `scripts` block becomes:

```json
  "scripts": {
    "dev": "tsx watch app/index.ts",
    "start": "tsx app/index.ts",
    "channel": "tsx app/managed.ts",
    "runtime": "tsx runtime.ts",
    "notion-mcp": "tsx scripts/start-notion-mcp.ts",
    "check-types": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "e2e": "tsx e2e/run.ts",
    "e2e:restart": "tsx e2e/restart-recovery.ts",
    "e2e:telegram": "tsx e2e/telegram-run.ts"
  },
```

- [ ] **Step 3: Update `jsxImportSource` in both config files**

In `tsconfig.json:17` change `"jsxImportSource": "@copilotkit/bot-ui"` → `"jsxImportSource": "@copilotkit/channels-ui"`.

In `vitest.config.ts:6` change `jsxImportSource: "@copilotkit/bot-ui",` → `jsxImportSource: "@copilotkit/channels-ui",`.

- [ ] **Step 4: Install and verify resolution**

Run: `pnpm install`
Expected: completes without "No matching version" / unresolved-package errors for any `@copilotkit/channels*` package.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts pnpm-lock.yaml
git commit -m "build: migrate deps @copilotkit/bot* -> @copilotkit/channels* + add channels-intelligence"
```

---

## Task 2: Drop Redis

**Files:**
- Delete: `app/demo-restart.tsx`
- Delete: `docker-compose.yml`
- Modify: `.env.example:28-34` (Redis block)

Do this BEFORE the rename (Task 3) so the blind `bot`→`channels` replacement never touches the `@copilotkit/bot-store-redis` import (which has no `channels-*` equivalent).

- [ ] **Step 1: Delete the Redis demo files**

```bash
git rm app/demo-restart.tsx docker-compose.yml
```

- [ ] **Step 2: Remove the Redis block from `.env.example`**

Delete these lines (currently `.env.example:28-34`):

```
# ── Persistence (optional) ──────────────────────────────────────────────
# Optional Redis-backed durable store. Used by `pnpm demo:restart` (and any
# bot that passes `store: { adapter: createRedisStore({ url }) }`). Leave blank
# for the in-memory default. With it set, interactive actions (e.g. an approval
# card's button) survive a bot restart — see `app/demo-restart.tsx`.
# Start a local one with `docker compose up -d`.
# REDIS_URL=redis://localhost:6379
```

- [ ] **Step 3: Verify no Redis references remain**

Run: `grep -rn "REDIS_URL\|bot-store-redis\|demo-restart\|createRedisStore\|docker compose\|docker-compose" . --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md' | grep -v node_modules`
Expected: no matches in `package.json`, `.env.example`, or `app/`. (Matches may remain in `README.md`/`setup.md` — those are cleaned in Task 6. `e2e/restart-recovery.ts` is fine; it does not reference Redis.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: drop Redis persistence (demo-restart, docker-compose, env block)"
```

---

## Task 3: Mechanical rename `@copilotkit/bot*` → `@copilotkit/channels*`

**Files:**
- Modify: every `.ts`/`.tsx` under `app/` plus `runtime.ts`

The single substring replacement `@copilotkit/bot` → `@copilotkit/channels` is correct for all variants: `@copilotkit/bot-ui`→`@copilotkit/channels-ui`, `@copilotkit/bot-slack`→`@copilotkit/channels-slack`, and bare `@copilotkit/bot`→`@copilotkit/channels`. API identifiers (`createBot`, `defineBotTool`, `BotNode`, `BotTool`, `slack`, …) are unchanged and MUST NOT be touched.

- [ ] **Step 1: Apply the replacement across source**

```bash
grep -rl '@copilotkit/bot' app runtime.ts --include='*.ts' --include='*.tsx' \
  | xargs sed -i '' 's|@copilotkit/bot|@copilotkit/channels|g'
```

- [ ] **Step 2: Verify zero `@copilotkit/bot` specifiers remain in source**

Run: `grep -rn '@copilotkit/bot' app runtime.ts --include='*.ts' --include='*.tsx'`
Expected: no matches.

- [ ] **Step 3: Typecheck**

Run: `pnpm check-types`
Expected: PASS (exit 0), no "Cannot find module '@copilotkit/channels...'" errors.

- [ ] **Step 4: Run the existing test suite**

Run: `pnpm test`
Expected: PASS — all existing `app/**/*.test.ts(x)` tests green (they import `renderToIR`, `renderSlackMessage`, etc. from the renamed packages).

- [ ] **Step 5: Commit**

```bash
git add app runtime.ts
git commit -m "refactor: rename imports @copilotkit/bot* -> @copilotkit/channels* (no logic change)"
```

---

## Task 4: Rename the bot → KiteBot (identity only)

**Files:**
- Modify: `slack-app-manifest.yaml:2,7`
- Modify: `slack-app-manifest.json:3,14`
- Modify: `runtime.ts:139` (system prompt opening)
- Modify: `app/context/app-context.ts:16-21` (identity entry)
- Modify: `app/index.ts:87-89` (comments)

- [ ] **Step 1: Rename the Slack app display name (both manifests)**

In `slack-app-manifest.yaml`, change both `name: CopilotKit Triage` (line 2) and `display_name: CopilotKit Triage` (line 7) to `KiteBot`.

In `slack-app-manifest.json`, change `"name": "CopilotKit Triage"` (line 3) and `"display_name": "CopilotKit Triage"` (line 14) to `"KiteBot"`.

- [ ] **Step 2: Name the persona in the agent system prompt**

In `runtime.ts`, change the first line of `SYSTEM_PROMPT` (line 139) from:

```ts
  "You are an on-call triage assistant living in a Slack workspace. You help",
```

to:

```ts
  "You are KiteBot, an on-call triage assistant living in a Slack workspace. You help",
```

- [ ] **Step 3: Name the persona in app context**

In `app/context/app-context.ts`, change the identity entry's first value line (line 18) from:

```ts
      "You are the team's on-call triage assistant. Be concise and action-",
```

to:

```ts
      "You are KiteBot, the team's on-call triage assistant. Be concise and action-",
```

- [ ] **Step 4: Update the "Kite" comments in `app/index.ts`**

In `app/index.ts` (lines 87-89), replace the two occurrences of `Kite` in the comment with `KiteBot`:

```ts
        // KiteBot keeps DMs conversational and responds to explicit app mentions
        // in channels/threads. Plain channel thread replies stay quiet unless
        // they mention KiteBot again.
```

(If OpenTag's `app/index.ts` comment wording differs, apply the same `Kite`→`KiteBot` substitution to whatever comment text is present.)

- [ ] **Step 5: Verify and typecheck**

Run: `grep -rn "CopilotKit Triage" slack-app-manifest.yaml slack-app-manifest.json`
Expected: no matches.
Run: `pnpm check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add slack-app-manifest.yaml slack-app-manifest.json runtime.ts app/context/app-context.ts app/index.ts
git commit -m "feat: rename bot identity to KiteBot (display name + persona)"
```

---

## Task 5: Intelligence channel host (`app/managed.ts`)

**Files:**
- Create: `app/managed.ts`
- Create: `app/managed.test.ts`

The entrypoint exports a pure `createKiteBotChannel()` factory (testable without a gateway) and a `main()` that wires it into a `CopilotRuntime` and activates it.

- [ ] **Step 1: Write the failing test**

Create `app/managed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createKiteBotChannel } from "./managed.js";

describe("createKiteBotChannel", () => {
  it("declares the kitebot channel with no direct adapter (managed-eligible)", () => {
    const channel = createKiteBotChannel({ agentUrl: "http://localhost:8200" });
    expect(channel.name).toBe("kitebot");
    // A managed (Intelligence) channel carries NO direct platform adapter;
    // the intelligenceAdapter is attached later at activation.
    expect(channel.adapters).toHaveLength(0);
  });

  it("registers the app's slash commands on the channel", () => {
    const channel = createKiteBotChannel({ agentUrl: "http://localhost:8200" });
    // appCommands includes /file-issue among others; assert it surfaced.
    expect(channel.commandNames).toContain("file-issue");
  });

  it("honors a custom channel name", () => {
    const channel = createKiteBotChannel({
      agentUrl: "http://localhost:8200",
      channelName: "kite-bot",
    });
    expect(channel.name).toBe("kite-bot");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run app/managed.test.ts`
Expected: FAIL — cannot resolve `./managed.js` / `createKiteBotChannel is not a function`.

- [ ] **Step 3: Write `app/managed.ts`**

Create `app/managed.ts`:

```ts
/**
 * Intelligence channel host for KiteBot — the "managed" run mode.
 *
 * Unlike `app/index.ts` (self-hosted: holds Slack tokens, talks to Slack
 * directly), this process holds NO platform credentials. It runs a v2
 * `CopilotRuntime` in *intelligence* mode that declares ONE channel ("kitebot")
 * to the CopilotKit Intelligence realtime gateway. Intelligence owns the Slack
 * edge (signed ingress + Connector Outbox egress); this runtime just receives
 * leased deliveries and streams render frames back.
 *
 * The channel's brain is an external AG-UI agent reached over HTTP at
 * `AGENT_URL` — for now the `runtime.ts` triage backend; in Phase 2 a LangGraph
 * deep agent. The bot's tools/context/commands/handlers are identical to the
 * native bot; only the transport differs.
 *
 * Run: `pnpm channel` with INTELLIGENCE_* + AGENT_URL set (see `.env.example`).
 */
import "dotenv/config";
import { createServer } from "node:http";
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import { createChannel } from "@copilotkit/channels";
import type { Channel } from "@copilotkit/channels";
import {
  SanitizingHttpAgent,
  defaultSlackTools,
  defaultSlackContext,
} from "@copilotkit/channels-slack";
import { appTools } from "./tools/index.js";
import { appContext } from "./context/app-context.js";
import { appCommands } from "./commands/index.js";
import { senderContext } from "./sender-context.js";
import { fileIssueSubmit, FILE_ISSUE_CALLBACK } from "./modals/file-issue.js";
import { closeBrowser } from "./render/browser.js";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
};

export interface CreateKiteBotChannelOptions {
  /** AG-UI agent endpoint the channel's HttpAgent posts to. */
  agentUrl: string;
  /** Optional Authorization header value forwarded to the agent. */
  agentAuthHeader?: string;
  /** Intelligence channel name (lowercase kebab). Defaults to "kitebot". */
  channelName?: string;
}

/**
 * Build the KiteBot channel: the same tools/context/commands/handlers as the
 * native bot, minus any platform adapter (the intelligenceAdapter is attached
 * at activation). Pure — no network, no env reads — so it is unit-testable.
 */
export function createKiteBotChannel(
  opts: CreateKiteBotChannelOptions,
): Channel {
  const channelName = opts.channelName ?? "kitebot";
  const agentHeaders = opts.agentAuthHeader
    ? { Authorization: opts.agentAuthHeader }
    : undefined;

  const channel = createChannel({
    name: channelName,
    agent: (threadId: string) => {
      const a = new SanitizingHttpAgent({ url: opts.agentUrl, headers: agentHeaders });
      a.threadId = threadId;
      return a;
    },
    tools: [...appTools, ...defaultSlackTools],
    context: [...appContext, ...defaultSlackContext],
    commands: appCommands,
  });

  // Turn handler: the managed history endpoint does NOT include the in-flight
  // turn, so pass the current message explicitly as `prompt` (prefer multimodal
  // parts). Mirrors the native bot's onMention otherwise.
  channel.onMention(async ({ thread, message }) => {
    try {
      await thread.runAgent({
        prompt: message.contentParts?.length ? message.contentParts : message.text,
        context: senderContext(message.user, thread.platform),
      });
    } catch (err) {
      console.error("[channel] agent run failed", err);
      await thread
        .post("Sorry — I hit an error handling that. Please try again.")
        .catch((postErr: unknown) =>
          console.error("[channel] failed to post agent error", postErr),
        );
    }
  });

  channel.onModalSubmit(FILE_ISSUE_CALLBACK, fileIssueSubmit);

  channel.onThreadStarted(async ({ thread, user }) => {
    if (!user?.name) return;
    await thread.setSuggestedPrompts([
      { title: `Triage ${user.name}'s issues`, message: "Triage my open issues" },
      { title: "What shipped this week?", message: "Summarize what shipped this week" },
    ]);
  });

  return channel;
}

async function main() {
  const intelligence = new CopilotKitIntelligence({
    apiUrl: required("INTELLIGENCE_API_URL"),
    wsUrl: required("INTELLIGENCE_GATEWAY_WS_URL"),
    apiKey: required("INTELLIGENCE_API_KEY"),
  });

  const channel = createKiteBotChannel({
    agentUrl: required("AGENT_URL"),
    agentAuthHeader: process.env.AGENT_AUTH_HEADER,
    channelName: process.env.INTELLIGENCE_CHANNEL_NAME,
  });

  const runtime = new CopilotRuntime({ agents: {}, intelligence, channels: [channel] });

  const listener = createCopilotNodeListener({ runtime, basePath: "/" });
  const port = Number(process.env.PORT ?? 8300);
  const server = createServer(listener);
  server.listen(port, () => console.log(`[channel] runtime listening on :${port}`));

  // Channels activate at handler creation; await readiness so a failed gateway
  // connect surfaces here instead of silently leaving the channel "Waiting".
  await listener.channels?.ready();
  console.log(`[channel] KiteBot channel "${channel.name}" activated on Intelligence`);

  const shutdown = async (signal: string) => {
    console.log(`\n[channel] received ${signal}, stopping…`);
    let exitCode = 0;
    try {
      await listener.channels?.stop?.();
    } catch (err) {
      console.error("[channel] error stopping channels", err);
      exitCode = 1;
    }
    server.close();
    await closeBrowser().catch((err: unknown) =>
      console.error("[channel] browser cleanup failed (continuing shutdown)", err),
    );
    process.exit(exitCode);
  };
  const runShutdown = (signal: string): void => {
    shutdown(signal).catch((err: unknown) => {
      console.error(`[channel] fatal during ${signal} shutdown`, err);
      process.exit(1);
    });
  };
  process.on("SIGINT", () => runShutdown("SIGINT"));
  process.on("SIGTERM", () => runShutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => {
  console.error("[channel] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[channel] uncaughtException:", err);
});

// Only run the server when executed directly (`pnpm channel`), not when the
// test imports `createKiteBotChannel`.
if (process.argv[1] && process.argv[1].endsWith("managed.ts")) {
  main().catch((err: unknown) => {
    console.error("[channel] fatal: failed to start channel runtime", err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run app/managed.test.ts`
Expected: PASS (3 tests). If `channel.commandNames` does not contain `"file-issue"`, inspect `app/commands/index.ts` for the actual command name and update the assertion to a command that IS declared.

- [ ] **Step 5: Typecheck the whole project**

Run: `pnpm check-types`
Expected: PASS. If `createCopilotNodeListener` / `CopilotRuntime` option names differ from the installed `@copilotkit/runtime` typings, adjust to the typed signature (e.g. `basePath`, `cors`) — the shape here matches `runtime.ts`'s existing `createCopilotNodeListener({ runtime, basePath, cors })` usage.

- [ ] **Step 6: Commit**

```bash
git add app/managed.ts app/managed.test.ts
git commit -m "feat: add Intelligence channel host (unified CopilotRuntime v2) for KiteBot"
```

---

## Task 6: Env & docs

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `setup.md`

- [ ] **Step 1: Add the Intelligence env block to `.env.example`**

Insert this block immediately after the "Agent backend (runtime.ts)" section (after the `AGENT_AUTH_HEADER` line, ~`.env.example:41`):

```
# ── Intelligence channel mode — app/managed.ts (`pnpm channel`) ──────────
# Runs the SAME bot over the CopilotKit Intelligence realtime gateway instead
# of a native adapter — it holds NO Slack tokens (Intelligence owns the Slack
# edge). The agent brain reuses AGENT_URL / AGENT_AUTH_HEADER above.
# Base API URL of the Intelligence platform (dev shown).
# INTELLIGENCE_API_URL=https://dev.intelligence.copilotkit.ai/api
# Intelligence websocket base (runner/client paths are derived from this).
# INTELLIGENCE_GATEWAY_WS_URL=wss://dev.intelligence.copilotkit.ai
# Project API key (cpk-{projectId}_...); the project id is parsed from it.
# INTELLIGENCE_API_KEY=cpk-...
# The registered channel name (lowercase kebab). Defaults to "kitebot".
# INTELLIGENCE_CHANNEL_NAME=kitebot
```

- [ ] **Step 2: Rename bot→channels in `README.md` and `setup.md`, lead with Intelligence, drop Redis, KiteBot mentions**

In `README.md`:
- Replace every `@copilotkit/bot` occurrence with `@copilotkit/channels` (package names + URLs) in the package tables and prose.
- Remove the `@copilotkit/bot-store-redis` "Optional" table row.
- Add a `@copilotkit/channels-intelligence` row under a new heading or the Optional table: "Runs the bot over CopilotKit Intelligence (managed gateway) instead of holding platform tokens — see `app/managed.ts`."
- Reframe the "Quick start" so the **Intelligence/managed deployment is the recommended default** (a `pnpm channel` path with `INTELLIGENCE_*`), and self-hosted (`pnpm dev`) is the "run it yourself locally" alternative. Note packages now publish to npm (standalone `pnpm install` works).
- Change the `@OpenTag` mention examples to `@KiteBot`, and "an OpenTag agent" prose (line 17) to "a KiteBot agent". Keep the OpenTag project title/branding.

In `setup.md`:
- Replace every `@copilotkit/bot` with `@copilotkit/channels` (lines ~53-55, 174).
- Remove the `@copilotkit/bot-store-redis` reference (~line 174) and any Redis/`docker compose` persistence section.
- Update the "Standalone (once `@copilotkit/bot-*` publish)" heading (~line 74) — packages ARE published now; reword to reflect that standalone `pnpm install` works, and drop the "Why not standalone yet?" caveat (~line 87).
- Add a short "Intelligence channel mode" subsection describing `pnpm channel` + the `INTELLIGENCE_*` env.

- [ ] **Step 3: Verify no stale references**

Run: `grep -rn "@copilotkit/bot\b\|bot-store-redis\|CopilotKit Triage\|REDIS_URL" README.md setup.md .env.example`
Expected: no matches. (`@copilotkit/channels*` matches are expected and correct.)

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md setup.md
git commit -m "docs: channels rename, lead with Intelligence deploy, drop Redis, KiteBot mentions"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Clean typecheck + tests**

Run: `pnpm check-types && pnpm test`
Expected: both PASS (exit 0).

- [ ] **Step 2: Prove the migration is complete**

Run: `grep -rn "@copilotkit/bot" . --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md' | grep -v node_modules | grep -v docs/superpowers`
Expected: no matches.

- [ ] **Step 3: Manual gateway smoke test (requires live INTELLIGENCE_* creds)**

Fill `.env` with the real dev values (`INTELLIGENCE_API_URL`, `INTELLIGENCE_GATEWAY_WS_URL`, `INTELLIGENCE_API_KEY`, `INTELLIGENCE_CHANNEL_NAME=kitebot`, `AGENT_URL=http://localhost:8200/api/copilotkit/agent/triage/run`, and the model/MCP keys), then in two terminals:

Run: `pnpm runtime`  → expect `[slack-runtime] agent "triage" ready`.
Run: `pnpm channel`  → expect `[channel] KiteBot channel "kitebot" activated on Intelligence` (no gateway/auth error).
Then check the Intelligence dashboard: KiteBot status flips **Waiting for runtime → live**, agent declared.

If activation errors with a channel-name mismatch, set `INTELLIGENCE_CHANNEL_NAME` to the exact registered slug and retry (no code change).

- [ ] **Step 4: Behavioral check in Slack**

@mention KiteBot in the connected workspace: it replies, renders a card (e.g. "Triage my open issues"), and the confirm-before-write HITL gate fires on a file-issue — behavior identical to the native bot.

---

## Notes for the executor
- Do NOT touch API identifiers during the rename — only package specifiers move (`createBot`, `defineBotTool`, `BotNode`, `slack()` stay).
- Task order matters: Redis (Task 2) is deleted before the rename (Task 3) so `@copilotkit/bot-store-redis` is never mis-rewritten.
- `sed -i ''` is macOS/BSD syntax (empty backup arg). On GNU/Linux use `sed -i`.
- The two dashboard-derived values (`INTELLIGENCE_API_URL`/`_GATEWAY_WS_URL` bases and the channel-name slug) are env-configurable — a wrong value is a config fix, not a code change.
