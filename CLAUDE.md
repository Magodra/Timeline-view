# CLAUDE.md - Timeline view

## Purpose

A web-based timeline component that other applications embed to display and edit timelines.

**Status:** early version. Rendering, drag and drop of entries, and the REST API for moving, adding and removing entries, for editing and removing tasks, for markers, and for view and timeline changes (names, dates, order) work. See [Not built yet](#not-built-yet). Items marked **TBD** are open decisions; ask before settling one.

## Commands

| Task               | Command              | Runs |
|--------------------|----------------------|------|
| Install            | `npm install`        | |
| Dev server         | `npm run dev`        | `vite`, opens `/examples/index.html` |
| Build              | `npm run build`      | `vite build` (library mode), `vite build --config vite.react.config.ts` (React wrapper), `tsc` for type declarations, then `scripts/export-examples.mjs` saves the basic and features examples as `docs/images/*.svg` |
| Test               | `npm test`           | `vitest run` |
| Test (watch)       | `npm run test:watch` | `vitest` |
| Type-check and lint | `npm run lint`      | `tsc --noEmit`, then `oxlint --type-aware --deny-warnings` (rules in [.oxlintrc.json](.oxlintrc.json)) |

Run `npm run lint` and `npm test` before calling a change done.

## Architecture

- **Language:** TypeScript (strict mode). No runtime dependencies; React is an optional peer dependency, used only by `ar-timeline-view/react`.
- **Core:** framework-free library, usable from a plain `<script>` tag through a global `timeline` object and as an ES module.
- **React wrapper:** `src/react.ts`, published as `ar-timeline-view/react` (`dist/react.mjs`, ESM only). A thin `Timeline` component: creates a `TimelineView` on mount and destroys it on unmount, `parse()`s `data` when the prop changes (by identity), `load()`s `viewId` with `apiUrl`, maps every event to an `on...` prop (`EVENT_PROPS`, checked against `TimelineEvents` by `satisfies`, so a new event must be added there), and exposes the view as its `ref`. Written with `createElement`, so the project needs no JSX setup. Built by [vite.react.config.ts](vite.react.config.ts) with React and the core as imports (`./index` becomes `ar-timeline-view`), so apps get one copy of the core. Tests in `src/react.test.ts` (react-dom in jsdom).
- **Build output:** `dist/timelineview.js` (UMD, global `timeline`), `dist/timelineview.mjs` (ESM), `dist/timelineview.css`, `dist/react.mjs` (React wrapper), `dist/types/`. Built with Vite in library mode from `src/lib.ts` (the library plus `styles.css`; the stylesheet is imported there, not in `index.ts`, so the published declarations have no CSS import).
- **Selection** (`view.selection`, default `true`): tasks or timelines can be selected, one kind at a time (selecting a task deselects timelines and the reverse). Click on a task, or on a timeline outside its tasks (name, bar, scale, dates, callout areas): select only that item; click on a selected item: clear the selection. Ctrl+Click (or Cmd+Click): add or remove the item; on the other kind it starts a new selection with just that item. Clicking the view's heading clears the selection. `onTaskSelected` / `onTimelineSelected` get the full list of selected ids (empty for the kind being left). A selected task gets a ring (`--tlv-selected`) wherever it appears; a selected timeline gets a tinted background (`--tlv-selected-bg`) and a filled name label. Dragging never selects. The selection survives re-renders and is dropped when its task or timeline disappears. `toSVG()` leaves it out.
- **Drag and drop:** native pointer events (`src/drag.ts`), so the core needs no framework.
- **Rendering:** plain DOM. The whole view re-renders after every change; there is no diffing.
- **Dev dependencies:** Vite, Vitest, jsdom, TypeScript, oxlint with oxlint-tsgolint (type-aware linting), React with react-dom and their types (for the wrapper and its tests), and Puppeteer (only for the example images in the build; falls back to the installed Chrome).
- **Linting:** oxlint, not ESLint: typescript-eslint doesn't support TypeScript 7 yet, while oxlint's type-aware rules run on TypeScript 7's own compiler (tsgolint). [.oxlintrc.json](.oxlintrc.json) turns on the correctness rules plus the promise rules (`no-floating-promises`, `no-misused-promises`, ...), since the edit methods return promises: await them, or end with `.catch(...)` or `void`. Silence a deliberate exception on its line with `// oxlint-disable-next-line <rule> -- <reason>`; the HTML examples aren't linted.
- **Tests:** Vitest with `jsdom`. Test files sit next to the source as `*.test.ts`.
- **Module resolution:** `resolve.preserveSymlinks: true` in both Vite configs. Vite 8's native resolver (Rolldown) can't follow real paths in this Dropbox folder on Windows and then finds no npm package imported from source; don't remove it without checking that `src/react.test.ts` still resolves `react`.
- **Browser support:** current evergreen browsers (Chrome, Edge, Firefox, Safari). The CSS uses container queries.
- **Backend / REST:** the component does not persist data itself. The host app either passes data with `parse()` and listens for `entry_moved`, or sets `api_url` so the component calls the [REST API](#rest-api).
- **Examples in the dev server:** the examples load `../dist/timelineview.js` with a classic `<script>` tag, as a host page would. A plugin in [vite.config.ts](vite.config.ts) rewrites those tags to load [src/global.ts](src/global.ts) instead, and turns inline scripts into modules. Keep example pages in that shape: one bundle `<script>`, one stylesheet `<link>`, then plain inline `<script>` blocks.

## Folder structure

```
/src
  index.ts      Public entry: exports, plus the default instance (init, parse, load, ...)
  lib.ts        Build entry: index.ts plus styles.css
  react.ts      Optional React component (ar-timeline-view/react)
  global.ts     Dev-server entry that sets window.timeline
  types.ts      Public data format (snake_case)
  model.ts      Internal model (camelCase), validation and move rules
  view.ts       TimelineView: ties model, rendering, drag and REST together; events
  render.ts     DOM rendering
  drag.ts       Pointer-event drag and drop
  scale.ts      Time scale ticks
  dates.ts      UTC date parsing, formatting and arithmetic
  duration.ts   Duration parsing
  api.ts        REST client
  svg.ts        SVG export, built from the rendered DOM
  styles.css    Component styles; themable through --tlv-* custom properties
/examples       Runnable HTML pages, listed in examples/index.html
/scripts        Build helpers: export-examples.mjs (example images for the docs)
/docs           Getting started, user guide, developer guide, api/openapi.yaml,
                images/ (basic.svg, features.svg, absolute.svg: generated by the build, committed)
/dist           Build output (git-ignored)
```

## Conventions

- Every user-visible feature ships with an update to `/docs` and, where useful, an example in `/examples` (add it to `examples/index.html`).
- `docs/images/basic.svg`, `features.svg` and `absolute.svg` are generated by `npm run build` from `examples/basic.html` and the two views in `examples/features.html`, and shown in the README and docs. Don't edit them by hand; rebuild and commit them when the rendering or those examples change.
- Public data format (what `parse()` takes and the REST API exchanges) uses `snake_case`. Internal TypeScript uses `camelCase`. Convert at the boundary in `model.ts`.
- Dates in the data format are ISO 8601: `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, or a full timestamp with seconds, a fraction and a zone (`Z` or `±HH:mm`). Internally all dates are UTC: a zone is converted, a date or a time without a zone is read as UTC. Labels show UTC (`formatDate`) unless the host passes `format_date` / `format_tick`: all display text for dates goes through the `Display` that `render()` gets from the view (`displayOf` in `view.ts`), never `formatDate` directly. `info.date_only` (no `T` in the value's data form) tells the host formatter to format a calendar date in UTC; tick dates are UTC period starts. A formatter that throws or returns a non-string is logged and the built-in format is used. `serialize()` writes each parsed date back exactly as given (`dateToData` in `dates.ts`, which remembers the source text per parsed `Date`), so never mutate a model date in place.
- Line indexes are 0-based everywhere.
- The move rules live in `TimelineModel` only: `moveEntry` and `addEntry` share them through `placeEntry` in `model.ts`, and `removeEntry` trims the same way. The UI, the REST client and the mock server in `examples/rest.html` all go through it. Change the rules there, and keep CLAUDE.md, `docs/api/openapi.yaml` and the tests in step.
- Keep runtime dependencies at zero; ask before adding one.

## Glossary and domain model

The hierarchy, from outermost to innermost:

**View → Timeline → Area → Line → Entry → Task**

| Term         | Meaning |
|--------------|---------|
| **View**     | The whole component. Holds the scale and display options, and stacks timelines vertically. Its time axis runs from the earliest timeline start to the latest finish. |
| **Timeline** | One horizontal band (a row or swimlane) in the view, with a name and its own time range (`start_date`, `finish_date`). |
| **Area**     | One of the three parts of a timeline: callouts `above`, the bar itself (`on`), and callouts `below`. |
| **Line**     | A sub-row of the bar (`on`) area. Callout areas have no lines. |
| **Entry**    | The placement of a task on a timeline: `task`, plus either `line` (on the bar, default 0) or `callout_offset` (a callout). The area is derived, not stored: no `callout_offset` means on the bar; `callout_offset.y > 0` means below; `y ≤ 0` means above. Internally the model keeps a `placement` (`above` \| `on` \| `below`). A task appears at most once per timeline, so the pair (timeline `id`, `task`) identifies an entry. |
| **Marker**   | A dated vertical line across one or more timelines (for example "Today"), with a label. `global` markers show on every timeline; others on the timelines that have a `{ marker: id }` entry. |
| **Task**     | The single item entity, identified by `id`. A task can appear on several timelines through entries. Its finish is `start_date + duration`, or a given `finish_date` (one or the other, not both). |

### Task kinds

Task kind is derived from the data, not stored:

| Kind          | Rule |
|---------------|------|
| **Milestone** | The finish equals the start: no `duration` or `finish_date`, a zero `duration`, or `finish_date` = `start_date`. |
| **Task**      | A non-zero `duration`, or a `finish_date` after `start_date`. |

Duration format: a whole number plus a unit: `h` (hours), `d` (days), `w` (weeks), `m` (months), `y` (years). For example `"2d"` or `"3m"`. There is no minutes unit, so `m` always means months. Months and years are calendar units: `"1m"` from 2026-01-31 ends on 2026-02-28.

## User interface

- **Heading:** if `view.name` is set (not empty), it is shown as a centered heading (`.tlv-title`, `role="heading"`) above the timelines. An empty name shows no heading.
- The view shows its timelines stacked vertically, each in its own rectangular area.
- **Container size:** the view renders into the host's element, which gets `overflow: auto`. The timelines always take their natural height. A container without a height fits them exactly and grows with them; a fixed `height` or `max-height` makes the view scroll vertically when the content is taller (or leaves empty space below when it's shorter). Each timeline is at least 480 px wide, so a narrower container scrolls sideways. Documented in the user guide, "Sizing the container".
- **Resizing:** the view is meant to live in resizable hosts such as dockview panels. `layout()` in `render.ts` redoes everything that depends on measured sizes (connector angles, which tick labels fit, marker lines) without rebuilding the DOM. It runs after every render, from a `ResizeObserver` on the view and each timeline (always on, not only with markers), and when web fonts finish loading. It skips a hidden view (`display: none`, an inactive tab): showing it changes its size, which lays it out. `view.resize()` runs it on demand. Anything new whose layout depends on the width belongs in `layout()`.
- **Name label:** each timeline's name is written vertically at its left or right edge (`view.name_position`).
- **Bar:** each timeline's bar covers that timeline's own `start_date` to `finish_date`. How it is placed depends on `view.absolute`:
  - `false` (default): every bar spans the full width of the center area, scaled to its own range.
  - `true`: all timelines share one time axis, from the earliest timeline start to the latest finish. Each bar (with its callout areas) sits at its offset and width on that axis, so a date lines up across timelines.

  The bar has two parts:
  - **Time scale:** `hour`, `day`, `week` (ISO weeks, starting Monday), `month` or `year` ticks (`view.scale`). The periods between ticks alternate between a light and a darker background; the shading follows the calendar period, so it matches across timelines. Tick labels that would overlap are hidden (`hidden` attribute, set by `layoutTicks`, also left out of `toSVG()`): major labels (`.tlv-tick--major`: the first, and each new year on a month scale or new day on an hour scale) are placed first, right to left so a new year beats the first label, then the rest fill in from the left.
  - **Task lines:** tasks are drawn as bars covering their time span, clipped to the timeline's range. A task that starts before the range or finishes after it gets a square end and a small arrow pointing out on that side; one entirely outside the range is a short stub at the nearest edge. A bar too narrow for its label shows the label beside it. Milestones outside the range are drawn at the nearest edge, without an arrow. Milestones are drawn as a symbol: `diamond` (default), `circle`, `square`, `triangle` or `star`, set by `view.milestone_symbol` or per task with `symbol`. A task's `color` (any CSS color) overrides the theme's `--tlv-task` or `--tlv-milestone` for that task's bar, symbol and callout edge marker; render.ts sets the variable on the element, so the drag ghost and the SVG export follow. No divider lines are drawn between task lines.
- **Start and finish dates:** the timeline's `start_date` is shown left of its bar under a right-aligned "Start" caption, and its `finish_date` right of the bar under a left-aligned "Finish" caption. `view.show_dates: false` hides both, and the bar then uses the full width.
- **Callouts:** entries placed `above` or `below` show the task's name, `start_date` and `finish_date`, centered, in a label. On the bar's edge (top when above, bottom when below) each callout has a marker:
  - a milestone: its symbol (default diamond), centered on the edge at its date;
  - a task: a short bar over its time span, sitting on the edge, with rounded outer corners, and a pointed end where the task continues past the timeline's range.

  A dashed connector runs from the middle of the marker's outer edge to the nearest point of the label. The attachment point is the bar's edge at the middle of the task's span (a milestone's date). The label is placed only by `callout_offset`, in px from the attachment point:
  - `x`: to the label's left edge.
  - `y`: to the label's edge nearest the bar, and it picks the side: `y > 0` below the bar, `y ≤ 0` above it, so a label never overlaps the bar. A label flush below the bar has `y = 1`, since `y = 0` means above.
  - An entry without `callout_offset` is on the bar, not a callout. A callout created by a move without an offset (for example a bar dragged by `moveEntry` with only `placement`) sits 16 px from the bar (`{ x: 0, y: ∓16 }`).
- **Markers:** a marker is a vertical line at its `date`, in its `color` or the theme's `--tlv-marker` (red). It runs from the top of the topmost bar that shows it to the bottom of the bottommost, crossing the timelines in between; a `global` marker spans every timeline. Its label (text and date) is placed like a callout by `marker_offset`, with a solid connector to the line's end: `y ≤ 0` above the topmost bar (default `{ x: 0, y: -16 }`), `y > 0` below the bottommost. With `view.absolute` the line is straight down the common time axis; without it each timeline has its own axis, so timelines whose range doesn't hold the date are skipped, and a `global` marker is drawn on each timeline separately (its own line across that bar and its own label, as if added to that timeline alone; all share the one `marker_offset`). The line is one element per straight run, in the view's root, placed by measuring the bars after rendering and again on resize (`markerPlan`, `markerLines`, `layoutMarkerLines` in `render.ts`); with `absolute` that is one element for the whole line, so its width can't vary between timelines. Don't split it into per-timeline pieces: at display scales such as 125% they round to device pixels differently and the line changes thickness. The label can be dragged like a callout label: dropped above a bar it goes above the topmost timeline showing the marker, below a bar below the bottommost; the drop sets `marker_offset` and fires `marker_moved`. The drop calls `setMarkerOffset`, which is saved like any marker change (`PATCH /views/{id}/markers/{marker_id}`).
- **Area size:** each callout area's height fits all of its labels, plus padding on the outer side to drop into. It is a one-cell CSS grid where labels are placed with margins, so the browser sizes it (see `render.ts`).
- **Drag and drop:**
  - Task bars and milestones can be dragged between bar lines and timelines. A drop on a bar line goes to the line under the pointer. The bar has a virtual half line above its first line and below its last; dropping there inserts a new line at the top or bottom.
  - Any entry can be dragged into a callout area. The label's `callout_offset` is set from where it lands (for a bar, the label's corner goes at the pointer).
  - A drop outside every area (past the view's edge, on a name, or on the time scale) goes to the vertically nearest callout area, which grows to include the new position.
  - The number of bar lines is not part of the data: it is always calculated as the highest `line` the timeline's entries use, plus one, at least 1. Inserting a line shifts the lines below it down by one. After every move, the affected timelines are trimmed: blank lines above the first used line are removed by renumbering the entries so the first used line is 0, and blank lines after the last used line are not counted. Gaps between used lines stay, unless `view.compact_lines` is true: then every empty line of an affected timeline closes up (used lines renumbered 0, 1, 2, ... in order), so the lines below a line a task leaves move up. `trimLines(timeline, compact)` in `model.ts` holds both rules, and every change in the model passes the view's setting; a backend must apply the same. Loaded data keeps its gaps until something on that timeline changes. The bar never shows blank lines above the first used line, even in loaded data that has them.
  - Escape cancels a drag. Dropping does not change a task's dates.
  - A press turns into a drag after 4 px of pointer travel (`DRAG_THRESHOLD`); released before that it is a click. `isDragging()` is true from then until release or cancel (it reads the root's `tlv--dragging` class, which `drag.ts` removes before applying the drop). `dragging_started` fires at the start; `dragging_ended` (`dropped`: released on a target) fires after the drop is applied, so after its `entry_moved` / `marker_moved`, and also when a drag is cancelled by Escape, `pointercancel` or `destroy()`. Drags the host runs from outside the view (`targetAt`) aren't included.
- **Drops from outside the view:** the host runs its own drag (for example from a backlog list) and calls `targetAt(x, y, task?)` for the drop target under the pointer (`null` outside the view's box; inside it, the same hit test as internal drags, looking through elements that aren't part of the view such as the host's ghost), `highlightTarget(target)` to show it (class `tlv-drop`, one at a time, cleared by a re-render), and `addEntry(task, target)` to drop. With `task`, a callout target gets a `callout_offset` with the label's corner at the point. See [examples/add.html](examples/add.html).

### Not built yet

Everything in the data can be changed through the [JavaScript API](#javascript-api), and with `api_url` every change is saved through the [REST API](#rest-api). What is missing is UI inside the component:

- Editing a task's dates or duration by dragging or resizing its bar (the host can call `updateTask`).
- Built-in controls for the rest: the `controls` option covers adding timelines, taking a task off a timeline, reordering and renaming timelines. Editing tasks, markers and timeline dates, removing timelines and tasks, and renaming the view still need the host's own buttons or forms (see the examples).
- Keyboard and screen-reader support for moving entries.

Also: a task is created only together with its first entry (`addEntry`); there is no call to create a task that is on no timeline.

## Data format

Input to `parse()`, output of `serialize()`. See [examples/basic.html](examples/basic.html) for a runnable version and [src/types.ts](src/types.ts) for the full types.

```js
{
  version: 7,                          // optional; server version, used by the REST API
  view: {
    id: "v1",                          // required when api_url is set
    name: "Example",                   // shown as a heading above the timelines; "" for none
    absolute: false,                   // default false: each bar fills the width; true: common time axis
    scale: "week",                     // default "day"
    name_position: "left",             // default "left"
    milestone_symbol: "diamond",       // default "diamond"
    show_dates: true,                  // default true: Start/Finish dates beside each bar
    compact_lines: false,              // default false: true closes up bar lines a change leaves empty
    selection: true                    // default true: clicks select and highlight tasks and timelines
  },
  tasks: [
    { id: 1, text: "Task #1", start_date: "2026-04-01", duration: "2d", color: "#0a7f5a" },   // finishes 2026-04-03; own color
    { id: 2, text: "Milestone #1", start_date: "2026-04-10", symbol: "star" },  // no duration → milestone
    { id: 3, text: "Review", start_date: "2026-04-15T09:00:00Z", finish_date: "2026-04-17T17:00:00+02:00" }  // finish given; timestamps with zones
  ],
  timelines: [
    { id: 1, name: "Project", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [
      { task: 1, line: 1 },
      { task: 2, callout_offset: { x: 30, y: 16 } },
      { marker: 1 }                      // shows marker 1 on this timeline
    ]}
  ],
  markers: [                             // optional
    { id: 1, text: "Today", date: "2026-03-20", color: "blue",   // color optional, default red
      global: false,                     // true: on every timeline, no entries needed
      marker_offset: { x: 0, y: -16 } }  // label: y ≤ 0 above the top bar, y > 0 below the bottom one
  ]
}
```

Any other attributes on a task are the host's own: kept (`Task.custom`), returned by `serialize()`, and passed to task layers.

`parse()` throws on invalid data: a marker with a bad date, a duplicate id, an invalid `color` or `marker_offset`; a `{ marker }` entry for an unknown marker, twice on one timeline, or with other fields; a task `color` that isn't a CSS color; an unknown milestone symbol (a task's `symbol` or `view.milestone_symbol`; only `diamond`, `circle`, `square`, `triangle`, `star`); a timeline without `start_date` or `finish_date`, or finishing before it starts; bad dates or durations, a task with both `duration` and `finish_date` or finishing before it starts, duplicate task ids, entries for unknown tasks, a task twice on one timeline, a negative or fractional `line`, an entry with both `line` and `callout_offset`, or a `callout_offset` without numeric `x` and `y`.

## JavaScript API

| Call | Purpose |
|------|---------|
| `timeline.init(container, { api_url?, fetch?, format_date?, format_tick? })` | Creates the default instance in an element or element id. `format_date(date, { kind, date_only })` and `format_tick(date, { scale, major })` replace the built-in date text and time-scale labels (see below). |
| `timeline.init(container, { controls: true })`, `timeline.setControls(on)` | The built-in controls: a menu above the heading (`.tlv-menu`, "+ Timeline"), a × on each task bar, milestone and callout (`removeEntry`), and on each name label ↑/↓ (`moveTimelineUp/Down`) and an editable name (`renameTimeline`; Enter or blur saves, Escape cancels, empty is ignored). Drawn by `render.ts` when `Display.controls` is set; buttons carry `data-action`, handled by `onControlClick` in `view.ts`; `drag.ts` ignores presses on `.tlv-control` and `.tlv-name-text`. `toSVG()` renders without them. React: the `controls` prop. |
| `timeline.setFormatters({ format_date?, format_tick? })` | Replaces either formatter and redraws; `undefined` goes back to the built-in one, a missing key keeps the current one. `defaultFormatDate` / `defaultFormatTick` are exported for falling back. |
| `timeline.parse(data)` | Loads data and renders it. |
| `timeline.load(view_id)` | Loads with `GET /views/{view_id}` (needs `api_url`). |
| `timeline.serialize()` | Returns the current data. |
| `timeline.getTaskPosition(task, timeline, from?, to?)` | `{ left, right, top, height, width }` in CSS pixels, relative to the bar's task area (`.tlv-track`), measured from the current layout; `top` is the task's line (the first line for a callout). `task` is a task or id, `timeline` a timeline or id; `from`/`to` (`Date` or date string) default to its start and finish and are held at the bar's edges. `null` for an unknown task, a task not on that timeline, or a hidden view. |
| `timeline.addTaskLayer(layer)`, `removeTaskLayer(id)` | `layer(task, timeline)` (the task's and the timeline's data; `this` is the view in a `function`) returns the host's element for a task on a bar line, or false. Elements go in `.tlv-layers`, first in `.tlv-track`, so under the task bars and with `pointer-events: none`. Drawn by `drawLayers` in `view.ts` from the end of `layout()` (`onLayout` in `render.ts`), so again after every change and resize, and not while hidden. A layer that throws is logged and skipped. `toSVG()` draws layers as filled rectangles. |
| `timeline.templates`, `view.templates`, `timeline.render()` | Functions returning extra CSS classes: `task_class`, `task_text_class`, `milestone_class`, `milestone_text_class`, `callout_class`, `callout_marker_class` `(start, end, task)`; `timeline_class`, `timeline_bar_class`, `timeline_name_class`, `scale_cell_class` `(start, end, timeline)`; `bar_line_class` `(start, end, timeline, line)`; `marker_class` `(start, end, marker)`. Items are in the data format. Applied by `styled()` in `render.ts` through `Display.classes` (`classesOf` in `view.ts`; a template that throws is logged and adds nothing). Run on every draw; `render()` redraws after setting them. The global object is shared with the default instance by `init()`. React: the `templates` prop. |
| `timeline.templates.task_text`, `escapeHtml(text)` | `(start, end, task)` returns an HTML string or DOM node for the content of a task's bar (`.tlv-task-label`); a failure falls back to the text. The HTML is inserted as is, so hosts must escape untrusted text. `drag.ts` ignores presses on `button`, `a[href]` and form fields, so they don't drag, click or select. `toSVG()` writes the task's plain text (`data-plain-text`). |
| `timeline.isDragging()` | Whether the user is dragging an entry or a marker label in the view right now. See the drag rules in [User interface](#user-interface). |
| `timeline.resize()` | Lays the view out again for its container's size, without rebuilding it. Automatic on size changes and when a hidden view is shown; for hosts that want to call it themselves (for example from a docking library's resize callback). |
| `timeline.toSVG()` | Returns the view as a standalone SVG document (a string), as it looks on screen. The view must be rendered and visible. Saving it is up to the host page; see [examples/export.html](examples/export.html). |
| `timeline.moveEntry(timeline_id, task_id, patch)` | Moves an entry, as a drop does. Takes the PATCH body below, without `version`. |
| `timeline.on("entry_moved" \| "move_failed" \| "dragging_started" \| "dragging_ended" \| "marker_moved" \| "marker_added" \| "marker_updated" \| "marker_removed" \| "marker_shown" \| "marker_hidden" \| "entry_added" \| "entry_removed" \| "timeline_moved" \| "task_removed" \| "task_updated" \| "timeline_removed" \| "view_renamed" \| "timeline_renamed" \| "timeline_updated" \| "timeline_added" \| "save_failed", handler)` | Subscribes to change events. Returns an unsubscribe function. `dragging_started` gets `{ kind: "entry", timeline_id, task_id }` or `{ kind: "marker", marker_id }`; `dragging_ended` the same plus `dropped`. `marker_moved` gets `{ marker_id, marker_offset }`; `entry_added` gets `{ timeline_id, task_id, task, new_task, entry, timeline }` (`timeline`: its full data after the add); `timeline_moved` gets `{ timeline_id, from_index, to_index, order }` (0-based positions; `order`: all timeline ids, top to bottom); `task_removed` gets `{ task_id, task, timelines }` (the timelines it was on, after); `timeline_removed` gets `{ timeline_id, timeline, index, order }` (`index`: its position before; `order`: the rest); `view_renamed` gets `{ name, old_name }`; `timeline_renamed` gets `{ timeline_id, name, old_name }`; `timeline_updated` gets `{ timeline_id, timeline, old_timeline }`; `timeline_added` gets `{ timeline_id, timeline, index, order }`; `entry_removed` gets `{ timeline_id, task_id, entry, timeline }`; `task_updated` gets `{ task_id, task, old_task }`; `save_failed` gets `{ action, timeline_id?, task_id?, error }` (`action`: `rename_view`, `add_timeline`, `rename_timeline`, `update_timeline`, `move_timeline`, `remove_timeline`, `add_entry`, `remove_entry`, `update_task`, `remove_task`, `add_marker`, `update_marker`, `remove_marker`, `show_marker` or `hide_marker`; `marker_id` set for those), after the view was rolled back (or re-rendered from a 409). |
| `timeline.targetAt(x, y, task?)` | Hit test in client coordinates: the drop target `{ timeline_id, placement, line?, new_line?, callout_offset? }` at the point, or `null` outside the view. `task` (id or new task data) gives callout targets an offset. |
| `timeline.highlightTarget(target \| null)` | Highlights a drop target as internal drags do, or removes the highlight. Returns `false` if the target isn't in the view. |
| `timeline.addEntry(task, target)` | Adds a task (an existing id, or new task data, which is added to `tasks`) at a target, following the move rules; without `placement`, a `callout_offset` makes a callout, otherwise the bar (`line` default 0). Fires `entry_added`. Returns a promise like the other changes: rejects with a `MoveError` (`not_found`, `conflict`, `invalid`) without changing anything, or after a failed save. With `api_url`, saved with `POST .../timelines/{id}/entries` (new task data in the same request). |
| `timeline.removeEntry(timeline_id, task_id)` | Takes a task off one timeline (it stays in `tasks`), trims that timeline, fires `entry_removed` `{ timeline_id, task_id, entry, timeline }`. Promise like the others; rejects with a `MoveError` (`not_found`) if the task isn't on it. With `api_url`, saved with `DELETE .../timelines/{id}/entries/{task_id}`. |
| `timeline.setMarkerOffset(marker_id, { x, y })` | Moves a marker's label, as dragging it does: the same as `updateMarker(id, { marker_offset })`. |
| `timeline.addMarker(data)`, `updateMarker(id, patch)`, `removeMarker(id)` | Add a marker (data format; a non-global one shows nowhere until `showMarker`), change its `text`, `date`, `color` (`null` for the theme's), `global` or `marker_offset`, or remove it with its `{ marker }` entries. Validated as `parse()` would; rules in `TimelineModel`. Fire `marker_added` `{ marker_id, marker }`, `marker_updated` `{ marker_id, marker, old_marker }` (plus `marker_moved` when the label moved), `marker_removed` `{ marker_id, marker, timelines }`. Promises like the other changes (`updateMarker`: `false` if nothing changed). With `api_url`: `POST /views/{id}/markers`, `PATCH` / `DELETE .../markers/{marker_id}`. |
| `timeline.showMarker(timeline_id, marker_id)`, `hideMarker(timeline_id, marker_id)` | Add or remove a timeline's `{ marker }` entry. Fire `marker_shown` / `marker_hidden` `{ timeline_id, marker_id, timeline }`. `showMarker` resolves to `false` if already shown; `hideMarker` rejects (`not_found`) if not. With `api_url`: `PUT` / `DELETE .../timelines/{id}/markers/{marker_id}`. |
| `timeline.attachEvent(name, handler)` | Subscribes to a user event; returns an event id. Inside a `function` handler, `this` is the view. Events: `onTaskClick (task_id, event, timeline_id)`: a task bar, milestone or callout clicked without dragging. `onTimelineClick (timeline_id, event)`: a timeline clicked outside its tasks. `onTaskSelected (task_ids)`, `onTimelineSelected (timeline_ids)`: the selection changed; the lists hold every selected id. |
| `timeline.selectTask(id, add?)`, `selectTimeline(id, add?)` | Selects only this item, or with `add` adds it to the selection (same kind only). Return `false` when `view.selection` is off. |
| `timeline.unselectTask(id)`, `unselectTimeline(id)`, `clearSelection()` | Deselects one item, or everything. |
| `timeline.getSelectedTasks()`, `getSelectedTimelines()` | The selected ids, in the order they were selected; `[]` when the other kind (or nothing) is selected. |
| `timeline.moveTimelineUp(id)`, `moveTimelineDown(id)`, `moveTimeline(id, delta)` | Reorders the timelines and fires `timeline_moved`. Return a promise, like the other view and timeline changes below: it resolves to `true` once saved (at once without `api_url`), or `false` at the top or bottom, without the event. With `api_url`, saved with `PATCH .../timelines/{id}` `{ position }`. |
| `timeline.renameView(name)`, `renameTimeline(id, name)` | Changes the view's name (the heading; `""` for none) or a timeline's name, and fires `view_renamed` / `timeline_renamed`. The promise resolves to `true` once saved, or `false`, without the event, when the name is unchanged. Rejects with a `MoveError` for an unknown timeline (`not_found`) or a non-string name (`invalid`). With `api_url`, saved with `PATCH /views/{id}` or `PATCH .../timelines/{id}` `{ name }`. |
| `timeline.updateTask(id, patch)` | Changes a task's `text`, `start_date`, `duration` / `finish_date`, `symbol`, `color` or custom attributes (only the fields given; `null` clears an optional one or removes a custom one; `id` can't change; setting `duration` drops `finish_date` and the reverse; clearing both makes a milestone). Validated as `parse()` would; rules in `TimelineModel.updateTask`. Fires `task_updated` `{ task_id, task, old_task }`. Promise like the other changes: `true`, or `false` without the event if nothing changed; rejects with a `MoveError` (`not_found`, `invalid`) without changing anything. With `api_url`, saved with `PATCH /views/{id}/tasks/{task_id}`; the response's task replaces the local one. |
| `timeline.updateTimeline(id, { name?, start_date?, finish_date? })` | Changes a timeline's name and/or range (only what's given; the finish must stay after the start; entries outside the new range stay, drawn at the edge). Rules in `TimelineModel.updateTimeline`; `renameTimeline` is the shortcut for `{ name }`. Fires `timeline_updated` `{ timeline_id, timeline, old_timeline }`, plus `timeline_renamed` when the name changed. Promise like the others: `false` if nothing changed; rejects with a `MoveError` (`not_found`, `invalid`). With `api_url`, saved with `PATCH .../timelines/{id}`. |
| `timeline.removeTask(id)` | Removes a task from `tasks` and from every timeline (their lines are trimmed as after a move). Deselects it, fires `task_removed`. Promise like the others; rejects with a `MoveError` (`not_found`) for an unknown id. With `api_url`, saved with `DELETE /views/{id}/tasks/{task_id}`. |
| `timeline.removeTimeline(id)` | Removes a timeline and its entries; its tasks stay, also those on no other timeline. Deselects it, fires `timeline_removed`. The promise resolves once saved; rejects with a `MoveError` (`not_found`) for an unknown id. With `api_url`, saved with `DELETE .../timelines/{id}`. |
| `timeline.addTimeline(data, position?)` | Adds a timeline in the data format (`entries` optional) at a 0-based position, the bottom by default; validated as `parse()` would. Fires `timeline_added`. The promise resolves once saved; rejects with a `MoveError` (`conflict` for an id in use, `invalid`) without changing anything. With `api_url`, saved with `POST .../timelines`. |
| `timeline.whenSaved()` | A promise that resolves when every change so far has been answered by the REST API (or failed; failures go to `move_failed` / `save_failed`). At once without `api_url`. |
| `timeline.detachEvent(event_id)` | Removes a handler added with `attachEvent`. Returns `false` for an unknown id. |
| `new timeline.TimelineView(container, options)` | Separate instance, for more than one view on a page. Same methods. |

## REST API

The API is optional. Turn it on with `timeline.init("timeline_here", { api_url: "https://example.com/api" })`. All paths are relative to `api_url`. Bodies are JSON in the data format above. The full spec is [docs/api/openapi.yaml](docs/api/openapi.yaml).

### Load a view

`GET /views/{view_id}` returns the whole view in the `parse()` format, including `version`.

### Move a callout

The move body still names the target area with `placement`, because moving onto the bar has no offset to derive it from. The entries in responses use the data format above (no `placement`).

`PATCH /views/{view_id}/timelines/{timeline_id}/entries/{task_id}`

This covers every way a user can move a callout: dragging the label to a new position (offset), switching side (`above` / `below`), moving it onto the bar (`on`), or dragging it to another timeline. Bars and milestones on the bar use the same call. Send only the fields that change:

```json
{
  "timeline_id": 2,
  "placement": "above",
  "callout_offset": { "x": 40, "y": -60 },
  "version": 7
}
```

| Field            | Meaning |
|------------------|---------|
| `timeline_id`    | Target timeline, when the entry moves to a different timeline. Leave it out to stay on the current one. |
| `placement`      | New area: `above`, `on`, or `below`. Moving to `on` drops `callout_offset`. |
| `line`           | Bar line, only with placement `on`, from 0 to one past the last line (which opens a new line at the bottom). Defaults to 0 when coming from another area or timeline, otherwise the current line. |
| `new_line`       | `true` inserts a new bar line at `line` and shifts the lines from there down by one. Only with placement `on`. The UI sends `line: 0` (top) or one past the last line (bottom). |
| `callout_offset` | New `{ x, y }` (see [User interface](#user-interface)). Only for `above` and `below`; `y` must be on the right side of the bar (`≤ 0` above, `> 0` below). If left out, a callout keeps its offset, mirrored (`y` → `-y`) when it switches side; an entry coming from the bar gets the default. |
| `version`        | The view version the client last saw, for optimistic concurrency. |

Responses:

- **200** returns `{ "version": 8, "timelines": [ ... ] }`, the full entries of every timeline the move affected (the source timeline and, if different, the target). The client replaces those timelines with the response.
- **404:** the view, timeline, or entry doesn't exist.
- **409:** the `version` is stale, or the task is already on the target timeline. The response body holds the current view, and the client re-renders from it.
- **422:** invalid values: an unknown `placement`; `line` that is negative, more than one past the last line, or sent for a callout; `new_line` for a callout; `callout_offset` with `on`; or `callout_offset.y` on the wrong side of the bar.

Client behavior:

- The component applies the move at once (optimistic update), fires `entry_moved`, then sends the PATCH.
- Requests are sent one at a time, in order.
- On 409 the view re-renders from the response body. On any other error it rolls back to the state before the move and fires `move_failed`.
- Moves queued behind a failed one are cancelled and rolled back with it.

### Add and remove entries

`POST /views/{view_id}/timelines/{timeline_id}/entries` puts a task on a timeline (`addEntry`, for example a drop from a list outside the view). The body is `{ "task": ..., "version": 7 }` plus where it goes, with the move's fields except `timeline_id` (that's in the path): `placement`, `line`, `new_line`, `callout_offset`. `task` is the id of a task the view has, or a new task's data (`{ id, text, start_date, ... }`), which the server adds to the tasks in the same change, so a drop of a new task is one request that succeeds or fails as a whole. Without `placement`, a `callout_offset` makes a callout and otherwise the entry goes on the bar (`line` default 0); a callout without an offset gets the default.

`DELETE /views/{view_id}/timelines/{timeline_id}/entries/{task_id}?version=7` takes a task off a timeline (`removeEntry`). The task stays, also when it is now on no timeline.

Both return `{ "version": 8, "timelines": [ ... ] }` with the changed timeline, like a move, and the client takes it over when nothing else is waiting. **404**: unknown view, timeline or task (or the task isn't on that timeline, for `DELETE`). **409**: stale `version`, the task already on the timeline, or new task data with an id in use. **422**: invalid placement values (as for a move) or invalid new task data.

### Edit and remove tasks

`PATCH /views/{view_id}/tasks/{task_id}` changes a task (`updateTask`). The body holds only the fields that change, plus `version`: `text`, `start_date`, `duration`, `finish_date`, `symbol`, `color`, or custom attributes. `null` clears an optional field or removes a custom attribute. The finish is given one way: setting `duration` drops `finish_date` and the other way round, and clearing both makes a milestone. The result must be valid as in a loaded view. **200** returns `{ version, task }`, which replaces the local task when nothing else is waiting. **422**: a changed `id`, a bad value, both `duration` and `finish_date`, a finish before the start, or `start_date: null`.

`DELETE /views/{view_id}/tasks/{task_id}?version=7` removes a task from the view and from every timeline it is on (`removeTask`). **200** returns `{ version, timelines }`: the timelines it was on.

Both: **404** for an unknown task, **409** for a stale `version`. Failures fire `save_failed` (`update_task`, `remove_task`).

### Markers

| Call | Body | 200 returns | Sent by |
|------|------|-------------|---------|
| `POST /views/{view_id}/markers` | `{ "marker": { id, text, date, ... } }` | `{ version, marker }` | `addMarker` |
| `PATCH /views/{view_id}/markers/{marker_id}` | only what changes: `text`, `date`, `color` (`null` clears), `global`, `marker_offset` | `{ version, marker }` | `updateMarker`, `setMarkerOffset`, dragging a label |
| `DELETE /views/{view_id}/markers/{marker_id}?version=7` | none | `{ version, timelines }` (those that had an entry for it) | `removeMarker` |
| `PUT /views/{view_id}/timelines/{timeline_id}/markers/{marker_id}` | `{ "version": 7 }` | `{ version, timelines }` | `showMarker` |
| `DELETE /views/{view_id}/timelines/{timeline_id}/markers/{marker_id}?version=7` | none | `{ version, timelines }` | `hideMarker` |

A returned marker replaces the local one, and returned timelines replace theirs, when nothing else is waiting. **404**: unknown view, timeline or marker (or, for hiding, a timeline without an entry for it). **409**: stale `version`, or (for `POST`) a marker id in use. **422**: invalid values, as `parse()` would reject them. Failures fire `save_failed` with the marker actions.

### View and timeline changes

Renaming the view, and adding, renaming, reordering and removing timelines, are saved with these calls. Each body carries `version` like the move (for `DELETE`, as a query parameter), and each **200** returns the new `version`:

| Call | Body | 200 returns | Sent by |
|------|------|-------------|---------|
| `PATCH /views/{view_id}` | `{ "name": "Roadmap" }` | `{ version, view }` | `renameView` |
| `POST /views/{view_id}/timelines` | `{ "timeline": { id, name, start_date, finish_date, entries }, "position": 2 }` | `{ version, order }` | `addTimeline` |
| `PATCH /views/{view_id}/timelines/{timeline_id}` | only what changes: `name`, `start_date`, `finish_date`, or `position` | `{ version, order }` | `updateTimeline`, `renameTimeline`, `moveTimeline*` |
| `DELETE /views/{view_id}/timelines/{timeline_id}?version=7` | none | `{ version, order }` | `removeTimeline` |

`position` is the timeline's 0-based index in the stack after the change; `order` lists every timeline's id, top to bottom. **404**: unknown view or timeline. **409**: stale `version` (or, for `POST`, a timeline id in use), with the current view as the body. **422**: a name that isn't a string, bad dates or a finish not after the start, a position out of range, or invalid timeline data (as `parse()` would reject it).

These share the moves' queue (`save` in `view.ts`): applied at once, sent one at a time in the order made, rolled back on error together with everything queued after them, re-rendered from the body on 409. They, and the entry adds and removals above, report failures with `save_failed` instead of `move_failed`. Like `moveEntry`, each method applies the change at once and returns a promise that settles when it is saved: it rejects after a failed save (with the `ApiError`, or `MoveCancelledError` for a change cancelled behind a failed one), and for invalid input (`MoveError`, nothing changed). `whenSaved()` waits for everything queued. The mock server in `examples/rest.html` implements all of them with the model (`addEntry` with `addTargetFromData`, `removeEntry`, `updateTask`, `removeTask`, the marker calls, `renameView`, `addTimeline`, `renameTimeline`, `setTimelinePosition`, `removeTimeline`).
