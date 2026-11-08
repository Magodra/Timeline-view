/**
 * Build entry for the bundles (UMD global `timeline`, and ESM): the library
 * plus its stylesheet, which Vite extracts to dist/timelineview.css. The
 * stylesheet is imported here, not in index.ts, so the published type
 * declarations (built from index.ts) have no CSS import that apps would have
 * to resolve.
 */
import "./styles.css";

export * from "./index";
