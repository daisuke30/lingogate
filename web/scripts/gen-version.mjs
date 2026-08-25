// Build-version stamp (LINGO-010 follow-up, 2026-08-26). Two problems this
// fixes at once:
//   1. Katsuta had no way to tell which deployed build his phone was actually
//      running, which made a stale-cache bug hard to diagnose. -> the version
//      is now shown at the bottom of Settings.
//   2. The service worker's cache name was static ("lingogate-v1" forever),
//      so a browser could keep serving assets from a same-named cache across
//      deploys indefinitely. -> every build gets a distinct cache name, which
//      makes sw.js itself byte-different on every deploy, which is what
//      actually triggers the browser's "new service worker available" update
//      check (see scripts/patch-sw-version.mjs).
//
// Writes src/content/version.generated.json (gitignored, like
// deck.generated.json) — imported directly by the app bundle so the display
// needs no runtime fetch, and always matches the JS that's actually running.

import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "..", "src", "content", "version.generated.json");

function gitShortSha() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null; // no git available (e.g. a bare export) — timestamp alone still disambiguates.
  }
}

export function buildVersion() {
  const builtAt = new Date().toISOString();
  const sha = gitShortSha();
  const stamp = builtAt.replace(/[-:]/g, "").slice(0, 13); // YYYYMMDDTHHMM
  const version = sha ? `${sha}-${stamp}` : stamp;
  return { version, sha, builtAt };
}

function main() {
  const payload = buildVersion();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload));
  console.log(`version.generated.json: ${payload.version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
