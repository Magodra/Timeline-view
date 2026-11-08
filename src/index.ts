import type { EntryTargetData, Id, MarkerData, MarkerPatchData, MovePatchData, Offset, TaskData, TaskPatchData, TimelineData, TimelineUpdateData, TimelineViewData } from "./types";
import {
  TimelineView,
  type TimelineEventName,
  type TimelineEvents,
  type TimelineHandlers,
  type TimelineFormatters,
  type TimelineOptions,
} from "./view";

export * from "./types";
export { ApiError, RestClient } from "./api";
// The model is exported so JavaScript backends and mock servers can apply the same move rules.
export {
  MoveError,
  TimelineModel,
  addTargetFromData,
  entryToData,
  firstLine,
  lineCount,
  patchFromData,
  trimLines,
  timelineToData,
} from "./model";
export { parseDuration, addDuration } from "./duration";
export {
  MoveCancelledError,
  TimelineView,
  defaultFormatDate,
  defaultFormatTick,
  type TimelineFormatters,
  type EntryAddedEvent,
  type EntryMovedEvent,
  type MarkerAddedEvent,
  type MarkerMovedEvent,
  type MarkerRemovedEvent,
  type MarkerUpdatedEvent,
  type MarkerVisibilityEvent,
  type DraggingEndedEvent,
  type DraggingEvent,
  type EntryRemovedEvent,
  type MoveFailedEvent,
  type SaveAction,
  type SaveFailedEvent,
  type TimelineAddedEvent,
  type TaskRemovedEvent,
  type TaskUpdatedEvent,
  type TimelineMovedEvent,
  type TimelineRemovedEvent,
  type TimelineRenamedEvent,
  type TimelineUpdatedEvent,
  type ViewRenamedEvent,
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
export const resize = () => instance().resize();
export const isDragging = () => instance().isDragging();
export const setFormatters = (formatters: TimelineFormatters) => instance().setFormatters(formatters);
export const setControls = (on: boolean) => instance().setControls(on);
export const moveEntry = (timelineId: Id, taskId: Id, patch: MovePatchData) =>
  instance().moveEntry(timelineId, taskId, patch);
export const addEntry = (task: Id | TaskData, target: EntryTargetData) => instance().addEntry(task, target);
export const updateTask = (id: Id, patch: TaskPatchData) => instance().updateTask(id, patch);
export const removeEntry = (timelineId: Id, taskId: Id) => instance().removeEntry(timelineId, taskId);
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
export const addMarker = (data: MarkerData) => instance().addMarker(data);
export const updateMarker = (id: Id, patch: MarkerPatchData) => instance().updateMarker(id, patch);
export const removeMarker = (id: Id) => instance().removeMarker(id);
export const showMarker = (timelineId: Id, markerId: Id) => instance().showMarker(timelineId, markerId);
export const hideMarker = (timelineId: Id, markerId: Id) => instance().hideMarker(timelineId, markerId);
export const moveTimelineUp = (id: Id) => instance().moveTimelineUp(id);
export const moveTimelineDown = (id: Id) => instance().moveTimelineDown(id);
export const moveTimeline = (id: Id, delta: number) => instance().moveTimeline(id, delta);
export const removeTask = (id: Id) => instance().removeTask(id);
export const removeTimeline = (id: Id) => instance().removeTimeline(id);
export const addTimeline = (data: TimelineData, position?: number) => instance().addTimeline(data, position);
export const whenSaved = () => instance().whenSaved();
export const renameView = (name: string) => instance().renameView(name);
export const renameTimeline = (id: Id, name: string) => instance().renameTimeline(id, name);
export const updateTimeline = (id: Id, patch: TimelineUpdateData) => instance().updateTimeline(id, patch);
export const on = <K extends keyof TimelineEvents>(name: K, handler: (event: TimelineEvents[K]) => void) =>
  instance().on(name, handler);
