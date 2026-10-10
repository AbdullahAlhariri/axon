import { localDateString } from "./dates";
import { OUTPUT_SCHEMA, SYSTEM_PROMPT, buildPrompt, toDrafts } from "./extractor";
import type { HandledStore } from "./handledStore";
import type { ExtractionContext, ExtractionResult, NoteInput, PluginSettings } from "./types";
import type { VikunjaClient } from "./vikunjaClient";

export interface ExtractDeps {
  vikunja: Pick<VikunjaClient, "listProjects" | "listLabels" | "listOpenTasks">;
  handled: Pick<HandledStore, "get">;
  runClaude: (args: { systemPrompt: string; schema: object; prompt: string; signal?: AbortSignal }) => Promise<unknown>;
  now: () => Date;
  timezone: string;
}

export type ExtractSettings = Pick<PluginSettings, "fallbackProjectId" | "openTaskLimit" | "customInstructions">;

export interface Extraction extends ExtractionResult {
  context: ExtractionContext;
}

export async function extractTodos(
  note: NoteInput,
  settings: ExtractSettings,
  deps: ExtractDeps,
  signal?: AbortSignal,
): Promise<Extraction> {
  const [projects, labels, openTasks] = await Promise.all([
    deps.vikunja.listProjects(),
    deps.vikunja.listLabels(),
    deps.vikunja.listOpenTasks(settings.openTaskLimit),
  ]);
  if (projects.length === 0) {
    throw new Error("No Vikunja projects found. Create a project in Vikunja first.");
  }
  const fallbackProjectId =
    settings.fallbackProjectId !== null && projects.some((p) => p.id === settings.fallbackProjectId)
      ? settings.fallbackProjectId
      : projects[0].id;

  const context: ExtractionContext = {
    note,
    today: localDateString(deps.now()),
    timezone: deps.timezone,
    projects,
    labels,
    openTasks,
    handled: deps.handled.get(note.path),
    fallbackProjectId,
    customInstructions: settings.customInstructions,
  };

  const raw = await deps.runClaude({
    systemPrompt: SYSTEM_PROMPT,
    schema: OUTPUT_SCHEMA,
    prompt: buildPrompt(context),
    signal,
  });
  return { ...toDrafts(raw, context), context };
}

/** One-line summary used in the panel header and the status bar, e.g. "2 tasks · 1 maybe". */
export function summarize(result: ExtractionResult): string {
  if (result.tasks.length + result.maybe.length === 0) return "No new tasks";
  return `${result.tasks.length} task${result.tasks.length === 1 ? "" : "s"} · ${result.maybe.length} maybe`;
}
