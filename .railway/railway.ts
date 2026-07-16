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
