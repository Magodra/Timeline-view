import { formatDate } from "./dates";
import { firstLine, lineCount, type Entry, type Task, type Timeline, type TimelineModel } from "./model";
import { fraction, ticks } from "./scale";

/** Bar line height in px. The drag code reads positions from the DOM, so only rendering uses this. */
export const BAR_LINE_HEIGHT = 28;

/**
 * How far, in px, each callout's edge marker sticks out from the bar. The
 * connector starts there: at the marker's outer edge, in its middle.
 * Keep in step with .tlv-edge-bar and .tlv-edge-symbol in styles.css.
 */
export const EDGE_BAR_HEIGHT = 6;
export const EDGE_SYMBOL_REACH = 8;

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
  layoutConnectors(root);
}

/** A task's span within the view, as fractions of the width, clamped to the view. */
function span(model: TimelineModel, task: Task) {
  const { start, finish } = model.view;
  const from = clamp01(fraction(task.start, start, finish));
  const to = task.isMilestone ? from : clamp01(fraction(task.finish, start, finish));
  return { from, to, center: (from + to) / 2 };
}

function renderTimeline(model: TimelineModel, timeline: Timeline): HTMLElement {
  const row = el("section", `tlv-timeline tlv-timeline--name-${model.view.namePosition}`);
  row.dataset.timeline = String(timeline.id);
  row.setAttribute("aria-label", timeline.name);

  const center = el("div", "tlv-center");
  center.append(
    renderCalloutArea(model, timeline, "above"),
    renderBar(model, timeline),
    renderCalloutArea(model, timeline, "below"),
  );
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
  const { start, finish, scale, showDates } = model.view;
  const bar = el("div", "tlv-bar");
  if (showDates) bar.append(dateLabel("start", "Start", start), dateLabel("finish", "Finish", finish));

  // Time scale: periods between ticks, alternately light and darker, with the tick labels on top.
  const scaleRow = el("div", "tlv-scale");
  const tickList = ticks(start, finish, scale);
  const edges = [0, ...tickList.map((t) => t.at).filter((at) => at > 0 && at < 1), 1];
  for (let i = 0; i < edges.length - 1; i++) {
    const period = el("span", `tlv-period${i % 2 ? " tlv-period--alt" : ""}`);
    period.style.left = pct(edges[i]);
    period.style.width = pct(edges[i + 1] - edges[i]);
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
  const { from, to, center } = span(model, task);
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
  node.style.left = pct(from);
  node.style.width = pct(to - from);
  node.title = title;
  // The stylesheet moves the label beside the bar when the bar is too narrow for it.
  node.append(el("span", "tlv-task-label", task.text));
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
    const { from, to, center } = span(model, task);
    const { x, y } = entry.calloutOffset;

    let marker: HTMLElement;
    let reach: number;
    if (task.isMilestone) {
      marker = el("span", `tlv-edge-symbol tlv-symbol tlv-symbol--${task.symbol ?? model.view.milestoneSymbol}`);
      marker.style.left = pct(center);
      reach = EDGE_SYMBOL_REACH;
    } else {
      marker = el("span", "tlv-edge-bar");
      marker.style.left = pct(from);
      marker.style.width = pct(to - from);
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
