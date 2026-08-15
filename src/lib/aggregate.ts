/**
 * Combines the readings from every provider into a single scored record.
 *
 * Key decision: provider readings are treated as independent *estimates* of
 * the same underlying analyst book, not as disjoint sets of analysts. So we
 * blend normalized distributions rather than summing raw counts (summing would
 * triple-count the same analyst who is in Yahoo, TipRanks and MarketWatch
 * alike), and we report analyst coverage as the max any single source saw.
 */
import {
  computeComposite,
  computeConfidence,
  computeUpside,
  consensusScoreFromCounts,
  coverageScore,
  EMPTY_COUNTS,
  isPositive,
  toDistribution,
  totalCounts,
  upsideScore,
  verdictFromComposite,
  weightedMean,
} from "./score";
import {
  type ConsensusRecord,
  DEFAULT_WEIGHTS,
  type Instrument,
  type ProviderContribution,
  type ProviderReading,
  type RatingBucket,
  RATING_BUCKETS,
  type ScoringWeights,
} from "./types";

export interface ProviderMeta {
  id: string;
  label: string;
  /** Trust weight applied to this provider's contribution. */
  weight: number;
}

/**
 * The effective weight of one reading: the provider's trust weight scaled by
 * how much analyst coverage stands behind it. A source quoting 22 analysts
 * should dominate one quoting 2 — otherwise a lone dissenting analyst carried
 * by a minor aggregator drags down a unanimous 25-analyst book.
 *
 * A source that publishes no analyst count at all is not the same as one that
 * publishes a count of 1: unknown coverage gets a neutral weight rather than
 * being pushed to the floor.
 */
export function readingWeight(
  reading: ProviderReading,
  meta: ProviderMeta,
  weights: ScoringWeights,
): number {
  const count = reading.analystCount ?? reading.targetAnalystCount;
  if (count === undefined) return meta.weight * 0.6;
  // Floor at 0.08 so a single-analyst reading still nudges the blend.
  return (
    meta.weight *
    Math.max(0.08, coverageScore(count, weights.coverageBenchmark))
  );
}

export function aggregate(
  instrument: Instrument,
  readings: ProviderReading[],
  providerMeta: Map<string, ProviderMeta>,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): ConsensusRecord {
  const warnings: string[] = [];
  const usable = readings.filter((r) => hasSignal(r));

  const contributions: ProviderContribution[] = [];
  const blendedDist = { ...EMPTY_COUNTS } as Record<RatingBucket, number>;
  let distWeight = 0;
  const consensusSamples: { value: number | undefined; weight: number }[] = [];
  const targetSamples: { value: number | undefined; weight: number }[] = [];
  const providerScores: number[] = [];
  const priceSamples: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  let analystCount: number | undefined;

  for (const reading of usable) {
    const meta = providerMeta.get(reading.provider) ?? {
      id: reading.provider,
      label: reading.provider,
      weight: 0.5,
    };
    const weight = readingWeight(reading, meta, weights);

    // Prefer a score derived from the raw distribution; fall back to whatever
    // scalar consensus the provider gave us.
    const dist = reading.counts ? toDistribution(reading.counts) : null;
    const score = dist
      ? consensusScoreFromCounts(reading.counts!)
      : reading.consensusScore;

    if (dist) {
      for (const bucket of RATING_BUCKETS) {
        blendedDist[bucket] += dist[bucket] * weight;
      }
      distWeight += weight;
    }

    if (score !== undefined) {
      consensusSamples.push({ value: score, weight });
      providerScores.push(score);
    }

    if (isPositive(reading.targetMean)) {
      targetSamples.push({ value: reading.targetMean, weight });
    }
    if (isPositive(reading.targetHigh)) highs.push(reading.targetHigh);
    if (isPositive(reading.targetLow)) lows.push(reading.targetLow);
    if (isPositive(reading.price)) priceSamples.push(reading.price);

    const n = reading.analystCount ?? reading.targetAnalystCount;
    if (n !== undefined && (analystCount === undefined || n > analystCount)) {
      analystCount = n;
    }

    contributions.push({
      provider: meta.id,
      label: meta.label,
      weight: round(weight, 3),
      consensusScore: score === undefined ? undefined : round(score, 1),
      consensusLabel: reading.consensusLabel,
      analystCount: reading.analystCount ?? reading.targetAnalystCount,
      counts: reading.counts,
      targetMean: reading.targetMean,
      targetHigh: reading.targetHigh,
      targetLow: reading.targetLow,
      price: reading.price,
      upside: roundOrUndefined(
        computeUpside(reading.price, reading.targetMean),
        4,
      ),
      sourceUrl: reading.sourceUrl,
      note: reading.note,
    });
  }

  // Price: sources should agree closely. Use the median and flag wide spreads,
  // which usually means one source quoted a US listing or a stale close.
  const price = median(priceSamples);
  if (priceSamples.length > 1 && price) {
    const spread = (Math.max(...priceSamples) - Math.min(...priceSamples)) / price;
    if (spread > 0.05) {
      warnings.push(
        `Sources disagree on price by ${(spread * 100).toFixed(1)}% — check for a cross-listing mismatch.`,
      );
    }
  }

  const distribution =
    distWeight > 0
      ? (Object.fromEntries(
          RATING_BUCKETS.map((b) => [b, blendedDist[b] / distWeight]),
        ) as Record<RatingBucket, number>)
      : undefined;

  const consensusScore = weightedMean(consensusSamples);
  const targetMean = weightedMean(targetSamples);
  const upside = computeUpside(price, targetMean);
  const upsScore = upsideScore(upside, weights.upsideScale);

  const confidence = computeConfidence(analystCount, providerScores, weights);
  const composite = computeComposite(
    { consensusScore, upsideScore: upsScore, confidence },
    weights,
  );

  const bullishPct = distribution
    ? distribution.strongBuy + distribution.buy
    : undefined;
  const bearishPct = distribution
    ? distribution.underperform + distribution.sell
    : undefined;

  if (usable.length === 0) {
    warnings.push("No analyst coverage found from any enabled source.");
  } else if (analystCount !== undefined && analystCount > 0 && analystCount < 3) {
    warnings.push(`Thin coverage — only ${analystCount} analyst(s).`);
  }

  const naming = usable.find((r) => r.name)?.name;
  const sector = instrument.sector ?? usable.find((r) => r.sector)?.sector;

  return {
    symbol: instrument.symbol,
    root: instrument.root,
    name: instrument.name || naming || instrument.symbol,
    kind: instrument.kind,
    exchange: instrument.exchange,
    sector,
    currency: usable.find((r) => r.currency)?.currency ?? "CAD",
    price: roundOrUndefined(price, 4),
    targetMean: roundOrUndefined(targetMean, 4),
    targetHigh: highs.length ? Math.max(...highs) : undefined,
    targetLow: lows.length ? Math.min(...lows) : undefined,
    upside: roundOrUndefined(upside, 4),
    distribution: distribution
      ? (Object.fromEntries(
          RATING_BUCKETS.map((b) => [b, round(distribution[b], 4)]),
        ) as Record<RatingBucket, number>)
      : undefined,
    analystCount,
    bullishPct: roundOrUndefined(bullishPct, 4),
    bearishPct: roundOrUndefined(bearishPct, 4),
    buyVsSellSpread:
      bullishPct !== undefined && bearishPct !== undefined
        ? round(bullishPct - bearishPct, 4)
        : undefined,
    consensusScore: roundOrUndefined(consensusScore, 1),
    upsideScore: roundOrUndefined(upsScore, 1),
    composite: roundOrUndefined(composite, 1),
    verdict: verdictFromComposite(composite),
    confidence: {
      coverage: round(confidence.coverage, 3),
      breadth: round(confidence.breadth, 3),
      agreement: round(confidence.agreement, 3),
      overall: round(confidence.overall, 3),
    },
    sources: usable.map((r) => r.provider),
    providers: contributions,
    warnings: warnings.length ? warnings : undefined,
  };
}

/** A reading is worth keeping if it carries a rating, a target, or a price. */
function hasSignal(reading: ProviderReading): boolean {
  if (reading.counts && totalCounts(reading.counts) > 0) return true;
  if (reading.consensusScore !== undefined) return true;
  if (isPositive(reading.targetMean)) return true;
  if (isPositive(reading.price)) return true;
  return false;
}

export function median(values: number[]): number | undefined {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Rank the universe by composite, descending. Unrated names sort last and get
 * no rank number at all.
 */
export function rankRecords(records: ConsensusRecord[]): ConsensusRecord[] {
  const sorted = [...records].sort((a, b) => {
    const av = a.composite ?? -1;
    const bv = b.composite ?? -1;
    if (bv !== av) return bv - av;
    return a.symbol.localeCompare(b.symbol);
  });
  let rank = 0;
  for (const record of sorted) {
    if (record.composite === undefined) {
      record.rank = undefined;
      continue;
    }
    rank += 1;
    record.rank = rank;
  }
  return sorted;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundOrUndefined(
  value: number | undefined,
  digits: number,
): number | undefined {
  return value === undefined || !Number.isFinite(value)
    ? undefined
    : round(value, digits);
}
