import { describe, expect, it, vi } from "vitest";
import { buildCommentHtml, buildDescriptionHtml, buildNewTask, escapeHtml, obsidianUri, sendDraft } from "../src/sender";
import type { Draft, NoteInput } from "../src/types";

const note: NoteInput = {
  path: "Notes/Daily (2026-10-09).md",
  basename: "Daily (2026-10-09)",
  text: "",
  vaultName: "main",
};

const draft = (over: Partial<Draft> = {}): Draft => ({
  key: "d0",
  title: "Email Sara",
  dueDate: "2026-10-11",
  dueTime: null,
  priority: 2,
  projectId: 7,
  labelIds: [],
  description: "Ask about the demo.",
  sourceQuote: "send email to sara about the invoice",
  match: null,
  certainty: "sure",
  ...over,
});

describe("escapeHtml", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
  });
});

describe("obsidianUri", () => {
  it("encodes vault and path", () => {
    expect(obsidianUri("my vault", note.path)).toBe(
      "obsidian://open?vault=my%20vault&file=Notes%2FDaily%20(2026-10-09).md",
    );
  });
});

describe("buildDescriptionHtml", () => {
  it("contains only the description", () => {
    expect(buildDescriptionHtml(draft())).toBe("<p>Ask about the demo.</p>");
  });

  it("is empty when there is no description", () => {
    expect(buildDescriptionHtml(draft({ description: "  " }))).toBe("");
  });

  it("renders Markdown to HTML", () => {
    expect(buildDescriptionHtml(draft({ description: "**Bring** the papers:\n\n- passport\n- [form](https://example.com/f)" }))).toBe(
      '<p><strong>Bring</strong> the papers:</p>\n<ul>\n<li>passport</li>\n<li><a href="https://example.com/f">form</a></li>\n</ul>',
    );
  });

  it("escapes raw HTML instead of passing it through", () => {
    const html = buildDescriptionHtml(draft({ description: `<script>x</script> & "اقرأ" and <b>bold</b>` }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("اقرأ");
  });

  it("drops links with unsafe protocols", () => {
    const html = buildDescriptionHtml(draft({ description: "[click](javascript:alert(1)) and [ok](https://vikunja.example.com)" }));
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click");
    expect(html).toContain('<a href="https://vikunja.example.com">ok</a>');
  });
});

describe("buildCommentHtml", () => {
  it("links back to the note in Obsidian", () => {
    expect(buildCommentHtml(note)).toBe(
      '<p><a href="obsidian://open?vault=main&amp;file=Notes%2FDaily%20(2026-10-09).md">' +
        "Open “Daily (2026-10-09)” in Obsidian</a></p>",
    );
  });

  it("escapes the note name", () => {
    expect(buildCommentHtml({ ...note, basename: "<b>&" })).toContain("Open “&lt;b&gt;&amp;” in Obsidian");
  });
});

describe("buildNewTask", () => {
  it("uses the default time for date-only todos", () => {
    expect(buildNewTask(draft(), "23:59").dueDate).toBe("2026-10-11T23:59:00+02:00");
  });

  it("uses the todo's own time when present", () => {
    expect(buildNewTask(draft({ dueTime: "15:00" }), "23:59").dueDate).toBe("2026-10-11T15:00:00+02:00");
  });

  it("leaves the due date empty when the todo has none", () => {
    expect(buildNewTask(draft({ dueDate: null }), "23:59")).toEqual({
      title: "Email Sara",
      description: "<p>Ask about the demo.</p>",
      dueDate: null,
      priority: 2,
    });
  });
});

describe("sendDraft", () => {
  const client = () => ({
    createTask: vi.fn(async () => ({ id: 42 })),
    setLabels: vi.fn(async () => {}),
    addComment: vi.fn(async () => {}),
  });

  it("creates the task, sets labels and adds the Obsidian link as a comment", async () => {
    const c = client();
    const out = await sendDraft(c, draft({ labelIds: [10, 11] }), note, "23:59");
    expect(out).toEqual({ ok: true, taskId: 42, error: null, warning: null });
    expect(c.createTask).toHaveBeenCalledWith(7, expect.objectContaining({ title: "Email Sara" }));
    expect(c.setLabels).toHaveBeenCalledWith(42, [10, 11]);
    expect(c.addComment).toHaveBeenCalledWith(42, buildCommentHtml(note));
  });

  it("skips the label call when there are no labels", async () => {
    const c = client();
    await sendDraft(c, draft(), note, "23:59");
    expect(c.setLabels).not.toHaveBeenCalled();
    expect(c.addComment).toHaveBeenCalledTimes(1);
  });

  it("reports a failed create without touching labels or comments", async () => {
    const c = client();
    c.createTask.mockRejectedValueOnce(new Error("HTTP 500"));
    const out = await sendDraft(c, draft({ labelIds: [10] }), note, "23:59");
    expect(out).toEqual({ ok: false, taskId: null, error: "HTTP 500", warning: null });
    expect(c.setLabels).not.toHaveBeenCalled();
    expect(c.addComment).not.toHaveBeenCalled();
  });

  it("counts the task as created when only labels or the comment fail", async () => {
    const c = client();
    c.setLabels.mockRejectedValueOnce(new Error("label gone"));
    c.addComment.mockRejectedValueOnce(new Error("HTTP 403"));
    const out = await sendDraft(c, draft({ labelIds: [10] }), note, "23:59");
    expect(out).toEqual({
      ok: true,
      taskId: 42,
      error: null,
      warning: "Labels not added (label gone). Obsidian link not added (HTTP 403).",
    });
  });
});
