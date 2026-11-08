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
const updated = text.replace(/\/(blob|tags|tree)\/([^/]+)\//g, `/$1/v${version}/`);

if (updated !== text) {
    writeFileSync(readme, updated);
    console.log(`README.md: /blob/, /tags/ and /tree/ links now point at ${version}`);
} else {
    console.log("README.md: no /blob/, /tags/ or /tree/ links to change");
}

// Updates the "## Unreleased" section in CHANGELOG.md to the current version.
const changelog = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));
const textChangelog = readFileSync(changelog, "utf8");
const updatedChangelog = textChangelog.replace(/^## Unreleased(?=\r?$)/m, `## ${version}`);

if (updatedChangelog !== textChangelog) {
    writeFileSync(changelog, updatedChangelog);
    console.log(`CHANGELOG.md: "## Unreleased" replaced with "## ${version}"`);
} else {
    console.log('CHANGELOG.md: no "## Unreleased" section to change');
}
