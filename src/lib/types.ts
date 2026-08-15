/**
 * Core domain types shared by the data pipeline and the web UI.
 */

/** The five rating buckets every provider is normalized into. */
export type RatingBucket =
  | "strongBuy"
  | "buy"
  | "hold"
  | "underperform"
  | "sell";

export const RATING_BUCKETS: RatingBucket[] = [
  "strongBuy",
  "buy",
  "hold",
  "underperform",
  "sell",
];

/** Human labels used in the UI. */
export const RATING_LABELS: Record<RatingBucket, string> = {
  strongBuy: "Strong Buy",
  buy: "Buy",
  hold: "Hold",
  underperform: "Underperform",
  sell: "Sell",
};

/**
 * Bullishness weight of each bucket on a -2..+2 scale. Used to collapse a
 * distribution of ratings into a single score.
 */
export const RATING_WEIGHTS: Record<RatingBucket, number> = {
  strongBuy: 2,
  buy: 1,
  hold: 0,
  underperform: -1,
  sell: -2,
};

export type RatingCounts = Record<RatingBucket, number>;

export type InstrumentKind = "stock" | "etf";

/** One tradeable thing we track. */
export interface Instrument {
  /** Canonical id used everywhere, e.g. "RY.TO". */
  symbol: string;
  /** Ticker without the exchange suffix, e.g. "RY". */
  root: string;
  name: string;
  kind: InstrumentKind;
  /** "TSX" | "TSXV" */
  exchange: string;
  sector?: string;
  /** TradingView ticker, e.g. "TSX:RY". */
  tvSymbol: string;
}

/**
 * A single provider's view of a single instrument. Every field is optional
 * because providers expose different subsets of the data.
 */
export interface ProviderReading {
  provider: string;
  symbol: string;
  fetchedAt: string;
  /** Raw analyst rating distribution, when the provider publishes one. */
  counts?: RatingCounts;
  /** Number of analysts behind the rating/target. */
  analystCount?: number;
  /**
   * 0..100 bullishness. Derived from `counts` when present, otherwise mapped
   * from the provider's own consensus scale.
   */
  consensusScore?: number;
  /** Provider's own wording, e.g. "Moderate Buy". */
  consensusLabel?: string;
  targetMean?: number;
  targetMedian?: number;
  targetHigh?: number;
  targetLow?: number;
  /** Number of analysts behind the price target, if reported separately. */
  targetAnalystCount?: number;
  price?: number;
  currency?: string;
  name?: string;
  sector?: string;
  kind?: InstrumentKind;
  sourceUrl?: string;
  /** Free-form caveat surfaced in the UI, e.g. "top-10 holdings only". */
  note?: string;
}

/** Per-provider contribution retained on the record for the detail view. */
export interface ProviderContribution {
  provider: string;
  label: string;
  weight: number;
  consensusScore?: number;
  consensusLabel?: string;
  analystCount?: number;
  counts?: RatingCounts;
  targetMean?: number;
  targetHigh?: number;
  targetLow?: number;
  price?: number;
  upside?: number;
  sourceUrl?: string;
  note?: string;
}

/** Confidence sub-scores, all 0..1. */
export interface Confidence {
  /** How many analysts cover it (log-scaled against a 20-analyst benchmark). */
  coverage: number;
  /** How many independent sources reported (benchmarked at 3). */
  breadth: number;
  /** How closely the sources agree on bullishness. */
  agreement: number;
  /** Blended 0..1 value used to shrink the composite toward neutral. */
  overall: number;
}

/** ETF look-through detail. */
export interface LookThrough {
  /** Fraction of fund weight we were able to score (0..1). */
  coverage: number;
  holdings: {
    symbol: string;
    name: string;
    weight: number;
    composite?: number;
    upside?: number;
  }[];
}

/** The fully aggregated, scored view of one instrument. */
export interface ConsensusRecord {
  symbol: string;
  root: string;
  name: string;
  kind: InstrumentKind;
  exchange: string;
  sector?: string;
  currency?: string;

  price?: number;
  targetMean?: number;
  targetHigh?: number;
  targetLow?: number;
  /** (targetMean - price) / price, e.g. 0.12 for +12%. */
  upside?: number;

  /** Blended distribution as fractions summing to 1. */
  distribution?: Record<RatingBucket, number>;
  /** Best estimate of true analyst coverage (max across providers). */
  analystCount?: number;
  /** distribution.strongBuy + distribution.buy */
  bullishPct?: number;
  /** distribution.underperform + distribution.sell */
  bearishPct?: number;
  /** bullishPct - bearishPct, the headline "buy vs sell" spread. */
  buyVsSellSpread?: number;

  /** 0..100, purely from the rating distribution. */
  consensusScore?: number;
  /** 0..100, purely from upside to the mean target. */
  upsideScore?: number;
  /** 0..100, the ranking number. */
  composite?: number;
  /** Strong Buy / Buy / Hold / Underperform / Sell derived from `composite`. */
  verdict: string;

  confidence: Confidence;
  sources: string[];
  providers: ProviderContribution[];
  lookThrough?: LookThrough;
  /** Populated after sorting the full universe. */
  rank?: number;
  warnings?: string[];
}

/** What one refresh run writes to disk. */
export interface Snapshot {
  /** ISO timestamp of the run. */
  generatedAt: string;
  /** YYYY-MM-DD in America/Toronto — the key used for the filename. */
  date: string;
  universeSize: number;
  providerRuns: ProviderRunSummary[];
  records: ConsensusRecord[];
  scoring: ScoringWeights;
}

export interface ProviderRunSummary {
  provider: string;
  label: string;
  enabled: boolean;
  ok: boolean;
  readings: number;
  durationMs: number;
  error?: string;
}

export interface ScoringWeights {
  consensus: number;
  upside: number;
  quality: number;
  /**
   * Upside (as a decimal) that maps to roughly 88/100 on the upside score.
   * Larger = flatter response to big targets.
   */
  upsideScale: number;
  /** Analyst count that counts as "full" coverage. */
  coverageBenchmark: number;
  /** Source count that counts as "full" breadth. */
  breadthBenchmark: number;
  /**
   * How far a zero-confidence name is pulled toward 50. 0 = no shrinkage,
   * 1 = zero-confidence names land exactly on 50.
   */
  shrinkage: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  consensus: 0.45,
  upside: 0.35,
  quality: 0.2,
  upsideScale: 0.35,
  coverageBenchmark: 20,
  breadthBenchmark: 3,
  shrinkage: 0.45,
};
