import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineViewData } from "./types";
import { TimelineView, type MoveFailedEvent } from "./view";

function sample(): TimelineViewData {
  return {
    version: 7,
    view: { id: "v1", name: "Example", start_date: "2026-03-01", finish_date: "2026-05-01", scale: "week" },
    tasks: [
      { id: 1, text: "Task #1", start_date: "2026-04-01", duration: "2d" },
      { id: 2, text: "Milestone #1", start_date: "2026-04-10", symbol: "star" },
    ],
    timelines: [
      {
        id: 1,
        name: "Project",
        entries: [
          { task: 1, placement: "on", line: 1 },
          { task: 2, placement: "below", callout_offset: { x: 30, y: 16 } },
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

  it("shows a task's finish date as start_date + duration", () => {
    const data = sample();
    data.timelines[0].entries[0] = { task: 1, placement: "above", callout_offset: { x: 0, y: -40 } };
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
    data.timelines[0].entries[0] = { task: 1, placement: "above", callout_offset: { x: 0, y: -40 } };
    new TimelineView("tl").parse(data);
    const area = container.querySelector(".tlv-area--above")!;
    const bar = area.querySelector<HTMLElement>(".tlv-edge-bar")!;
    const callout = area.querySelector<HTMLElement>(".tlv-callout")!;
    // 2026-04-01 + 2d in a 61-day view: 31/61 to 33/61, middle 32/61.
    expect(parseFloat(bar.style.left)).toBeCloseTo((31 / 61) * 100, 3);
    expect(parseFloat(bar.style.width)).toBeCloseTo((2 / 61) * 100, 3);
    expect(Number(callout.dataset.at)).toBeCloseTo(32 / 61, 6);
  });

  it("draws milestones on the bar with the configured symbol", () => {
    const data = sample();
    data.timelines[0].entries[1] = { task: 2, placement: "on", line: 0 };
    new TimelineView("tl").parse(data);
    expect(container.querySelector(".tlv-milestone .tlv-symbol--star")).not.toBeNull();
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
    expect(view.serialize().timelines[0].entries[1].placement).toBe("above");
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

    expect(view.serialize().timelines[0].entries[1].placement).toBe("below");
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
    expect(view.serialize().timelines[0].entries[1]).toMatchObject({ placement: "below", callout_offset: { x: 30, y: 16 } });

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
