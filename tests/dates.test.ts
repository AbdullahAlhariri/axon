import { describe, expect, it } from "vitest";
import { addDays, formatChipDate, isValidDate, weekdayName, isValidTime, localDateString, toLocalRfc3339 } from "../src/dates";

describe("test environment", () => {
  it("runs in Europe/Amsterdam (set by the npm test script)", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Europe/Amsterdam");
  });
});

describe("isValidDate", () => {
  it.each(["2026-10-10", "2024-02-29"])("accepts %s", (v) => expect(isValidDate(v)).toBe(true));
  it.each(["2026-02-30", "10-10-2026", "2026-1-5", "tomorrow", "", "2026-13-01"])("rejects %s", (v) =>
    expect(isValidDate(v)).toBe(false),
  );
});

describe("isValidTime", () => {
  it.each(["00:00", "09:05", "23:59"])("accepts %s", (v) => expect(isValidTime(v)).toBe(true));
  it.each(["24:00", "9:05", "3pm", "12:60", ""])("rejects %s", (v) => expect(isValidTime(v)).toBe(false));
});

describe("toLocalRfc3339", () => {
  it("uses summer time offset before the DST switch", () => {
    expect(toLocalRfc3339("2026-10-11", "23:59")).toBe("2026-10-11T23:59:00+02:00");
  });

  it("uses winter time offset after the DST switch", () => {
    expect(toLocalRfc3339("2026-11-02", "15:00")).toBe("2026-11-02T15:00:00+01:00");
  });

  it("rejects invalid input", () => {
    expect(() => toLocalRfc3339("2026-02-30", "10:00")).toThrow("Invalid date");
    expect(() => toLocalRfc3339("2026-10-11", "3pm")).toThrow("Invalid time");
  });
});

describe("localDateString", () => {
  it("formats the local calendar date", () => {
    expect(localDateString(new Date(2026, 9, 9, 23, 30))).toBe("2026-10-09");
  });
});

describe("formatChipDate", () => {
  it("says Today and Tomorrow", () => {
    expect(formatChipDate("2026-10-10", "2026-10-10")).toBe("Today");
    expect(formatChipDate("2026-10-11", "2026-10-10")).toBe("Tomorrow");
  });

  it("shows weekday, day and month for other dates this year", () => {
    const label = formatChipDate("2026-10-14", "2026-10-10");
    expect(label).toMatch(/14/);
    expect(label).not.toMatch(/2026/);
  });

  it("adds the year for other years", () => {
    expect(formatChipDate("2027-01-05", "2026-10-10")).toMatch(/2027/);
  });
});

describe("addDays and weekdayName", () => {
  it("adds days across month ends and DST", () => {
    expect(addDays("2026-10-10", 1)).toBe("2026-10-11");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });

  it("names the weekday in English", () => {
    expect(weekdayName("2026-10-10")).toBe("Saturday");
    expect(weekdayName("2026-10-12")).toBe("Monday");
  });
});
