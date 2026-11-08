import "./styles.css";
import type { EntryTargetData, Id, MovePatchData, Offset, TaskData, TimelineViewData } from "./types";
import {
  TimelineView,
  type TimelineEventName,
  type TimelineEvents,
  type TimelineHandlers,
  type TimelineOptions,
} from "./view";

export * from "./types";
export { ApiError, RestClient } from "./api";
// The model is exported so JavaScript backends and mock servers can apply the same move rules.
export { MoveError, TimelineModel, firstLine, lineCount, patchFromData, trimLines, timelineToData } from "./model";
export { parseDuration, addDuration } from "./duration";
export {
  MoveCancelledError,
  TimelineView,
  type EntryAddedEvent,
  type EntryMovedEvent,
  type MarkerMovedEvent,
  type MoveFailedEvent,
  type TimelineMovedEvent,
  type TimelineEvents,
  type TimelineEventName,
  type TimelineHandlers,
  type TimelineOptions,
} from "./view";

/*
 * Default instance, for script-tag use: `timeline.init("id")`, then
 * `timeline.parse(data)`. Use `new TimelineView(...)` for several views on a page.
 */
let current: TimelineView | undefined;

function instance(): TimelineView {
  if (!current) throw new Error("Call timeline.init(container) first");
  return current;
}

export function init(container: string | HTMLElement, options?: TimelineOptions): TimelineView {
  current?.destroy();
  current = new TimelineView(container, options);
  return current;
}

export const parse = (data: TimelineViewData) => instance().parse(data);
export const load = (viewId: Id) => instance().load(viewId);
export const serialize = () => instance().serialize();
export const toSVG = () => instance().toSVG();
export const moveEntry = (timelineId: Id, taskId: Id, patch: MovePatchData) =>
  instance().moveEntry(timelineId, taskId, patch);
export const addEntry = (task: Id | TaskData, target: EntryTargetData) => instance().addEntry(task, target);
export const targetAt = (x: number, y: number, task?: Id | TaskData) => instance().targetAt(x, y, task);
export const highlightTarget = (target: EntryTargetData | null) => instance().highlightTarget(target);
export const attachEvent = <K extends TimelineEventName>(name: K, handler: TimelineHandlers[K]) =>
  instance().attachEvent(name, handler);
export const detachEvent = (eventId: number) => instance().detachEvent(eventId);
export const selectTask = (id: Id, add?: boolean) => instance().selectTask(id, add);
export const selectTimeline = (id: Id, add?: boolean) => instance().selectTimeline(id, add);
export const unselectTask = (id: Id) => instance().unselectTask(id);
export const unselectTimeline = (id: Id) => instance().unselectTimeline(id);
export const clearSelection = () => instance().clearSelection();
export const getSelectedTasks = () => instance().getSelectedTasks();
export const getSelectedTimelines = () => instance().getSelectedTimelines();
export const setMarkerOffset = (markerId: Id, offset: Offset) => instance().setMarkerOffset(markerId, offset);
export const moveTimelineUp = (id: Id) => instance().moveTimelineUp(id);
export const moveTimelineDown = (id: Id) => instance().moveTimelineDown(id);
export const moveTimeline = (id: Id, delta: number) => instance().moveTimeline(id, delta);
export const on = <K extends keyof TimelineEvents>(name: K, handler: (event: TimelineEvents[K]) => void) =>
  instance().on(name, handler);
