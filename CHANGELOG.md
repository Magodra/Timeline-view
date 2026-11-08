# Changelog

All notable changes to `ar-timeline-view`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).


## Unreleased

### Changed

- **User guide.** The content templates (`task_text`, `milestone_text`, `callout_text`, `marker_text`, `tooltip_text`) have their own table, with the `entry` argument they receive.

## 1.3.0

### Added

- **More content templates.** `timeline.templates.milestone_text`, `callout_text` and `marker_text` give the content of those labels, like `task_text`. The task templates, `task_text` included, get the task's entry as a fourth argument, for example to show which items are pinned.
- **Your own tooltips.** `tooltip_text` and `tooltip_class` replace the browser's tooltip with one the view draws, for task bars, milestones, callouts and marker labels.
- **Pinning.** `draggable: false` on an entry or marker stops the user dragging it. `setEntryDraggable()` and `setMarkerDraggable()` change it later, and it is saved with a REST backend. New event `entry_draggable_changed`. `addEntry()` takes `draggable: false` to add an entry pinned. See `examples/pins.html`, and "Pin dropped items" in `examples/add.html`.
- **Callout layers.** `addCalloutLayer(layer)` draws your own elements on the bar's edge, and `getCalloutPosition(task, timeline, from?, to?)` gives the position of a callout's bar or milestone symbol.
- **Drag state.** `isDragging()` tells whether the user is dragging an entry or a marker label. New events `dragging_started` and `dragging_ended` (with `dropped`) mark the start and end of a drag; in React, `onDraggingStarted` and `onDraggingEnded`.
- **Timeline clicks in the basic example.** `examples/basic.html` now also reports clicks on a timeline, with `onTimelineClick`.

## 1.2.1

- **Image links** in README.md modified. 

## 1.2.0

### Added

- **Your own date format.** New view options `format_date(date, info)` and `format_tick(date, info)` replace the built-in date text (callout labels, tooltips, Start/Finish, marker labels) and the time-scale labels, so dates can match the rest of your app (time zone, language). `info.date_only` marks plain dates such as `"2026-04-01"`, which should be formatted in UTC so they don't shift to the day before in time zones west of UTC. `setFormatters()` changes them later; `defaultFormatDate` and `defaultFormatTick` are exported for falling back. In React: the `formatDate` and `formatTick` props.
- **Built-in controls.** With the new option `controls: true` the view brings its own editing controls: a menu above the heading to add a timeline, a × on each task bar, milestone and callout to take it off that timeline, and ↑/↓ and an editable name on each timeline label. They fire the usual events and are saved with a REST backend. `setControls()` turns them on and off; in React, the `controls` prop. See `examples/controls.html`.
- **Compact bar lines.** With the new view option `compact_lines: true`, a bar line that a move leaves empty closes up, and the lines below it move up. Off by default, where empty lines stay as gaps as before.
- **Class templates.** `timeline.templates` holds functions returning extra CSS classes for task bars and their text, milestones, callouts, timelines, bars, name labels, bar lines, scale cells and markers, so styling can follow the data. `render()` redraws after changing them; in React, the `templates` prop.
- **Custom content in task bars.** `timeline.templates.task_text` returns HTML or a DOM node for a task's bar. Buttons, links and form fields in a bar work without starting a drag. `escapeHtml()` makes untrusted text safe to include.
- **Task layers.** `addTaskLayer(layer)` draws your own elements on the bars, under the task bars. `getTaskPosition(task, timeline, from?, to?)` returns `{ left, right, top, height, width }` in CSS pixels for placing them.
- **Custom task attributes.** Attributes on a task that the view doesn't know are kept, returned by `serialize()`, passed to task layers, and can be changed with `updateTask()`.

## 1.1.0

### Added

- **Editing through the API.** Everything in the data can now be changed from code, and with `api_url` every change is saved through the REST API (see `docs/api/openapi.yaml`):
  - Tasks: `updateTask()` (text, dates, duration or finish date, symbol, color) and `removeTask()`.
  - Entries: `addEntry()` adds a task (a known one, or a new task's data) to a timeline; `removeEntry()` takes it off one timeline.
  - Timelines: `addTimeline()`, `updateTimeline()` (name and dates), `renameTimeline()`, `removeTimeline()`, and the existing `moveTimelineUp()` / `moveTimelineDown()` / `moveTimeline()`.
  - The view: `renameView()`.
  - Markers: `addMarker()`, `updateMarker()`, `removeMarker()`, and `showMarker()` / `hideMarker()` for which timelines show a marker. A dragged marker label is now saved too.
  - An event for each change (`task_updated`, `entry_added`, `timeline_moved`, `marker_updated`, ...), and `save_failed` when saving fails. The view then shows the restored state.
  - `whenSaved()` waits until every change has been answered by the backend.
- **Dragging items in from your own page.** `targetAt(x, y)` finds the drop target under the pointer, `highlightTarget()` highlights it, and `addEntry()` drops. See `examples/add.html`.
- **Task finish dates.** A task can have a `finish_date` instead of a `duration`.
- **Full ISO 8601 timestamps.** Dates may have seconds, fractions and a time zone (`Z` or `+02:00`), and are converted to UTC. `serialize()` returns each date exactly as it was given.
- **Resizing.** The view follows its container's size: it works in resizable and docking layouts such as dockview, and in tabs that are hidden and shown again. Time-scale labels that don't fit are thinned out, keeping the ones with the year. `resize()` lays the view out on demand.
- **React component.** `import { Timeline } from "ar-timeline-view/react"`: data, events and options as props, and the `TimelineView` as its `ref`. React (18 or later) is an optional peer dependency; the core still has no dependencies.

### Changed

- **Breaking:** the editing methods now apply the change at once and return a promise that settles when it is saved (at once without a backend), as `moveEntry()` already did. `moveTimelineUp()`, `moveTimelineDown()` and `moveTimeline()` resolve to `true` or `false` instead of returning it, and `setMarkerOffset()` returns a promise. Invalid input rejects the promise instead of throwing.
- **Breaking:** `parse()` rejects an unknown milestone symbol, on a task (`symbol`) or as `view.milestone_symbol`. Only `diamond`, `circle`, `square`, `triangle` and `star` are valid.
- Date labels show seconds when they aren't zero.

### Fixed

- The published type declarations no longer import the stylesheet, which broke type checking in TypeScript apps that check library types.
- The REST client accepts every form of request headers (a `Headers` object or an array of pairs, not only a plain object).

## 1.0.1 – 1.0.6

### Changed

- A README written for npm, with links to the documentation on GitHub. The links point at the release they were published with, and are updated automatically on each release.

## 1.0.0

First release: timelines with tasks, milestones, callouts and date markers; drag and drop; selection; SVG export; and an optional REST backend for saving moves.
