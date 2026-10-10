import { ItemView, Scope, setIcon, type WorkspaceLeaf } from "obsidian";
import { bottomInset } from "./layout";
import { ReviewPanel, type PanelOptions } from "./reviewPanel";

export const VIEW_TYPE_TASKS = "axon-tasks";

/** Right-sidebar view: shows the drafts for the last scanned note while you keep writing. */
export class TasksView extends ItemView {
  private panel: ReviewPanel | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly scanActiveNote: () => void,
  ) {
    super(leaf);
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod"], "Enter", () => {
      void this.panel?.sendSelected();
      return false;
    });
  }

  getViewType(): string {
    return VIEW_TYPE_TASKS;
  }

  getDisplayText(): string {
    return "Axon";
  }

  getIcon(): string {
    return "list-checks";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("axon-view");
    this.addAction("refresh-cw", "Scan current note", () => this.scanActiveNote());
    if (!this.panel) this.showIdle();
    // Obsidian's status bar floats over the bottom of the right sidebar: keep the footer clear of it.
    this.registerEvent(this.app.workspace.on("resize", () => this.updateInset()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.updateInset()));
    this.registerEvent(this.app.workspace.on("css-change", () => this.updateInset()));
    window.requestAnimationFrame(() => this.updateInset());
  }

  async onClose(): Promise<void> {
    this.panel?.destroy();
    this.panel = null;
  }

  /** Shows a scan (running or finished); replaces whatever was shown before. */
  show(options: PanelOptions): void {
    this.panel?.destroy();
    this.panel = new ReviewPanel(this.contentEl, options);
    this.panel.mount();
    window.requestAnimationFrame(() => this.updateInset());
  }

  private updateInset(): void {
    const statusBar = document.body.querySelector<HTMLElement>(".status-bar");
    const inset = bottomInset(
      this.contentEl.getBoundingClientRect(),
      statusBar?.isShown() ? statusBar.getBoundingClientRect() : null,
    );
    this.contentEl.style.setProperty("--axon-bottom-inset", `${inset}px`);
  }

  isVisible(): boolean {
    return this.contentEl.isShown();
  }

  private showIdle(): void {
    this.contentEl.empty();
    const state = this.contentEl.createDiv({ cls: "axon-state axon-idle" });
    const iconEl = state.createSpan({ cls: "axon-state-icon" });
    setIcon(iconEl, "list-checks");
    state.createDiv({ cls: "axon-state-text", text: "Turn a note into reminders" });
    state.createDiv({ cls: "axon-state-sub", text: "Open a note and scan it. Only the tasks you select are added to Vikunja." });
    const button = state.createEl("button", { cls: "mod-cta", text: "Scan current note" });
    button.onclick = () => this.scanActiveNote();
  }
}
