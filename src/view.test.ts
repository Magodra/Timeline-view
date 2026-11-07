import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskEntryData, TimelineViewData } from "./types";
import { TimelineView, type MoveFailedEvent } from "./view";

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

  it("moves a marker's label with setMarkerOffset, between the top and bottom end, and reports it", () => {
    const view = new TimelineView("tl");
    view.parse(data());
    const moved = vi.fn();
    view.on("marker_moved", moved);

    view.setMarkerOffset("today", { x: 12, y: 30 });
    expect(labelAt("today")).toBe("3/below");
    expect(moved).toHaveBeenCalledWith({ marker_id: "today", marker_offset: { x: 12, y: 30 } });
    expect(view.serialize().markers![0].marker_offset).toEqual({ x: 12, y: 30 });

    const label = container.querySelector<HTMLElement>('.tlv-marker-label[data-marker="today"]')!;
    expect(label.style.marginTop).toBe("30px");
    // Draggable like a callout label.
    expect(label.hasAttribute("data-entry")).toBe(true);
    expect(() => view.setMarkerOffset("nope", { x: 0, y: 0 })).toThrow(/not found/);
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

  it("moves a timeline up and down the stack, keeping its selection", () => {
    const view = new TimelineView("tl");
    view.parse(three());
    view.selectTimeline(2);
    expect(view.moveTimelineUp(2)).toBe(true);
    expect(order()).toEqual(["2", "1", "3"]);
    expect(view.moveTimelineUp(2)).toBe(false);
    expect(view.moveTimelineDown(1)).toBe(true);
    expect(view.moveTimelineDown(1)).toBe(false);
    expect(order()).toEqual(["2", "3", "1"]);
    expect(view.serialize().timelines.map((t) => t.id)).toEqual([2, 3, 1]);
    expect(container.querySelector(".tlv-timeline--selected")!.getAttribute("data-timeline")).toBe("2");
  });

  it("throws for an unknown timeline", () => {
    const view = new TimelineView("tl");
    view.parse(three());
    expect(() => view.moveTimelineUp(9)).toThrow(/not found/);
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
