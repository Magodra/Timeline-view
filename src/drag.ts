import type { Offset, Placement } from "./types";

export type DropTarget =
  | { timeline: string; placement: "on"; line: number; newLine: boolean }
  | { timeline: string; placement: "above" | "below" };

/** A finished drag. IDs are the DOM's string form; the view maps them back. */
export interface DropEvent {
  timeline: string;
  task: string;
  target: DropTarget;
  /** Set when the target is a callout area. */
  offset?: Offset;
}

/** A marker label dropped somewhere: its new `marker_offset`. The id is the DOM's string form. */
export interface MarkerDropEvent {
  marker: string;
  offset: Offset;
}

/** What is being dragged, in the DOM's string form: an entry (timeline and task) or a marker's label. */
export interface DragSource {
  timeline?: string;
  task?: string;
  marker?: string;
}

/** Called when a press turns into a drag, and when the drag ends (`dropped`: released on a target, not cancelled). */
export interface DragHooks {
  onDragStart?: (source: DragSource) => void;
  onDragEnd?: (source: DragSource, dropped: boolean) => void;
}

/** Pointer travel, in px, before a press turns into a drag. */
const DRAG_THRESHOLD = 4;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
}

/**
 * Callout offset for a label dropped at `box` in the callout area `area`.
 * `at` is the attachment point as a fraction of the area's width. The
 * attachment point is on the bar's edge: the area's bottom above the bar, its
 * top below it. `y` is clamped so the label stays on its own side of the bar.
 */
export function calloutOffset(box: Rect, area: Rect, at: number, placement: "above" | "below"): Offset {
  const x = Math.round(box.left - (area.left + at * area.width));
  const y =
    placement === "above"
      ? Math.min(0, Math.round(box.bottom - area.bottom))
      : Math.max(1, Math.round(box.top - area.top)); // y = 0 would mean above
  return { x, y: y === 0 ? 0 : y }; // no -0
}

/** Distance from `y` to the vertical span of `rect`; 0 inside it. */
const verticalDistance = (rect: DOMRect, y: number) => Math.max(0, rect.top - y, y - rect.bottom);

/**
 * The drop target under the pointer: a bar line or a callout area. Outside
 * them all (beyond the view's edge, on a name label, or on the time scale),
 * the vertically nearest callout area, which then grows to fit the label.
 */
function targetElementAt(root: HTMLElement, x: number, y: number): HTMLElement | null {
  // The topmost element that is part of the view, so a host page's drag ghost
  // over the view doesn't hide what is under it.
  const hits = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
  const hit = hits.find((n) => n && root.contains(n) && !n.closest(".tlv-ghost"));
  const direct = hit?.closest<HTMLElement>(".tlv-line, .tlv-area");
  if (direct && root.contains(direct)) return direct;

  let nearest: HTMLElement | null = null;
  let best = Infinity;
  for (const area of root.querySelectorAll<HTMLElement>(".tlv-area")) {
    const d = verticalDistance(area.getBoundingClientRect(), y);
    if (d < best) [nearest, best] = [area, d];
  }
  return nearest;
}

/** Above or below the bar, for a drop target: a callout area's side, or for a bar line the nearer edge. */
function sideAt(node: HTMLElement | null, y: number): "above" | "below" | undefined {
  if (!node) return undefined;
  const placement = node.dataset.placement;
  if (placement === "above" || placement === "below") return placement;
  const bar = node.closest(".tlv-bar")?.getBoundingClientRect();
  return bar && y > (bar.top + bar.bottom) / 2 ? "below" : "above";
}

/**
 * Where a marker's label goes on `side`: the area above the topmost bar
 * showing the marker, or below the bottommost, and the line's position there.
 */
function markerHome(root: HTMLElement, marker: string, side: "above" | "below", near: HTMLElement | null) {
  const lines = [...root.querySelectorAll<HTMLElement>(":scope > .tlv-marker-line")].filter(
    (n) => n.dataset.marker === marker,
  );
  const rows = [...root.querySelectorAll<HTMLElement>(".tlv-timeline")];
  const index = (id: string | undefined) => rows.findIndex((n) => n.dataset.timeline === id);
  // A marker drawn on each timeline separately (global, without `absolute`) has
  // a line and label per timeline: use the one where the label is dropped.
  const at = near ? rows.indexOf(near) : -1;
  const own = lines.find((l) => index(l.dataset.from) <= at && at <= index(l.dataset.to));
  const line = own ?? (side === "above" ? lines[0] : lines[lines.length - 1]);
  const id = side === "above" ? line?.dataset.from : line?.dataset.to;
  const row = rows.find((n) => n.dataset.timeline === id);
  const area = row?.querySelector<HTMLElement>(`.tlv-area--${side}`);
  if (!line || !area) return undefined;
  // Where the line crosses the area, as a fraction of its width.
  const a = area.getBoundingClientRect();
  const l = line.getBoundingClientRect();
  return { area, side, at: (l.left + l.width / 2 - a.left) / a.width };
}

/**
 * Hit test for drops from outside the view: the bar line or callout area at
 * the point (client coordinates), with its element. Inside the view but on
 * no area (a name label, the time scale), the vertically nearest callout
 * area. Outside the view's box: null.
 */
export function hitTarget(root: HTMLElement, x: number, y: number): { node: HTMLElement; target: DropTarget } | null {
  const box = root.getBoundingClientRect();
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
  const node = targetElementAt(root, x, y);
  return node ? { node, target: targetOf(node) } : null;
}

/** The element for a drop target: a bar line (or half line) or a callout area. */
export function targetElement(root: HTMLElement, target: DropTarget): HTMLElement | null {
  const nodes = root.querySelectorAll<HTMLElement>(".tlv-line, .tlv-area");
  for (const node of nodes) {
    const t = targetOf(node);
    if (t.timeline !== target.timeline || t.placement !== target.placement) continue;
    if (t.placement !== "on" || target.placement !== "on") return node;
    if (t.line === target.line && t.newLine === target.newLine) return node;
  }
  return null;
}

function targetOf(node: HTMLElement): DropTarget {
  const timeline = node.dataset.timeline!;
  const placement = node.dataset.placement as Placement;
  if (placement !== "on") return { timeline, placement };
  return { timeline, placement, line: Number(node.dataset.line), newLine: node.dataset.newLine === "true" };
}

/**
 * Makes every `[data-entry]` inside `root` draggable. A press and release
 * without moving past the drag threshold is a click instead, reported to
 * `onClick` with the entry's element; a drag never reports a click.
 * The same kind of click elsewhere in a timeline or on the view's heading
 * (not on an entry) goes to `onBackgroundClick`, with the pressed element.
 * Returns a function that detaches.
 */
export function attachDrag(
  root: HTMLElement,
  onDrop: (event: DropEvent) => void,
  onClick?: (entry: HTMLElement, event: PointerEvent) => void,
  onBackgroundClick?: (target: HTMLElement, event: PointerEvent) => void,
  onMarkerDrop?: (event: MarkerDropEvent) => void,
  hooks: DragHooks = {},
): () => void {
  let cleanup: (() => void) | undefined;
  /** Cancels the press or drag in progress, ending it as Escape does. */
  let abort: (() => void) | undefined;

  /** A press on a timeline's background: a click if released without moving. */
  const trackBackgroundClick = (down: PointerEvent, target: HTMLElement) => {
    let moved = false;
    const onMove = (move: PointerEvent) => {
      if (Math.hypot(move.clientX - down.clientX, move.clientY - down.clientY) >= DRAG_THRESHOLD) moved = true;
    };
    const onUp = (up: PointerEvent) => {
      done();
      if (!moved) onBackgroundClick?.(target, up);
    };
    const done = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", done);
      cleanup = undefined;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", done);
    cleanup = done;
  };

  const onPointerDown = (down: PointerEvent) => {
    if (down.button !== 0) return;
    const pressed = down.target as Element;
    // The built-in controls (buttons, the editable name) handle their own clicks:
    // pressing one starts no drag and selects nothing.
    // So do the host's own interactive elements inside a bar (the `task_text` template).
    if (pressed.closest(".tlv-control, .tlv-name-text, button, a[href], input, select, textarea")) return;
    const source = pressed.closest<HTMLElement>("[data-entry]");
    if (!source || !root.contains(source)) {
      const background = pressed.closest<HTMLElement>(".tlv-timeline, .tlv-title");
      if (background && root.contains(background)) trackBackgroundClick(down, pressed as HTMLElement);
      return;
    }
    down.preventDefault();

    const rect = source.getBoundingClientRect();
    const grab = { x: down.clientX - rect.left, y: down.clientY - rect.top };
    const isCalloutSource = source.classList.contains("tlv-callout");
    // A marker's label can only sit at one end of its line: above the topmost
    // bar or below the bottommost. Its drop target is that area.
    const marker = source.dataset.marker;
    const dragSource: DragSource =
      marker !== undefined ? { marker } : { timeline: source.dataset.timeline, task: source.dataset.task };
    const markerTarget = (x: number, y: number) => {
      const node = targetElementAt(root, x, y);
      const side = sideAt(node, y);
      return side ? markerHome(root, marker!, side, node?.closest<HTMLElement>(".tlv-timeline") ?? null) : undefined;
    };
    let ghost: HTMLElement | undefined;
    let hover: HTMLElement | null = null;

    const setHover = (node: HTMLElement | null) => {
      if (node === hover) return;
      hover?.classList.remove("tlv-drop");
      node?.classList.add("tlv-drop");
      hover = node;
    };

    const onMove = (move: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(move.clientX - down.clientX, move.clientY - down.clientY) < DRAG_THRESHOLD) return;
        ghost = source.cloneNode(true) as HTMLElement;
        ghost.classList.add("tlv-ghost");
        ghost.removeAttribute("data-entry");
        Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px`, margin: "0" });
        root.append(ghost);
        source.classList.add("tlv-dragging");
        root.classList.add("tlv--dragging");
        hooks.onDragStart?.(dragSource);
      }
      ghost.style.left = `${move.clientX - grab.x}px`;
      ghost.style.top = `${move.clientY - grab.y}px`;
      setHover(
        marker !== undefined
          ? (markerTarget(move.clientX, move.clientY)?.area ?? null)
          : targetElementAt(root, move.clientX, move.clientY),
      );
    };

    const finish = (up?: PointerEvent) => {
      const node = up && ghost ? targetElementAt(root, up.clientX, up.clientY) : null;
      const box = ghost?.getBoundingClientRect();
      const wasDrag = ghost !== undefined;
      // Ends the drag first (the view's isDragging() is false from here on),
      // then applies the drop, then reports the end.
      cleanup?.();
      // Released without moving past the drag threshold: a click.
      if (up && !wasDrag) {
        onClick?.(source, up);
        return;
      }
      if (!wasDrag) return;
      const dropped = drop(up, node, box);
      hooks.onDragEnd?.(dragSource, dropped);
    };

    /** Applies a drop; false if there is nothing to drop on (or the drag was cancelled). */
    const drop = (up: PointerEvent | undefined, node: HTMLElement | null, box: DOMRect | undefined): boolean => {
      if (!node || !box || !up) return false;

      if (marker !== undefined) {
        const home = markerTarget(up.clientX, up.clientY);
        if (!home) return false;
        const offset = calloutOffset(box, home.area.getBoundingClientRect(), home.at, home.side);
        onMarkerDrop?.({ marker, offset });
        return true;
      }

      const target = targetOf(node);
      const event: DropEvent = { timeline: source.dataset.timeline!, task: source.dataset.task!, target };
      if (target.placement !== "on") {
        // A bar or milestone dropped into a callout area gets its label's corner at the pointer.
        const point = { left: up.clientX, right: up.clientX, top: up.clientY, bottom: up.clientY, width: 0 };
        const dropped = isCalloutSource ? box : point;
        event.offset = calloutOffset(dropped, node.getBoundingClientRect(), Number(source.dataset.at), target.placement);
      }
      onDrop(event);
      return true;
    };

    const onUp = (up: PointerEvent) => finish(up);
    const onCancel = () => finish();
    const onKey = (key: KeyboardEvent) => {
      if (key.key === "Escape") finish();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    abort = () => finish();
    cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      setHover(null);
      ghost?.remove();
      source.classList.remove("tlv-dragging");
      root.classList.remove("tlv--dragging");
      cleanup = undefined;
      abort = undefined;
    };
  };

  root.addEventListener("pointerdown", onPointerDown);
  return () => {
    // A drag in progress is cancelled, so it still reports its end.
    if (abort) abort();
    else cleanup?.();
    root.removeEventListener("pointerdown", onPointerDown);
  };
}
