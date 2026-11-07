import { describe, expect, it } from "vitest";
import { formatDate, parseDate } from "./dates";
import { addDuration, isMilestoneDuration, parseDuration } from "./duration";

const add = (start: string, duration: string) => formatDate(addDuration(parseDate(start), parseDuration(duration)));

describe("parseDate / formatDate", () => {
  it("round-trips dates and date-times", () => {
    expect(formatDate(parseDate("2026-04-01"))).toBe("2026-04-01");
    expect(formatDate(parseDate("2026-04-01T13:30"))).toBe("2026-04-01T13:30");
  });

  it("rejects ambiguous or impossible dates", () => {
    expect(() => parseDate("01-04-2026")).toThrow();
    expect(() => parseDate("2026-02-30")).toThrow();
    expect(() => parseDate("2026-04-01T24:00")).toThrow();
  });
});

describe("parseDuration", () => {
  it("parses every unit", () => {
    for (const unit of ["h", "d", "w", "m", "y"]) {
      expect(parseDuration(`3${unit}`)).toEqual({ amount: 3, unit });
    }
  });

  it("rejects bad input", () => {
    for (const bad of ["", "2", "d", "1.5d", "-1d", "2 days", "5min"]) {
      expect(() => parseDuration(bad), bad).toThrow();
    }
  });
});

describe("addDuration", () => {
  it("adds hours, days and weeks", () => {
    expect(add("2026-04-01", "5h")).toBe("2026-04-01T05:00");
    expect(add("2026-04-01", "2d")).toBe("2026-04-03");
    expect(add("2026-04-01", "2w")).toBe("2026-04-15");
  });

  it("treats m as calendar months, clamped to the month's end", () => {
    expect(add("2026-01-15", "1m")).toBe("2026-02-15");
    expect(add("2026-01-31", "1m")).toBe("2026-02-28");
    expect(add("2026-11-30", "3m")).toBe("2027-02-28");
  });

  it("treats y as calendar years", () => {
    expect(add("2026-04-01", "2y")).toBe("2028-04-01");
    expect(add("2024-02-29", "1y")).toBe("2025-02-28");
  });
});

describe("isMilestoneDuration", () => {
  it("is true for missing or zero durations", () => {
    expect(isMilestoneDuration(undefined)).toBe(true);
    expect(isMilestoneDuration("0d")).toBe(true);
    expect(isMilestoneDuration("1h")).toBe(false);
  });
});
