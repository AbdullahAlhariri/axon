import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ["eslint.config.mjs"] } },
    },
  },
  { ignores: ["main.js", "node_modules/**", "release/**", "tests/**", "scripts/**", "esbuild.config.mjs", "vitest.config.ts"] },
]);
