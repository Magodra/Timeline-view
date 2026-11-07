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
- **`drag.ts`** reads those attributes. It finds the drop target with `elementFromPoint`, falling back to the vertically nearest callout area, so it doesn't depend on layout constants.

## Examples and the dev server

Example pages load `../dist/timelineview.js` with a plain `<script>` tag. In `npm run dev` a small Vite plugin rewrites that tag to load `src/global.ts`, so the pages run against the source without a build. Keep example pages in that shape: one bundle script tag, one stylesheet link, then plain inline scripts.

## Adding a feature

1. Data format changes go in `types.ts` and `model.ts` (both directions: `fromData` and `toData`).
2. Rules go in the model, with tests in `model.test.ts`.
3. Update `CLAUDE.md`, `docs/`, and `docs/api/openapi.yaml` if the REST API changes.
4. Add or update an example and list it in `examples/index.html`.
