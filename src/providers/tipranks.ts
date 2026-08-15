/**
 * TipRanks — opt-in (`TIPRANKS_ENABLED=1`).
 *
 * TipRanks publishes a three-rung ladder (Buy / Hold / Sell) rather than five,
 * plus its own price-target consensus. It sits behind bot protection that
 * rejects datacentre IPs intermittently, so it is off by default and every
 * failure is swallowed — a blocked run simply contributes nothing to the blend
 * instead of failing the refresh.
 */
import { fetchJson, mapPool } from "../lib/http";
import { EMPTY_COUNTS } from "../lib/score";
import type { Instrument, ProviderReading, RatingCounts } from "../lib/types";
import { envFlag, nowIso, type Provider } from "./types";

const BASE = "https://www.tipranks.com/api/stocks/getData/";

export interface TipRanksResponse {
  ticker?: string;
  companyName?: string;
  numOfAnalysts?: number;
  consensuses?: {
    period?: number;
    rating?: number;
    nB?: number;
    nH?: number;
    nS?: number;
  }[];
  ptConsensus?: {
    period?: number;
    priceTarget?: number | null;
    high?: number | null;
    low?: number | null;
  }[];
  portfolioHoldingData?: {
    priceTarget?: number | null;
    analystConsensus?: { consensus?: string; distribution?: unknown };
  };
  prices?: { p?: number }[];
}

export const tipranksProvider: Provider = {
  id: "tipranks",
  label: "TipRanks",
  weight: 0.8,
  homepage: "https://www.tipranks.com",
  optIn:
    "Bot protection rejects datacentre IPs intermittently; enable only when running from a residential connection.",
  envVar: "TIPRANKS_ENABLED",
  description:
    "Three-rung analyst ladder (Buy / Hold / Sell) with TipRanks' own price-target consensus and analyst count.",
  isEnabled: () => envFlag("TIPRANKS_ENABLED"),

  async fetch(instruments, ctx) {
    let blocked = 0;
    const settled = await mapPool(
      instruments,
      Math.min(ctx.concurrency, 3),
      async (inst) => {
        try {
          const data = await fetchJson<TipRanksResponse>(
            `${BASE}?name=${encodeURIComponent(inst.symbol)}`,
            {
              retries: 1,
              headers: { referer: "https://www.tipranks.com/" },
            },
          );
          return parse(inst, data);
        } catch {
          blocked += 1;
          return null;
        }
      },
    );

    if (blocked) ctx.log(`${blocked} symbol(s) blocked or missing`);
    return settled.flatMap((r) =>
      r.status === "fulfilled" && r.value ? [r.value] : [],
    );
  },
};

export function parse(
  inst: Instrument,
  data: TipRanksResponse,
): ProviderReading | null {
  // period 0 is the current window.
  const consensus =
    data.consensuses?.find((c) => c.period === 0) ?? data.consensuses?.[0];
  const target =
    data.ptConsensus?.find((p) => p.period === 0) ?? data.ptConsensus?.[0];

  const counts = consensus ? toCounts(consensus) : undefined;
  const targetMean =
    positive(target?.priceTarget) ??
    positive(data.portfolioHoldingData?.priceTarget);

  if (!counts && !targetMean) return null;

  return {
    provider: "tipranks",
    symbol: inst.symbol,
    fetchedAt: nowIso(),
    counts,
    analystCount: counts ? sum(counts) : data.numOfAnalysts,
    consensusLabel: prettyConsensus(
      data.portfolioHoldingData?.analystConsensus?.consensus,
    ),
    targetMean,
    targetHigh: positive(target?.high),
    targetLow: positive(target?.low),
    price: positive(data.prices?.at(-1)?.p),
    name: data.companyName ?? inst.name,
    note: "TipRanks publishes Buy/Hold/Sell only — no strong-buy or underperform split.",
    sourceUrl: `https://www.tipranks.com/stocks/${inst.symbol.toLowerCase()}/forecast`,
  };
}

/**
 * TipRanks' three rungs map onto the middle of our five-rung ladder. We
 * deliberately do not promote "Buy" to "Strong Buy" — inventing conviction the
 * source did not report would bias the blend upward.
 */
export function toCounts(consensus: {
  nB?: number;
  nH?: number;
  nS?: number;
}): RatingCounts | undefined {
  const counts: RatingCounts = {
    ...EMPTY_COUNTS,
    buy: consensus.nB ?? 0,
    hold: consensus.nH ?? 0,
    sell: consensus.nS ?? 0,
  };
  return sum(counts) > 0 ? counts : undefined;
}

function prettyConsensus(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const map: Record<string, string> = {
    strongBuy: "Strong Buy",
    moderateBuy: "Moderate Buy",
    hold: "Hold",
    moderateSell: "Moderate Sell",
    strongSell: "Strong Sell",
  };
  return map[value] ?? value;
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
