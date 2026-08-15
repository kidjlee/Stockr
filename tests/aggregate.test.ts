import { describe, expect, it } from "vitest";
import {
  aggregate,
  median,
  rankRecords,
  readingWeight,
  type ProviderMeta,
} from "../src/lib/aggregate";
import { EMPTY_COUNTS } from "../src/lib/score";
import { toInstrument } from "../src/lib/universe";
import { DEFAULT_WEIGHTS, type ProviderReading, type RatingCounts } from "../src/lib/types";

const RY = toInstrument({
  symbol: "RY.TO",
  name: "Royal Bank of Canada",
  kind: "stock",
  sector: "Financials",
});

const META = new Map<string, ProviderMeta>([
  ["yahoo", { id: "yahoo", label: "Yahoo Finance", weight: 1 }],
  ["tradingview", { id: "tradingview", label: "TradingView", weight: 0.9 }],
  ["tipranks", { id: "tipranks", label: "TipRanks", weight: 0.8 }],
]);

function counts(partial: Partial<RatingCounts>): RatingCounts {
  return { ...EMPTY_COUNTS, ...partial };
}

function reading(partial: Partial<ProviderReading>): ProviderReading {
  return {
    provider: "yahoo",
    symbol: "RY.TO",
    fetchedAt: "2026-08-15T00:00:00.000Z",
    ...partial,
  };
}

describe("aggregate", () => {
  it("produces an unrated record when no source has anything", () => {
    const record = aggregate(RY, [], META);
    expect(record.composite).toBeUndefined();
    expect(record.verdict).toBe("Unrated");
    expect(record.sources).toEqual([]);
    expect(record.warnings?.[0]).toMatch(/No analyst coverage/);
  });

  it("blends distributions as shares rather than summing counts", () => {
    // Both sources see the same 10-analyst book. Summing would claim 20.
    const record = aggregate(
      RY,
      [
        reading({ counts: counts({ strongBuy: 6, hold: 4 }), analystCount: 10, price: 100 }),
        reading({
          provider: "tradingview",
          counts: counts({ strongBuy: 6, hold: 4 }),
          analystCount: 10,
          price: 100,
        }),
      ],
      META,
    );

    expect(record.analystCount).toBe(10);
    expect(record.distribution!.strongBuy).toBeCloseTo(0.6);
    expect(record.bullishPct).toBeCloseTo(0.6);
    expect(record.bearishPct).toBeCloseTo(0);
    expect(record.buyVsSellSpread).toBeCloseTo(0.6);
  });

  it("reports coverage as the largest single source saw, not the total", () => {
    const record = aggregate(
      RY,
      [
        reading({ counts: counts({ buy: 8 }), analystCount: 8 }),
        reading({ provider: "tipranks", counts: counts({ buy: 12 }), analystCount: 12 }),
      ],
      META,
    );
    expect(record.analystCount).toBe(12);
  });

  it("weights a well-covered source above a thin one", () => {
    const record = aggregate(
      RY,
      [
        // 25 analysts, all strong buy.
        reading({ counts: counts({ strongBuy: 25 }), analystCount: 25 }),
        // 1 analyst, sell.
        reading({ provider: "tipranks", counts: counts({ sell: 1 }), analystCount: 1 }),
      ],
      META,
    );
    // The blend must land far closer to the 25-analyst view than the midpoint.
    expect(record.consensusScore!).toBeGreaterThan(80);
  });

  it("uses the median price and flags cross-listing mismatches", () => {
    const record = aggregate(
      RY,
      [
        reading({ counts: counts({ buy: 5 }), analystCount: 5, price: 100 }),
        reading({ provider: "tradingview", counts: counts({ buy: 5 }), price: 140 }),
      ],
      META,
    );
    expect(record.price).toBe(120);
    expect(record.warnings?.some((w) => /disagree on price/.test(w))).toBe(true);
  });

  it("computes upside off the blended price and target", () => {
    const record = aggregate(
      RY,
      [reading({ counts: counts({ buy: 10 }), analystCount: 10, price: 100, targetMean: 125 })],
      META,
    );
    expect(record.upside).toBeCloseTo(0.25);
    expect(record.targetMean).toBe(125);
  });

  it("keeps the widest target range across sources", () => {
    const record = aggregate(
      RY,
      [
        reading({ counts: counts({ buy: 4 }), targetMean: 120, targetHigh: 140, targetLow: 105 }),
        reading({
          provider: "tradingview",
          counts: counts({ buy: 4 }),
          targetMean: 122,
          targetHigh: 150,
          targetLow: 95,
        }),
      ],
      META,
    );
    expect(record.targetHigh).toBe(150);
    expect(record.targetLow).toBe(95);
  });

  it("warns about thin coverage", () => {
    const record = aggregate(
      RY,
      [reading({ counts: counts({ buy: 2 }), analystCount: 2, price: 10, targetMean: 12 })],
      META,
    );
    expect(record.warnings?.some((w) => /Thin coverage/.test(w))).toBe(true);
  });

  it("scores a source that only reports a scalar consensus", () => {
    const record = aggregate(
      RY,
      [reading({ consensusScore: 75, analystCount: 12, price: 100, targetMean: 110 })],
      META,
    );
    expect(record.consensusScore).toBe(75);
    expect(record.distribution).toBeUndefined();
    expect(record.composite).toBeDefined();
  });

  it("ignores readings with no usable signal", () => {
    const record = aggregate(RY, [reading({ note: "nothing here" })], META);
    expect(record.sources).toEqual([]);
    expect(record.providers).toEqual([]);
  });

  it("records each source's own view for the detail page", () => {
    const record = aggregate(
      RY,
      [
        reading({ counts: counts({ buy: 5 }), analystCount: 5, price: 100, targetMean: 110 }),
        reading({ provider: "tipranks", counts: counts({ hold: 5 }), analystCount: 5, price: 100, targetMean: 101 }),
      ],
      META,
    );
    expect(record.providers).toHaveLength(2);
    expect(record.providers[0].upside).toBeCloseTo(0.1);
    expect(record.providers[1].upside).toBeCloseTo(0.01);
    expect(record.providers[0].label).toBe("Yahoo Finance");
  });
});

describe("readingWeight", () => {
  const yahoo = META.get("yahoo")!;

  it("scales with analyst coverage", () => {
    const many = readingWeight(reading({ analystCount: 25 }), yahoo, DEFAULT_WEIGHTS);
    const few = readingWeight(reading({ analystCount: 2 }), yahoo, DEFAULT_WEIGHTS);
    expect(many).toBeGreaterThan(few * 2);
    expect(many).toBeLessThanOrEqual(yahoo.weight);
  });

  it("treats unknown coverage as neutral, not as a single analyst", () => {
    const unknown = readingWeight(reading({}), yahoo, DEFAULT_WEIGHTS);
    const one = readingWeight(reading({ analystCount: 1 }), yahoo, DEFAULT_WEIGHTS);
    expect(unknown).toBeGreaterThan(one);
    expect(unknown).toBeCloseTo(0.6);
  });

  it("never drops a reading to zero influence", () => {
    expect(
      readingWeight(reading({ analystCount: 0 }), yahoo, DEFAULT_WEIGHTS),
    ).toBeGreaterThan(0);
  });

  it("falls back to the target analyst count when no rating count is given", () => {
    const weight = readingWeight(
      reading({ targetAnalystCount: 20 }),
      yahoo,
      DEFAULT_WEIGHTS,
    );
    expect(weight).toBeCloseTo(1);
  });
});

describe("rankRecords", () => {
  it("orders by composite and leaves unrated names unranked at the end", () => {
    const make = (symbol: string, composite?: number) =>
      aggregate(
        toInstrument({ symbol, name: symbol, kind: "stock" }),
        composite === undefined
          ? []
          : [reading({ symbol, consensusScore: composite, analystCount: 20 })],
        META,
      );

    const ranked = rankRecords([make("A.TO", 40), make("B.TO"), make("C.TO", 90)]);
    expect(ranked.map((r) => r.symbol)).toEqual(["C.TO", "A.TO", "B.TO"]);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
    expect(ranked[2].rank).toBeUndefined();
  });
});

describe("median", () => {
  it("handles odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });
});
