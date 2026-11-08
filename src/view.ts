import { ApiError, RestClient } from "./api";
import { attachDrag, calloutOffset, hitTarget, targetElement, type DropEvent, type DropTarget, type MarkerDropEvent } from "./drag";
import { patchFromData, taskFromData, taskToData, TimelineModel, timelineToData, type Task } from "./model";
import { attachAt, layout, render, unwatchLayout } from "./render";
import { toSVG } from "./svg";
import type {
  EntryTargetData,
  Id,
  MovePatchData,
  Offset,
  TaskData,
  TaskEntryData,
  TimelineData,
  TimelineViewData,
} from "./types";

export interface TimelineOptions {
  /** Base URL of the REST backend. Without it, changes are only reported through events. */
  api_url?: string;
  /** Replacement for `fetch`, mainly for tests and mock backends. */
  fetch?: typeof fetch;
}

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

export interface SaveFailedEvent {
  action: SaveAction;
  /** The timeline the change was for; not set for `rename_view`. */
  timeline_id?: Id;
  /** An `ApiError` (with `status` and `body`) for a rejected request, or the network error. */
  error: unknown;
}

export interface TimelineEvents {
  /** A move was applied on screen. Fired before the REST request, if any, is sent. */
  entry_moved: EntryMovedEvent;
  /** A move was rejected, locally or by the server. The view shows the restored state. */
  move_failed: MoveFailedEvent;
  /**
   * A marker's label was moved (dragged, or `setMarkerOffset`). Markers have
   * no REST call yet, so saving the new `marker_offset` is up to the host.
   */
  marker_moved: MarkerMovedEvent;
  /**
   * An entry was added with `addEntry` (for example a task dropped from a
   * list outside the view). There is no REST call for it yet, so saving it is
   * up to the host.
   */
  entry_added: EntryAddedEvent;
  /**
   * A timeline was moved in the stack (`moveTimeline`, `moveTimelineUp`,
   * `moveTimelineDown`). With a REST backend the new position is saved too.
   */
  timeline_moved: TimelineMovedEvent;
  /** A task was removed with `removeTask`. No REST call yet: saving it is up to the host. */
  task_removed: TaskRemovedEvent;
  /** A timeline was removed with `removeTimeline`. With a REST backend it is saved too. */
  timeline_removed: TimelineRemovedEvent;
  /** The view's name was changed with `renameView`. With a REST backend it is saved too. */
  view_renamed: ViewRenamedEvent;
  /** A timeline's name was changed with `renameTimeline`. With a REST backend it is saved too. */
  timeline_renamed: TimelineRenamedEvent;
  /** A timeline was added with `addTimeline`. */
  timeline_added: TimelineAddedEvent;
  /**
   * Saving a view or timeline change (rename, add, move, remove) to the REST
   * backend failed. The view already shows the restored state: rolled back,
   * or the server's current view after a 409. Entry moves report
   * `move_failed` instead.
   */
  save_failed: SaveFailedEvent;
}

/** What a failed save was for. */
export type SaveAction = "rename_view" | "add_timeline" | "rename_timeline" | "move_timeline" | "remove_timeline";

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

  constructor(container: string | HTMLElement, options: TimelineOptions = {}) {
    const node = typeof container === "string" ? document.getElementById(container) : container;
    if (!node) throw new Error(`Timeline container "${container}" not found`);
    this.container = node;
    if (options.api_url) this.api = new RestClient(options.api_url, options.fetch);
    this.detachDrag = attachDrag(
      node,
      (e) => this.onDrop(e),
      (entry, e) => this.onEntryClick(entry, e),
      (target, e) => this.onBackgroundClick(target, e),
      (e) => this.onMarkerDrop(e),
    );
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
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
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
   * bar showing the marker, `y > 0` below the bottommost. Fires `marker_moved`.
   */
  setMarkerOffset(markerId: Id, offset: Offset): void {
    const marker = this.requireModel().setMarkerOffset(markerId, offset);
    this.render();
    this.emit("marker_moved", { marker_id: marker.id, marker_offset: { ...marker.offset } });
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
    await this.saveChange(snapshot, "rename_view", undefined, (api, viewId, version) =>
      api.updateView(viewId, { name }, version),
    );
    return true;
  }

  /**
   * Sets a timeline's name and fires `timeline_renamed`. Resolves to false,
   * without the event, if the name is unchanged. Rejects with a `MoveError`
   * (`not_found` or `invalid`) for an unknown id or a `name` that isn't a
   * string. With a REST backend, saves it with
   * `PATCH /views/{view_id}/timelines/{timeline_id}`.
   */
  async renameTimeline(id: Id, name: string): Promise<boolean> {
    const model = this.requireModel();
    const current = model.findTimeline(id);
    if (current && current.name === name) return false;
    const snapshot = model.toData();
    const { timeline, old } = model.renameTimeline(id, name);
    this.render();
    this.emit("timeline_renamed", { timeline_id: timeline.id, name, old_name: old });
    await this.saveChange(snapshot, "rename_timeline", timeline.id, (api, viewId, version) =>
      api.updateTimeline(viewId, timeline.id, { name }, version),
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
    await this.saveChange(snapshot, "add_timeline", timeline.id, (api, viewId, version) =>
      api.addTimeline(viewId, added, at, version),
    );
  }

  /**
   * Removes a task: from the tasks and from every timeline it is on (their
   * bar lines are trimmed as after a move). Deselects it, and fires
   * `task_removed`. Throws a `MoveError` (`not_found`) for an unknown id.
   * Not sent to the REST API.
   */
  removeTask(id: Id): void {
    const { task, timelines } = this.requireModel().removeTask(id);
    this.render();
    this.dropStaleSelection();
    this.emit("task_removed", {
      task_id: task.id,
      task: taskToData(task),
      timelines: timelines.map(timelineToData),
    });
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
    await this.saveChange(snapshot, "remove_timeline", timeline.id, (api, viewId, version) =>
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
    await this.saveChange(snapshot, "move_timeline", timeline.id, (api, viewId, version) =>
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
   * Saves a view or timeline change. A failure fires `save_failed` and
   * rejects the returned promise, as `move_failed` and `moveEntry` do.
   */
  private saveChange<R extends { version: number }>(
    snapshot: TimelineViewData,
    action: SaveAction,
    timelineId: Id | undefined,
    send: (api: RestClient, viewId: Id, version: number | undefined) => Promise<R>,
  ): Promise<void> {
    const fail = (error: unknown) =>
      this.emit("save_failed", { action, ...(timelineId !== undefined && { timeline_id: timelineId }), error });
    return this.save(snapshot, send, fail);
  }

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
   * Throws a `MoveError`, changing nothing, if the timeline or task id is
   * unknown, the task is already on the timeline (or new task data reuses an
   * id), or the target is invalid. Not sent to the REST API.
   */
  addEntry(task: Id | TaskData, target: EntryTargetData): void {
    const model = this.requireModel();
    const result = model.addEntry(task, {
      timelineId: target.timeline_id,
      ...(target.placement !== undefined && { placement: target.placement }),
      ...(target.line !== undefined && { line: target.line }),
      ...(target.new_line !== undefined && { newLine: target.new_line }),
      ...(target.callout_offset !== undefined && { calloutOffset: target.callout_offset }),
    });
    this.highlighted = undefined;
    this.render();
    const timeline = timelineToData(result.timeline);
    const entry = timeline.entries.find((e) => "task" in e && String(e.task) === String(result.task.id)) as TaskEntryData;
    this.emit("entry_added", {
      timeline_id: result.timeline.id,
      task_id: result.task.id,
      task: taskToData(result.task),
      new_task: result.created,
      entry,
      timeline,
    });
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
    for (const { name: n, handler } of [...this.handlers.values()]) {
      if (n === name) (handler as (this: TimelineView, ...a: Parameters<TimelineHandlers[K]>) => void).apply(this, args);
    }
  }

  private onMarkerDrop({ marker, offset }: MarkerDropEvent): void {
    const found = this.model?.markers.find((m) => String(m.id) === marker);
    if (!found || (found.offset.x === offset.x && found.offset.y === offset.y)) return;
    this.setMarkerOffset(found.id, offset);
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
    render(this.container, this.requireModel());
    this.applySelection();
  }
}
