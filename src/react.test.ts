import { act, createElement, createRef, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timeline, type TimelineProps } from "./react";
import type { TimelineViewData } from "./types";
import type { TimelineView } from "./view";

// Tells React that `act` is in use, so updates are flushed inside it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sample(name = "Example"): TimelineViewData {
  return {
    version: 7,
    view: { id: "v1", name, scale: "week" },
    tasks: [
      { id: 1, text: "Task #1", start_date: "2026-04-01", duration: "2d" },
      { id: 2, text: "Milestone #1", start_date: "2026-04-10" },
    ],
    timelines: [
      {
        id: 1,
        name: "Project",
        start_date: "2026-03-01",
        finish_date: "2026-05-01",
        entries: [
          { task: 1, line: 0 },
          { task: 2, callout_offset: { x: 30, y: 16 } },
        ],
      },
    ],
  };
}

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  host = document.getElementById("host")!;
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
});

const show = (props: TimelineProps & { ref?: React.Ref<TimelineView | null> }) =>
  act(() => root.render(createElement(Timeline, props)));
const title = () => host.querySelector(".tlv-title")?.textContent;

describe("Timeline (React)", () => {
  it("renders the data into its own container, with className and style", () => {
    show({ data: sample(), className: "plan", style: { height: 300 } });
    const container = host.firstElementChild as HTMLElement;
    expect(container.classList.contains("plan")).toBe(true);
    expect(container.classList.contains("tlv")).toBe(true);
    expect(container.style.height).toBe("300px");
    expect(title()).toBe("Example");
    expect(host.querySelectorAll(".tlv-task")).toHaveLength(1);
  });

  it("parses again when data changes, not on other re-renders", () => {
    const ref = createRef<TimelineView | null>();
    const data = sample();
    show({ data, ref });
    const parse = vi.spyOn(ref.current!, "parse");
    show({ data, ref, className: "other" }); // same data object
    expect(parse).not.toHaveBeenCalled();
    show({ data: sample("Changed"), ref });
    expect(parse).toHaveBeenCalledOnce();
    expect(title()).toBe("Changed");
  });

  it("gives the TimelineView through the ref", async () => {
    const ref = createRef<TimelineView | null>();
    show({ data: sample(), ref });
    expect(ref.current!.serialize().view.name).toBe("Example");
    await act(() => ref.current!.renameView("Renamed"));
    expect(title()).toBe("Renamed");
  });

  it("calls the latest event and click props", async () => {
    const ref = createRef<TimelineView | null>();
    const first = vi.fn();
    const second = vi.fn();
    const selected = vi.fn();
    show({ data: sample(), ref, onTaskUpdated: first });
    show({ data: sample(), ref, onTaskUpdated: second, onTaskSelected: selected });

    await act(() => ref.current!.updateTask(1, { text: "Build" }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ task_id: 1, task: expect.objectContaining({ text: "Build" }) }));

    act(() => {
      ref.current!.selectTask(2);
    });
    expect(selected).toHaveBeenCalledWith([2]);
  });

  it("loads viewId from the REST backend and saves changes there", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === "PATCH" ? { version: 8, view: sample().view } : sample("From server")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const ref = createRef<TimelineView | null>();
    await act(async () => {
      root.render(createElement(Timeline, { apiUrl: "https://api.test", fetch, viewId: "v1", ref }));
    });
    await act(() => ref.current!.whenSaved());
    expect(title()).toBe("From server");
    await act(() => ref.current!.renameView("Mine"));
    expect((fetch.mock.calls as unknown as [string, RequestInit][]).map(([url, init]) => `${init.method} ${url}`)).toEqual([
      "GET https://api.test/views/v1",
      "PATCH https://api.test/views/v1",
    ]);
  });

  it("reports invalid data to onError", () => {
    const onError = vi.fn();
    const bad = sample();
    bad.tasks[1].symbol = "hexagon" as never;
    show({ data: bad, onError });
    expect(onError).toHaveBeenCalledOnce();
    expect(String(onError.mock.calls[0][0])).toMatch(/unknown symbol/);
  });

  it("destroys the view on unmount, and survives StrictMode's double mount", () => {
    act(() => root.render(createElement(StrictMode, null, createElement(Timeline, { data: sample() }))));
    expect(host.querySelectorAll(".tlv-timeline")).toHaveLength(1);
    act(() => root.render(createElement("p", null, "gone")));
    expect(host.querySelector(".tlv")).toBeNull();
  });
});
