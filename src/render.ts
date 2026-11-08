import { formatDate } from "./dates";
import type { DateKind, Scale } from "./types";
import type { Tick } from "./scale";
import { firstLine, lineCount, viewRange, type Entry, type Marker, type Task, type Timeline, type TimelineModel } from "./model";
import { fraction, periodSerial, ticks } from "./scale";

/** Bar line height in px. The drag code reads positions from the DOM, so only rendering uses this. */
export const BAR_LINE_HEIGHT = 28;

/**
 * How far, in px, each callout's edge marker sticks out from the bar. The
 * connector starts there: at the marker's outer edge, in its middle.
 * Keep in step with .tlv-edge-bar and .tlv-edge-symbol in styles.css.
 */
export const EDGE_BAR_HEIGHT = 6;
export const EDGE_SYMBOL_REACH = 8;

/** Width, in px, of a task drawn at the edge because it lies entirely outside its timeline's range. */
const TASK_STUB_WIDTH = 14;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const pct = (n: number) => `${(n * 100).toFixed(4)}%`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** How dates and time-scale labels are written; the view builds one from its options. */
export interface Display {
  date: (date: Date, kind: DateKind) => string;
  tick: (tick: Tick, scale: Scale) => string;
}

/** The built-in formats: ISO-style dates in UTC, English month names. */
export const defaultDisplay: Display = {
  date: (date) => formatDate(date),
  tick: (tick) => tick.label,
};

/** Replaces the contents of `root` with the rendered view. */
export function render(root: HTMLElement, model: TimelineModel, display: Display = defaultDisplay): void {
  root.classList.add("tlv");
  root.classList.toggle("tlv--no-dates", !model.view.showDates);
  const markers = markerPlan(model);
  root.replaceChildren(...model.timelines.map((t) => renderTimeline(model, t, markers.get(String(t.id)) ?? [], display)));
  root.append(...markerLines(model, markers));
  // The view's name, if it has one, as a heading above the timelines.
  if (model.view.name.trim()) {
    const title = el("div", "tlv-title", model.view.name);
    title.setAttribute("role", "heading");
    title.setAttribute("aria-level", "2");
    root.prepend(title);
  }
  layout(root);
  watchLayout(root);
}

/**
 * The parts of the layout that depend on measured sizes: connector angles
 * (label widths), which tick labels fit (the bar's width), and marker lines
 * (the bars' positions). Runs after every render, and again whenever the view
 * or a timeline changes size or fonts finish loading. Does nothing while the
 * view is hidden (`display: none`, as in an inactive tab): nothing can be
 * measured then, and showing it again changes its size, which lays it out.
 */
export function layout(root: HTMLElement): void {
  if (!root.isConnected || (root.offsetWidth === 0 && root.offsetHeight === 0 && root.getClientRects().length === 0)) {
    return;
  }
  layoutConnectors(root);
  layoutTicks(root);
  layoutMarkerLines(root);
}

/** Space, in px, kept between two tick labels. */
const TICK_GAP = 4;

/**
 * Hides tick labels that would overlap others, so a narrow bar shows every
 * second (or third, ...) label instead of a jumble. Major labels (with the
 * year or date, `.tlv-tick--major`) are placed first so the context stays,
 * from right to left: when the first label (which also shows the year) and a
 * new year's label next to it collide, the new year wins. The rest then fill
 * the room between them, from left to right. Measures all
 * labels first, then hides, so the browser lays out only once.
 */
function layoutTicks(root: HTMLElement): void {
  for (const scale of root.querySelectorAll<HTMLElement>(".tlv-scale")) {
    const ticks = [...scale.querySelectorAll<HTMLElement>(".tlv-tick")];
    for (const tick of ticks) tick.hidden = false;
    const boxes = ticks.map((tick) => tick.getBoundingClientRect());
    const placed: { left: number; right: number }[] = [];
    const fits = (b: DOMRect) => placed.every((p) => b.left >= p.right + TICK_GAP || b.right + TICK_GAP <= p.left);
    const show = new Set<number>();
    const place = (i: number) => {
      if (!fits(boxes[i])) return;
      placed.push(boxes[i]);
      show.add(i);
    };
    const isMajor = (i: number) => ticks[i].classList.contains("tlv-tick--major");
    for (let i = ticks.length - 1; i >= 0; i--) if (isMajor(i)) place(i);
    for (let i = 0; i < ticks.length; i++) if (!isMajor(i)) place(i);
    ticks.forEach((tick, i) => (tick.hidden = !show.has(i)));
  }
}

/**
 * A task's span within its timeline, as fractions of the bar's width, clamped
 * to the bar. `before` and `after` say a task continues past the timeline's
 * start or finish (milestones never do).
 */
function span(timeline: Timeline, task: Task) {
  const { start, finish } = timeline;
  const from = clamp01(fraction(task.start, start, finish));
  const to = task.isMilestone ? from : clamp01(fraction(task.finish, start, finish));
  const before = !task.isMilestone && task.start < start;
  const after = !task.isMilestone && task.finish > finish;
  return { from, to, center: (from + to) / 2, before, after };
}

/** A task's callout attachment point on `timeline`, as a fraction of the bar's width (as `data-at` holds it). */
export const attachAt = (timeline: Timeline, task: Task): number => span(timeline, task).center;

/**
 * Positions a bar-like element over a span. A task entirely outside the range
 * keeps a small stub at the nearest edge, marked `--outside-before` or
 * `--outside-after` so its label can go on the inner side.
 */
function placeSpan(node: HTMLElement, base: string, from: number, to: number): void {
  if (to <= 0) {
    node.style.left = "0";
    node.style.width = `${TASK_STUB_WIDTH}px`;
    node.classList.add(`${base}--outside-before`);
  } else if (from >= 1) {
    node.style.left = `calc(100% - ${TASK_STUB_WIDTH}px)`;
    node.style.width = `${TASK_STUB_WIDTH}px`;
    node.classList.add(`${base}--outside-after`);
  } else {
    node.style.left = pct(from);
    node.style.width = pct(to - from);
  }
}

/**
 * A task's own color: sets the theme variable the element is drawn with, so
 * the drag ghost (a copy of the element) and the SVG export follow it too.
 */
function applyColor(node: HTMLElement, task: Task): void {
  if (task.color) node.style.setProperty(task.isMilestone ? "--tlv-milestone" : "--tlv-task", task.color);
}

/** Marks a task that continues past its timeline's start or finish. */
function continuation(node: HTMLElement, base: string, before: boolean, after: boolean): void {
  node.classList.toggle(`${base}--before`, before);
  node.classList.toggle(`${base}--after`, after);
}

/** What one timeline draws of one marker. */
interface MarkerPart {
  marker: Marker;
  /** The marker's date as a fraction of this timeline's bar (outside 0..1 is fine with `absolute`). */
  at: number;
  /** The line continues up through the area above the bar, to the timeline above. */
  up: boolean;
  /** The line continues down through the area below the bar, to the timeline below. */
  down: boolean;
  /** The label goes in this timeline's area above or below the bar. */
  label?: "above" | "below";
}

/**
 * Where each marker is drawn, per timeline. The line runs from the topmost
 * bar showing the marker (every timeline for a global one) to the bottommost,
 * crossing the timelines in between. Without `absolute` each timeline has its
 * own time axis, so timelines whose range doesn't hold the date are skipped,
 * and a global marker is drawn on each timeline separately.
 * The label sits above the topmost bar, or below the bottommost if
 * `marker_offset.y > 0`.
 */
function markerPlan(model: TimelineModel): Map<string, MarkerPart[]> {
  const plan = new Map<string, MarkerPart[]>();
  const timelines = model.timelines;
  const range = viewRange(model);
  for (const marker of model.markers) {
    if (model.view.absolute && range && clamp01(fraction(marker.date, range.start, range.finish)) !== fraction(marker.date, range.start, range.finish)) {
      continue; // outside the whole view
    }
    const shown = timelines
      .map((t, i) => (marker.global || t.markers.some((id) => String(id) === String(marker.id)) ? i : -1))
      .filter((i) => i >= 0);
    if (shown.length === 0) continue;
    const below = marker.offset.y > 0;

    // A global marker without `absolute`: the timelines have their own time
    // axes, so a line joining them would mean nothing. Each timeline whose
    // range holds the date gets the marker on its own, as if it had been
    // added to that timeline alone: a line across its bar and its own label.
    if (marker.global && !model.view.absolute) {
      for (const t of timelines) {
        const at = fraction(marker.date, t.start, t.finish);
        if (at < 0 || at > 1) continue;
        const parts = plan.get(String(t.id)) ?? [];
        parts.push({ marker, at, up: false, down: false, label: below ? "below" : "above" });
        plan.set(String(t.id), parts);
      }
      continue;
    }

    const rows: Array<{ index: number; at: number }> = [];
    for (let i = Math.min(...shown); i <= Math.max(...shown); i++) {
      const at = fraction(marker.date, timelines[i].start, timelines[i].finish);
      if (model.view.absolute || (at >= 0 && at <= 1)) rows.push({ index: i, at });
    }
    if (rows.length === 0) continue;

    const top = rows[0].index;
    const bottom = rows[rows.length - 1].index;
    for (const { index, at } of rows) {
      const parts = plan.get(String(timelines[index].id)) ?? [];
      parts.push({
        marker,
        at,
        up: index !== top,
        down: index !== bottom,
        label: !below && index === top ? "above" : below && index === bottom ? "below" : undefined,
      });
      plan.set(String(timelines[index].id), parts);
    }
  }
  return plan;
}

/** A marker's color: sets the theme variable its line, label and connector are drawn with. */
function markerColor(node: HTMLElement, marker: Marker): HTMLElement {
  if (marker.color) node.style.setProperty("--tlv-marker", marker.color);
  return node;
}

/**
 * A marker's line as single elements, one per straight run down the
 * timelines, so its width can't vary along the way. With `absolute` the whole
 * line is one run. Without it, a run breaks where the next timeline's own axis
 * puts the date somewhere else. Each element sits in the view's root;
 * `layoutMarkerLines` measures the bars to place it.
 */
function markerLines(model: TimelineModel, plan: Map<string, MarkerPart[]>): HTMLElement[] {
  const lines: HTMLElement[] = [];
  for (const marker of model.markers) {
    const rows = model.timelines.flatMap((t) => {
      const part = plan.get(String(t.id))?.find((p) => p.marker === marker);
      return part ? [{ timeline: t, part }] : [];
    });
    let run: typeof rows = [];
    const flush = () => {
      if (run.length === 0) return;
      const first = run[0];
      const last = run[run.length - 1];
      const line = markerColor(el("span", "tlv-marker-line"), marker);
      Object.assign(line.dataset, {
        marker: String(marker.id),
        from: String(first.timeline.id),
        to: String(last.timeline.id),
        at: String(first.part.at),
        // Starts at the bar's top unless it comes from a timeline above; ends at the bar's bottom unless it goes on.
        top: first.part.up ? "row" : "bar",
        bottom: last.part.down ? "row" : "bar",
      });
      lines.push(line);
      run = [];
    };
    for (const row of rows) {
      const prev = run[run.length - 1];
      const joins =
        prev !== undefined &&
        prev.part.down &&
        row.part.up &&
        model.timelines.indexOf(row.timeline) === model.timelines.indexOf(prev.timeline) + 1 &&
        (model.view.absolute || Math.abs(prev.part.at - row.part.at) < 1e-9);
      if (!joins) flush();
      run.push(row);
    }
    flush();
  }
  return lines;
}

/**
 * Places each marker line: horizontally at its date on the first timeline's
 * span, vertically from that timeline's bar top (or row top) to the last
 * one's bar bottom (or row bottom). Being one element, it is drawn with
 * the same width everywhere.
 *
 * Positions are measured in the viewport and converted using where a line
 * placed at 0,0 actually lands, so borders and scrolling of the view (and
 * how the browser treats them) don't matter.
 */
export function layoutMarkerLines(root: HTMLElement): void {
  const lines = [...root.querySelectorAll<HTMLElement>(":scope > .tlv-marker-line")];
  if (lines.length === 0) return;
  const rows = [...root.querySelectorAll<HTMLElement>(".tlv-timeline")];
  const row = (id: string | undefined) => rows.find((n) => n.dataset.timeline === id);

  lines[0].style.left = "0px";
  lines[0].style.top = "0px";
  const origin = lines[0].getBoundingClientRect();

  for (const line of lines) {
    const first = row(line.dataset.from);
    const last = row(line.dataset.to);
    const span = first?.querySelector(".tlv-span")?.getBoundingClientRect();
    const topBar = first?.querySelector(".tlv-bar")?.getBoundingClientRect();
    const bottomBar = last?.querySelector(".tlv-bar")?.getBoundingClientRect();
    if (!first || !last || !span || !topBar || !bottomBar) continue;
    const x = span.left + Number(line.dataset.at) * span.width;
    const top = line.dataset.top === "bar" ? topBar.top : first.getBoundingClientRect().top;
    const bottom = line.dataset.bottom === "bar" ? bottomBar.bottom : last.getBoundingClientRect().bottom;
    line.style.left = `${x - 1 - origin.left}px`; // centered on the date
    line.style.top = `${top - origin.top}px`;
    line.style.height = `${Math.max(0, bottom - top)}px`;
  }
}

/**
 * Lays the view out again when it or one of its timelines changes size: the
 * host resizing the container (a split or docking panel being dragged), the
 * window resizing, the view being shown after being hidden, or fonts loading.
 */
const observers = new WeakMap<HTMLElement, ResizeObserver>();
function watchLayout(root: HTMLElement): void {
  // Labels are measured; web fonts that arrive later change their widths.
  if (typeof document !== "undefined" && document.fonts?.status === "loading") {
    document.fonts.ready.then(() => layout(root)).catch(() => undefined);
  }
  if (typeof ResizeObserver === "undefined") return;
  let observer = observers.get(root);
  if (!observer) {
    // The layout only moves absolutely positioned parts and hides tick
    // labels, which changes no observed size, so it can't loop.
    observer = new ResizeObserver(() => layout(root));
    observers.set(root, observer);
  }
  observer.disconnect();
  observer.observe(root);
  for (const row of root.querySelectorAll(".tlv-timeline")) observer.observe(row);
}

/** Stops watching the view's layout (when the view is destroyed). */
export function unwatchLayout(root: HTMLElement): void {
  observers.get(root)?.disconnect();
  observers.delete(root);
}

/** A marker's label, placed like a callout, with a connector from the line's end on the bar's edge. */
function markerLabel(part: MarkerPart, placement: "above" | "below", display: Display): HTMLElement[] {
  const { marker, at } = part;
  const { x, y } = marker.offset;
  const connector = markerColor(el("div", "tlv-connector tlv-connector--marker"), marker);
  connector.style.left = pct(at);
  connector.style[placement === "above" ? "bottom" : "top"] = "0";

  const box = markerColor(el("div", "tlv-marker-label"), marker);
  // Draggable like a callout (data-entry); drag.ts tells it apart by data-marker.
  Object.assign(box.dataset, { entry: "", marker: String(marker.id), at: String(at), x: String(x), y: String(y), reach: "0" });
  box.style.marginLeft = `calc(${pct(at)} + ${x}px)`;
  if (placement === "above") box.style.marginBottom = `${-y}px`;
  else box.style.marginTop = `${y}px`;
  const date = display.date(marker.date, "marker");
  box.title = `${marker.text} (${date})`;
  box.append(el("div", "tlv-callout-title", marker.text), el("div", "tlv-callout-dates", date));
  return [connector, box];
}

function renderTimeline(model: TimelineModel, timeline: Timeline, markers: MarkerPart[], display: Display): HTMLElement {
  const row = el("section", `tlv-timeline tlv-timeline--name-${model.view.namePosition}`);
  row.dataset.timeline = String(timeline.id);
  row.setAttribute("aria-label", timeline.name);

  // The span holds the bar and its callout areas. It fills the width, or with
  // `absolute` sits at the timeline's place on the view's common time axis.
  const spanNode = el("div", "tlv-span");
  const range = viewRange(model);
  if (model.view.absolute && range) {
    const from = fraction(timeline.start, range.start, range.finish);
    const to = fraction(timeline.finish, range.start, range.finish);
    spanNode.style.marginLeft = pct(from);
    spanNode.style.width = pct(to - from);
  }
  const above = renderCalloutArea(model, timeline, "above", display);
  const bar = renderBar(model, timeline, display);
  const below = renderCalloutArea(model, timeline, "below", display);
  spanNode.append(above, bar, below);
  for (const part of markers) {
    if (part.label) (part.label === "above" ? above : below).append(...markerLabel(part, part.label, display));
  }
  const center = el("div", "tlv-center");
  center.append(spanNode);
  row.append(el("div", "tlv-name", timeline.name), center);
  return row;
}

/** Marks an element as draggable. `at` is the callout attachment point, as a fraction of the width. */
function entryElement(className: string, timeline: Timeline, entry: Entry, at: number) {
  const node = el("div", className);
  node.dataset.entry = "";
  node.dataset.timeline = String(timeline.id);
  node.dataset.task = String(entry.taskId);
  node.dataset.at = String(at);
  return node;
}

function taskDates(task: Task, display: Display): string {
  if (task.isMilestone) return display.date(task.start, "milestone");
  return `${display.date(task.start, "task_start")} – ${display.date(task.finish, "task_finish")}`;
}

function dateLabel(kind: "start" | "finish", caption: string, date: Date, display: Display): HTMLElement {
  const node = el("div", `tlv-date tlv-date--${kind}`);
  node.append(el("span", "tlv-date-caption", caption), el("span", "tlv-date-value", display.date(date, kind === "start" ? "timeline_start" : "timeline_finish")));
  return node;
}

function renderBar(model: TimelineModel, timeline: Timeline, display: Display): HTMLElement {
  const { scale, showDates } = model.view;
  const { start, finish } = timeline;
  const bar = el("div", "tlv-bar");
  if (showDates) bar.append(dateLabel("start", "Start", start, display), dateLabel("finish", "Finish", finish, display));

  // Time scale: periods between ticks, alternately light and darker, with the
  // tick labels on top. The shading follows the calendar period, so it lines
  // up across timelines that start on different dates.
  const scaleRow = el("div", "tlv-scale");
  const tickList = ticks(start, finish, scale);
  const edges = [
    { at: 0, serial: periodSerial(start, scale) },
    ...tickList.filter((t) => t.at > 0 && t.at < 1).map((t) => ({ at: t.at, serial: t.serial })),
    { at: 1, serial: 0 },
  ];
  for (let i = 0; i < edges.length - 1; i++) {
    const period = el("span", `tlv-period${edges[i].serial % 2 ? " tlv-period--alt" : ""}`);
    period.style.left = pct(edges[i].at);
    period.style.width = pct(edges[i + 1].at - edges[i].at);
    scaleRow.append(period);
  }
  for (const tick of tickList) {
    if (tick.at >= 1) continue;
    const t = el("span", tick.major ? "tlv-tick tlv-tick--major" : "tlv-tick", display.tick(tick, scale));
    t.style.left = pct(tick.at);
    scaleRow.append(t);
  }

  // Bar lines from the first used one to the last, with a virtual half line
  // above and below: dropping there inserts a new line. Blank lines above the
  // first used one (possible in loaded data) are not shown.
  const track = el("div", "tlv-track");
  const lineNode = (line: number, newLine: boolean) => {
    const node = el("div", newLine ? "tlv-line tlv-line--new" : "tlv-line");
    node.dataset.timeline = String(timeline.id);
    node.dataset.placement = "on";
    node.dataset.line = String(line);
    if (newLine) node.dataset.newLine = "true";
    node.style.height = `${newLine ? BAR_LINE_HEIGHT / 2 : BAR_LINE_HEIGHT}px`;
    return node;
  };
  const first = firstLine(timeline);
  const lines = lineCount(timeline);
  track.append(lineNode(first, true));
  for (let line = first; line < lines; line++) {
    const node = lineNode(line, false);
    for (const entry of timeline.entries) {
      if (entry.placement === "on" && entry.line === line) node.append(renderOnEntry(model, timeline, entry, display));
    }
    track.append(node);
  }
  track.append(lineNode(lines, true));

  bar.append(scaleRow, track);
  return bar;
}

function renderOnEntry(model: TimelineModel, timeline: Timeline, entry: Entry, display: Display): HTMLElement {
  const task = model.findTask(entry.taskId)!;
  const { from, to, center, before, after } = span(timeline, task);
  const title = `${task.text} (${taskDates(task, display)})`;

  if (task.isMilestone) {
    const node = entryElement("tlv-milestone", timeline, entry, center);
    node.style.left = pct(from);
    node.title = title;
    applyColor(node, task);
    node.append(
      el("span", `tlv-symbol tlv-symbol--${task.symbol ?? model.view.milestoneSymbol}`),
      el("span", "tlv-milestone-label", task.text),
    );
    return node;
  }

  const node = entryElement("tlv-task", timeline, entry, center);
  placeSpan(node, "tlv-task", from, to);
  node.title = title;
  applyColor(node, task);
  // The stylesheet moves the label beside the bar when the bar is too narrow for it.
  node.append(el("span", "tlv-task-label", task.text));
  // A task that continues past the timeline's start or finish gets an arrow at that end.
  continuation(node, "tlv-task", before, after);
  if (before) node.append(el("span", "tlv-arrow tlv-arrow--before"));
  if (after) node.append(el("span", "tlv-arrow tlv-arrow--after"));
  return node;
}

/**
 * A callout area is a one-cell grid: every label sits in the same cell and is
 * pushed into place with margins, so the area grows to contain all labels.
 * Each callout also gets a marker on the bar's edge: its milestone symbol, or
 * a short bar over the task's span with rounded outer corners.
 */
function renderCalloutArea(model: TimelineModel, timeline: Timeline, placement: "above" | "below", display: Display): HTMLElement {
  const area = el("div", `tlv-area tlv-area--${placement}`);
  area.dataset.timeline = String(timeline.id);
  area.dataset.placement = placement;

  for (const entry of timeline.entries) {
    if (entry.placement !== placement) continue;
    const task = model.findTask(entry.taskId)!;
    const { from, to, center, before, after } = span(timeline, task);
    const { x, y } = entry.calloutOffset;

    let marker: HTMLElement;
    let reach: number;
    if (task.isMilestone) {
      marker = el("span", `tlv-edge-symbol tlv-symbol tlv-symbol--${task.symbol ?? model.view.milestoneSymbol}`);
      marker.style.left = pct(center);
      reach = EDGE_SYMBOL_REACH;
    } else {
      marker = el("span", "tlv-edge-bar");
      placeSpan(marker, "tlv-edge-bar", from, to);
      // A task that continues past the range gets a pointed end there.
      continuation(marker, "tlv-edge-bar", before, after);
      reach = EDGE_BAR_HEIGHT;
    }
    applyColor(marker, task);

    const connector = el("div", "tlv-connector");
    connector.style.left = pct(center);
    connector.style[placement === "above" ? "bottom" : "top"] = `${reach}px`;

    const box = entryElement("tlv-callout", timeline, entry, center);
    Object.assign(box.dataset, { x: String(x), y: String(y), reach: String(reach) });
    box.style.marginLeft = `calc(${pct(center)} + ${x}px)`;
    // y is from the bar to the label's near edge: negative above, positive below.
    if (placement === "above") box.style.marginBottom = `${-y}px`;
    else box.style.marginTop = `${y}px`;
    box.title = `${task.text} (${taskDates(task, display)})`;
    box.append(el("div", "tlv-callout-title", task.text), el("div", "tlv-callout-dates", taskDates(task, display)));

    area.append(marker, connector, box);
  }
  return area;
}

/**
 * Points each connector from the middle of its edge marker's outer edge to the
 * nearest point on its label's near edge. Needs the label widths, so it runs
 * after the DOM is built. All of this is relative to the attachment point, so
 * it survives resizes.
 */
function layoutConnectors(root: HTMLElement): void {
  for (const box of root.querySelectorAll<HTMLElement>(".tlv-callout, .tlv-marker-label")) {
    const connector = box.previousElementSibling as HTMLElement;
    const x = Number(box.dataset.x);
    const y = Number(box.dataset.y);
    const reach = Number(box.dataset.reach);
    // The connector starts `reach` px out from the bar, on the label's side.
    const dy = box.parentElement!.classList.contains("tlv-area--above") ? y + reach : y - reach;
    const tx = Math.min(Math.max(0, x), x + box.offsetWidth);
    const length = Math.hypot(tx, dy);
    connector.style.width = `${length}px`;
    connector.style.transform = `rotate(${Math.atan2(dy, tx)}rad)`;
    connector.hidden = length < 1;
  }
}
