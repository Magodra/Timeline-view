import { formatDate } from "./dates";
import { firstLine, lineCount, viewRange, type Entry, type Task, type Timeline, type TimelineModel } from "./model";
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

/** Replaces the contents of `root` with the rendered view. */
export function render(root: HTMLElement, model: TimelineModel): void {
  root.classList.add("tlv");
  root.classList.toggle("tlv--no-dates", !model.view.showDates);
  root.replaceChildren(...model.timelines.map((t) => renderTimeline(model, t)));
  // The view's name, if it has one, as a heading above the timelines.
  if (model.view.name.trim()) {
    const title = el("div", "tlv-title", model.view.name);
    title.setAttribute("role", "heading");
    title.setAttribute("aria-level", "2");
    root.prepend(title);
  }
  layoutConnectors(root);
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

/** Marks a task that continues past its timeline's start or finish. */
function continuation(node: HTMLElement, base: string, before: boolean, after: boolean): void {
  node.classList.toggle(`${base}--before`, before);
  node.classList.toggle(`${base}--after`, after);
}

function renderTimeline(model: TimelineModel, timeline: Timeline): HTMLElement {
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
  spanNode.append(
    renderCalloutArea(model, timeline, "above"),
    renderBar(model, timeline),
    renderCalloutArea(model, timeline, "below"),
  );
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

function taskDates(task: Task): string {
  return task.isMilestone ? formatDate(task.start) : `${formatDate(task.start)} – ${formatDate(task.finish)}`;
}

function dateLabel(kind: "start" | "finish", caption: string, date: Date): HTMLElement {
  const node = el("div", `tlv-date tlv-date--${kind}`);
  node.append(el("span", "tlv-date-caption", caption), el("span", "tlv-date-value", formatDate(date)));
  return node;
}

function renderBar(model: TimelineModel, timeline: Timeline): HTMLElement {
  const { scale, showDates } = model.view;
  const { start, finish } = timeline;
  const bar = el("div", "tlv-bar");
  if (showDates) bar.append(dateLabel("start", "Start", start), dateLabel("finish", "Finish", finish));

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
    const t = el("span", "tlv-tick", tick.label);
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
      if (entry.placement === "on" && entry.line === line) node.append(renderOnEntry(model, timeline, entry));
    }
    track.append(node);
  }
  track.append(lineNode(lines, true));

  bar.append(scaleRow, track);
  return bar;
}

function renderOnEntry(model: TimelineModel, timeline: Timeline, entry: Entry): HTMLElement {
  const task = model.findTask(entry.taskId)!;
  const { from, to, center, before, after } = span(timeline, task);
  const title = `${task.text} (${taskDates(task)})`;

  if (task.isMilestone) {
    const node = entryElement("tlv-milestone", timeline, entry, center);
    node.style.left = pct(from);
    node.title = title;
    node.append(
      el("span", `tlv-symbol tlv-symbol--${task.symbol ?? model.view.milestoneSymbol}`),
      el("span", "tlv-milestone-label", task.text),
    );
    return node;
  }

  const node = entryElement("tlv-task", timeline, entry, center);
  placeSpan(node, "tlv-task", from, to);
  node.title = title;
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
function renderCalloutArea(model: TimelineModel, timeline: Timeline, placement: "above" | "below"): HTMLElement {
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

    const connector = el("div", "tlv-connector");
    connector.style.left = pct(center);
    connector.style[placement === "above" ? "bottom" : "top"] = `${reach}px`;

    const box = entryElement("tlv-callout", timeline, entry, center);
    Object.assign(box.dataset, { x: String(x), y: String(y), reach: String(reach) });
    box.style.marginLeft = `calc(${pct(center)} + ${x}px)`;
    // y is from the bar to the label's near edge: negative above, positive below.
    if (placement === "above") box.style.marginBottom = `${-y}px`;
    else box.style.marginTop = `${y}px`;
    box.title = `${task.text} (${taskDates(task)})`;
    box.append(el("div", "tlv-callout-title", task.text), el("div", "tlv-callout-dates", taskDates(task)));

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
  for (const box of root.querySelectorAll<HTMLElement>(".tlv-callout")) {
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
