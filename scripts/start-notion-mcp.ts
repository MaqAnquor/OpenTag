/**
 * Starts the official Notion MCP server as a Streamable-HTTP sidecar for
 * the triage agent (see `runtime.ts`). Run with `pnpm notion-mcp`.
 *
 * Why a launcher instead of a raw npm script: the two `.env` values need to be
 * mapped to the two DIFFERENT things the Notion server expects — the Notion
 * integration secret (`NOTION_TOKEN`) becomes the OUTBOUND `Authorization:
 * Bearer` the server sends to Notion's API (passed via `OPENAPI_MCP_HEADERS`,
 * see below), and `NOTION_MCP_AUTH_TOKEN` becomes the server's INBOUND HTTP
 * transport bearer (`AUTH_TOKEN` / `--auth-token`) that the agent presents to
 * reach this sidecar. Doing the mapping here works identically on
 * Windows/macOS/Linux without shell-specific env interpolation.
 */
import "dotenv/config";
import { spawn } from "node:child_process";

const authToken = process.env["NOTION_MCP_AUTH_TOKEN"];
const notionToken = process.env["NOTION_TOKEN"];

if (!authToken) {
  console.error(
    "[notion-mcp] NOTION_MCP_AUTH_TOKEN is required — it's the bearer the " +
      "agent uses to reach this sidecar. Set it in .env (any strong string).",
  );
  process.exit(1);
}
if (!notionToken) {
  console.error(
    "[notion-mcp] NOTION_TOKEN is required — the Notion integration secret " +
      "(ntn_...). Create one at notion.so → Settings → Connections.",
  );
  process.exit(1);
}

// Port the sidecar listens on. Must agree with NOTION_MCP_URL as dialed by
// runtime.ts (TS backend) AND by the Python agent/ backend on Railway — both
// default to http://127.0.0.1:3001/mcp. Validated up front because it's passed
// as a `--port` arg to a `shell: true` spawn below — an unvalidated value with
// spaces/shell metacharacters could mangle or inject the command. An empty
// string (a bare `NOTION_MCP_PORT=` in .env) is treated as unset → default.
const rawPort = process.env["NOTION_MCP_PORT"] || undefined;
if (rawPort !== undefined && !/^\d+$/.test(rawPort)) {
  console.error(
    `[notion-mcp] NOTION_MCP_PORT must be a positive integer (1–65535), got: ${JSON.stringify(rawPort)}`,
  );
  process.exit(1);
}
const portNumber = rawPort === undefined ? 3001 : Number(rawPort);
if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
  console.error(
    `[notion-mcp] NOTION_MCP_PORT must be an integer between 1 and 65535, got: ${JSON.stringify(rawPort)}`,
  );
  process.exit(1);
}
const port = String(portNumber);

// Host the sidecar binds to. Defaults to loopback for local dev (matches the
// upstream server's own default). On Railway the `notion-mcp` service sets
// NOTION_MCP_HOST=:: so the sidecar listens on all interfaces and is reachable
// over Railway's (IPv6) private network — without it the server binds 127.0.0.1
// and the agent's cross-container connection is refused. Validated because it's
// passed to a `shell: true` spawn below.
const rawHost = process.env["NOTION_MCP_HOST"] || undefined;
// Must start with an alphanumeric or ":" (for IPv6 like "::") — this both keeps
// it shell-inert and prevents a leading-"-" value being consumed as a flag by
// the child CLI rather than as the host.
if (rawHost !== undefined && !/^[A-Za-z0-9:][A-Za-z0-9.:_-]*$/.test(rawHost)) {
  console.error(
    `[notion-mcp] NOTION_MCP_HOST must be a hostname or IP address starting ` +
      `with a letter, digit, or ":" (e.g. "::", "0.0.0.0", "localhost"), got: ` +
      `${JSON.stringify(rawHost)}`,
  );
  process.exit(1);
}
const host = rawHost ?? "127.0.0.1";

// Carry the Notion secret as the outbound `Authorization: Bearer` via
// OPENAPI_MCP_HEADERS. We deliberately do NOT set `Notion-Version` here: the
// server (@notionhq/notion-mcp-server ≥ 2.4) sources the API version
// per-operation from its bundled OpenAPI spec, and a globally-configured
// `Notion-Version` header would OVERRIDE those per-operation defaults, pinning
// every call to one (soon-stale) version and breaking newer endpoints. Leaving
// it out lets each operation use the version its schema was written for. (Set
// NOTION_VERSION only if you must force a specific version for an older server.)
const forcedVersion = process.env["NOTION_VERSION"];
const openApiHeaders = JSON.stringify({
  Authorization: `Bearer ${notionToken}`,
  ...(forcedVersion ? { "Notion-Version": forcedVersion } : {}),
});

// OPENAPI_MCP_HEADERS is our Notion auth source. It takes precedence anyway
// (the server's parseHeadersFromEnv checks OPENAPI_MCP_HEADERS before falling
// back to NOTION_TOKEN), so deleting NOTION_TOKEN from the child env is
// defensive cleanup: it removes the unused fallback and suppresses the server's
// NOTION_TOKEN startup diagnostic (a /v1/users/me probe). dotenv loaded it into
// process.env, so delete it after the spread.
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  OPENAPI_MCP_HEADERS: openApiHeaders,
  AUTH_TOKEN: authToken,
};
delete childEnv["NOTION_TOKEN"];

const child = spawn(
  "npx",
  [
    "-y",
    "@notionhq/notion-mcp-server",
    "--transport",
    "http",
    "--host",
    host,
    "--port",
    port,
  ],
  {
    stdio: "inherit",
    // shell:true so Windows resolves `npx` -> `npx.cmd`. Node refuses to
    // spawn `.cmd`/`.bat` directly without a shell (CVE-2024-27980), which
    // otherwise fails with `spawn EINVAL`.
    shell: true,
    env: childEnv,
  },
);

// Set when WE forward a shutdown signal (below), so the exit handler can tell a
// clean, operator/platform-initiated stop from an abnormal death.
let shuttingDown = false;
child.on("exit", (code, signal) => {
  // A shutdown WE forwarded (SIGINT/SIGTERM) is deliberate — report success
  // regardless of how the child surfaced it. Checked FIRST because under
  // shell:true the wrapper may report the forwarded signal as a numeric
  // 128+signum code (e.g. 143) rather than code===null; either way a clean
  // stop must not trip the service's ON_FAILURE restart policy.
  if (shuttingDown) process.exit(0);
  // Normal exit: propagate the child's own status.
  if (code !== null) process.exit(code);
  // Signal death we did NOT initiate (SIGKILL/OOM/SIGSEGV) — a real crash;
  // exit non-zero so a supervisor/healthcheck sees the failure.
  console.error(`[notion-mcp] sidecar terminated by signal ${signal ?? "unknown"}`);
  process.exit(1);
});
// Without this, a failed spawn (e.g. `npx` not on PATH -> ENOENT, or EACCES)
// surfaces as an uncaught 'error' event with a raw Node stack trace instead
// of the clean, actionable messages this script prints for every other
// misconfiguration.
child.on("error", (err) => {
  console.error("[notion-mcp] failed to start the sidecar:", err.message);
  process.exit(1);
});
// Forward shutdown signals to the child, then escalate to SIGKILL if it hasn't
// exited within a grace window — the child may be slow/ignore the signal, or
// (under shell:true) the signal may reach the shell wrapper but not propagate
// to the underlying server. `.unref()` so this timer never keeps us alive.
const shutdown = (sig: NodeJS.Signals) => {
  shuttingDown = true;
  child.kill(sig);
  setTimeout(() => child.kill("SIGKILL"), 5000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
