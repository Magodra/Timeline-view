// Saves the example views as SVG images in docs/images, for the
// README and the docs. Runs as the last step of `npm run build`: it serves the
// repository, opens each example in headless Chrome against the built
// dist/timelineview.js, as a host page would, and calls timeline.toSVG().
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = join(root, "docs", "images");
/** Example page, the view on it to export (a global expression), and the image's name. */
const EXPORTS = [
  { page: "basic", view: "timeline", image: "basic" },
  { page: "features", view: "timeline", image: "features" },
  { page: "features", view: "absoluteView", image: "absolute" },
];

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

// A minimal static file server for the repository.
const server = createServer(async (req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!path.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(path);
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

/** Puppeteer's own Chrome if it was downloaded, otherwise the installed Chrome. */
async function launch() {
  try {
    return await puppeteer.launch();
  } catch (first) {
    try {
      return await puppeteer.launch({ channel: "chrome" });
    } catch {
      throw new Error(
        "No Chrome for the example export. Install Chrome, or run `npx puppeteer browsers install chrome`.\n" +
          first.message,
      );
    }
  }
}

const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  // Light mode, so the images don't depend on the machine that builds them.
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await mkdir(outDir, { recursive: true });
  for (const { page: name, view, image } of EXPORTS) {
    await page.goto(`${base}/examples/${name}.html`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    if (errors.length) throw new Error(`examples/${name}.html: ${errors.join("; ")}`);
    const svg = await page.evaluate((expr) => globalThis[expr].toSVG(), view);
    const file = join(outDir, `${image}.svg`);
    await writeFile(file, svg + "\n");
    console.log(`Saved ${file.slice(root.length + 1).replaceAll("\\", "/")}`);
  }
} finally {
  await browser.close();
  server.close();
}
