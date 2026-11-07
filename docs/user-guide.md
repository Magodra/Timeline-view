# User guide

## Concepts

If the view has a `name`, it is shown as a centered heading above the timelines. Leave it empty (`""`) if your page already has its own heading.

![Two timelines with task bars, milestones and callouts above and below the bars](images/features.svg)

*[examples/features.html](../examples/features.html): two timelines on a month scale, with callouts above and below the bars.*

A **view** holds one or more **timelines**, stacked vertically. Each timeline has its own time range (`start_date` to `finish_date`) and three **areas**:

- **above:** callout labels above the bar.
- **on:** the bar itself, with the time scale and task **lines**, numbered from 0.
- **below:** callout labels below the bar.

The callout areas have no lines: each label is placed freely by its offset, and the area grows to fit all of its labels.

A **task** is placed on a timeline by an **entry**. The entry's fields decide the area:

- `{ task: 1, line: 1 }`: on the bar, on line 1. Leave out `line` for line 0.
- `{ task: 2, callout_offset: { x: 30, y: 16 } }`: a callout; `y > 0` puts it below the bar.
- `{ task: 3, callout_offset: { x: 0, y: -16 } }`: a callout; `y` zero or negative puts it above the bar.

An entry can't have both `line` and `callout_offset`. One task can appear on several timelines, but only once on each.

## Data format

```js
{
  version: 7,                         // optional, set by the REST backend
  view: {
    id: "v1",                         // needed with a REST backend
    name: "Example",                  // heading above the timelines; "" for none
    absolute: false,                  // true: all timelines on one common time axis (default false)
    scale: "week",                    // hour | day | week | month | year (default day)
    name_position: "left",            // left | right (default left)
    milestone_symbol: "diamond",      // diamond | circle | square | triangle | star
    show_dates: true,                 // show Start and Finish dates beside each bar (default true)
    selection: true                   // clicks select and highlight tasks and timelines (default true)
  },
  tasks: [
    { id: 1, text: "Task #1", start_date: "2026-04-01", duration: "2d", color: "#0a7f5a" },  // own color
    { id: 2, text: "Milestone #1", start_date: "2026-04-10", symbol: "star" }
  ],
  timelines: [
    { id: 1, name: "Project",
      start_date: "2026-03-01",       // ISO 8601: YYYY-MM-DD or YYYY-MM-DDTHH:mm
      finish_date: "2026-05-01",
      entries: [
      { task: 1, line: 1 },                                 // bar line 1
      { task: 2, callout_offset: { x: 30, y: 16 } }      // label below the bar
    ]}
  ]
}
```

### Tasks and milestones

A task's finish date is its `start_date` plus its `duration`; it is calculated, not stored. A task with no `duration`, or a zero one, is a **milestone** and is drawn as a symbol. Otherwise it is drawn as a bar from its start date to its finish date.

`duration` is a whole number plus a unit:

| Unit | Meaning | Example |
|------|---------|---------|
| `h`  | hours   | `"5h"`  |
| `d`  | days    | `"2d"`  |
| `w`  | weeks   | `"3w"`  |
| `m`  | months  | `"3m"`  |
| `y`  | years   | `"1y"`  |

Months and years follow the calendar: one month from 31 January ends on 28 February.

### The bar

The time scale on top of the bar shades its periods (days, weeks, months, ...) alternately light and darker. Beside the bar, the timeline's start date is shown under "Start" and its finish date under "Finish". Set `show_dates: false` to hide them and give the bar the full width.

A task that starts before its timeline's start date, or finishes after its finish date, is cut off at the bar's edge and gets a small arrow pointing out on that side. A task entirely outside the range is a short stub with an arrow at the nearest edge. As a callout, such a task's marker on the bar's edge gets a pointed end instead.

### Absolute and relative timelines

Each timeline has its own `start_date` and `finish_date`. The view's `absolute` option decides how the bars line up:

- `absolute: false` (default): every bar fills the full width, scaled to its own range. Good for comparing the shape of each timeline.
- `absolute: true`: all timelines share one time axis, from the earliest start to the latest finish. Each bar sits at its place on that axis, so the same date is at the same position on every timeline.

![Three timelines with different date ranges on a common time axis; tasks that continue past a range end in arrows](images/absolute.svg)

*The second view in [examples/features.html](../examples/features.html), with `absolute: true`.*

### Callouts

An entry placed `above` or `below` is shown as a label with the task's name, start date and finish date, centered. On the bar's edge nearest the label, a marker shows where it belongs:

- a milestone gets its symbol (a diamond by default), centered on the edge at its date;
- a task gets a short bar over its dates, with rounded outer corners.

A dashed connector runs from the middle of the marker to the label. `callout_offset` places the label, in pixels from the attachment point, which is the bar's edge at the middle of the task's dates (a milestone's date):

- `x`: to the label's left edge.
- `y`: to the label's edge nearest the bar. It also picks the side: positive is below the bar, zero or negative above it.

An entry without `callout_offset` is on the bar, not a callout. The area grows or shrinks so every label fits inside it.

## Sizing the container

The view fills the element you pass to `init()` (or `new TimelineView()`). Its contents always take the height they need: the timelines stacked, each as tall as its bar lines plus callout areas that fit their labels. How the element's own size relates to that:

| Container | What you get |
|-----------|--------------|
| No height (`height: auto`, the default for a `div`) | The container is exactly as tall as the timelines. It grows and shrinks as entries move (a new bar line, a label dragged further out), and the page below moves with it. Nothing scrolls inside the view. |
| A fixed `height`, taller than the content | The timelines sit at the top, with the view's background as empty space below. |
| A fixed `height`, shorter than the content | The view scrolls vertically inside the container. The timelines are not squeezed; they keep their full height. |
| `max-height` | Grows with the content, like no height, up to the limit, then scrolls. Often the best choice in a page layout. |
| `height: 100%` | Only works if the parent has a definite height (for example a flex or grid cell, or a parent with its own `height`). Otherwise it behaves like no height. |

Width works the same way: without a width the container fills its parent, and the bars stretch to the available width. Each timeline is at least 480 px wide; in a narrower container the view scrolls sideways.

The container's size never changes the time scale's dates or the callout offsets, only what is visible. `toSVG()` exports the timelines' full extent, whatever the container's size and scroll position, without empty space below.

```html
<!-- Fits its content: -->
<div id="timeline_here"></div>
<!-- Fixed size, scrolls when the content is taller: -->
<div id="timeline_here" style="height: 400px;"></div>
<!-- Grows up to 600px, then scrolls: -->
<div id="timeline_here" style="max-height: 600px;"></div>
```

## Moving entries

Drag a task bar, milestone or label with the mouse, pen or a finger:

- Drop a bar or milestone on any bar line of any timeline. The line under the pointer is highlighted. Drop it on the thin strip just above the first line or below the last one to insert a new line there.
- Drop anything above or below a bar to make it a label there; the label stays where you drop it.
- Drop a label beyond the edge of its area, or even outside the view, and it goes to the nearest label area, which grows to include it.
- Press Escape to cancel.

The number of bar lines comes from the entries: one more than the highest `line` used, and at least one. After every move, blank lines at the top and bottom of the bar are removed, and the lines close up so the first one is line 0. A blank line between used lines stays as a gap. Inserting a line moves the lines below it down by one.

Dragging doesn't change a task's dates.

## Exporting as SVG

`timeline.toSVG()` returns the view as an SVG document, exactly as it looks on screen now, including your theme. It is plain SVG (shapes and text), so it opens in browsers and in drawing tools. The view must be shown on the page when you call it.

The component has no export button of its own; add one to your page:

```js
document.getElementById("download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([timeline.toSVG()], { type: "image/svg+xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "timeline.svg";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
```

Text in the SVG uses the page's fonts by name, so on a computer without those fonts it falls back to a similar one.

## Events

### Clicks

`attachEvent` subscribes to user actions on the view. It returns an event id; pass it to `detachEvent` to remove the handler.

```js
const eventId = timeline.attachEvent("onTaskClick", function (id, e, timelineId) {
  alert(`You've just clicked an item with id=${id}`);
  // `this` is the timeline view: this.serialize(), this.parse(...), this.toSVG(), ...
});

timeline.detachEvent(eventId); // returns false if the id is unknown
```

| Event | Handler | When |
|-------|---------|------|
| `onTaskClick` | `(id, e, timelineId)` | A task bar, milestone or callout label is clicked: pressed and released without dragging. `id` is the task's id, `e` the browser's pointer event, `timelineId` the timeline it was clicked on (a task can be on several). |
| `onTimelineClick` | `(id, e)` | A timeline is clicked outside its tasks: its name, bar, time scale, dates or callout areas. |
| `onTaskSelected` | `(ids)` | The selected tasks changed. `ids` lists all selected tasks; it is empty when none are selected any more. |
| `onTimelineSelected` | `(ids)` | The selected timelines changed. `ids` lists all selected timelines; it is empty when none are selected any more. |

Write the handler as a `function` to use `this`: an arrow function (`(id) => ...`) keeps the `this` of the code around it. In the script-tag setup, `this` is the default view, with the same methods as the global `timeline`.

Dragging an item never counts as a click.

### Selection

With `view.selection` on (the default), you can select tasks or timelines, but not both at once: selecting a task deselects any timelines, and the other way round. A selected task has a ring around it wherever it appears; a selected timeline is tinted, with its name label filled in.

| Action | Result |
|--------|--------|
| Click a task, or a timeline outside its tasks | Selects only that item. |
| Click an item that is already selected | Clears the selection. |
| Ctrl+Click (Cmd+Click on a Mac) | Adds the item to the selection, or removes it if it is already selected. On the other kind of item (a timeline while tasks are selected, or the reverse), it starts a new selection with just that item. |
| Click the view's heading | Clears the selection. |

Every change fires `onTaskSelected` and/or `onTimelineSelected` with the full list of selected ids; when the selection switches kind, the kind being left reports an empty list. You can also select from code, and read the selection:

```js
timeline.selectTask("design");          // select only this task
timeline.selectTask("build", true);     // add it to the selected tasks
timeline.unselectTask("design");        // remove one
timeline.selectTimeline("dev");         // select a timeline (deselects all tasks)
timeline.clearSelection();
timeline.getSelectedTasks();            // ["build"], or [] when timelines (or nothing) are selected
timeline.getSelectedTimelines();        // ["dev"], or []
```

Set `selection: false` in the view to turn selection off: clicks still fire `onTaskClick` and `onTimelineClick`, but nothing is selected or highlighted, and `selectTask`/`selectTimeline` return `false`. The highlight colors are `--tlv-selected`, `--tlv-selected-bg` and `--tlv-selected-text`. SVG exports leave the selection out.

## Reordering timelines

`moveTimelineUp(id)` and `moveTimelineDown(id)` move a timeline one place in the stack; `moveTimeline(id, delta)` moves it any number of places (negative is up). They return `false` when the timeline is already at the top or bottom. The new order is in `serialize()`. With a REST backend, saving the order is up to the host for now: the API has no call for it.

The component has no buttons for this; add your own, for example for the selected timeline (as in [examples/features.html](../examples/features.html), which also moves several selected timelines together):

```js
document.getElementById("move_up").addEventListener("click", () => {
  const [id] = timeline.getSelectedTimelines();
  if (id !== undefined) timeline.moveTimelineUp(id);
});
timeline.attachEvent("onTimelineSelected", (ids) => {
  document.getElementById("move_up").disabled = ids.length === 0;
});
```

### Moves

```js
const off = timeline.on("entry_moved", (e) => { /* e.timeline_id, e.task_id, e.patch */ });
timeline.on("move_failed", (e) => { /* e.error; the view already shows the restored state */ });
off(); // unsubscribe
```

## Theming

Override the custom properties on `.tlv`:

```css
.tlv {
  --tlv-task: #0a7f5a;
  --tlv-milestone: #b35900;
  --tlv-date-width: 96px;
}
```

See [src/styles.css](../src/styles.css) for the full list. The component follows the system's light or dark mode.

To color a single task, give it a `color` in the data: any CSS color, such as `"#0a7f5a"`, `"rgb(10 127 90)"` or `"orange"`. It replaces `--tlv-task` for a bar, or `--tlv-milestone` for a milestone, on that task's bar or symbol and on its callout's edge marker. It is the same in light and dark mode, and a bar's label stays in `--tlv-task-text` (white by default), so pick a color the label reads well on.

```js
tasks: [
  { id: "support", text: "Support", start_date: "2026-12-01", duration: "1y", color: "#1a7f37" },
  { id: "launch", text: "Launch", start_date: "2026-12-01", symbol: "star", color: "#bf8700" }
]
```
