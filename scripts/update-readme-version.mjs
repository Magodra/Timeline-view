// Points the README's GitHub links at the version being released:
// replaces the ref in every "/blob/<ref>/" and "/raw/<ref>/" with npm_package_version.
// Run from the "version" lifecycle script, which npm calls after bumping
// package.json and before committing.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version = process.env.npm_package_version;
if (!version) {
    console.error("npm_package_version is not set; run this through npm (npm version ...).");
    process.exit(1);
}

const readme = fileURLToPath(new URL("../README.md", import.meta.url));
const text = readFileSync(readme, "utf8");
const updated = text.replace(/\/(blob|raw)\/([^/]+)\//g, `/$1/v${version}/`);

if (updated !== text) {
    writeFileSync(readme, updated);
    console.log(`README.md: /blob/ and /raw/ links now point at ${version}`);
} else {
    console.log("README.md: no /blob/ or /raw/ links to change");
}
