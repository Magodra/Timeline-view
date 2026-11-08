import { describe, expect, it } from "vitest";
import { dateToData, formatDate, parseDate } from "./dates";
import { addDuration, isMilestoneDuration, parseDuration } from "./duration";

const add = (start: string, duration: string) => formatDate(addDuration(parseDate(start), parseDuration(duration)));

describe("parseDate / formatDate", () => {
  it("round-trips dates and date-times", () => {
    expect(formatDate(parseDate("2026-04-01"))).toBe("2026-04-01");
    expect(formatDate(parseDate("2026-04-01T13:30"))).toBe("2026-04-01T13:30");
  });

  it("rejects ambiguous or impossible dates", () => {
    for (const bad of [
      "01-04-2026",
      "2026-02-30",
      "2026-04-01T24:00",
      "2026-04-01T10:00:60",
      "2026-04-01Z",
      "2026-04-01T10:00+25:00",
      "2026-04-01T10:00 Z",
      "2026-04-01T10",
    ]) {
      expect(() => parseDate(bad), bad).toThrow();
    }
  });

  it("reads full ISO timestamps, converting a zone to UTC", () => {
    const iso = (text: string) => parseDate(text).toISOString();
    expect(iso("2026-04-01T09:30:00Z")).toBe("2026-04-01T09:30:00.000Z");
    expect(iso("2026-04-01T09:30:15.250Z")).toBe("2026-04-01T09:30:15.250Z");
    expect(iso("2026-04-01T09:30:00+02:00")).toBe("2026-04-01T07:30:00.000Z");
    expect(iso("2026-04-01T23:30-0130")).toBe("2026-04-02T01:00:00.000Z");
    expect(iso("2026-04-01T09:30+02")).toBe("2026-04-01T07:30:00.000Z");
    // Without a zone, a time is UTC, as before.
    expect(iso("2026-04-01T09:30")).toBe("2026-04-01T09:30:00.000Z");
  });

  it("shows seconds only when they aren't zero", () => {
    expect(formatDate(parseDate("2026-04-01T00:00:00Z"))).toBe("2026-04-01");
    expect(formatDate(parseDate("2026-04-01T09:30:00+02:00"))).toBe("2026-04-01T07:30");
    expect(formatDate(parseDate("2026-04-01T09:30:15Z"))).toBe("2026-04-01T09:30:15");
  });

  it("writes a parsed date back as it was given, and a computed one formatted", () => {
    expect(dateToData(parseDate("2026-04-01T09:30:00+02:00"))).toBe("2026-04-01T09:30:00+02:00");
    expect(dateToData(new Date(Date.UTC(2026, 3, 1, 7, 30)))).toBe("2026-04-01T07:30");
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
