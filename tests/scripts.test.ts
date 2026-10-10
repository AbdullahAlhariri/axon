import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const INSTALL = fileURLToPath(new URL("../scripts/install.mjs", import.meta.url));
const PACKAGE = fileURLToPath(new URL("../scripts/package.mjs", import.meta.url));
const FILES = ["main.js", "manifest.json", "styles.css"];

/** A fake build output directory (what the scripts read from their cwd). */
function buildDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "axon-build-"));
  writeFileSync(join(dir, "main.js"), "// main");
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ id: "axon", version: "1.2.3" }));
  writeFileSync(join(dir, "styles.css"), "/* css */");
  return dir;
}

function run(script: string, cwd: string, args: string[] = []) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}

describe("scripts/install.mjs", () => {
  it("copies the build into <vault>/.obsidian/plugins/axon and keeps data.json", () => {
    const vault = mkdtempSync(join(tmpdir(), "axon-vault-"));
    const pluginDir = join(vault, ".obsidian", "plugins", "axon");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "data.json"), '{"keep":true}');

    const res = run(INSTALL, buildDir(), [vault]);
    expect(res.status).toBe(0);
    for (const f of FILES) expect(existsSync(join(pluginDir, f))).toBe(true);
    expect(readFileSync(join(pluginDir, "data.json"), "utf8")).toBe('{"keep":true}');
  });

  it("refuses a folder that is not an Obsidian vault", () => {
    const notVault = mkdtempSync(join(tmpdir(), "axon-notvault-"));
    const res = run(INSTALL, buildDir(), [notVault]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Not an Obsidian vault");
  });

  it("asks for a build when files are missing", () => {
    const vault = mkdtempSync(join(tmpdir(), "axon-vault-"));
    mkdirSync(join(vault, ".obsidian"));
    const empty = mkdtempSync(join(tmpdir(), "axon-empty-"));
    const res = run(INSTALL, empty, [vault]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("npm run build");
  });
});

describe("scripts/package.mjs", () => {
  it("puts the release files into release/axon-<version>/", () => {
    const dir = buildDir();
    const res = run(PACKAGE, dir);
    expect(res.status).toBe(0);
    const out = join(dir, "release", "axon-1.2.3");
    for (const f of FILES) expect(existsSync(join(out, f))).toBe(true);
  });
});
