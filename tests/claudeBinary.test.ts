import { describe, expect, it } from "vitest";
import {
  ClaudeNotFoundError,
  candidatePaths,
  nodeProbe,
  resolveClaudeBinary,
  type BinaryProbe,
} from "../src/claudeBinary";

function probe(executables: string[], shell: string | null = null): BinaryProbe {
  return { homeDir: "/home/u", isExecutable: (p) => executables.includes(p), shellLookup: () => shell };
}

describe("resolveClaudeBinary", () => {
  it("uses the configured path when it is executable", () => {
    expect(resolveClaudeBinary("/opt/claude", probe(["/opt/claude", "/home/u/.local/bin/claude"]))).toBe("/opt/claude");
  });

  it("expands ~ in the configured path", () => {
    expect(resolveClaudeBinary("~/bin/claude", probe(["/home/u/bin/claude"]))).toBe("/home/u/bin/claude");
  });

  it("falls back to auto-detection when the configured path is missing (e.g. synced from another machine)", () => {
    expect(resolveClaudeBinary("/Users/mac/.local/bin/claude", probe(["/usr/bin/claude"]))).toBe("/usr/bin/claude");
  });

  it("prefers the login shell lookup", () => {
    expect(resolveClaudeBinary("", probe(["/custom/claude", "/usr/bin/claude"], "/custom/claude"))).toBe("/custom/claude");
  });

  it("checks the known install locations in order", () => {
    expect(resolveClaudeBinary("", probe(["/usr/local/bin/claude", "/home/u/.local/bin/claude"]))).toBe(
      "/home/u/.local/bin/claude",
    );
    expect(candidatePaths("/home/u")).toEqual([
      "/home/u/.local/bin/claude",
      "/home/u/.claude/local/claude",
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      "/usr/bin/claude",
      "/home/u/.npm-global/bin/claude",
    ]);
  });

  it("throws ClaudeNotFoundError listing everything it tried", () => {
    const err = (() => {
      try {
        resolveClaudeBinary("/nope/claude", probe([]));
      } catch (e) {
        return e;
      }
    })() as ClaudeNotFoundError;
    expect(err).toBeInstanceOf(ClaudeNotFoundError);
    expect(err.tried).toContain("/nope/claude");
    expect(err.tried).toContain("/usr/bin/claude");
    expect(err.message).toContain("plugin settings");
  });
});

describe("nodeProbe", () => {
  it("detects executables on the real filesystem", () => {
    const p = nodeProbe();
    expect(p.isExecutable("/bin/sh")).toBe(true);
    expect(p.isExecutable("/definitely/not/here")).toBe(false);
    expect(p.isExecutable("/tmp")).toBe(false);
  });
});
