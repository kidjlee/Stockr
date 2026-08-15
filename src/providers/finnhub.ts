/**
 * Finnhub — free-tier API key required (https://finnhub.io/register).
 *
 * `/stock/recommendation` returns the same five-rung ladder as Yahoo, sourced
 * from a different aggregator, which makes it a genuinely independent second
 * opinion rather than a mirror. `/stock/price-target` is paid on some plans,
 * so a failure there is downgraded to a warning rather than an error.
 */
import { fetchJson, HttpError, mapPool } from "../lib/http";
import { EMPTY_COUNTS } from "../lib/score";
import type { Instrument, ProviderReading, RatingCounts } from "../lib/types";
import { envKey, nowIso, type Provider, type ProviderContext } from "./types";

const BASE = "https://finnhub.io/api/v1";

interface FinnhubRecommendation {
  symbol: string;
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

interface FinnhubPriceTarget {
  targetHigh?: number;
  targetLow?: number;
  targetMean?: number;
  targetMedian?: number;
  lastUpdated?: string;
  numberOfAnalysts?: number;
}

interface FinnhubQuote {
  c?: number;
}

export const finnhubProvider: Provider = {
  id: "finnhub",
  label: "Finnhub",
  weight: 0.85,
  homepage: "https://finnhub.io",
  envVar: "FINNHUB_API_KEY",
  description:
    "Independent analyst rating distribution and price-target consensus. Free API key required; price targets need a paid plan on some tiers and are skipped silently if unavailable.",
  isEnabled: () => Boolean(envKey("FINNHUB_API_KEY")),

  async fetch(instruments, ctx) {
    const token = envKey("FINNHUB_API_KEY");
    if (!token) return [];

    let targetsBlocked = false;
    // Free tier is 60 calls/minute; stay well under it.
    const settled = await mapPool(
      instruments,
      Math.min(ctx.concurrency, 4),
      async (inst) => {
        const recs = await fetchJson<FinnhubRecommendation[]>(
          `${BASE}/stock/recommendation?symbol=${encodeURIComponent(inst.symbol)}&token=${token}`,
        ).catch(() => [] as FinnhubRecommendation[]);

        const latest = pickLatest(recs);
        const counts = latest ? toCounts(latest) : undefined;

        let target: FinnhubPriceTarget = {};
        if (!targetsBlocked) {
          try {
            target = await fetchJson<FinnhubPriceTarget>(
              `${BASE}/stock/price-target?symbol=${encodeURIComponent(inst.symbol)}&token=${token}`,
            );
          } catch (error) {
            if (error instanceof HttpError && [401, 403].includes(error.status)) {
              targetsBlocked = true;
              ctx.log("price targets not available on this plan — skipping");
            }
          }
        }

        const quote = await fetchJson<FinnhubQuote>(
          `${BASE}/quote?symbol=${encodeURIComponent(inst.symbol)}&token=${token}`,
        ).catch(() => ({}) as FinnhubQuote);

        if (!counts && !target.targetMean) return null;

        return {
          provider: "finnhub",
          symbol: inst.symbol,
          fetchedAt: nowIso(),
          counts,
          analystCount: counts ? sum(counts) : target.numberOfAnalysts,
          targetAnalystCount: target.numberOfAnalysts,
          targetMean: positive(target.targetMean),
          targetMedian: positive(target.targetMedian),
          targetHigh: positive(target.targetHigh),
          targetLow: positive(target.targetLow),
          price: positive(quote.c),
          name: inst.name,
          sourceUrl: `https://finnhub.io/quote/${encodeURIComponent(inst.symbol)}`,
        } satisfies ProviderReading;
      },
    );

    return settled.flatMap((r) =>
      r.status === "fulfilled" && r.value ? [r.value] : [],
    );
  },
};

/** Finnhub returns one row per month, newest first — but do not rely on order. */
export function pickLatest(
  rows: FinnhubRecommendation[] | undefined,
): FinnhubRecommendation | undefined {
  if (!Array.isArray(rows) || !rows.length) return undefined;
  return [...rows].sort((a, b) =>
    String(b.period ?? "").localeCompare(String(a.period ?? "")),
  )[0];
}

/** Finnhub follows Yahoo's convention: `sell` is underperform, `strongSell` is sell. */
export function toCounts(row: FinnhubRecommendation): RatingCounts | undefined {
  const counts: RatingCounts = {
    ...EMPTY_COUNTS,
    strongBuy: row.strongBuy ?? 0,
    buy: row.buy ?? 0,
    hold: row.hold ?? 0,
    underperform: row.sell ?? 0,
    sell: row.strongSell ?? 0,
  };
  return sum(counts) > 0 ? counts : undefined;
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
