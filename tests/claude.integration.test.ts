import { describe, expect, it } from "vitest";
import { nodeProbe, resolveClaudeBinary } from "../src/claudeBinary";
import { runClaude } from "../src/claudeRunner";
import { extractTodos } from "../src/extractTodos";

// Synthetic note in the style of a real journal entry (no personal content in git).
const NOTE_TEXT = `## Day events
- worked today
- read the news after work

## Journal
Long day at work, helped a colleague for 2 hours and went to the gym after. Felt great alhamdulillah.
I'm planning not to work tomorrow as I want to focus on my side project and statistics week 3 and 4.
What I want to do tomorrow is wake up early, meditate, read and journal a bit, then work on the side project
until lunch, then walk in the park if it is not raining. Tomorrow i also need to call the dentist at 3pm to move my appointment.
what i also want to do is send an email to sara about the invoice
- send email to sara about the invoice
- call to book the bike service with the shop we know, but first ask velo fix for a quote

That's it, journaling to keep my mind empty before sleeping.`;

describe.skipIf(!process.env.RUN_CLAUDE_IT)("real Claude Code CLI", () => {
  it(
    "drafts only real one-off tasks, merges dependent steps and dates them from today",
    async () => {
      const binary = resolveClaudeBinary("", nodeProbe());
      const note = {
        // The title says 9 Oct, but dates must count from "today" (10 Oct).
        path: "Notes/Daily (2026-10-09).md",
        basename: "Daily (2026-10-09)",
        vaultName: "main",
        text: NOTE_TEXT,
      };
      const result = await extractTodos(
        note,
        { fallbackProjectId: 1, openTaskLimit: 300, customInstructions: "" },
        {
          vikunja: {
            listProjects: async () => [
              { id: 1, title: "Inbox" },
              { id: 2, title: "Personal" },
            ],
            listLabels: async () => [{ id: 10, title: "phone call" }],
            listOpenTasks: async () => [{ id: 55, title: "Email Sara about the invoice", dueDate: null, projectId: 1 }],
          },
          handled: { get: () => [] },
          runClaude: (args) =>
            runClaude({ ...args, binary, model: "claude-sonnet-5-5", effort: "medium", timeoutMs: 120_000 }),
          now: () => new Date(2026, 9, 10, 9, 0),
          timezone: "Europe/Amsterdam",
        },
      );

      const all = [...result.tasks, ...result.maybe, ...result.existing, ...result.handled];
      const titles = all.map((d) => `${d.certainty} | ${d.title} | ${d.description} | ${d.dueDate} ${d.dueTime}`);
      console.log(titles.join("\n"));

      expect(result.tasks.find((d) => /dentist/i.test(d.title))).toMatchObject({ dueDate: "2026-10-11", dueTime: "15:00" });
      expect(result.existing.find((d) => /sara/i.test(d.title))?.match).toMatchObject({ kind: "existing", ref: "55" });
      expect(all.filter((d) => /velo fix|bike|quote/i.test(`${d.title} ${d.description}`))).toHaveLength(1);
      expect(all.some((d) => /meditat|gym|park|walk|wake/i.test(d.title))).toBe(false);
      expect(all.some((d) => /side project|statistics/i.test(d.title))).toBe(false);
      expect(result.tasks.length + result.existing.length).toBeLessThanOrEqual(3);
    },
    180_000,
  );
});
