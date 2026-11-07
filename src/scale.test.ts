import { describe, expect, it } from "vitest";
import { formatDate, parseDate } from "./dates";
import { calloutOffset } from "./drag";
import { isoWeek, ticks } from "./scale";

const labels = (start: string, end: string, scale: Parameters<typeof ticks>[2]) =>
  ticks(parseDate(start), parseDate(end), scale).map((t) => t.label);

describe("ticks", () => {
  it("places boundaries at the right fractions", () => {
    const result = ticks(parseDate("2026-04-01"), parseDate("2026-04-05"), "day");
    expect(result.map((t) => formatDate(t.date))).toEqual([
      "2026-04-01",
      "2026-04-02",
      "2026-04-03",
      "2026-04-04",
      "2026-04-05",
    ]);
    expect(result.map((t) => t.at)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("labels each scale", () => {
    expect(labels("2026-04-01T22:00", "2026-04-02T01:00", "hour")).toEqual([
      "1 Apr 22:00",
      "23:00",
      "2 Apr 00:00",
      "01:00",
    ]);
    expect(labels("2026-11-01", "2027-02-01", "month")).toEqual(["Nov 2026", "Dec", "Jan 2027", "Feb"]);
    expect(labels("2025-06-01", "2027-01-01", "year")).toEqual(["2026", "2027"]);
  });

  it("starts weeks on Monday", () => {
    // 2026-03-01 is a Sunday, so the first boundary is Monday 2026-03-02.
    const result = ticks(parseDate("2026-03-01"), parseDate("2026-03-20"), "week");
    expect(result.map((t) => formatDate(t.date))).toEqual(["2026-03-02", "2026-03-09", "2026-03-16"]);
    expect(result.map((t) => t.label)).toEqual(["W10", "W11", "W12"]);
  });
});

describe("isoWeek", () => {
  it("handles weeks that cross a year boundary", () => {
    expect(isoWeek(parseDate("2026-01-01"))).toBe(1);
    expect(isoWeek(parseDate("2027-01-01"))).toBe(53);
    expect(isoWeek(parseDate("2024-12-30"))).toBe(1);
  });
});

describe("calloutOffset", () => {
  // A 400 px wide area from x = 100; attachment at 25% → x = 200.
  const area = (top: number, bottom: number) => ({ left: 100, right: 500, width: 400, top, bottom });
  const box = (left: number, top: number) => ({ left, top, right: left + 80, bottom: top + 30, width: 80 });

  it("measures above the bar from the bar's top edge to the label's bottom", () => {
    // Area spans 100..300, so the bar's top edge is at 300.
    expect(calloutOffset(box(230, 210), area(100, 300), 0.25, "above")).toEqual({ x: 30, y: -60 });
    // Overlapping the bar is clamped to sitting on it.
    expect(calloutOffset(box(180, 290), area(100, 300), 0.25, "above")).toEqual({ x: -20, y: 0 });
  });

  it("measures below the bar from the bar's bottom edge to the label's top", () => {
    // Area spans 400..500, so the bar's bottom edge is at 400.
    expect(calloutOffset(box(230, 450), area(400, 500), 0.25, "below")).toEqual({ x: 30, y: 50 });
    // Beyond the area's outer edge is fine: the area grows to fit.
    expect(calloutOffset(box(230, 700), area(400, 500), 0.25, "below")).toEqual({ x: 30, y: 300 });
    expect(calloutOffset(box(230, 380), area(400, 500), 0.25, "below")).toEqual({ x: 30, y: 0 });
  });
});
