/**
 * Snapshot persistence.
 *
 * Every refresh writes one JSON file per trading day under `data/snapshots/`
 * plus `data/latest.json`. Keeping history as plain files means the daily job
 * can commit them to git, the web app can read them with no database, and a
 * bad run can be undone by deleting a file.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ConsensusRecord, Snapshot } from "./types";

export const DATA_DIR = path.join(process.cwd(), "data");
export const SNAPSHOT_DIR = path.join(DATA_DIR, "snapshots");
export const LATEST_PATH = path.join(DATA_DIR, "latest.json");

/** YYYY-MM-DD in Toronto, which is the trading day that matters here. */
export function torontoDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function saveSnapshot(snapshot: Snapshot): Promise<string> {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  const file = path.join(SNAPSHOT_DIR, `${snapshot.date}.json`);
  // Minified: these files are only ever read by the app, and one per trading
  // day adds up fast in git. Use `jq . data/latest.json` to read one by hand.
  const json = `${JSON.stringify(snapshot)}\n`;
  await writeFile(file, json, "utf8");
  await writeFile(LATEST_PATH, json, "utf8");
  return file;
}

export async function loadLatest(): Promise<Snapshot | null> {
  try {
    return JSON.parse(await readFile(LATEST_PATH, "utf8")) as Snapshot;
  } catch {
    // Fall back to the newest file on disk if latest.json is missing.
    const dates = await listSnapshotDates();
    const newest = dates.at(-1);
    return newest ? await loadSnapshot(newest) : null;
  }
}

export async function loadSnapshot(date: string): Promise<Snapshot | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  try {
    const file = path.join(SNAPSHOT_DIR, `${date}.json`);
    return JSON.parse(await readFile(file, "utf8")) as Snapshot;
  } catch {
    return null;
  }
}

export async function listSnapshotDates(): Promise<string[]> {
  try {
    const files = await readdir(SNAPSHOT_DIR);
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

export interface HistoryPoint {
  date: string;
  composite?: number;
  price?: number;
  targetMean?: number;
  upside?: number;
  bullishPct?: number;
  bearishPct?: number;
  analystCount?: number;
  rank?: number;
}

/**
 * Time series for one symbol across the most recent `limit` snapshots. Reads
 * whole snapshots, which is fine at this scale (a few hundred KB each) and
 * keeps the storage layer dependency-free.
 */
export async function loadHistory(
  symbol: string,
  limit = 120,
): Promise<HistoryPoint[]> {
  const dates = (await listSnapshotDates()).slice(-limit);
  const points: HistoryPoint[] = [];
  const target = symbol.toUpperCase();

  for (const date of dates) {
    const snapshot = await loadSnapshot(date);
    const record = snapshot?.records.find((r) => r.symbol === target);
    if (!record) continue;
    points.push({
      date,
      composite: record.composite,
      price: record.price,
      targetMean: record.targetMean,
      upside: record.upside,
      bullishPct: record.bullishPct,
      bearishPct: record.bearishPct,
      analystCount: record.analystCount,
      rank: record.rank,
    });
  }
  return points;
}

/** Compare the latest snapshot against the previous one for movers. */
export async function loadPrevious(): Promise<Snapshot | null> {
  const dates = await listSnapshotDates();
  if (dates.length < 2) return null;
  return await loadSnapshot(dates[dates.length - 2]);
}

export function indexBySymbol(
  records: ConsensusRecord[],
): Map<string, ConsensusRecord> {
  return new Map(records.map((r) => [r.symbol, r]));
}
