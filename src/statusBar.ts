import { setIcon, setTooltip } from "obsidian";

/** The small status-bar item: a spinner while Claude reads the note, then a short summary that fades. */
export class ScanStatus {
  private timer: number | null = null;

  constructor(private readonly el: HTMLElement) {
    el.addClass("axon-statusbar");
    el.hide();
  }

  start(text: string, onCancel: () => void): void {
    this.reset();
    this.el.addClass("is-busy");
    this.fill("loader-circle", text, "axon-spin");
    setTooltip(this.el, "Click to cancel", { placement: "top" });
    this.el.onclick = onCancel;
    this.el.show();
  }

  finish(text: string, ok: boolean): void {
    this.reset();
    this.el.addClass(ok ? "is-done" : "is-error");
    this.fill(ok ? "circle-check" : "alert-circle", text);
    this.el.show();
    this.timer = window.setTimeout(() => this.clear(), 4000);
  }

  clear(): void {
    this.reset();
    this.el.hide();
  }

  private reset(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.el.empty();
    this.el.removeClass("is-busy", "is-done", "is-error");
    this.el.onclick = null;
    this.el.removeAttribute("aria-label");
  }

  private fill(iconName: string, text: string, iconCls = ""): void {
    const iconEl = this.el.createSpan({ cls: `axon-statusbar-icon ${iconCls}` });
    setIcon(iconEl, iconName);
    this.el.createSpan({ text });
  }
}
