/**
 * Public data format: what `parse()` accepts, what `serialize()` returns and
 * what the REST API exchanges. Uses snake_case (see CLAUDE.md, Conventions).
 */

export type Id = string | number;
export type Placement = "above" | "on" | "below";
export type Scale = "hour" | "day" | "week" | "month" | "year";
export type MilestoneSymbol = "diamond" | "circle" | "square" | "triangle" | "star";
export type NamePosition = "left" | "right";

/**
 * Callout label position, in px, relative to the attachment point on the
 * bar's edge: the middle of a task's span, or a milestone's date. `x` is to
 * the label's left edge. `y` is to the label's edge nearest the bar, and
 * also picks the side: `y > 0` is below the bar, `y ≤ 0` above it.
 */
export interface Offset {
  /** Px from the attachment point to the label's left edge. */
  x: number;
  y: number;
}

export interface ViewData {
  /** Needed when a REST backend is configured. */
  id?: Id;
  /** Shown as a heading above the timelines. Empty for no heading. */
  name: string;
  /**
   * `false` (default): each timeline's bar fills the full width, scaled to its
   * own dates. `true`: all timelines share one time axis, from the earliest
   * start to the latest finish, and each bar is drawn at its offset and width
   * on it, so the same date lines up across timelines.
   */
  absolute?: boolean;
  /** Unit of the time scale. Default: `day`. */
  scale?: Scale;
  /** Side of each timeline the name label is shown on. Default: `left`. */
  name_position?: NamePosition;
  /** Symbol used for milestones. Default: `diamond`. */
  milestone_symbol?: MilestoneSymbol;
  /** Show each timeline's start and finish dates, with "Start" and "Finish" captions, beside its bar. Default: `true`. */
  show_dates?: boolean;
  /**
   * Clicking a task or timeline selects and highlights it, and fires
   * `onTaskSelected` / `onTimelineSelected`. Default: `true`.
   */
  selection?: boolean;
}

/**
 * A task's finish is `start_date + duration`, or given as `finish_date`
 * (one or the other, not both). Dates are ISO 8601: `YYYY-MM-DD`,
 * `YYYY-MM-DDTHH:mm`, or a full timestamp such as `2026-04-01T09:30:00Z` or
 * `2026-04-01T09:30:00+02:00`. Times with a zone are converted to UTC;
 * times without one are read as UTC.
 */
export interface TaskData {
  id: Id;
  text: string;
  start_date: string;
  /** A whole number plus `h`, `d`, `w`, `m` or `y`. Missing or zero (and no `finish_date`) means milestone. */
  duration?: string;
  /** The finish date, instead of a `duration`. Not before `start_date`; equal to it means milestone. */
  finish_date?: string;
  /** Overrides the view's `milestone_symbol` for this task. */
  symbol?: MilestoneSymbol;
  /**
   * Any CSS color, such as `"#0a7f5a"` or `"rebeccapurple"`. Overrides the
   * theme's `--tlv-task` (bars) or `--tlv-milestone` (symbols) for this task,
   * on the bar and on its callout's edge marker.
   */
  color?: string;
}

/**
 * Where a task appears on a timeline. The area follows from the fields:
 * - no `callout_offset`: on the bar, on bar `line` (default 0);
 * - `callout_offset` with `y > 0`: a callout below the bar;
 * - `callout_offset` with `y ≤ 0`: a callout above the bar.
 */
export interface TaskEntryData {
  task: Id;
  /** 0-based bar line, for an entry on the bar. Default: 0. Not allowed with `callout_offset`. */
  line?: number;
  /** Makes the entry a callout, and places its label (see `Offset`). */
  callout_offset?: Offset;
}

/** Shows a (non-global) marker on this timeline. */
export interface MarkerEntryData {
  marker: Id;
}

/** An entry is a task on the timeline, or a marker shown on it. */
export type EntryData = TaskEntryData | MarkerEntryData;

/**
 * A date marker: a vertical line at `date` across the bars of the timelines
 * that show it, with a label at its top or bottom end.
 */
export interface MarkerData {
  id: Id;
  text: string;
  /** ISO 8601, as for task dates. */
  date: string;
  /** `true`: shown on every timeline. `false` (default): only on timelines with a `{ marker: id }` entry. */
  global?: boolean;
  /** Any CSS color. Default: the theme's `--tlv-marker` (red). */
  color?: string;
  /**
   * Places the label, like `callout_offset`: px from the line's end on the
   * bar's edge to the label. `y ≤ 0`: above the topmost bar; `y > 0`: below
   * the bottommost. Default: `{ x: 0, y: -16 }`.
   */
  marker_offset?: Offset;
}

export interface TimelineData {
  id: Id;
  name: string;
  /** The timeline's time range. ISO 8601, as for task dates. */
  start_date: string;
  finish_date: string;
  entries: EntryData[];
}

export interface TimelineViewData {
  /** Server version, used for optimistic concurrency with the REST API. */
  version?: number;
  view: ViewData;
  tasks: TaskData[];
  timelines: TimelineData[];
  /** Date markers. Optional. */
  markers?: MarkerData[];
}

/** Body of `PATCH .../entries/{task_id}`, minus `version`. Send only what changes. */
export interface MovePatchData {
  timeline_id?: Id;
  placement?: Placement;
  line?: number;
  /** With placement `on`: insert a new bar line at `line` (0 to one past the last line); lines from there down shift by one. */
  new_line?: boolean;
  callout_offset?: Offset;
}

/**
 * A spot in the view where an entry can go: what `targetAt()` returns, and
 * what `addEntry()` and `highlightTarget()` take.
 */
export interface EntryTargetData {
  timeline_id: Id;
  /** The area. For `addEntry` it may be left out: a `callout_offset` then makes a callout, otherwise the entry goes on the bar. */
  placement?: Placement;
  /** Bar line, with placement `on`. */
  line?: number;
  /** With placement `on`: insert a new bar line at `line` (the half line above the first or below the last). */
  new_line?: boolean;
  /** Callout label position, with placement `above` or `below`. */
  callout_offset?: Offset;
}

/** Response of a successful move. */
export interface MoveResultData {
  version: number;
  timelines: TimelineData[];
}
