// Copies the build output (main.js, manifest.json, styles.css) from the current directory into a vault.
// Usage: node scripts/install.mjs <vault-path>   (or set OBSIDIAN_VAULT)
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const FILES = ["main.js", "manifest.json", "styles.css"];

const target = process.argv[2] ?? process.env.OBSIDIAN_VAULT;
if (!target) {
  console.error("Usage: npm run install-plugin -- /path/to/vault   (or set OBSIDIAN_VAULT)");
  process.exit(1);
}
const vault = resolve(target);
if (!existsSync(join(vault, ".obsidian"))) {
  console.error(`Not an Obsidian vault (no .obsidian folder): ${vault}`);
  process.exit(1);
}
for (const file of FILES) {
  if (!existsSync(file)) {
    console.error(`Missing ${file} — run "npm run build" first.`);
    process.exit(1);
  }
}
const dest = join(vault, ".obsidian", "plugins", "axon");
mkdirSync(dest, { recursive: true });
for (const file of FILES) cpSync(file, join(dest, file));
console.log(`Installed to ${dest} (data.json left untouched)`);
