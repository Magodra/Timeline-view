/**
 * SVG export. Rather than describing the layout a second time, this reads the
 * rendered view: element boxes, measured text and computed colors. The result
 * is plain SVG (rects, paths, lines, text) that matches what is on screen,
 * including theming and dark mode. The view must be rendered and visible.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Milestone symbol outlines in a 14 × 14 box, matching `.tlv-symbol--*` in styles.css. */
const SYMBOL_POINTS: Record<string, Array<[number, number]>> = {
  // Rotated 45° and scaled 0.8: a square of 11.2 px turned into a diamond.
  diamond: [[7, -0.92], [14.92, 7], [7, 14.92], [-0.92, 7]],
  square: [[1.05, 1.05], [12.95, 1.05], [12.95, 12.95], [1.05, 12.95]],
  triangle: [[7, 0], [14, 14], [0, 14]],
  star: [
    [50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35],
  ].map(([x, y]) => [(x * 14) / 100, (y * 14) / 100] as [number, number]),
};

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

const num = (n: number) => String(Math.round(n * 100) / 100);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A transparent or missing color is left out of the SVG. */
const isVisible = (color: string) => color !== "" && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color);

class SvgWriter {
  private readonly parts: string[] = [];
  private clipCount = 0;
  private readonly origin: { x: number; y: number };

  constructor(private readonly root: HTMLElement) {
    const r = root.getBoundingClientRect();
    // Content coordinates: the view may be scrolled inside its container.
    this.origin = { x: r.left + root.clientLeft - root.scrollLeft, y: r.top + root.clientTop - root.scrollTop };
  }

  box(el: Element): Box {
    return this.fromRect(el.getBoundingClientRect());
  }

  fromRect(r: DOMRect): Box {
    return { x: r.left - this.origin.x, y: r.top - this.origin.y, width: r.width, height: r.height };
  }

  add(markup: string): void {
    this.parts.push(markup);
  }

  rect(b: Box, fill: string, extra = ""): void {
    if (b.width <= 0 || b.height <= 0) return;
    this.add(
      `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.width)}" height="${num(b.height)}" fill="${fill}"${extra}/>`,
    );
  }

  /** A clip path for `b`, with optional rounded corners. Returns its id. */
  clip(b: Box, radius = 0): string {
    const id = `tlv-clip-${++this.clipCount}`;
    this.add(
      `<clipPath id="${id}"><rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.width)}" height="${num(b.height)}" rx="${num(radius)}"/></clipPath>`,
    );
    return id;
  }

  /**
   * Draws the text of `el` where the browser laid it out. `clipTo` cuts it
   * off at a box, as `overflow: hidden` does on screen.
   */
  text(el: Element | null, clipTo?: Box): void {
    // Custom content in a task's bar (`task_text`) is exported as the task's plain text.
    const content = (el as HTMLElement | null)?.dataset?.plainText ?? el?.textContent;
    if (!el || !content) return;
    const style = getComputedStyle(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const measured = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : undefined;
    const b = measured && measured.width > 0 ? this.fromRect(measured) : this.box(el);
    const vertical = (style.writingMode ?? "").startsWith("vertical");
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const font =
      ` font-family="${escapeXml(style.fontFamily)}" font-size="${style.fontSize}"` +
      (Number(style.fontWeight) >= 600 || style.fontWeight === "bold" ? ` font-weight="${style.fontWeight}"` : "");
    let attrs: string;
    if (vertical) {
      // Name labels: vertical-rl reads top to bottom; the left-hand name is
      // turned 180° on screen, so it reads bottom to top.
      const angle = el.closest(".tlv-timeline--name-left") ? -90 : 90;
      attrs = `x="${num(cx)}" y="${num(cy)}" text-anchor="middle" transform="rotate(${angle} ${num(cx)} ${num(cy)})"`;
    } else {
      attrs = `x="${num(b.x)}" y="${num(cy)}"`;
    }
    const text = `<text ${attrs} dominant-baseline="central" fill="${style.color}"${font}>${escapeXml(content)}</text>`;
    // The clip goes on a wrapping group: on the text itself it would turn with the text's rotation.
    this.add(clipTo ? `<g clip-path="url(#${this.clip(clipTo)})">${text}</g>` : text);
  }

  /**
   * The drawing's size: the timelines' extent, not the container's, so a
   * container taller than its content doesn't add blank space.
   */
  size(): { width: number; height: number } {
    let width = 0;
    let height = 0;
    for (const row of this.root.querySelectorAll(".tlv-title, .tlv-timeline")) {
      const b = this.box(row);
      width = Math.max(width, b.x + b.width);
      height = Math.max(height, b.y + b.height);
    }
    return { width: Math.ceil(width), height: Math.ceil(height) };
  }

  toString(): string {
    const { width, height } = this.size();
    return (
      `<svg xmlns="${SVG_NS}" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">` +
      this.parts.join("") +
      "</svg>"
    );
  }
}

/** A rect path with each corner's radius from the element's computed style, as CSS draws it. */
function roundedRect(b: Box, style: CSSStyleDeclaration): string {
  const { x, y, width: w, height: h } = b;
  const max = Math.min(w, h) / 2;
  const r = (v: string) => Math.min(parseFloat(v) || 0, max);
  const [tl, tr, br, bl] = [
    r(style.borderTopLeftRadius),
    r(style.borderTopRightRadius),
    r(style.borderBottomRightRadius),
    r(style.borderBottomLeftRadius),
  ];
  const arc = (radius: number, ex: number, ey: number) =>
    radius ? `A${num(radius)} ${num(radius)} 0 0 1 ${num(ex)} ${num(ey)}` : `L${num(ex)} ${num(ey)}`;
  return (
    `M${num(x + tl)} ${num(y)}H${num(x + w - tr)}${arc(tr, x + w, y + tr)}` +
    `V${num(y + h - br)}${arc(br, x + w - br, y + h)}` +
    `H${num(x + bl)}${arc(bl, x, y + h - bl)}` +
    `V${num(y + tl)}${arc(tl, x + tl, y)}Z`
  );
}

/** An edge bar with a pointed end on the side(s) where its task continues past the range. */
function pointedBar(b: Box, before: boolean, after: boolean): string {
  const { x, y, width: w, height: h } = b;
  const tip = Math.min(6, w / 2);
  const points = [
    [before ? x + tip : x, y],
    [after ? x + w - tip : x + w, y],
    ...(after ? [[x + w, y + h / 2]] : []),
    [after ? x + w - tip : x + w, y + h],
    [before ? x + tip : x, y + h],
    ...(before ? [[x, y + h / 2]] : []),
  ];
  return `M${points.map(([px, py]) => `${num(px)} ${num(py)}`).join("L")}Z`;
}

/** The small arrow inside a task bar that continues past the range. */
function drawArrow(out: SvgWriter, arrow: HTMLElement): void {
  const { x, y, width: w, height: h } = out.box(arrow);
  const points = arrow.classList.contains("tlv-arrow--before")
    ? [[x + w, y], [x, y + h / 2], [x + w, y + h]]
    : [[x, y], [x + w, y + h / 2], [x, y + h]];
  out.add(
    `<polygon points="${points.map(([px, py]) => `${num(px)},${num(py)}`).join(" ")}" fill="${getComputedStyle(arrow).backgroundColor}"/>`,
  );
}

function drawSymbol(out: SvgWriter, el: HTMLElement): void {
  const b = out.box(el); // includes the CSS transform; its center is the symbol's center
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const fill = getComputedStyle(el).backgroundColor;
  const kind = [...el.classList].find((c) => c.startsWith("tlv-symbol--"))?.slice("tlv-symbol--".length) ?? "diamond";
  if (kind === "circle") {
    out.add(`<circle cx="${num(cx)}" cy="${num(cy)}" r="7" fill="${fill}"/>`);
    return;
  }
  const points = (SYMBOL_POINTS[kind] ?? SYMBOL_POINTS.diamond)
    .map(([x, y]) => `${num(cx - 7 + x)},${num(cy - 7 + y)}`)
    .join(" ");
  out.add(`<polygon points="${points}" fill="${fill}"/>`);
}

function drawBar(out: SvgWriter, bar: HTMLElement): void {
  const style = getComputedStyle(bar);
  const b = out.box(bar);
  const radius = parseFloat(style.borderTopLeftRadius) || 0;
  out.rect(b, style.backgroundColor, ` rx="${num(radius)}"`);

  // Periods and ticks, clipped to the bar's rounded outline.
  const scale = bar.querySelector<HTMLElement>(".tlv-scale")!;
  const clip = out.clip(b, radius);
  out.add(`<g clip-path="url(#${clip})">`);
  for (const period of scale.querySelectorAll<HTMLElement>(".tlv-period")) {
    out.rect(out.box(period), getComputedStyle(period).backgroundColor);
  }
  const sb = out.box(scale);
  const scaleStyle = getComputedStyle(scale);
  const line = (y: number, color: string) =>
    out.add(`<line x1="${num(sb.x)}" y1="${num(y)}" x2="${num(sb.x + sb.width)}" y2="${num(y)}" stroke="${color}"/>`);
  line(sb.y + sb.height - 0.5, scaleStyle.borderBottomColor);
  out.add("</g>");
  // Tick labels that the layout hid for lack of room stay out, as on screen.
  for (const tick of scale.querySelectorAll<HTMLElement>(".tlv-tick")) if (!tick.hidden) out.text(tick, sb);

  // The host's task layers, as plain rectangles, under the tasks.
  for (const layer of bar.querySelectorAll<HTMLElement>(".tlv-layer")) {
    const color = getComputedStyle(layer).backgroundColor;
    if (isVisible(color)) out.rect(out.box(layer), color);
  }

  // Tasks and milestones on the bar lines.
  for (const task of bar.querySelectorAll<HTMLElement>(".tlv-task")) {
    const tb = out.box(task);
    const ts = getComputedStyle(task);
    out.add(`<path d="${roundedRect(tb, ts)}" fill="${ts.backgroundColor}"/>`);
    const label = task.querySelector<HTMLElement>(".tlv-task-label")!;
    // A label beside a narrow bar is positioned absolutely and not clipped.
    out.text(label, getComputedStyle(label).position === "absolute" ? undefined : tb);
    for (const arrow of task.querySelectorAll<HTMLElement>(".tlv-arrow")) drawArrow(out, arrow);
  }
  for (const milestone of bar.querySelectorAll<HTMLElement>(".tlv-milestone")) {
    drawSymbol(out, milestone.querySelector<HTMLElement>(".tlv-symbol")!);
    out.text(milestone.querySelector(".tlv-milestone-label"));
  }

  // The border goes on top of the periods.
  out.rect(
    { x: b.x + 0.5, y: b.y + 0.5, width: b.width - 1, height: b.height - 1 },
    "none",
    ` rx="${num(radius)}" stroke="${style.borderTopColor}"`,
  );

  for (const date of bar.querySelectorAll<HTMLElement>(".tlv-date")) {
    out.text(date.querySelector(".tlv-date-caption"));
    out.text(date.querySelector(".tlv-date-value"));
  }
}

function drawCalloutArea(out: SvgWriter, area: HTMLElement): void {
  const ab = out.box(area);
  const above = area.classList.contains("tlv-area--above");
  const edgeY = above ? ab.y + ab.height : ab.y;

  /** A label's connector: the same geometry layoutConnectors() gives it. */
  const drawConnector = (box: HTMLElement, connector: HTMLElement) => {
    if (connector.hidden) return;
    const x = Number(box.dataset.x);
    const y = Number(box.dataset.y);
    const reach = Number(box.dataset.reach);
    const sx = ab.x + Number(box.dataset.at) * ab.width;
    const sy = above ? edgeY - reach : edgeY + reach;
    const tx = Math.min(Math.max(0, x), x + box.offsetWidth);
    const dy = above ? y + reach : y - reach;
    const cs = getComputedStyle(connector);
    // Callout connectors are dashed; a marker's is solid, like its line.
    const dash = connector.classList.contains("tlv-connector--marker") ? "" : ` stroke-dasharray="3 3"`;
    out.add(
      `<line x1="${num(sx)}" y1="${num(sy)}" x2="${num(sx + tx)}" y2="${num(sy + dy)}" stroke="${cs.borderTopColor}"${dash}/>`,
    );
  };

  for (const box of area.querySelectorAll<HTMLElement>(".tlv-marker-label")) {
    drawConnector(box, box.previousElementSibling as HTMLElement);
    drawLabelBox(out, box);
  }

  for (const box of area.querySelectorAll<HTMLElement>(".tlv-callout")) {
    const connector = box.previousElementSibling as HTMLElement;
    const marker = connector.previousElementSibling as HTMLElement;
    drawConnector(box, connector);

    if (marker.classList.contains("tlv-edge-bar")) {
      const ms = getComputedStyle(marker);
      const before = marker.classList.contains("tlv-edge-bar--before");
      const after = marker.classList.contains("tlv-edge-bar--after");
      const mb = out.box(marker);
      const d = before || after ? pointedBar(mb, before, after) : roundedRect(mb, ms);
      out.add(`<path d="${d}" fill="${ms.backgroundColor}"/>`);
    } else {
      drawSymbol(out, marker);
    }

    drawLabelBox(out, box);
  }
}

/** A callout or marker label: background, border and its two lines of text. */
function drawLabelBox(out: SvgWriter, box: HTMLElement): void {
  const bs = getComputedStyle(box);
  const bb = out.box(box);
  const radius = parseFloat(bs.borderTopLeftRadius) || 0;
  if (isVisible(bs.backgroundColor)) out.rect(bb, bs.backgroundColor, ` rx="${num(radius)}"`);
  out.rect(
    { x: bb.x + 0.5, y: bb.y + 0.5, width: bb.width - 1, height: bb.height - 1 },
    "none",
    ` rx="${num(radius)}" stroke="${bs.borderTopColor}"`,
  );
  out.text(box.querySelector(".tlv-callout-title"), bb);
  out.text(box.querySelector(".tlv-callout-dates"), bb);
}

/** Builds an SVG document of the view rendered in `root`. */
export function toSVG(root: HTMLElement): string {
  const out = new SvgWriter(root);
  const rootStyle = getComputedStyle(root);
  const { width, height } = out.size();
  if (isVisible(rootStyle.backgroundColor)) out.rect({ x: 0, y: 0, width, height }, rootStyle.backgroundColor);

  const title = root.querySelector<HTMLElement>(".tlv-title");
  if (title) {
    const tb = out.box(title);
    const ts = getComputedStyle(title);
    if (isVisible(ts.backgroundColor)) out.rect(tb, ts.backgroundColor);
    out.text(title);
    if (parseFloat(ts.borderBottomWidth) > 0) {
      const y = tb.y + tb.height - 0.5;
      out.add(`<line x1="${num(tb.x)}" y1="${num(y)}" x2="${num(tb.x + tb.width)}" y2="${num(y)}" stroke="${ts.borderBottomColor}"/>`);
    }
  }

  for (const row of root.querySelectorAll<HTMLElement>(".tlv-timeline")) {
    const rs = getComputedStyle(row);
    const rb = out.box(row);

    const name = row.querySelector<HTMLElement>(".tlv-name")!;
    const nb = out.box(name);
    out.rect(nb, getComputedStyle(name).backgroundColor);
    out.text(name, nb);

    // The border first: a marker line crossing into the next timeline goes over it.
    if (parseFloat(rs.borderBottomWidth) > 0) {
      const y = rb.y + rb.height - 0.5;
      out.add(`<line x1="${num(rb.x)}" y1="${num(y)}" x2="${num(rb.x + rb.width)}" y2="${num(y)}" stroke="${rs.borderBottomColor}"/>`);
    }

    drawBar(out, row.querySelector<HTMLElement>(".tlv-bar")!);
  }

  // Marker lines cross the timelines: after all the bars, before the labels, which go on top.
  for (const line of root.querySelectorAll<HTMLElement>(":scope > .tlv-marker-line")) {
    out.rect(out.box(line), getComputedStyle(line).backgroundColor);
  }
  for (const row of root.querySelectorAll<HTMLElement>(".tlv-timeline")) {
    for (const area of row.querySelectorAll<HTMLElement>(".tlv-area")) drawCalloutArea(out, area);
  }
  return out.toString();
}
