# Developer guide

## Setup

```sh
npm install
npm run dev     # dev server with the examples, against the TypeScript source
npm test        # Vitest
npm run lint    # type-check
npm run build   # dist/: UMD + ESM bundles, CSS, type declarations
```

## How it fits together

```
parse(data) ──► TimelineModel.fromData ──► render() ──► DOM
                       ▲                                  │
                       │ moveEntry()                      │ pointer events
                       │                                  ▼
               TimelineView.moveEntry ◄────────── attachDrag (drop)
                       │
                       ├─► event: entry_moved
                       └─► RestClient.moveEntry (PATCH), queued
                              ├─ 200: replace affected timelines
                              ├─ 409: parse(server view)
                              └─ other: roll back, event: move_failed
```

- **`types.ts`** is the public data format in snake_case. **`model.ts`** converts it to the camelCase internal model and validates it.
- **`TimelineModel.moveEntry`** holds all the move rules: validation, inserting new bar lines, default and mirrored callout offsets. Its error codes (`not_found`, `conflict`, `invalid`) match the REST status codes (404, 409, 422), so a JavaScript backend can call it and map the codes directly. `examples/rest.html` does exactly that in a mock server.
- **`render.ts`** rebuilds the DOM from the model. Bar lines (`.tlv-line`) and callout areas (`.tlv-area`) carry `data-timeline` and `data-placement` (bar lines also `data-line`). The number of bar lines is computed by `lineCount` from the entries; it is not stored. `render` starts at `firstLine`, and `moveEntry` renumbers with `trimLines` so the first used line is 0. The half-height `.tlv-line--new` strips above the first line and below the last carry `data-new-line="true"`; a drop there sends `new_line: true`. Every draggable entry has `data-entry`, `data-timeline`, `data-task` and `data-at` (attachment point as a fraction of the width).
- **Callout areas size themselves.** Each is a one-cell CSS grid: every label sits in that cell, pushed into place with `margin-left: calc(at% + x px)` and `margin-bottom: -y px` (above) or `margin-top: y px` (below). The grid row is as tall as the furthest label, so the area always contains all labels without measuring. Only the connectors are measured after rendering (`layoutConnectors`), because they point at the nearest point of the label, which depends on its width. Each connector starts at the outer edge of its edge marker (`.tlv-edge-bar` or `.tlv-edge-symbol`); the marker sizes in `styles.css` must match `EDGE_BAR_HEIGHT` and `EDGE_SYMBOL_REACH` in `render.ts`.
- **`svg.ts`** exports the view by reading the rendered DOM: element boxes, text measured with a `Range`, and computed colors. It doesn't repeat the layout logic, so it stays correct as styles change, but it needs a laid-out view (in jsdom the tests can only check structure). New visual elements need a matching drawing step there; milestone symbol outlines are copied from `styles.css`.
- **Time ranges.** Each timeline has its own `start`/`finish`; positions on a bar are fractions of that range. Each timeline's bar and callout areas sit in a `.tlv-span`, which with `view.absolute` gets a `margin-left` and `width` from the timeline's place in `viewRange()` (earliest start to latest finish). Drag, connectors and the SVG export all measure relative to the area, so they need nothing special for it.
- **Events.** `on()` carries the move events (`entry_moved`, `move_failed`); `attachEvent()`/`detachEvent()` carry user events such as `onTaskClick`, keyed by a numeric event id, and call handlers with the view as `this`. To add one, extend `TimelineHandlers` and `HANDLER_NAMES` in `view.ts` and call `callHandlers`. Clicks come from `attachDrag`: a press and release that never passed the drag threshold (on an entry: `onClick`; elsewhere in a timeline or on the heading: `onBackgroundClick`). Selection lives in `TimelineView` (`selected`: one kind, `task` or `timeline`, and a list of ids), not in the model or the data; `clickSelect` holds the click and Ctrl+Click rules; `applySelection` toggles CSS classes after every render, so selecting never re-renders.
- **Markers.** `markerPlan()` in `render.ts` decides, per timeline, where each marker's line passes and where its label goes. `markerLines()` turns that into one element per straight run of the line (with `absolute`, one for the whole line; without it, a run breaks where a timeline's own axis puts the date elsewhere, and a global marker gets a separate run and label per timeline) and appends it to the view's root. `layoutMarkerLines()` places those elements by measuring the spans and bars, after every render and, through a `ResizeObserver` on the root and the timelines, whenever their size changes (window resizes, fonts loading). It converts viewport positions using where a line placed at 0,0 actually lands, so the view's border and scrolling don't matter. Don't go back to per-timeline pieces: each piece rounds to device pixels on its own, and at display scales such as 125% the line visibly changes thickness from one timeline to the next. Marker labels reuse the callout layout and `layoutConnectors`, and are draggable (`data-entry` plus `data-marker`): `drag.ts` sends their drops to `onMarkerDrop` with an offset measured against the label's home area (`markerHome`: above the topmost bar or below the bottommost, with the line's measured position), which the view applies with `setMarkerOffset`. `svg.ts` draws each line element as a rect, after all bars and before the labels, and the labels like callouts.
- **`drag.ts`** reads those attributes. It finds the drop target with `elementFromPoint`, falling back to the vertically nearest callout area, so it doesn't depend on layout constants.

## Examples and the dev server

Example pages load `../dist/timelineview.js` with a plain `<script>` tag. In `npm run dev` a small Vite plugin rewrites that tag to load `src/global.ts`, so the pages run against the source without a build. Keep example pages in that shape: one bundle script tag, one stylesheet link, then plain inline scripts.

## Example images

`npm run build` ends with `scripts/export-examples.mjs`. It serves the repository, opens `examples/basic.html` and `examples/features.html` in headless Chrome (light mode) against the built bundle, and saves `toSVG()` of each view to `docs/images/basic.svg`, `features.svg` and `absolute.svg` (the second view on the features page, kept on `window.absoluteView`). The list is `EXPORTS` in the script. The README and these docs show those images, so commit them whenever they change.

It uses Puppeteer (a dev dependency). If Puppeteer's own Chrome wasn't downloaded (npm may block its install script; `npm approve-scripts puppeteer` allows it, or run `npx puppeteer browsers install chrome`), it falls back to the installed Chrome.

## Adding a feature

1. Data format changes go in `types.ts` and `model.ts` (both directions: `fromData` and `toData`).
2. Rules go in the model, with tests in `model.test.ts`.
3. Update `CLAUDE.md`, `docs/`, and `docs/api/openapi.yaml` if the REST API changes.
4. Add or update an example and list it in `examples/index.html`.
5. Run `npm run build` and commit the regenerated images in `docs/images` if they changed.
