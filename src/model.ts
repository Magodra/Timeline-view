import { dateToData, parseDate } from "./dates";
import { addDuration, isMilestoneDuration, parseDuration } from "./duration";
import type {
  EntryData,
  MarkerData,
  TaskEntryData,
  Id,
  MilestoneSymbol,
  MovePatchData,
  NamePosition,
  Offset,
  Placement,
  Scale,
  TaskData,
  TimelineData,
  TimelineViewData,
} from "./types";

/* Internal model: camelCase, parsed dates. Converted from and to the public format. */

export interface View {
  id?: Id;
  name: string;
  absolute: boolean;
  scale: Scale;
  namePosition: NamePosition;
  milestoneSymbol: MilestoneSymbol;
  showDates: boolean;
  /** Whether clicks select tasks and timelines. */
  selection: boolean;
}

export interface Task {
  id: Id;
  text: string;
  start: Date;
  /** `start + duration`, or the given `finish_date`; equal to `start` for milestones. */
  finish: Date;
  duration?: string;
  /** The finish was given as `finish_date` (written back that way), not derived from a duration. */
  finishGiven: boolean;
  isMilestone: boolean;
  symbol?: MilestoneSymbol;
  /** CSS color overriding the theme's task or milestone color. */
  color?: string;
}

export interface Marker {
  id: Id;
  text: string;
  date: Date;
  global: boolean;
  color?: string;
  /** Label position; `y ≤ 0` above the topmost bar, `y > 0` below the bottommost. */
  offset: Offset;
}

export type Entry =
  | { taskId: Id; placement: "on"; line: number }
  | { taskId: Id; placement: "above" | "below"; calloutOffset: Offset };

export interface Timeline {
  id: Id;
  name: string;
  start: Date;
  finish: Date;
  entries: Entry[];
  /** Ids of the (non-global) markers shown on this timeline. */
  markers: Id[];
}

export interface MovePatch {
  timelineId?: Id;
  placement?: Placement;
  line?: number;
  newLine?: boolean;
  calloutOffset?: Offset;
}

/** Where `addEntry` puts a task: a timeline, and optionally the move fields for the spot on it. */
export interface AddTarget {
  timelineId: Id;
  placement?: Placement;
  line?: number;
  newLine?: boolean;
  calloutOffset?: Offset;
}

export interface AddResult {
  task: Task;
  /** The task was new and has been added to the tasks. */
  created: boolean;
  /** The timeline the entry was added to, after trimming. */
  timeline: Timeline;
}

/** Mirrors the REST status codes, so a local move fails the same way a server move would. */
export type MoveErrorCode = "not_found" | "conflict" | "invalid";

export class MoveError extends Error {
  constructor(
    readonly code: MoveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MoveError";
  }
}

/** Default distance, in px, between the bar and a callout label without an offset. */
export const DEFAULT_CALLOUT_GAP = 16;

const PLACEMENTS: readonly Placement[] = ["above", "on", "below"];
const SCALES: readonly Scale[] = ["hour", "day", "week", "month", "year"];

const sameId = (a: Id, b: Id) => String(a) === String(b);
const isLineIndex = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;
const isOffset = (o: unknown): o is Offset =>
  typeof o === "object" &&
  o !== null &&
  Number.isFinite((o as Offset).x) &&
  Number.isFinite((o as Offset).y);

export const defaultOffset = (placement: "above" | "below"): Offset => ({
  x: 0,
  y: placement === "above" ? -DEFAULT_CALLOUT_GAP : DEFAULT_CALLOUT_GAP,
});

/** Why an offset is not valid for the placement, or undefined if it is. */
function offsetProblem(o: unknown, placement: "above" | "below"): string | undefined {
  if (!isOffset(o)) return "callout_offset needs numeric x and y";
  if (placement === "above" && o.y > 0) return "callout_offset.y must be ≤ 0 above the bar";
  // y = 0 means above in the data format, so below needs y > 0.
  if (placement === "below" && o.y <= 0) return "callout_offset.y must be > 0 below the bar";
  return undefined;
}

export class TimelineModel {
  version?: number;

  private constructor(
    public view: View,
    public tasks: Task[],
    public timelines: Timeline[],
    public markers: Marker[] = [],
  ) {}

  static fromData(data: TimelineViewData): TimelineModel {
    if (!data?.view) throw new Error("Timeline data needs a `view`");
    const v = data.view;
    const scale = v.scale ?? "day";
    if (!SCALES.includes(scale)) throw new Error(`Unknown scale "${scale}"`);
    if (v.show_dates !== undefined && typeof v.show_dates !== "boolean") {
      throw new Error("view.show_dates must be true or false");
    }
    if (v.absolute !== undefined && typeof v.absolute !== "boolean") {
      throw new Error("view.absolute must be true or false");
    }
    if (v.selection !== undefined && typeof v.selection !== "boolean") {
      throw new Error("view.selection must be true or false");
    }

    const view: View = {
      id: v.id,
      name: v.name ?? "",
      absolute: v.absolute ?? false,
      scale,
      namePosition: v.name_position ?? "left",
      milestoneSymbol: v.milestone_symbol ?? "diamond",
      showDates: v.show_dates ?? true,
      selection: v.selection ?? true,
    };

    const tasks = (data.tasks ?? []).map(taskFromData);
    const seen = new Set<string>();
    for (const t of tasks) {
      if (seen.has(String(t.id))) throw new Error(`Duplicate task id ${t.id}`);
      seen.add(String(t.id));
    }

    const markers = (data.markers ?? []).map(markerFromData);
    const seenMarkers = new Set<string>();
    for (const mk of markers) {
      if (seenMarkers.has(String(mk.id))) throw new Error(`Duplicate marker id ${mk.id}`);
      seenMarkers.add(String(mk.id));
    }

    const model = new TimelineModel(view, tasks, [], markers);
    model.timelines = (data.timelines ?? []).map((t) => model.timelineFromData(t));
    model.version = data.version;
    return model;
  }

  toData(): TimelineViewData {
    const v = this.view;
    return {
      ...(this.version !== undefined && { version: this.version }),
      view: {
        ...(v.id !== undefined && { id: v.id }),
        name: v.name,
        absolute: v.absolute,
        scale: v.scale,
        name_position: v.namePosition,
        milestone_symbol: v.milestoneSymbol,
        show_dates: v.showDates,
        selection: v.selection,
      },
      tasks: this.tasks.map(taskToData),
      timelines: this.timelines.map(timelineToData),
      ...(this.markers.length > 0 && { markers: this.markers.map(markerToData) }),
    };
  }

  /** Converts and validates one timeline. */
  timelineFromData(t: TimelineData): Timeline {
    const start = parseDate(t.start_date);
    const finish = parseDate(t.finish_date);
    if (finish <= start) throw new Error(`Timeline ${t.id}: finish_date must be after start_date`);
    const entries: Entry[] = [];
    const markers: Id[] = [];
    for (const e of t.entries ?? []) {
      if (e !== null && typeof e === "object" && "marker" in e) {
        const marker = this.findMarker(e.marker);
        if (!marker) throw new Error(`Timeline ${t.id}: unknown marker ${e.marker}`);
        if (Object.keys(e).some((k) => k !== "marker")) {
          throw new Error(`Timeline ${t.id}: a marker entry has only \`marker\``);
        }
        if (markers.some((id) => sameId(id, marker.id))) {
          throw new Error(`Timeline ${t.id}: marker ${marker.id} appears more than once`);
        }
        markers.push(marker.id);
      } else {
        entries.push(this.entryFromData(t.id, e));
      }
    }
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(String(e.taskId))) {
        throw new Error(`Timeline ${t.id}: task ${e.taskId} appears more than once`);
      }
      seen.add(String(e.taskId));
    }
    return { id: t.id, name: t.name ?? "", start, finish, entries, markers };
  }

  private entryFromData(timelineId: Id, e: TaskEntryData): Entry {
    const where = `Timeline ${timelineId}, task ${e.task}`;
    if (!this.findTask(e.task)) throw new Error(`${where}: unknown task`);

    // No callout_offset: on the bar, line 0 unless given.
    if (e.callout_offset === undefined) {
      const line = e.line ?? 0;
      if (!isLineIndex(line)) throw new Error(`${where}: line must be a whole number ≥ 0`);
      return { taskId: e.task, placement: "on", line };
    }

    // A callout: y > 0 is below the bar, y ≤ 0 above it.
    if (e.line !== undefined) throw new Error(`${where}: a callout (with callout_offset) has no line`);
    const offset = e.callout_offset;
    if (!isOffset(offset)) throw new Error(`${where}: callout_offset needs numeric x and y`);
    const placement = offset.y > 0 ? "below" : "above";
    return { taskId: e.task, placement, calloutOffset: { x: offset.x, y: offset.y === 0 ? 0 : offset.y } };
  }

  findTask(id: Id): Task | undefined {
    return this.tasks.find((t) => sameId(t.id, id));
  }

  /** Moves a marker's label. `y ≤ 0` puts it above the topmost bar, `y > 0` below the bottommost. */
  setMarkerOffset(id: Id, offset: Offset): Marker {
    const marker = this.findMarker(id);
    if (!marker) throw new MoveError("not_found", `Marker ${id} not found`);
    if (!isOffset(offset)) throw new MoveError("invalid", "marker_offset needs numeric x and y");
    marker.offset = { x: offset.x, y: offset.y === 0 ? 0 : offset.y };
    return marker;
  }

  findMarker(id: Id): Marker | undefined {
    return this.markers.find((mk) => sameId(mk.id, id));
  }

  findTimeline(id: Id): Timeline | undefined {
    return this.timelines.find((t) => sameId(t.id, id));
  }

  findEntry(timelineId: Id, taskId: Id): Entry | undefined {
    return this.findTimeline(timelineId)?.entries.find((e) => sameId(e.taskId, taskId));
  }

  /**
   * Moves an entry to another bar line, callout position, area or timeline.
   * `newLine` inserts a new bar line at `line`, shifting the lines from there
   * down; a `line` one past the last also opens one. Afterwards the affected
   * timelines are trimmed (see `trimLines`): a line an entry leaves stays as
   * an empty gap only between used lines.
   *
   * Returns the timelines the move changed (source first).
   */
  moveEntry(timelineId: Id, taskId: Id, patch: MovePatch): Timeline[] {
    const source = this.findTimeline(timelineId);
    if (!source) throw new MoveError("not_found", `Timeline ${timelineId} not found`);
    const index = source.entries.findIndex((e) => sameId(e.taskId, taskId));
    if (index < 0) throw new MoveError("not_found", `Task ${taskId} is not on timeline ${timelineId}`);
    const entry = source.entries[index];

    const target = patch.timelineId === undefined ? source : this.findTimeline(patch.timelineId);
    if (!target) throw new MoveError("not_found", `Timeline ${patch.timelineId} not found`);
    if (target !== source && target.entries.some((e) => sameId(e.taskId, taskId))) {
      throw new MoveError("conflict", `Task ${taskId} is already on timeline ${target.id}`);
    }

    const placement = patch.placement ?? entry.placement;
    const moved = placeEntry(target, entry.taskId, placement, patch, {
      line: target === source && entry.placement === "on" ? entry.line : 0,
      offset: (side) => keptOffset(entry, side),
    });

    if (target === source) {
      source.entries[index] = moved;
    } else {
      source.entries.splice(index, 1);
      target.entries.push(moved);
    }
    trimLines(source);
    if (target !== source) trimLines(target);
    return target === source ? [source] : [source, target];
  }

  /**
   * Adds a task to a timeline, as a drop from outside the view does. `task` is
   * the id of a task the view already has, or a new task's data, which is
   * validated and added to the tasks. The target follows the move rules:
   * without `placement`, a `calloutOffset` makes a callout (side from its
   * `y`), otherwise the entry goes on the bar, on `line` (default 0);
   * `newLine` inserts a line there. A callout without an offset gets the
   * default one. Nothing changes if it throws.
   */
  addEntry(task: Id | TaskData, target: AddTarget): AddResult {
    const timeline = this.findTimeline(target.timelineId);
    if (!timeline) throw new MoveError("not_found", `Timeline ${target.timelineId} not found`);

    let found: Task | undefined;
    let created = false;
    if (typeof task === "object" && task !== null) {
      if (this.findTask(task.id)) throw new MoveError("conflict", `Task ${task.id} already exists; add it by its id`);
      try {
        found = taskFromData(task);
      } catch (error) {
        throw new MoveError("invalid", error instanceof Error ? error.message : String(error));
      }
      created = true;
    } else {
      found = this.findTask(task);
      if (!found) throw new MoveError("not_found", `Task ${task} not found`);
    }
    if (timeline.entries.some((e) => sameId(e.taskId, found.id))) {
      throw new MoveError("conflict", `Task ${found.id} is already on timeline ${timeline.id}`);
    }

    const offset = target.calloutOffset;
    const placement = target.placement ?? (offset === undefined ? "on" : isOffset(offset) && offset.y > 0 ? "below" : "above");
    const entry = placeEntry(timeline, found.id, placement, target, { line: 0, offset: defaultOffset });
    if (created) this.tasks.push(found);
    timeline.entries.push(entry);
    trimLines(timeline);
    return { task: found, created, timeline };
  }

  /**
   * Moves a timeline `delta` places in the stack: -1 is up, 1 is down.
   * Returns false, changing nothing, if it would move past the top or bottom.
   */
  moveTimeline(id: Id, delta: number): boolean {
    const from = this.timelines.findIndex((t) => sameId(t.id, id));
    if (from < 0) throw new Error(`Timeline ${id} not found`);
    const to = from + delta;
    if (!Number.isInteger(delta) || to < 0 || to >= this.timelines.length || to === from) return false;
    const [timeline] = this.timelines.splice(from, 1);
    this.timelines.splice(to, 0, timeline);
    return true;
  }

  /**
   * Adds a timeline (validated like loaded data: dates, entries for known
   * tasks, ...) at `position` in the stack, 0-based; the bottom by default.
   * Throws a `MoveError`: `conflict` for an id in use, `invalid` otherwise.
   */
  addTimeline(data: TimelineData, position = this.timelines.length): { timeline: Timeline; position: number } {
    if (data === null || typeof data !== "object" || data.id === undefined || data.id === null) {
      throw new MoveError("invalid", "A timeline needs an id");
    }
    if (this.findTimeline(data.id)) throw new MoveError("conflict", `Timeline ${data.id} already exists`);
    if (!Number.isInteger(position) || position < 0 || position > this.timelines.length) {
      throw new MoveError("invalid", `position must be a whole number from 0 to ${this.timelines.length}`);
    }
    let timeline: Timeline;
    try {
      timeline = this.timelineFromData({ ...data, entries: data.entries ?? [] });
    } catch (error) {
      throw new MoveError("invalid", error instanceof Error ? error.message : String(error));
    }
    trimLines(timeline);
    this.timelines.splice(position, 0, timeline);
    return { timeline, position };
  }

  /**
   * Puts a timeline at `position` in the stack (0-based), as the REST API's
   * timeline PATCH does. Throws a `MoveError` for an unknown id or a position
   * out of range. Returns false if it is already there.
   */
  setTimelinePosition(id: Id, position: number): boolean {
    const from = this.timelines.findIndex((t) => sameId(t.id, id));
    if (from < 0) throw new MoveError("not_found", `Timeline ${id} not found`);
    if (!Number.isInteger(position) || position < 0 || position >= this.timelines.length) {
      throw new MoveError("invalid", `position must be a whole number from 0 to ${this.timelines.length - 1}`);
    }
    if (position === from) return false;
    const [timeline] = this.timelines.splice(from, 1);
    this.timelines.splice(position, 0, timeline);
    return true;
  }

  /** Sets the view's name (the heading; "" for none). Returns the old name. */
  renameView(name: string): string {
    if (typeof name !== "string") throw new MoveError("invalid", "name must be a string");
    const old = this.view.name;
    this.view.name = name;
    return old;
  }

  /** Sets a timeline's name. Returns the timeline and its old name. */
  renameTimeline(id: Id, name: string): { timeline: Timeline; old: string } {
    const timeline = this.findTimeline(id);
    if (!timeline) throw new MoveError("not_found", `Timeline ${id} not found`);
    if (typeof name !== "string") throw new MoveError("invalid", "name must be a string");
    const old = timeline.name;
    timeline.name = name;
    return { timeline, old };
  }

  /**
   * Removes a task and its entries on every timeline, then trims those
   * timelines' lines. Returns the task and the timelines it was on.
   */
  removeTask(id: Id): { task: Task; timelines: Timeline[] } {
    const index = this.tasks.findIndex((t) => sameId(t.id, id));
    if (index < 0) throw new MoveError("not_found", `Task ${id} not found`);
    const [task] = this.tasks.splice(index, 1);
    const timelines: Timeline[] = [];
    for (const timeline of this.timelines) {
      const kept = timeline.entries.filter((e) => !sameId(e.taskId, task.id));
      if (kept.length === timeline.entries.length) continue;
      timeline.entries = kept;
      trimLines(timeline);
      timelines.push(timeline);
    }
    return { task, timelines };
  }

  /**
   * Removes a timeline with its entries. Its tasks stay, also those on no
   * other timeline. Returns the timeline and the position it had (0-based).
   */
  removeTimeline(id: Id): { timeline: Timeline; index: number } {
    const index = this.timelines.findIndex((t) => sameId(t.id, id));
    if (index < 0) throw new MoveError("not_found", `Timeline ${id} not found`);
    const [timeline] = this.timelines.splice(index, 1);
    return { timeline, index };
  }

  /** Replaces whole timelines, as returned by a successful REST move. */
  replaceTimelines(data: TimelineData[]): void {
    for (const t of data) {
      const next = this.timelineFromData(t);
      const i = this.timelines.findIndex((x) => sameId(x.id, t.id));
      if (i >= 0) this.timelines[i] = next;
      else this.timelines.push(next);
    }
  }
}

/**
 * The placement rules shared by moves and adds: validates `patch` for an
 * entry of `taskId` going to `placement` on `target`, opens a new line if
 * asked, and returns the entry (not yet inserted). `defaults` give the line
 * and callout offset when the patch leaves them out. Throws before changing
 * anything if the patch is invalid.
 */
function placeEntry(
  target: Timeline,
  taskId: Id,
  placement: Placement,
  patch: Omit<MovePatch, "timelineId">,
  defaults: { line: number; offset: (placement: "above" | "below") => Offset },
): Entry {
  if (!PLACEMENTS.includes(placement)) {
    throw new MoveError("invalid", `Unknown placement "${placement}"`);
  }
  if (placement === "on") {
    if (patch.calloutOffset !== undefined) {
      throw new MoveError("invalid", "callout_offset is only valid above or below the bar");
    }
    const line = patch.line ?? defaults.line;
    if (!isLineIndex(line)) throw new MoveError("invalid", "line must be a whole number ≥ 0");
    const count = lineCount(target);
    if (line > count) {
      throw new MoveError("invalid", `line ${line} is past the bar's last line + 1 (${count})`);
    }
    if (patch.newLine !== undefined && typeof patch.newLine !== "boolean") {
      throw new MoveError("invalid", "new_line must be true or false");
    }
    if (patch.newLine) {
      for (const e of target.entries) if (e.placement === "on" && e.line >= line) e.line++;
    }
    return { taskId, placement, line };
  }
  if (patch.line !== undefined || patch.newLine !== undefined) {
    throw new MoveError("invalid", "callouts have no line; use callout_offset");
  }
  const offset = patch.calloutOffset ?? defaults.offset(placement);
  const problem = offsetProblem(offset, placement);
  if (problem) throw new MoveError("invalid", problem);
  return { taskId, placement, calloutOffset: { x: offset.x, y: offset.y === 0 ? 0 : offset.y } };
}

/**
 * The offset a callout gets when a move doesn't give one: unchanged on the
 * same side, mirrored across the bar when it changes side, the default when
 * it comes from the bar.
 */
function keptOffset(entry: Entry, placement: "above" | "below"): Offset {
  if (entry.placement === "on") return defaultOffset(placement);
  const { x, y } = entry.calloutOffset;
  if (entry.placement === placement) return { x, y };
  // Mirrored. A label flush above the bar (y = 0) goes 1 px below it, since y = 0 means above.
  return { x, y: placement === "below" ? Math.max(1, -y) : -y };
}

/**
 * The time axis the view draws on: from the earliest timeline start to the
 * latest finish. With `absolute`, every bar is placed on this axis.
 */
export function viewRange(model: TimelineModel): { start: Date; finish: Date } | undefined {
  if (model.timelines.length === 0) return undefined;
  let start = model.timelines[0].start;
  let finish = model.timelines[0].finish;
  for (const t of model.timelines) {
    if (t.start < start) start = t.start;
    if (t.finish > finish) finish = t.finish;
  }
  return { start, finish };
}

/** The lowest `line` the bar entries use; 0 when there are none. */
export function firstLine(timeline: Timeline): number {
  const used = timeline.entries.flatMap((e) => (e.placement === "on" ? [e.line] : []));
  return used.length ? Math.min(...used) : 0;
}

/**
 * Removes blank bar lines above the first used one by renumbering the
 * entries so the first used line is 0. Blank lines below the last used one
 * need no trimming: `lineCount` doesn't count them. Gaps between used lines stay.
 */
export function trimLines(timeline: Timeline): void {
  const first = firstLine(timeline);
  if (first === 0) return;
  for (const e of timeline.entries) if (e.placement === "on") e.line -= first;
}

/**
 * Number of bar lines, counted from line 0: one more than the highest `line`
 * the entries use, at least 1. It is never stored.
 */
export function lineCount(timeline: Timeline): number {
  let count = 1;
  for (const e of timeline.entries) if (e.placement === "on") count = Math.max(count, e.line + 1);
  return count;
}

/**
 * Whether `value` is a CSS color. Uses the browser's own check where there is
 * one; elsewhere (a JavaScript backend) accepts any non-empty string without
 * characters that could end a CSS value.
 */
function isColor(value: string): boolean {
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") return CSS.supports("color", value);
  return value.trim() !== "" && !/[;{}]/.test(value);
}

/** Default label position for a marker: just above the topmost bar. */
const DEFAULT_MARKER_OFFSET: Offset = { x: 0, y: -DEFAULT_CALLOUT_GAP };

function markerFromData(mk: MarkerData): Marker {
  if (mk?.id === undefined || mk.id === null) throw new Error("Every marker needs an id");
  const where = `Marker ${mk.id}`;
  if (mk.global !== undefined && typeof mk.global !== "boolean") throw new Error(`${where}: global must be true or false`);
  if (mk.color !== undefined && (typeof mk.color !== "string" || !isColor(mk.color))) {
    throw new Error(`${where}: color must be a CSS color`);
  }
  const offset = mk.marker_offset ?? DEFAULT_MARKER_OFFSET;
  if (!isOffset(offset)) throw new Error(`${where}: marker_offset needs numeric x and y`);
  return {
    id: mk.id,
    text: mk.text ?? "",
    date: parseDate(mk.date),
    global: mk.global ?? false,
    color: mk.color,
    offset: { x: offset.x, y: offset.y === 0 ? 0 : offset.y },
  };
}

function markerToData(mk: Marker): MarkerData {
  return {
    id: mk.id,
    text: mk.text,
    date: dateToData(mk.date),
    ...(mk.global && { global: true }),
    ...(mk.color !== undefined && { color: mk.color }),
    marker_offset: { ...mk.offset },
  };
}

export function taskFromData(t: TaskData): Task {
  if (t.id === undefined || t.id === null) throw new Error("Every task needs an id");
  const start = parseDate(t.start_date);
  if (t.color !== undefined && (typeof t.color !== "string" || !isColor(t.color))) {
    throw new Error(`Task ${t.id}: color must be a CSS color`);
  }
  // The finish is given as finish_date, or derived from the duration; not both.
  let finish: Date;
  const finishGiven = t.finish_date !== undefined;
  if (finishGiven) {
    if (t.duration !== undefined) throw new Error(`Task ${t.id}: give duration or finish_date, not both`);
    finish = parseDate(t.finish_date!);
    if (finish < start) throw new Error(`Task ${t.id}: finish_date is before start_date`);
  } else {
    finish = isMilestoneDuration(t.duration) ? start : addDuration(start, parseDuration(t.duration!));
  }
  return {
    id: t.id,
    text: t.text ?? "",
    start,
    finish,
    duration: t.duration,
    finishGiven,
    isMilestone: finish.getTime() === start.getTime(),
    symbol: t.symbol,
    color: t.color,
  };
}

export function taskToData(t: Task): TaskData {
  return {
    id: t.id,
    text: t.text,
    start_date: dateToData(t.start),
    ...(t.duration !== undefined && { duration: t.duration }),
    ...(t.finishGiven && { finish_date: dateToData(t.finish) }),
    ...(t.symbol !== undefined && { symbol: t.symbol }),
    ...(t.color !== undefined && { color: t.color }),
  };
}

export function timelineToData(t: Timeline): TimelineData {
  return {
    id: t.id,
    name: t.name,
    start_date: dateToData(t.start),
    finish_date: dateToData(t.finish),
    entries: [
      ...t.entries.map((e): EntryData =>
        e.placement === "on"
          ? { task: e.taskId, line: e.line }
          : { task: e.taskId, callout_offset: { ...e.calloutOffset } },
      ),
      ...t.markers.map((marker): EntryData => ({ marker })),
    ],
  };
}

/** Converts a public move body to the internal form. */
export function patchFromData(p: MovePatchData): MovePatch {
  return {
    ...(p.timeline_id !== undefined && { timelineId: p.timeline_id }),
    ...(p.placement !== undefined && { placement: p.placement }),
    ...(p.line !== undefined && { line: p.line }),
    ...(p.new_line !== undefined && { newLine: p.new_line }),
    ...(p.callout_offset !== undefined && { calloutOffset: p.callout_offset }),
  };
}
