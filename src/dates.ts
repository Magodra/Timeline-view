/**
 * Dates are handled in UTC throughout, so day and month arithmetic is not
 * affected by daylight saving time in the viewer's zone.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

export function parseDate(text: string): Date {
  const m = ISO_DATE.exec(text);
  if (!m) throw new Error(`Invalid date "${text}": expected YYYY-MM-DD or YYYY-MM-DDTHH:mm`);
  const [, y, mo, d, h = "0", mi = "0"] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  // Reject dates that roll over, such as 2026-02-30.
  if (date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d || +h > 23 || +mi > 59) {
    throw new Error(`Invalid date "${text}"`);
  }
  return date;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Formats as `YYYY-MM-DD`, adding `THH:mm` when the time is not midnight. */
export function formatDate(date: Date): string {
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const h = date.getUTCHours();
  const mi = date.getUTCMinutes();
  return h || mi ? `${day}T${pad(h)}:${pad(mi)}` : day;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Adds calendar months, clamping the day to the end of the target month. */
export function addMonths(date: Date, months: number): Date {
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const day = Math.min(date.getUTCDate(), daysInMonth(year, month));
  return new Date(
    Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()),
  );
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
