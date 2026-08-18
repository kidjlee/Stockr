/**
 * Benzinga — free-tier API key required (https://www.benzinga.com/apis).
 *
 * Unlike the other providers, Benzinga's Ratings endpoint does not hand you a
 * pre-aggregated consensus — it returns a feed of individual rating *events*
 * (one row per analyst action: initiate, upgrade, downgrade, maintain), each
 * with the firm's own free-text rating word ("Outperform", "Sector Perform",
 * "Buy", "Neutral", ...). Endpoint and field names verified via search against
 * Benzinga's own docs and blog examples:
 *
 *   GET https://api.benzinga.com/api/v2/calendar/ratings
 *     ?token=<key>&parameters[tickers]=<ticker>&pagesize=<n>
 *   -> [{ date, ticker, analyst, analyst_id, analyst_name, action_company,
 *         rating_current, rating_prior, pt_current, pt_prior,
 *         adjusted_pt_current, ... }]
 *
 * We turn that event feed into a consensus ourselves: keep only each
 * analyst's most recent action within a lookback window (an analyst's older
 * calls don't represent their current view), map their free-text rating onto
 * our five rungs with the vocabulary map below, and average their current
 * price targets. This mirrors what a "consensus" aggregator does internally —
 * it's just done client-side here because Benzinga's API is event-level, not
 * consensus-level.
 *
 * Coverage skews to US-listed and cross-listed names; a TSX-only small cap
 * may simply have no rows. Ticker format for pure TSX listings is unverified
 * (Benzinga's own coverage is primarily US-ticker-convention) — `npm run
 * probe -- benzinga RY.TO` will show what actually comes back.
 */
import { fetchJson, mapPool } from "../lib/http";
import { EMPTY_COUNTS } from "../lib/score";
import type {
  Instrument,
  ProviderReading,
  RatingBucket,
  RatingCounts,
} from "../lib/types";
import { envKey, nowIso, type Provider } from "./types";

const BASE = "https://api.benzinga.com/api/v2/calendar/ratings";
const LOOKBACK_DAYS = 365;

interface BenzingaRating {
  date?: string;
  ticker?: string;
  analyst_id?: string;
  analyst_name?: string;
  analyst?: string;
  action_company?: string;
  rating_current?: string;
  pt_current?: string | number;
  adjusted_pt_current?: string | number;
}

/**
 * Wall Street's rating vocabulary isn't standardized across firms — this maps
 * the common free-text words onto our five rungs. Anything not recognized is
 * dropped rather than guessed, so an unusual firm-specific term just doesn't
 * count rather than being miscategorized.
 */
const RATING_WORDS: Record<string, RatingBucket> = {
  "strong buy": "strongBuy",
  buy: "buy",
  outperform: "buy",
  overweight: "buy",
  "sector outperform": "buy",
  positive: "buy",
  accumulate: "buy",
  add: "buy",
  hold: "hold",
  neutral: "hold",
  "market perform": "hold",
  "sector perform": "hold",
  "in-line": "hold",
  "peer perform": "hold",
  "equal-weight": "hold",
  equalweight: "hold",
  underperform: "underperform",
  "sector underperform": "underperform",
  underweight: "underperform",
  reduce: "underperform",
  negative: "underperform",
  sell: "sell",
  "strong sell": "sell",
};

export const benzingaProvider: Provider = {
  id: "benzinga",
  label: "Benzinga",
  weight: 0.7,
  homepage: "https://www.benzinga.com",
  envVar: "BENZINGA_API_KEY",
  description:
    "Consensus derived from Benzinga's individual analyst rating-action feed: each covering analyst's most recent call, within the last year, mapped onto our five rungs and averaged for a price target. Free API key required; coverage is strongest for US and cross-listed names.",
  isEnabled: () => Boolean(envKey("BENZINGA_API_KEY")),

  async fetch(instruments, ctx) {
    const token = envKey("BENZINGA_API_KEY");
    if (!token) return [];

    let unmapped = 0;
    const settled = await mapPool(
      instruments,
      Math.min(ctx.concurrency, 3),
      async (inst) => {
        const rows = await fetchJson<BenzingaRating[] | { ratings: BenzingaRating[] }>(
          `${BASE}?token=${token}&parameters[tickers]=${encodeURIComponent(inst.root)}&pagesize=100`,
        ).catch(() => [] as BenzingaRating[]);

        const list = Array.isArray(rows) ? rows : (rows.ratings ?? []);
        const { reading, dropped } = toReading(inst, list);
        unmapped += dropped;
        return reading;
      },
    );

    if (unmapped) ctx.log(`${unmapped} rating(s) used an unrecognized word and were dropped`);
    return settled.flatMap((r) =>
      r.status === "fulfilled" && r.value ? [r.value] : [],
    );
  },
};

export function toReading(
  inst: Instrument,
  rows: BenzingaRating[],
  now = new Date(),
): { reading: ProviderReading | null; dropped: number } {
  const cutoff = now.getTime() - LOOKBACK_DAYS * 86_400_000;
  const latestByAnalyst = latestPerAnalyst(rows, cutoff);

  const counts: RatingCounts = { ...EMPTY_COUNTS };
  const targets: number[] = [];
  let dropped = 0;

  for (const row of latestByAnalyst) {
    const bucket = normalizeRating(row.rating_current);
    if (bucket) {
      counts[bucket] += 1;
    } else if (row.rating_current) {
      dropped += 1;
    }
    const target = positive(row.adjusted_pt_current ?? row.pt_current);
    if (target) targets.push(target);
  }

  const total = sum(counts);
  if (total === 0 && targets.length === 0) return { reading: null, dropped };

  return {
    reading: {
      provider: "benzinga",
      symbol: inst.symbol,
      fetchedAt: nowIso(),
      counts: total > 0 ? counts : undefined,
      analystCount: total || undefined,
      targetAnalystCount: targets.length || undefined,
      targetMean: targets.length ? average(targets) : undefined,
      targetHigh: targets.length ? Math.max(...targets) : undefined,
      targetLow: targets.length ? Math.min(...targets) : undefined,
      name: inst.name,
      note: `Consensus built from ${latestByAnalyst.length} analyst(s)' most recent call in the last ${LOOKBACK_DAYS} days, not a Benzinga-published aggregate.`,
      sourceUrl: `https://www.benzinga.com/quote/${inst.root}/analyst-ratings`,
    },
    dropped,
  };
}

/** One row per analyst: whichever of their actions is most recent, if any fall in the window. */
export function latestPerAnalyst(
  rows: BenzingaRating[],
  cutoffMs: number,
): BenzingaRating[] {
  const byAnalyst = new Map<string, BenzingaRating>();
  for (const row of rows) {
    const key = row.analyst_id || row.analyst_name || row.analyst;
    if (!key || !row.date) continue;
    const ts = Date.parse(row.date);
    if (!Number.isFinite(ts) || ts < cutoffMs) continue;
    const existing = byAnalyst.get(key);
    if (!existing || Date.parse(existing.date ?? "") < ts) {
      byAnalyst.set(key, row);
    }
  }
  return [...byAnalyst.values()];
}

export function normalizeRating(word: string | undefined): RatingBucket | undefined {
  if (!word) return undefined;
  return RATING_WORDS[word.trim().toLowerCase()];
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

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function positive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
