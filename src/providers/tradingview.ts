/**
 * TradingView — the Canada scanner endpoint.
 *
 * One POST returns the whole universe, so this is by far the cheapest source.
 * It exposes the analyst rating ladder as five separate count columns plus an
 * average price target and the number of estimates behind it.
 *
 * Important: TradingView also publishes `Recommend.All`, which is their
 * *technical* gauge (moving averages and oscillators), not analyst opinion.
 * We deliberately do not score on it — only the analyst count columns and the
 * price target are used.
 *
 * Column names are configurable in `config/providers.json` because TradingView
 * renames screener fields from time to time; if the request is rejected we
 * retry with a minimal set so a rename degrades rather than breaks.
 */
import { fetchJson, HttpError } from "../lib/http";
import { EMPTY_COUNTS } from "../lib/score";
import type { Instrument, ProviderReading, RatingCounts } from "../lib/types";
import { nowIso, type Provider, type ProviderContext } from "./types";

const ENDPOINT = "https://scanner.tradingview.com/canada/scan";

/** Ordered — the response returns values positionally under `d`. */
export const TV_COLUMNS = [
  "name",
  "description",
  "close",
  "currency",
  "sector",
  "market_cap_basic",
  "type",
  "recommendation_buy",
  "recommendation_over",
  "recommendation_hold",
  "recommendation_under",
  "recommendation_sell",
  "recommendation_total",
  "price_target_average",
  "price_target_high",
  "price_target_low",
  "price_target_estimates_num",
];

/** Fallback if the full column set is rejected. */
const TV_CORE_COLUMNS = [
  "name",
  "description",
  "close",
  "currency",
  "type",
];

export interface TvScanResponse {
  totalCount?: number;
  data?: { s: string; d: unknown[] }[];
}

export const tradingViewProvider: Provider = {
  id: "tradingview",
  label: "TradingView",
  weight: 0.9,
  homepage: "https://www.tradingview.com",
  description:
    "Analyst rating ladder (buy / outperform / hold / underperform / sell counts), average price target and estimate count, pulled from the public Canada screener endpoint in a single request.",
  isEnabled: () => true,

  async fetch(instruments, ctx) {
    const tickers = instruments.map((i) => i.tvSymbol);
    const bySymbol = new Map(instruments.map((i) => [i.tvSymbol, i]));

    let columns = TV_COLUMNS;
    let response: TvScanResponse;
    try {
      response = await scan(tickers, columns);
    } catch (error) {
      if (error instanceof HttpError && error.status === 400) {
        ctx.log(
          "full column set rejected; retrying with core columns (price only, no analyst data)",
        );
        columns = TV_CORE_COLUMNS;
        response = await scan(tickers, columns);
      } else {
        throw error;
      }
    }

    const rows = response.data ?? [];
    ctx.log(`${rows.length} row(s) returned`);

    const readings: ProviderReading[] = [];
    for (const row of rows) {
      const inst = bySymbol.get(row.s);
      if (!inst) continue;
      readings.push(toReading(inst, row, columns));
    }
    return readings;
  },
};

export async function scan(
  tickers: string[],
  columns: string[],
): Promise<TvScanResponse> {
  return await fetchJson<TvScanResponse>(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://www.tradingview.com",
      referer: "https://www.tradingview.com/",
    },
    body: JSON.stringify({
      symbols: { tickers, query: { types: [] } },
      columns,
      options: { lang: "en" },
      range: [0, Math.max(tickers.length, 1)],
    }),
    timeoutMs: 45_000,
  });
}

/**
 * Query the screener for the largest Canadian listings — used to rebuild the
 * universe file without hand-maintaining a ticker list.
 */
export async function scanTopByMarketCap(
  limit: number,
  type: "stock" | "fund",
): Promise<TvScanResponse> {
  return await fetchJson<TvScanResponse>(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://www.tradingview.com",
      referer: "https://www.tradingview.com/",
    },
    body: JSON.stringify({
      filter: [{ left: "type", operation: "equal", right: type }],
      symbols: { query: { types: [] } },
      columns: ["name", "description", "sector", "market_cap_basic", "type", "exchange"],
      sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
      options: { lang: "en" },
      range: [0, limit],
    }),
    timeoutMs: 45_000,
  });
}

export function toReading(
  inst: Instrument,
  row: { s: string; d: unknown[] },
  columns: string[],
): ProviderReading {
  const get = (column: string): unknown => {
    const index = columns.indexOf(column);
    return index === -1 ? undefined : row.d[index];
  };

  const counts = toCounts({
    strongBuy: num(get("recommendation_buy")),
    buy: num(get("recommendation_over")),
    hold: num(get("recommendation_hold")),
    underperform: num(get("recommendation_under")),
    sell: num(get("recommendation_sell")),
  });

  const totalRated = num(get("recommendation_total"));
  const estimates = num(get("price_target_estimates_num"));

  return {
    provider: "tradingview",
    symbol: inst.symbol,
    fetchedAt: nowIso(),
    counts,
    analystCount: totalRated ?? (counts ? sum(counts) : undefined),
    targetAnalystCount: estimates,
    targetMean: num(get("price_target_average")),
    targetHigh: num(get("price_target_high")),
    targetLow: num(get("price_target_low")),
    price: num(get("close")),
    currency: str(get("currency")),
    name: str(get("description")) ?? inst.name,
    sector: str(get("sector")) ?? inst.sector,
    sourceUrl: `https://www.tradingview.com/symbols/${inst.tvSymbol.replace(":", "-")}/forecast/`,
  };
}

function toCounts(parts: {
  strongBuy?: number;
  buy?: number;
  hold?: number;
  underperform?: number;
  sell?: number;
}): RatingCounts | undefined {
  const counts: RatingCounts = {
    ...EMPTY_COUNTS,
    strongBuy: parts.strongBuy ?? 0,
    buy: parts.buy ?? 0,
    hold: parts.hold ?? 0,
    underperform: parts.underperform ?? 0,
    sell: parts.sell ?? 0,
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

function num(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
