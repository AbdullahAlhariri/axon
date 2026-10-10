import { describe, expect, it } from "vitest";
import {
  ExtractionError,
  OUTPUT_SCHEMA,
  SYSTEM_PROMPT,
  buildPrompt,
  normalizeQuote,
  toDrafts,
} from "../src/extractor";
import type { ExtractionContext } from "../src/types";

const ctx: ExtractionContext = {
  note: {
    path: "Notes/Daily (2026-10-09).md",
    basename: "Daily (2026-10-09)",
    text: "tomorrow call the dentist\n- send email to sara about the invoice",
    vaultName: "main",
  },
  today: "2026-10-10",
  timezone: "Europe/Amsterdam",
  projects: [
    { id: 1, title: "Inbox" },
    { id: 2, title: "Work" },
  ],
  labels: [
    { id: 10, title: "errand" },
    { id: 11, title: "email" },
  ],
  openTasks: [{ id: 55, title: "Email Sara", dueDate: "2026-10-12T23:59:00+02:00", projectId: 2 }],
  handled: [
    { id: "h1", title: "Buy milk", sourceQuote: "buy milk!!", status: "sent", vikunjaTaskId: 9, at: "2026-10-09T20:00:00.000Z" },
  ],
  fallbackProjectId: 1,
  customInstructions: "Skip daily prayers.",
};

const todo = (over: Record<string, unknown> = {}) => ({
  title: "Call the dentist",
  sourceQuote: "tomorrow call the dentist",
  dueDate: "2026-10-10",
  dueTime: null,
  priority: 0,
  projectId: 2,
  labelIds: [10],
  description: "",
  match: null,
  certainty: "sure",
  ...over,
});

describe("buildPrompt", () => {
  it("contains everything Claude needs", () => {
    const p = buildPrompt(ctx);
    expect(p).toContain("Note location: Notes/Daily (2026-10-09).md");
    expect(p).toContain("Note title: Daily (2026-10-09)");
    expect(p).toContain("Today: Saturday 2026-10-10 (timezone Europe/Amsterdam)");
    expect(p).toContain("Tomorrow: Sunday 2026-10-11");
    expect(p).toContain("Monday 2026-10-12");
    expect(p).toContain("Friday 2026-10-16");
    expect(p).toMatch(/dates in the note's title or location are not today/i);
    expect(p).toContain("fallback project id: 1");
    expect(p).toContain('{"id":2,"title":"Work"}');
    expect(p).toContain('{"id":11,"title":"email"}');
    expect(p).toContain('{"id":55,"title":"Email Sara","due":"2026-10-12"}');
    expect(p).toContain('"id":"h1"');
    expect(p).toContain("Skip daily prayers.");
    expect(p).toContain("--- NOTE START ---\ntomorrow call the dentist\n- send email to sara about the invoice\n--- NOTE END ---");
  });

  it("says (none) when there are no custom instructions", () => {
    expect(buildPrompt({ ...ctx, customInstructions: "  " })).toContain("Extra instructions from the user:\n(none)");
  });
});

describe("SYSTEM_PROMPT and OUTPUT_SCHEMA", () => {
  it("cover the fields the plugin relies on", () => {
    expect(SYSTEM_PROMPT).toContain("sourceQuote");
    const schema = OUTPUT_SCHEMA as { required: string[]; properties: { todos: { items: { required: string[] } } } };
    expect(schema.required).toEqual(["todos"]);
    expect(schema.properties.todos.items.required).toEqual([
      "title",
      "sourceQuote",
      "dueDate",
      "dueTime",
      "priority",
      "projectId",
      "labelIds",
      "description",
      "match",
      "certainty",
    ]);
  });
});

describe("SYSTEM_PROMPT rules", () => {
  it("is not tied to journals or a note date", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/noteDate|journal entry belongs/i);
    expect(SYSTEM_PROMPT).toMatch(/against today/i);
  });

  it("excludes habits and work sessions and merges dependent steps", () => {
    expect(SYSTEM_PROMPT).toMatch(/habits/i);
    expect(SYSTEM_PROMPT).toMatch(/work or study (time|sessions)/i);
    expect(SYSTEM_PROMPT).toMatch(/fallback/i);
    expect(SYSTEM_PROMPT).toMatch(/fewer/i);
  });

  it("drafts reminders, not time blocks for an agenda", () => {
    expect(SYSTEM_PROMPT).toMatch(/reminder/i);
    expect(SYSTEM_PROMPT).toMatch(/time[- ]block/i);
  });

  it("separates sure tasks from maybe tasks and orders by importance", () => {
    expect(SYSTEM_PROMPT).toMatch(/"maybe"/);
    expect(SYSTEM_PROMPT).toMatch(/most important first/i);
  });

  it("allows a little Markdown in descriptions", () => {
    expect(SYSTEM_PROMPT).toMatch(/markdown/i);
  });

  it("titles the first step and writes in the note's main language", () => {
    expect(SYSTEM_PROMPT).toMatch(/title is the first step/i);
    expect(SYSTEM_PROMPT).toMatch(/main language of the note/i);
  });
});

describe("toDrafts", () => {
  it("keeps a valid todo", () => {
    const result = toDrafts({ todos: [todo()] }, ctx);
    expect(result).not.toHaveProperty("noteDate");
    expect(result.maybe).toEqual([]);
    expect(result.existing).toEqual([]);
    expect(result.handled).toEqual([]);
    expect(result.tasks).toEqual([
      {
        key: "d0",
        title: "Call the dentist",
        dueDate: "2026-10-10",
        dueTime: null,
        priority: 0,
        projectId: 2,
        labelIds: [10],
        description: "",
        sourceQuote: "tomorrow call the dentist",
        match: null,
        certainty: "sure",
      },
    ]);
  });

  it("sanitises invalid dates and times", () => {
    const result = toDrafts(
      {
        todos: [
          todo({ dueDate: "10-10-2026", dueTime: "15:00" }),
          todo({ dueDate: "2026-02-30" }),
          todo({ dueTime: "3pm" }),
          todo({ dueDate: null, dueTime: "15:00" }),
          todo({ dueTime: "15:00" }),
        ],
      },
      ctx,
    );
    expect(result.tasks.map((d) => [d.dueDate, d.dueTime])).toEqual([
      [null, null],
      [null, null],
      ["2026-10-10", null],
      [null, null],
      ["2026-10-10", "15:00"],
    ]);
  });

  it("replaces unknown projects with the fallback and drops unknown or duplicate labels", () => {
    const [d] = toDrafts({ todos: [todo({ projectId: 999, labelIds: [10, 10, 77, "11", 11] })] }, ctx).tasks;
    expect(d.projectId).toBe(1);
    expect(d.labelIds).toEqual([10, 11]);
  });

  it("only accepts integer priorities from 0 to 5", () => {
    const drafts = toDrafts(
      { todos: [todo({ priority: 9 }), todo({ priority: "high" }), todo({ priority: 2.5 }), todo({ priority: 4 })] },
      ctx,
    ).tasks;
    expect(drafts.map((d) => d.priority)).toEqual([0, 0, 0, 4]);
  });

  it("skips todos without a title and non-object items", () => {
    const drafts = toDrafts({ todos: [todo({ title: "  " }), null, "x", todo()] }, ctx).tasks;
    expect(drafts.map((d) => d.key)).toEqual(["d3"]);
  });

  it("keeps an 'existing' match only when it points at a known open task", () => {
    const result = toDrafts(
      {
        todos: [
          todo({ match: { kind: "existing", ref: "55", reason: "same" } }),
          todo({ match: { kind: "existing", ref: 55, reason: "numeric ref" } }),
          todo({ match: { kind: "existing", ref: "999", reason: "unknown" } }),
        ],
      },
      ctx,
    );
    expect(result.existing.map((d) => d.match)).toEqual([
      { kind: "existing", ref: "55", reason: "same" },
      { kind: "existing", ref: "55", reason: "numeric ref" },
    ]);
    expect(result.tasks.map((d) => d.match)).toEqual([null]);
  });

  it("hides todos Claude matched to a handled entry", () => {
    const result = toDrafts({ todos: [todo({ match: { kind: "handled", ref: "h1", reason: "already sent" } })] }, ctx);
    expect(result.tasks).toEqual([]);
    expect(result.handled[0].match).toEqual({ kind: "handled", ref: "h1", reason: "already sent" });
  });

  it("hides todos whose source sentence matches a handled entry even when Claude missed it", () => {
    const result = toDrafts({ todos: [todo({ sourceQuote: "Buy  Milk" })] }, ctx);
    expect(result.tasks).toEqual([]);
    expect(result.handled[0].match).toEqual({ kind: "handled", ref: "h1", reason: "Same sentence as a todo you already sent" });
  });

  it("splits sure and maybe tasks, keeping Claude's importance order", () => {
    const result = toDrafts(
      {
        todos: [
          todo({ title: "A", certainty: "maybe" }),
          todo({ title: "B" }),
          todo({ title: "C", certainty: "maybe" }),
          todo({ title: "D" }),
        ],
      },
      ctx,
    );
    expect(result.tasks.map((d) => d.title)).toEqual(["B", "D"]);
    expect(result.maybe.map((d) => d.title)).toEqual(["A", "C"]);
  });

  it("treats a missing or unknown certainty as maybe", () => {
    const result = toDrafts({ todos: [todo({ certainty: undefined }), todo({ certainty: "certain" })] }, ctx);
    expect(result.tasks).toEqual([]);
    expect(result.maybe.map((d) => d.certainty)).toEqual(["maybe", "maybe"]);
  });

  it("puts matches of open Vikunja tasks under existing, whatever their certainty", () => {
    const match = { kind: "existing", ref: "55", reason: "same" };
    const result = toDrafts({ todos: [todo({ match }), todo({ match, certainty: "maybe" })] }, ctx);
    expect(result.existing).toHaveLength(2);
    expect(result.tasks).toEqual([]);
    expect(result.maybe).toEqual([]);
  });

  it("rejects answers without a todos list", () => {
    expect(() => toDrafts(null, ctx)).toThrow(ExtractionError);
    expect(() => toDrafts({}, ctx)).toThrow(ExtractionError);
    expect(() => toDrafts({ todos: "x" }, ctx)).toThrow(ExtractionError);
  });
});

describe("normalizeQuote", () => {
  it("ignores case, punctuation and extra whitespace but keeps letters from any script", () => {
    expect(normalizeQuote("  Buy  milk!! ")).toBe("buy milk");
    expect(normalizeQuote("اقرأ القرآن.")).toBe("اقرأ القرآن");
  });
});
