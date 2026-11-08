import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DateFormatter, TaskEntryData, TimelineData, TimelineViewData } from "./types";
import { defaultFormatDate, defaultFormatTick, TimelineView, type MoveFailedEvent } from "./view";

function sample(): TimelineViewData {
  return {
    version: 7,
    view: { id: "v1", name: "Example", scale: "week" },
    tasks: [
      { id: 1, text: "Task #1", start_date: "2026-04-01", duration: "2d" },
      { id: 2, text: "Milestone #1", start_date: "2026-04-10", symbol: "star" },
    ],
    timelines: [
      {
        id: 1,
        name: "Project",
        start_date: "2026-03-01",
        finish_date: "2026-05-01",
        entries: [
          { task: 1, line: 1 },
          { task: 2, callout_offset: { x: 30, y: 16 } },
        ],
      },
    ],
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let container: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="tl"></div>';
  container = document.getElementById("tl")!;
});

describe("rendering", () => {
  it("renders timelines, areas, lines and entries", () => {
    const view = new TimelineView("tl");
    view.parse(sample());

    expect(container.querySelector(".tlv-name")!.textContent).toBe("Project");
    expect(container.querySelector(".tlv-date--start .tlv-date-caption")!.textContent).toBe("Start");
    expect(container.querySelector(".tlv-date--start .tlv-date-value")!.textContent).toBe("2026-03-01");
    expect(container.querySelector(".tlv-date--finish .tlv-date-caption")!.textContent).toBe("Finish");
    expect(container.querySelector(".tlv-date--finish .tlv-date-value")!.textContent).toBe("2026-05-01");
    // Task 1 is on line 1; blank line 0 isn't shown. One bar line plus a half
    // line above and below for inserting. Callout areas have no lines.
    expect(container.querySelectorAll('.tlv-line[data-placement="on"]')).toHaveLength(3);
    const inserts = [...container.querySelectorAll<HTMLElement>(".tlv-line--new")];
    expect(inserts.map((n) => n.dataset.line)).toEqual(["1", "2"]);
    expect(inserts.map((n) => n.style.height)).toEqual(["14px", "14px"]);
    expect(container.querySelectorAll(".tlv-area .tlv-line")).toHaveLength(0);

    const task = container.querySelector('.tlv-line[data-placement="on"][data-line="1"] .tlv-task')!;
    expect(task.textContent).toBe("Task #1");
    const callout = container.querySelector<HTMLElement>('.tlv-area--below[data-timeline="1"] .tlv-callout')!;
    expect(callout.textContent).toContain("Milestone #1");
    expect(callout.textContent).toContain("2026-04-10");
    expect(callout.style.marginLeft).toContain("30px");
    expect(callout.style.marginTop).toBe("16px");
  });

  it("shows the view's name as a heading above the timelines, if it has one", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const title = container.firstElementChild!;
    expect(title.className).toBe("tlv-title");
    expect(title.textContent).toBe("Example");
    expect(title.getAttribute("role")).toBe("heading");

    const data = sample();
    data.view.name = "";
    view.parse(data);
    expect(container.querySelector(".tlv-title")).toBeNull();
  });

  it("shows a task's finish date as start_date + duration", () => {
    const data = sample();
    data.timelines[0].entries[0] = { task: 1, callout_offset: { x: 0, y: -40 } };
    new TimelineView("tl").parse(data);
    const callout = container.querySelector<HTMLElement>(".tlv-area--above .tlv-callout")!;
    expect(callout.textContent).toContain("2026-04-01 – 2026-04-03");
    expect(callout.style.marginBottom).toBe("40px");
  });

  it("hides the start and finish dates with show_dates: false", () => {
    const data = sample();
    data.view.show_dates = false;
    const view = new TimelineView("tl");
    view.parse(data);
    expect(container.querySelector(".tlv-date")).toBeNull();
    expect(container.classList.contains("tlv--no-dates")).toBe(true);
    expect(view.serialize().view.show_dates).toBe(false);
  });

  it("shades the time scale's periods alternately", () => {
    new TimelineView("tl").parse(sample());
    const periods = [...container.querySelectorAll<HTMLElement>(".tlv-timeline .tlv-period")];
    // Weeks from Monday 2026-03-02 to 2026-04-27, plus the partial periods at either end.
    expect(periods).toHaveLength(10);
    expect(periods.map((p) => p.classList.contains("tlv-period--alt"))).toEqual(
      [false, true, false, true, false, true, false, true, false, true],
    );
    const total = periods.reduce((sum, p) => sum + parseFloat(p.style.width), 0);
    expect(total).toBeCloseTo(100, 3);
  });

  it("marks a milestone callout's attachment with its symbol on the bar's edge", () => {
    new TimelineView("tl").parse(sample());
    const area = container.querySelector(".tlv-area--below")!;
    // Milestone 2 has symbol "star".
    expect(area.querySelector(".tlv-edge-symbol.tlv-symbol--star")).not.toBeNull();
    expect(area.querySelector(".tlv-edge-bar")).toBeNull();
  });

  it("marks a task callout with an edge bar over its span and attaches at the span's middle", () => {
    const data = sample();
    data.timelines[0].entries[0] = { task: 1, callout_offset: { x: 0, y: -40 } };
    new TimelineView("tl").parse(data);
    const area = container.querySelector(".tlv-area--above")!;
    const bar = area.querySelector<HTMLElement>(".tlv-edge-bar")!;
    const callout = area.querySelector<HTMLElement>(".tlv-callout")!;
    // 2026-04-01 + 2d in a 61-day view: 31/61 to 33/61, middle 32/61.
    expect(parseFloat(bar.style.left)).toBeCloseTo((31 / 61) * 100, 3);
    expect(parseFloat(bar.style.width)).toBeCloseTo((2 / 61) * 100, 3);
    expect(Number(callout.dataset.at)).toBeCloseTo(32 / 61, 6);
  });

  it("draws a task in its own color, on the bar and as a callout marker", () => {
    const data = sample();
    data.tasks[0].color = "rebeccapurple";
    data.tasks[1].color = "#0a7f5a";
    data.tasks.push({ id: 3, text: "Callout task", start_date: "2026-03-10", duration: "1w", color: "orange" });
    data.timelines[0].entries.push({ task: 3, callout_offset: { x: 0, y: -16 } });
    new TimelineView("tl").parse(data);
    const prop = (selector: string, name: string) =>
      container.querySelector<HTMLElement>(selector)!.style.getPropertyValue(name);

    expect(prop('.tlv-task[data-task="1"]', "--tlv-task")).toBe("rebeccapurple");
    // Task 2 is a milestone callout: its edge symbol uses --tlv-milestone.
    expect(prop(".tlv-area--below .tlv-edge-symbol", "--tlv-milestone")).toBe("#0a7f5a");
    expect(prop(".tlv-area--above .tlv-edge-bar", "--tlv-task")).toBe("orange");
  });

  it("draws milestones on the bar with the configured symbol", () => {
    const data = sample();
    data.timelines[0].entries[1] = { task: 2, line: 0 };
    new TimelineView("tl").parse(data);
    expect(container.querySelector(".tlv-milestone .tlv-symbol--star")).not.toBeNull();
  });
});

describe("timeline ranges", () => {
  const twoTimelines = (absolute: boolean): TimelineViewData => {
    const data = sample();
    data.view.absolute = absolute;
    data.timelines.push({ id: 2, name: "Later", start_date: "2026-04-01", finish_date: "2026-06-01", entries: [] });
    return data;
  };
  const spans = () => [...container.querySelectorAll<HTMLElement>(".tlv-span")];

  it("fills the width with every bar by default", () => {
    new TimelineView("tl").parse(twoTimelines(false));
    expect(spans().map((s) => [s.style.marginLeft, s.style.width])).toEqual([
      ["", ""],
      ["", ""],
    ]);
    const finish = container.querySelectorAll(".tlv-date--finish .tlv-date-value");
    expect([...finish].map((d) => d.textContent)).toEqual(["2026-05-01", "2026-06-01"]);
  });

  it("places each bar on a common time axis with absolute: true", () => {
    new TimelineView("tl").parse(twoTimelines(true));
    // The view runs from 2026-03-01 to 2026-06-01: 92 days.
    const [first, second] = spans();
    expect(parseFloat(first.style.marginLeft)).toBe(0);
    expect(parseFloat(first.style.width)).toBeCloseTo((61 / 92) * 100, 3);
    expect(parseFloat(second.style.marginLeft)).toBeCloseTo((31 / 92) * 100, 3);
    expect(parseFloat(second.style.width)).toBeCloseTo((61 / 92) * 100, 3);
  });

  it("shades the same calendar periods alike on every timeline", () => {
    new TimelineView("tl").parse(twoTimelines(true));
    const shadeOfWeek = (timeline: number, left: number) =>
      [...container.querySelectorAll<HTMLElement>(`.tlv-timeline[data-timeline="${timeline}"] .tlv-period`)]
        .find((p) => Math.abs(parseFloat(p.style.left) - left) < 0.001)!
        .classList.contains("tlv-period--alt");
    // The week of Monday 2026-04-06: 36 days into timeline 1, 5 days into timeline 2 (61-day ranges).
    expect(shadeOfWeek(1, (36 / 61) * 100)).toBe(shadeOfWeek(2, (5 / 61) * 100));
  });

  it("marks tasks that continue past the timeline's range with arrows", () => {
    const data = sample();
    data.tasks.push(
      { id: 3, text: "Earlier", start_date: "2026-02-20", duration: "2w" },
      { id: 4, text: "Later", start_date: "2026-06-10", duration: "1w" },
      { id: 5, text: "Longer", start_date: "2026-04-20", duration: "1m" },
    );
    data.timelines[0].entries.push(
      { task: 3, line: 2 },
      { task: 4, line: 3 },
      { task: 5, callout_offset: { x: 0, y: -16 } },
    );
    new TimelineView("tl").parse(data);
    const task = (id: number) => container.querySelector<HTMLElement>(`.tlv-task[data-task="${id}"]`)!;
    const arrows = (id: number) => [...task(id).querySelectorAll(".tlv-arrow")].map((a) => a.className);

    expect(task(1).className).toBe("tlv-task");
    expect(arrows(1)).toEqual([]);
    expect(task(3).classList.contains("tlv-task--before")).toBe(true);
    expect(arrows(3)).toEqual(["tlv-arrow tlv-arrow--before"]);
    expect(task(3).style.left).toBe("0%");
    // Entirely after the range: a stub at the finish edge.
    expect(arrows(4)).toEqual(["tlv-arrow tlv-arrow--after"]);
    expect(task(4).style.left).toBe("calc(100% - 14px)");
    expect(task(4).classList.contains("tlv-task--outside-after")).toBe(true);
    // A callout's edge bar gets a pointed end instead.
    const edge = container.querySelector(".tlv-area--above .tlv-edge-bar")!;
    expect(edge.className).toBe("tlv-edge-bar tlv-edge-bar--after");
  });
});

describe("markers", () => {
  const data = (absolute = false): TimelineViewData => {
    const d = sample();
    d.view.absolute = absolute;
    d.timelines.push(
      { id: 2, name: "Two", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [] },
      { id: 3, name: "Three", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [{ marker: "today" }] },
      { id: 4, name: "Four", start_date: "2026-06-01", finish_date: "2026-08-01", entries: [] },
    );
    d.timelines[0].entries.push({ marker: "today" });
    d.markers = [
      { id: "today", text: "Today", date: "2026-03-20" },
      { id: "freeze", text: "Freeze", date: "2026-04-01", global: true, color: "blue", marker_offset: { x: 0, y: 20 } },
    ];
    return d;
  };
  /**
   * A marker's line runs: each element as "from:top-to:bottom", where top and
   * bottom say whether it starts and ends at a bar or runs on to the next timeline.
   */
  const runs = (marker: string) =>
    [...container.querySelectorAll<HTMLElement>(`:scope > .tlv-marker-line[data-marker="${marker}"]`)].map(
      (n) => `${n.dataset.from}:${n.dataset.top}-${n.dataset.to}:${n.dataset.bottom}`,
    );
  /** Where a marker's label is: "timeline/area". */
  const labelAt = (marker: string) => {
    const label = container.querySelector<HTMLElement>(`.tlv-marker-label[data-marker="${marker}"]`)!;
    return `${label.closest<HTMLElement>(".tlv-timeline")!.dataset.timeline}/${label.parentElement!.dataset.placement}`;
  };

  it("draws one line from the topmost to the bottommost timeline showing the marker, with its label on top", () => {
    new TimelineView("tl").parse(data());
    // Timelines 1 and 3 show it; the line crosses timeline 2 between them.
    expect(runs("today")).toEqual(["1:bar-3:bar"]);
    expect(labelAt("today")).toBe("1/above");
    expect(container.querySelector(".tlv-marker-label")!.textContent).toBe("Today2026-03-20");
  });

  it("draws a global marker on each timeline separately without absolute, skipping ranges without its date", () => {
    new TimelineView("tl").parse(data());
    // Each timeline has its own axis: a line and a label (below, as y > 0) per timeline.
    // Timeline 4 (June to August) doesn't hold 2026-04-01.
    expect(runs("freeze")).toEqual(["1:bar-1:bar", "2:bar-2:bar", "3:bar-3:bar"]);
    const labels = [...container.querySelectorAll<HTMLElement>('.tlv-marker-label[data-marker="freeze"]')].map(
      (n) => `${n.closest<HTMLElement>(".tlv-timeline")!.dataset.timeline}/${n.parentElement!.dataset.placement}`,
    );
    expect(labels).toEqual(["1/below", "2/below", "3/below"]);
    const line = container.querySelector<HTMLElement>('.tlv-marker-line[data-marker="freeze"]')!;
    expect(line.style.getPropertyValue("--tlv-marker")).toBe("blue");
  });

  it("breaks a marker's line where a timeline's own axis puts the date elsewhere", () => {
    const d = data();
    d.timelines[1].start_date = "2026-02-01"; // timeline 2: 2026-03-20 is at a different place
    new TimelineView("tl").parse(d);
    expect(runs("today")).toEqual(["1:bar-1:row", "2:row-2:row", "3:row-3:bar"]);
  });

  it("moves a marker's label with setMarkerOffset, between the top and bottom end, and reports it", async () => {
    const view = new TimelineView("tl");
    view.parse(data());
    const moved = vi.fn();
    view.on("marker_moved", moved);

    await expect(view.setMarkerOffset("today", { x: 12, y: 30 })).resolves.toBe(true);
    expect(labelAt("today")).toBe("3/below");
    expect(moved).toHaveBeenCalledWith({ marker_id: "today", marker_offset: { x: 12, y: 30 } });
    expect(view.serialize().markers![0].marker_offset).toEqual({ x: 12, y: 30 });

    const label = container.querySelector<HTMLElement>('.tlv-marker-label[data-marker="today"]')!;
    expect(label.style.marginTop).toBe("30px");
    // Draggable like a callout label.
    expect(label.hasAttribute("data-entry")).toBe(true);
    await expect(view.setMarkerOffset("nope", { x: 0, y: 0 })).rejects.toThrow(/not found/);
    await expect(view.setMarkerOffset("today", { x: 12, y: 30 })).resolves.toBe(false); // unchanged
  });

  it("draws one straight line across every timeline with absolute: true", () => {
    new TimelineView("tl").parse(data(true));
    expect(runs("freeze")).toEqual(["1:bar-4:bar"]);
    expect(labelAt("freeze")).toBe("4/below");
    // The position is taken on the first timeline: 2026-04-01 is 31 of its 61 days in.
    const line = container.querySelector<HTMLElement>('.tlv-marker-line[data-marker="freeze"]')!;
    expect(Number(line.dataset.at)).toBeCloseTo(31 / 61, 6);
  });
});

describe("moving timelines", () => {
  const three = (): TimelineViewData => {
    const data = sample();
    data.timelines.push(
      { id: 2, name: "Two", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [] },
      { id: 3, name: "Three", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [] },
    );
    return data;
  };
  const order = () => [...container.querySelectorAll<HTMLElement>(".tlv-timeline")].map((n) => n.dataset.timeline);

  it("moves a timeline up and down the stack, keeping its selection", async () => {
    const view = new TimelineView("tl");
    view.parse(three());
    view.selectTimeline(2);
    await expect(view.moveTimelineUp(2)).resolves.toBe(true);
    expect(order()).toEqual(["2", "1", "3"]);
    await expect(view.moveTimelineUp(2)).resolves.toBe(false);
    await expect(view.moveTimelineDown(1)).resolves.toBe(true);
    await expect(view.moveTimelineDown(1)).resolves.toBe(false);
    expect(order()).toEqual(["2", "3", "1"]);
    expect(view.serialize().timelines.map((t) => t.id)).toEqual([2, 3, 1]);
    expect(container.querySelector(".tlv-timeline--selected")!.getAttribute("data-timeline")).toBe("2");
  });

  it("fires timeline_moved for each move, but not when nothing moves", async () => {
    const view = new TimelineView("tl");
    view.parse(three());
    const events: unknown[] = [];
    view.on("timeline_moved", (e) => events.push(e));
    await view.moveTimelineUp(2);
    await view.moveTimelineUp(2); // already at the top
    await view.moveTimeline(2, 2);
    expect(events).toEqual([
      { timeline_id: 2, from_index: 1, to_index: 0, order: [2, 1, 3] },
      { timeline_id: 2, from_index: 0, to_index: 2, order: [1, 3, 2] },
    ]);
  });

  it("throws for an unknown timeline", async () => {
    const view = new TimelineView("tl");
    view.parse(three());
    await expect(view.moveTimelineUp(9)).rejects.toThrow(/not found/);
  });
});

describe("toSVG", () => {
  it("exports the view as a standalone SVG document", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const svg = view.toSVG();
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.namespaceURI).toBe("http://www.w3.org/2000/svg");
    const texts = [...doc.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toEqual(expect.arrayContaining(["Example", "Project", "Start", "Finish", "Task #1", "Milestone #1"]));
    // The milestone callout: its symbol on the bar's edge and a dashed connector.
    expect(doc.querySelectorAll("polygon").length).toBeGreaterThan(0);
    expect(doc.querySelector("line[stroke-dasharray]")).not.toBeNull();
  });

  it("escapes text", () => {
    const data = sample();
    data.tasks[0].text = `<b>"R&D"</b>`;
    const view = new TimelineView("tl");
    view.parse(data);
    const doc = new DOMParser().parseFromString(view.toSVG(), "image/svg+xml");
    expect([...doc.querySelectorAll("text")].map((t) => t.textContent)).toContain(`<b>"R&D"</b>`);
  });

  it("needs data first", () => {
    expect(() => new TimelineView("tl").toSVG()).toThrow();
  });
});

describe("attachEvent", () => {
  // jsdom may lack PointerEvent; a MouseEvent with the pointer event's type works the same here.
  const Pointer = (globalThis.PointerEvent ?? MouseEvent) as typeof MouseEvent;
  const press = (node: Element, type: string, x: number, y = 0, target: EventTarget = node, ctrlKey = false) =>
    target.dispatchEvent(new Pointer(type, { bubbles: true, button: 0, clientX: x, clientY: y, ctrlKey }));
  const click = (node: Element, ctrlKey = false) => {
    press(node, "pointerdown", 10, 0, node, ctrlKey);
    press(node, "pointerup", 11, 0, window, ctrlKey);
  };

  it("calls onTaskClick with the task id, the event and the timeline id, with the view as this", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const calls: unknown[][] = [];
    let self: unknown;
    view.attachEvent("onTaskClick", function (id, e, timelineId) {
      // oxlint-disable-next-line typescript/no-this-alias -- the test checks what `this` is
      self = this;
      calls.push([id, e.type, timelineId]);
    });

    click(container.querySelector('.tlv-task[data-task="1"]')!);
    click(container.querySelector('.tlv-callout[data-task="2"]')!);
    // The ids keep their type (numbers here), not the DOM's strings.
    expect(calls).toEqual([
      [1, "pointerup", 1],
      [2, "pointerup", 1],
    ]);
    expect(self).toBe(view);
  });

  it("returns an event id that detachEvent removes", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const handler = vi.fn();
    const first = view.attachEvent("onTaskClick", handler);
    const second = view.attachEvent("onTaskClick", handler);
    expect(second).not.toBe(first);

    expect(view.detachEvent(first)).toBe(true);
    expect(view.detachEvent(first)).toBe(false);
    click(container.querySelector(".tlv-task")!);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not report a drag as a click", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const handler = vi.fn();
    view.attachEvent("onTaskClick", handler);
    // jsdom has no layout: nothing is under the pointer, so the drop goes nowhere.
    document.elementFromPoint = () => null;
    const task = container.querySelector(".tlv-task")!;
    press(task, "pointerdown", 10);
    press(task, "pointermove", 60, 0, window);
    press(task, "pointerup", 60, 0, window);
    expect(handler).not.toHaveBeenCalled();
  });

  const taskNode = (id: number) => container.querySelector<HTMLElement>(`.tlv-task[data-task="${id}"], .tlv-callout[data-task="${id}"]`)!;
  const isHighlighted = (id: number) => taskNode(id).classList.contains("tlv-selected");
  const rowSelected = () => container.querySelector(".tlv-timeline")!.classList.contains("tlv-timeline--selected");

  it("selects a clicked task, highlights it, and clicking it again deselects it", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const events: unknown[][] = [];
    view.attachEvent("onTaskSelected", (ids) => events.push(["tasks", ids]));
    view.attachEvent("onTimelineSelected", (ids) => events.push(["timelines", ids]));

    click(taskNode(1));
    expect(events).toEqual([["tasks", [1]]]);
    expect(view.getSelectedTasks()).toEqual([1]);
    expect(view.getSelectedTimelines()).toEqual([]);
    expect(isHighlighted(1)).toBe(true);
    // Only one kind at a time: the task's timeline is not selected.
    expect(rowSelected()).toBe(false);

    // A plain click on another task selects only that one.
    click(taskNode(2));
    expect(view.getSelectedTasks()).toEqual([2]);
    expect(isHighlighted(1)).toBe(false);

    // Clicking the selected task again deselects it.
    click(taskNode(2));
    expect(view.getSelectedTasks()).toEqual([]);
    expect(events.at(-1)).toEqual(["tasks", []]);
  });

  it("adds and removes items with Ctrl+Click", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    click(taskNode(1));
    click(taskNode(2), true);
    expect(view.getSelectedTasks()).toEqual([1, 2]);
    expect(isHighlighted(1) && isHighlighted(2)).toBe(true);

    click(taskNode(1), true);
    expect(view.getSelectedTasks()).toEqual([2]);
    expect(isHighlighted(1)).toBe(false);

    // A plain click on a selected task clears the whole selection.
    click(taskNode(1), true);
    click(taskNode(2));
    expect(view.getSelectedTasks()).toEqual([]);

    // The selection survives a re-render.
    view.selectTask(1);
    view.selectTask(2, true);
    view.parse(view.serialize());
    expect(isHighlighted(1) && isHighlighted(2)).toBe(true);
  });

  it("switches between tasks and timelines: selecting one kind deselects the other", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const events: unknown[][] = [];
    view.attachEvent("onTaskSelected", (ids) => events.push(["tasks", ids]));
    view.attachEvent("onTimelineSelected", (ids) => events.push(["timelines", ids]));
    const clicks: unknown[] = [];
    view.attachEvent("onTimelineClick", function (id) {
      clicks.push([id, this === view]);
    });

    click(taskNode(1));
    click(taskNode(2), true);
    // Even with Ctrl, a timeline starts a new selection.
    click(container.querySelector(".tlv-name")!, true);
    expect(clicks).toEqual([[1, true]]);
    expect(view.getSelectedTasks()).toEqual([]);
    expect(view.getSelectedTimelines()).toEqual([1]);
    expect(container.querySelector(".tlv-selected")).toBeNull();
    expect(rowSelected()).toBe(true);
    expect(events.slice(-2)).toEqual([
      ["tasks", []],
      ["timelines", [1]],
    ]);

    // Clicking the selected timeline again deselects it.
    click(container.querySelector(".tlv-name")!);
    expect(view.getSelectedTimelines()).toEqual([]);
    expect(rowSelected()).toBe(false);

    // The view's heading clears the selection.
    view.selectTimeline(1);
    click(container.querySelector(".tlv-title")!);
    expect(view.getSelectedTimelines()).toEqual([]);
  });

  it("does not select with view.selection: false", () => {
    const data = sample();
    data.view.selection = false;
    const view = new TimelineView("tl");
    view.parse(data);
    const selected = vi.fn();
    view.attachEvent("onTaskSelected", selected);
    const clicked = vi.fn();
    view.attachEvent("onTaskClick", clicked);
    click(taskNode(1));
    expect(clicked).toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
    expect(view.selectTask(1)).toBe(false);
    expect(container.querySelector(".tlv-selected")).toBeNull();
  });

  it("rejects unknown event names", () => {
    const view = new TimelineView("tl");
    expect(() => view.attachEvent("onNothing" as never, (() => undefined) as never)).toThrow(/Unknown event/);
  });
});

describe("moveEntry without a backend", () => {
  it("applies the move, re-renders and fires entry_moved", async () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const moved = vi.fn();
    view.on("entry_moved", moved);

    await view.moveEntry(1, 2, { placement: "above", callout_offset: { x: 10, y: -24 } });

    expect(moved).toHaveBeenCalledWith({
      timeline_id: 1,
      task_id: 2,
      patch: { placement: "above", callout_offset: { x: 10, y: -24 } },
    });
    expect(container.querySelector('.tlv-area--above .tlv-callout')).not.toBeNull();
    expect((view.serialize().timelines[0].entries[1] as TaskEntryData).callout_offset!.y).toBeLessThanOrEqual(0); // above
  });

  it("rejects invalid moves and fires move_failed", async () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const failed = vi.fn();
    view.on("move_failed", failed);
    await expect(view.moveEntry(1, 2, { line: 9 })).rejects.toThrow();
    expect(failed).toHaveBeenCalledOnce();
  });
});

describe("moveEntry with a REST backend", () => {
  it("sends a PATCH with only the changed fields and the version", async () => {
    const fetch = vi.fn(async () =>
      json(200, { version: 8, timelines: [{ ...sample().timelines[0], name: "From server" }] }),
    );
    const view = new TimelineView("tl", { api_url: "https://api.test/", fetch });
    view.parse(sample());

    await view.moveEntry(1, 2, { callout_offset: { x: 40, y: 6 } });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/views/v1/timelines/1/entries/2");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ callout_offset: { x: 40, y: 6 }, version: 7 });

    const after = view.serialize();
    expect(after.version).toBe(8);
    expect(after.timelines[0].name).toBe("From server");
  });

  it("rolls back when the server rejects the move", async () => {
    const fetch = vi.fn(async () => json(422, { error: "invalid" }));
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(sample());
    const failed = vi.fn<(e: MoveFailedEvent) => void>();
    view.on("move_failed", failed);

    await expect(view.moveEntry(1, 2, { placement: "above" })).rejects.toMatchObject({ status: 422 });

    expect((view.serialize().timelines[0].entries[1] as TaskEntryData).callout_offset!.y).toBeGreaterThan(0); // below
    expect(failed.mock.calls[0][0].error).toMatchObject({ status: 422 });
  });

  it("re-renders from the server's view on 409", async () => {
    const current = sample();
    current.version = 9;
    current.timelines[0].name = "Changed elsewhere";
    const fetch = vi.fn(async () => json(409, current));
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(sample());

    await expect(view.moveEntry(1, 2, { placement: "above" })).rejects.toMatchObject({ status: 409 });

    expect(view.serialize().version).toBe(9);
    expect(container.querySelector(".tlv-name")!.textContent).toBe("Changed elsewhere");
  });

  it("sends queued moves one at a time and cancels the rest after a failure", async () => {
    let fail = true;
    const fetch = vi.fn(async () => (fail ? json(500, {}) : json(200, { version: 8, timelines: [] })));
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(sample());

    const first = view.moveEntry(1, 2, { placement: "above" });
    const second = view.moveEntry(1, 2, { callout_offset: { x: 1, y: -1 } });
    await expect(first).rejects.toMatchObject({ status: 500 });
    await expect(second).rejects.toThrow("cancelled");
    expect(fetch).toHaveBeenCalledOnce();
    // Both moves were rolled back.
    expect(view.serialize().timelines[0].entries[1]).toEqual({ task: 2, callout_offset: { x: 30, y: 16 } });

    fail = false;
    await view.moveEntry(1, 2, { placement: "above" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("loads a view with GET", async () => {
    const fetch = vi.fn(async () => json(200, sample()));
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    await view.load("v1");
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("https://api.test/views/v1");
    expect(container.querySelectorAll(".tlv-timeline")).toHaveLength(1);
  });
});

describe("adding entries from outside the view", () => {
  // oxlint-disable-next-line typescript/unbound-method -- saved only to put it back on `document`
  const original = document.elementsFromPoint;
  afterEach(() => {
    document.elementsFromPoint = original;
  });

  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

  /** Fake layout: the view at 0,0 1000×300, and `node` (with a host ghost on top) under every point. */
  function layout(node: Element) {
    container.getBoundingClientRect = () => rect(0, 0, 1000, 300);
    const ghost = document.createElement("div");
    document.body.append(ghost);
    document.elementsFromPoint = () => [ghost, node];
  }

  it("returns null outside the view", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    layout(container.querySelector(".tlv-line")!);
    expect(view.targetAt(1200, 50)).toBeNull();
  });

  it("finds a bar line or a half line, looking through the host's ghost", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    layout(container.querySelector('.tlv-line[data-line="1"]:not(.tlv-line--new)')!);
    expect(view.targetAt(500, 100)).toEqual({ timeline_id: 1, placement: "on", line: 1 });

    layout(container.querySelector(".tlv-line--new")!);
    expect(view.targetAt(500, 100)).toEqual({ timeline_id: 1, placement: "on", line: 1, new_line: true });
  });

  it("gives a callout area an offset for the task, with the label's corner at the point", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const area = container.querySelector<HTMLElement>(".tlv-area--below")!;
    area.getBoundingClientRect = () => rect(0, 200, 1000, 80);
    layout(area);
    expect(view.targetAt(600, 230)).toEqual({ timeline_id: 1, placement: "below" });
    // Timeline 2026-03-01 to 2026-05-01 (61 days); milestone 2026-04-20 is day 50.
    const target = view.targetAt(600, 230, { id: 9, text: "New", start_date: "2026-04-20" })!;
    expect(target.callout_offset).toEqual({ x: Math.round(600 - (50 / 61) * 1000), y: 30 });
  });

  it("highlights one target at a time", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const marked = () => [...container.querySelectorAll<HTMLElement>(".tlv-drop")];
    expect(view.highlightTarget({ timeline_id: 1, placement: "on", line: 1, new_line: true })).toBe(true);
    expect(marked()).toHaveLength(1);
    expect(marked()[0].classList.contains("tlv-line--new")).toBe(true);
    expect(marked()[0].dataset.line).toBe("1");

    view.highlightTarget({ timeline_id: 1, placement: "above" });
    expect(marked().map((n) => n.dataset.placement)).toEqual(["above"]);
    expect(view.highlightTarget({ timeline_id: 99, placement: "above" })).toBe(false);
    expect(marked()).toHaveLength(0);
  });

  it("adds an entry, renders it and fires entry_added", async () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const events: unknown[] = [];
    view.on("entry_added", (e) => events.push(e));
    view.highlightTarget({ timeline_id: 1, placement: "above" });

    await view.addEntry({ id: 9, text: "New", start_date: "2026-04-20" }, { timeline_id: 1, placement: "above", callout_offset: { x: 4, y: -30 } });
    expect(container.querySelector('.tlv-area--above .tlv-callout[data-task="9"]')).not.toBeNull();
    expect(container.querySelectorAll(".tlv-drop")).toHaveLength(0);
    expect(events).toEqual([
      expect.objectContaining({
        timeline_id: 1,
        task_id: 9,
        task: { id: 9, text: "New", start_date: "2026-04-20" },
        new_task: true,
        entry: { task: 9, callout_offset: { x: 4, y: -30 } },
      }),
    ]);
    expect(view.serialize().tasks.map((t) => t.id)).toEqual([1, 2, 9]);

    // The same task again on the same timeline is refused.
    await expect(view.addEntry(9, { timeline_id: 1 })).rejects.toThrow(/already on timeline/);
    expect(events).toHaveLength(1);
  });
});

describe("removing tasks and timelines", () => {
  /** Task 1 on both timelines; task 2 only on timeline 1. */
  const two = (): TimelineViewData => {
    const data = sample();
    data.timelines.push({ id: 2, name: "Two", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [{ task: 1, line: 2 }] });
    return data;
  };

  it("removes a task from the tasks and every timeline, and fires task_removed", async () => {
    const view = new TimelineView("tl");
    view.parse(two());
    view.selectTask(1);
    const selected: unknown[] = [];
    view.attachEvent("onTaskSelected", (ids) => selected.push(ids));
    const events: unknown[] = [];
    view.on("task_removed", (e) => events.push(e));

    await view.removeTask(1);
    expect(container.querySelector('[data-task="1"]')).toBeNull();
    const data = view.serialize();
    expect(data.tasks.map((t) => t.id)).toEqual([2]);
    expect(data.timelines.map((t) => t.entries)).toEqual([[{ task: 2, callout_offset: { x: 30, y: 16 } }], []]);
    expect(view.getSelectedTasks()).toEqual([]);
    expect(selected).toEqual([[]]);
    expect(events).toEqual([
      {
        task_id: 1,
        task: { id: 1, text: "Task #1", start_date: "2026-04-01", duration: "2d" },
        timelines: data.timelines,
      },
    ]);
  });

  it("removes a timeline but keeps its tasks, and fires timeline_removed", async () => {
    const view = new TimelineView("tl");
    view.parse(two());
    view.selectTimeline(1);
    const events: unknown[] = [];
    view.on("timeline_removed", (e) => events.push(e));

    await view.removeTimeline(1);
    expect([...container.querySelectorAll<HTMLElement>(".tlv-timeline")].map((n) => n.dataset.timeline)).toEqual(["2"]);
    expect(view.serialize().tasks.map((t) => t.id)).toEqual([1, 2]);
    expect(view.getSelectedTimelines()).toEqual([]);
    expect(events).toEqual([{ timeline_id: 1, timeline: sample().timelines[0], index: 0, order: [2] }]);

    // The last one too: the view is then empty.
    await view.removeTimeline(2);
    expect(container.querySelectorAll(".tlv-timeline")).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ timeline_id: 2, index: 0, order: [] });
  });

  it("throws for an unknown id, without an event", async () => {
    const view = new TimelineView("tl");
    view.parse(two());
    const handler = vi.fn();
    view.on("task_removed", handler);
    view.on("timeline_removed", handler);
    await expect(view.removeTask(9)).rejects.toThrow(/not found/);
    await expect(view.removeTimeline(9)).rejects.toThrow(/not found/);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("renaming", () => {
  it("renames the view, updates the heading and fires view_renamed", async () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const events: unknown[] = [];
    view.on("view_renamed", (e) => events.push(e));
    await expect(view.renameView("Plan")).resolves.toBe(true);
    expect(container.querySelector(".tlv-title")!.textContent).toBe("Plan");
    await expect(view.renameView("Plan")).resolves.toBe(false); // unchanged: no event
    await expect(view.renameView("")).resolves.toBe(true);
    expect(container.querySelector(".tlv-title")).toBeNull();
    expect(view.serialize().view.name).toBe("");
    expect(events).toEqual([
      { name: "Plan", old_name: "Example" },
      { name: "", old_name: "Plan" },
    ]);
  });

  it("renames a timeline and fires timeline_renamed", async () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    view.selectTimeline(1);
    const events: unknown[] = [];
    view.on("timeline_renamed", (e) => events.push(e));
    await expect(view.renameTimeline(1, "Main")).resolves.toBe(true);
    expect(container.querySelector(".tlv-name")!.textContent).toBe("Main");
    expect(container.querySelector(".tlv-timeline")!.getAttribute("aria-label")).toBe("Main");
    expect(view.getSelectedTimelines()).toEqual([1]);
    await expect(view.renameTimeline("1", "Main")).resolves.toBe(false);
    expect(view.serialize().timelines[0].name).toBe("Main");
    expect(events).toEqual([{ timeline_id: 1, name: "Main", old_name: "Project" }]);
  });

  it("throws for an unknown timeline or a name that isn't a string", async () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    await expect(view.renameTimeline(9, "X")).rejects.toThrow(/not found/);
    await expect(view.renameTimeline(1, 5 as unknown as string)).rejects.toThrow(/string/);
    await expect(view.renameView(null as unknown as string)).rejects.toThrow(/string/);
  });
});

describe("resizing", () => {
  const rect = (left: number, width: number) =>
    ({ left, right: left + width, width, top: 0, bottom: 10, height: 10, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

  /** Pretends the view is shown, and puts tick labels `width` px wide at `step` px intervals. */
  function fakeLayout(step: number, width: number) {
    container.getClientRects = () => [rect(0, 1000)] as unknown as DOMRectList;
    container.querySelectorAll<HTMLElement>(".tlv-tick").forEach((tick, i) => {
      tick.getBoundingClientRect = () => rect(i * step, width);
    });
  }
  const shown = () => [...container.querySelectorAll<HTMLElement>(".tlv-tick")].map((t) => !t.hidden);

  it("watches the view and every timeline for size changes, also without markers", () => {
    const observed: Element[] = [];
    let callback: () => void = () => undefined;
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        callback = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {
        observed.length = 0;
      }
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    try {
      const view = new TimelineView("tl");
      view.parse(sample());
      expect(observed).toEqual([container, container.querySelector(".tlv-timeline")]);

      // A resize lays the view out again: here, a narrower bar hides tick labels.
      fakeLayout(20, 30);
      callback();
      expect(shown().filter(Boolean).length).toBeLessThan(shown().length);
      view.destroy();
      expect(observed).toEqual([]);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it("hides tick labels that would overlap the one shown before them, and shows them again when there is room", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const count = container.querySelectorAll(".tlv-tick").length;
    expect(count).toBeGreaterThan(4);

    fakeLayout(20, 30); // each label overlaps the next: every second one shows
    view.resize();
    expect(shown()).toEqual(Array.from({ length: count }, (_, i) => i % 2 === 0));

    fakeLayout(100, 30); // room for all
    view.resize();
    expect(shown().every(Boolean)).toBe(true);
  });

  it("keeps the labels with the year first, preferring a new year over the first label", () => {
    const view = new TimelineView("tl");
    const data = sample();
    data.view.scale = "month";
    // Ticks: Dec 2026 (first), Jan 2027 (new year), Feb, Mar, Apr, May.
    data.timelines[0].start_date = "2026-12-01";
    data.timelines[0].finish_date = "2027-06-01";
    data.tasks = [];
    data.timelines[0].entries = [];
    view.parse(data);
    const labels = () => [...container.querySelectorAll<HTMLElement>(".tlv-tick")].filter((t) => !t.hidden).map((t) => t.textContent);
    fakeLayout(20, 30);
    view.resize();
    expect(labels()).toEqual(["Jan 2027", "Mar", "May"]);
  });

  it("leaves the layout alone while the view is hidden", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    fakeLayout(20, 30);
    container.getClientRects = () => [] as unknown as DOMRectList; // display: none
    view.resize();
    expect(shown().every(Boolean)).toBe(true);
  });
});

describe("timeline and view changes with a REST backend", () => {
  /** sample() plus an empty timeline 2. */
  const two = (): TimelineViewData => {
    const data = sample();
    data.timelines.push({ id: 2, name: "Two", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [] });
    return data;
  };
  const requests = (fetch: ReturnType<typeof vi.fn>) =>
    (fetch.mock.calls as unknown as [string, RequestInit][]).map(([url, init]) => [
      init.method,
      url.replace("https://api.test", ""),
      init.body === undefined ? undefined : JSON.parse(init.body as string),
    ]);

  it("saves renames, moves, adds and removals in order, each with the latest version", async () => {
    let version = 7;
    const fetch = vi.fn(async () => json(200, { version: ++version, order: [], view: {} }));
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(two());

    // Made one after another without waiting; each promise settles when its own request is answered.
    const changes = [
      view.renameView("Plan"),
      view.renameTimeline(2, "Second"),
      view.moveTimelineUp(2),
      view.addTimeline({ id: 3, name: "Three", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [] }, 1),
      view.removeTimeline(1),
    ];
    await expect(Promise.all(changes)).resolves.toEqual([true, true, true, undefined, undefined]);

    expect(requests(fetch)).toEqual([
      ["PATCH", "/views/v1", { name: "Plan", version: 7 }],
      ["PATCH", "/views/v1/timelines/2", { name: "Second", version: 8 }],
      ["PATCH", "/views/v1/timelines/2", { position: 0, version: 9 }],
      [
        "POST",
        "/views/v1/timelines",
        {
          timeline: { id: 3, name: "Three", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [] },
          position: 1,
          version: 10,
        },
      ],
      ["DELETE", "/views/v1/timelines/1?version=11", undefined],
    ]);
    const data = view.serialize();
    expect(data.version).toBe(12);
    expect(data.view.name).toBe("Plan");
    expect(data.timelines.map((t) => [t.id, t.name])).toEqual([
      [2, "Second"],
      [3, "Three"],
    ]);
  });

  it("rolls back a rejected change and the ones queued behind it, and fires save_failed", async () => {
    const fetch = vi.fn(async () => json(500, { error: "down" }));
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(two());
    const failed = vi.fn();
    view.on("save_failed", failed);

    const rename = view.renameTimeline(1, "Renamed");
    const removal = view.removeTimeline(2);
    expect(view.serialize().timelines.map((t) => t.name)).toEqual(["Renamed"]); // shown at once
    await expect(rename).rejects.toMatchObject({ status: 500 });
    await expect(removal).rejects.toThrow("cancelled");

    expect(fetch).toHaveBeenCalledOnce(); // the removal was cancelled, not sent
    expect(view.serialize().timelines.map((t) => t.name)).toEqual(["Project", "Two"]);
    expect(failed).toHaveBeenCalledOnce();
    expect(failed.mock.calls[0][0]).toMatchObject({ action: "rename_timeline", timeline_id: 1, error: { status: 500 } });
  });

  it("re-renders from the server's view on 409", async () => {
    const current = two();
    current.version = 9;
    current.view.name = "Changed elsewhere";
    const fetch = vi.fn(async () => json(409, current));
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(two());
    view.on("save_failed", () => undefined);

    await expect(view.renameView("Mine")).rejects.toMatchObject({ status: 409 });
    expect(view.serialize().version).toBe(9);
    expect(container.querySelector(".tlv-title")!.textContent).toBe("Changed elsewhere");
  });

  it("sends nothing for a change that doesn't happen", async () => {
    const fetch = vi.fn();
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(two());
    await view.renameView("Example"); // unchanged
    await view.moveTimelineUp(1); // already at the top
    await expect(view.addTimeline({ id: 1, name: "Dup", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [] })).rejects.toThrow(
      /already exists/,
    );
    await view.whenSaved();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("addTimeline", () => {
  it("adds a timeline at the bottom or at a position, and fires timeline_added", async () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const events: unknown[] = [];
    view.on("timeline_added", (e) => events.push(e));

    await view.addTimeline({ id: 2, name: "Two", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [] });
    // Entries may be left out; entries for known tasks are allowed.
    await view.addTimeline({ id: 3, name: "Three", start_date: "2026-04-01", finish_date: "2026-06-01" } as TimelineData, 0);
    await view.addTimeline({ id: 4, name: "Four", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [{ task: 1, line: 3 }] }, 1);

    expect([...container.querySelectorAll<HTMLElement>(".tlv-timeline")].map((n) => n.dataset.timeline)).toEqual(["3", "4", "1", "2"]);
    expect(view.serialize().timelines[1].entries).toEqual([{ task: 1, line: 0 }]); // trimmed
    expect(events[1]).toEqual({
      timeline_id: 3,
      timeline: { id: 3, name: "Three", start_date: "2026-04-01", finish_date: "2026-06-01", entries: [] },
      index: 0,
      order: [3, 1, 2],
    });
  });

  it("rejects bad timelines without changing anything", async () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const before = view.serialize();
    const ok = { id: 2, name: "Two", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [] };
    await expect(view.addTimeline({ ...ok, id: 1 })).rejects.toThrow(/already exists/);
    await expect(view.addTimeline({ ...ok, finish_date: "2026-02-01" })).rejects.toThrow(/after start_date/);
    await expect(view.addTimeline({ ...ok, entries: [{ task: 99 }] })).rejects.toThrow(/unknown task/);
    await expect(view.addTimeline(ok, 5)).rejects.toThrow(/position/);
    expect(view.serialize()).toEqual(before);
  });
});

describe("adding and removing entries with a REST backend", () => {
  const requests = (fetch: ReturnType<typeof vi.fn>) =>
    (fetch.mock.calls as unknown as [string, RequestInit][]).map(([url, init]) => [
      init.method,
      url.replace("https://api.test", ""),
      init.body === undefined ? undefined : JSON.parse(init.body as string),
    ]);
  const two = (): TimelineViewData => {
    const data = sample();
    data.timelines.push({ id: 2, name: "Two", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [] });
    return data;
  };

  it("sends a new task's data the first time and its id after that, and takes the server's timeline", async () => {
    let version = 7;
    // The server answers with its own copy of the timeline in the path.
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const id = Number(/timelines\/(\d+)\//.exec(url)![1]);
      const timeline = { ...two().timelines[id - 1], name: `From server ${id}` };
      return json(200, { version: ++version, timelines: [timeline] });
    });
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(two());

    const task = { id: 9, text: "New", start_date: "2026-04-20" };
    await view.addEntry(task, { timeline_id: 1, placement: "below", callout_offset: { x: 5, y: 20 } });
    await view.addEntry(9, { timeline_id: 2 });

    expect(requests(fetch)).toEqual([
      ["POST", "/views/v1/timelines/1/entries", { task, placement: "below", callout_offset: { x: 5, y: 20 }, version: 7 }],
      ["POST", "/views/v1/timelines/2/entries", { task: 9, version: 8 }],
    ]);
    expect(view.serialize().version).toBe(9);
    // The last response replaced the local timeline.
    expect(view.serialize().timelines[1].name).toBe("From server 2");
  });

  it("removes an entry, fires entry_removed, and sends a DELETE", async () => {
    const fetch = vi.fn(async () => json(200, { version: 8, timelines: [{ ...sample().timelines[0], entries: [{ task: 2, callout_offset: { x: 30, y: 16 } }] }] }));
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(sample());
    const events: unknown[] = [];
    view.on("entry_removed", (e) => events.push(e));

    const removal = view.removeEntry(1, 1);
    expect(container.querySelector('[data-task="1"]')).toBeNull(); // gone at once
    await removal;

    expect(requests(fetch)).toEqual([["DELETE", "/views/v1/timelines/1/entries/1?version=7", undefined]]);
    expect(events).toEqual([
      {
        timeline_id: 1,
        task_id: 1,
        entry: { task: 1, line: 1 },
        timeline: { ...sample().timelines[0], entries: [{ task: 2, callout_offset: { x: 30, y: 16 } }] },
      },
    ]);
    expect(view.serialize().tasks.map((t) => t.id)).toEqual([1, 2]); // the task stays
  });

  it("rolls back a rejected add or removal, and fires save_failed with the task", async () => {
    const fetch = vi.fn(async () => json(500, { error: "down" }));
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(two());
    const before = view.serialize();
    const failed = vi.fn();
    view.on("save_failed", failed);

    await expect(view.addEntry({ id: 9, text: "New", start_date: "2026-04-20" }, { timeline_id: 2 })).rejects.toMatchObject({ status: 500 });
    await expect(view.removeEntry(1, 2)).rejects.toMatchObject({ status: 500 });

    expect(view.serialize()).toEqual(before);
    expect(failed.mock.calls.map(([e]) => [e.action, e.timeline_id, e.task_id])).toEqual([
      ["add_entry", 2, 9],
      ["remove_entry", 1, 2],
    ]);
  });

  it("rejects removing a task that isn't on the timeline, without sending anything", async () => {
    const fetch = vi.fn();
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(two());
    await expect(view.removeEntry(2, 1)).rejects.toThrow(/not on timeline/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("updating and removing tasks", () => {
  it("updates a task wherever it appears, and fires task_updated", async () => {
    const data = sample();
    data.timelines.push({ id: 2, name: "Two", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [{ task: 1, line: 0 }] });
    const view = new TimelineView("tl");
    view.parse(data);
    const events: unknown[] = [];
    view.on("task_updated", (e) => events.push(e));

    await expect(view.updateTask(1, { text: "Build", duration: "1w" })).resolves.toBe(true);
    expect([...container.querySelectorAll('.tlv-task[data-task="1"]')].map((n) => n.textContent)).toEqual(["Build", "Build"]);
    expect(events).toEqual([
      {
        task_id: 1,
        task: { id: 1, text: "Build", start_date: "2026-04-01", duration: "1w" },
        old_task: { id: 1, text: "Task #1", start_date: "2026-04-01", duration: "2d" },
      },
    ]);
    // Nothing changes: false, no event.
    await expect(view.updateTask(1, { text: "Build" })).resolves.toBe(false);
    expect(events).toHaveLength(1);
    await expect(view.updateTask(1, { duration: "2d", finish_date: "2026-04-05" })).rejects.toThrow(/not both/);
  });

  it("saves updates and removals, taking the server's copy of the task", async () => {
    let version = 7;
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return json(200, { version: ++version, task: { id: 2, text: "Server's name", start_date: "2026-04-11" } });
      }
      return json(200, { version: ++version, timelines: [{ ...sample().timelines[0], entries: [{ task: 1, line: 0 }] }] });
    });
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(sample());
    view.selectTask(2);

    await view.updateTask(2, { text: "Sign-off", start_date: "2026-04-11" });
    expect(view.serialize().tasks[1]).toEqual({ id: 2, text: "Server's name", start_date: "2026-04-11" });
    await view.removeTask(2);

    const calls = (fetch.mock.calls as unknown as [string, RequestInit][]).map(([url, init]) => [
      init.method,
      url.replace("https://api.test", ""),
      init.body === undefined ? undefined : JSON.parse(init.body as string),
    ]);
    expect(calls).toEqual([
      ["PATCH", "/views/v1/tasks/2", { text: "Sign-off", start_date: "2026-04-11", version: 7 }],
      ["DELETE", "/views/v1/tasks/2?version=8", undefined],
    ]);
    expect(view.serialize().version).toBe(9);
    expect(view.serialize().tasks.map((t) => t.id)).toEqual([1]);
    expect(view.getSelectedTasks()).toEqual([]);
  });

  it("rolls back a rejected update or removal, and fires save_failed", async () => {
    const fetch = vi.fn(async () => json(500, { error: "down" }));
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(sample());
    const before = view.serialize();
    const failed = vi.fn();
    view.on("save_failed", failed);

    const update = view.updateTask(1, { text: "Changed" });
    expect(container.querySelector('.tlv-task[data-task="1"]')!.textContent).toBe("Changed"); // shown at once
    await expect(update).rejects.toMatchObject({ status: 500 });
    await expect(view.removeTask(2)).rejects.toMatchObject({ status: 500 });

    expect(view.serialize()).toEqual(before);
    expect(failed.mock.calls.map(([e]) => [e.action, e.task_id])).toEqual([
      ["update_task", 1],
      ["remove_task", 2],
    ]);
  });
});

describe("editing markers", () => {
  const data = (): TimelineViewData => {
    const d = sample();
    d.timelines.push({ id: 2, name: "Two", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [] });
    d.markers = [{ id: "m", text: "Kick-off", date: "2026-03-10", marker_offset: { x: 0, y: -16 } }];
    d.timelines[0].entries.push({ marker: "m" });
    return d;
  };
  const labels = () => [...container.querySelectorAll<HTMLElement>(".tlv-marker-label")].map((n) => n.textContent);

  it("adds, updates, shows, hides and removes markers, with events", async () => {
    const view = new TimelineView("tl");
    view.parse(data());
    const events: [string, unknown][] = [];
    const names = ["marker_added", "marker_updated", "marker_moved", "marker_removed", "marker_shown", "marker_hidden"] as const;
    for (const name of names) view.on(name, (e) => events.push([name, e]));

    await view.addMarker({ id: "g", text: "Today", date: "2026-04-01", global: true });
    expect(labels()).toContain("Today2026-04-01");
    await expect(view.updateMarker("m", { text: "Start", marker_offset: { x: 4, y: 20 } })).resolves.toBe(true);
    expect(labels()).toContain("Start2026-03-10");
    await expect(view.updateMarker("m", { text: "Start" })).resolves.toBe(false);
    await expect(view.showMarker(2, "m")).resolves.toBe(true);
    await view.hideMarker(2, "m");
    await view.removeMarker("g");
    expect(labels()).not.toContain("Today2026-04-01");

    expect(events.map(([name]) => name)).toEqual([
      "marker_added",
      "marker_updated",
      "marker_moved",
      "marker_shown",
      "marker_hidden",
      "marker_removed",
    ]);
    expect(events[1][1]).toMatchObject({ marker_id: "m", marker: { text: "Start" }, old_marker: { text: "Kick-off" } });
    expect(events[2][1]).toEqual({ marker_id: "m", marker_offset: { x: 4, y: 20 } });
    await expect(view.hideMarker(2, "m")).rejects.toThrow(/not on timeline/);
  });

  it("saves every marker change, including a moved label", async () => {
    let version = 7;
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const marker = { id: "m", text: "From server", date: "2026-03-10", marker_offset: { x: 0, y: -16 } };
      if (init?.method === "PATCH" || init?.method === "POST") return json(200, { version: ++version, marker });
      return json(200, { version: ++version, timelines: [] });
    });
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(data());

    await view.addMarker({ id: "g", text: "Today", date: "2026-04-01", global: true });
    await view.updateMarker("m", { color: "green" });
    await view.setMarkerOffset("m", { x: 3, y: 30 });
    await view.showMarker(2, "m");
    await view.hideMarker(2, "m");
    await view.removeMarker("g");

    const calls = (fetch.mock.calls as unknown as [string, RequestInit][]).map(([url, init]) => [
      init.method,
      url.replace("https://api.test", ""),
      init.body === undefined ? undefined : JSON.parse(init.body as string),
    ]);
    const added = { id: "g", text: "Today", date: "2026-04-01", global: true, marker_offset: { x: 0, y: -16 } };
    expect(calls).toEqual([
      ["POST", "/views/v1/markers", { marker: added, version: 7 }],
      ["PATCH", "/views/v1/markers/m", { color: "green", version: 8 }],
      ["PATCH", "/views/v1/markers/m", { marker_offset: { x: 3, y: 30 }, version: 9 }],
      ["PUT", "/views/v1/timelines/2/markers/m", { version: 10 }],
      ["DELETE", "/views/v1/timelines/2/markers/m?version=11", undefined],
      ["DELETE", "/views/v1/markers/g?version=12", undefined],
    ]);
    // The server's copy of the marker replaced the local one.
    expect(view.serialize().markers!.find((m) => m.id === "m")!.text).toBe("From server");
  });

  it("rolls back a rejected marker change and fires save_failed", async () => {
    const fetch = vi.fn(async () => json(500, { error: "down" }));
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(data());
    const before = view.serialize();
    const failed = vi.fn();
    view.on("save_failed", failed);

    await expect(view.setMarkerOffset("m", { x: 9, y: 40 })).rejects.toMatchObject({ status: 500 });
    await expect(view.showMarker(2, "m")).rejects.toMatchObject({ status: 500 });
    expect(view.serialize()).toEqual(before);
    expect(failed.mock.calls.map(([e]) => [e.action, e.marker_id, e.timeline_id])).toEqual([
      ["update_marker", "m", undefined],
      ["show_marker", "m", 2],
    ]);
  });
});

describe("updateTimeline", () => {
  it("changes a timeline's dates, redraws it and fires timeline_updated", async () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    const updated = vi.fn();
    const renamed = vi.fn();
    view.on("timeline_updated", updated);
    view.on("timeline_renamed", renamed);

    await expect(view.updateTimeline(1, { finish_date: "2026-06-01" })).resolves.toBe(true);
    expect(container.querySelector(".tlv-date--finish .tlv-date-value")!.textContent).toBe("2026-06-01");
    expect(updated).toHaveBeenCalledWith({
      timeline_id: 1,
      timeline: { ...sample().timelines[0], finish_date: "2026-06-01" },
      old_timeline: sample().timelines[0],
    });
    expect(renamed).not.toHaveBeenCalled();

    await expect(view.updateTimeline(1, { name: "Main", finish_date: "2026-06-01" })).resolves.toBe(true);
    expect(renamed).toHaveBeenCalledWith({ timeline_id: 1, name: "Main", old_name: "Project" });
    await expect(view.updateTimeline(1, { name: "Main" })).resolves.toBe(false); // unchanged
    await expect(view.updateTimeline(1, { start_date: "2026-07-01" })).rejects.toThrow(/after start_date/);
    expect(view.serialize().timelines[0].start_date).toBe("2026-03-01");
  });

  it("saves date changes with the timeline PATCH, and rolls back a rejected one", async () => {
    let fail = false;
    const fetch = vi.fn(async () => (fail ? json(500, {}) : json(200, { version: 8, order: [1] })));
    const view = new TimelineView("tl", { api_url: "https://api.test", fetch });
    view.parse(sample());
    const failed = vi.fn();
    view.on("save_failed", failed);

    await view.updateTimeline(1, { start_date: "2026-02-01", finish_date: "2026-07-01" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect([init.method, url]).toEqual(["PATCH", "https://api.test/views/v1/timelines/1"]);
    expect(JSON.parse(init.body as string)).toEqual({ start_date: "2026-02-01", finish_date: "2026-07-01", version: 7 });

    fail = true;
    await expect(view.updateTimeline(1, { finish_date: "2026-09-01" })).rejects.toMatchObject({ status: 500 });
    expect(view.serialize().timelines[0].finish_date).toBe("2026-07-01");
    expect(failed.mock.calls[0][0]).toMatchObject({ action: "update_timeline", timeline_id: 1 });
  });
});

describe("isDragging and the dragging events", () => {
  const Pointer = (globalThis.PointerEvent ?? MouseEvent) as typeof MouseEvent;
  const fire = (target: EventTarget, type: string, x: number) =>
    target.dispatchEvent(new Pointer(type, { bubbles: true, button: 0, clientX: x, clientY: 0 }));
  // oxlint-disable-next-line typescript/unbound-method -- saved only to put it back on `document`
  const original = document.elementsFromPoint;
  afterEach(() => {
    document.elementsFromPoint = original;
  });

  /** A view whose every point is over bar line 0 of timeline 1 (jsdom has no layout). */
  function setUp() {
    const view = new TimelineView("tl");
    view.parse(sample());
    const log: string[] = [];
    view.on("dragging_started", (e) => log.push(`started ${JSON.stringify(e)} dragging=${view.isDragging()}`));
    view.on("dragging_ended", (e) => log.push(`ended ${JSON.stringify(e)} dragging=${view.isDragging()}`));
    view.on("entry_moved", () => log.push(`moved dragging=${view.isDragging()}`));
    const line = container.querySelector('.tlv-line[data-line="1"]:not(.tlv-line--new)')!;
    document.elementsFromPoint = () => [line];
    const task = container.querySelector('.tlv-task[data-task="1"]')!;
    return { view, log, task };
  }

  it("starts once the pointer has moved past the threshold, and ends after the drop is applied", () => {
    const { view, log, task } = setUp();
    expect(view.isDragging()).toBe(false);
    fire(task, "pointerdown", 10);
    fire(window, "pointermove", 12); // within the threshold: not a drag yet
    expect(view.isDragging()).toBe(false);
    fire(window, "pointermove", 60);
    expect(view.isDragging()).toBe(true);
    fire(window, "pointermove", 80); // no second start
    // The task is on line 1 (the only line); dropping on the new line below moves it.
    document.elementsFromPoint = () => [container.querySelectorAll(".tlv-line--new")[1]];
    fire(window, "pointerup", 80);

    expect(view.isDragging()).toBe(false);
    expect(log).toEqual([
      'started {"kind":"entry","timeline_id":1,"task_id":1} dragging=true',
      "moved dragging=false",
      'ended {"kind":"entry","timeline_id":1,"task_id":1,"dropped":true} dragging=false',
    ]);
  });

  it("reports a cancelled drag (Escape) as not dropped, and a click as no drag at all", () => {
    const { view, log, task } = setUp();
    fire(task, "pointerdown", 10);
    fire(window, "pointermove", 60);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(view.isDragging()).toBe(false);
    expect(log.at(-1)).toBe('ended {"kind":"entry","timeline_id":1,"task_id":1,"dropped":false} dragging=false');

    log.length = 0;
    fire(task, "pointerdown", 10);
    fire(window, "pointerup", 11);
    expect(log).toEqual([]);
  });

  it("ends a drag in progress when the view is destroyed", () => {
    const { view, log, task } = setUp();
    fire(task, "pointerdown", 10);
    fire(window, "pointermove", 60);
    view.destroy();
    expect(log.at(-1)).toBe('ended {"kind":"entry","timeline_id":1,"task_id":1,"dropped":false} dragging=false');
  });

  it("reports a marker label drag with the marker's id", () => {
    const data = sample();
    data.markers = [{ id: "m", text: "Kick-off", date: "2026-03-10", global: true }];
    const view = new TimelineView("tl");
    view.parse(data);
    const events: unknown[] = [];
    view.on("dragging_started", (e) => events.push(e));
    const label = container.querySelector('.tlv-marker-label[data-marker="m"]')!;
    fire(label, "pointerdown", 10);
    fire(window, "pointermove", 60);
    expect(events).toEqual([{ kind: "marker", marker_id: "m" }]);
    fire(window, "pointercancel", 60);
    expect(view.isDragging()).toBe(false);
  });
});

describe("date and time-scale formatters", () => {
  const texts = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)].map((n) => n.textContent);
  const withAll = (): TimelineViewData => {
    const data = sample();
    data.view.scale = "month";
    data.tasks.push({ id: 3, text: "Call", start_date: "2026-04-02T09:30:00Z", duration: "2h" });
    data.timelines[0].entries.push({ task: 3, callout_offset: { x: 0, y: -40 } }, { marker: "m" });
    data.markers = [{ id: "m", text: "Kick-off", date: "2026-03-10" }];
    return data;
  };

  it("uses format_date for every displayed date, telling which date it is and whether it has a time", () => {
    const calls: string[] = [];
    const view = new TimelineView("tl", {
      format_date: (date, info) => {
        calls.push(`${info.kind}:${info.date_only}:${date.toISOString()}`);
        return `<${info.kind}>`;
      },
    });
    view.parse(withAll());

    expect(texts(".tlv-date-value")).toEqual(["<timeline_start>", "<timeline_finish>"]);
    // The task's label is above the bar, the milestone's below: above comes first.
    expect(texts(".tlv-callout .tlv-callout-dates")).toEqual(["<task_start> – <task_finish>", "<milestone>"]);
    expect(texts(".tlv-marker-label .tlv-callout-dates")).toEqual(["<marker>"]);
    expect(container.querySelector<HTMLElement>('.tlv-task[data-task="1"]')!.title).toBe("Task #1 (<task_start> – <task_finish>)");
    // A plain date is date_only; a time (or a finish reached by hours) is not.
    expect(calls).toContain("timeline_start:true:2026-03-01T00:00:00.000Z");
    expect(calls).toContain("task_start:false:2026-04-02T09:30:00.000Z");
    expect(calls).toContain("task_finish:false:2026-04-02T11:30:00.000Z");
    expect(calls).toContain("marker:true:2026-03-10T00:00:00.000Z");
  });

  it("uses format_tick for the time scale, with the UTC period start, the scale and whether it is major", () => {
    const view = new TimelineView("tl", {
      format_tick: (date, info) => `${info.scale}${info.major ? "*" : ""}${date.toISOString().slice(0, 7)}`,
    });
    view.parse(withAll());
    expect(texts(".tlv-tick")).toEqual(["month*2026-03", "month2026-04"]);
  });

  it("works with Intl formatting, keeping plain dates on their calendar day", () => {
    // Formats moments in a zone west of UTC, but plain dates in UTC, as DateFormatInfo advises.
    const format_date: DateFormatter = (date, info) =>
      new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        ...(info.date_only ? { timeZone: "UTC" } : { timeStyle: "short", timeZone: "America/New_York" }),
      }).format(date);
    const view = new TimelineView("tl", { format_date });
    view.parse(withAll());
    expect(texts(".tlv-date-value")).toEqual(["1 Mar 2026", "1 May 2026"]);
    expect(texts(".tlv-callout .tlv-callout-dates")).toEqual(["2 Apr 2026, 05:30 – 2 Apr 2026, 07:30", "10 Apr 2026"]);
  });

  it("falls back to the built-in format when a formatter throws, and logs it", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = new TimelineView("tl", {
      format_date: () => {
        throw new Error("broken");
      },
    });
    view.parse(sample());
    expect(texts(".tlv-date-value")).toEqual(["2026-03-01", "2026-05-01"]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("changes formatters with setFormatters, and goes back to the built-in format with undefined", () => {
    const view = new TimelineView("tl");
    view.parse(sample());
    view.setFormatters({ format_date: (date) => `d${date.getUTCDate()}` });
    expect(texts(".tlv-date-value")).toEqual(["d1", "d1"]);
    view.setFormatters({ format_tick: () => "t" }); // keeps format_date
    expect(texts(".tlv-date-value")).toEqual(["d1", "d1"]);
    expect(new Set(texts(".tlv-tick"))).toEqual(new Set(["t"]));
    view.setFormatters({ format_date: undefined });
    expect(texts(".tlv-date-value")).toEqual(["2026-03-01", "2026-05-01"]);
    expect(defaultFormatTick(new Date(Date.UTC(2026, 0, 1)), { scale: "month", major: true })).toBe("Jan 2026");
    expect(defaultFormatDate(new Date(Date.UTC(2026, 0, 1, 9)), { kind: "marker", date_only: false })).toBe("2026-01-01T09:00");
  });
});
