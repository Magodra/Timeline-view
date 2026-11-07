import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * The examples load the built bundle with a classic <script> tag, exactly as a
 * host page would. In the dev server there is no bundle, so this plugin swaps
 * the bundle tags for the TypeScript source and turns the inline example
 * scripts into modules so they still run after the library has loaded.
 */
function devExamples(): Plugin {
  return {
    name: "timeline-dev-examples",
    apply: "serve",
    transformIndexHtml(html) {
      return html
        .replace(/<link[^>]*dist\/timelineview\.css[^>]*>/, "")
        .replace(
          /<script src="[^"]*dist\/timelineview\.js"><\/script>/,
          '<script type="module" src="/src/global.ts"></script>',
        )
        .replace(/<script>/g, '<script type="module">');
    },
  };
}

export default defineConfig({
  plugins: [devExamples()],
  server: { open: "/examples/index.html" },
  build: {
    lib: {
      entry: "src/index.ts",
      name: "timeline",
      formats: ["es", "umd"],
      fileName: (format) => (format === "es" ? "timelineview.mjs" : "timelineview.js"),
      cssFileName: "timelineview",
    },
  },
  test: {
    environment: "jsdom",
  },
});
