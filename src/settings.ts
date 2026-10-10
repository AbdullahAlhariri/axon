import type { HandledMap, PersistedData, PluginSettings } from "./types";

export const DEFAULT_SETTINGS: PluginSettings = {
  vikunjaUrl: "",
  vikunjaToken: "",
  fallbackProjectId: null,
  claudePath: "",
  model: "claude-sonnet-5-5",
  effort: "medium",
  timeoutSeconds: 120,
  defaultTime: "23:59",
  openTaskLimit: 300,
  customInstructions: "",
};

/** Accepts the URL with or without trailing slash or "/api/v1" and returns the bare base URL. */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

export function loadPersisted(raw: unknown): PersistedData {
  const obj = (raw !== null && typeof raw === "object" ? raw : {}) as Partial<Record<keyof PersistedData, unknown>>;
  const storedSettings =
    obj.settings !== null && typeof obj.settings === "object" ? (obj.settings as Partial<PluginSettings>) : {};
  const handled =
    obj.handled !== null && typeof obj.handled === "object" && !Array.isArray(obj.handled)
      ? (obj.handled as HandledMap)
      : {};
  return { settings: { ...DEFAULT_SETTINGS, ...storedSettings }, handled };
}
