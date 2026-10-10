import type { HandledEntry, HandledMap, HandledStatus } from "./types";

interface HandledInput {
  title: string;
  sourceQuote: string;
}

export class HandledStore {
  private map: HandledMap;

  constructor(
    initial: HandledMap,
    private readonly persist: (map: HandledMap) => Promise<void>,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.map = structuredClone(initial);
  }

  get(notePath: string): HandledEntry[] {
    return (this.map[notePath] ?? []).map((e) => ({ ...e }));
  }

  markSent(notePath: string, input: HandledInput & { vikunjaTaskId: number }): Promise<HandledEntry> {
    return this.add(notePath, input, "sent", input.vikunjaTaskId);
  }

  markDismissed(notePath: string, input: HandledInput): Promise<HandledEntry> {
    return this.add(notePath, input, "dismissed", null);
  }

  /** Handles both a renamed note (exact path) and a renamed folder (path prefix). */
  async rename(oldPath: string, newPath: string): Promise<void> {
    let changed = false;
    for (const key of Object.keys(this.map)) {
      let target: string | null = null;
      if (key === oldPath) target = newPath;
      else if (key.startsWith(`${oldPath}/`)) target = newPath + key.slice(oldPath.length);
      if (target === null) continue;
      this.map[target] = [...(this.map[target] ?? []), ...this.map[key]];
      delete this.map[key];
      changed = true;
    }
    if (changed) await this.persist(this.snapshot());
  }

  /** Adopt entries that arrived via sync (data.json changed on disk). Does not persist. */
  replace(map: HandledMap): void {
    this.map = structuredClone(map);
  }

  snapshot(): HandledMap {
    return structuredClone(this.map);
  }

  private async add(
    notePath: string,
    input: HandledInput,
    status: HandledStatus,
    vikunjaTaskId: number | null,
  ): Promise<HandledEntry> {
    const entry: HandledEntry = {
      id: window.crypto.randomUUID(),
      title: input.title,
      sourceQuote: input.sourceQuote,
      status,
      vikunjaTaskId,
      at: this.now().toISOString(),
    };
    this.map[notePath] = [...(this.map[notePath] ?? []), entry];
    await this.persist(this.snapshot());
    return { ...entry };
  }
}
