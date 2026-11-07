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
  const hit = document.elementFromPoint(x, y);
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
 * Returns a function that detaches.
 */
export function attachDrag(
  root: HTMLElement,
  onDrop: (event: DropEvent) => void,
  onClick?: (entry: HTMLElement, event: PointerEvent) => void,
): () => void {
  let cleanup: (() => void) | undefined;

  const onPointerDown = (down: PointerEvent) => {
    if (down.button !== 0) return;
    const source = (down.target as Element).closest<HTMLElement>("[data-entry]");
    if (!source || !root.contains(source)) return;
    down.preventDefault();

    const rect = source.getBoundingClientRect();
    const grab = { x: down.clientX - rect.left, y: down.clientY - rect.top };
    const isCalloutSource = source.classList.contains("tlv-callout");
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
      }
      ghost.style.left = `${move.clientX - grab.x}px`;
      ghost.style.top = `${move.clientY - grab.y}px`;
      setHover(targetElementAt(root, move.clientX, move.clientY));
    };

    const finish = (up?: PointerEvent) => {
      const node = up && ghost ? targetElementAt(root, up.clientX, up.clientY) : null;
      const box = ghost?.getBoundingClientRect();
      const wasDrag = ghost !== undefined;
      cleanup?.();
      // Released without moving past the drag threshold: a click.
      if (up && !wasDrag) {
        onClick?.(source, up);
        return;
      }
      if (!node || !box || !up) return;

      const target = targetOf(node);
      const event: DropEvent = { timeline: source.dataset.timeline!, task: source.dataset.task!, target };
      if (target.placement !== "on") {
        // A bar or milestone dropped into a callout area gets its label's corner at the pointer.
        const point = { left: up.clientX, right: up.clientX, top: up.clientY, bottom: up.clientY, width: 0 };
        const dropped = isCalloutSource ? box : point;
        event.offset = calloutOffset(dropped, node.getBoundingClientRect(), Number(source.dataset.at), target.placement);
      }
      onDrop(event);
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
    };
  };

  root.addEventListener("pointerdown", onPointerDown);
  return () => {
    cleanup?.();
    root.removeEventListener("pointerdown", onPointerDown);
  };
}
