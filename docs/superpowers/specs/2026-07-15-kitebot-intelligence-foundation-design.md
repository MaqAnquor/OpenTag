# KiteBot on CopilotKit Intelligence — Phase 1 (Foundation)

**Date:** 2026-07-15
**Branch:** `jerel/copilotkit-channels-intelligence-40037b`
**Status:** Design — awaiting review

## North star (context, not all in this phase)

Turn OpenTag into a **one-click, customizable, Intelligence-connected** template whose
bot is **KiteBot**, running on the CopilotKit **Channels + Intelligence** stack, with a
**LangGraph deep-agent** brain (for LangChain co-marketing). The full objective:

- [ ] LangChain / LangGraph **deep agents** (co-marketing) — *Phase 2*
- [ ] **One-click install** (Railway template) — *Phase 3*
- [x] **Customizable** — the `app/` channel surface stays hackable (all phases)
- [x] **Setup with CopilotKit Intelligence** — *this phase*

This spec covers **Phase 1 only**: migrate off the deprecated `@copilotkit/bot*`
packages, drop Redis, rename the bot to KiteBot, and stand up the **unified v2
`CopilotRuntime` Intelligence runtime** that connects the already-provisioned KiteBot
channel (dashboard status: *"Waiting for runtime"*). Phases 2–3 get their own specs.

## Background — what's already true

- The `@copilotkit/bot*` packages were **renamed** to `@copilotkit/channels*`. API
  identifiers are unchanged (`createBot`→still exists, plus new `createChannel`;
  `defineBotTool`, `slack()`, `BotNode`, etc.). Only import specifiers + `jsxImportSource` move.
- All packages are **published on npm**: `@copilotkit/channels@0.1.1`,
  `@copilotkit/channels-intelligence@0.1.1`, `@copilotkit/channels-slack@0.1.2`,
  `@copilotkit/runtime@1.62.3` (exposes `/v2`, `/v2/node`, `/v2/express`). OpenTag's
  old "can't run standalone until packages publish" caveat is **resolved** — a plain
  `pnpm install` from this repo now works.
- The KiteBot channel exists on Intelligence (dev): display name **KiteBot**, id
  `channel_019f670e-8b1c-71a4-97af-7dffb34198b2`, Slack provider (webhook
  `https://dev.intelligence.copilotkit.ai/api/channels/adapters/slack/events`), status
  **Waiting for runtime**, agent **Not declared**.
- Current OpenTag runs a **two-process** model: `runtime.ts` (a v2 `CopilotSseRuntime`
  hosting a `BuiltInAgent` "triage" on `:8200`) + `app/index.ts` (a `createBot` Slack
  bridge). `app/` is a near-verbatim fork of upstream `examples/slack`.

## Target architecture (Phase 1)

Two processes, both env-driven so local == deployed:

1. **Channel host** — a NEW unified `CopilotRuntime` (v2, *intelligence* mode). Holds NO
   Slack tokens; connects to the Intelligence Realtime Gateway, **declares the `kitebot`
   channel**, and streams render frames back. Intelligence owns the Slack edge. This is
   the process whose connection flips the dashboard from *Waiting for runtime* → live.

2. **Agent backend** — the EXISTING `runtime.ts` (`CopilotSseRuntime` + `BuiltInAgent`
   "triage") on `:8200`, unchanged except for the KiteBot persona rename. The channel's
   agent points at it via `HttpAgent`. In Phase 2 the `DEEP_AGENT_URL` is repointed at a
   LangGraph deep-agent service; nothing else in the channel host changes.

The channel definition carries the same customizable surface `createBot` had — the
app's `tools`, `context`, `commands`, HITL gate, and generative-UI renderers — so `app/`
remains the "make it your own" layer.

### Channel host — verified-runnable shape

```ts
import { createServer } from "node:http";
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import { createChannel } from "@copilotkit/channels";        // plural — @copilotkit/channel does NOT exist
import { SanitizingHttpAgent, defaultSlackTools, defaultSlackContext } from "@copilotkit/channels-slack";
// app surface (migrated bot* -> channels*):
import { appTools } from "./tools/index.js";
import { appContext } from "./context/app-context.js";
import { appCommands } from "./commands/index.js";
import { senderContext } from "./sender-context.js";
import { fileIssueSubmit, FILE_ISSUE_CALLBACK } from "./modals/file-issue.js";

const intelligence = new CopilotKitIntelligence({
  apiUrl: process.env.INTELLIGENCE_API_URL!,          // https://dev.intelligence.copilotkit.ai/api
  wsUrl:  process.env.INTELLIGENCE_GATEWAY_WS_URL!,   // wss base; runner/client paths derived
  apiKey: process.env.INTELLIGENCE_API_KEY!,          // cpk-{projectId}_... ; projectId parsed from it
});

const channel = createChannel({
  name: process.env.INTELLIGENCE_CHANNEL_NAME ?? "kitebot",   // MUST match the registered channel name (lowercase kebab)
  agent: (threadId) => {
    const a = new SanitizingHttpAgent({ url: process.env.AGENT_URL! });
    a.threadId = threadId;
    return a;
  },
  tools: [...appTools, ...defaultSlackTools],
  context: [...appContext, ...defaultSlackContext],
  commands: appCommands,
});
// turn + feature handlers (onMention with explicit prompt, onModalSubmit, onThreadStarted)
// ported from upstream examples/slack/app/managed.ts

const runtime = new CopilotRuntime({ agents: {}, intelligence, channels: [channel] });

const listener = createCopilotNodeListener({ runtime, basePath: "/" });
createServer(listener).listen(Number(process.env.PORT ?? 8300));
await listener.channels?.ready();   // channels activate at handler creation; this awaits readiness
```

**Binding model (verified in source):** `projectId` is parsed from the `cpk-…` API key;
the channel binds by **`name`** (not by channel id); provider defaults to `"slack"`. So
the channel id, org id, project id, and a runtime-instance id are **not** inputs in this
path — three secrets + the channel name are the whole config.

## Scope of changes

### 1. Dependencies & build config
- `package.json`: replace the six `@copilotkit/bot*` deps with `@copilotkit/channels*`
  (`channels`, `channels-ui`, `channels-slack`, `channels-discord`, `channels-telegram`,
  `channels-whatsapp`); **drop** `@copilotkit/bot-store-redis`; **add**
  `@copilotkit/channels-intelligence`. Pin to published ranges (`^0.1.1` / `^0.1.2` as
  appropriate); bump `@copilotkit/runtime` to `^1.62.3`. Update the `description` string.
- `tsconfig.json` + `vitest.config.ts`: `jsxImportSource: "@copilotkit/bot-ui"` →
  `"@copilotkit/channels-ui"`.

### 2. Mechanical source rename (`app/**`)
- Find-and-replace import specifiers `@copilotkit/bot* → @copilotkit/channels*` across all
  `.ts`/`.tsx` (source + tests) and matching doc-comments. **No logic changes.**

### 3. Add the Intelligence channel-host entrypoint
- New `app/managed.ts` — the unified `CopilotRuntime` above (turn/feature handlers ported
  from upstream `examples/slack/app/managed.ts`, incl. the multimodal `contentParts`
  prompt). New `channel` npm script (`tsx app/managed.ts`).
- New `app/managed.test.ts` — ported from upstream.

### 4. Drop Redis
- Delete `app/demo-restart.tsx`, delete `docker-compose.yml` (confirm Redis-only first),
  remove the `demo:restart` script, remove the Redis block from `.env.example`, remove
  Redis mentions from README/setup.md.

### 5. Env + docs
- `.env.example`: add an `INTELLIGENCE_*` block (`INTELLIGENCE_API_URL`,
  `INTELLIGENCE_GATEWAY_WS_URL`, `INTELLIGENCE_API_KEY`, `INTELLIGENCE_CHANNEL_NAME`,
  `AGENT_URL`); remove the Redis block.
- `README.md` + `setup.md`: rename bot→channels; **lead with the Intelligence/managed
  deployment as the default** documented path, self-hosted (`index.ts`) as the alternative;
  drop the Redis row/section; add a `@copilotkit/channels-intelligence` entry.

### 6. Rename bot → KiteBot (identity only; project stays "OpenTag")
- `slack-app-manifest.yaml` + `.json`: `display_information.name` and
  `bot_user.display_name` `"CopilotKit Triage"` → **"KiteBot"**.
- `runtime.ts` `SYSTEM_PROMPT` + `app/context/app-context.ts`: name the persona
  ("You are **KiteBot**, an on-call triage assistant…").
- `app/index.ts` comments: "Kite" → "KiteBot".
- Channel machine name: **`kitebot`** (lowercase kebab; the display persona is "KiteBot").
- README `@OpenTag` mention examples → **`@KiteBot`**; "OpenTag agent" prose → "KiteBot".

### 7. npm scripts default
- Keep `dev`/`start` = self-hosted (`index.ts`) so `git clone && pnpm dev` runs out-of-box.
- Add `channel` = `tsx app/managed.ts` (the Intelligence run mode).
- README frames Intelligence as the recommended deployment; the runnable default script
  stays self-hosted. *(Open to flipping — see Open Questions.)*

## Verification (definition of done for Phase 1)
1. `pnpm check-types` and `pnpm test` pass.
2. `grep -r "@copilotkit/bot" .` (excluding node_modules) returns **zero** matches.
3. `pnpm runtime` (agent backend, `:8200`) + `pnpm channel` (channel host, `:8300`)
   both start; the channel host connects to the gateway and the KiteBot dashboard flips
   **Waiting for runtime → live** with the agent declared.
4. An @mention of KiteBot in the connected Slack workspace round-trips: agent replies,
   renders a card, and the HITL gate works — behaviorally identical to the native bot.

## Out of scope (later phases)
- **Phase 2:** stand up the LangGraph deep-agent AG-UI service; repoint `AGENT_URL`
  /`DEEP_AGENT_URL` at it (co-marketing).
- **Phase 3:** Railway one-click template (`railway.json`, deploy button, two-service
  wiring, docs).

## Open questions / confirmations needed from the user
1. **Channel name slug** — dashboard display is "KiteBot"; the registered `name` must be
   lowercase kebab. Confirm it is **`kitebot`** (vs `kite-bot`), else activation fails and
   the channel stays *Waiting for runtime*.
2. **Dev endpoint bases** — confirm `INTELLIGENCE_API_URL`
   (`https://dev.intelligence.copilotkit.ai/api`?) and `INTELLIGENCE_GATEWAY_WS_URL`
   (`wss://dev.intelligence.copilotkit.ai/…` base). API key (`cpk-…`) assumed already in hand.
3. **Scripts default** — keep `dev`/`start` self-hosted (recommended) or flip to `managed.ts`?
