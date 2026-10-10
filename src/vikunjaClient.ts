import { normalizeBaseUrl } from "./settings";
import type { VikunjaLabel, VikunjaProject, VikunjaTask } from "./types";

export interface HttpRequest {
  url: string;
  method: "GET" | "PUT" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  /** Header names in lower case. */
  headers: Record<string, string>;
  json: unknown;
}

export type HttpFn = (req: HttpRequest) => Promise<HttpResponse>;

export class VikunjaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VikunjaError";
  }
}

export interface NewTask {
  title: string;
  /** HTML. */
  description: string;
  /** RFC 3339 or null. */
  dueDate: string | null;
  priority: number;
}

type Json = Record<string, unknown>;

const PER_PAGE = 50;
const MAX_PAGES = 100;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asArray(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : [];
}

function toDueDate(value: unknown): string | null {
  if (typeof value !== "string" || value === "" || value.startsWith("0001-")) return null;
  return value;
}

export class VikunjaClient {
  private readonly webBase: string;
  private readonly apiBase: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly http: HttpFn,
  ) {
    this.webBase = normalizeBaseUrl(baseUrl);
    this.apiBase = `${this.webBase}/api/v1`;
  }

  /** Link to open a task in the Vikunja web app. */
  taskUrl(taskId: number): string {
    return `${this.webBase}/tasks/${taskId}`;
  }

  async listProjects(): Promise<VikunjaProject[]> {
    const items = await this.paginate("/projects", {}, Infinity);
    return items
      .filter((p) => typeof p.id === "number" && p.id > 0 && p.is_archived !== true)
      .map((p) => ({ id: p.id as number, title: str(p.title) }));
  }

  async listLabels(): Promise<VikunjaLabel[]> {
    const items = await this.paginate("/labels", {}, Infinity);
    return items
      .filter((l) => typeof l.id === "number")
      .map((l) => ({ id: l.id as number, title: str(l.title) }));
  }

  async listOpenTasks(limit: number): Promise<VikunjaTask[]> {
    const query = { filter: "done = false", sort_by: "id", order_by: "desc" };
    let items: Json[];
    try {
      items = await this.paginate("/tasks", query, limit);
    } catch (e) {
      if (!(e instanceof VikunjaError) || e.status !== 404) throw e;
      items = await this.paginate("/tasks/all", query, limit);
    }
    return items.slice(0, limit).map((t) => ({
      id: t.id as number,
      title: str(t.title),
      dueDate: toDueDate(t.due_date),
      projectId: Number(t.project_id ?? 0),
    }));
  }

  async createTask(projectId: number, task: NewTask): Promise<{ id: number }> {
    const body: Json = { title: task.title, description: task.description, priority: task.priority };
    if (task.dueDate) body.due_date = task.dueDate;
    const res = await this.call("PUT", `/projects/${projectId}/tasks`, body);
    const id = (res.json as Json | null)?.id;
    if (typeof id !== "number") throw new VikunjaError("Vikunja did not return the new task's id", res.status);
    return { id };
  }

  async setLabels(taskId: number, labelIds: number[]): Promise<void> {
    await this.call("POST", `/tasks/${taskId}/labels/bulk`, { labels: labelIds.map((id) => ({ id })) });
  }

  async addComment(taskId: number, html: string): Promise<void> {
    await this.call("PUT", `/tasks/${taskId}/comments`, { comment: html });
  }

  private async paginate(path: string, query: Record<string, string>, limit: number): Promise<Json[]> {
    const out: Json[] = [];
    for (let page = 1; page <= MAX_PAGES && out.length < limit; page++) {
      const params = new URLSearchParams({ ...query, page: String(page), per_page: String(PER_PAGE) });
      const res = await this.call("GET", `${path}?${params.toString()}`);
      const items = asArray(res.json);
      out.push(...items);
      const totalPages = Number(res.headers["x-pagination-total-pages"]);
      if (items.length === 0 || (Number.isFinite(totalPages) && page >= totalPages)) break;
    }
    return out;
  }

  private async call(method: HttpRequest["method"], path: string, body?: unknown): Promise<HttpResponse> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: HttpResponse;
    try {
      res = await this.http({
        url: this.apiBase + path,
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new VikunjaError(
        `Could not reach Vikunja at ${this.apiBase}: ${e instanceof Error ? e.message : String(e)}`,
        0,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new VikunjaError(
        `Vikunja rejected the API token (HTTP ${res.status}). Check the token and its permissions in the plugin settings.`,
        res.status,
      );
    }
    if (res.status >= 400) {
      const msg = (res.json as Json | null)?.message;
      throw new VikunjaError(
        `Vikunja ${method} ${path.split("?")[0]} failed (HTTP ${res.status})${typeof msg === "string" ? `: ${msg}` : ""}`,
        res.status,
      );
    }
    return res;
  }
}
