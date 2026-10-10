// The plugin uses `window.setTimeout` / `window.crypto` (popout-window safe in Obsidian); in Node, window = globalThis.
const g = globalThis as unknown as { window?: unknown };
g.window ??= globalThis;
