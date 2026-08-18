/**
 * Zacks Investment Research — via Intrinio (free API key required:
 * https://intrinio.com, "Zacks Analyst Ratings" data feed).
 *
 * Zacks has no direct public API of its own; Intrinio is Zacks' own
 * data-licensing partner and re-publishes the feed with a clean, documented
 * JSON schema. Verified against Intrinio's official `intrinio-sdk` npm
 * package (v7.2.0) rather than guessed:
 *   - GET /securities/{identifier}/zacks/analyst_ratings/snapshot
 *       -> { snapshots: [{ type, snapshot_date, rating_date, mean, percentile,
 *            strong_buys, buys, holds, sells, strong_sells, total }], security }
 *   - GET /zacks/target_price_consensuses?identifier=<ticker>
 *       -> { target_price_consensuses: [{ ticker, high, low, mean, median,
 *            standard_deviation, total, most_recent_date, ... }] }
 * Base URL https://api-v2.intrinio.com, auth via `api_key` query param.
 * Intrinio explicitly documents this feed as covering "over 5,000 US and
 * Canadian listed companies."
 *
 * The one thing that is NOT documented anywhere inspectable is which ticker
 * format Intrinio expects for a TSX-only listing (plain root, "RY:CA", or
 * "RY.TO") — US names are unambiguous but Canada isn't. `identifierCandidates`
 * tries the plausible variants and keeps the first one that returns data; run
 * `npm run probe -- zacks RY.TO` after getting a key to confirm which variant
 * actually works and simplify this if it's always the same one.
 */
import { fetchJson, HttpError, mapPool } from "../lib/http";
import { EMPTY_COUNTS } from "../lib/score";
import type { Instrument, ProviderReading, RatingCounts } from "../lib/types";
import { envKey, nowIso, type Provider } from "./types";

const BASE = "https://api-v2.intrinio.com";

interface ZacksSnapshot {
  type?: string;
  rating_date?: string;
  mean?: number;
  strong_buys?: number;
  buys?: number;
  holds?: number;
  sells?: number;
  strong_sells?: number;
  total?: number;
}

interface SnapshotResponse {
  snapshots?: ZacksSnapshot[];
}

interface TargetConsensus {
  ticker?: string;
  high?: number;
  low?: number;
  mean?: number;
  median?: number;
  total?: number;
  most_recent_date?: string;
}

interface TargetConsensusResponse {
  target_price_consensuses?: TargetConsensus[];
}

export const zacksProvider: Provider = {
  id: "zacks",
  label: "Zacks (via Intrinio)",
  weight: 0.85,
  homepage: "https://www.zacks.com",
  envVar: "INTRINIO_API_KEY",
  description:
    "Independent five-rung analyst rating distribution and price-target consensus, licensed from Zacks and re-published by Intrinio with a documented schema. Free API key required; free-tier request quotas are small, so this is best run with a low concurrency or on a subset of the universe.",
  isEnabled: () => Boolean(envKey("INTRINIO_API_KEY")),

  async fetch(instruments, ctx) {
    const key = envKey("INTRINIO_API_KEY");
    if (!key) return [];

    let blocked = false;
    const settled = await mapPool(
      instruments,
      Math.min(ctx.concurrency, 2),
      async (inst) => {
        if (blocked) return null;
        for (const identifier of identifierCandidates(inst)) {
          try {
            const reading = await fetchOne(inst, identifier, key);
            if (reading) return reading;
          } catch (error) {
            if (isQuotaError(error)) {
              blocked = true;
              return null;
            }
            // Wrong identifier format for this symbol — try the next candidate.
          }
        }
        return null;
      },
    );

    if (blocked) ctx.log("request quota exhausted — stopping early");
    return settled.flatMap((r) =>
      r.status === "fulfilled" && r.value ? [r.value] : [],
    );
  },
};

async function fetchOne(
  inst: Instrument,
  identifier: string,
  key: string,
): Promise<ProviderReading | null> {
  const snapshotRes = await fetchJson<SnapshotResponse>(
    `${BASE}/securities/${encodeURIComponent(identifier)}/zacks/analyst_ratings/snapshot?api_key=${key}`,
  );
  const snapshot = pickLatest(snapshotRes.snapshots);
  const counts = snapshot ? toCounts(snapshot) : undefined;

  let target: TargetConsensus | undefined;
  try {
    const targetRes = await fetchJson<TargetConsensusResponse>(
      `${BASE}/zacks/target_price_consensuses?identifier=${encodeURIComponent(identifier)}&api_key=${key}`,
    );
    target = targetRes.target_price_consensuses?.[0];
  } catch {
    // Target consensus is a separate call; a miss here shouldn't cost the rating.
  }

  if (!counts && !target?.mean) return null;

  return {
    provider: "zacks",
    symbol: inst.symbol,
    fetchedAt: nowIso(),
    counts,
    analystCount: counts ? sum(counts) : target?.total,
    targetAnalystCount: target?.total,
    targetMean: positive(target?.mean),
    targetMedian: positive(target?.median),
    targetHigh: positive(target?.high),
    targetLow: positive(target?.low),
    name: inst.name,
    sourceUrl: `https://www.zacks.com/stock/quote/${inst.root}`,
  };
}

/** Prefer the most recent rating date over any assumption about `type` values. */
export function pickLatest(
  snapshots: ZacksSnapshot[] | undefined,
): ZacksSnapshot | undefined {
  if (!Array.isArray(snapshots) || !snapshots.length) return undefined;
  return [...snapshots].sort((a, b) =>
    String(b.rating_date ?? "").localeCompare(String(a.rating_date ?? "")),
  )[0];
}

export function toCounts(snapshot: ZacksSnapshot): RatingCounts | undefined {
  const counts: RatingCounts = {
    ...EMPTY_COUNTS,
    strongBuy: snapshot.strong_buys ?? 0,
    buy: snapshot.buys ?? 0,
    hold: snapshot.holds ?? 0,
    underperform: snapshot.sells ?? 0,
    sell: snapshot.strong_sells ?? 0,
  };
  return sum(counts) > 0 ? counts : undefined;
}

/** Plain root first (most likely to work for a plain-ticker API), then the
 * two plausible Canadian-listing conventions. */
export function identifierCandidates(inst: Instrument): string[] {
  return [inst.root, `${inst.root}:CA`, inst.symbol];
}

function isQuotaError(error: unknown): boolean {
  return error instanceof HttpError && [403, 429].includes(error.status);
}

function sum(counts: RatingCounts): number {
  return (
    counts.strongBuy +
    counts.buy +
    counts.hold +
    counts.underperform +
    counts.sell
  );
}

function positive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
