import { describe, expect, it } from "vitest";
import { formatDate } from "./dates";
import { MoveError, TimelineModel, lineCount, viewRange } from "./model";
import type { TaskEntryData, TimelineData, TimelineViewData } from "./types";

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
  m.toData().timelines.find((t) => t.id === timelineId)!.entries as TaskEntryData[];
const entry = (m: TimelineModel, timelineId: number, task: number) =>
  entries(m, timelineId).find((e) => e.task === task);

describe("fromData", () => {
  it("takes a task's finish_date instead of a duration, and writes it back", () => {
    const data = sample();
    data.tasks.push(
      { id: 4, text: "Dated", start_date: "2026-04-01T08:00:00Z", finish_date: "2026-04-03T17:00:00+02:00" },
      { id: 5, text: "Same day", start_date: "2026-04-05", finish_date: "2026-04-05" },
    );
    const m = TimelineModel.fromData(data);
    expect(m.findTask(4)!.finish.toISOString()).toBe("2026-04-03T15:00:00.000Z");
    expect(m.findTask(4)!.isMilestone).toBe(false);
    expect(m.findTask(5)!.isMilestone).toBe(true);
    expect(m.toData().tasks.slice(3)).toEqual(data.tasks.slice(3));
  });

  it("writes timestamps back as given", () => {
    const data = sample();
    data.tasks[0].start_date = "2026-04-01T09:30:00.000Z";
    data.timelines[0].start_date = "2026-03-01T00:00:00+01:00";
    data.markers = [{ id: 1, text: "Now", date: "2026-04-02T12:00:00Z", marker_offset: { x: 0, y: -16 } }];
    expect(TimelineModel.fromData(data).toData()).toMatchObject({
      tasks: [{ start_date: "2026-04-01T09:30:00.000Z" }, {}, {}],
      timelines: [{ start_date: "2026-03-01T00:00:00+01:00" }, {}],
      markers: [{ date: "2026-04-02T12:00:00Z" }],
    });
  });

  it("rejects a task with both duration and finish_date, or finishing before it starts", () => {
    const both = sample();
    both.tasks[0].finish_date = "2026-04-05";
    expect(() => TimelineModel.fromData(both)).toThrow(/not both/);
    const backwards = sample();
    backwards.tasks[1].finish_date = "2026-04-09";
    expect(() => TimelineModel.fromData(backwards)).toThrow(/before start_date/);
  });

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

  it("reads and writes markers and marker entries", () => {
    const data = sample();
    data.markers = [
      { id: 1, text: "Today", date: "2026-03-20", color: "blue" },
      { id: 2, text: "Freeze", date: "2026-04-15", global: true, marker_offset: { x: 5, y: 20 } },
    ];
    data.timelines[0].entries.push({ marker: 1 });
    const m = TimelineModel.fromData(data);
    expect(m.findTimeline(1)!.markers).toEqual([1]);
    expect(m.findTimeline(1)!.entries).toHaveLength(3); // the task entries only
    const out = m.toData();
    expect(out.markers).toEqual([
      { id: 1, text: "Today", date: "2026-03-20", color: "blue", marker_offset: { x: 0, y: -16 } },
      { id: 2, text: "Freeze", date: "2026-04-15", global: true, marker_offset: { x: 5, y: 20 } },
    ]);
    expect(out.timelines[0].entries.at(-1)).toEqual({ marker: 1 });
    // Without markers, none are written.
    expect(TimelineModel.fromData(sample()).toData()).not.toHaveProperty("markers");
  });

  it("rejects invalid markers", () => {
    const withMarker = (change: (d: TimelineViewData) => void) => () => {
      const data = sample();
      data.markers = [{ id: 1, text: "Today", date: "2026-03-20" }];
      change(data);
      return TimelineModel.fromData(data);
    };
    expect(withMarker((d) => (d.markers![0].date = "20-03-2026"))).toThrow();
    expect(withMarker((d) => d.markers!.push({ id: 1, text: "Again", date: "2026-03-21" }))).toThrow(/Duplicate marker/);
    expect(withMarker((d) => (d.markers![0].color = "red;"))).toThrow(/color/);
    expect(withMarker((d) => (d.markers![0].marker_offset = { x: 0 } as never))).toThrow(/marker_offset/);
    expect(withMarker((d) => d.timelines[0].entries.push({ marker: 9 }))).toThrow(/unknown marker/);
    expect(withMarker((d) => d.timelines[0].entries.push({ marker: 1 }, { marker: 1 }))).toThrow(/more than once/);
    expect(withMarker((d) => d.timelines[0].entries.push({ marker: 1, line: 0 } as never))).toThrow(/only `marker`/);
  });

  it("keeps a task's color", () => {
    const data = sample();
    data.tasks[0].color = "#0a7f5a";
    const out = TimelineModel.fromData(data).toData();
    expect(out.tasks[0].color).toBe("#0a7f5a");
    expect(out.tasks[1]).not.toHaveProperty("color");
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
    (data.timelines[0].entries[0] as TaskEntryData).line = 5;
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
      (d) => (d.tasks[0].color = "red; display: none"),
      (d) => (d.tasks[0].color = 5 as never),
      (d) => ((d.timelines[0].entries[0] as TaskEntryData).task = 99),
      (d) => d.timelines[0].entries.push({ task: 1 }),
      (d) => ((d.timelines[0].entries[0] as TaskEntryData).callout_offset = { x: 1, y: 1 }),
      (d) => ((d.timelines[0].entries[0] as TaskEntryData).line = -1),
      (d) => ((d.timelines[0].entries[1] as TaskEntryData).line = 0),
      (d) => ((d.timelines[0].entries[1] as TaskEntryData).callout_offset = { x: "a", y: 5 } as never),
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

describe("addEntry", () => {
  it("adds a known task by id, on the bar by default", () => {
    const m = TimelineModel.fromData(sample());
    const result = m.addEntry(3, { timelineId: 2 });
    expect(result.created).toBe(false);
    expect(result.timeline.id).toBe(2);
    expect(entry(m, 2, 3)).toEqual({ task: 3, line: 0 });
  });

  it("adds new task data to the tasks", () => {
    const m = TimelineModel.fromData(sample());
    const result = m.addEntry({ id: 9, text: "New", start_date: "2026-04-20", duration: "3d" }, { timelineId: 1, line: 0 });
    expect(result.created).toBe(true);
    expect(m.toData().tasks.at(-1)).toEqual({ id: 9, text: "New", start_date: "2026-04-20", duration: "3d" });
    expect(entry(m, 1, 9)).toEqual({ task: 9, line: 0 });
  });

  it("derives the area from callout_offset, and gives a callout without one the default offset", () => {
    const m = TimelineModel.fromData(sample());
    m.addEntry(3, { timelineId: 2, calloutOffset: { x: 5, y: 20 } });
    expect(entry(m, 2, 3)).toEqual({ task: 3, callout_offset: { x: 5, y: 20 } });
    m.addEntry(2, { timelineId: 2, placement: "above" });
    expect(entry(m, 2, 2)).toEqual({ task: 2, callout_offset: { x: 0, y: -16 } });
  });

  it("inserts a new line and shifts the lines from there down", () => {
    const m = TimelineModel.fromData(sample());
    // Timeline 1: task 1 on line 1, trimmed to line 0 by the add.
    m.addEntry({ id: 9, text: "New", start_date: "2026-04-20" }, { timelineId: 1, placement: "on", line: 1, newLine: true });
    expect(entry(m, 1, 9)).toEqual({ task: 9, line: 0 });
    expect(entry(m, 1, 1)).toEqual({ task: 1, line: 1 });
  });

  it("rejects bad adds without changing anything", () => {
    const cases: [Parameters<TimelineModel["addEntry"]>, string][] = [
      [[3, { timelineId: 99 }], "not_found"],
      [[99, { timelineId: 1 }], "not_found"],
      [[1, { timelineId: 1 }], "conflict"],
      [[{ id: 1, text: "Dup", start_date: "2026-04-01" }, { timelineId: 2 }], "conflict"],
      [[{ id: 9, text: "Bad", start_date: "nope" }, { timelineId: 2 }], "invalid"],
      [[3, { timelineId: 2, line: 5 }], "invalid"],
      [[3, { timelineId: 2, placement: "below", calloutOffset: { x: 0, y: -4 } }], "invalid"],
      [[3, { timelineId: 2, placement: "above", line: 0 }], "invalid"],
      [[3, { timelineId: 2, placement: "on", calloutOffset: { x: 0, y: 4 } }], "invalid"],
    ];
    for (const [args, code] of cases) {
      const m = TimelineModel.fromData(sample());
      const before = m.toData();
      try {
        m.addEntry(...args);
        expect.unreachable(JSON.stringify(args));
      } catch (error) {
        expect((error as MoveError).code, JSON.stringify(args)).toBe(code);
      }
      expect(m.toData(), JSON.stringify(args)).toEqual(before);
    }
  });
});
