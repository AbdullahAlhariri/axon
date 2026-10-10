import { Notice, displayTooltip, setIcon, setTooltip, type TooltipOptions } from "obsidian";
import { formatChipDate } from "./dates";
import { summarize, type Extraction } from "./extractTodos";
import { errorMessage, type SendOutcome } from "./sender";
import type { Draft, HandledEntry, NoteInput, Priority, VikunjaLabel, VikunjaProject, VikunjaTask } from "./types";

export interface PanelOptions {
  note: NoteInput;
  /** e.g. "Sonnet 5.5 · medium effort" */
  modelLabel: string;
  /** Today's date as YYYY-MM-DD, for "Today"/"Tomorrow" chips. */
  today: () => string;
  /** The running (or already finished) scan. */
  result: Promise<Extraction>;
  /** Aborted when the scan is cancelled. */
  signal: AbortSignal;
  cancel: () => void;
  /** Renders Markdown with Obsidian's renderer (used for description previews). */
  renderMarkdown: (markdown: string, el: HTMLElement) => Promise<void>;
  /** Creates the task in Vikunja and records it as sent. */
  send: (draft: Draft) => Promise<SendOutcome>;
  /** Records the draft as dismissed so it is not suggested again. */
  dismiss: (draft: Draft) => Promise<void>;
  taskUrl: (taskId: number) => string;
  openSettings: () => void;
  openNote: () => void;
  rescan: () => void;
}

type RowState = "idle" | "sending" | "sent" | "error";

interface Row {
  draft: Draft;
  selected: boolean;
  state: RowState;
  taskId: number | null;
  warning: string | null;
  card: HTMLElement | null;
  statusEl: HTMLElement | null;
  /** Description editor expanded (kept across re-renders). */
  descOpen: boolean;
}

/** A compact line in "Already in Vikunja" or the dismissed list. */
interface MiniRow {
  draft: Draft;
  title: string;
  url: string | null;
}

const PRIORITY_LABELS: Record<Priority, string> = {
  0: "Priority",
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Urgent",
  5: "Do now",
};

/** Must match the collapse transition in styles.css. */
const LEAVE_MS = 220;

const TIP: TooltipOptions = { placement: "bottom", delay: 0, gap: 6, classes: ["axon-tooltip"] };

function icon(parent: HTMLElement, name: string, cls = "axon-icon"): HTMLElement {
  const el = parent.createSpan({ cls });
  setIcon(el, name);
  return el;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export class ReviewPanel {
  private destroyed = false;
  private tasks: Row[] = [];
  private maybe: Row[] = [];
  private existing: MiniRow[] = [];
  private dismissed: MiniRow[] = [];
  private projects: VikunjaProject[] = [];
  private labels: VikunjaLabel[] = [];
  private openTasks: VikunjaTask[] = [];
  private sending = false;
  private rendered = false;
  private showDismissed = false;
  private countsEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private footerEl!: HTMLElement;
  private sendButton: HTMLButtonElement | null = null;
  private selectAllEl: HTMLButtonElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly opts: PanelOptions,
  ) {}

  mount(): void {
    this.root.empty();
    const head = this.root.createDiv({ cls: "axon-head" });
    const name = head.createEl("button", { cls: "axon-head-note", text: this.opts.note.basename });
    setTooltip(name, "Open note", { placement: "bottom" });
    name.onclick = () => this.opts.openNote();
    this.countsEl = head.createDiv({ cls: "axon-head-counts" });
    this.bodyEl = this.root.createDiv({ cls: "axon-body" });
    this.footerEl = this.root.createDiv({ cls: "axon-footer" });

    this.showLoading();
    this.opts.result.then(
      (result) => {
        if (!this.destroyed) this.showResult(result);
      },
      (err: unknown) => {
        if (this.destroyed) return;
        if (this.opts.signal.aborted) this.showCancelled();
        else this.showError(errorMessage(err));
      },
    );
  }

  destroy(): void {
    this.destroyed = true;
  }

  // ---- whole-panel states ------------------------------------------------------------------

  private showState(iconName: string, text: string, sub?: string, cls = ""): HTMLElement {
    this.bodyEl.empty();
    const state = this.bodyEl.createDiv({ cls: `axon-state ${cls}` });
    icon(state, iconName, "axon-state-icon");
    state.createDiv({ cls: "axon-state-text", text });
    if (sub) state.createDiv({ cls: "axon-state-sub", text: sub });
    return state;
  }

  private showLoading(): void {
    this.countsEl.setText("Reading…");
    this.showState("loader-circle", "Reading your note…", `${this.opts.modelLabel}. You can keep writing.`, "is-loading");
    this.footerEl.empty();
    this.footerEl.createDiv();
    this.button(this.footerEl, "Cancel", () => this.opts.cancel());
  }

  private showCancelled(): void {
    this.countsEl.setText("Cancelled");
    this.showState("circle-slash", "Cancelled");
    this.footerEl.empty();
    this.footerEl.createDiv();
    this.button(this.footerEl, "Scan again", () => this.opts.rescan(), true);
  }

  private showError(message: string): void {
    this.countsEl.setText("Something went wrong");
    this.showState("alert-circle", "Something went wrong", message, "is-error");
    this.footerEl.empty();
    this.button(this.footerEl, "Open settings", () => this.opts.openSettings());
    this.button(this.footerEl, "Try again", () => this.opts.rescan(), true);
  }

  private showResult(result: Extraction): void {
    const { projects, labels, openTasks, handled } = result.context;
    this.projects = projects;
    this.labels = labels;
    this.openTasks = openTasks;
    this.tasks = result.tasks.map((d) => this.toRow(d));
    this.maybe = result.maybe.map((d) => this.toRow(d));
    this.existing = result.existing.map((d) => {
      const ref = d.match?.ref ?? "";
      const task = openTasks.find((t) => String(t.id) === ref);
      return { draft: d, title: task?.title ?? d.title, url: ref ? this.opts.taskUrl(Number(ref)) : null };
    });
    this.dismissed = [];
    for (const d of result.handled) {
      const entry: HandledEntry | undefined = handled.find((h) => h.id === d.match?.ref);
      if (entry?.status === "sent" && entry.vikunjaTaskId !== null) {
        this.existing.push({ draft: d, title: entry.title, url: this.opts.taskUrl(entry.vikunjaTaskId) });
      } else {
        this.dismissed.push({ draft: d, title: entry?.title ?? d.title, url: null });
      }
    }

    this.countsEl.setText(summarize(result));
    this.renderBody();
    this.renderFooter();
  }

  // ---- body --------------------------------------------------------------------------------

  private renderBody(): void {
    this.bodyEl.empty();
    this.bodyEl.toggleClass("axon-no-enter", this.rendered);
    this.rendered = true;

    if (this.tasks.length + this.maybe.length === 0) {
      this.showState(
        "circle-check",
        "No new tasks in this note",
        this.existing.length + this.dismissed.length > 0 ? "Everything here is already handled." : "Nothing here needs a reminder.",
      );
    }
    if (this.tasks.length > 0) {
      const list = this.bodyEl.createDiv({ cls: "axon-list" });
      for (const row of this.tasks) this.renderCard(list, row);
    }
    if (this.maybe.length > 0) {
      const section = this.section(`Maybe · ${this.maybe.length}`, "axon-maybe");
      const list = section.createDiv({ cls: "axon-list" });
      for (const row of this.maybe) this.renderCard(list, row);
    }
    if (this.existing.length > 0) {
      const section = this.section(`Already in Vikunja · ${this.existing.length}`, "axon-existing");
      for (const mini of this.existing) this.renderExistingRow(section, mini);
    }
    if (this.dismissed.length > 0) this.renderDismissed();
  }

  private section(title: string, cls: string): HTMLElement {
    const section = this.bodyEl.createDiv({ cls: `axon-section ${cls}` });
    section.createDiv({ cls: "axon-section-title", text: title });
    return section;
  }

  private renderExistingRow(parent: HTMLElement, mini: MiniRow): void {
    const row = parent.createDiv({ cls: "axon-mini-row" });
    icon(row, "circle-check", "axon-mini-icon");
    row.createSpan({ cls: "axon-mini-title", text: mini.title });
    if (mini.draft.match?.kind === "existing") {
      const addAnyway = row.createEl("button", { cls: "axon-link axon-mini-action", text: "Add anyway" });
      addAnyway.onclick = () => this.promote(mini, this.existing);
    }
    if (mini.url) {
      const link = row.createEl("a", { cls: "axon-icon-button", href: mini.url });
      link.setAttr("target", "_blank");
      link.setAttr("rel", "noopener");
      setIcon(link, "arrow-up-right");
      setTooltip(link, "Open in Vikunja", { placement: "top" });
    }
  }

  private renderDismissed(): void {
    const wrap = this.bodyEl.createDiv({ cls: "axon-section axon-dismissed" });
    const toggle = wrap.createEl("button", {
      cls: "axon-link",
      text: `${this.dismissed.length} dismissed · ${this.showDismissed ? "Hide" : "Show"}`,
    });
    toggle.onclick = () => {
      this.showDismissed = !this.showDismissed;
      this.renderBody();
    };
    if (!this.showDismissed) return;
    for (const mini of this.dismissed) {
      const row = wrap.createDiv({ cls: "axon-mini-row" });
      icon(row, "eye-off", "axon-mini-icon");
      row.createSpan({ cls: "axon-mini-title", text: mini.title });
      const restore = row.createEl("button", { cls: "axon-link axon-mini-action", text: "Restore" });
      restore.onclick = () => this.promote(mini, this.dismissed);
    }
  }

  /** Moves an already-in-Vikunja or dismissed draft back into the task list, selected. */
  private promote(mini: MiniRow, from: MiniRow[]): void {
    from.splice(from.indexOf(mini), 1);
    const row = this.toRow({ ...mini.draft, certainty: "sure" });
    row.selected = true;
    this.tasks.push(row);
    this.renderBody();
    row.card?.addClass("is-new");
    row.card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    this.updateFooter();
  }

  // ---- footer ------------------------------------------------------------------------------

  private renderFooter(): void {
    this.footerEl.empty();
    this.selectAllEl = this.footerEl.createEl("button", { cls: "axon-link" });
    this.selectAllEl.onclick = () => this.toggleAllTasks();
    this.sendButton = this.button(this.footerEl, "", () => void this.sendSelected(), true);
    this.updateFooter();
  }

  private updateFooter(): void {
    if (!this.sendButton || !this.selectAllEl) return;
    const selected = this.selected().length;
    const open = this.tasks.filter((r) => r.state !== "sent");
    this.selectAllEl.toggleClass("axon-invisible", open.length === 0 || this.sending);
    this.selectAllEl.setText(open.length > 0 && open.every((r) => r.selected) ? "Clear selection" : "Select all tasks");
    this.sendButton.setText(this.sending ? "Adding…" : selected === 0 ? "Add to Vikunja" : `Add ${selected} to Vikunja`);
    this.sendButton.disabled = this.sending || selected === 0;
  }

  private selected(): Row[] {
    return [...this.tasks, ...this.maybe].filter((r) => r.selected && r.state !== "sent");
  }

  private toggleAllTasks(): void {
    const open = this.tasks.filter((r) => r.state !== "sent");
    const select = !open.every((r) => r.selected);
    for (const row of open) this.setSelected(row, select);
  }

  // ---- cards -------------------------------------------------------------------------------

  private toRow(draft: Draft): Row {
    return {
      draft: { ...draft, labelIds: [...draft.labelIds] },
      selected: false,
      state: "idle",
      taskId: null,
      warning: null,
      card: null,
      statusEl: null,
      descOpen: false,
    };
  }

  private renderCard(parent: HTMLElement, row: Row): void {
    const card = parent.createDiv({ cls: "axon-card" });
    row.card = card;
    const inner = card.createDiv({ cls: "axon-card-inner" });
    if (row.state === "sent") {
      card.addClass("is-done");
      this.fillDone(inner, row);
      return;
    }
    card.tabIndex = 0;
    card.setAttr("role", "checkbox");
    card.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, button, a, .axon-chip, .axon-desc-preview")) return;
      this.toggle(row);
    });
    card.addEventListener("keydown", (e) => {
      if (e.target === card && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        this.toggle(row);
      }
    });
    this.fillEditable(inner, row);
    this.refreshSelection(row);
  }

  private fillEditable(inner: HTMLElement, row: Row): void {
    const d = row.draft;

    const top = inner.createDiv({ cls: "axon-card-top" });
    const check = icon(top, "check", "axon-check");
    check.setAttr("aria-hidden", "true");

    // A one-row textarea so long titles wrap in the narrow sidebar instead of being cut off.
    const title = top.createEl("textarea", { cls: "axon-title" });
    title.rows = 1;
    title.value = d.title;
    title.setAttr("aria-label", "Task title");
    title.oninput = () => {
      d.title = title.value.replace(/\n/g, " ");
    };
    title.onkeydown = (e) => {
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.isComposing) {
        e.preventDefault();
        title.blur();
      }
    };

    const actions = top.createDiv({ cls: "axon-actions" });
    if (d.sourceQuote) {
      const info = actions.createEl("button", { cls: "axon-icon-button" });
      setIcon(info, "info");
      const text = `From your note: “${d.sourceQuote}”`;
      setTooltip(info, text, TIP);
      info.onclick = () => displayTooltip(info, text, TIP);
    }
    const dismiss = actions.createEl("button", { cls: "axon-icon-button" });
    setIcon(dismiss, "x");
    setTooltip(dismiss, "Dismiss, don't suggest again", { placement: "bottom" });
    dismiss.onclick = () => void this.dismissRow(row);

    const meta = inner.createDiv({ cls: "axon-meta" });
    this.dateChips(meta, d);
    this.selectChip(meta, {
      icon: "folder",
      tooltip: "Project",
      options: this.projects.map((p) => [String(p.id), p.title]),
      value: String(d.projectId),
      display: (v) => this.projects.find((p) => String(p.id) === v)?.title ?? null,
      onChange: (v) => {
        d.projectId = Number(v);
      },
    });
    this.selectChip(meta, {
      icon: "flag",
      tooltip: "Priority",
      options: ([0, 1, 2, 3, 4, 5] as Priority[]).map((p) => [String(p), PRIORITY_LABELS[p]]),
      value: String(d.priority),
      display: (v) => (v === "0" ? null : PRIORITY_LABELS[Number(v) as Priority]),
      onChange: (v) => {
        d.priority = Number(v) as Priority;
      },
    });
    this.labelChips(meta, d);
    this.descriptionChip(meta, inner, row);

    if (d.match?.kind === "existing") {
      const ref = d.match.ref;
      const task = this.openTasks.find((t) => String(t.id) === ref);
      const hint = inner.createDiv({ cls: "axon-hint is-warning" });
      icon(hint, "alert-triangle");
      hint.createSpan({ text: `Already in Vikunja as “${task?.title ?? `#${ref}`}”` });
    }

    row.statusEl = inner.createDiv({ cls: "axon-status" });
  }

  private fillDone(inner: HTMLElement, row: Row): void {
    const top = inner.createDiv({ cls: "axon-card-top" });
    icon(top, "circle-check", "axon-done-icon");
    top.createSpan({ cls: "axon-done-title", text: row.draft.title });
    if (row.taskId !== null) {
      const link = top.createEl("a", { cls: "axon-icon-button", href: this.opts.taskUrl(row.taskId) });
      link.setAttr("target", "_blank");
      link.setAttr("rel", "noopener");
      setIcon(link, "arrow-up-right");
      setTooltip(link, "Open in Vikunja", { placement: "top" });
    }
    if (row.warning) {
      const hint = inner.createDiv({ cls: "axon-hint is-warning" });
      icon(hint, "alert-triangle");
      hint.createSpan({ text: row.warning });
    }
  }

  /**
   * Description behind a ≡ chip (tinted when there is one). Shown as rendered Markdown; click it to edit
   * the raw text, click away to render it again.
   */
  private descriptionChip(meta: HTMLElement, inner: HTMLElement, row: Row): void {
    const d = row.draft;
    const chip = meta.createEl("button", { cls: "axon-chip is-icon-only axon-desc-chip" });
    setIcon(chip, "align-left");
    setTooltip(chip, "Description", { placement: "top" });

    const wrap = inner.createDiv({ cls: "axon-desc-wrap" });
    const box = wrap.createDiv({ cls: "axon-desc-inner" });
    const preview = box.createDiv({ cls: "axon-desc-preview markdown-rendered" });
    setTooltip(preview, "Click to edit", { placement: "top", delay: 600 });
    const textarea = box.createEl("textarea", { cls: "axon-desc", placeholder: "Add a description (Markdown works)" });
    textarea.rows = 1;
    textarea.value = d.description;
    textarea.setAttr("aria-label", "Description");

    const hasText = (): boolean => d.description.trim().length > 0;
    const showEditor = (editing: boolean): void => {
      const edit = editing || !hasText();
      preview.toggleClass("axon-hidden", edit);
      textarea.toggleClass("axon-hidden", !edit);
    };
    const renderPreview = async (): Promise<void> => {
      preview.empty();
      if (hasText()) await this.opts.renderMarkdown(d.description, preview);
    };

    textarea.oninput = () => {
      d.description = textarea.value;
      chip.toggleClass("has-value", hasText());
    };
    textarea.onblur = () => {
      if (!hasText()) return;
      void renderPreview().then(() => showEditor(false));
    };
    preview.onclick = (e) => {
      if ((e.target as HTMLElement).closest("a")) return;
      showEditor(true);
      textarea.focus();
    };

    const setOpen = (open: boolean): void => {
      row.descOpen = open;
      wrap.toggleClass("is-open", open);
      chip.toggleClass("is-active", open);
    };
    chip.onclick = () => {
      setOpen(!row.descOpen);
      if (row.descOpen && !hasText()) window.setTimeout(() => textarea.focus(), 120);
    };

    chip.toggleClass("has-value", hasText());
    showEditor(false);
    void renderPreview();
    setOpen(row.descOpen);
  }

  private dateChips(meta: HTMLElement, d: Draft): void {
    const today = this.opts.today();
    const dateChip = meta.createEl("button", { cls: "axon-chip" });
    setTooltip(dateChip, "Due date", { placement: "top" });
    icon(dateChip, "calendar");
    const dateText = dateChip.createSpan();
    const dateInput = dateChip.createEl("input", { type: "date", cls: "axon-picker" });
    const clearDate = icon(dateChip, "x", "axon-chip-clear");

    const timeChip = meta.createEl("button", { cls: "axon-chip" });
    setTooltip(timeChip, "Time", { placement: "top" });
    icon(timeChip, "clock");
    const timeText = timeChip.createSpan();
    const timeInput = timeChip.createEl("input", { type: "time", cls: "axon-picker" });
    const clearTime = icon(timeChip, "x", "axon-chip-clear");

    const render = (): void => {
      dateText.setText(d.dueDate ? formatChipDate(d.dueDate, today) : "No date");
      dateChip.toggleClass("is-empty", !d.dueDate);
      dateInput.value = d.dueDate ?? "";
      timeChip.toggleClass("axon-hidden", !d.dueDate);
      timeText.setText(d.dueTime ?? "");
      timeChip.toggleClass("is-empty", !d.dueTime);
      timeChip.toggleClass("is-icon-only", !d.dueTime);
      timeInput.value = d.dueTime ?? "";
    };
    const openPicker = (input: HTMLInputElement): void => {
      try {
        input.showPicker();
      } catch {
        input.focus();
      }
    };

    dateChip.onclick = (e) => {
      e.preventDefault();
      openPicker(dateInput);
    };
    timeChip.onclick = (e) => {
      e.preventDefault();
      openPicker(timeInput);
    };
    clearDate.onclick = (e) => {
      e.stopPropagation();
      d.dueDate = null;
      d.dueTime = null;
      render();
    };
    clearTime.onclick = (e) => {
      e.stopPropagation();
      d.dueTime = null;
      render();
    };
    dateInput.onchange = () => {
      d.dueDate = dateInput.value || null;
      if (!d.dueDate) d.dueTime = null;
      render();
    };
    timeInput.onchange = () => {
      d.dueTime = timeInput.value || null;
      render();
    };
    render();
  }

  /**
   * A chip showing an icon and the current value; a transparent native <select> covers it, so a click
   * opens the real dropdown. When display() returns null the chip shrinks to its icon.
   */
  private selectChip(
    meta: HTMLElement,
    o: {
      icon: string;
      tooltip: string;
      options: [string, string][];
      value: string;
      display: (value: string) => string | null;
      onChange: (value: string) => void;
    },
  ): HTMLElement {
    const chip = meta.createDiv({ cls: "axon-chip" });
    setTooltip(chip, o.tooltip, { placement: "top" });
    icon(chip, o.icon);
    const text = chip.createSpan();
    const select = chip.createEl("select", { cls: "axon-chip-select" });
    select.setAttr("aria-label", o.tooltip);
    for (const [v, t] of o.options) select.createEl("option", { value: v, text: t });
    const render = (value: string): void => {
      const shown = o.display(value);
      text.setText(shown ?? "");
      chip.toggleClass("is-empty", shown === null);
      chip.toggleClass("is-icon-only", shown === null);
    };
    select.value = o.value;
    select.onchange = () => {
      o.onChange(select.value);
      render(select.value);
    };
    render(o.value);
    return chip;
  }

  private labelChips(meta: HTMLElement, d: Draft): void {
    const wrap = meta.createDiv({ cls: "axon-chip-group" });
    const render = (): void => {
      wrap.empty();
      for (const id of d.labelIds) {
        const label = this.labels.find((l) => l.id === id);
        if (!label) continue;
        const chip = wrap.createSpan({ cls: "axon-chip is-static" });
        icon(chip, "tag");
        chip.createSpan({ text: label.title });
        const remove = icon(chip, "x", "axon-chip-clear");
        setTooltip(remove, "Remove label", { placement: "top" });
        remove.onclick = () => {
          d.labelIds = d.labelIds.filter((x) => x !== id);
          render();
        };
      }
      const available = this.labels.filter((l) => !d.labelIds.includes(l.id));
      if (available.length > 0) {
        this.selectChip(wrap, {
          icon: d.labelIds.length > 0 ? "plus" : "tag",
          tooltip: "Add label",
          options: [["", "Add label"], ...available.map((l): [string, string] => [String(l.id), l.title])],
          value: "",
          display: () => null,
          onChange: (v) => {
            if (!v) return;
            d.labelIds = [...d.labelIds, Number(v)];
            render();
          },
        });
      }
    };
    render();
  }

  private toggle(row: Row): void {
    if (this.sending || row.state === "sent") return;
    this.setSelected(row, !row.selected);
  }

  private setSelected(row: Row, selected: boolean): void {
    row.selected = selected;
    this.refreshSelection(row);
    this.updateFooter();
  }

  private refreshSelection(row: Row): void {
    row.card?.toggleClass("is-selected", row.selected);
    row.card?.setAttr("aria-checked", String(row.selected));
  }

  private setStatus(row: Row, state: RowState, message = ""): void {
    row.state = state;
    row.card?.toggleClass("is-sending", state === "sending");
    row.card?.toggleClass("is-error", state === "error");
    const el = row.statusEl;
    if (!el) return;
    el.empty();
    if (state === "sending") {
      icon(el, "loader-circle", "axon-icon axon-spin");
      el.createSpan({ text: "Adding…" });
    } else if (state === "error") {
      icon(el, "alert-circle");
      el.createSpan({ text: message });
    }
  }

  // ---- actions -----------------------------------------------------------------------------

  async sendSelected(): Promise<void> {
    const rows = this.selected();
    if (rows.length === 0 || this.sending) return;
    this.sending = true;
    this.root.addClass("is-busy");
    this.updateFooter();

    let added = 0;
    for (const row of rows) {
      if (!row.draft.title.trim()) {
        this.setStatus(row, "error", "Add a title first.");
        continue;
      }
      this.setStatus(row, "sending");
      let out: SendOutcome;
      try {
        out = await this.opts.send(row.draft);
      } catch (e) {
        out = { ok: false, taskId: null, error: errorMessage(e), warning: null };
      }
      if (out.ok && out.taskId !== null) {
        added++;
        row.selected = false;
        row.state = "sent";
        row.taskId = out.taskId;
        row.warning = out.warning;
        this.swapToDone(row);
      } else {
        this.setStatus(row, "error", out.error ?? "Unknown error");
      }
    }

    this.sending = false;
    this.root.removeClass("is-busy");
    this.updateFooter();
    if (added > 0) new Notice(`Added ${plural(added, "task")} to Vikunja`);
  }

  private swapToDone(row: Row): void {
    const card = row.card;
    if (!card) return;
    card.removeClass("is-selected", "is-sending", "is-error");
    card.removeAttribute("role");
    card.removeAttribute("aria-checked");
    card.tabIndex = -1;
    card.addClass("is-done");
    const inner = card.querySelector<HTMLElement>(".axon-card-inner");
    if (!inner) return;
    inner.empty();
    this.fillDone(inner, row);
  }

  private async dismissRow(row: Row): Promise<void> {
    if (this.sending) return;
    try {
      await this.opts.dismiss(row.draft);
    } catch (e) {
      new Notice(`Could not dismiss: ${errorMessage(e)}`);
      return;
    }
    this.tasks = this.tasks.filter((r) => r !== row);
    this.maybe = this.maybe.filter((r) => r !== row);
    this.dismissed.push({ draft: row.draft, title: row.draft.title, url: null });
    this.updateFooter();
    const card = row.card;
    if (!card) return;
    card.addClass("is-leaving");
    window.setTimeout(() => this.renderBody(), LEAVE_MS);
  }

  private button(parent: HTMLElement, text: string, onClick: () => void, cta = false): HTMLButtonElement {
    const button = parent.createEl("button", { text, cls: cta ? "mod-cta" : "" });
    button.onclick = onClick;
    return button;
  }
}
