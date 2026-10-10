import { execFileSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface BinaryProbe {
  homeDir: string;
  isExecutable(path: string): boolean;
  /** Absolute path printed by the user's login shell for `command -v claude`, or null. */
  shellLookup(): string | null;
}

export class ClaudeNotFoundError extends Error {
  constructor(readonly tried: string[]) {
    super(
      `Could not find the Claude Code CLI ("claude"). Tried: ${tried.join(", ")}. ` +
        "Install Claude Code on this machine or set its full path in the plugin settings.",
    );
    this.name = "ClaudeNotFoundError";
  }
}

function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  return path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

export function candidatePaths(home: string): string[] {
  return [
    join(home, ".local/bin/claude"),
    join(home, ".claude/local/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
    join(home, ".npm-global/bin/claude"),
  ];
}

/**
 * Settings sync between machines (remotely-save), so a configured path from another
 * machine must not break this one: if it is not executable here, fall through to auto-detection.
 */
export function resolveClaudeBinary(configuredPath: string, probe: BinaryProbe): string {
  const tried: string[] = [];
  const configured = configuredPath.trim();
  if (configured) {
    const p = expandHome(configured, probe.homeDir);
    if (probe.isExecutable(p)) return p;
    tried.push(p);
  }
  tried.push("login shell `command -v claude`");
  const fromShell = probe.shellLookup();
  if (fromShell && probe.isExecutable(fromShell)) return fromShell;
  for (const p of candidatePaths(probe.homeDir)) {
    tried.push(p);
    if (probe.isExecutable(p)) return p;
  }
  throw new ClaudeNotFoundError(tried);
}

export function nodeProbe(): BinaryProbe {
  return {
    homeDir: homedir(),
    isExecutable(path: string): boolean {
      try {
        accessSync(path, constants.X_OK);
        return statSync(path).isFile();
      } catch {
        return false;
      }
    },
    shellLookup(): string | null {
      const shell = process.env.SHELL || "/bin/sh";
      try {
        const out = execFileSync(shell, ["-lc", "command -v claude"], {
          encoding: "utf8",
          timeout: 5000,
          stdio: ["ignore", "pipe", "ignore"],
        });
        const line = out
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.startsWith("/"))
          .pop();
        return line ?? null;
      } catch {
        return null;
      }
    },
  };
}
