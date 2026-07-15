import { describe, it, expect } from "vitest";
import { createKiteBot } from "./managed.js";

describe("createKiteBot", () => {
  it("declares the kitebot channel name", () => {
    const bot = createKiteBot({ agentUrl: "http://localhost:8200" });
    expect(bot.name).toBe("kitebot");
  });

  it("registers the app's slash commands on the bot", () => {
    const bot = createKiteBot({ agentUrl: "http://localhost:8200" });
    // createBot normalizes slash-command names (hyphens -> underscores):
    // app/commands declares "file-issue"; commandNames reports "file_issue".
    expect(bot.commandNames).toContain("file_issue");
  });

  it("honors a custom channel name", () => {
    const bot = createKiteBot({
      agentUrl: "http://localhost:8200",
      channelName: "kite-bot",
    });
    expect(bot.name).toBe("kite-bot");
  });
});
