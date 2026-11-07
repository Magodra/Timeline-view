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
 * the label's left edge. `y` is to the label's edge nearest the bar: ≤ 0
 * above the bar, ≥ 0 below it.
 */
export interface Offset {
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
}

/** A task's finish date is not stored: it is `start_date + duration`. */
export interface TaskData {
  id: Id;
  text: string;
  start_date: string;
  /** A whole number plus `h`, `d`, `w`, `m` or `y`. Missing or zero means milestone. */
  duration?: string;
  /** Overrides the view's `milestone_symbol` for this task. */
  symbol?: MilestoneSymbol;
}

export interface EntryData {
  task: Id;
  placement: Placement;
  /** 0-based bar line. Only for `on`: callout areas have no lines. */
  line?: number;
  /** Only for `above` and `below`. Defaults to a small gap from the bar. */
  callout_offset?: Offset;
}

export interface TimelineData {
  id: Id;
  name: string;
  /** The timeline's time range. ISO 8601: `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. */
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

/** Response of a successful move. */
export interface MoveResultData {
  version: number;
  timelines: TimelineData[];
}
