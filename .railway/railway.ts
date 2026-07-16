import { defineRailway, github, preserve, project, service } from "railway/iac";

// KiteBot on CopilotKit Intelligence — one-click Railway topology.
// Three services build from this repo; the Python agent uses rootDirectory "agent".
// Inter-service URLs use Railway reference variables (${{svc.VAR}}), resolved at
// deploy over private networking. SECRETS are declared with preserve() so applying
// never clobbers deployer-set values — set their actual values in the Railway UI
// (see README "Deploy to Railway").
//
// Ports are pinned as explicit service variables (NOT left to Railway's
// auto-injected $PORT) so each service's listen port and the ${{svc.PORT}} its
// peers dial always agree — see the notion-mcp and agent notes below.
const REPO = "CopilotKit/OpenTag";

export default defineRailway(() => {
  // Notion MCP sidecar — streamable-HTTP MCP server. Its launcher
  // (scripts/start-notion-mcp.ts) binds NOTION_MCP_PORT (default 3001) and does
  // NOT read Railway's injected $PORT, so we pin NOTION_MCP_PORT here and have
  // the agent dial that same variable — otherwise ${{notion-mcp.PORT}} would
  // point at a port nothing listens on.
  const notionMcp = service("notion-mcp", {
    source: github(REPO),
    start: "pnpm notion-mcp",
    env: {
      NOTION_MCP_PORT: "3001",
      // secrets (set in Railway UI):
      NOTION_TOKEN: preserve(),
      NOTION_MCP_AUTH_TOKEN: preserve(),
    },
  });

  // Python deep-research agent — deepagents over AG-UI (uvicorn, /health).
  // This service owns its build + deploy config here (single source of truth):
  // there is deliberately NO agent/railway.toml, because Railway forbids a
  // service being managed by both IaC and config-as-code at once.
  const agent = service("agent", {
    source: github(REPO, { rootDirectory: "agent" }),
    build: { builder: "NIXPACKS" },
    deploy: {
      // agent/main.py reads PORT first (default 8123); bind :: so the service is
      // reachable over Railway private networking on BOTH IPv4 and IPv6 (legacy
      // environments are IPv6-only). The ${PORT:-8123} fallback keeps the bind
      // valid even if PORT is ever unset; PORT is pinned in env below.
      startCommand: "uvicorn main:app --host :: --port ${PORT:-8123}",
      healthcheckPath: "/health",
      healthcheckTimeout: 300,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
    env: {
      // Pin PORT so uvicorn's bind and ${{agent.PORT}} (dialed by channel) agree.
      PORT: "8123",
      OPENAI_MODEL: "gpt-5.5",
      // internal research source (optional Notion), wired to the sidecar on its
      // pinned NOTION_MCP_PORT over private networking:
      NOTION_MCP_URL:
        "http://${{notion-mcp.RAILWAY_PRIVATE_DOMAIN}}:${{notion-mcp.NOTION_MCP_PORT}}/mcp",
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
      // brain: points at the agent service over private networking. The agent
      // pins PORT=8123, so ${{agent.PORT}} resolves to the port uvicorn binds.
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
