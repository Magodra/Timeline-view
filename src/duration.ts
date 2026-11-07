import { addDays, addMonths } from "./dates";

export type DurationUnit = "h" | "d" | "w" | "m" | "y";

export interface Duration {
  amount: number;
  unit: DurationUnit;
}

const DURATION = /^(\d+)([hdwmy])$/;

/** Parses `"2d"`, `"3m"` and so on. `m` is months; there is no minutes unit. */
export function parseDuration(text: string): Duration {
  const m = DURATION.exec(text.trim());
  if (!m) {
    throw new Error(`Invalid duration "${text}": expected a whole number plus h, d, w, m or y`);
  }
  return { amount: Number(m[1]), unit: m[2] as DurationUnit };
}

/** Adds a duration. Months and years are calendar units, clamped to the month's end. */
export function addDuration(start: Date, { amount, unit }: Duration): Date {
  switch (unit) {
    case "h":
      return new Date(start.getTime() + amount * 3_600_000);
    case "d":
      return addDays(start, amount);
    case "w":
      return addDays(start, amount * 7);
    case "m":
      return addMonths(start, amount);
    case "y":
      return addMonths(start, amount * 12);
  }
}

/** A task is a milestone when its duration is missing or zero. */
export function isMilestoneDuration(text: string | undefined): boolean {
  return text === undefined || text.trim() === "" || parseDuration(text).amount === 0;
}
