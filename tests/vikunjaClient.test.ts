import { describe, expect, it } from "vitest";
import { VikunjaClient, VikunjaError, type HttpFn, type HttpRequest, type HttpResponse } from "../src/vikunjaClient";

const BASE = "https://vik.example.com/api/v1";

const ok = (json: unknown, headers: Record<string, string> = {}): HttpResponse => ({ status: 200, headers, json });

function fakeHttp(routes: Record<string, (req: HttpRequest) => HttpResponse>) {
  const calls: HttpRequest[] = [];
  const http: HttpFn = async (req) => {
    calls.push(req);
    const key = `${req.method} ${req.url.replace(BASE, "").split("?")[0]}`;
    const handler = routes[key];
    return handler ? handler(req) : { status: 404, headers: {}, json: { message: "Not found" } };
  };
  return { http, calls };
}

const query = (req: HttpRequest) => new URL(req.url).searchParams;

describe("VikunjaClient", () => {
  it("lists projects with the bearer token, accepting a base URL that already ends in /api/v1/", async () => {
    const { http, calls } = fakeHttp({ "GET /projects": () => ok([{ id: 1, title: "Inbox" }], { "x-pagination-total-pages": "1" }) });
    const client = new VikunjaClient("https://vik.example.com/api/v1/", "tok", http);
    expect(await client.listProjects()).toEqual([{ id: 1, title: "Inbox" }]);
    expect(calls[0].url).toBe(`${BASE}/projects?page=1&per_page=50`);
    expect(calls[0].headers.Authorization).toBe("Bearer tok");
  });

  it("drops saved filters, pseudo projects and archived projects", async () => {
    const { http } = fakeHttp({
      "GET /projects": () =>
        ok(
          [
            { id: -1, title: "Favorites" },
            { id: -2, title: "My saved filter" },
            { id: 3, title: "Old", is_archived: true },
            { id: 4, title: "Work", is_archived: false },
          ],
          { "x-pagination-total-pages": "1" },
        ),
    });
    const client = new VikunjaClient("https://vik.example.com", "tok", http);
    expect(await client.listProjects()).toEqual([{ id: 4, title: "Work" }]);
  });

  it("treats non-text titles as empty", async () => {
    const { http } = fakeHttp({
      "GET /projects": () => ok([{ id: 1, title: { nested: true } }, { id: 2, title: 42 }], { "x-pagination-total-pages": "1" }),
    });
    const client = new VikunjaClient("https://vik.example.com", "tok", http);
    expect(await client.listProjects()).toEqual([
      { id: 1, title: "" },
      { id: 2, title: "" },
    ]);
  });

  it("follows x-pagination-total-pages", async () => {
    const { http, calls } = fakeHttp({
      "GET /labels": (req) =>
        query(req).get("page") === "1"
          ? ok([{ id: 1, title: "a" }, { id: 2, title: "b" }], { "x-pagination-total-pages": "2" })
          : ok([{ id: 3, title: "c" }], { "x-pagination-total-pages": "2" }),
    });
    const client = new VikunjaClient("https://vik.example.com", "tok", http);
    expect((await client.listLabels()).map((l) => l.id)).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(2);
  });

  it("lists open tasks newest first, normalises unset due dates and respects the limit", async () => {
    const { http, calls } = fakeHttp({
      "GET /tasks": () =>
        ok(
          [
            { id: 9, title: "A", due_date: "0001-01-01T00:00:00Z", project_id: 2 },
            { id: 8, title: "B", due_date: "2026-10-12T23:59:00+02:00", project_id: 3 },
            { id: 7, title: "C", due_date: null, project_id: 3 },
          ],
          { "x-pagination-total-pages": "1" },
        ),
    });
    const client = new VikunjaClient("https://vik.example.com", "tok", http);
    expect(await client.listOpenTasks(2)).toEqual([
      { id: 9, title: "A", dueDate: null, projectId: 2 },
      { id: 8, title: "B", dueDate: "2026-10-12T23:59:00+02:00", projectId: 3 },
    ]);
    const q = query(calls[0]);
    expect(q.get("filter")).toBe("done = false");
    expect(q.get("sort_by")).toBe("id");
    expect(q.get("order_by")).toBe("desc");
  });

  it("falls back to /tasks/all on older Vikunja versions", async () => {
    const { http, calls } = fakeHttp({
      "GET /tasks/all": () => ok([{ id: 1, title: "A", project_id: 2 }], { "x-pagination-total-pages": "1" }),
    });
    const client = new VikunjaClient("https://vik.example.com", "tok", http);
    expect(await client.listOpenTasks(300)).toEqual([{ id: 1, title: "A", dueDate: null, projectId: 2 }]);
    expect(calls.map((c) => c.url.replace(BASE, "").split("?")[0])).toEqual(["/tasks", "/tasks/all"]);
  });

  it("makes no request when the open-task limit is 0", async () => {
    const { http, calls } = fakeHttp({});
    const client = new VikunjaClient("https://vik.example.com", "tok", http);
    expect(await client.listOpenTasks(0)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("creates a task with PUT and returns its id", async () => {
    const { http, calls } = fakeHttp({ "PUT /projects/7/tasks": () => ok({ id: 42, title: "Email Sara" }) });
    const client = new VikunjaClient("https://vik.example.com", "tok", http);
    const result = await client.createTask(7, {
      title: "Email Sara",
      description: "<p>x</p>",
      dueDate: "2026-10-10T23:59:00+02:00",
      priority: 3,
    });
    expect(result).toEqual({ id: 42 });
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].body!)).toEqual({
      title: "Email Sara",
      description: "<p>x</p>",
      priority: 3,
      due_date: "2026-10-10T23:59:00+02:00",
    });
  });

  it("omits due_date when the task has no due date", async () => {
    const { http, calls } = fakeHttp({ "PUT /projects/7/tasks": () => ok({ id: 1 }) });
    const client = new VikunjaClient("https://vik.example.com", "tok", http);
    await client.createTask(7, { title: "T", description: "", dueDate: null, priority: 0 });
    expect(JSON.parse(calls[0].body!)).not.toHaveProperty("due_date");
  });

  it("sets labels with the bulk endpoint", async () => {
    const { http, calls } = fakeHttp({ "POST /tasks/42/labels/bulk": () => ok({ labels: [] }) });
    const client = new VikunjaClient("https://vik.example.com", "tok", http);
    await client.setLabels(42, [10, 11]);
    expect(JSON.parse(calls[0].body!)).toEqual({ labels: [{ id: 10 }, { id: 11 }] });
  });

  it("adds an HTML comment to a task", async () => {
    const { http, calls } = fakeHttp({ "PUT /tasks/42/comments": () => ok({ id: 1, comment: "<p>x</p>" }) });
    const client = new VikunjaClient("https://vik.example.com", "tok", http);
    await client.addComment(42, "<p>x</p>");
    expect(calls[0].method).toBe("PUT");
    expect(JSON.parse(calls[0].body!)).toEqual({ comment: "<p>x</p>" });
  });

  it("builds the web link of a task", () => {
    const client = new VikunjaClient("https://vik.example.com/api/v1/", "tok", fakeHttp({}).http);
    expect(client.taskUrl(42)).toBe("https://vik.example.com/tasks/42");
  });

  it("explains a rejected token", async () => {
    const { http } = fakeHttp({ "GET /projects": () => ({ status: 401, headers: {}, json: { message: "invalid token" } }) });
    const client = new VikunjaClient("https://vik.example.com", "bad", http);
    const err = await client.listProjects().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VikunjaError);
    expect((err as VikunjaError).status).toBe(401);
    expect((err as VikunjaError).message).toContain("API token");
  });

  it("reports network failures with status 0", async () => {
    const http: HttpFn = async () => {
      throw new Error("ECONNREFUSED");
    };
    const client = new VikunjaClient("https://vik.example.com", "tok", http);
    const err = (await client.listLabels().catch((e: unknown) => e)) as VikunjaError;
    expect(err.status).toBe(0);
    expect(err.message).toContain("Could not reach Vikunja");
    expect(err.message).toContain("ECONNREFUSED");
  });

  it("includes Vikunja's error message for other failures", async () => {
    const { http } = fakeHttp({ "PUT /projects/7/tasks": () => ({ status: 400, headers: {}, json: { message: "Title too long" } }) });
    const client = new VikunjaClient("https://vik.example.com", "tok", http);
    await expect(client.createTask(7, { title: "x", description: "", dueDate: null, priority: 0 })).rejects.toThrow(
      "Title too long",
    );
  });
});
