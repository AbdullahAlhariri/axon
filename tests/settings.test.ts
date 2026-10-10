import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, TOKEN_SECRET_ID, loadPersisted, migrateLegacyToken, normalizeBaseUrl } from "../src/settings";

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
      vikunjaTokenSecret: "",
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

describe("migrateLegacyToken", () => {
  function store() {
    const secrets = new Map<string, string>();
    return { secrets, setSecret: (id: string, v: string) => void secrets.set(id, v), getSecret: (id: string) => secrets.get(id) ?? null };
  }

  it("moves a token stored in data.json into the keychain", () => {
    const st = store();
    const settings = { ...DEFAULT_SETTINGS, vikunjaToken: "tk_123" };
    const result = migrateLegacyToken(settings, st);
    expect(result.changed).toBe(true);
    expect(st.secrets.get(TOKEN_SECRET_ID)).toBe("tk_123");
    expect(result.settings.vikunjaTokenSecret).toBe(TOKEN_SECRET_ID);
    expect(result.settings).not.toHaveProperty("vikunjaToken");
  });

  it("leaves settings alone when there is no legacy token", () => {
    const st = store();
    const result = migrateLegacyToken({ ...DEFAULT_SETTINGS, vikunjaTokenSecret: "mine" }, st);
    expect(result.changed).toBe(false);
    expect(result.settings.vikunjaTokenSecret).toBe("mine");
    expect(st.secrets.size).toBe(0);
  });

  it("drops an empty legacy field without touching the keychain", () => {
    const st = store();
    const result = migrateLegacyToken({ ...DEFAULT_SETTINGS, vikunjaToken: "" }, st);
    expect(result.changed).toBe(true);
    expect(result.settings).not.toHaveProperty("vikunjaToken");
    expect(st.secrets.size).toBe(0);
  });
});
