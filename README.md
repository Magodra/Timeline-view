# ar-timeline-view

A timeline view for web planning applications. Framework-free TypeScript with no runtime dependencies.

![Two timelines with task bars, milestones and callouts above and below the bars](https://github.com/Magodra/ar-timeline-view/raw/v1.1.0/docs/images/features.svg)

- Several timelines stacked in one view, each with its own date range, on an hour, day, week, month or year scale.
- Relative timelines that each fill the width, or absolute ones on a common time axis.
- Arrows on tasks that continue past a timeline's range.
- Date markers (such as "Today") across one, several or all timelines.
- Tasks drawn as bars and milestones as symbols, on the bar or as callouts above and below it.
- Selection of tasks and timelines, with click and selection events.
- Drag and drop between lines, areas and timelines.
- Drag in tasks from your own page (`targetAt()`, `highlightTarget()`, `addEntry()`).
- Custom styling from your data with class templates (`timeline.templates.task_class = (start, end, task) => ...`), and your own elements on the bars with task layers.
- Optional built-in controls: add timelines from a menu, × to take a task off a timeline, ↑/↓ and in-place renaming on timeline labels.
- Export as SVG (`toSVG()`).
- Optional REST backend for saving moves, with optimistic updates and rollback.

**Documentation:** [getting started](https://github.com/Magodra/ar-timeline-view/blob/v1.1.0/docs/getting-started.md) · [user guide](https://github.com/Magodra/ar-timeline-view/blob/v1.1.0/docs/user-guide.md) · [developer guide](https://github.com/Magodra/ar-timeline-view/blob/v1.1.0/docs/developer-guide.md) · [REST API](https://github.com/Magodra/ar-timeline-view/blob/v1.1.0/docs/api/openapi.yaml)

## Install

```sh
npm install ar-timeline-view
```

## Use it as a module

```js
import { TimelineView } from "ar-timeline-view";
import "ar-timeline-view/timelineview.css";

const view = new TimelineView(document.getElementById("timeline_here"));
view.parse({
    view: { name: "Example", scale: "week" },
    tasks: [
        { id: 1, text: "Task #1", start_date: "2026-04-01", duration: "2d" },
        { id: 2, text: "Milestone #1", start_date: "2026-04-10" }
    ],
    timelines: [
        { id: 1, name: "Project", start_date: "2026-03-01", finish_date: "2026-05-01", entries: [
            { task: 1, line: 1 },
            { task: 2, callout_offset: { x: 30, y: 16 } }
        ]}
    ]
});
```

TypeScript types are included.

## Use it from React

An optional component, for React 18 or later:

```jsx
import { useRef, useState } from "react";
import { Timeline } from "ar-timeline-view/react";
import "ar-timeline-view/timelineview.css";

function Plan({ initialData }) {
  const [data] = useState(initialData);
  const view = useRef(null);   // the TimelineView, for moveEntry, updateTask, toSVG, ...
  return (
    <Timeline
      ref={view}
      data={data}
      style={{ height: "100%" }}
      onEntryMoved={(e) => save(e)}
      onTaskClick={(taskId, event, timelineId) => console.log(taskId, timelineId)}
    />
  );
}
```

Every event is a prop (`onEntryMoved`, `onSaveFailed`, `onTaskClick`, ...), and the `ref` is the `TimelineView` for everything else. React is only needed for this import.

## Use it from a script tag

The UMD build sets a global `timeline` object with a default instance:

```html
<script src="https://cdn.jsdelivr.net/npm/ar-timeline-view@1/dist/timelineview.js"></script>
<link href="https://cdn.jsdelivr.net/npm/ar-timeline-view@1/dist/timelineview.css" rel="stylesheet">

<div id="timeline_here" style="width: 1000px;"></div>
<script>
    timeline.init("timeline_here");
    timeline.parse(data);   // same data as above
</script>
```

Either example renders this:

![One timeline with a task bar and a milestone callout below it](https://github.com/Magodra/ar-timeline-view/raw/v1.1.0/docs/images/basic.svg)

With `view.absolute: true`, timelines with different date ranges share one time axis:

![Three timelines with different date ranges on a common time axis; tasks that continue past a range end in arrows](https://github.com/Magodra/ar-timeline-view/raw/v1.1.0/docs/images/absolute.svg)

## Save changes

The component doesn't store data itself. Listen for moves and save them:

```js
timeline.on("entry_moved", ({ timeline_id, task_id, patch }) => {
    save(timeline_id, task_id, patch);   // patch holds only the changed fields
});
```

Or point it at a backend that implements the [REST API](https://github.com/Magodra/ar-timeline-view/raw/v1.1.0/docs/api/openapi.yaml):

```js
timeline.init("timeline_here", { api_url: "https://example.com/api" });
timeline.load("my-view-id");
```

## Package contents

| File | Use |
|------|-----|
| `dist/timelineview.mjs` | ES module (`import`) |
| `dist/react.mjs` | Optional React component (`import { Timeline } from "ar-timeline-view/react"`) |
| `dist/timelineview.js` | UMD build, global `timeline` |
| `dist/timelineview.css` | Styles, themable through `--tlv-*` custom properties |
| `dist/types/` | TypeScript declarations |

Works in current evergreen browsers (Chrome, Edge, Firefox, Safari).

## Links

- Documentation: <https://github.com/Magodra/ar-timeline-view/tree/v1.1.0/>
- Source and issues: <https://github.com/Magodra/ar-timeline-view>

## License

MIT
