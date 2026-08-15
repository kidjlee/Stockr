/**
 * ETF look-through scoring.
 *
 * ETFs have no analyst ratings of their own — nobody publishes a "Buy" on
 * XIU.TO. What we can do is score the fund's holdings and roll them up by
 * weight, which answers the question the ranking is actually for: is the
 * basket this fund holds well regarded by analysts, and is it trading below
 * where analysts think its components should be?
 *
 * Yahoo's `topHoldings` module gives the top ~10 positions, so coverage is
 * partial by construction. We report exactly how much of the fund we managed
 * to score and shrink the confidence accordingly rather than pretending a
 * 40%-covered fund is as well understood as a fully covered stock.
 */
import { computeComposite, verdictFromComposite } from "./score";
import type { ConsensusRecord, LookThrough, ScoringWeights } from "./types";
import { DEFAULT_WEIGHTS } from "./types";

export interface HoldingRef {
  symbol: string;
  name: string;
  /** Fraction of the fund, e.g. 0.062 for 6.2%. */
  weight: number;
}

/**
 * Yahoo reports holdings with their own symbology (`RY.TO`, but sometimes the
 * US line `RY` or a bare root). Resolve against what we actually scored.
 */
export function resolveHolding(
  symbol: string,
  index: Map<string, ConsensusRecord>,
): ConsensusRecord | undefined {
  const upper = symbol.trim().toUpperCase();
  return (
    index.get(upper) ??
    index.get(`${upper}.TO`) ??
    index.get(`${upper}.V`) ??
    index.get(upper.replace(/\.(TO|V)$/, ""))
  );
}

/**
 * Recompute an ETF record from its holdings. Returns the record unchanged when
 * we have no holdings to work with, or when the ETF already carries direct
 * analyst data (some covered-call and thematic funds do get rated).
 */
export function applyLookThrough(
  etf: ConsensusRecord,
  holdings: HoldingRef[] | undefined,
  index: Map<string, ConsensusRecord>,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): ConsensusRecord {
  if (!holdings?.length) return etf;

  const rows: LookThrough["holdings"] = [];
  let scoredWeight = 0;
  let compositeSum = 0;
  let upsideWeight = 0;
  let upsideSum = 0;
  let consensusSum = 0;
  let consensusWeight = 0;
  let analystWeighted = 0;

  for (const holding of holdings) {
    if (!Number.isFinite(holding.weight) || holding.weight <= 0) continue;
    const match = resolveHolding(holding.symbol, index);
    const row = {
      symbol: holding.symbol.toUpperCase(),
      name: match?.name ?? holding.name,
      weight: round(holding.weight, 5),
      composite: match?.composite,
      upside: match?.upside,
    };
    rows.push(row);

    if (match?.composite !== undefined) {
      scoredWeight += holding.weight;
      compositeSum += holding.weight * match.composite;
      if (match.consensusScore !== undefined) {
        consensusSum += holding.weight * match.consensusScore;
        consensusWeight += holding.weight;
      }
      if (match.upside !== undefined) {
        upsideSum += holding.weight * match.upside;
        upsideWeight += holding.weight;
      }
      analystWeighted += holding.weight * (match.analystCount ?? 0);
    }
  }

  rows.sort((a, b) => b.weight - a.weight);
  const lookThrough: LookThrough = {
    coverage: round(scoredWeight, 4),
    holdings: rows,
  };

  if (scoredWeight <= 0) {
    return {
      ...etf,
      lookThrough,
      warnings: [
        ...(etf.warnings ?? []),
        "None of this fund's reported holdings are in the tracked universe, so no look-through score was produced.",
      ],
    };
  }

  const consensusScore =
    consensusWeight > 0 ? consensusSum / consensusWeight : undefined;
  const lookThroughUpside =
    upsideWeight > 0 ? upsideSum / upsideWeight : undefined;

  // Coverage of the fund caps our confidence: scoring 45% of a fund is a
  // 45%-informed opinion, however good the underlying data is.
  const coverageFactor = Math.min(1, scoredWeight);
  const confidence = {
    coverage: round(coverageFactor, 3),
    breadth: etf.confidence.breadth,
    agreement: etf.confidence.agreement,
    overall: round(
      Math.min(
        1,
        coverageFactor * (0.6 + 0.4 * (analystWeighted / Math.max(scoredWeight, 1e-9) / 20)),
      ),
      3,
    ),
  };

  const blended = compositeSum / scoredWeight;
  // Re-run the shrinkage so a thinly covered fund cannot outrank a stock on
  // the strength of two well-liked holdings.
  const composite = computeComposite(
    {
      consensusScore: blended,
      upsideScore: undefined,
      confidence,
    },
    { ...weights, consensus: 1, upside: 0, quality: 0.2 },
  );

  const warnings = [...(etf.warnings ?? [])];
  if (scoredWeight < 0.4) {
    warnings.push(
      `Look-through covers only ${(scoredWeight * 100).toFixed(0)}% of fund weight — treat the score as indicative.`,
    );
  }

  return {
    ...etf,
    consensusScore: consensusScore === undefined ? undefined : round(consensusScore, 1),
    upside: lookThroughUpside === undefined ? etf.upside : round(lookThroughUpside, 4),
    upsideScore: undefined,
    composite: composite === undefined ? undefined : round(composite, 1),
    verdict: verdictFromComposite(composite),
    analystCount: Math.round(analystWeighted / Math.max(scoredWeight, 1e-9)) || undefined,
    confidence,
    lookThrough,
    warnings: warnings.length ? warnings : undefined,
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
