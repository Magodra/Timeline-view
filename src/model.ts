import { formatDate, parseDate } from "./dates";
import { addDuration, isMilestoneDuration, parseDuration } from "./duration";
import type {
  EntryData,
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
}

export interface Task {
  id: Id;
  text: string;
  start: Date;
  /** `start + duration`; equal to `start` for milestones. */
  finish: Date;
  duration?: string;
  isMilestone: boolean;
  symbol?: MilestoneSymbol;
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
}

export interface MovePatch {
  timelineId?: Id;
  placement?: Placement;
  line?: number;
  newLine?: boolean;
  calloutOffset?: Offset;
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
  if (placement === "below" && o.y < 0) return "callout_offset.y must be ≥ 0 below the bar";
  return undefined;
}

export class TimelineModel {
  version?: number;

  private constructor(
    public view: View,
    public tasks: Task[],
    public timelines: Timeline[],
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

    const view: View = {
      id: v.id,
      name: v.name ?? "",
      absolute: v.absolute ?? false,
      scale,
      namePosition: v.name_position ?? "left",
      milestoneSymbol: v.milestone_symbol ?? "diamond",
      showDates: v.show_dates ?? true,
    };

    const tasks = (data.tasks ?? []).map(taskFromData);
    const seen = new Set<string>();
    for (const t of tasks) {
      if (seen.has(String(t.id))) throw new Error(`Duplicate task id ${t.id}`);
      seen.add(String(t.id));
    }

    const model = new TimelineModel(view, tasks, []);
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
      },
      tasks: this.tasks.map(taskToData),
      timelines: this.timelines.map(timelineToData),
    };
  }

  /** Converts and validates one timeline. */
  timelineFromData(t: TimelineData): Timeline {
    const start = parseDate(t.start_date);
    const finish = parseDate(t.finish_date);
    if (finish <= start) throw new Error(`Timeline ${t.id}: finish_date must be after start_date`);
    const entries = (t.entries ?? []).map((e) => this.entryFromData(t.id, e));
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(String(e.taskId))) {
        throw new Error(`Timeline ${t.id}: task ${e.taskId} appears more than once`);
      }
      seen.add(String(e.taskId));
    }
    return { id: t.id, name: t.name ?? "", start, finish, entries };
  }

  private entryFromData(timelineId: Id, e: EntryData): Entry {
    const where = `Timeline ${timelineId}, task ${e.task}`;
    if (!this.findTask(e.task)) throw new Error(`${where}: unknown task`);
    if (!PLACEMENTS.includes(e.placement)) throw new Error(`${where}: unknown placement`);

    if (e.placement === "on") {
      if (!isLineIndex(e.line)) throw new Error(`${where}: line must be a whole number ≥ 0`);
      if (e.callout_offset !== undefined) {
        throw new Error(`${where}: callout_offset is only valid above or below the bar`);
      }
      return { taskId: e.task, placement: "on", line: e.line };
    }

    if (e.line !== undefined) throw new Error(`${where}: callouts have no line, only callout_offset`);
    const offset = e.callout_offset ?? defaultOffset(e.placement);
    const problem = offsetProblem(offset, e.placement);
    if (problem) throw new Error(`${where}: ${problem}`);
    return { taskId: e.task, placement: e.placement, calloutOffset: { x: offset.x, y: offset.y } };
  }

  findTask(id: Id): Task | undefined {
    return this.tasks.find((t) => sameId(t.id, id));
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
    if (!PLACEMENTS.includes(placement)) {
      throw new MoveError("invalid", `Unknown placement "${placement}"`);
    }

    let moved: Entry;
    if (placement === "on") {
      if (patch.calloutOffset !== undefined) {
        throw new MoveError("invalid", "callout_offset is only valid above or below the bar");
      }
      const line = patch.line ?? (target === source && entry.placement === "on" ? entry.line : 0);
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
      moved = { taskId: entry.taskId, placement, line };
    } else {
      if (patch.line !== undefined || patch.newLine !== undefined) {
        throw new MoveError("invalid", "callouts have no line; use callout_offset");
      }
      const offset = patch.calloutOffset ?? keptOffset(entry, placement);
      const problem = offsetProblem(offset, placement);
      if (problem) throw new MoveError("invalid", problem);
      moved = { taskId: entry.taskId, placement, calloutOffset: { x: offset.x, y: offset.y } };
    }

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
 * The offset a callout gets when a move doesn't give one: unchanged on the
 * same side, mirrored across the bar when it changes side, the default when
 * it comes from the bar.
 */
function keptOffset(entry: Entry, placement: "above" | "below"): Offset {
  if (entry.placement === "on") return defaultOffset(placement);
  const { x, y } = entry.calloutOffset;
  return entry.placement === placement ? { x, y } : { x, y: -y };
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

function taskFromData(t: TaskData): Task {
  if (t.id === undefined || t.id === null) throw new Error("Every task needs an id");
  const start = parseDate(t.start_date);
  const isMilestone = isMilestoneDuration(t.duration);
  return {
    id: t.id,
    text: t.text ?? "",
    start,
    finish: isMilestone ? start : addDuration(start, parseDuration(t.duration!)),
    duration: t.duration,
    isMilestone,
    symbol: t.symbol,
  };
}

function taskToData(t: Task): TaskData {
  return {
    id: t.id,
    text: t.text,
    start_date: formatDate(t.start),
    ...(t.duration !== undefined && { duration: t.duration }),
    ...(t.symbol !== undefined && { symbol: t.symbol }),
  };
}

export function timelineToData(t: Timeline): TimelineData {
  return {
    id: t.id,
    name: t.name,
    start_date: formatDate(t.start),
    finish_date: formatDate(t.finish),
    entries: t.entries.map((e) =>
      e.placement === "on"
        ? { task: e.taskId, placement: e.placement, line: e.line }
        : { task: e.taskId, placement: e.placement, callout_offset: { ...e.calloutOffset } },
    ),
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
