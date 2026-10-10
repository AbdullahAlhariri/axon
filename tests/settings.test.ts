import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadPersisted, normalizeBaseUrl } from "../src/settings";

describe("normalizeBaseUrl", () => {
  it.each([
    ["https://vikunja.example.com", "https://vikunja.example.com"],
    ["https://vikunja.example.com/", "https://vikunja.example.com"],
    ["https://vikunja.example.com/api/v1", "https://vikunja.example.com"],
    ["  https://vikunja.example.com/api/v1/  ", "https://vikunja.example.com"],
    ["http://192.168.1.5:3456/", "http://192.168.1.5:3456"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected);
  });
});

describe("loadPersisted", () => {
  it("returns defaults for empty data", () => {
    expect(loadPersisted(null)).toEqual({ settings: DEFAULT_SETTINGS, handled: {} });
  });

  it("merges stored settings over defaults and keeps handled entries", () => {
    const handled = {
      "a.md": [
        { id: "h1", title: "T", sourceQuote: "q", status: "sent", vikunjaTaskId: 3, at: "2026-10-10T08:00:00.000Z" },
      ],
    };
    const result = loadPersisted({ settings: { vikunjaUrl: "https://v.example.com", effort: "high" }, handled });
    expect(result.settings.vikunjaUrl).toBe("https://v.example.com");
    expect(result.settings.effort).toBe("high");
    expect(result.settings.model).toBe("claude-sonnet-5-5");
    expect(result.handled).toEqual(handled);
  });

  it("ignores malformed handled data", () => {
    expect(loadPersisted({ handled: "nope" }).handled).toEqual({});
    expect(loadPersisted({ handled: ["x"] }).handled).toEqual({});
  });

  it("uses the spec defaults", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      vikunjaUrl: "",
      vikunjaToken: "",
      fallbackProjectId: null,
      claudePath: "",
      model: "claude-sonnet-5-5",
      effort: "medium",
      timeoutSeconds: 120,
      defaultTime: "23:59",
      openTaskLimit: 300,
      customInstructions: "",
    });
  });
});
