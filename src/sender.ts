import { Marked } from "marked";
import { toLocalRfc3339 } from "./dates";
import type { Draft, NoteInput } from "./types";
import type { NewTask, VikunjaClient } from "./vikunjaClient";

export interface SendOutcome {
  ok: boolean;
  taskId: number | null;
  error: string | null;
  /** Set when the task was created but its labels or Obsidian-link comment could not be added. */
  warning: string | null;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function obsidianUri(vaultName: string, notePath: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(notePath)}`;
}

const SAFE_LINK = /^(https?:|mailto:|obsidian:)/i;

/** Markdown → HTML for Vikunja. Raw HTML is shown as text and only safe link protocols are kept. */
const markdown = new Marked({
  gfm: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      return SAFE_LINK.test(href) ? `<a href="${escapeHtml(href)}">${text}</a>` : text;
    },
  },
});

/** Vikunja task descriptions are HTML; the description stays clean — the note link goes into a comment. */
export function buildDescriptionHtml(draft: Pick<Draft, "description">): string {
  const description = draft.description.trim();
  return description ? markdown.parse(description, { async: false }).trim() : "";
}

export function buildCommentHtml(note: NoteInput): string {
  const href = escapeHtml(obsidianUri(note.vaultName, note.path));
  return `<p><a href="${href}">Open “${escapeHtml(note.basename)}” in Obsidian</a></p>`;
}

export function buildNewTask(draft: Draft, defaultTime: string): NewTask {
  return {
    title: draft.title.trim(),
    description: buildDescriptionHtml(draft),
    dueDate: draft.dueDate ? toLocalRfc3339(draft.dueDate, draft.dueTime ?? defaultTime) : null,
    priority: draft.priority,
  };
}

export async function sendDraft(
  client: Pick<VikunjaClient, "createTask" | "setLabels" | "addComment">,
  draft: Draft,
  note: NoteInput,
  defaultTime: string,
): Promise<SendOutcome> {
  let taskId: number;
  try {
    taskId = (await client.createTask(draft.projectId, buildNewTask(draft, defaultTime))).id;
  } catch (e) {
    return { ok: false, taskId: null, error: errorMessage(e), warning: null };
  }
  const warnings: string[] = [];
  if (draft.labelIds.length > 0) {
    try {
      await client.setLabels(taskId, draft.labelIds);
    } catch (e) {
      warnings.push(`Labels not added (${errorMessage(e)}).`);
    }
  }
  try {
    await client.addComment(taskId, buildCommentHtml(note));
  } catch (e) {
    warnings.push(`Obsidian link not added (${errorMessage(e)}).`);
  }
  return { ok: true, taskId, error: null, warning: warnings.length ? warnings.join(" ") : null };
}
