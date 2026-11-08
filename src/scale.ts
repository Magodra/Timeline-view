import { addDays, addMonths } from "./dates";
import type { Scale } from "./types";

export interface Tick {
  date: Date;
  /** Position in the timeline's time span, 0 to 1. */
  at: number;
  label: string;
  /**
   * The label carries context (the year on a month scale, the date on an
   * hour scale): the first tick, and each tick that starts a new year or day.
   * When labels don't all fit, these are kept first.
   */
  major: boolean;
  /**
   * Running number of the period that starts at this tick, counted from a
   * fixed date. Its parity shades periods alternately, the same way on every
   * timeline whatever its start date.
   */
  serial: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Upper bound so a fine scale on a long span cannot create a huge DOM. */
export const MAX_TICKS = 1000;

/** Position of a date in the span, 0 at `start` and 1 at `finish`. Not clamped. */
export function fraction(date: Date, start: Date, finish: Date): number {
  return (date.getTime() - start.getTime()) / (finish.getTime() - start.getTime());
}

/** The first tick boundary at or after `date`. */
function firstBoundary(date: Date, scale: Scale): Date {
  const d = new Date(date.getTime());
  switch (scale) {
    case "hour":
      d.setUTCMinutes(0, 0, 0);
      if (d < date) d.setUTCHours(d.getUTCHours() + 1);
      return d;
    case "day":
      d.setUTCHours(0, 0, 0, 0);
      return d < date ? addDays(d, 1) : d;
    case "week": {
      // Weeks start on Monday (ISO 8601).
      d.setUTCHours(0, 0, 0, 0);
      const monday = addDays(d, -((d.getUTCDay() + 6) % 7));
      return monday < date ? addDays(monday, 7) : monday;
    }
    case "month": {
      const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      return first < date ? addMonths(first, 1) : first;
    }
    case "year": {
      const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return first < date ? new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1)) : first;
    }
  }
}

function next(date: Date, scale: Scale): Date {
  switch (scale) {
    case "hour":
      return new Date(date.getTime() + 3_600_000);
    case "day":
      return addDays(date, 1);
    case "week":
      return addDays(date, 7);
    case "month":
      return addMonths(date, 1);
    case "year":
      return addMonths(date, 12);
  }
}

/** ISO 8601 week number. */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // The week belongs to the year that holds its Thursday.
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/** Running number of the scale period that holds `date`. */
export function periodSerial(date: Date, scale: Scale): number {
  const ms = date.getTime();
  switch (scale) {
    case "hour":
      return Math.floor(ms / 3_600_000);
    case "day":
      return Math.floor(ms / 86_400_000);
    case "week":
      // 1970-01-01 was a Thursday; weeks start on Monday.
      return Math.floor((Math.floor(ms / 86_400_000) + 3) / 7);
    case "month":
      return date.getUTCFullYear() * 12 + date.getUTCMonth();
    case "year":
      return date.getUTCFullYear();
  }
}

/** Whether a tick's label carries context: the first one, or the start of a new day (hour scale) or year (month scale). */
function isMajor(date: Date, scale: Scale, isFirst: boolean): boolean {
  if (scale === "hour") return isFirst || date.getUTCHours() === 0;
  if (scale === "month") return isFirst || date.getUTCMonth() === 0;
  return false;
}

/** A major tick shows the year (month scale) or date (hour scale) for context. */
function label(date: Date, scale: Scale, major: boolean): string {
  switch (scale) {
    case "hour": {
      const time = `${String(date.getUTCHours()).padStart(2, "0")}:00`;
      return major ? `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${time}` : time;
    }
    case "day":
      return String(date.getUTCDate());
    case "week":
      return `W${isoWeek(date)}`;
    case "month": {
      const month = MONTHS[date.getUTCMonth()];
      return major ? `${month} ${date.getUTCFullYear()}` : month;
    }
    case "year":
      return String(date.getUTCFullYear());
  }
}

/** Tick marks for the time scale, from the first boundary at or after `start` up to `finish`. */
export function ticks(start: Date, finish: Date, scale: Scale): Tick[] {
  const result: Tick[] = [];
  for (let d = firstBoundary(start, scale); d <= finish && result.length < MAX_TICKS; d = next(d, scale)) {
    const major = isMajor(d, scale, result.length === 0);
    result.push({
      date: d,
      at: fraction(d, start, finish),
      label: label(d, scale, major),
      major,
      serial: periodSerial(d, scale),
    });
  }
  return result;
}
