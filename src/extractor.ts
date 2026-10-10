import { addDays, isValidDate, isValidTime, weekdayName } from "./dates";
import type { Draft, DraftMatch, ExtractionContext, ExtractionResult, HandledEntry, Priority } from "./types";

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export const SYSTEM_PROMPT = `You read one personal note (a journal entry, meeting notes, a brain dump, ...) and draft the tasks its author should put in their task manager, Vikunja.
Notes are written quickly: expect typos and a mix of English, Dutch and Arabic words.

Vikunja holds REMINDERS: things the author would otherwise forget to do. It is not their agenda. Anything they would plan as a time block in their calendar (a walk, a work or study session, a prayer, a gym visit) is not a task, even when the note says when it will happen.

A task must meet ALL of these:
- a concrete, one-off action the author still has to do themselves;
- it has a clear moment when it is done: an email sent, a call made, an appointment booked, something bought, sent, submitted, fixed or arranged;
- the author could forget it without a reminder.

Never a task:
- habits, routines and recurring practices: prayer and other religious or spiritual practice, daily reading, exercise, walks, sleep, meals, waking up early;
- planned work or study time on something ongoing ("work on Frontassist", "continue with calculus week 5 and 6", "study for the exam"), unless a specific deliverable with a clear end is named ("submit the week 5 assignment");
- time-blocked plans for how to spend a day ("work on X until lunch, then a walk in the forest, or the street if it rains"), leisure, reflections, feelings, and anything already done.

Merge: steps that serve one goal are ONE task. That includes sequential steps and a first option with a fallback ("ask A for a quote, otherwise call B"). The title is the first step to take; the description says what comes next or what to do if it fails. Something mentioned twice is one task.
certainty: "sure" when the item clearly meets all of the above. "maybe" when it could be a reminder but you are not sure: the intent is vague, it might already be done, or it might be just a thought. Habits, routines and time blocks are neither: leave them out completely. Keep the "sure" list short: fewer, clearly useful tasks are better than many.
Order: return the todos most important first: deadlines, urgency, and how bad it would be to forget.

Fields:
- title: short and clear, starting with a verb, typos fixed, names and proper nouns kept.
- Language: write every title and description in the main language of the note, even when a task uses a word from another language; keep such words, names and places as they are (e.g. "Ask the garage for an offerte").
- dueDate (YYYY-MM-DD): only when the note states or clearly implies a day. Resolve "tomorrow", "Monday", "next week" against today's date given in the message (use the listed days), never against a date in the note's title or location. null otherwise.
- dueTime (HH:MM, 24-hour): only when a time of day is stated, otherwise null. Always null when dueDate is null.
- priority: 0 unless the text signals urgency or importance (1 low, 2 medium, 3 high, 4 urgent, 5 do now).
- projectId: the best fitting id from the provided projects; the fallback project id when nothing fits. labelIds: only ids from the provided labels, usually none. Never invent ids.
- description: one short sentence that helps to do the task (what exactly, the next step or fallback). "" when the title says it all. Never mention the note itself. Markdown is allowed and rendered (e.g. **bold** or a short "- " list when there are a few steps); keep it brief.
- sourceQuote: the shortest span of the note this task comes from, copied character for character. Keep the author's original spelling and typos.
- match: if the task is the same real-world action as one in "Tasks already handled from this note", set {"kind":"handled","ref":"<its id>","reason":"<why>"}. Otherwise, if it is the same as an open Vikunja task, set {"kind":"existing","ref":"<task id>","reason":"<why>"}. Otherwise null. Different wording can still be the same action.

Follow the user's extra instructions; they take precedence over these rules.
If there are no tasks, return an empty todos list.

Example note:
"tomorrow i want to wake up early, meditate and read for an hour, then work on my thesis until lunch and maybe walk in the forest. also need to mail sara about the invoice
- mail sara about invoice
- call the dentist to move my appointment, if they dont pick up mail them"
Tasks for this example (2, nothing else):
1. title "Email Sara about the invoice", description "".
2. title "Call the dentist to move the appointment", description "If they don't pick up, email them instead."
(Likewise "first ask A for an offerte, otherwise book with B" becomes title "Ask A for an offerte", description "If that doesn't work out, book with B.")
Not tasks: waking up early, meditating, reading, thesis work session, forest walk.`;

export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["todos"],
  properties: {
    todos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
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
        ],
        properties: {
          title: { type: "string" },
          sourceQuote: { type: "string" },
          dueDate: { type: ["string", "null"], description: "YYYY-MM-DD" },
          dueTime: { type: ["string", "null"], description: "HH:MM" },
          priority: { type: "integer", minimum: 0, maximum: 5 },
          projectId: { type: "integer" },
          labelIds: { type: "array", items: { type: "integer" } },
          description: { type: "string" },
          certainty: { type: "string", enum: ["sure", "maybe"] },
          match: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "ref", "reason"],
                properties: {
                  kind: { type: "string", enum: ["handled", "existing"] },
                  ref: { type: "string" },
                  reason: { type: "string" },
                },
              },
            ],
          },
        },
      },
    },
  },
};

export function buildPrompt(ctx: ExtractionContext): string {
  const projects = ctx.projects.map((p) => ({ id: p.id, title: p.title }));
  const labels = ctx.labels.map((l) => ({ id: l.id, title: l.title }));
  const openTasks = ctx.openTasks.map((t) => ({ id: t.id, title: t.title, due: t.dueDate ? t.dueDate.slice(0, 10) : null }));
  const handled = ctx.handled.map((h) => ({ id: h.id, title: h.title, sourceQuote: h.sourceQuote, status: h.status }));
  const day = (offset: number): string => {
    const date = addDays(ctx.today, offset);
    return `${weekdayName(date)} ${date}`;
  };
  const nextDays = [2, 3, 4, 5, 6, 7].map(day).join(", ");
  return [
    `Today: ${day(0)} (timezone ${ctx.timezone})`,
    `Tomorrow: ${day(1)}`,
    `The days after: ${nextDays}`,
    "Use these for every due date. Dates in the note's title or location are not today and must be ignored for due dates.",
    "",
    `Note title: ${ctx.note.basename}`,
    `Note location: ${ctx.note.path}`,
    "",
    `Vikunja projects (fallback project id: ${ctx.fallbackProjectId}):`,
    JSON.stringify(projects),
    "",
    "Vikunja labels:",
    JSON.stringify(labels),
    "",
    "Open Vikunja tasks (for duplicate detection):",
    JSON.stringify(openTasks),
    "",
    "Tasks already handled from this note (sent or dismissed):",
    JSON.stringify(handled),
    "",
    "Extra instructions from the user:",
    ctx.customInstructions.trim() || "(none)",
    "",
    "--- NOTE START ---",
    ctx.note.text,
    "--- NOTE END ---",
  ].join("\n");
}

/** Lower-cases and collapses everything that is not a letter, mark or digit (any script) into single spaces. */
export function normalizeQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

function clampPriority(v: unknown): Priority {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 5 ? (v as Priority) : 0;
}

function toMatch(v: unknown, handledById: Map<string, HandledEntry>, openTaskIds: Set<string>): DraftMatch | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  const ref = typeof m.ref === "string" ? m.ref : typeof m.ref === "number" ? String(m.ref) : "";
  const reason = typeof m.reason === "string" ? m.reason : "";
  if (m.kind === "handled" && handledById.has(ref)) return { kind: "handled", ref, reason };
  if (m.kind === "existing" && openTaskIds.has(ref)) return { kind: "existing", ref, reason };
  return null;
}

export function toDrafts(raw: unknown, ctx: ExtractionContext): ExtractionResult {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { todos?: unknown }).todos)) {
    throw new ExtractionError("Claude's answer did not contain a todos list");
  }
  const r = raw as { todos: unknown[] };

  const projectIds = new Set(ctx.projects.map((p) => p.id));
  const labelIds = new Set(ctx.labels.map((l) => l.id));
  const openTaskIds = new Set(ctx.openTasks.map((t) => String(t.id)));
  const handledById = new Map(ctx.handled.map((h) => [h.id, h]));
  const handledByQuote = new Map<string, HandledEntry>();
  for (const h of ctx.handled) {
    const q = normalizeQuote(h.sourceQuote);
    if (q) handledByQuote.set(q, h);
  }

  const result: ExtractionResult = { tasks: [], maybe: [], existing: [], handled: [] };
  r.todos.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const t = item as Record<string, unknown>;
    const title = typeof t.title === "string" ? t.title.trim() : "";
    if (!title) return;

    const dueDate = typeof t.dueDate === "string" && isValidDate(t.dueDate) ? t.dueDate : null;
    const dueTime = dueDate && typeof t.dueTime === "string" && isValidTime(t.dueTime) ? t.dueTime : null;
    const projectId =
      typeof t.projectId === "number" && projectIds.has(t.projectId) ? t.projectId : ctx.fallbackProjectId;
    const labels = Array.isArray(t.labelIds)
      ? [...new Set(t.labelIds.filter((id): id is number => typeof id === "number" && labelIds.has(id)))]
      : [];
    const sourceQuote = typeof t.sourceQuote === "string" ? t.sourceQuote.trim() : "";
    const description = typeof t.description === "string" ? t.description.trim() : "";

    let match = toMatch(t.match, handledById, openTaskIds);
    const quoteHit = handledByQuote.get(normalizeQuote(sourceQuote));
    if (quoteHit && match?.kind !== "handled") {
      match = { kind: "handled", ref: quoteHit.id, reason: `Same sentence as a todo you already ${quoteHit.status}` };
    }

    const draft: Draft = {
      key: `d${index}`,
      title,
      dueDate,
      dueTime,
      priority: clampPriority(t.priority),
      projectId,
      labelIds: labels,
      description,
      sourceQuote,
      match,
      certainty: t.certainty === "sure" ? "sure" : "maybe",
    };
    if (match?.kind === "handled") result.handled.push(draft);
    else if (match?.kind === "existing") result.existing.push(draft);
    else if (draft.certainty === "sure") result.tasks.push(draft);
    else result.maybe.push(draft);
  });

  return result;
}
