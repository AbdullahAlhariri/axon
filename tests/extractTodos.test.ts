import { describe, expect, it, vi } from "vitest";
import { OUTPUT_SCHEMA, SYSTEM_PROMPT } from "../src/extractor";
import { extractTodos, summarize } from "../src/extractTodos";
import type { NoteInput } from "../src/types";

const note: NoteInput = {
  path: "Notes/Daily (2026-10-09).md",
  basename: "Daily (2026-10-09)",
  text: "tomorrow call the dentist",
  vaultName: "main",
};

function deps() {
  return {
    vikunja: {
      listProjects: vi.fn(async () => [
        { id: 1, title: "Inbox" },
        { id: 2, title: "Personal" },
      ]),
      listLabels: vi.fn(async () => [{ id: 10, title: "errand" }]),
      listOpenTasks: vi.fn(async (_limit: number) => [{ id: 55, title: "Email Sara", dueDate: null, projectId: 1 }]),
    },
    handled: { get: vi.fn((_path: string) => []) },
    runClaude: vi.fn(async (_args: { systemPrompt: string; schema: object; prompt: string; signal?: AbortSignal }) => ({
      todos: [
        {
          title: "Call the dentist",
          sourceQuote: "tomorrow call the dentist",
          dueDate: "2026-10-10",
          dueTime: null,
          priority: 0,
          projectId: 2,
          labelIds: [],
          description: "",
          match: null,
          certainty: "sure",
        },
      ],
    })),
    now: () => new Date(2026, 9, 10, 9, 0),
    timezone: "Europe/Amsterdam",
  };
}

const settings = { fallbackProjectId: 2, openTaskLimit: 300, customInstructions: "Skip prayers." };

describe("extractTodos", () => {
  it("gathers Vikunja context, asks Claude and returns drafts with the context", async () => {
    const d = deps();
    const ac = new AbortController();
    const result = await extractTodos(note, settings, d, ac.signal);

    expect(d.vikunja.listOpenTasks).toHaveBeenCalledWith(300);
    expect(d.handled.get).toHaveBeenCalledWith(note.path);
    const args = d.runClaude.mock.calls[0][0];
    expect(args.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(args.schema).toBe(OUTPUT_SCHEMA);
    expect(args.signal).toBe(ac.signal);
    expect(args.prompt).toContain("Today: Saturday 2026-10-10 (timezone Europe/Amsterdam)");
    expect(args.prompt).toContain("fallback project id: 2");
    expect(args.prompt).toContain("Skip prayers.");
    expect(args.prompt).toContain("tomorrow call the dentist");

    expect(result.tasks.map((x) => x.title)).toEqual(["Call the dentist"]);
    expect(result.context.projects).toHaveLength(2);
    expect(result.context.openTasks[0].id).toBe(55);
  });

  it("uses the first project when the configured fallback no longer exists", async () => {
    const d = deps();
    const result = await extractTodos(note, { ...settings, fallbackProjectId: 999 }, d);
    expect(result.context.fallbackProjectId).toBe(1);
  });

  it("does not call Claude when Vikunja fails", async () => {
    const d = deps();
    d.vikunja.listProjects.mockRejectedValueOnce(new Error("Vikunja rejected the API token (HTTP 401)"));
    await expect(extractTodos(note, settings, d)).rejects.toThrow("HTTP 401");
    expect(d.runClaude).not.toHaveBeenCalled();
  });

  it("explains when Vikunja has no projects", async () => {
    const d = deps();
    d.vikunja.listProjects.mockResolvedValueOnce([]);
    await expect(extractTodos(note, settings, d)).rejects.toThrow("No Vikunja projects");
    expect(d.runClaude).not.toHaveBeenCalled();
  });
});

describe("summarize", () => {
  const empty = { tasks: [], maybe: [], existing: [], handled: [] };
  const one = [{}] as never[];
  it("counts tasks and maybe tasks", () => {
    expect(summarize({ ...empty, tasks: [...one, ...one], maybe: one })).toBe("2 tasks · 1 maybe");
    expect(summarize({ ...empty, tasks: one })).toBe("1 task · 0 maybe");
  });
  it("says when nothing new was found", () => {
    expect(summarize({ ...empty, existing: one })).toBe("No new tasks");
  });
});
