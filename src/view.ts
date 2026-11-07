import { ApiError, RestClient } from "./api";
import { attachDrag, type DropEvent, type MarkerDropEvent } from "./drag";
import { patchFromData, TimelineModel } from "./model";
import { render, unwatchLayout } from "./render";
import { toSVG } from "./svg";
import type { Id, MovePatchData, Offset, TimelineViewData } from "./types";

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
}

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

  /** Moves a timeline one place up the stack. Returns false if it is already at the top. */
  moveTimelineUp(id: Id): boolean {
    return this.moveTimeline(id, -1);
  }

  /** Moves a timeline one place down the stack. Returns false if it is already at the bottom. */
  moveTimelineDown(id: Id): boolean {
    return this.moveTimeline(id, 1);
  }

  /**
   * Moves a timeline `delta` places: negative is up, positive down. Returns
   * false, changing nothing, past the top or bottom. The new order shows in
   * `serialize()`; the REST API has no call for it yet.
   */
  moveTimeline(id: Id, delta: number): boolean {
    const moved = this.requireModel().moveTimeline(id, delta);
    if (moved) this.render();
    return moved;
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

    if (!this.api) return;
    const viewId = model.view.id;
    if (viewId === undefined) {
      const error = new Error("view.id is required when api_url is set");
      this.rollback(snapshot);
      this.emit("move_failed", { ...event, error });
      throw error;
    }

    const api = this.api;
    const generation = this.generation;
    this.pending++;
    const request = this.queue.then(async () => {
      try {
        if (generation !== this.generation) throw new MoveCancelledError();
        const result = await api.moveEntry(viewId, timelineId, taskId, patch, this.model?.version);
        if (generation !== this.generation) return;
        this.model!.version = result.version;
        // Later moves are already on screen; their own responses will catch up.
        if (this.pending === 1) {
          this.model!.replaceTimelines(result.timelines);
          this.render();
        }
      } catch (error) {
        if (error instanceof MoveCancelledError) throw error;
        this.generation++;
        if (error instanceof ApiError && error.status === 409 && isViewData(error.body)) {
          this.parse(error.body);
        } else {
          this.rollback(snapshot);
        }
        this.emit("move_failed", { ...event, error });
        throw error;
      } finally {
        this.pending--;
      }
    });
    this.queue = request.catch(() => undefined);
    return request;
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
