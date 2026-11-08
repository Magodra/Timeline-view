import { defineConfig, type Plugin } from "vite";

/**
 * Builds the optional React wrapper, `dist/react.mjs` (`ar-timeline-view/react`),
 * after the main build. ES module only. React and the core stay imports:
 * `react` from the app, and the core from `ar-timeline-view`, so an app that
 * uses both gets one copy of the core (and one stylesheet).
 */

/** The wrapper's `import ... from "./index"` becomes `from "ar-timeline-view"`. */
function coreAsPackage(): Plugin {
  return {
    name: "timeline-core-as-package",
    enforce: "pre",
    resolveId(id, importer) {
      if (id === "./index" && importer?.replaceAll("\\", "/").endsWith("/src/react.ts")) {
        return { id: "ar-timeline-view", external: true };
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [coreAsPackage()],
  resolve: { preserveSymlinks: true }, // see vite.config.ts
  build: {
    emptyOutDir: false, // keep the main build's files
    lib: {
      entry: "src/react.ts",
      formats: ["es"],
      fileName: () => "react.mjs",
    },
    rollupOptions: {
      external: (id) => id === "react" || id.startsWith("react/"),
    },
  },
});
