/**
 * Starts the official Notion MCP server as a Streamable-HTTP sidecar for
 * the triage agent (see `runtime.ts`). Run with `pnpm notion-mcp`.
 *
 * Why a launcher instead of a raw npm script: the Notion server takes its
 * Notion integration secret via the `NOTION_TOKEN` env var and its HTTP
 * transport bearer via `AUTH_TOKEN` (or `--auth-token`). We keep the
 * example's env in a single `.env` (`NOTION_TOKEN` + `NOTION_MCP_AUTH_TOKEN`)
 * and map it here, so this works identically on Windows/macOS/Linux without
 * shell-specific env interpolation.
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

// Port the sidecar listens on. Must agree with NOTION_MCP_URL in runtime.ts
// (default http://127.0.0.1:3001/mcp). Validated up front because it's
// passed as a `--port` arg to a `shell: true` spawn below — an unvalidated
// value with spaces/shell metacharacters could mangle or inject the command.
const rawPort = process.env["NOTION_MCP_PORT"];
if (rawPort !== undefined && !/^\d+$/.test(rawPort)) {
  console.error(
    `[notion-mcp] NOTION_MCP_PORT must be an integer between 1 and 65535, got: ${JSON.stringify(rawPort)}`,
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

// Notion's REST API requires a `Notion-Version` header. Authenticate via
// OPENAPI_MCP_HEADERS (carrying BOTH Authorization and Notion-Version) rather
// than NOTION_TOKEN: when NOTION_TOKEN is set the server builds its own auth
// header and omits the version, so the API rejects every call with
// 400 `missing_version`. We deliberately do NOT pass NOTION_TOKEN below.
const notionVersion = process.env["NOTION_VERSION"] ?? "2022-06-28";
const openApiHeaders = JSON.stringify({
  Authorization: `Bearer ${notionToken}`,
  "Notion-Version": notionVersion,
});

// OPENAPI_MCP_HEADERS is the sole Notion auth source. NOTION_TOKEN must be
// absent from the child env (dotenv loaded it into process.env, so delete it
// after the spread) — if present, the server ignores OPENAPI_MCP_HEADERS and
// drops the Notion-Version header.
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

// code is null when the child died from a signal (SIGKILL/OOM/SIGSEGV, etc.)
// rather than a normal exit; map that to a non-zero status so a supervisor
// or healthcheck can detect the crash instead of seeing a false "success".
child.on("exit", (code) => process.exit(code ?? 1));
// Without this, a failed spawn (e.g. `npx` not on PATH -> ENOENT, or EACCES)
// surfaces as an uncaught 'error' event with a raw Node stack trace instead
// of the clean, actionable messages this script prints for every other
// misconfiguration.
child.on("error", (err) => {
  console.error("[notion-mcp] failed to start the sidecar:", err.message);
  process.exit(1);
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
