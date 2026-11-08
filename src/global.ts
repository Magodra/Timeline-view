/**
 * Dev-server entry: exposes the library as `window.timeline`, as the UMD
 * bundle does, so the examples run unchanged against the source.
 */
import * as timeline from "./lib";

declare global {
  interface Window {
    timeline: typeof timeline;
  }
}

window.timeline = timeline;
