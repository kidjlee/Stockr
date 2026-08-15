/**
 * The scoring engine.
 *
 * Everything here is pure: given rating counts / prices / targets it produces
 * numbers. No I/O, so it is cheap to unit test.
 */
import {
  type Confidence,
  DEFAULT_WEIGHTS,
  type RatingBucket,
  RATING_BUCKETS,
  RATING_WEIGHTS,
  type RatingCounts,
  type ScoringWeights,
} from "./types";

export const EMPTY_COUNTS: RatingCounts = {
  strongBuy: 0,
  buy: 0,
  hold: 0,
  underperform: 0,
  sell: 0,
};

export function totalCounts(counts: RatingCounts): number {
  return RATING_BUCKETS.reduce((sum, b) => sum + (counts[b] || 0), 0);
}

export function addCounts(a: RatingCounts, b: RatingCounts): RatingCounts {
  const out = { ...EMPTY_COUNTS };
  for (const bucket of RATING_BUCKETS) {
    out[bucket] = (a[bucket] || 0) + (b[bucket] || 0);
  }
  return out;
}

/** Convert raw counts to fractions that sum to 1. Returns null if empty. */
export function toDistribution(
  counts: RatingCounts,
): Record<RatingBucket, number> | null {
  const total = totalCounts(counts);
  if (total <= 0) return null;
  const out = { ...EMPTY_COUNTS };
  for (const bucket of RATING_BUCKETS) {
    out[bucket] = (counts[bucket] || 0) / total;
  }
  return out;
}

/**
 * Collapse a rating distribution into a 0..100 bullishness score.
 *
 * Each bucket carries a -2..+2 weight; the weighted mean is rescaled so that
 * an all-sell book is 0, an all-hold book is 50, and an all-strong-buy book
 * is 100.
 */
export function consensusScoreFromCounts(
  counts: RatingCounts,
): number | undefined {
  const total = totalCounts(counts);
  if (total <= 0) return undefined;
  let weighted = 0;
  for (const bucket of RATING_BUCKETS) {
    weighted += (counts[bucket] || 0) * RATING_WEIGHTS[bucket];
  }
  const mean = weighted / total; // -2..+2
  return clamp(((mean + 2) / 4) * 100, 0, 100);
}

/**
 * Map a "1 = strong buy .. 5 = strong sell" style mean (Yahoo's
 * `recommendationMean`, and the same convention used by several other feeds)
 * onto the same 0..100 scale.
 */
export function consensusScoreFromMean1to5(mean: number): number | undefined {
  if (!Number.isFinite(mean) || mean <= 0) return undefined;
  const bounded = clamp(mean, 1, 5);
  return clamp(((5 - bounded) / 4) * 100, 0, 100);
}

/**
 * Map a -1..+1 style consensus (TradingView's `Recommend.All` convention,
 * where +1 is strong buy) onto 0..100.
 */
export function consensusScoreFromSigned(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return clamp(((clamp(value, -1, 1) + 1) / 2) * 100, 0, 100);
}

/**
 * Squash upside into 0..100 with a tanh so that outlier targets (a 400%
 * "upside" on a broken micro cap) cannot dominate the ranking.
 *
 * At the default scale of 0.35: -35% upside -> ~12, 0% -> 50, +35% -> ~88.
 */
export function upsideScore(
  upside: number | undefined,
  scale = DEFAULT_WEIGHTS.upsideScale,
): number | undefined {
  if (upside === undefined || !Number.isFinite(upside)) return undefined;
  return clamp(50 + 50 * Math.tanh(upside / scale), 0, 100);
}

export function computeUpside(
  price: number | undefined,
  target: number | undefined,
): number | undefined {
  if (!isPositive(price) || !isPositive(target)) return undefined;
  return (target - price) / price;
}

/** Diminishing-returns curve: 0 analysts -> 0, benchmark analysts -> ~1. */
export function coverageScore(count: number | undefined, benchmark: number) {
  if (!count || count <= 0) return 0;
  return clamp(Math.log1p(count) / Math.log1p(benchmark), 0, 1);
}

/** Population standard deviation; 0 for fewer than two samples. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * How much to trust this record.
 *
 * `agreement` treats a 25-point spread between sources as total disagreement,
 * which is roughly the gap between a "Buy" and a "Hold" book.
 */
export function computeConfidence(
  analystCount: number | undefined,
  providerScores: number[],
  weights: ScoringWeights,
): Confidence {
  const coverage = coverageScore(analystCount, weights.coverageBenchmark);
  const breadth = clamp(
    providerScores.length / weights.breadthBenchmark,
    0,
    1,
  );
  const agreement =
    providerScores.length < 2 ? 0.5 : clamp(1 - stdev(providerScores) / 25, 0, 1);
  const overall = clamp(
    0.5 * coverage + 0.3 * breadth + 0.2 * agreement,
    0,
    1,
  );
  return { coverage, breadth, agreement, overall };
}

export interface CompositeInput {
  consensusScore?: number;
  upsideScore?: number;
  confidence: Confidence;
}

/**
 * Blend the sub-scores into the ranking number.
 *
 * Missing sub-scores are dropped and the remaining weights renormalized, so a
 * name with ratings but no price target is still rankable. The result is then
 * pulled toward 50 in proportion to how little confidence we have, which stops
 * a single analyst's moonshot target from topping the table.
 */
export function computeComposite(
  input: CompositeInput,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): number | undefined {
  const parts: { value: number; weight: number }[] = [];
  if (input.consensusScore !== undefined) {
    parts.push({ value: input.consensusScore, weight: weights.consensus });
  }
  if (input.upsideScore !== undefined) {
    parts.push({ value: input.upsideScore, weight: weights.upside });
  }
  parts.push({ value: input.confidence.overall * 100, weight: weights.quality });

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight <= 0) return undefined;
  // A quality-only score is meaningless — we know nothing about the stock.
  if (parts.length === 1) return undefined;

  const raw =
    parts.reduce((sum, p) => sum + p.value * p.weight, 0) / totalWeight;

  const keep = 1 - weights.shrinkage * (1 - input.confidence.overall);
  return clamp(50 + (raw - 50) * keep, 0, 100);
}

/** Bucket the composite into words for the UI. */
export function verdictFromComposite(composite: number | undefined): string {
  if (composite === undefined) return "Unrated";
  if (composite >= 72) return "Strong Buy";
  if (composite >= 60) return "Buy";
  if (composite >= 45) return "Hold";
  if (composite >= 33) return "Underperform";
  return "Sell";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isPositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Weighted mean that ignores undefined samples. Returns undefined if empty. */
export function weightedMean(
  samples: { value: number | undefined; weight: number }[],
): number | undefined {
  let num = 0;
  let den = 0;
  for (const s of samples) {
    if (s.value === undefined || !Number.isFinite(s.value) || s.weight <= 0) {
      continue;
    }
    num += s.value * s.weight;
    den += s.weight;
  }
  return den > 0 ? num / den : undefined;
}
