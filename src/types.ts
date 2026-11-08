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
   * Close up empty bar lines: when a change (a move, or removing an entry or
   * task) leaves a line empty, the lines below it move up. Default: `false`,
   * where empty lines between used ones stay as gaps.
   */
  compact_lines?: boolean;
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
  /** Any other attributes are the host's own: kept with the task, returned by `serialize()`, and passed to task layers. */
  [custom: string]: unknown;
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
  /** `false` pins the entry: the user can't drag it (it can still be clicked, and moved from code). Default: `true`. */
  draggable?: boolean;
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
  /** `false` pins the label: the user can't drag it. Default: `true`. */
  draggable?: boolean;
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

/** Where a date span sits on a timeline's bar: what `getTaskPosition` returns. CSS pixels, relative to the bar's task area. */
export interface TaskPosition {
  /** CSS `left`: from the area's left edge to the start of the span. */
  left: number;
  /** CSS `right`: from the end of the span to the area's right edge. */
  right: number;
  /** CSS `top`: from the area's top edge to the task's line (the first line for a callout). */
  top: number;
  /** CSS `height` of a bar line. */
  height: number;
  /** From the first date to the second; 0 for a milestone. */
  width: number;
}

/** Where a callout's marker sits on the bar's edge: what `getCalloutPosition` returns. CSS pixels, relative to the callout area (`.tlv-area`, where callout layers are placed). */
export interface CalloutPosition extends TaskPosition {
  /** Which side of the bar the callout is on. */
  placement: "above" | "below";
}

/** The templates that give an element's content instead of its default text. */
export type ContentTemplate = "task_text" | "milestone_text" | "callout_text" | "marker_text";
/** Which kind of item a tooltip is for. */
export type TooltipKind = "task" | "milestone" | "callout" | "marker";

/** A class template for something showing a task: its start and finish, and the task's data with any custom attributes. */
export type TaskClassTemplate = (start: Date, end: Date, task: TaskData) => string;
/** A class template for part of a timeline: the timeline's range and its data. */
export type TimelineClassTemplate = (start: Date, end: Date, timeline: TimelineData) => string;

/**
 * Functions for the view's elements: `timeline.templates` or `view.templates`.
 * The `*_class` ones return extra CSS classes (one or several, space separated;
 * "" for none), and the `*_text` ones an element's content.
 * They run on every draw; set them before `parse()`, or call `render()` after.
 */
export interface TimelineTemplates {
  /**
   * The content of a task's bar (`.tlv-task-label`): an HTML string, or a DOM
   * node. Default: the task's text. A string is inserted as HTML, so escape
   * anything that isn't trusted (`escapeHtml`). `entry` is the task's entry
   * on the timeline being drawn, for example to see if it is pinned.
   */
  task_text?: (start: Date, end: Date, task: TaskData, entry: TaskEntryData) => string | Node;
  /** The content of a milestone's label (`.tlv-milestone-label`), as `task_text`. */
  milestone_text?: (start: Date, end: Date, task: TaskData, entry: TaskEntryData) => string | Node;
  /** The content of a callout's label, in place of its name and dates, as `task_text`. */
  callout_text?: (start: Date, end: Date, task: TaskData, entry: TaskEntryData) => string | Node;
  /** The content of a marker's label, in place of its text and date, as `task_text`. `start` and `end` are its date. */
  marker_text?: (start: Date, end: Date, marker: MarkerData) => string | Node;
  /**
   * The tooltip of a task bar, milestone, callout or marker label: an HTML
   * string or a DOM node (as `task_text`, so escape untrusted text), or `""`
   * or `null` for none. With this or `tooltip_class` set, the view draws its
   * own tooltip (`.tlv-tooltip`) instead of the browser's.
   */
  tooltip_text?: (start: Date, end: Date, item: TaskData | MarkerData, kind: TooltipKind) => string | Node | null;
  /** Extra classes for the tooltip (`.tlv-tooltip`). */
  tooltip_class?: (start: Date, end: Date, item: TaskData | MarkerData, kind: TooltipKind) => string;
  /** A task's bar on a bar line (`.tlv-task`). */
  task_class?: TaskClassTemplate;
  /** The text in a task's bar (`.tlv-task-label`). */
  task_text_class?: TaskClassTemplate;
  /** A milestone on a bar line (`.tlv-milestone`). `start` and `end` are the same date. */
  milestone_class?: TaskClassTemplate;
  /** A milestone's text (`.tlv-milestone-label`). */
  milestone_text_class?: TaskClassTemplate;
  /** A callout's label (`.tlv-callout`). */
  callout_class?: TaskClassTemplate;
  /** A callout's marker on the bar's edge (`.tlv-edge-bar` or `.tlv-edge-symbol`). */
  callout_marker_class?: TaskClassTemplate;
  /** A timeline's row (`.tlv-timeline`). */
  timeline_class?: TimelineClassTemplate;
  /** A timeline's bar (`.tlv-bar`). */
  timeline_bar_class?: TimelineClassTemplate;
  /** A timeline's name label (`.tlv-name`). */
  timeline_name_class?: TimelineClassTemplate;
  /** One bar line (`.tlv-line`); `line` is its 0-based index. Not the half lines for inserting. */
  bar_line_class?: (start: Date, end: Date, timeline: TimelineData, line: number) => string;
  /** One period of the time scale (`.tlv-period`), such as a day; `start` and `end` are its limits within the timeline, in UTC. */
  scale_cell_class?: TimelineClassTemplate;
  /** A marker's line and label (`.tlv-marker-line`, `.tlv-marker-label`). `start` and `end` are its date. */
  marker_class?: (start: Date, end: Date, marker: MarkerData) => string;
}

/** Which date a `format_date` call is for. */
export type DateKind = "task_start" | "task_finish" | "milestone" | "timeline_start" | "timeline_finish" | "marker";

export interface DateFormatInfo {
  kind: DateKind;
  /**
   * The value has no time of day (`"2026-04-01"`): a calendar date, stored as
   * midnight UTC. Format it in UTC (for example `timeZone: "UTC"` with
   * `Intl.DateTimeFormat`); in a time zone west of UTC it would show the day
   * before. Values with a time are moments, fine to show in any zone.
   */
  date_only: boolean;
}

/** Formats a date for display: the `format_date` option. */
export type DateFormatter = (date: Date, info: DateFormatInfo) => string;

export interface TickFormatInfo {
  /** The view's scale: each tick starts an hour, day, ISO week, month or year. */
  scale: Scale;
  /**
   * The first tick, or one that starts a new year (month scale) or day (hour
   * scale). The default labels add the year or date to these, and they are
   * the last to be hidden when labels don't fit.
   */
  major: boolean;
}

/**
 * Formats a time-scale label: the `format_tick` option. `date` is the start
 * of the period in UTC (the scale's periods are UTC), so format it with
 * `timeZone: "UTC"` to label the right period.
 */
export type TickFormatter = (date: Date, info: TickFormatInfo) => string;

/** Body of `PATCH .../entries/{task_id}`, minus `version`. Send only what changes. */
export interface MovePatchData {
  timeline_id?: Id;
  placement?: Placement;
  line?: number;
  /** With placement `on`: insert a new bar line at `line` (0 to one past the last line); lines from there down shift by one. */
  new_line?: boolean;
  callout_offset?: Offset;
  /** Pins (`false`) or unpins (`true`) the entry. Left out, it stays as it is. */
  draggable?: boolean;
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
  /** For `addEntry`: `false` adds the entry pinned. */
  draggable?: boolean;
}

/** Where an added entry goes on its timeline: an `EntryTargetData` without `timeline_id`. */
export type AddEntryPlaceData = Omit<EntryTargetData, "timeline_id">;

/**
 * Body of `POST /views/{view_id}/timelines/{timeline_id}/entries`, minus
 * `version`: the task (the id of one the view has, or a new task's data,
 * which the server adds to the tasks) and where it goes.
 */
export interface AddEntryData extends AddEntryPlaceData {
  task: Id | TaskData;
}

/**
 * Changes to a task: the body of `PATCH /views/{view_id}/tasks/{task_id}`
 * (minus `version`) and what `updateTask` takes. Send only what changes.
 * `null` clears an optional field. The finish is given one way: setting
 * `duration` drops `finish_date` and the other way round; clearing both
 * makes the task a milestone.
 */
export interface TaskPatchData {
  /** The host's custom attributes: set to the value given, or removed with `null`. */
  [custom: string]: unknown;
  text?: string;
  start_date?: string;
  duration?: string | null;
  finish_date?: string | null;
  symbol?: MilestoneSymbol | null;
  color?: string | null;
}

/**
 * Changes to a marker: the body of `PATCH /views/{view_id}/markers/{marker_id}`
 * (minus `version`) and what `updateMarker` takes. Send only what changes;
 * `color: null` goes back to the theme's color.
 */
export interface MarkerPatchData {
  text?: string;
  date?: string;
  color?: string | null;
  global?: boolean;
  marker_offset?: Offset;
  draggable?: boolean;
}

/** Response of a successful marker add or update. */
export interface MarkerResultData {
  version: number;
  /** The marker as the server now has it. */
  marker: MarkerData;
}

/** Response of a successful task update. */
export interface TaskResultData {
  version: number;
  /** The task as the server now has it. */
  task: TaskData;
}

/** Body of `PATCH /views/{view_id}`, minus `version`. */
export interface ViewPatchData {
  name?: string;
}

/** Response of a successful `PATCH /views/{view_id}`. */
export interface ViewResultData {
  version: number;
  view: ViewData;
}

/** Body of `PATCH /views/{view_id}/timelines/{timeline_id}`, minus `version`. Send only what changes. */
export interface TimelinePatchData extends TimelineUpdateData {
  /** The timeline's 0-based index in the stack after the move. */
  position?: number;
}

/**
 * Changes to a timeline's own fields: what `updateTimeline` takes. Send only
 * what changes. The finish must stay after the start.
 */
export interface TimelineUpdateData {
  name?: string;
  start_date?: string;
  finish_date?: string;
}

/** Response of a successful timeline add, update or removal: the new version and the timelines' order. */
export interface OrderResultData {
  version: number;
  /** Every timeline's id, top to bottom. */
  order: Id[];
}

/** Response of a successful move. */
export interface MoveResultData {
  version: number;
  timelines: TimelineData[];
}
