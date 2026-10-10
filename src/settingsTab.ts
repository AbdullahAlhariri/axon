import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { claudeVersion } from "./claudeRunner";
import { isValidTime } from "./dates";
import type AxonPlugin from "./main";
import { errorMessage } from "./sender";
import { DEFAULT_SETTINGS } from "./settings";
import type { Effort } from "./types";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export class AxonSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: AxonPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.persisted.settings;
    const save = () => this.plugin.saveAll();

    new Setting(containerEl)
      .setName("Vikunja URL")
      .setDesc("Base URL of your Vikunja, e.g. https://vikunja.example.com")
      .addText((t) =>
        t
          .setPlaceholder("https://vikunja.example.com")
          .setValue(s.vikunjaUrl)
          .onChange(async (v) => {
            s.vikunjaUrl = v.trim();
            await save();
          }),
      );

    new Setting(containerEl)
      .setName("Vikunja API token")
      .setDesc("Vikunja → Settings → API Tokens. Needs: projects (read all), labels (read all), tasks (read all, create), task labels (bulk), task comments (create).")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(s.vikunjaToken).onChange(async (v) => {
          s.vikunjaToken = v.trim();
          await save();
        });
      });

    const fallback = new Setting(containerEl)
      .setName("Fallback project")
      .setDesc("Used when Claude's suggestion doesn't fit. Click “Load projects” to fill the list.");
    fallback.addDropdown((dd) => {
      dd.addOption("", "(first project)");
      if (s.fallbackProjectId !== null) dd.addOption(String(s.fallbackProjectId), `Project #${s.fallbackProjectId}`);
      dd.setValue(s.fallbackProjectId === null ? "" : String(s.fallbackProjectId));
      dd.onChange(async (v) => {
        s.fallbackProjectId = v ? Number(v) : null;
        await save();
      });
      fallback.addButton((b) =>
        b.setButtonText("Load projects").onClick(async () => {
          try {
            const projects = await this.plugin.vikunja().listProjects();
            dd.selectEl.empty();
            dd.addOption("", "(first project)");
            for (const p of projects) dd.addOption(String(p.id), p.title);
            dd.setValue(s.fallbackProjectId === null ? "" : String(s.fallbackProjectId));
          } catch (e) {
            new Notice(errorMessage(e), 8000);
          }
        }),
      );
    });

    new Setting(containerEl)
      .setName("Claude Code path")
      .setDesc("Leave empty to find `claude` automatically on this machine (macOS and Linux).")
      .addText((t) =>
        t
          .setPlaceholder("auto-detect")
          .setValue(s.claudePath)
          .onChange(async (v) => {
            s.claudePath = v.trim();
            this.plugin.resetClaudeBinary();
            await save();
          }),
      );

    new Setting(containerEl).setName("Model").addText((t) =>
      t.setValue(s.model).onChange(async (v) => {
        s.model = v.trim() || DEFAULT_SETTINGS.model;
        await save();
      }),
    );

    new Setting(containerEl).setName("Effort").addDropdown((dd) => {
      for (const e of EFFORTS) dd.addOption(e, e);
      dd.setValue(s.effort).onChange(async (v) => {
        s.effort = v as Effort;
        await save();
      });
    });

    new Setting(containerEl)
      .setName("Timeout (seconds)")
      .addText((t) =>
        t.setValue(String(s.timeoutSeconds)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 10) {
            s.timeoutSeconds = Math.round(n);
            await save();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Default time for date-only todos")
      .setDesc("HH:MM, 24-hour")
      .addText((t) =>
        t.setValue(s.defaultTime).onChange(async (v) => {
          if (isValidTime(v.trim())) {
            s.defaultTime = v.trim();
            await save();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Open tasks sent for duplicate check")
      .setDesc("How many of your newest open Vikunja tasks Claude compares against.")
      .addText((t) =>
        t.setValue(String(s.openTaskLimit)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n >= 0) {
            s.openTaskLimit = n;
            await save();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Custom instructions")
      .setDesc("Extra rules for Claude, e.g. “Skip workouts and daily routines.”")
      .addTextArea((t) => {
        t.setValue(s.customInstructions).onChange(async (v) => {
          s.customInstructions = v;
          await save();
        });
        t.inputEl.rows = 4;
      });

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Checks Vikunja and Claude Code on this machine.")
      .addButton((b) =>
        b.setButtonText("Test").onClick(async () => {
          const lines: string[] = [];
          try {
            const projects = await this.plugin.vikunja().listProjects();
            lines.push(`Vikunja OK: ${projects.length} projects`);
          } catch (e) {
            lines.push(`Vikunja: ${errorMessage(e)}`);
          }
          try {
            const binary = this.plugin.getClaudeBinary();
            lines.push(`Claude: ${binary} — ${await claudeVersion(binary)}`);
          } catch (e) {
            lines.push(`Claude: ${errorMessage(e)}`);
          }
          new Notice(lines.join("\n"), 12000);
        }),
      );
  }
}
