import { describe, expect, it } from "vitest";
import { applyLookThrough, resolveHolding } from "../src/lib/etf";
import { aggregate, type ProviderMeta } from "../src/lib/aggregate";
import { EMPTY_COUNTS } from "../src/lib/score";
import { toInstrument } from "../src/lib/universe";
import type { ConsensusRecord } from "../src/lib/types";

const META = new Map<string, ProviderMeta>([
  ["yahoo", { id: "yahoo", label: "Yahoo Finance", weight: 1 }],
]);

function stock(symbol: string, strongBuy: number, hold: number, analysts: number) {
  return aggregate(
    toInstrument({ symbol, name: symbol, kind: "stock" }),
    [
      {
        provider: "yahoo",
        symbol,
        fetchedAt: "2026-08-15T00:00:00.000Z",
        counts: { ...EMPTY_COUNTS, strongBuy, hold },
        analystCount: analysts,
        price: 100,
        targetMean: 115,
      },
    ],
    META,
  );
}

function emptyEtf(symbol: string): ConsensusRecord {
  return aggregate(toInstrument({ symbol, name: symbol, kind: "etf" }), [], META);
}

describe("resolveHolding", () => {
  const index = new Map([["RY.TO", stock("RY.TO", 10, 2, 12)]]);

  it("matches exact, suffixed and stripped symbols", () => {
    expect(resolveHolding("RY.TO", index)?.symbol).toBe("RY.TO");
    expect(resolveHolding("ry.to", index)?.symbol).toBe("RY.TO");
    expect(resolveHolding("RY", index)?.symbol).toBe("RY.TO");
  });

  it("returns undefined for unknown holdings", () => {
    expect(resolveHolding("AAPL", index)).toBeUndefined();
  });
});

describe("applyLookThrough", () => {
  const bullish = stock("RY.TO", 12, 0, 12);
  const neutral = stock("BCE.TO", 0, 12, 12);
  const index = new Map([
    ["RY.TO", bullish],
    ["BCE.TO", neutral],
  ]);

  it("leaves the record alone when there are no holdings", () => {
    const etf = emptyEtf("XIU.TO");
    expect(applyLookThrough(etf, undefined, index)).toBe(etf);
    expect(applyLookThrough(etf, [], index)).toBe(etf);
  });

  it("scores a fund from its holdings, weighted", () => {
    const scored = applyLookThrough(
      emptyEtf("XFN.TO"),
      [
        { symbol: "RY.TO", name: "Royal Bank", weight: 0.5 },
        { symbol: "BCE.TO", name: "BCE", weight: 0.3 },
      ],
      index,
    );

    expect(scored.composite).toBeDefined();
    expect(scored.lookThrough!.coverage).toBeCloseTo(0.8);
    // Sits between its bullish and neutral holdings, nearer the heavier one.
    expect(scored.composite!).toBeLessThan(bullish.composite!);
    expect(scored.composite!).toBeGreaterThan(neutral.composite!);
  });

  it("sorts holdings by weight, heaviest first", () => {
    const scored = applyLookThrough(
      emptyEtf("XFN.TO"),
      [
        { symbol: "BCE.TO", name: "BCE", weight: 0.2 },
        { symbol: "RY.TO", name: "Royal Bank", weight: 0.6 },
      ],
      index,
    );
    expect(scored.lookThrough!.holdings.map((h) => h.symbol)).toEqual([
      "RY.TO",
      "BCE.TO",
    ]);
  });

  it("keeps unscoreable holdings visible but out of the average", () => {
    const scored = applyLookThrough(
      emptyEtf("XUU.TO"),
      [
        { symbol: "RY.TO", name: "Royal Bank", weight: 0.4 },
        { symbol: "AAPL", name: "Apple Inc.", weight: 0.4 },
      ],
      index,
    );
    expect(scored.lookThrough!.holdings).toHaveLength(2);
    expect(scored.lookThrough!.coverage).toBeCloseTo(0.4);
    expect(
      scored.lookThrough!.holdings.find((h) => h.symbol === "AAPL")!.composite,
    ).toBeUndefined();
  });

  it("warns and caps confidence when coverage is thin", () => {
    const thin = applyLookThrough(
      emptyEtf("XUU.TO"),
      [{ symbol: "RY.TO", name: "Royal Bank", weight: 0.15 }],
      index,
    );
    const full = applyLookThrough(
      emptyEtf("XFN.TO"),
      [{ symbol: "RY.TO", name: "Royal Bank", weight: 0.95 }],
      index,
    );

    expect(thin.warnings?.some((w) => /covers only/.test(w))).toBe(true);
    expect(thin.confidence.overall).toBeLessThan(full.confidence.overall);
    // Same underlying holding, so the thinly covered fund must score lower.
    expect(thin.composite!).toBeLessThan(full.composite!);
  });

  it("reports honestly when nothing in the fund is tracked", () => {
    const scored = applyLookThrough(
      emptyEtf("XEF.TO"),
      [{ symbol: "NESN.SW", name: "Nestle", weight: 0.05 }],
      index,
    );
    expect(scored.composite).toBeUndefined();
    expect(scored.lookThrough!.coverage).toBe(0);
    expect(scored.warnings?.some((w) => /None of this fund/.test(w))).toBe(true);
  });
});
