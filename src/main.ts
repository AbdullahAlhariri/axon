import { MarkdownRenderer, Notice, Plugin, TFile, requestUrl, type WorkspaceLeaf } from "obsidian";
import { nodeProbe, resolveClaudeBinary } from "./claudeBinary";
import { localDateString } from "./dates";
import { runClaude } from "./claudeRunner";
import { extractTodos, summarize, type Extraction } from "./extractTodos";
import { HandledStore } from "./handledStore";
import { errorMessage, sendDraft } from "./sender";
import { loadPersisted } from "./settings";
import { AxonSettingTab } from "./settingsTab";
import { ScanStatus } from "./statusBar";
import type { PanelOptions } from "./reviewPanel";
import { TasksView, VIEW_TYPE_TASKS } from "./tasksView";
import type { NoteInput, PersistedData } from "./types";
import { VikunjaClient, type HttpFn } from "./vikunjaClient";

/** Obsidian's requestUrl bypasses CORS, which a self-hosted Vikunja usually doesn't allow for app://obsidian.md. */
const obsidianHttp: HttpFn = async (req) => {
  const res = await requestUrl({ url: req.url, method: req.method, headers: req.headers, body: req.body, throw: false });
  let json: unknown = null;
  try {
    json = res.json;
  } catch {
    json = null;
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = v;
  return { status: res.status, headers, json };
};

/** "claude-sonnet-5-5" + "medium" -> "Sonnet 5.5 · medium effort" */
function modelLabel(model: string, effort: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/i.exec(model);
  const name = m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : model;
  return `${name} · ${effort} effort`;
}

export default class AxonPlugin extends Plugin {
  persisted!: PersistedData;
  private handled!: HandledStore;
  private claudeBinary: string | null = null;
  private scanStatus!: ScanStatus;
  private currentScan: AbortController | null = null;

  async onload(): Promise<void> {
    this.persisted = loadPersisted(await this.loadData());
    this.handled = new HandledStore(this.persisted.handled, async (map) => {
      this.persisted.handled = map;
      await this.saveData(this.persisted);
    });

    this.scanStatus = new ScanStatus(this.addStatusBarItem());
    this.addSettingTab(new AxonSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_TASKS, (leaf) => new TasksView(leaf, () => void this.scanActiveNote()));

    this.addCommand({
      id: "extract-todos",
      name: "Extract tasks from current note",
      checkCallback: (checking) => {
        const file = this.activeMarkdownFile();
        if (!file) return false;
        if (!checking) void this.scan(file);
        return true;
      },
    });
    this.addCommand({
      id: "open-tasks-panel",
      name: "Open tasks panel",
      callback: () => void this.activateView(),
    });

    this.addRibbonIcon("list-checks", "Scan note with Axon", () => void this.scanActiveNote());

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        void this.handled.rename(oldPath, file.path);
      }),
    );
  }

  /** Called by Obsidian when data.json changed on disk, e.g. synced from another machine. */
  async onExternalSettingsChange(): Promise<void> {
    this.persisted = loadPersisted(await this.loadData());
    this.handled.replace(this.persisted.handled);
    this.resetClaudeBinary();
  }

  async saveAll(): Promise<void> {
    await this.saveData(this.persisted);
  }

  vikunja(): VikunjaClient {
    const s = this.persisted.settings;
    if (!s.vikunjaUrl || !s.vikunjaToken) {
      throw new Error("Set your Vikunja URL and API token in the plugin settings first.");
    }
    return new VikunjaClient(s.vikunjaUrl, s.vikunjaToken, obsidianHttp);
  }

  getClaudeBinary(): string {
    if (!this.claudeBinary) this.claudeBinary = resolveClaudeBinary(this.persisted.settings.claudePath, nodeProbe());
    return this.claudeBinary;
  }

  resetClaudeBinary(): void {
    this.claudeBinary = null;
  }

  openSettings(): void {
    // Not in the public API typings, but used widely by plugins to deep-link their settings tab.
    const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  private activeMarkdownFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file && file.extension === "md" ? file : null;
  }

  async scanActiveNote(): Promise<void> {
    const file = this.activeMarkdownFile();
    if (!file) {
      new Notice("Open a note first.");
      return;
    }
    await this.scan(file);
  }

  /** Opens the sidebar panel (without stealing focus from the editor) and returns its view. */
  async activateView(): Promise<TasksView | null> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_TASKS)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: VIEW_TYPE_TASKS, active: false });
    }
    await workspace.revealLeaf(leaf);
    return leaf.view instanceof TasksView ? leaf.view : null;
  }

  private async scan(file: TFile): Promise<void> {
    const s = this.persisted.settings;
    let client: VikunjaClient;
    let binary: string;
    try {
      client = this.vikunja();
      binary = this.getClaudeBinary();
    } catch (e) {
      new Notice(errorMessage(e), 10000);
      return;
    }

    const note: NoteInput = {
      path: file.path,
      basename: file.basename,
      text: await this.app.vault.cachedRead(file),
      vaultName: this.app.vault.getName(),
    };

    // A new scan replaces the previous one.
    this.currentScan?.abort();
    const abort = new AbortController();
    this.currentScan = abort;

    const result = extractTodos(
      note,
      s,
      {
        vikunja: client,
        handled: this.handled,
        runClaude: (args) =>
          runClaude({ ...args, binary, model: s.model, effort: s.effort, timeoutMs: s.timeoutSeconds * 1000 }),
        now: () => new Date(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      abort.signal,
    );
    result.catch(() => undefined); // failures are shown by the panel / status bar below

    const options: PanelOptions = {
      note,
      modelLabel: modelLabel(s.model, s.effort),
      today: () => localDateString(new Date()),
      result,
      signal: abort.signal,
      cancel: () => abort.abort(),
      renderMarkdown: (markdown, el) => MarkdownRenderer.render(this.app, markdown, el, note.path, this),
      send: async (draft) => {
        const out = await sendDraft(client, draft, note, s.defaultTime);
        if (out.ok && out.taskId !== null) {
          try {
            await this.handled.markSent(note.path, {
              title: draft.title,
              sourceQuote: draft.sourceQuote,
              vikunjaTaskId: out.taskId,
            });
          } catch (e) {
            console.error("axon: could not record sent todo", e);
          }
        }
        return out;
      },
      dismiss: async (draft) => {
        await this.handled.markDismissed(note.path, { title: draft.title, sourceQuote: draft.sourceQuote });
      },
      taskUrl: (id) => client.taskUrl(id),
      openSettings: () => this.openSettings(),
      openNote: () => void this.app.workspace.getLeaf(false).openFile(file),
      rescan: () => void this.scan(file),
    };

    // While Claude reads the note: a spinner in the status bar. The panel only opens once it is done,
    // unless it is already visible (then it shows its own loading state right away).
    this.scanStatus.start(`Reading “${note.basename}”…`, () => abort.abort());
    const visible = this.visibleView();
    visible?.show(options);

    let extraction: Extraction | null = null;
    try {
      extraction = await result;
    } catch {
      // shown below
    }
    if (this.currentScan !== abort) return; // replaced by a newer scan, which owns the status bar now
    this.currentScan = null;
    if (abort.signal.aborted) {
      this.scanStatus.clear();
      return;
    }
    this.scanStatus.finish(extraction ? summarize(extraction) : "Could not read the note", extraction !== null);
    if (!visible) (await this.activateView())?.show(options);
  }

  private visibleView(): TasksView | null {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKS)[0]?.view;
    return view instanceof TasksView && view.isVisible() ? view : null;
  }
}
