/** Space, in px, between the pointer and the tooltip. */
const POINTER_GAP = 14;

/**
 * Shows the view's own tooltips. Only elements with `data-tip` have one, which
 * render.ts sets when a tooltip template is in use. `build` makes the element
 * for an item, or null for none. It lives in the view's root, so a re-render
 * removes it, and it is `position: fixed`, so the view's overflow doesn't clip
 * it. Pressing an item hides its tooltip until the pointer goes elsewhere, and
 * none shows during a drag. Returns a function that detaches.
 */
export function attachTooltip(root: HTMLElement, build: (item: HTMLElement) => HTMLElement | null): () => void {
  let tip: HTMLElement | null = null;
  let current: HTMLElement | undefined;
  let pressed: HTMLElement | undefined;

  const hide = () => {
    tip?.remove();
    tip = null;
    current = undefined;
  };

  const itemAt = (target: EventTarget | null) => {
    const node = target as Element;
    if (root.classList.contains("tlv--dragging") || node.closest(".tlv-control")) return undefined;
    const item = node.closest<HTMLElement>("[data-tip]") ?? undefined;
    return item && root.contains(item) ? item : undefined;
  };

  const place = (e: PointerEvent, node: HTMLElement) => {
    const { width, height } = node.getBoundingClientRect();
    const fits = (at: number, size: number, room: number) => at + size <= room;
    const x = e.clientX + POINTER_GAP;
    const y = e.clientY + POINTER_GAP;
    node.style.left = `${Math.max(0, fits(x, width, window.innerWidth) ? x : e.clientX - POINTER_GAP - width)}px`;
    node.style.top = `${Math.max(0, fits(y, height, window.innerHeight) ? y : e.clientY - POINTER_GAP - height)}px`;
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const item = itemAt(e.target);
    if (item !== pressed) pressed = undefined;
    if (!item || item === pressed) {
      hide();
      return;
    }
    if (item !== current) {
      hide();
      tip = build(item);
      current = item;
      if (tip) root.append(tip);
    }
    if (tip) place(e, tip);
  };

  const onDown = (e: PointerEvent) => {
    pressed = itemAt(e.target);
    hide();
  };

  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointerleave", hide);
  return () => {
    hide();
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerdown", onDown);
    root.removeEventListener("pointerleave", hide);
  };
}
