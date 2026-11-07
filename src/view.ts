import { ApiError, RestClient } from "./api";
import { attachDrag, type DropEvent } from "./drag";
import { patchFromData, TimelineModel } from "./model";
import { render } from "./render";
import type { Id, MovePatchData, TimelineViewData } from "./types";

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

export interface TimelineEvents {
  /** A move was applied on screen. Fired before the REST request, if any, is sent. */
  entry_moved: EntryMovedEvent;
  /** A move was rejected, locally or by the server. The view shows the restored state. */
  move_failed: MoveFailedEvent;
}

type Handler<T> = (event: T) => void;

/** Thrown for moves queued behind one that failed; their changes were rolled back with it. */
export class MoveCancelledError extends Error {
  constructor() {
    super("Move cancelled because an earlier move failed");
    this.name = "MoveCancelledError";
  }
}

const isViewData = (body: unknown): body is TimelineViewData =>
  typeof body === "object" && body !== null && "view" in body && "timelines" in body;

export class TimelineView {
  readonly container: HTMLElement;
  private model?: TimelineModel;
  private readonly api?: RestClient;
  private readonly listeners = new Map<keyof TimelineEvents, Set<Handler<never>>>();
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
    this.detachDrag = attachDrag(node, (e) => this.onDrop(e));
  }

  /** Loads data in the public format and renders it. */
  parse(data: TimelineViewData): void {
    this.model = TimelineModel.fromData(data);
    this.render();
  }

  /** Fetches a view from the REST backend and renders it. */
  async load(viewId: Id): Promise<void> {
    if (!this.api) throw new Error("load() needs the api_url option");
    this.parse(await this.api.getView(viewId));
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
    this.listeners.clear();
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

  private emit<K extends keyof TimelineEvents>(name: K, event: TimelineEvents[K]): void {
    for (const handler of this.listeners.get(name) ?? []) (handler as Handler<TimelineEvents[K]>)(event);
  }

  private requireModel(): TimelineModel {
    if (!this.model) throw new Error("No data yet: call parse() or load() first");
    return this.model;
  }

  private render(): void {
    render(this.container, this.requireModel());
  }
}
