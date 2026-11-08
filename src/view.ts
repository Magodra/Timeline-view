import { ApiError, RestClient } from "./api";
import {
  attachDrag,
  calloutOffset,
  hitTarget,
  targetElement,
  type DragSource,
  type DropEvent,
  type DropTarget,
  type MarkerDropEvent,
} from "./drag";
import {
  addTargetFromData,
  entryToData,
  markerToData,
  patchFromData,
  taskFromData,
  taskToData,
  TimelineModel,
  timelineToData,
  type Task,
} from "./model";
import { dateToData, formatDate } from "./dates";
import { label as tickLabel } from "./scale";
import { attachAt, defaultDisplay, layout, render, unwatchLayout, type Display } from "./render";
import { toSVG } from "./svg";
import type {
  AddEntryData,
  DateFormatter,
  EntryTargetData,
  Id,
  MarkerData,
  MarkerPatchData,
  MovePatchData,
  MarkerResultData,
  MoveResultData,
  Offset,
  TaskData,
  TaskEntryData,
  TaskPatchData,
  TickFormatter,
  TimelineData,
  TimelineUpdateData,
  TimelineViewData,
} from "./types";

export interface TimelineOptions extends TimelineFormatters {
  /** Base URL of the REST backend. Without it, changes are only reported through events. */
  api_url?: string;
  /** Replacement for `fetch`, mainly for tests and mock backends. */
  fetch?: typeof fetch;
}

/** How the view writes dates and time-scale labels. Leave one out for the built-in format. */
export interface TimelineFormatters {
  /**
   * Writes the dates shown on callout labels, tooltips, the Start and
   * Finish captions and marker labels. Default: `YYYY-MM-DD` (with the time
   * in UTC when there is one). See `DateFormatInfo.date_only` for dates
   * without a time.
   */
  format_date?: DateFormatter;
  /** Writes the time scale's labels ("Jan 2026", "W12", ...). Default: English, as `defaultFormatTick`. */
  format_tick?: TickFormatter;
}

/** The built-in date format: `YYYY-MM-DD`, plus `THH:mm` (UTC) when there is a time. For a formatter to fall back on. */
export const defaultFormatDate: DateFormatter = (date) => formatDate(date);

/** The built-in time-scale labels: "Jan 2026", "Feb", "W12", "14", "09:00". */
export const defaultFormatTick: TickFormatter = (date, info) => tickLabel(date, info.scale, info.major);

export interface EntryMovedEvent {
  timeline_id: Id;
  task_id: Id;
  patch: MovePatchData;
}

export interface MoveFailedEvent extends EntryMovedEvent {
  error: unknown;
}

export interface MarkerMovedEvent {
  marker_id: Id;
  marker_offset: Offset;
}

export interface MarkerAddedEvent {
  marker_id: Id;
  /** The added marker, in the data format. */
  marker: MarkerData;
}

export interface MarkerUpdatedEvent {
  marker_id: Id;
  /** The marker after the change, in the data format. */
  marker: MarkerData;
  /** The marker before it. */
  old_marker: MarkerData;
}

export interface MarkerRemovedEvent {
  marker_id: Id;
  /** The removed marker, in the data format. */
  marker: MarkerData;
  /** The timelines that had a `{ marker }` entry for it, after the removal. */
  timelines: TimelineData[];
}

/** `marker_shown` and `marker_hidden`: a marker's `{ marker }` entry was added to or removed from a timeline. */
export interface MarkerVisibilityEvent {
  timeline_id: Id;
  marker_id: Id;
  /** The timeline after the change. */
  timeline: TimelineData;
}

export interface EntryAddedEvent {
  timeline_id: Id;
  task_id: Id;
  /** The task, as the view now holds it. */
  task: TaskData;
  /** `true` when the task was new and `addEntry` added it to the view's tasks. */
  new_task: boolean;
  /** The new entry, in the data format. */
  entry: TaskEntryData;
  /** The timeline after the add, with all its entries: inserting a line renumbers the lines below it. */
  timeline: TimelineData;
}

export interface TimelineMovedEvent {
  timeline_id: Id;
  /** 0-based position in the stack before the move. */
  from_index: number;
  /** 0-based position in the stack after the move. */
  to_index: number;
  /** Every timeline's id, top to bottom, after the move. */
  order: Id[];
}

export interface TaskRemovedEvent {
  task_id: Id;
  /** The removed task's data. */
  task: TaskData;
  /** The timelines the task was on, after the removal, with all their entries (lines may be renumbered). */
  timelines: TimelineData[];
}

export interface TimelineRemovedEvent {
  timeline_id: Id;
  /** The removed timeline's data, with its entries. */
  timeline: TimelineData;
  /** Its 0-based position in the stack before the removal. */
  index: number;
  /** The remaining timelines' ids, top to bottom. */
  order: Id[];
}

export interface ViewRenamedEvent {
  name: string;
  old_name: string;
}

export interface TimelineRenamedEvent {
  timeline_id: Id;
  name: string;
  old_name: string;
}

export interface TimelineAddedEvent {
  timeline_id: Id;
  /** The added timeline, in the data format. */
  timeline: TimelineData;
  /** Its 0-based position in the stack. */
  index: number;
  /** Every timeline's id, top to bottom. */
  order: Id[];
}

export interface TaskUpdatedEvent {
  task_id: Id;
  /** The task after the change, in the data format. */
  task: TaskData;
  /** The task before it. */
  old_task: TaskData;
}

export interface EntryRemovedEvent {
  timeline_id: Id;
  task_id: Id;
  /** The removed entry, in the data format. */
  entry: TaskEntryData;
  /** The timeline after the removal, with all its entries (lines may be renumbered). */
  timeline: TimelineData;
}

export interface TimelineUpdatedEvent {
  timeline_id: Id;
  /** The timeline after the change, in the data format. */
  timeline: TimelineData;
  /** The timeline before it (same entries). */
  old_timeline: TimelineData;
}

/** `dragging_started`: what the user started dragging. */
export type DraggingEvent =
  | { kind: "entry"; timeline_id: Id; task_id: Id }
  | { kind: "marker"; marker_id: Id };

/** `dragging_ended`: the drag, and whether it was dropped on a target (false when cancelled or released on nothing). */
export type DraggingEndedEvent = DraggingEvent & { dropped: boolean };

export interface SaveFailedEvent {
  action: SaveAction;
  /** The timeline the change was for; not set for `rename_view`. */
  timeline_id?: Id;
  /** The task, for `add_entry`, `remove_entry`, `update_task` and `remove_task`. */
  task_id?: Id;
  /** The marker, for the marker actions. */
  marker_id?: Id;
  /** An `ApiError` (with `status` and `body`) for a rejected request, or the network error. */
  error: unknown;
}

export interface TimelineEvents {
  /** A move was applied on screen. Fired before the REST request, if any, is sent. */
  entry_moved: EntryMovedEvent;
  /**
   * The user started dragging an entry or a marker's label: the pointer moved
   * far enough after pressing it. A press released before that is a click.
   */
  dragging_started: DraggingEvent;
  /**
   * The drag ended: released (`dropped: true` if on a target) or cancelled
   * (Escape, a cancelled pointer, or the view destroyed). Fired after the
   * drop is applied, so after its `entry_moved` or `marker_moved`.
   */
  dragging_ended: DraggingEndedEvent;
  /** A move was rejected, locally or by the server. The view shows the restored state. */
  move_failed: MoveFailedEvent;
  /**
   * A marker's label was moved: dragged, `setMarkerOffset`, or an
   * `updateMarker` with a new `marker_offset` (which also fires
   * `marker_updated`). With a REST backend it is saved too.
   */
  marker_moved: MarkerMovedEvent;
  /** A marker was added with `addMarker`. */
  marker_added: MarkerAddedEvent;
  /** A marker was changed with `updateMarker` (or its label moved). */
  marker_updated: MarkerUpdatedEvent;
  /** A marker was removed with `removeMarker`. */
  marker_removed: MarkerRemovedEvent;
  /** A marker was shown on a timeline with `showMarker`. */
  marker_shown: MarkerVisibilityEvent;
  /** A marker was taken off a timeline with `hideMarker`. */
  marker_hidden: MarkerVisibilityEvent;
  /**
   * An entry was added with `addEntry` (for example a task dropped from a
   * list outside the view). With a REST backend it is saved too.
   */
  entry_added: EntryAddedEvent;
  /** A task was taken off a timeline with `removeEntry`. With a REST backend it is saved too. */
  entry_removed: EntryRemovedEvent;
  /**
   * A timeline was moved in the stack (`moveTimeline`, `moveTimelineUp`,
   * `moveTimelineDown`). With a REST backend the new position is saved too.
   */
  timeline_moved: TimelineMovedEvent;
  /** A task was removed with `removeTask`. With a REST backend it is saved too. */
  task_removed: TaskRemovedEvent;
  /** A task's fields were changed with `updateTask`. With a REST backend it is saved too. */
  task_updated: TaskUpdatedEvent;
  /** A timeline was removed with `removeTimeline`. With a REST backend it is saved too. */
  timeline_removed: TimelineRemovedEvent;
  /** The view's name was changed with `renameView`. With a REST backend it is saved too. */
  view_renamed: ViewRenamedEvent;
  /** A timeline's name, start or finish was changed with `updateTimeline` (or `renameTimeline`). */
  timeline_updated: TimelineUpdatedEvent;
  /** A timeline's name was changed with `renameTimeline` (or `updateTimeline`). With a REST backend it is saved too. */
  timeline_renamed: TimelineRenamedEvent;
  /** A timeline was added with `addTimeline`. */
  timeline_added: TimelineAddedEvent;
  /**
   * Saving a change to the REST backend failed: a view or timeline change
   * (rename, add, move, remove), an entry add or removal, a task update or
   * removal, or a marker change (including a moved label). The view already
   * shows the restored state: rolled back, or the server's current view
   * after a 409. Entry moves report `move_failed` instead.
   */
  save_failed: SaveFailedEvent;
}

/**
 * The view's `Display` from the host's formatters. A formatter that throws
 * or returns a non-string is logged and the built-in format is used, so a
 * bad formatter can't break rendering.
 */
function displayOf({ format_date, format_tick }: TimelineFormatters): Display {
  const safe = <A extends unknown[]>(format: ((...args: A) => string) | undefined, fallback: (...args: A) => string) =>
    format
      ? (...args: A) => {
          try {
            const text = format(...args);
            if (typeof text === "string") return text;
            console.error("timeline view: a formatter returned", text, "instead of a string");
          } catch (error) {
            console.error("timeline view: a formatter threw", error);
          }
          return fallback(...args);
        }
      : fallback;
  const date = safe(format_date, defaultFormatDate);
  const tick = safe(format_tick, defaultFormatTick);
  return {
    // A date without a time has no "T" in its data form ("2026-04-01").
    date: (value, kind) => date(value, { kind, date_only: !dateToData(value).includes("T") }),
    tick: (t, scale) => tick(t.date, { scale, major: t.major }),
  };
}

/** What a failed save was for. */
export type SaveAction =
  | "rename_view"
  | "add_timeline"
  | "rename_timeline"
  | "update_timeline"
  | "move_timeline"
  | "remove_timeline"
  | "add_entry"
  | "remove_entry"
  | "update_task"
  | "remove_task"
  | "add_marker"
  | "update_marker"
  | "remove_marker"
  | "show_marker"
  | "hide_marker";

type Handler<T> = (event: T) => void;

/**
 * Handlers for `attachEvent`. Inside a handler written as a `function`, `this`
 * is the TimelineView, with the same methods as the global `timeline`.
 */
export interface TimelineHandlers {
  /**
   * A task bar, milestone or callout label was clicked (pressed and released
   * without dragging). `id` is the task's id; `timelineId` the timeline it was
   * clicked on, since a task can appear on several.
   */
  onTaskClick: (this: TimelineView, id: Id, e: MouseEvent, timelineId: Id) => void;
  /**
   * A timeline was clicked outside its tasks: its name, bar background, time
   * scale, dates or callout areas.
   */
  onTimelineClick: (this: TimelineView, id: Id, e: MouseEvent) => void;
  /** The selected tasks changed; `ids` are all selected tasks now, empty when none are. */
  onTaskSelected: (this: TimelineView, ids: Id[]) => void;
  /** The selected timelines changed; `ids` are all selected timelines now, empty when none are. */
  onTimelineSelected: (this: TimelineView, ids: Id[]) => void;
}

export type TimelineEventName = keyof TimelineHandlers;

/** The event names `attachEvent` accepts. */
const HANDLER_NAMES: readonly TimelineEventName[] = [
  "onTaskClick",
  "onTimelineClick",
  "onTaskSelected",
  "onTimelineSelected",
];

/** Thrown for moves queued behind one that failed; their changes were rolled back with it. */
export class MoveCancelledError extends Error {
  constructor() {
    super("Move cancelled because an earlier move failed");
    this.name = "MoveCancelledError";
  }
}

type SelectionKind = "task" | "timeline";

const isViewData = (body: unknown): body is TimelineViewData =>
  typeof body === "object" && body !== null && "view" in body && "timelines" in body;

export class TimelineView {
  readonly container: HTMLElement;
  private model?: TimelineModel;
  private readonly api?: RestClient;
  private readonly listeners = new Map<keyof TimelineEvents, Set<Handler<never>>>();
  /** `attachEvent` handlers by event id. */
  private readonly handlers = new Map<number, { name: TimelineEventName; handler: TimelineHandlers[TimelineEventName] }>();
  private lastEventId = 0;
  /**
   * Selection: tasks or timelines, never both at once. A selected task is
   * highlighted wherever it appears.
   */
  private selected: { kind: SelectionKind; ids: Id[] } = { kind: "task", ids: [] };
  private readonly detachDrag: () => void;
  /** REST requests run one at a time, in the order the moves were made. */
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  /** Bumped whenever local state is reset after a failure; queued requests from before are dropped. */
  private generation = 0;
  /** The element `highlightTarget` marked, if any. */
  private highlighted?: HTMLElement;
  /** How dates and scale labels are written (see `setFormatters`). */
  private display: Display = defaultDisplay;
  private formatters: TimelineFormatters = {};

  constructor(container: string | HTMLElement, options: TimelineOptions = {}) {
    const node = typeof container === "string" ? document.getElementById(container) : container;
    if (!node) {
      throw new Error(typeof container === "string" ? `Timeline container "${container}" not found` : "Timeline container is missing");
    }
    this.container = node;
    if (options.api_url) this.api = new RestClient(options.api_url, options.fetch);
    this.formatters = { format_date: options.format_date, format_tick: options.format_tick };
    this.display = displayOf(this.formatters);
    this.detachDrag = attachDrag(
      node,
      (e) => this.onDrop(e),
      (entry, e) => this.onEntryClick(entry, e),
      (target, e) => this.onBackgroundClick(target, e),
      (e) => this.onMarkerDrop(e),
      {
        onDragStart: (source) => this.emit("dragging_started", this.dragEvent(source)),
        onDragEnd: (source, dropped) => this.emit("dragging_ended", { ...this.dragEvent(source), dropped }),
      },
    );
  }

  /**
   * Replaces the date and/or time-scale formatter (`format_date`,
   * `format_tick`, as in the options) and redraws. Pass `undefined` for one
   * to go back to the built-in format; leave a key out to keep the current one.
   */
  setFormatters(formatters: TimelineFormatters): void {
    this.formatters = { ...this.formatters, ...formatters };
    this.display = displayOf(this.formatters);
    if (this.model) this.render();
  }

  /**
   * Whether the user is dragging something in the view right now: an entry
   * (bar, milestone or callout label) or a marker's label, from the moment
   * the pointer has moved far enough to start a drag until it is released or
   * the drag is cancelled. Drags the host runs from outside the view (with
   * `targetAt`) don't count. False again before the drop is applied, so it
   * is already false in `entry_moved` and `dragging_ended`.
   */
  isDragging(): boolean {
    return this.container.classList.contains("tlv--dragging");
  }

  /** A drag's source with the model's own ids (the DOM holds them as strings). */
  private dragEvent(source: DragSource): DraggingEvent {
    const model = this.model;
    if (source.marker !== undefined) {
      const marker = model?.markers.find((m) => String(m.id) === source.marker);
      return { kind: "marker", marker_id: marker?.id ?? source.marker };
    }
    const timeline = model?.timelines.find((t) => String(t.id) === source.timeline);
    const task = model?.tasks.find((t) => String(t.id) === source.task);
    return { kind: "entry", timeline_id: timeline?.id ?? source.timeline!, task_id: task?.id ?? source.task! };
  }

  /** Loads data in the public format and renders it. */
  parse(data: TimelineViewData): void {
    this.model = TimelineModel.fromData(data);
    this.render();
    this.dropStaleSelection();
  }

  /** Fetches a view from the REST backend and renders it. */
  async load(viewId: Id): Promise<void> {
    if (!this.api) throw new Error("load() needs the api_url option");
    this.parse(await this.api.getView(viewId));
  }

  /**
   * The view as a standalone SVG document, as it looks on screen now. The
   * view must be rendered in the page and visible, since the export reads
   * its layout.
   */
  toSVG(): string {
    this.requireModel();
    // The export shows the timeline, not the current selection.
    const selected = this.selected;
    this.selected = { kind: "task", ids: [] };
    this.applySelection();
    try {
      return toSVG(this.container);
    } finally {
      this.selected = selected;
      this.applySelection();
    }
  }

  /** The current data, in the same format `parse()` takes. */
  serialize(): TimelineViewData {
    return this.requireModel().toData();
  }

  on<K extends keyof TimelineEvents>(name: K, handler: Handler<TimelineEvents[K]>): () => void {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  }

  /**
   * Subscribes to an event, such as `onTaskClick`. Returns an event id for
   * `detachEvent`. Inside a `function` handler, `this` is this view.
   */
  attachEvent<K extends TimelineEventName>(name: K, handler: TimelineHandlers[K]): number {
    if (!HANDLER_NAMES.includes(name)) throw new Error(`Unknown event "${name}"`);
    if (typeof handler !== "function") throw new Error("attachEvent needs a handler function");
    const id = ++this.lastEventId;
    this.handlers.set(id, { name, handler });
    return id;
  }

  /** Removes a handler added with `attachEvent`. Returns false if the id is unknown. */
  detachEvent(eventId: number): boolean {
    return this.handlers.delete(eventId);
  }

  /** The selected tasks' ids, in the order they were selected; empty when timelines (or nothing) are selected. */
  getSelectedTasks(): Id[] {
    return this.selected.kind === "task" ? [...this.selected.ids] : [];
  }

  /** The selected timelines' ids, in the order they were selected; empty when tasks (or nothing) are selected. */
  getSelectedTimelines(): Id[] {
    return this.selected.kind === "timeline" ? [...this.selected.ids] : [];
  }

  /**
   * Selects a task, highlighted wherever it appears. With `add`, it joins the
   * tasks already selected (as Ctrl+Click does); otherwise it replaces the
   * selection. Selecting a task always deselects timelines. Fires the selected
   * events for what changed. Returns false when selection is turned off
   * (`view.selection: false`).
   */
  selectTask(id: Id, add = false): boolean {
    const task = this.requireModel().findTask(id);
    if (!task) throw new Error(`Task ${id} not found`);
    return this.select("task", task.id, add);
  }

  /** Like `selectTask`, for a timeline. Selecting a timeline always deselects tasks. */
  selectTimeline(id: Id, add = false): boolean {
    const timeline = this.requireModel().findTimeline(id);
    if (!timeline) throw new Error(`Timeline ${id} not found`);
    return this.select("timeline", timeline.id, add);
  }

  /** Deselects one task. Returns false if it wasn't selected. */
  unselectTask(id: Id): boolean {
    return this.unselect("task", id);
  }

  /** Deselects one timeline. Returns false if it wasn't selected. */
  unselectTimeline(id: Id): boolean {
    return this.unselect("timeline", id);
  }

  /** Deselects everything. */
  clearSelection(): void {
    this.setSelection(this.selected.kind, []);
  }

  /**
   * Moves a marker's label, as dragging it does: `y ≤ 0` above the topmost
   * bar showing the marker, `y > 0` below the bottommost. The same as
   * `updateMarker(id, { marker_offset })`: fires `marker_moved` and
   * `marker_updated`, and is saved the same way.
   */
  setMarkerOffset(markerId: Id, offset: Offset): Promise<boolean> {
    return this.updateMarker(markerId, { marker_offset: offset });
  }

  /**
   * Adds a marker, in the data format (`{ id, text, date, color?, global?,
   * marker_offset? }`), validated as in loaded data. A global marker shows on
   * every timeline; any other on none until `showMarker`. Fires
   * `marker_added`. Like the other changes it returns a promise, which
   * rejects with a `MoveError` (`conflict` for an id in use, `invalid`)
   * without changing anything, and after a failed save. With a REST backend,
   * saved with `POST /views/{view_id}/markers`.
   */
  async addMarker(data: MarkerData): Promise<void> {
    const model = this.requireModel();
    const snapshot = model.toData();
    const marker = model.addMarker(data);
    this.render();
    const added = markerToData(marker);
    this.emit("marker_added", { marker_id: marker.id, marker: added });
    await this.saveChange(
      snapshot,
      "add_marker",
      { marker_id: marker.id },
      (api, viewId, version) => api.addMarker(viewId, added, version),
      this.takeMarker,
    );
  }

  /**
   * Changes a marker's `text`, `date`, `color` (`null` for the theme's),
   * `global` or `marker_offset`. Send only what changes; the result is
   * validated as in loaded data. Fires `marker_updated` with the marker
   * before and after, and `marker_moved` too when the label moved. Resolves
   * to false, without events, if nothing changes; rejects with a `MoveError`
   * (`not_found`, `invalid`) without changing anything, and after a failed
   * save. With a REST backend, saved with
   * `PATCH /views/{view_id}/markers/{marker_id}`.
   */
  async updateMarker(id: Id, patch: MarkerPatchData): Promise<boolean> {
    const model = this.requireModel();
    const snapshot = model.toData();
    const { marker, old } = model.updateMarker(id, patch);
    const before = markerToData(old);
    const after = markerToData(marker);
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    this.render();
    this.emit("marker_updated", { marker_id: marker.id, marker: after, old_marker: before });
    if (marker.offset.x !== old.offset.x || marker.offset.y !== old.offset.y) {
      this.emit("marker_moved", { marker_id: marker.id, marker_offset: { ...marker.offset } });
    }
    await this.saveChange(
      snapshot,
      "update_marker",
      { marker_id: marker.id },
      (api, viewId, version) => api.updateMarker(viewId, marker.id, patch, version),
      this.takeMarker,
    );
    return true;
  }

  /**
   * Removes a marker, from the view and from every timeline that shows it.
   * Fires `marker_removed`. Returns a promise like the other changes; it
   * rejects with a `MoveError` (`not_found`) for an unknown id. With a REST
   * backend, saved with `DELETE /views/{view_id}/markers/{marker_id}`.
   */
  async removeMarker(id: Id): Promise<void> {
    const model = this.requireModel();
    const snapshot = model.toData();
    const { marker, timelines } = model.removeMarker(id);
    this.render();
    this.emit("marker_removed", {
      marker_id: marker.id,
      marker: markerToData(marker),
      timelines: timelines.map(timelineToData),
    });
    await this.saveChange(
      snapshot,
      "remove_marker",
      { marker_id: marker.id },
      (api, viewId, version) => api.removeMarker(viewId, marker.id, version),
      this.takeTimelines,
    );
  }

  /**
   * Shows a marker on a timeline (adds its `{ marker }` entry), for a marker
   * that isn't `global`. Fires `marker_shown`. Resolves to false, without
   * the event, if the timeline already shows it; rejects with a `MoveError`
   * (`not_found`) for an unknown timeline or marker. With a REST backend,
   * saved with `PUT /views/{view_id}/timelines/{timeline_id}/markers/{marker_id}`.
   */
  async showMarker(timelineId: Id, markerId: Id): Promise<boolean> {
    const model = this.requireModel();
    const snapshot = model.toData();
    const { timeline, marker, changed } = model.showMarker(timelineId, markerId);
    if (!changed) return false;
    this.render();
    this.emit("marker_shown", { timeline_id: timeline.id, marker_id: marker.id, timeline: timelineToData(timeline) });
    await this.saveChange(
      snapshot,
      "show_marker",
      { timeline_id: timeline.id, marker_id: marker.id },
      (api, viewId, version) => api.showMarker(viewId, timeline.id, marker.id, version),
      this.takeTimelines,
    );
    return true;
  }

  /**
   * Stops showing a marker on a timeline (removes its `{ marker }` entry).
   * Fires `marker_hidden`. Rejects with a `MoveError` (`not_found`) if the
   * timeline has no entry for it. With a REST backend, saved with
   * `DELETE /views/{view_id}/timelines/{timeline_id}/markers/{marker_id}`.
   */
  async hideMarker(timelineId: Id, markerId: Id): Promise<void> {
    const model = this.requireModel();
    const snapshot = model.toData();
    const { timeline, marker } = model.hideMarker(timelineId, markerId);
    this.render();
    this.emit("marker_hidden", { timeline_id: timeline.id, marker_id: marker.id, timeline: timelineToData(timeline) });
    await this.saveChange(
      snapshot,
      "hide_marker",
      { timeline_id: timeline.id, marker_id: marker.id },
      (api, viewId, version) => api.hideMarker(viewId, timeline.id, marker.id, version),
      this.takeTimelines,
    );
  }

  /*
   * The view and timeline changes below work like `moveEntry`: the change is
   * applied and shown at once (before the promise settles), and the promise
   * settles when it is saved: at once without a REST backend. It rejects,
   * changing nothing, for invalid input (a `MoveError`), and after a failed
   * save (rolled back, or re-rendered from a 409), which also fires
   * `save_failed`.
   */

  /**
   * Sets the view's name, shown as the heading ("" for no heading), and
   * fires `view_renamed`. Resolves to false, without the event, if the name
   * is unchanged. Rejects with a `MoveError` (`invalid`) if `name` isn't a
   * string. With a REST backend, saves it with `PATCH /views/{view_id}`.
   */
  async renameView(name: string): Promise<boolean> {
    const model = this.requireModel();
    if (model.view.name === name) return false;
    const snapshot = model.toData();
    const old = model.renameView(name);
    this.render();
    this.emit("view_renamed", { name, old_name: old });
    await this.saveChange(snapshot, "rename_view", {}, (api, viewId, version) =>
      api.updateView(viewId, { name }, version),
    );
    return true;
  }

  /**
   * Sets a timeline's name: the same as `updateTimeline(id, { name })`.
   * Fires `timeline_renamed` (and `timeline_updated`).
   */
  renameTimeline(id: Id, name: string): Promise<boolean> {
    return this.updateTimeline(id, { name });
  }

  /**
   * Changes a timeline's `name`, `start_date` and/or `finish_date`; send only
   * what changes. The finish must stay after the start. Entries outside the
   * new range stay, drawn at the edge with an arrow, as in loaded data.
   * Fires `timeline_updated` with the timeline before and after, and
   * `timeline_renamed` too when the name changed. Resolves to false, without
   * events, if nothing changes; rejects with a `MoveError` (`not_found`,
   * `invalid`) without changing anything, and after a failed save. With a
   * REST backend, saved with `PATCH /views/{view_id}/timelines/{timeline_id}`.
   */
  async updateTimeline(id: Id, patch: TimelineUpdateData): Promise<boolean> {
    const model = this.requireModel();
    const snapshot = model.toData();
    const before = model.findTimeline(id);
    const beforeData = before && timelineToData(before);
    const { timeline, old } = model.updateTimeline(id, patch);
    const after = timelineToData(timeline);
    if (JSON.stringify(beforeData) === JSON.stringify(after)) return false;
    this.render();
    const oldTimeline = { ...after, name: old.name, start_date: dateToData(old.start), finish_date: dateToData(old.finish) };
    this.emit("timeline_updated", { timeline_id: timeline.id, timeline: after, old_timeline: oldTimeline });
    if (timeline.name !== old.name) {
      this.emit("timeline_renamed", { timeline_id: timeline.id, name: timeline.name, old_name: old.name });
    }
    const onlyName = Object.keys(patch).every((k) => k === "name");
    await this.saveChange(snapshot, onlyName ? "rename_timeline" : "update_timeline", { timeline_id: timeline.id }, (api, viewId, version) =>
      api.updateTimeline(viewId, timeline.id, patch, version),
    );
    return true;
  }

  /**
   * Adds a timeline, in the data format (`{ id, name, start_date,
   * finish_date, entries }`; `entries` may be left out for an empty one), at
   * `position` in the stack (0-based; the bottom by default). Fires
   * `timeline_added`. Rejects with a `MoveError`, changing nothing:
   * `conflict` for an id that is in use, `invalid` for bad data or a bad
   * position (whatever `parse()` would reject, such as an entry for an
   * unknown task). With a REST backend, saves it with
   * `POST /views/{view_id}/timelines`.
   */
  async addTimeline(data: TimelineData, position?: number): Promise<void> {
    const model = this.requireModel();
    const snapshot = model.toData();
    const { timeline, position: at } = model.addTimeline(data, position);
    this.render();
    const added = timelineToData(timeline);
    this.emit("timeline_added", {
      timeline_id: timeline.id,
      timeline: added,
      index: at,
      order: model.timelines.map((t) => t.id),
    });
    await this.saveChange(snapshot, "add_timeline", { timeline_id: timeline.id }, (api, viewId, version) =>
      api.addTimeline(viewId, added, at, version),
    );
  }

  /**
   * Changes a task's fields (`text`, `start_date`, `duration` or
   * `finish_date`, `symbol`, `color`), wherever it appears, and fires
   * `task_updated`. Send only what changes; `null` clears an optional field.
   * Setting `duration` drops `finish_date` and the other way round; clearing
   * both makes a milestone. Resolves to false, without the event, if nothing
   * changes. Rejects with a `MoveError` (`not_found`, `invalid`, as `parse()`
   * would reject the result) without changing anything, and after a failed
   * save, which also fires `save_failed`. With a REST backend, saved with
   * `PATCH /views/{view_id}/tasks/{task_id}`.
   */
  async updateTask(id: Id, patch: TaskPatchData): Promise<boolean> {
    const model = this.requireModel();
    const snapshot = model.toData();
    const { task, old } = model.updateTask(id, patch);
    const before = taskToData(old);
    const after = taskToData(task);
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    this.render();
    this.emit("task_updated", { task_id: task.id, task: after, old_task: before });
    await this.saveChange(
      snapshot,
      "update_task",
      { task_id: task.id },
      (api, viewId, version) => api.updateTask(viewId, task.id, patch, version),
      (result, isLast) => {
        // The server's copy, unless more changes are waiting.
        if (!isLast) return;
        this.model!.replaceTask(result.task);
        this.render();
      },
    );
    return true;
  }

  /**
   * Removes a task: from the tasks and from every timeline it is on (their
   * bar lines are trimmed as after a move). Deselects it, and fires
   * `task_removed`. The promise rejects with a `MoveError` (`not_found`) for
   * an unknown id, and after a failed save, which also fires `save_failed`.
   * With a REST backend, saved with `DELETE /views/{view_id}/tasks/{task_id}`.
   */
  async removeTask(id: Id): Promise<void> {
    const model = this.requireModel();
    const snapshot = model.toData();
    const { task, timelines } = model.removeTask(id);
    this.render();
    this.dropStaleSelection();
    this.emit("task_removed", {
      task_id: task.id,
      task: taskToData(task),
      timelines: timelines.map(timelineToData),
    });
    await this.saveChange(
      snapshot,
      "remove_task",
      { task_id: task.id },
      (api, viewId, version) => api.removeTask(viewId, task.id, version),
      this.takeTimelines,
    );
  }

  /**
   * Removes a timeline and its entries. Its tasks stay in the data, also
   * those that are on no other timeline now. Deselects it, and fires
   * `timeline_removed`. Rejects with a `MoveError` (`not_found`) for an
   * unknown id. With a REST backend, saves it with
   * `DELETE /views/{view_id}/timelines/{timeline_id}`.
   */
  async removeTimeline(id: Id): Promise<void> {
    const model = this.requireModel();
    const snapshot = model.toData();
    const { timeline, index } = model.removeTimeline(id);
    this.render();
    this.dropStaleSelection();
    this.emit("timeline_removed", {
      timeline_id: timeline.id,
      timeline: timelineToData(timeline),
      index,
      order: model.timelines.map((t) => t.id),
    });
    await this.saveChange(snapshot, "remove_timeline", { timeline_id: timeline.id }, (api, viewId, version) =>
      api.removeTimeline(viewId, timeline.id, version),
    );
  }

  /** Moves a timeline one place up the stack. Resolves to false if it is already at the top. */
  moveTimelineUp(id: Id): Promise<boolean> {
    return this.moveTimeline(id, -1);
  }

  /** Moves a timeline one place down the stack. Resolves to false if it is already at the bottom. */
  moveTimelineDown(id: Id): Promise<boolean> {
    return this.moveTimeline(id, 1);
  }

  /**
   * Moves a timeline `delta` places: negative is up, positive down. Resolves
   * to false, changing nothing, past the top or bottom. Fires
   * `timeline_moved`. Rejects with a `MoveError` (`not_found`) for an
   * unknown id. With a REST backend, saves the new position with
   * `PATCH /views/{view_id}/timelines/{timeline_id}`.
   */
  async moveTimeline(id: Id, delta: number): Promise<boolean> {
    const model = this.requireModel();
    const index = (timelineId: Id) => model.timelines.findIndex((t) => String(t.id) === String(timelineId));
    const from = index(id);
    const snapshot = model.toData();
    const moved = model.moveTimeline(id, delta);
    if (!moved) return false;
    this.render();
    const timeline = model.timelines[from + delta];
    this.emit("timeline_moved", {
      timeline_id: timeline.id,
      from_index: from,
      to_index: from + delta,
      order: model.timelines.map((t) => t.id),
    });
    await this.saveChange(snapshot, "move_timeline", { timeline_id: timeline.id }, (api, viewId, version) =>
      api.updateTimeline(viewId, timeline.id, { position: from + delta }, version),
    );
    return true;
  }

  /**
   * Moves an entry: shows the move at once, fires `entry_moved` and, with a
   * REST backend, sends the PATCH. Rolls back and fires `move_failed` if the
   * move is invalid or the server rejects it.
   */
  async moveEntry(timelineId: Id, taskId: Id, patch: MovePatchData): Promise<void> {
    const model = this.requireModel();
    const event: EntryMovedEvent = { timeline_id: timelineId, task_id: taskId, patch };
    const snapshot = model.toData();
    try {
      model.moveEntry(timelineId, taskId, patchFromData(patch));
    } catch (error) {
      this.emit("move_failed", { ...event, error });
      throw error;
    }
    this.render();
    this.emit("entry_moved", event);
    return this.save(
      snapshot,
      (api, viewId, version) => api.moveEntry(viewId, timelineId, taskId, patch, version),
      (error) => this.emit("move_failed", { ...event, error }),
      (result, isLast) => {
        // Later changes are already on screen; their own responses will catch up.
        if (!isLast) return;
        this.model!.replaceTimelines(result.timelines);
        this.render();
      },
    );
  }

  /**
   * Resolves when every change made so far has been sent to the REST backend
   * and answered, or has failed (failures are reported through `move_failed`
   * and `save_failed`). Resolves at once without a backend.
   */
  whenSaved(): Promise<void> {
    return this.queue.then(() => undefined);
  }

  /**
   * Sends a change that is already on screen to the REST backend, after the
   * changes queued before it, one request at a time. `send` makes the request
   * with the view's version at that moment; `onResult` gets the response
   * (`isLast`: no other change is waiting). On failure, a 409 with the
   * current view re-renders from it; anything else rolls back to `snapshot`
   * (the state before this change), which also undoes the changes queued
   * after it: they are cancelled. Then `fail` reports it. Without a backend
   * this does nothing.
   */
  private save<R extends { version: number }>(
    snapshot: TimelineViewData,
    send: (api: RestClient, viewId: Id, version: number | undefined) => Promise<R>,
    fail: (error: unknown) => void,
    onResult?: (result: R, isLast: boolean) => void,
  ): Promise<void> {
    if (!this.api) return Promise.resolve();
    const viewId = this.requireModel().view.id;
    if (viewId === undefined) {
      const error = new Error("view.id is required when api_url is set");
      this.rollback(snapshot);
      fail(error);
      return Promise.reject(error);
    }

    const api = this.api;
    const generation = this.generation;
    this.pending++;
    const request = this.queue.then(async () => {
      try {
        if (generation !== this.generation) throw new MoveCancelledError();
        const result = await send(api, viewId, this.model?.version);
        if (generation !== this.generation) return;
        this.model!.version = result.version;
        onResult?.(result, this.pending === 1);
      } catch (error) {
        if (error instanceof MoveCancelledError) throw error;
        this.generation++;
        if (error instanceof ApiError && error.status === 409 && isViewData(error.body)) {
          this.parse(error.body);
        } else {
          this.rollback(snapshot);
        }
        fail(error);
        throw error;
      } finally {
        this.pending--;
      }
    });
    this.queue = request.catch(() => undefined);
    return request;
  }

  /**
   * Saves a change other than an entry move. A failure fires `save_failed`
   * (with `ids`: what the change was for) and rejects the returned promise,
   * as `move_failed` and `moveEntry` do.
   */
  private saveChange<R extends { version: number }>(
    snapshot: TimelineViewData,
    action: SaveAction,
    ids: { timeline_id?: Id; task_id?: Id; marker_id?: Id },
    send: (api: RestClient, viewId: Id, version: number | undefined) => Promise<R>,
    onResult?: (result: R, isLast: boolean) => void,
  ): Promise<void> {
    const fail = (error: unknown) => this.emit("save_failed", { action, ...ids, error });
    return this.save(snapshot, send, fail, onResult);
  }

  /** After a marker add or update: the server's copy of the marker, unless more changes are waiting. */
  private readonly takeMarker = (result: MarkerResultData, isLast: boolean): void => {
    if (!isLast) return;
    this.model!.replaceMarker(result.marker);
    this.render();
  };

  /** After an entry add or removal: the server's copy of the timelines it changed, unless more changes are waiting. */
  private readonly takeTimelines = (result: MoveResultData, isLast: boolean): void => {
    if (!isLast) return;
    this.model!.replaceTimelines(result.timelines);
    this.render();
  };

  /**
   * Hit test for dragging something into the view from outside: the drop
   * target at the point `x`, `y` (client coordinates, as in pointer events),
   * or null when the point is outside the view. The target is a bar line, a
   * half line above the first or below the last (`new_line: true`), or a
   * callout area. Inside the view but on no area (a name label or the time
   * scale) it is the vertically nearest callout area, as for drags inside the
   * view.
   *
   * Pass `task` (an id, or a new task's data) to get a `callout_offset` for
   * a callout area: the label's corner at the point, as when a bar is dragged
   * there. Without it a callout target has no offset, and `addEntry` uses the
   * default. Elements of the host page over the view, such as a drag ghost,
   * are looked through.
   */
  targetAt(x: number, y: number, task?: Id | TaskData): EntryTargetData | null {
    const model = this.requireModel();
    const hit = hitTarget(this.container, x, y);
    const timeline = hit && model.timelines.find((t) => String(t.id) === hit.target.timeline);
    if (!hit || !timeline) return null;
    const target = hit.target;
    if (target.placement === "on") {
      return { timeline_id: timeline.id, placement: "on", line: target.line, ...(target.newLine && { new_line: true }) };
    }
    const result: EntryTargetData = { timeline_id: timeline.id, placement: target.placement };
    const found = task === undefined ? undefined : this.taskFor(task);
    if (found) {
      const point = { left: x, right: x, top: y, bottom: y, width: 0 };
      result.callout_offset = calloutOffset(point, hit.node.getBoundingClientRect(), attachAt(timeline, found), target.placement);
    }
    return result;
  }

  /**
   * Highlights a drop target (as `targetAt` returns it) the way the view
   * highlights the target of its own drags; `null` removes the highlight.
   * Only one target is highlighted at a time, and a re-render (such as after
   * `addEntry`) removes it. Returns false if the target isn't in the view.
   */
  highlightTarget(target: EntryTargetData | null): boolean {
    this.highlighted?.classList.remove("tlv-drop");
    this.highlighted = undefined;
    if (!target) return false;
    const node = targetElement(this.container, this.dropTargetOf(target));
    if (!node) return false;
    node.classList.add("tlv-drop");
    this.highlighted = node;
    return true;
  }

  /**
   * Adds a task to a timeline at `target` (as `targetAt` returns it), and
   * fires `entry_added`. `task` is the id of a task the view already has, or
   * a new task's data, which is added to the tasks. A task can be on a
   * timeline only once. The target follows the move rules (see `moveEntry`);
   * without `placement`, a `callout_offset` makes a callout and otherwise
   * the entry goes on the bar, on `line` (default 0).
   *
   * Like the other changes, the entry shows at once and the promise settles
   * when it is saved, with a REST backend by
   * `POST /views/{view_id}/timelines/{timeline_id}/entries` (a new task's
   * data goes in the same request). Rejects with a `MoveError`, changing
   * nothing, if the timeline or task id is unknown, the task is already on
   * the timeline (or new task data reuses an id), or the target is invalid;
   * and after a failed save, which also fires `save_failed`.
   */
  async addEntry(task: Id | TaskData, target: EntryTargetData): Promise<void> {
    const model = this.requireModel();
    const snapshot = model.toData();
    const { timeline_id: timelineId, ...place } = target;
    const result = model.addEntry(task, addTargetFromData(timelineId, place));
    this.highlighted = undefined;
    this.render();
    const timeline = timelineToData(result.timeline);
    const entry = timeline.entries.find((e) => "task" in e && String(e.task) === String(result.task.id)) as TaskEntryData;
    const taskData = taskToData(result.task);
    this.emit("entry_added", {
      timeline_id: result.timeline.id,
      task_id: result.task.id,
      task: taskData,
      new_task: result.created,
      entry,
      timeline,
    });
    // The server gets the target as given, and applies the same rules.
    const body: AddEntryData = { ...place, task: result.created ? taskData : result.task.id };
    await this.saveChange(
      snapshot,
      "add_entry",
      { timeline_id: result.timeline.id, task_id: result.task.id },
      (api, viewId, version) => api.addEntry(viewId, result.timeline.id, body, version),
      this.takeTimelines,
    );
  }

  /**
   * Takes a task off one timeline, and fires `entry_removed`. The task stays
   * in the data (on its other timelines, or on none), and the timeline's bar
   * lines are trimmed as after a move. With a REST backend, saved by
   * `DELETE /views/{view_id}/timelines/{timeline_id}/entries/{task_id}`.
   * The promise settles when saved; it rejects with a `MoveError`
   * (`not_found`), changing nothing, if the task isn't on that timeline, and
   * after a failed save, which also fires `save_failed`.
   */
  async removeEntry(timelineId: Id, taskId: Id): Promise<void> {
    const model = this.requireModel();
    const snapshot = model.toData();
    const { entry, timeline } = model.removeEntry(timelineId, taskId);
    this.render();
    this.emit("entry_removed", {
      timeline_id: timeline.id,
      task_id: entry.taskId,
      entry: entryToData(entry),
      timeline: timelineToData(timeline),
    });
    await this.saveChange(
      snapshot,
      "remove_entry",
      { timeline_id: timeline.id, task_id: entry.taskId },
      (api, viewId, version) => api.removeEntry(viewId, timeline.id, entry.taskId, version),
      this.takeTimelines,
    );
  }

  /**
   * Lays the view out again for its container's current size. The view does
   * this by itself when the container changes size or is shown after being
   * hidden (with `ResizeObserver`, in every supported browser), so this is
   * only needed where that can't be seen, or to be explicit, for example from
   * a docking library's resize callback. Does nothing while the view is
   * hidden. Cheap: it doesn't rebuild the DOM.
   */
  resize(): void {
    if (this.model) layout(this.container);
  }

  /** Removes the view's DOM and event listeners. */
  destroy(): void {
    this.detachDrag();
    unwatchLayout(this.container);
    this.listeners.clear();
    this.handlers.clear();
    this.container.replaceChildren();
    this.container.classList.remove("tlv");
  }

  /** The task `targetAt` places a callout for: a known one by id, or new task data. */
  private taskFor(task: Id | TaskData): Task | undefined {
    const model = this.requireModel();
    if (typeof task !== "object" || task === null) return model.findTask(task);
    const known = model.findTask(task.id);
    if (known) return known;
    try {
      return taskFromData(task);
    } catch {
      return undefined; // invalid data: no offset; addEntry reports the problem
    }
  }

  /** A public target in the DOM's form, with the same defaults as `addEntry`. */
  private dropTargetOf(target: EntryTargetData): DropTarget {
    const timeline = String(target.timeline_id);
    const placement = target.placement ?? (target.callout_offset ? (target.callout_offset.y > 0 ? "below" : "above") : "on");
    if (placement !== "on") return { timeline, placement };
    return { timeline, placement, line: target.line ?? 0, newLine: target.new_line === true };
  }

  private rollback(snapshot: TimelineViewData): void {
    const version = this.model?.version;
    this.model = TimelineModel.fromData(snapshot);
    this.model.version = version;
    this.render();
  }

  private onDrop({ timeline, task, target, offset }: DropEvent): void {
    const model = this.requireModel();
    const source = model.timelines.find((t) => String(t.id) === timeline);
    const targetTimeline = model.timelines.find((t) => String(t.id) === target.timeline);
    const entry = source?.entries.find((e) => String(e.taskId) === task);
    if (!source || !targetTimeline || !entry) return;

    // Send only the fields that change.
    const patch: MovePatchData = {};
    if (targetTimeline !== source) patch.timeline_id = targetTimeline.id;
    if (target.placement !== entry.placement) patch.placement = target.placement;
    const areaChanged = patch.timeline_id !== undefined || patch.placement !== undefined;
    if (target.placement === "on") {
      if (target.newLine) {
        patch.line = target.line;
        patch.new_line = true;
      } else if (areaChanged || entry.placement !== "on" || entry.line !== target.line) {
        patch.line = target.line;
      }
    } else if (offset) {
      const old = entry.placement === "on" ? undefined : entry.calloutOffset;
      if (areaChanged || !old || old.x !== offset.x || old.y !== offset.y) patch.callout_offset = offset;
    }
    if (Object.keys(patch).length === 0) return;

    // Failures are reported through `move_failed`.
    this.moveEntry(source.id, entry.taskId, patch).catch(() => undefined);
  }

  /** Calls every `attachEvent` handler for `name`, with this view as `this`. */
  private callHandlers<K extends TimelineEventName>(name: K, ...args: Parameters<TimelineHandlers[K]>): void {
    // Copied, so a handler may detach itself (or others) while running.
    // oxlint-disable-next-line unicorn/no-useless-spread -- the copy is the point
    for (const { name: n, handler } of [...this.handlers.values()]) {
      if (n === name) (handler as (this: TimelineView, ...a: Parameters<TimelineHandlers[K]>) => void).apply(this, args);
    }
  }

  private onMarkerDrop({ marker, offset }: MarkerDropEvent): void {
    const found = this.model?.markers.find((m) => String(m.id) === marker);
    if (!found || (found.offset.x === offset.x && found.offset.y === offset.y)) return;
    // A failed save is reported through `save_failed`.
    this.setMarkerOffset(found.id, offset).catch(() => undefined);
  }

  private onEntryClick(entry: HTMLElement, e: MouseEvent): void {
    const model = this.model;
    // The DOM holds ids as strings; hand out the task's and timeline's own ids.
    const task = model?.tasks.find((t) => String(t.id) === entry.dataset.task);
    const timeline = model?.timelines.find((t) => String(t.id) === entry.dataset.timeline);
    if (!model || !task || !timeline) return;
    this.callHandlers("onTaskClick", task.id, e, timeline.id);
    if (this.model === model) this.clickSelect("task", task.id, e);
  }

  /** A click on a timeline outside its tasks, or on the view's heading. */
  private onBackgroundClick(target: HTMLElement, e: MouseEvent): void {
    const model = this.model;
    if (!model) return;
    const row = target.closest<HTMLElement>(".tlv-timeline");
    const timeline = row ? model.timelines.find((t) => String(t.id) === row.dataset.timeline) : undefined;
    if (timeline) this.callHandlers("onTimelineClick", timeline.id, e);
    if (this.model !== model) return;
    // The view's heading clears the selection.
    if (timeline) this.clickSelect("timeline", timeline.id, e);
    else if (model.view.selection) this.clearSelection();
  }

  /**
   * Selection by clicking. Click: select only this item, or, if it is
   * already selected, clear the selection. Ctrl+Click (Cmd+Click on a Mac):
   * add or remove this item; on the other kind of item it starts a new
   * selection with just this one.
   */
  private clickSelect(kind: SelectionKind, id: Id, e: MouseEvent): void {
    if (!this.requireModel().view.selection) return;
    const isSelected = this.isSelected(kind, id);
    if (e.ctrlKey || e.metaKey) {
      if (isSelected) this.unselect(kind, id);
      else this.select(kind, id, true);
    } else if (isSelected) {
      this.clearSelection();
    } else {
      this.select(kind, id, false);
    }
  }

  private isSelected(kind: SelectionKind, id: Id): boolean {
    return this.selected.kind === kind && this.selected.ids.some((x) => String(x) === String(id));
  }

  private select(kind: SelectionKind, id: Id, add: boolean): boolean {
    if (!this.requireModel().view.selection) return false;
    const keep = add && this.selected.kind === kind ? this.selected.ids : [];
    if (keep.some((x) => String(x) === String(id))) return true;
    this.setSelection(kind, [...keep, id]);
    return true;
  }

  private unselect(kind: SelectionKind, id: Id): boolean {
    if (!this.isSelected(kind, id)) return false;
    this.setSelection(
      kind,
      this.selected.ids.filter((x) => String(x) !== String(id)),
    );
    return true;
  }

  /**
   * Sets the selection and updates the highlight. Fires `onTaskSelected`
   * and/or `onTimelineSelected` for each kind whose selection changed (the
   * kind being left reports an empty list).
   */
  private setSelection(kind: SelectionKind, ids: Id[]): void {
    const before = this.selected;
    this.selected = { kind, ids };
    this.applySelection();
    const list = (k: SelectionKind, s: { kind: SelectionKind; ids: Id[] }) => (s.kind === k ? s.ids : []);
    for (const k of ["task", "timeline"] as const) {
      const was = list(k, before).map(String).join("\u0000");
      const now = list(k, this.selected).map(String).join("\u0000");
      if (was !== now) this.callHandlers(k === "task" ? "onTaskSelected" : "onTimelineSelected", [...list(k, this.selected)]);
    }
  }

  /** After new data: forgets selected tasks or timelines that are gone, or everything if selection is off. */
  private dropStaleSelection(): void {
    const model = this.requireModel();
    const { kind, ids } = this.selected;
    const exists = (id: Id) => (kind === "task" ? model.findTask(id) : model.findTimeline(id)) !== undefined;
    const kept = model.view.selection ? ids.filter(exists) : [];
    if (kept.length !== ids.length) this.setSelection(kind, kept);
  }

  /** Marks the selected tasks' elements, or the selected timelines, in the DOM. */
  private applySelection(): void {
    const ids = new Set(this.selected.ids.map(String));
    const tasks = this.selected.kind === "task";
    for (const node of this.container.querySelectorAll<HTMLElement>("[data-entry]")) {
      node.classList.toggle("tlv-selected", tasks && ids.has(node.dataset.task!));
    }
    for (const row of this.container.querySelectorAll<HTMLElement>(".tlv-timeline")) {
      const selected = !tasks && ids.has(row.dataset.timeline!);
      row.classList.toggle("tlv-timeline--selected", selected);
      row.setAttribute("aria-selected", String(selected));
    }
  }

  private emit<K extends keyof TimelineEvents>(name: K, event: TimelineEvents[K]): void {
    for (const handler of this.listeners.get(name) ?? []) (handler as Handler<TimelineEvents[K]>)(event);
  }

  private requireModel(): TimelineModel {
    if (!this.model) throw new Error("No data yet: call parse() or load() first");
    return this.model;
  }

  private render(): void {
    render(this.container, this.requireModel(), this.display);
    this.applySelection();
  }
}
