function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function localDateString(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  return localDateString(new Date(y, mo - 1, d + days));
}

/** English weekday name, used in the prompt (not shown in the UI). */
export function weekdayName(date: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("en-US", { weekday: "long" });
}

/** "2026-10-11" + "23:59" -> "2026-10-11T23:59:00+02:00" using the machine's local timezone. */
export function toLocalRfc3339(date: string, time: string): string {
  if (!isValidDate(date)) throw new Error(`Invalid date: ${date}`);
  if (!isValidTime(time)) throw new Error(`Invalid time: ${time}`);
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const local = new Date(y, mo - 1, d, h, mi, 0);
  const offsetMin = -local.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${date}T${time}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Short, friendly label for a date chip: "Today", "Tomorrow", "Mon 12 Oct", or with the year when it differs. */
export function formatChipDate(date: string, today: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [ty, tmo, td] = today.split("-").map(Number);
  const target = new Date(y, mo - 1, d);
  const days = Math.round((target.getTime() - new Date(ty, tmo - 1, td).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return target.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(y !== ty ? { year: "numeric" as const } : {}),
  });
}
