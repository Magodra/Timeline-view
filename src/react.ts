/**
 * Optional React wrapper: `import { Timeline } from "ar-timeline-view/react"`.
 *
 * A thin component around `TimelineView`. It creates the view when it mounts
 * and destroys it when it unmounts, loads `data` with `parse()` whenever the
 * prop changes (or `viewId` with `load()` when `apiUrl` is set), and passes
 * the view's events to `on...` props. The `ref` gives the `TimelineView`, for
 * everything else (`moveEntry`, `updateTask`, `toSVG`, ...).
 *
 * Written with `createElement` rather than JSX, so the library needs no JSX
 * setup. React is an optional peer dependency: only this entry imports it.
 */
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import {
  TimelineView,
  type DateFormatter,
  type Id,
  type TickFormatter,
  type TimelineEvents,
  type TimelineHandlers,
  type TimelineViewData,
} from "./index";

/** `entry_moved` → `EntryMoved`. */
type Pascal<S extends string> = S extends `${infer Head}_${infer Tail}` ? `${Capitalize<Head>}${Pascal<Tail>}` : Capitalize<S>;

/** A prop per view event: `onEntryMoved` for `entry_moved`, and so on. */
export type TimelineEventProps = {
  [K in keyof TimelineEvents as `on${Pascal<K>}`]?: (event: TimelineEvents[K]) => void;
};

/** The click and selection handlers (`attachEvent` events), as plain functions. */
export type TimelineHandlerProps = {
  [K in keyof TimelineHandlers]?: (...args: Parameters<TimelineHandlers[K]>) => void;
};

export interface TimelineProps extends TimelineEventProps, TimelineHandlerProps {
  /** The data to show. Loaded with `parse()` when the component mounts and whenever this changes (by identity). */
  data?: TimelineViewData;
  /** With `apiUrl`: the view to load with `GET /views/{viewId}`, again whenever it changes. */
  viewId?: Id;
  /** Base URL of the REST backend; changes are then saved there. Changing it creates a new view. */
  apiUrl?: string;
  /** Replacement for `fetch` (for tests or a mock backend). Changing it creates a new view. */
  fetch?: typeof fetch;
  /** How dates are written (the `format_date` option). Changing it redraws the view. */
  formatDate?: DateFormatter;
  /** How the time scale's labels are written (the `format_tick` option). Changing it redraws the view. */
  formatTick?: TickFormatter;
  /** Called when `data` is invalid or `viewId` can't be loaded. Without it, the error is thrown (to an error boundary) or logged. */
  onError?: (error: unknown) => void;
  /** Passed to the view's container element. */
  className?: string;
  style?: CSSProperties;
}

/** Every view event, each with its prop. `satisfies` makes the compiler flag an event added to the view but not here. */
const EVENT_PROPS = {
  entry_moved: "onEntryMoved",
  dragging_started: "onDraggingStarted",
  dragging_ended: "onDraggingEnded",
  move_failed: "onMoveFailed",
  marker_moved: "onMarkerMoved",
  entry_added: "onEntryAdded",
  entry_removed: "onEntryRemoved",
  timeline_moved: "onTimelineMoved",
  task_removed: "onTaskRemoved",
  task_updated: "onTaskUpdated",
  timeline_removed: "onTimelineRemoved",
  view_renamed: "onViewRenamed",
  timeline_updated: "onTimelineUpdated",
  timeline_renamed: "onTimelineRenamed",
  timeline_added: "onTimelineAdded",
  marker_added: "onMarkerAdded",
  marker_updated: "onMarkerUpdated",
  marker_removed: "onMarkerRemoved",
  marker_shown: "onMarkerShown",
  marker_hidden: "onMarkerHidden",
  save_failed: "onSaveFailed",
} as const satisfies { [K in keyof TimelineEvents]: `on${Pascal<K>}` };

const HANDLER_PROPS = ["onTaskClick", "onTimelineClick", "onTaskSelected", "onTimelineSelected"] as const satisfies readonly (keyof TimelineHandlers)[];

/**
 * A timeline view as a React component. The `ref` is the `TimelineView`
 * (null until mounted). Style the container with `className` or `style`; it
 * sizes like any container of the view (see the user guide, "Sizing the
 * container"). Import `ar-timeline-view/timelineview.css` once in the app.
 */
export const Timeline = forwardRef<TimelineView | null, TimelineProps>(function Timeline(props, ref) {
  const { data, viewId, apiUrl, fetch: fetchImpl, formatDate, formatTick, className, style } = props;
  const container = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<TimelineView | null>(null);
  // The latest props, so the view's listeners (subscribed once) always call the current handlers.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  useImperativeHandle<TimelineView | null, TimelineView | null>(ref, () => view, [view]);

  // One view per container, recreated only when the backend changes.
  useEffect(() => {
    const created = new TimelineView(container.current!, { api_url: apiUrl, fetch: fetchImpl });
    for (const [name, prop] of Object.entries(EVENT_PROPS) as [keyof TimelineEvents, keyof TimelineEventProps][]) {
      created.on(name, (event) => (latest.current[prop] as ((e: unknown) => void) | undefined)?.(event));
    }
    for (const prop of HANDLER_PROPS) {
      created.attachEvent(prop, (...args: unknown[]) => (latest.current[prop] as ((...a: unknown[]) => void) | undefined)?.(...args));
    }
    setView(created);
    return () => {
      created.destroy();
      setView(null);
    };
  }, [apiUrl, fetchImpl]);

  // Before `data` is parsed (effects run in order), so the first render already uses them.
  useEffect(() => {
    view?.setFormatters({ format_date: formatDate, format_tick: formatTick });
  }, [view, formatDate, formatTick]);

  const fail = (error: unknown) => {
    const onError = latest.current.onError;
    if (onError) onError(error);
    else throw error;
  };

  useEffect(() => {
    if (!view || data === undefined) return;
    try {
      view.parse(data);
    } catch (error) {
      fail(error);
    }
    // Not on `fail`: it reads the latest props itself.
  }, [view, data]);

  useEffect(() => {
    if (!view || viewId === undefined || !apiUrl) return;
    view.load(viewId).catch((error: unknown) => {
      if (latest.current.onError) latest.current.onError(error);
      else console.error(error);
    });
  }, [view, viewId, apiUrl]);

  return createElement("div", { ref: container, className, style });
});
