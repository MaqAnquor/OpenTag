/**
 * Intelligence channel host for KiteBot — the "managed" run mode.
 *
 * Unlike app/index.ts (self-hosted: holds Slack tokens, talks to Slack
 * directly), this process holds NO platform credentials. It runs the SAME bot
 * over the CopilotKit Intelligence Realtime Gateway: it declares one channel
 * ("kitebot") to the gateway and streams render frames back. Intelligence owns
 * the Slack edge (signed ingress + Connector Outbox egress).
 *
 * The bot's brain is an external AG-UI agent reached over HTTP at AGENT_URL —
 * for now the runtime.ts triage backend; in Phase 2 a LangGraph deep agent.
 * intelligenceAdapter is exclusive, so the bot is created WITHOUT a native
 * adapter and startChannelsOverRealtimeGateway attaches the channel transport.
 *
 * Run: `pnpm channel` with INTELLIGENCE_* + AGENT_URL set (see .env.example).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createBot } from "@copilotkit/channels";
import type { Bot } from "@copilotkit/channels";
import type { AgentContentPart } from "@copilotkit/channels-ui";
import {
  SanitizingHttpAgent,
  defaultSlackTools,
  defaultSlackContext,
} from "@copilotkit/channels-slack";
import { startChannelsOverRealtimeGateway } from "@copilotkit/channels-intelligence";
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

export interface CreateKiteBotOptions {
  /** AG-UI agent endpoint the bot's HttpAgent posts to. */
  agentUrl: string;
  /** Optional Authorization header value forwarded to the agent. */
  agentAuthHeader?: string;
  /** Intelligence channel name (lowercase kebab). Defaults to "kitebot". */
  channelName?: string;
}

/**
 * Pick the prompt to send to the agent for the current turn. Managed history
 * does NOT include the in-flight turn, so the current message is always
 * passed explicitly — preferring multimodal parts when present.
 */
export function promptFromMessage(message: {
  contentParts?: AgentContentPart[];
  text: string;
}): string | AgentContentPart[] {
  return message.contentParts?.length ? message.contentParts : message.text;
}

/** Build the Authorization header object forwarded to the agent, if any. */
export function buildAgentHeaders(
  authHeader?: string,
): { Authorization: string } | undefined {
  return authHeader ? { Authorization: authHeader } : undefined;
}

/**
 * Parse and validate INTELLIGENCE_PROJECT_ID, throwing on any invalid value.
 *
 * Only plain decimal-digit strings (e.g. "42") are accepted. `Number(raw)`
 * alone would also accept hex ("0x10"), exponential ("1e3"), and binary
 * ("0b11") notation — all of which pass `Number.isInteger(n) && n > 0` —
 * so a typo'd env var could silently resolve to the wrong project. The
 * `/^\d+$/` guard rejects anything that isn't a bare non-negative integer
 * before handing it to `Number(...)`.
 */
export function parseProjectId(raw: string | undefined): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) {
    throw new Error(`Invalid INTELLIGENCE_PROJECT_ID: "${raw}"`);
  }
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid INTELLIGENCE_PROJECT_ID: "${raw}"`);
  }
  return n;
}

/**
 * Build the KiteBot bot: same tools/context/commands/handlers as the native
 * bot, minus any platform adapter (the intelligenceAdapter is attached at
 * activation by startChannelsOverRealtimeGateway). Pure — no network, no env
 * reads — so it is unit-testable.
 */
export function createKiteBot(opts: CreateKiteBotOptions): Bot {
  const channelName = opts.channelName ?? "kitebot";
  const agentHeaders = buildAgentHeaders(opts.agentAuthHeader);

  const bot = createBot({
    name: channelName,
    agent: (threadId: string) => {
      const a = new SanitizingHttpAgent({
        url: opts.agentUrl,
        headers: agentHeaders,
      });
      a.threadId = threadId;
      return a;
    },
    tools: [...appTools, ...defaultSlackTools],
    context: [...appContext, ...defaultSlackContext],
    commands: appCommands,
  });

  // Managed history does NOT include the in-flight turn, so pass the current
  // message explicitly as `prompt` (prefer multimodal parts). Mirrors the
  // native bot's onMention otherwise.
  bot.onMention(async ({ thread, message }) => {
    try {
      await thread.runAgent({
        prompt: promptFromMessage(message),
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

  bot.onModalSubmit(FILE_ISSUE_CALLBACK, fileIssueSubmit);

  bot.onThreadStarted(async ({ thread, user }) => {
    if (!user?.name) return;
    try {
      await thread.setSuggestedPrompts([
        {
          title: `Triage ${user.name}'s issues`,
          message: "Triage my open issues",
        },
        {
          title: "What shipped this week?",
          message: "Summarize what shipped this week",
        },
      ]);
    } catch (err) {
      console.error("[channel] onThreadStarted failed", err);
    }
  });

  return bot;
}

async function main() {
  const channelName = process.env.INTELLIGENCE_CHANNEL_NAME ?? "kitebot";

  const bot = createKiteBot({
    agentUrl: required("AGENT_URL"),
    agentAuthHeader: process.env.AGENT_AUTH_HEADER,
    channelName,
  });

  let projectId: number;
  try {
    projectId = parseProjectId(process.env.INTELLIGENCE_PROJECT_ID);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    process.exit(1);
  }

  const handle = await startChannelsOverRealtimeGateway([bot], {
    wsUrl: required("INTELLIGENCE_GATEWAY_WS_URL"),
    apiKey: required("INTELLIGENCE_API_KEY"),
    scope: {
      organizationId: required("INTELLIGENCE_ORG_ID"),
      projectId,
      channelId: required("INTELLIGENCE_CHANNEL_ID"),
      channelName,
    },
    runtimeInstanceId:
      process.env.INTELLIGENCE_RUNTIME_INSTANCE_ID ??
      `rti_${randomUUID().replace(/-/g, "")}`,
    adapter: "slack",
    // meta can contain message content, so it is gated behind CHANNEL_DEBUG
    // and omitted from stdout/logs by default.
    log: (msg, meta) =>
      console.log(
        `[channel] ${msg}`,
        process.env.CHANNEL_DEBUG ? (meta ?? "") : "",
      ),
  });
  console.log(
    `[channel] KiteBot channel "${channelName}" started over Realtime Gateway on project ${projectId}`,
  );

  const shutdown = async (signal: string) => {
    console.log(`\n[channel] received ${signal}, stopping…`);
    let exitCode = 0;
    try {
      await handle.stop();
    } catch (err) {
      console.error("[channel] error stopping channel runtime", err);
      exitCode = 1;
    }
    await closeBrowser().catch((err: unknown) =>
      console.error(
        "[channel] browser cleanup failed (continuing shutdown)",
        err,
      ),
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

// Only start the gateway connection when executed directly (`pnpm channel`),
// not when the test imports `createKiteBot`.
if (process.argv[1] && process.argv[1].endsWith("managed.ts")) {
  main().catch((err: unknown) => {
    console.error("[channel] fatal: failed to start channel runtime", err);
    process.exit(1);
  });
}
