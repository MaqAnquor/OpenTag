import { describe, it, expect } from "vitest";
import type { AgentContentPart } from "@copilotkit/channels-ui";
import {
  createKiteBot,
  promptFromMessage,
  buildAgentHeaders,
  parseProjectId,
} from "./managed.js";

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

describe("promptFromMessage", () => {
  it("returns contentParts when present", () => {
    const parts: AgentContentPart[] = [{ type: "text", text: "hi" }];
    expect(
      promptFromMessage({ contentParts: parts, text: "hi" }),
    ).toBe(parts);
  });

  it("falls back to text when contentParts is empty", () => {
    expect(promptFromMessage({ contentParts: [], text: "hello" })).toBe(
      "hello",
    );
  });

  it("falls back to text when contentParts is absent", () => {
    expect(promptFromMessage({ text: "hello" })).toBe("hello");
  });
});

describe("buildAgentHeaders", () => {
  it("returns undefined when no auth header is given", () => {
    expect(buildAgentHeaders(undefined)).toBeUndefined();
  });

  it("wraps the auth header value in an Authorization object", () => {
    expect(buildAgentHeaders("Bearer abc123")).toEqual({
      Authorization: "Bearer abc123",
    });
  });
});

describe("parseProjectId", () => {
  it("parses a valid positive integer string", () => {
    expect(parseProjectId("42")).toBe(42);
  });

  it("throws on \"0\"", () => {
    expect(() => parseProjectId("0")).toThrow(
      /Invalid INTELLIGENCE_PROJECT_ID/,
    );
  });

  it("throws on a non-numeric string", () => {
    expect(() => parseProjectId("abc")).toThrow(
      /Invalid INTELLIGENCE_PROJECT_ID/,
    );
  });

  it("throws when undefined", () => {
    expect(() => parseProjectId(undefined)).toThrow(
      /Invalid INTELLIGENCE_PROJECT_ID/,
    );
  });

  it("throws on a negative integer string", () => {
    expect(() => parseProjectId("-5")).toThrow(
      /Invalid INTELLIGENCE_PROJECT_ID/,
    );
  });

  it("throws on a non-integer float string", () => {
    expect(() => parseProjectId("1.5")).toThrow(
      /Invalid INTELLIGENCE_PROJECT_ID/,
    );
  });

  it("throws on an empty string", () => {
    expect(() => parseProjectId("")).toThrow(
      /Invalid INTELLIGENCE_PROJECT_ID/,
    );
  });
});
