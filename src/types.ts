export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Vikunja priority: 0 unset, 1 low, 2 medium, 3 high, 4 urgent, 5 DO NOW. */
export type Priority = 0 | 1 | 2 | 3 | 4 | 5;

export interface PluginSettings {
  vikunjaUrl: string;
  vikunjaToken: string;
  fallbackProjectId: number | null;
  /** Empty string = auto-detect the claude binary. */
  claudePath: string;
  model: string;
  effort: Effort;
  timeoutSeconds: number;
  /** HH:MM used for todos that have a date but no time. */
  defaultTime: string;
  openTaskLimit: number;
  customInstructions: string;
}

export interface VikunjaProject {
  id: number;
  title: string;
}

export interface VikunjaLabel {
  id: number;
  title: string;
}

export interface VikunjaTask {
  id: number;
  title: string;
  /** RFC 3339 string or null when unset. */
  dueDate: string | null;
  projectId: number;
}

export type HandledStatus = "sent" | "dismissed";

export interface HandledEntry {
  id: string;
  title: string;
  sourceQuote: string;
  status: HandledStatus;
  vikunjaTaskId: number | null;
  /** ISO timestamp. */
  at: string;
}

/** Keyed by vault-relative note path. */
export type HandledMap = Record<string, HandledEntry[]>;

export interface DraftMatch {
  kind: "handled" | "existing";
  /** HandledEntry.id for "handled", Vikunja task id (as string) for "existing". */
  ref: string;
  reason: string;
}

export interface Draft {
  /** Stable within one extraction run, e.g. "d0". */
  key: string;
  title: string;
  /** YYYY-MM-DD */
  dueDate: string | null;
  /** HH:MM; null = use the default time. Always null when dueDate is null. */
  dueTime: string | null;
  priority: Priority;
  projectId: number;
  labelIds: number[];
  description: string;
  sourceQuote: string;
  match: DraftMatch | null;
  /** "sure" = clearly a reminder; "maybe" = could be one, shown in the Maybe section. */
  certainty: Certainty;
}

export type Certainty = "sure" | "maybe";

export interface NoteInput {
  /** Vault-relative path, e.g. "Notes/Daily (2026-10-09).md". */
  path: string;
  basename: string;
  text: string;
  vaultName: string;
}

export interface ExtractionContext {
  note: NoteInput;
  /** YYYY-MM-DD in local time. */
  today: string;
  /** IANA timezone, e.g. "Europe/Amsterdam". */
  timezone: string;
  projects: VikunjaProject[];
  labels: VikunjaLabel[];
  openTasks: VikunjaTask[];
  handled: HandledEntry[];
  fallbackProjectId: number;
  customInstructions: string;
}

/** All lists keep Claude's order: most important first. */
export interface ExtractionResult {
  /** Sure tasks. */
  tasks: Draft[];
  /** Possible tasks Claude was not sure about. */
  maybe: Draft[];
  /** Drafts that match an open Vikunja task (not added again unless the user insists). */
  existing: Draft[];
  /** Already sent or dismissed from this note before. */
  handled: Draft[];
}

export interface PersistedData {
  settings: PluginSettings;
  handled: HandledMap;
}
