#!/usr/bin/env tsx
/**
 * Static export replacement for the old /api/rankings route.
 *
 * There's no server left to answer a request at build time, so instead the
 * latest snapshot is copied into `public/` verbatim before `next build` runs,
 * which makes it come out the other end at `<site>/rankings.json` — a plain
 * static file, refreshed whenever the site is rebuilt.
 */
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { LATEST_PATH } from "../lib/storage";

async function main() {
  const dest = path.join(process.cwd(), "public", "rankings.json");
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    await copyFile(LATEST_PATH, dest);
    console.log(`Copied ${LATEST_PATH} -> ${dest}`);
  } catch {
    // No snapshot yet (first-ever build) — the dashboard already handles
    // this as an empty state, so skip rather than fail the build.
    console.log("No data/latest.json yet — skipping rankings.json");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
