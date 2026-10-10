import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ClaudeError,
  buildClaudeArgs,
  parseClaudeEnvelope,
  claudeVersion,
  runClaude,
  type RunClaudeOptions,
} from "../src/claudeRunner";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

beforeAll(() => chmodSync(FAKE, 0o755));

function opts(mode: string, extra: Partial<RunClaudeOptions> = {}, env: Record<string, string> = {}): RunClaudeOptions {
  return {
    binary: FAKE,
    model: "claude-sonnet-5-5",
    effort: "medium",
    systemPrompt: "SYS",
    schema: { type: "object" },
    prompt: "hello note",
    timeoutMs: 5000,
    env: { ...process.env, FAKE_MODE: mode, ...env },
    ...extra,
  };
}

async function failure(p: Promise<unknown>): Promise<ClaudeError> {
  const e = await p.then(
    () => {
      throw new Error("expected rejection");
    },
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ClaudeError);
  return e as ClaudeError;
}

describe("buildClaudeArgs", () => {
  it("builds the verified lean headless invocation", () => {
    expect(buildClaudeArgs({ model: "m", effort: "medium", systemPrompt: "SYS", schema: { type: "object" } })).toEqual([
      "-p",
      "--model",
      "m",
      "--effort",
      "medium",
      "--tools",
      "",
      "--no-session-persistence",
      "--output-format",
      "json",
      "--json-schema",
      '{"type":"object"}',
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--system-prompt",
      "SYS",
    ]);
  });
});

describe("runClaude", () => {
  it("passes the prompt on stdin and returns structured_output", async () => {
    const dump = mkdtempSync(join(tmpdir(), "axon-"));
    const o = opts("ok", {}, { FAKE_DUMP: dump });
    await expect(runClaude(o)).resolves.toEqual({ ok: true });
    expect(readFileSync(join(dump, "stdin"), "utf8")).toBe("hello note");
    expect(readFileSync(join(dump, "args"), "utf8")).toBe(`${buildClaudeArgs(o).join("\n")}\n`);
  });

  it("puts the claude binary's own folder first on PATH (npm installs need node from there)", async () => {
    const dump = mkdtempSync(join(tmpdir(), "axon-"));
    await runClaude(opts("ok", {}, { FAKE_DUMP: dump, PATH: "/usr/bin:/bin" }));
    expect(readFileSync(join(dump, "path"), "utf8")).toBe(`${dirname(FAKE)}${delimiter}/usr/bin:/bin`);
  });

  it("reports a non-zero exit with stderr", async () => {
    const e = await failure(runClaude(opts("exit")));
    expect(e.kind).toBe("exit");
    expect(e.message).toContain("Please run /login");
  });

  it("reports output that is not JSON", async () => {
    const e = await failure(runClaude(opts("garbage")));
    expect(e.kind).toBe("parse");
    expect(e.message).toContain("this is not json");
  });

  it("reports is_error envelopes", async () => {
    const e = await failure(runClaude(opts("is_error")));
    expect(e.kind).toBe("result");
    expect(e.message).toContain("ran out of turns");
  });

  it("reports a missing structured_output", async () => {
    const e = await failure(runClaude(opts("no_structured")));
    expect(e.kind).toBe("result");
    expect(e.message).toContain("structured output");
  });

  it("kills the process on timeout", async () => {
    const started = Date.now();
    const e = await failure(runClaude(opts("sleep", { timeoutMs: 300 })));
    expect(e.kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("cancels when the signal aborts", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const e = await failure(runClaude(opts("sleep", { signal: ac.signal })));
    expect(e.kind).toBe("cancelled");
  });

  it("does not start when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const e = await failure(runClaude(opts("ok", { signal: ac.signal })));
    expect(e.kind).toBe("cancelled");
  });

  it("reports a binary that cannot be started", async () => {
    const e = await failure(runClaude(opts("ok", { binary: "/nonexistent/claude" })));
    expect(e.kind).toBe("spawn");
    expect(e.message).toContain("/nonexistent/claude");
  });
});

describe("claudeVersion", () => {
  it("returns the CLI version line", async () => {
    await expect(claudeVersion(FAKE)).resolves.toBe("9.9.9 (Claude Code)");
  });
});

describe("parseClaudeEnvelope", () => {
  it("names an unknown error when subtype is not text", () => {
    expect(() => parseClaudeEnvelope('{"is_error":true,"subtype":{"x":1}}')).toThrow("Claude reported an error: unknown error");
  });
});
