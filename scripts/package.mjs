// Collects the release files into release/<id>-<version>/ and, when `zip` is available, a .zip next to it.
// The folder can be copied as-is into any vault's .obsidian/plugins/ directory.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FILES = ["main.js", "manifest.json", "styles.css"];

for (const file of FILES) {
  if (!existsSync(file)) {
    console.error(`Missing ${file} — run "npm run build" first.`);
    process.exit(1);
  }
}
const { id, version } = JSON.parse(readFileSync("manifest.json", "utf8"));
const name = `${id}-${version}`;
const out = join("release", name);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const file of FILES) cpSync(file, join(out, file));

const zip = spawnSync("zip", ["-qr", `${name}.zip`, name], { cwd: "release" });
if (zip.status === 0) console.log(`Packaged release/${name}/ and release/${name}.zip`);
else console.log(`Packaged release/${name}/ (install "zip" to also get a .zip)`);
