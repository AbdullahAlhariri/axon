import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, dirname } from "node:path";
import type { Effort } from "./types";

export type ClaudeErrorKind = "spawn" | "exit" | "timeout" | "cancelled" | "parse" | "result";

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly kind: ClaudeErrorKind,
  ) {
    super(message);
    this.name = "ClaudeError";
  }
}

export interface RunClaudeOptions {
  binary: string;
  model: string;
  effort: Effort;
  systemPrompt: string;
  schema: object;
  prompt: string;
  timeoutMs: number;
  signal?: AbortSignal;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Verified 2026-10-10: --strict-mcp-config, --setting-sources "" and --system-prompt cut a call
 * from ~$0.70 to ~$0.005 while keeping the OAuth login. Never use --bare (it disables OAuth).
 */
export function buildClaudeArgs(o: Pick<RunClaudeOptions, "model" | "effort" | "systemPrompt" | "schema">): string[] {
  return [
    "-p",
    "--model",
    o.model,
    "--effort",
    o.effort,
    "--tools",
    "",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(o.schema),
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--system-prompt",
    o.systemPrompt,
  ];
}

export function parseClaudeEnvelope(stdout: string): unknown {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout.trim());
  } catch {
    throw new ClaudeError(`Claude returned output that is not JSON: ${stdout.trim().slice(0, 200) || "(empty)"}`, "parse");
  }
  if (envelope === null || typeof envelope !== "object") {
    throw new ClaudeError("Claude returned an unexpected JSON value", "parse");
  }
  const env = envelope as Record<string, unknown>;
  if (env.is_error === true || (typeof env.subtype === "string" && env.subtype !== "success")) {
    const detail =
      typeof env.result === "string" && env.result
        ? env.result
        : typeof env.subtype === "string"
          ? env.subtype
          : "unknown error";
    throw new ClaudeError(`Claude reported an error: ${detail}`, "result");
  }
  if (env.structured_output === undefined || env.structured_output === null) {
    throw new ClaudeError("Claude did not return structured output", "result");
  }
  return env.structured_output;
}

export function runClaude(o: RunClaudeOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (o.signal?.aborted) {
      reject(new ClaudeError("Cancelled", "cancelled"));
      return;
    }
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timer: number | undefined;

    // Obsidian started from a desktop launcher has a minimal PATH; an npm-installed claude is a node
    // script and needs node, which sits next to it (nvm, npm-global). Put the binary's folder first.
    const baseEnv = o.env ?? process.env;
    const env = { ...baseEnv, PATH: `${dirname(o.binary)}${delimiter}${baseEnv.PATH ?? ""}` };
    const child = spawn(o.binary, buildClaudeArgs(o), {
      cwd: o.cwd ?? tmpdir(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const onAbort = (): void => {
      kill();
      finish(() => reject(new ClaudeError("Cancelled", "cancelled")));
    };
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      o.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const kill = (): void => {
      child.kill("SIGTERM");
      window.setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 2000);
    };

    timer = window.setTimeout(() => {
      kill();
      finish(() =>
        reject(new ClaudeError(`Claude did not answer within ${Math.round(o.timeoutMs / 1000)}s`, "timeout")),
      );
    }, o.timeoutMs);
    o.signal?.addEventListener("abort", onAbort);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      finish(() => reject(new ClaudeError(`Could not start Claude Code at ${o.binary}: ${err.message}`, "spawn")));
    });

    child.on("close", (code) => {
      finish(() => {
        if (code === 0) {
          try {
            resolve(parseClaudeEnvelope(stdout));
          } catch (e) {
            reject(e instanceof Error ? e : new ClaudeError(String(e), "parse"));
          }
          return;
        }
        try {
          parseClaudeEnvelope(stdout);
        } catch (e) {
          if (e instanceof ClaudeError && e.kind === "result") {
            reject(e);
            return;
          }
        }
        const tail = (stderr.trim() || stdout.trim()).split("\n").slice(-20).join("\n");
        reject(new ClaudeError(`Claude exited with code ${code}${tail ? `:\n${tail}` : ""}`, "exit"));
      });
    });

    // If the child dies before reading stdin, the write fails with EPIPE; 'close' reports the real cause.
    child.stdin.on("error", () => {});
    child.stdin.end(o.prompt);
  });
}

export function claudeVersion(binary: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, ["--version"], { timeout: 10_000 }, (err, stdout) => {
      if (err) reject(new ClaudeError(`Could not run ${binary} --version: ${err.message}`, "spawn"));
      else resolve(String(stdout).trim());
    });
  });
}
