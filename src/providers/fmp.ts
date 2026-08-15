/**
 * Financial Modeling Prep — free-tier API key required
 * (https://site.financialmodelingprep.com/developer/docs).
 *
 * FMP aggregates the sell-side grades that sites like MarketWatch and CNN
 * display, so it is a reasonable stand-in for those without scraping them.
 * Endpoints differ across FMP plans, so each call degrades independently.
 */
import { fetchJson, mapPool } from "../lib/http";
import { EMPTY_COUNTS } from "../lib/score";
import type { Instrument, ProviderReading, RatingCounts } from "../lib/types";
import { envKey, nowIso, type Provider } from "./types";

const BASE = "https://financialmodelingprep.com/api";

interface FmpRecommendation {
  symbol: string;
  date?: string;
  analystRatingsStrongBuy?: number;
  analystRatingsbuy?: number;
  analystRatingsHold?: number;
  analystRatingsSell?: number;
  analystRatingsStrongSell?: number;
}

interface FmpTargetConsensus {
  symbol: string;
  targetHigh?: number;
  targetLow?: number;
  targetConsensus?: number;
  targetMedian?: number;
}

interface FmpQuote {
  symbol: string;
  price?: number;
  name?: string;
}

export const fmpProvider: Provider = {
  id: "fmp",
  label: "Financial Modeling Prep",
  weight: 0.75,
  homepage: "https://site.financialmodelingprep.com",
  envVar: "FMP_API_KEY",
  description:
    "Sell-side rating distribution and price-target consensus aggregated from the same grades syndicated to mainstream finance portals. Free API key required.",
  isEnabled: () => Boolean(envKey("FMP_API_KEY")),

  async fetch(instruments, ctx) {
    const key = envKey("FMP_API_KEY");
    if (!key) return [];

    const settled = await mapPool(
      instruments,
      Math.min(ctx.concurrency, 4),
      async (inst) => {
        const symbol = encodeURIComponent(inst.symbol);

        const [recs, consensus, quote] = await Promise.all([
          fetchJson<FmpRecommendation[]>(
            `${BASE}/v3/analyst-stock-recommendations/${symbol}?apikey=${key}`,
          ).catch(() => [] as FmpRecommendation[]),
          fetchJson<FmpTargetConsensus[]>(
            `${BASE}/v4/price-target-consensus?symbol=${symbol}&apikey=${key}`,
          ).catch(() => [] as FmpTargetConsensus[]),
          fetchJson<FmpQuote[]>(`${BASE}/v3/quote/${symbol}?apikey=${key}`).catch(
            () => [] as FmpQuote[],
          ),
        ]);

        const latest = pickLatest(recs);
        const counts = latest ? toCounts(latest) : undefined;
        const target = Array.isArray(consensus) ? consensus[0] : undefined;
        const q = Array.isArray(quote) ? quote[0] : undefined;

        if (!counts && !target?.targetConsensus) return null;

        return {
          provider: "fmp",
          symbol: inst.symbol,
          fetchedAt: nowIso(),
          counts,
          analystCount: counts ? sum(counts) : undefined,
          targetMean: positive(target?.targetConsensus),
          targetMedian: positive(target?.targetMedian),
          targetHigh: positive(target?.targetHigh),
          targetLow: positive(target?.targetLow),
          price: positive(q?.price),
          name: q?.name ?? inst.name,
          sourceUrl: `https://site.financialmodelingprep.com/financial-summary/${inst.symbol}`,
        } satisfies ProviderReading;
      },
    );

    const readings = settled.flatMap((r) =>
      r.status === "fulfilled" && r.value ? [r.value] : [],
    );
    if (!readings.length) {
      ctx.log("no rows returned — check that your plan covers TSX listings");
    }
    return readings;
  },
};

export function pickLatest(
  rows: FmpRecommendation[] | undefined,
): FmpRecommendation | undefined {
  if (!Array.isArray(rows) || !rows.length) return undefined;
  return [...rows].sort((a, b) =>
    String(b.date ?? "").localeCompare(String(a.date ?? "")),
  )[0];
}

/** FMP's `Sell` rung is underperform and `StrongSell` is the true sell rung. */
export function toCounts(row: FmpRecommendation): RatingCounts | undefined {
  const counts: RatingCounts = {
    ...EMPTY_COUNTS,
    strongBuy: row.analystRatingsStrongBuy ?? 0,
    buy: row.analystRatingsbuy ?? 0,
    hold: row.analystRatingsHold ?? 0,
    underperform: row.analystRatingsSell ?? 0,
    sell: row.analystRatingsStrongSell ?? 0,
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
