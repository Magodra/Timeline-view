/**
 * Dates are handled in UTC throughout, so day and month arithmetic is not
 * affected by daylight saving time in the viewer's zone.
 */

/**
 * ISO 8601: a date, optionally a time (minutes, seconds, fraction), and with
 * a time optionally a zone: `Z` or an offset such as `+02:00`.
 */
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

const EXPECTED = "expected YYYY-MM-DD, YYYY-MM-DDTHH:mm or a full ISO 8601 timestamp such as 2026-04-01T09:30:00Z";

/** The text each parsed date came from, so data is written back as it was given. */
const sources = new WeakMap<Date, string>();

/**
 * Parses an ISO 8601 date or timestamp. A time with `Z` or an offset is
 * converted to UTC; a date, or a time without a zone, is read as UTC.
 */
export function parseDate(text: string): Date {
  const m = typeof text === "string" ? ISO_DATE.exec(text) : null;
  if (!m) throw new Error(`Invalid date "${text}": ${EXPECTED}`);
  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "", zone = ""] = m;
  const ms = Number(frac.slice(0, 3).padEnd(3, "0"));
  const local = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, ms));
  // Reject dates that roll over, such as 2026-02-30.
  if (local.getUTCMonth() !== +mo - 1 || local.getUTCDate() !== +d || +h > 23 || +mi > 59 || +s > 59) {
    throw new Error(`Invalid date "${text}"`);
  }
  let offset = 0;
  if (zone && zone !== "Z") {
    const [, sign, oh, om = "0"] = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone)!;
    if (+oh > 23 || +om > 59) throw new Error(`Invalid date "${text}": bad zone offset`);
    offset = (sign === "-" ? -1 : 1) * (+oh * 60 + +om);
  }
  const date = new Date(local.getTime() - offset * 60_000);
  sources.set(date, text);
  return date;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Formats for display, in UTC: `YYYY-MM-DD`, adding `THH:mm` when the time
 * is not midnight and `:ss` when the seconds are not zero.
 */
export function formatDate(date: Date): string {
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const h = date.getUTCHours();
  const mi = date.getUTCMinutes();
  const s = date.getUTCSeconds();
  if (s) return `${day}T${pad(h)}:${pad(mi)}:${pad(s)}`;
  return h || mi ? `${day}T${pad(h)}:${pad(mi)}` : day;
}

/**
 * A date for the data format: the text it was parsed from, unchanged (so
 * `2026-04-01T09:30:00+02:00` stays as written), or `formatDate` for a
 * computed date.
 */
export function dateToData(date: Date): string {
  return sources.get(date) ?? formatDate(date);
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
