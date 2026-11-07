import { describe, expect, it } from "vitest";
import { formatDate } from "./dates";
import { MoveError, TimelineModel, lineCount, viewRange } from "./model";
import type { TimelineData, TimelineViewData } from "./types";

function sample(): TimelineViewData {
  return {
    view: { id: "v1", name: "Example", scale: "week" },
    tasks: [
      { id: 1, text: "Task #1", start_date: "2026-04-01", duration: "2d" },
      { id: 2, text: "Milestone #1", start_date: "2026-04-10" },
      { id: 3, text: "Task #3", start_date: "2026-03-10", duration: "1w" },
    ],
    timelines: [
      {
        id: 1,
        name: "Project",
        start_date: "2026-03-01",
        finish_date: "2026-05-01",
        entries: [
          { task: 1, line: 1 },
          { task: 2, callout_offset: { x: 30, y: 16 } },
          { task: 3, callout_offset: { x: -20, y: -40 } },
        ],
      },
      { id: 2, name: "Other", start_date: "2026-04-01", finish_date: "2026-06-01", entries: [{ task: 1, callout_offset: { x: 0, y: -16 } }] },
    ],
  };
}

const entries = (m: TimelineModel, timelineId: number) =>
  m.toData().timelines.find((t) => t.id === timelineId)!.entries;
const entry = (m: TimelineModel, timelineId: number, task: number) =>
  entries(m, timelineId).find((e) => e.task === task);

describe("fromData", () => {
  it("derives task kind and finish date from the duration", () => {
    const m = TimelineModel.fromData(sample());
    expect(m.findTask(1)!.isMilestone).toBe(false);
    expect(formatDate(m.findTask(1)!.finish)).toBe("2026-04-03");
    expect(m.findTask(2)!.isMilestone).toBe(true);
    expect(formatDate(m.findTask(2)!.finish)).toBe("2026-04-10");
  });

  it("round-trips through toData", () => {
    const data = sample();
    const out = TimelineModel.fromData(data).toData();
    expect(out.view.absolute).toBe(false);
    expect(out.timelines).toEqual(data.timelines);
    // finish_date is derived, so it is not written back for tasks.
    expect(out.tasks).toEqual(data.tasks);
  });

  it("derives the area from the entry: callout_offset.y picks the side, no offset means the bar", () => {
    const data = sample();
    data.timelines[0].entries.push({ task: 4 }, { task: 5, callout_offset: { x: 3, y: 0 } });
    data.tasks.push(
      { id: 4, text: "No line", start_date: "2026-03-20", duration: "1d" },
      { id: 5, text: "Flush above", start_date: "2026-03-25" },
    );
    const m = TimelineModel.fromData(data);
    const placements = Object.fromEntries(m.findTimeline(1)!.entries.map((e) => [e.taskId, e.placement]));
    expect(placements).toEqual({ 1: "on", 2: "below", 3: "above", 4: "on", 5: "above" });
    // No line means line 0; serialize writes it out.
    expect(entry(m, 1, 4)).toEqual({ task: 4, line: 0 });
    expect(entry(m, 1, 5)).toEqual({ task: 5, callout_offset: { x: 3, y: 0 } });
  });

  it("gives each timeline its own range, and the view a range covering them all", () => {
    const m = TimelineModel.fromData(sample());
    expect(formatDate(m.findTimeline(1)!.start)).toBe("2026-03-01");
    expect(formatDate(m.findTimeline(2)!.finish)).toBe("2026-06-01");
    const range = viewRange(m)!;
    expect([formatDate(range.start), formatDate(range.finish)]).toEqual(["2026-03-01", "2026-06-01"]);
  });

  it("calculates the number of bar lines from the entries, at least 1", () => {
    const data = sample();
    expect(lineCount(TimelineModel.fromData(data).findTimeline(1)!)).toBe(2);
    expect(lineCount(TimelineModel.fromData(data).findTimeline(2)!)).toBe(1);
    data.timelines[0].entries[0].line = 5;
    expect(lineCount(TimelineModel.fromData(data).findTimeline(1)!)).toBe(6);
  });

  it("rejects invalid data", () => {
    const cases: Array<(d: TimelineViewData) => void> = [
      (d) => (d.timelines[0].start_date = "01-03-2026"),
      (d) => (d.timelines[0].finish_date = "2026-02-01"),
      (d) => delete (d.timelines[1] as Partial<TimelineData>).finish_date,
      (d) => ((d.view as { absolute?: unknown }).absolute = "yes"),
      (d) => (d.tasks[1].id = 1),
      (d) => (d.tasks[0].duration = "2 days"),
      (d) => (d.timelines[0].entries[0].task = 99),
      (d) => d.timelines[0].entries.push({ task: 1 }),
      (d) => (d.timelines[0].entries[0].callout_offset = { x: 1, y: 1 }),
      (d) => (d.timelines[0].entries[0].line = -1),
      (d) => (d.timelines[0].entries[1].line = 0),
      (d) => (d.timelines[0].entries[1].callout_offset = { x: "a", y: 5 } as never),
    ];
    for (const mutate of cases) {
      const data = sample();
      mutate(data);
      expect(() => TimelineModel.fromData(data), mutate.toString()).toThrow();
    }
  });
});

describe("moveEntry", () => {
  it("changes only the callout offset", () => {
    const m = TimelineModel.fromData(sample());
    m.moveEntry(1, 2, { calloutOffset: { x: 40, y: 90 } });
    expect(entry(m, 1, 2)).toEqual({ task: 2, callout_offset: { x: 40, y: 90 } });
  });

  it("mirrors the offset when a callout changes side without a new offset", () => {
    const m = TimelineModel.fromData(sample());
    m.moveEntry(1, 2, { placement: "above" });
    expect(entry(m, 1, 2)).toEqual({ task: 2, callout_offset: { x: 30, y: -16 } });
  });

  it("keeps a callout below the bar at y > 0, since y = 0 means above", () => {
    const m = TimelineModel.fromData(sample());
    m.moveEntry(1, 3, { calloutOffset: { x: 0, y: 0 } });
    m.moveEntry(1, 3, { placement: "below" });
    expect(entry(m, 1, 3)).toEqual({ task: 3, callout_offset: { x: 0, y: 1 } });
    expect(() => m.moveEntry(1, 3, { calloutOffset: { x: 0, y: 0 } })).toThrow(MoveError);
  });

  it("gives a bar entry moved to a callout area the default offset", () => {
    const m = TimelineModel.fromData(sample());
    m.moveEntry(1, 1, { placement: "below" });
    expect(entry(m, 1, 1)).toEqual({ task: 1, callout_offset: { x: 0, y: 16 } });
  });

  it("moves a callout onto the bar, dropping its offset, and opens a new bar line", () => {
    const m = TimelineModel.fromData(sample());
    m.moveEntry(1, 2, { placement: "on", line: 2 });
    // Blank line 0 is trimmed: task 1 moves up to 0, task 2 to 1.
    expect(entry(m, 1, 1)).toEqual({ task: 1, line: 0 });
    expect(entry(m, 1, 2)).toEqual({ task: 2, line: 1 });
    expect(lineCount(m.findTimeline(1)!)).toBe(2);
  });

  it("inserts a new bar line above the others, shifting them down", () => {
    const m = TimelineModel.fromData(sample());
    m.moveEntry(1, 2, { placement: "on", line: 0, newLine: true });
    expect(entry(m, 1, 2)).toEqual({ task: 2, line: 0 });
    expect(entry(m, 1, 1)).toEqual({ task: 1, line: 2 });
    expect(lineCount(m.findTimeline(1)!)).toBe(3);
  });

  it("trims blank lines at the top and bottom after a move, keeping gaps between", () => {
    const m = TimelineModel.fromData(sample());
    m.moveEntry(1, 3, { placement: "on", line: 0 });
    // Task 3 alone on line 0, task 1 on line 1. Moving task 3 to a new bottom
    // line leaves line 0 blank, so everything moves up one.
    m.moveEntry(1, 3, { line: 2, newLine: true });
    expect(entry(m, 1, 1)).toEqual({ task: 1, line: 0 });
    expect(entry(m, 1, 3)).toEqual({ task: 3, line: 1 });
    expect(lineCount(m.findTimeline(1)!)).toBe(2);
    // Task 3 to a new top line: task 1 shifts down, and the line task 3 left (now the last) goes.
    m.moveEntry(1, 3, { line: 0, newLine: true });
    expect(entry(m, 1, 3)).toEqual({ task: 3, line: 0 });
    expect(entry(m, 1, 1)).toEqual({ task: 1, line: 1 });
    expect(lineCount(m.findTimeline(1)!)).toBe(2);
    // A gap between used lines stays.
    m.moveEntry(1, 1, { line: 2, newLine: true });
    m.moveEntry(1, 2, { placement: "on", line: 3, newLine: true });
    m.moveEntry(1, 1, { line: 0 });
    expect(entries(m, 1).map((e) => [e.task, e.line])).toEqual([[1, 0], [2, 3], [3, 0]]);
    expect(lineCount(m.findTimeline(1)!)).toBe(4);
  });

  it("drops empty lines below the last entry", () => {
    const m = TimelineModel.fromData(sample());
    m.moveEntry(1, 1, { line: 0 });
    expect(lineCount(m.findTimeline(1)!)).toBe(1);
  });

  it("defaults to bar line 0 when coming from a callout area", () => {
    const m = TimelineModel.fromData(sample());
    m.moveEntry(1, 2, { placement: "on" });
    expect(entry(m, 1, 2)).toEqual({ task: 2, line: 0 });
  });

  it("moves an entry to another timeline", () => {
    const m = TimelineModel.fromData(sample());
    const changed = m.moveEntry(1, 3, { timelineId: 2, placement: "below", calloutOffset: { x: 5, y: 30 } });
    expect(changed.map((t) => t.id)).toEqual([1, 2]);
    expect(entries(m, 1).map((e) => e.task)).toEqual([1, 2]);
    expect(entry(m, 2, 3)).toEqual({ task: 3, callout_offset: { x: 5, y: 30 } });
  });

  it("fails like the REST API does, without changing anything", () => {
    const cases: Array<[Parameters<TimelineModel["moveEntry"]>, string]> = [
      [[9, 2, { line: 0 }], "not_found"],
      [[1, 9, { line: 0 }], "not_found"],
      [[1, 2, { timelineId: 9 }], "not_found"],
      [[1, 1, { timelineId: 2 }], "conflict"],
      [[1, 1, { line: 5 }], "invalid"],
      [[1, 1, { line: -1 }], "invalid"],
      [[1, 1, { line: 3, newLine: true }], "invalid"],
      [[1, 2, { newLine: true }], "invalid"],
      [[1, 2, { line: 0 }], "invalid"],
      [[1, 1, { calloutOffset: { x: 1, y: 1 } }], "invalid"],
      [[1, 2, { placement: "on", calloutOffset: { x: 1, y: 1 } }], "invalid"],
      [[1, 2, { calloutOffset: { x: 1, y: -1 } }], "invalid"],
      [[1, 3, { calloutOffset: { x: 1, y: 1 } }], "invalid"],
      [[1, 2, { calloutOffset: { x: Number.NaN, y: 1 } }], "invalid"],
      [[1, 2, { placement: "sideways" as never }], "invalid"],
    ];
    for (const [args, code] of cases) {
      const m = TimelineModel.fromData(sample());
      const before = m.toData();
      let error: unknown;
      try {
        m.moveEntry(...args);
      } catch (e) {
        error = e;
      }
      expect(error, JSON.stringify(args)).toBeInstanceOf(MoveError);
      expect((error as MoveError).code, JSON.stringify(args)).toBe(code);
      expect(m.toData()).toEqual(before);
    }
  });
});
