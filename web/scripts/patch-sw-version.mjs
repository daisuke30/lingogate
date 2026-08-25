// Postbuild step: stamp the built dist/sw.js with the same build version as
// src/content/version.generated.json (written earlier in prebuild), so the
// service worker's cache name is unique per deploy. See gen-version.mjs for
// why this matters. Only dist/sw.js is touched — public/sw.js (source,
// checked into git) keeps the __BUILD_VERSION__ placeholder untouched.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION_JSON = join(HERE, "..", "src", "content", "version.generated.json");
const DIST_SW = join(HERE, "..", "dist", "sw.js");
const PLACEHOLDER = "__BUILD_VERSION__";

function main() {
  if (!existsSync(DIST_SW)) {
    console.error(`patch-sw-version: ${DIST_SW} not found (did vite build run?)`);
    process.exit(1);
  }
  if (!existsSync(VERSION_JSON)) {
    console.error(`patch-sw-version: ${VERSION_JSON} not found (did prebuild run?)`);
    process.exit(1);
  }
  const { version } = JSON.parse(readFileSync(VERSION_JSON, "utf-8"));
  const src = readFileSync(DIST_SW, "utf-8");
  if (!src.includes(PLACEHOLDER)) {
    throw new Error(`patch-sw-version: ${PLACEHOLDER} not found in ${DIST_SW} — sw.js template changed?`);
  }
  const patched = src.split(PLACEHOLDER).join(version);
  writeFileSync(DIST_SW, patched);
  console.log(`patch-sw-version: dist/sw.js cache name -> lingogate-${version}`);
}

main();
