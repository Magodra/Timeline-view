import { describe, expect, it } from "vitest";
import { formatDate } from "./dates";
import { MoveError, TimelineModel, lineCount, viewRange } from "./model";
import type {
  MarkerPatchData,
  MilestoneSymbol,
  TaskEntryData,
  TaskPatchData,
  TimelineData,
  TimelineUpdateData,
  TimelineViewData,
} from "./types";

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
    expect(withMarker((d) => d.timelines[0].entries.push({ marker: 1, line: 0 }))).toThrow(/only `marker`/);
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

describe("timeline order", () => {
  it("puts a timeline at a position, and rejects positions out of range", () => {
    const m = TimelineModel.fromData(sample());
    expect(m.setTimelinePosition(2, 0)).toBe(true);
    expect(m.timelines.map((t) => t.id)).toEqual([2, 1]);
    expect(m.setTimelinePosition(2, 0)).toBe(false); // already there
    for (const bad of [-1, 2, 0.5]) {
      expect(() => m.setTimelinePosition(2, bad), String(bad)).toThrow(MoveError);
    }
    expect(() => m.setTimelinePosition(9, 0)).toThrow(/not found/);
  });
});

describe("removeEntry", () => {
  it("takes a task off one timeline, trims it, and keeps the task", () => {
    const m = TimelineModel.fromData(sample());
    // Timeline 1: task 1 on line 1, 2 and 3 are callouts. Task 1 is also on timeline 2.
    const { entry, timeline } = m.removeEntry(2, 1);
    expect(entry).toEqual({ taskId: 1, placement: "above", calloutOffset: { x: 0, y: -16 } });
    expect(timeline.id).toBe(2);
    expect(entries(m, 2)).toEqual([]);
    expect(m.findTask(1)).toBeDefined();

    m.removeEntry(1, 3);
    expect(entries(m, 1).map((e) => e.task)).toEqual([1, 2]);
  });

  it("rejects a task that isn't on the timeline, without changing anything", () => {
    const m = TimelineModel.fromData(sample());
    const before = m.toData();
    expect(() => m.removeEntry(2, 3)).toThrow(/not on timeline/);
    expect(() => m.removeEntry(9, 1)).toThrow(/Timeline 9 not found/);
    expect(m.toData()).toEqual(before);
  });
});

describe("updateTask", () => {
  const task = (m: TimelineModel, id: number) => m.toData().tasks.find((t) => t.id === id);

  it("changes only the given fields", () => {
    const m = TimelineModel.fromData(sample());
    const { task: after, old } = m.updateTask(1, { text: "Renamed", color: "teal" });
    expect(old.text).toBe("Task #1");
    expect(after.text).toBe("Renamed");
    expect(task(m, 1)).toEqual({ id: 1, text: "Renamed", start_date: "2026-04-01", duration: "2d", color: "teal" });
  });

  it("gives the finish one way: duration replaces finish_date and the other way round", () => {
    const m = TimelineModel.fromData(sample());
    m.updateTask(1, { finish_date: "2026-04-10" });
    expect(task(m, 1)).toEqual({ id: 1, text: "Task #1", start_date: "2026-04-01", finish_date: "2026-04-10" });
    m.updateTask(1, { duration: "1w" });
    expect(task(m, 1)).toEqual({ id: 1, text: "Task #1", start_date: "2026-04-01", duration: "1w" });
    expect(formatDate(m.findTask(1)!.finish)).toBe("2026-04-08");
  });

  it("clears optional fields with null, and clearing the duration makes a milestone", () => {
    const m = TimelineModel.fromData(sample());
    m.updateTask(1, { color: "teal" });
    m.updateTask(1, { duration: null, color: null });
    expect(task(m, 1)).toEqual({ id: 1, text: "Task #1", start_date: "2026-04-01" });
    expect(m.findTask(1)!.isMilestone).toBe(true);
    m.updateTask(2, { symbol: "star" });
    expect(task(m, 2)!.symbol).toBe("star");
  });

  it("moves the start, keeping the duration", () => {
    const m = TimelineModel.fromData(sample());
    m.updateTask(1, { start_date: "2026-04-20T09:00:00Z" });
    expect(m.findTask(1)!.finish.toISOString()).toBe("2026-04-22T09:00:00.000Z");
    expect(task(m, 1)!.start_date).toBe("2026-04-20T09:00:00Z");
  });

  it("rejects bad patches without changing anything", () => {
    const cases: [number, unknown, string][] = [
      [9, { text: "x" }, "not_found"],
      [1, { duration: "2d", finish_date: "2026-04-05" }, "invalid"],
      [1, { finish_date: "2026-03-01" }, "invalid"], // before the start
      [1, { start_date: "nope" }, "invalid"],
      [1, { start_date: null }, "invalid"],
      [1, { duration: "2 days" }, "invalid"],
      [1, { color: "not a color;" }, "invalid"],
      [1, { symbol: "hexagon" }, "invalid"],
      [1, { text: 5 }, "invalid"],
      [1, { id: 7 }, "invalid"],
      [1, null, "invalid"],
    ];
    for (const [id, patch, code] of cases) {
      const m = TimelineModel.fromData(sample());
      const before = m.toData();
      expect(() => m.updateTask(id, patch as TaskPatchData), JSON.stringify(patch)).toThrow(MoveError);
      try {
        m.updateTask(id, patch as TaskPatchData);
      } catch (error) {
        expect((error as MoveError).code, JSON.stringify(patch)).toBe(code);
      }
      expect(m.toData()).toEqual(before);
    }
  });
});

describe("editing markers", () => {
  const withMarkers = () => {
    const data = sample();
    data.markers = [{ id: "m", text: "Kick-off", date: "2026-03-10", marker_offset: { x: 0, y: -16 } }];
    data.timelines[0].entries.push({ marker: "m" });
    return TimelineModel.fromData(data);
  };

  it("adds a marker, validated as loaded data", () => {
    const m = withMarkers();
    m.addMarker({ id: "g", text: "Today", date: "2026-04-01T12:00:00Z", global: true });
    expect(m.toData().markers![1]).toEqual({
      id: "g",
      text: "Today",
      date: "2026-04-01T12:00:00Z",
      global: true,
      marker_offset: { x: 0, y: -16 },
    });
    expect(() => m.addMarker({ id: "g", text: "Dup", date: "2026-04-01" })).toThrow(/already exists/);
    expect(() => m.addMarker({ id: "x", text: "Bad", date: "soon" })).toThrow(MoveError);
    expect(m.markers).toHaveLength(2);
  });

  it("updates only the given fields, and clears the color with null", () => {
    const m = withMarkers();
    m.updateMarker("m", { text: "Start", color: "green", marker_offset: { x: 5, y: 20 } });
    expect(m.toData().markers![0]).toEqual({
      id: "m",
      text: "Start",
      date: "2026-03-10",
      color: "green",
      marker_offset: { x: 5, y: 20 },
    });
    m.updateMarker("m", { color: null, global: true });
    expect(m.toData().markers![0]).toEqual({
      id: "m",
      text: "Start",
      date: "2026-03-10",
      global: true,
      marker_offset: { x: 5, y: 20 },
    });
  });

  it("rejects bad marker patches without changing anything", () => {
    const cases: [string, unknown][] = [
      ["nope", { text: "x" }],
      ["m", { date: "soon" }],
      ["m", { color: "nope;" }],
      ["m", { global: "yes" }],
      ["m", { marker_offset: { x: 1 } }],
      ["m", { text: 3 }],
      ["m", { id: "other" }],
    ];
    for (const [id, patch] of cases) {
      const m = withMarkers();
      const before = m.toData();
      expect(() => m.updateMarker(id, patch as MarkerPatchData), JSON.stringify(patch)).toThrow(MoveError);
      expect(m.toData()).toEqual(before);
    }
  });

  it("removes a marker and its entries", () => {
    const m = withMarkers();
    const { timelines } = m.removeMarker("m");
    expect(timelines.map((t) => t.id)).toEqual([1]);
    expect(m.toData().markers).toBeUndefined();
    expect(m.toData().timelines[0].entries.some((e) => "marker" in e)).toBe(false);
  });

  it("shows and hides a marker on a timeline", () => {
    const m = withMarkers();
    expect(m.showMarker(2, "m").changed).toBe(true);
    expect(m.showMarker(2, "m").changed).toBe(false); // already there
    expect(m.toData().timelines[1].entries).toContainEqual({ marker: "m" });
    m.hideMarker(2, "m");
    expect(m.toData().timelines[1].entries).not.toContainEqual({ marker: "m" });
    expect(() => m.hideMarker(2, "m")).toThrow(/not on timeline/);
    expect(() => m.showMarker(2, "nope")).toThrow(/not found/);
  });
});

describe("milestone symbols", () => {
  it("accepts the five symbols, on a task and as the view's default", () => {
    for (const symbol of ["diamond", "circle", "square", "triangle", "star"] as const) {
      const data = sample();
      data.view.milestone_symbol = symbol;
      data.tasks[1].symbol = symbol;
      expect(() => TimelineModel.fromData(data), symbol).not.toThrow();
    }
  });

  it("rejects an unknown symbol in parse(), naming the valid ones", () => {
    const task = sample();
    task.tasks[1].symbol = "hexagon" as MilestoneSymbol;
    expect(() => TimelineModel.fromData(task)).toThrow('Task 2: unknown symbol "hexagon": use diamond, circle, square, triangle or star');

    const view = sample();
    view.view.milestone_symbol = "Diamond" as MilestoneSymbol; // case matters
    expect(() => TimelineModel.fromData(view)).toThrow(/Unknown view\.milestone_symbol "Diamond"/);
  });

  it("rejects an unknown symbol in a new task for addEntry, and in updateTask", () => {
    const m = TimelineModel.fromData(sample());
    const newTask = { id: 9, text: "New", start_date: "2026-04-20", symbol: "hexagon" as MilestoneSymbol };
    expect(() => m.addEntry(newTask, { timelineId: 2 })).toThrow(/unknown symbol "hexagon"/);
    expect(() => m.updateTask(2, { symbol: "hexagon" as MilestoneSymbol })).toThrow(/unknown symbol "hexagon"/);
    expect(m.findTask(9)).toBeUndefined();
    expect(m.findTask(2)!.symbol).toBeUndefined();
  });
});

describe("updateTimeline", () => {
  it("changes the name and dates given, and keeps entries outside the new range", () => {
    const m = TimelineModel.fromData(sample());
    const { old } = m.updateTimeline(1, { finish_date: "2026-04-05T12:00:00Z" });
    expect(formatDate(old.finish)).toBe("2026-05-01");
    const data = m.toData().timelines[0];
    expect([data.name, data.start_date, data.finish_date]).toEqual(["Project", "2026-03-01", "2026-04-05T12:00:00Z"]);
    // Task 2 (2026-04-10) is now past the finish; its entry stays.
    expect(entry(m, 1, 2)).toEqual({ task: 2, callout_offset: { x: 30, y: 16 } });
    m.updateTimeline(1, { name: "Main", start_date: "2026-02-01" });
    expect(m.toData().timelines[0]).toMatchObject({ name: "Main", start_date: "2026-02-01" });
  });

  it("rejects bad changes without changing anything", () => {
    const cases: [number, unknown][] = [
      [9, { name: "x" }],
      [1, { finish_date: "2026-03-01" }], // not after the start
      [1, { start_date: "2026-06-01" }], // after the finish
      [1, { start_date: "soon" }],
      [1, { name: 3 }],
      [1, { position: 0 }],
      [1, null],
    ];
    for (const [id, patch] of cases) {
      const m = TimelineModel.fromData(sample());
      const before = m.toData();
      expect(() => m.updateTimeline(id, patch as TimelineUpdateData), JSON.stringify(patch)).toThrow(MoveError);
      expect(m.toData()).toEqual(before);
    }
  });
});

describe("compact_lines", () => {
  /** Timeline 1: task 1 on line 0, task 3 on line 1, task 2 on line 2. Timeline 2 is empty. */
  const lines = (compact?: boolean) => {
    const data = sample();
    if (compact !== undefined) data.view.compact_lines = compact;
    data.timelines[0].entries = [
      { task: 1, line: 0 },
      { task: 3, line: 1 },
      { task: 2, line: 2 },
    ];
    data.timelines[1].entries = [];
    return TimelineModel.fromData(data);
  };
  const lineOf = (m: TimelineModel, timeline: number) =>
    Object.fromEntries(entries(m, timeline).map((e) => [e.task, e.line]));

  it("is off by default: a line a task leaves stays as a gap", () => {
    const m = lines();
    expect(m.view.compactLines).toBe(false);
    m.moveEntry(1, 3, { line: 0 });
    expect(lineOf(m, 1)).toEqual({ 1: 0, 3: 0, 2: 2 });
  });

  it("closes up a line a task leaves, moving the lines below up", () => {
    const m = lines(true);
    m.moveEntry(1, 3, { line: 0 });
    expect(lineOf(m, 1)).toEqual({ 1: 0, 3: 0, 2: 1 });
    expect(lineCount(m.findTimeline(1)!)).toBe(2);
  });

  it("closes up after moving to another timeline, removing an entry or a task, and moving to a callout", () => {
    const toOther = lines(true);
    toOther.moveEntry(1, 3, { timelineId: 2 });
    expect(lineOf(toOther, 1)).toEqual({ 1: 0, 2: 1 });

    const removed = lines(true);
    removed.removeEntry(1, 3);
    expect(lineOf(removed, 1)).toEqual({ 1: 0, 2: 1 });

    const deleted = lines(true);
    deleted.removeTask(3);
    expect(lineOf(deleted, 1)).toEqual({ 1: 0, 2: 1 });

    const callout = lines(true);
    callout.moveEntry(1, 3, { placement: "above" });
    expect(lineOf(callout, 1)).toEqual({ 1: 0, 2: 1, 3: undefined });
  });

  it("keeps a newly inserted line, and the order of the others", () => {
    const m = lines(true);
    // Task 2 to a new line at the top: lines shift down, then line 2 (where it was) is empty and closes.
    m.moveEntry(1, 2, { line: 0, newLine: true });
    expect(lineOf(m, 1)).toEqual({ 2: 0, 1: 1, 3: 2 });
  });

  it("closes gaps from loaded data on a timeline once something on it changes", () => {
    const data = sample();
    data.view.compact_lines = true;
    data.timelines[0].entries = [
      { task: 1, line: 0 },
      { task: 3, line: 4 },
      { task: 2, callout_offset: { x: 0, y: 16 } },
    ];
    const m = TimelineModel.fromData(data);
    expect(lineOf(m, 1)).toEqual({ 1: 0, 3: 4, 2: undefined }); // loaded as is
    m.moveEntry(1, 2, { placement: "below", calloutOffset: { x: 5, y: 20 } });
    expect(lineOf(m, 1)).toEqual({ 1: 0, 3: 1, 2: undefined });
  });

  it("is part of the data format, and must be true or false", () => {
    expect(lines(true).toData().view.compact_lines).toBe(true);
    expect(lines().toData().view.compact_lines).toBe(false);
    const bad = sample();
    (bad.view as { compact_lines?: unknown }).compact_lines = "yes";
    expect(() => TimelineModel.fromData(bad)).toThrow(/compact_lines must be true or false/);
  });
});
