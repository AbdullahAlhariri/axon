import type { HandledMap, PersistedData, PluginSettings } from "./types";

/** Keychain id used when migrating a token that older versions stored in data.json. */
export const TOKEN_SECRET_ID = "axon-vikunja-token";

export const DEFAULT_SETTINGS: PluginSettings = {
  vikunjaUrl: "",
  vikunjaTokenSecret: "",
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

interface SecretStore {
  setSecret(id: string, secret: string): void;
}

/**
 * Versions before 1.0 kept the Vikunja token in data.json (which syncs with the vault). Move it into
 * Obsidian's keychain and keep only its key in the settings.
 */
export function migrateLegacyToken(
  settings: PluginSettings & { vikunjaToken?: unknown },
  store: SecretStore,
): { settings: PluginSettings; changed: boolean } {
  if (!("vikunjaToken" in settings)) return { settings, changed: false };
  const { vikunjaToken, ...rest } = settings;
  const next: PluginSettings = { ...rest };
  if (typeof vikunjaToken === "string" && vikunjaToken.trim() && !next.vikunjaTokenSecret) {
    store.setSecret(TOKEN_SECRET_ID, vikunjaToken.trim());
    next.vikunjaTokenSecret = TOKEN_SECRET_ID;
  }
  return { settings: next, changed: true };
}
