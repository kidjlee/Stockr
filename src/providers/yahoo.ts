/**
 * Yahoo Finance — the backbone source.
 *
 * Uses `yahoo-finance2`, which handles Yahoo's cookie + crumb handshake for
 * us. Two modules matter here:
 *   - `recommendationTrend` -> strongBuy / buy / hold / sell / strongSell counts
 *   - `financialData`       -> targetMean/High/Low, currentPrice, analyst count
 *
 * For ETFs we also pull `topHoldings`, which feeds the look-through scoring in
 * `lib/etf.ts` (ETFs themselves have no analyst ratings).
 */
import YahooFinance from "yahoo-finance2";
import { mapPool } from "../lib/http";
import { EMPTY_COUNTS } from "../lib/score";
import type { Instrument, ProviderReading, RatingCounts } from "../lib/types";
import { nowIso, type Provider, type ProviderContext } from "./types";

const client = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  // Yahoo adds and removes fields constantly; a schema surprise should not
  // abort a nightly refresh.
  validation: { logErrors: false, logOptionsErrors: false },
});

const MODULES = [
  "price",
  "financialData",
  "recommendationTrend",
  "summaryProfile",
  "quoteType",
  "topHoldings",
] as const;

/** Holdings captured during the last run, keyed by ETF symbol. */
export const yahooHoldings = new Map<
  string,
  { symbol: string; name: string; weight: number }[]
>();

export const yahooProvider: Provider = {
  id: "yahoo",
  label: "Yahoo Finance",
  weight: 1,
  homepage: "https://finance.yahoo.com",
  description:
    "Full analyst rating distribution (strong buy → sell) plus mean/high/low price targets and analyst counts. Also supplies ETF holdings for look-through scoring.",
  isEnabled: () => true,

  async fetch(instruments, ctx) {
    const settled = await mapPool(instruments, ctx.concurrency, async (inst) => {
      return await fetchOne(inst, ctx);
    });

    const readings: ProviderReading[] = [];
    let failures = 0;
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) {
        readings.push(result.value);
      } else if (result.status === "rejected") {
        failures += 1;
      }
    }
    if (failures) ctx.log(`${failures} symbol(s) failed`);
    return readings;
  },
};

async function fetchOne(
  inst: Instrument,
  ctx: ProviderContext,
): Promise<ProviderReading | null> {
  let summary: Record<string, any>;
  try {
    summary = (await client.quoteSummary(inst.symbol, {
      modules: [...MODULES] as any,
    })) as Record<string, any>;
  } catch (error) {
    // ETFs legitimately lack several modules; retry with the minimum set
    // before giving up on the symbol entirely.
    try {
      summary = (await client.quoteSummary(inst.symbol, {
        modules: ["price", "topHoldings"] as any,
      })) as Record<string, any>;
    } catch {
      throw error;
    }
  }

  const financial = summary.financialData ?? {};
  const trend = summary.recommendationTrend?.trend ?? [];
  const price = summary.price ?? {};
  const profile = summary.summaryProfile ?? {};

  // trend[0] is the current period ("0m"); later entries are -1m, -2m, -3m.
  const current = trend.find((t: any) => t?.period === "0m") ?? trend[0];
  const counts = current ? toCounts(current) : undefined;

  const holdings = summary.topHoldings?.holdings;
  if (Array.isArray(holdings) && holdings.length) {
    yahooHoldings.set(
      inst.symbol,
      holdings
        .filter((h: any) => h?.symbol && Number.isFinite(h?.holdingPercent))
        .map((h: any) => ({
          symbol: String(h.symbol),
          name: String(h.holdingName ?? h.symbol),
          weight: Number(h.holdingPercent),
        })),
    );
  }

  const spot =
    numberOrUndefined(financial.currentPrice) ??
    numberOrUndefined(price.regularMarketPrice);

  return {
    provider: "yahoo",
    symbol: inst.symbol,
    fetchedAt: nowIso(),
    counts,
    analystCount: numberOrUndefined(financial.numberOfAnalystOpinions),
    consensusLabel: prettyKey(financial.recommendationKey),
    targetMean: numberOrUndefined(financial.targetMeanPrice),
    targetMedian: numberOrUndefined(financial.targetMedianPrice),
    targetHigh: numberOrUndefined(financial.targetHighPrice),
    targetLow: numberOrUndefined(financial.targetLowPrice),
    price: spot,
    currency: price.currency ?? financial.financialCurrency,
    name: price.longName ?? price.shortName ?? inst.name,
    sector: profile.sector,
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(inst.symbol)}/analysis`,
  };
}

/**
 * Yahoo's `sell` bucket is the industry "underperform"/"moderate sell" rung and
 * `strongSell` is the true sell rung, so they map one step apart from their
 * names.
 */
export function toCounts(trend: {
  strongBuy?: number;
  buy?: number;
  hold?: number;
  sell?: number;
  strongSell?: number;
}): RatingCounts | undefined {
  const counts: RatingCounts = {
    ...EMPTY_COUNTS,
    strongBuy: trend.strongBuy ?? 0,
    buy: trend.buy ?? 0,
    hold: trend.hold ?? 0,
    underperform: trend.sell ?? 0,
    sell: trend.strongSell ?? 0,
  };
  const total =
    counts.strongBuy +
    counts.buy +
    counts.hold +
    counts.underperform +
    counts.sell;
  return total > 0 ? counts : undefined;
}

function prettyKey(key: unknown): string | undefined {
  if (typeof key !== "string" || !key || key === "none") return undefined;
  const map: Record<string, string> = {
    strong_buy: "Strong Buy",
    buy: "Buy",
    hold: "Hold",
    underperform: "Underperform",
    sell: "Sell",
  };
  return map[key] ?? key;
}

function numberOrUndefined(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}
