import { describe, expect, it, vi } from "vitest";
import { HandledStore } from "../src/handledStore";
import type { HandledMap } from "../src/types";

const NOW = new Date("2026-10-10T08:00:00.000Z");

function makeStore(initial: HandledMap = {}) {
  const persist = vi.fn(async (_map: HandledMap) => {});
  const store = new HandledStore(initial, persist, () => NOW);
  return { store, persist };
}

describe("HandledStore", () => {
  it("returns an empty list for unknown notes", () => {
    expect(makeStore().store.get("x.md")).toEqual([]);
  });

  it("records sent todos and persists a snapshot", async () => {
    const { store, persist } = makeStore();
    const entry = await store.markSent("a.md", { title: "Email Sara", sourceQuote: "send email to sara", vikunjaTaskId: 42 });
    expect(entry).toMatchObject({ title: "Email Sara", sourceQuote: "send email to sara", status: "sent", vikunjaTaskId: 42, at: NOW.toISOString() });
    expect(entry.id).toMatch(/.+/);
    expect(store.get("a.md")).toEqual([entry]);
    expect(persist).toHaveBeenCalledWith({ "a.md": [entry] });
  });

  it("records dismissed todos without a task id", async () => {
    const { store } = makeStore();
    const entry = await store.markDismissed("a.md", { title: "Morning run", sourceQuote: "start my day with a run" });
    expect(entry).toMatchObject({ status: "dismissed", vikunjaTaskId: null });
  });

  it("gives every entry a unique id and keeps notes separate", async () => {
    const { store } = makeStore();
    const a = await store.markDismissed("a.md", { title: "A", sourceQuote: "a" });
    const b = await store.markDismissed("a.md", { title: "B", sourceQuote: "b" });
    await store.markDismissed("b.md", { title: "C", sourceQuote: "c" });
    expect(a.id).not.toBe(b.id);
    expect(store.get("a.md").map((e) => e.title)).toEqual(["A", "B"]);
    expect(store.get("b.md").map((e) => e.title)).toEqual(["C"]);
  });

  it("returns copies so callers cannot mutate the store", async () => {
    const { store } = makeStore();
    await store.markDismissed("a.md", { title: "A", sourceQuote: "a" });
    store.get("a.md")[0].title = "changed";
    expect(store.get("a.md")[0].title).toBe("A");
  });

  it("moves entries when a note is renamed", async () => {
    const { store, persist } = makeStore();
    await store.markDismissed("old.md", { title: "A", sourceQuote: "a" });
    persist.mockClear();
    await store.rename("old.md", "new.md");
    expect(store.get("old.md")).toEqual([]);
    expect(store.get("new.md").map((e) => e.title)).toEqual(["A"]);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("moves entries of all notes inside a renamed folder, but not look-alike folders", async () => {
    const { store } = makeStore();
    await store.markDismissed("Notes/Daily/2026/a.md", { title: "A", sourceQuote: "a" });
    await store.markDismissed("Notes/Daily2/b.md", { title: "B", sourceQuote: "b" });
    await store.rename("Notes/Daily", "Journal");
    expect(store.get("Journal/2026/a.md").map((e) => e.title)).toEqual(["A"]);
    expect(store.get("Notes/Daily2/b.md").map((e) => e.title)).toEqual(["B"]);
  });

  it("merges into an existing target and skips persisting when nothing matched", async () => {
    const { store, persist } = makeStore();
    await store.markDismissed("a.md", { title: "A", sourceQuote: "a" });
    await store.markDismissed("b.md", { title: "B", sourceQuote: "b" });
    await store.rename("a.md", "b.md");
    expect(store.get("b.md").map((e) => e.title)).toEqual(["B", "A"]);
    persist.mockClear();
    await store.rename("nothing.md", "else.md");
    expect(persist).not.toHaveBeenCalled();
  });

  it("replaces its entries when data.json changed on another machine, without persisting", async () => {
    const { store, persist } = makeStore();
    await store.markDismissed("a.md", { title: "A", sourceQuote: "a" });
    persist.mockClear();
    const synced = { "b.md": [{ id: "x", title: "B", sourceQuote: "b", status: "sent" as const, vikunjaTaskId: 5, at: NOW.toISOString() }] };
    store.replace(synced);
    expect(store.get("a.md")).toEqual([]);
    expect(store.get("b.md").map((e) => e.title)).toEqual(["B"]);
    synced["b.md"][0].title = "mutated";
    expect(store.get("b.md")[0].title).toBe("B");
    expect(persist).not.toHaveBeenCalled();
  });
});
