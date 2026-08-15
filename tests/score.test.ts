import { describe, expect, it } from "vitest";
import {
  computeComposite,
  computeConfidence,
  computeUpside,
  consensusScoreFromCounts,
  consensusScoreFromMean1to5,
  consensusScoreFromSigned,
  coverageScore,
  EMPTY_COUNTS,
  stdev,
  toDistribution,
  upsideScore,
  verdictFromComposite,
  weightedMean,
} from "../src/lib/score";
import { DEFAULT_WEIGHTS } from "../src/lib/types";

const counts = (partial: Partial<typeof EMPTY_COUNTS>) => ({
  ...EMPTY_COUNTS,
  ...partial,
});

describe("consensusScoreFromCounts", () => {
  it("anchors the scale at all-sell, all-hold and all-strong-buy", () => {
    expect(consensusScoreFromCounts(counts({ sell: 5 }))).toBe(0);
    expect(consensusScoreFromCounts(counts({ hold: 5 }))).toBe(50);
    expect(consensusScoreFromCounts(counts({ strongBuy: 5 }))).toBe(100);
  });

  it("places a pure buy book three quarters up the scale", () => {
    expect(consensusScoreFromCounts(counts({ buy: 4 }))).toBe(75);
  });

  it("balances symmetric books at neutral", () => {
    expect(consensusScoreFromCounts(counts({ strongBuy: 3, sell: 3 }))).toBe(50);
    expect(consensusScoreFromCounts(counts({ buy: 2, underperform: 2 }))).toBe(50);
  });

  it("returns undefined when nobody covers it", () => {
    expect(consensusScoreFromCounts(EMPTY_COUNTS)).toBeUndefined();
  });

  it("is insensitive to the size of the book, only its shape", () => {
    const small = consensusScoreFromCounts(counts({ strongBuy: 1, hold: 1 }));
    const large = consensusScoreFromCounts(counts({ strongBuy: 10, hold: 10 }));
    expect(small).toBe(large);
  });
});

describe("alternative consensus scales", () => {
  it("maps a 1..5 mean (1 = strong buy) onto 0..100", () => {
    expect(consensusScoreFromMean1to5(1)).toBe(100);
    expect(consensusScoreFromMean1to5(3)).toBe(50);
    expect(consensusScoreFromMean1to5(5)).toBe(0);
  });

  it("clamps out-of-range means to the ends of the scale", () => {
    expect(consensusScoreFromMean1to5(7)).toBe(0);
    expect(consensusScoreFromMean1to5(0.5)).toBe(100);
  });

  it("rejects a non-positive mean, which signals missing data not a strong buy", () => {
    expect(consensusScoreFromMean1to5(0)).toBeUndefined();
    expect(consensusScoreFromMean1to5(Number.NaN)).toBeUndefined();
  });

  it("maps a -1..+1 signed consensus onto 0..100", () => {
    expect(consensusScoreFromSigned(1)).toBe(100);
    expect(consensusScoreFromSigned(0)).toBe(50);
    expect(consensusScoreFromSigned(-1)).toBe(0);
  });
});

describe("toDistribution", () => {
  it("converts counts to fractions summing to one", () => {
    const dist = toDistribution(counts({ strongBuy: 2, buy: 1, hold: 1 }));
    expect(dist).not.toBeNull();
    expect(dist!.strongBuy).toBeCloseTo(0.5);
    expect(Object.values(dist!).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("returns null for an empty book", () => {
    expect(toDistribution(EMPTY_COUNTS)).toBeNull();
  });
});

describe("upside", () => {
  it("computes upside from price and target", () => {
    expect(computeUpside(100, 120)).toBeCloseTo(0.2);
    expect(computeUpside(100, 80)).toBeCloseTo(-0.2);
  });

  it("refuses non-positive inputs instead of dividing by zero", () => {
    expect(computeUpside(0, 120)).toBeUndefined();
    expect(computeUpside(100, undefined)).toBeUndefined();
    expect(computeUpside(-5, 10)).toBeUndefined();
  });

  it("centres the upside score at 50 for a price already at target", () => {
    expect(upsideScore(0)).toBe(50);
  });

  it("squashes outliers so an absurd target cannot run away with the ranking", () => {
    const big = upsideScore(3)!; // +300%
    const huge = upsideScore(30)!; // +3000%
    expect(big).toBeGreaterThan(95);
    expect(huge).toBeLessThanOrEqual(100);
    // Ten times the upside is worth less than five extra points.
    expect(huge - big).toBeLessThan(5);
  });

  it("is monotonic and symmetric around zero", () => {
    expect(upsideScore(0.1)!).toBeGreaterThan(upsideScore(0.05)!);
    expect(upsideScore(0.2)! - 50).toBeCloseTo(50 - upsideScore(-0.2)!);
  });
});

describe("coverageScore", () => {
  it("is zero without analysts and saturates at the benchmark", () => {
    expect(coverageScore(0, 20)).toBe(0);
    expect(coverageScore(undefined, 20)).toBe(0);
    expect(coverageScore(20, 20)).toBeCloseTo(1);
  });

  it("has diminishing returns past the benchmark", () => {
    expect(coverageScore(40, 20)).toBe(1);
    expect(coverageScore(5, 20)).toBeLessThan(0.7);
    expect(coverageScore(5, 20)).toBeGreaterThan(0.5);
  });
});

describe("stdev", () => {
  it("is zero for fewer than two samples or identical samples", () => {
    expect(stdev([])).toBe(0);
    expect(stdev([70])).toBe(0);
    expect(stdev([70, 70, 70])).toBe(0);
  });

  it("measures spread", () => {
    expect(stdev([40, 60])).toBeCloseTo(10);
  });
});

describe("computeConfidence", () => {
  it("rewards wide coverage from many agreeing sources", () => {
    const strong = computeConfidence(25, [72, 74, 73], DEFAULT_WEIGHTS);
    const weak = computeConfidence(1, [80], DEFAULT_WEIGHTS);
    expect(strong.overall).toBeGreaterThan(0.85);
    expect(weak.overall).toBeLessThan(0.4);
  });

  it("penalizes sources that disagree", () => {
    const agree = computeConfidence(15, [70, 71], DEFAULT_WEIGHTS);
    const disagree = computeConfidence(15, [20, 90], DEFAULT_WEIGHTS);
    expect(disagree.agreement).toBeLessThan(agree.agreement);
    expect(disagree.overall).toBeLessThan(agree.overall);
  });

  it("treats a lone source as neither agreeing nor disagreeing", () => {
    expect(computeConfidence(10, [70], DEFAULT_WEIGHTS).agreement).toBe(0.5);
  });
});

describe("computeComposite", () => {
  const confident = computeConfidence(25, [80, 80, 80], DEFAULT_WEIGHTS);
  const thin = computeConfidence(1, [80], DEFAULT_WEIGHTS);

  it("blends consensus and upside", () => {
    const composite = computeComposite(
      { consensusScore: 80, upsideScore: 80, confidence: confident },
      DEFAULT_WEIGHTS,
    )!;
    expect(composite).toBeGreaterThan(70);
    expect(composite).toBeLessThanOrEqual(100);
  });

  it("shrinks thinly covered names toward neutral", () => {
    const strong = computeComposite(
      { consensusScore: 95, upsideScore: 95, confidence: confident },
      DEFAULT_WEIGHTS,
    )!;
    const flimsy = computeComposite(
      { consensusScore: 95, upsideScore: 95, confidence: thin },
      DEFAULT_WEIGHTS,
    )!;
    expect(flimsy).toBeLessThan(strong);
    expect(flimsy).toBeGreaterThan(50);
  });

  it("still ranks a name that has ratings but no price target", () => {
    const composite = computeComposite(
      { consensusScore: 80, upsideScore: undefined, confidence: confident },
      DEFAULT_WEIGHTS,
    );
    expect(composite).toBeDefined();
    expect(composite!).toBeGreaterThan(60);
  });

  it("refuses to score a name with no analyst signal at all", () => {
    expect(
      computeComposite(
        { consensusScore: undefined, upsideScore: undefined, confidence: confident },
        DEFAULT_WEIGHTS,
      ),
    ).toBeUndefined();
  });

  it("stays inside 0..100 at both extremes", () => {
    const top = computeComposite(
      { consensusScore: 100, upsideScore: 100, confidence: confident },
      DEFAULT_WEIGHTS,
    )!;
    const bottom = computeComposite(
      { consensusScore: 0, upsideScore: 0, confidence: confident },
      DEFAULT_WEIGHTS,
    )!;
    expect(top).toBeLessThanOrEqual(100);
    expect(bottom).toBeGreaterThanOrEqual(0);
  });
});

describe("verdictFromComposite", () => {
  it("labels each band", () => {
    expect(verdictFromComposite(undefined)).toBe("Unrated");
    expect(verdictFromComposite(80)).toBe("Strong Buy");
    expect(verdictFromComposite(65)).toBe("Buy");
    expect(verdictFromComposite(50)).toBe("Hold");
    expect(verdictFromComposite(38)).toBe("Underperform");
    expect(verdictFromComposite(10)).toBe("Sell");
  });
});

describe("weightedMean", () => {
  it("ignores undefined samples and zero weights", () => {
    expect(
      weightedMean([
        { value: 100, weight: 1 },
        { value: undefined, weight: 5 },
        { value: 0, weight: 0 },
      ]),
    ).toBe(100);
  });

  it("weights samples", () => {
    expect(
      weightedMean([
        { value: 100, weight: 3 },
        { value: 0, weight: 1 },
      ]),
    ).toBe(75);
  });

  it("returns undefined when nothing is usable", () => {
    expect(weightedMean([{ value: undefined, weight: 1 }])).toBeUndefined();
  });
});
