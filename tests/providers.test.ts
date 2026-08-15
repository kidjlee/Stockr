import { describe, expect, it } from "vitest";
import { toCounts as fmpCounts, pickLatest as fmpLatest } from "../src/providers/fmp";
import {
  toCounts as finnhubCounts,
  pickLatest as finnhubLatest,
} from "../src/providers/finnhub";
import { parseCsv, parseManualCsv } from "../src/providers/manual";
import { parse as parseTipranks, toCounts as tipranksCounts } from "../src/providers/tipranks";
import { toReading, TV_COLUMNS } from "../src/providers/tradingview";
import { toCounts as yahooCounts } from "../src/providers/yahoo";
import { toInstrument } from "../src/lib/universe";

const RY = toInstrument({ symbol: "RY.TO", name: "Royal Bank", kind: "stock" });

describe("yahoo normalization", () => {
  it("maps Yahoo's sell rung to underperform and strongSell to sell", () => {
    const counts = yahooCounts({ strongBuy: 5, buy: 4, hold: 3, sell: 2, strongSell: 1 })!;
    expect(counts.strongBuy).toBe(5);
    expect(counts.buy).toBe(4);
    expect(counts.hold).toBe(3);
    expect(counts.underperform).toBe(2);
    expect(counts.sell).toBe(1);
  });

  it("returns undefined for an empty trend row", () => {
    expect(yahooCounts({ strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 })).toBeUndefined();
    expect(yahooCounts({})).toBeUndefined();
  });
});

describe("tradingview row decoding", () => {
  function row(values: Record<string, unknown>) {
    return { s: "TSX:RY", d: TV_COLUMNS.map((column) => values[column] ?? null) };
  }

  it("reads analyst columns positionally", () => {
    const reading = toReading(
      RY,
      row({
        description: "Royal Bank of Canada",
        close: 178.5,
        currency: "CAD",
        sector: "Finance",
        recommendation_buy: 6,
        recommendation_over: 3,
        recommendation_hold: 5,
        recommendation_under: 1,
        recommendation_sell: 0,
        recommendation_total: 15,
        price_target_average: 195.25,
        price_target_high: 210,
        price_target_low: 170,
        price_target_estimates_num: 14,
      }),
      TV_COLUMNS,
    );

    expect(reading.price).toBe(178.5);
    expect(reading.counts).toEqual({
      strongBuy: 6,
      buy: 3,
      hold: 5,
      underperform: 1,
      sell: 0,
    });
    expect(reading.analystCount).toBe(15);
    expect(reading.targetAnalystCount).toBe(14);
    expect(reading.targetMean).toBe(195.25);
    expect(reading.name).toBe("Royal Bank of Canada");
  });

  it("degrades to price-only when analyst columns are absent", () => {
    const core = ["name", "description", "close", "currency", "type"];
    const reading = toReading(
      RY,
      { s: "TSX:RY", d: ["RY", "Royal Bank of Canada", 178.5, "CAD", "stock"] },
      core,
    );
    expect(reading.price).toBe(178.5);
    expect(reading.counts).toBeUndefined();
    expect(reading.targetMean).toBeUndefined();
  });

  it("falls back to summing the ladder when no total is given", () => {
    const reading = toReading(
      RY,
      row({ recommendation_buy: 2, recommendation_hold: 3 }),
      TV_COLUMNS,
    );
    expect(reading.analystCount).toBe(5);
  });
});

describe("finnhub normalization", () => {
  it("picks the newest period regardless of array order", () => {
    const latest = finnhubLatest([
      { symbol: "RY.TO", period: "2026-06-01", strongBuy: 1, buy: 1, hold: 1, sell: 0, strongSell: 0 },
      { symbol: "RY.TO", period: "2026-08-01", strongBuy: 9, buy: 2, hold: 1, sell: 0, strongSell: 0 },
    ])!;
    expect(latest.period).toBe("2026-08-01");
  });

  it("maps the ladder the same way as Yahoo", () => {
    const counts = finnhubCounts({
      symbol: "RY.TO",
      period: "2026-08-01",
      strongBuy: 4,
      buy: 3,
      hold: 2,
      sell: 1,
      strongSell: 1,
    })!;
    expect(counts.underperform).toBe(1);
    expect(counts.sell).toBe(1);
  });
});

describe("fmp normalization", () => {
  it("picks the newest dated row and maps the ladder", () => {
    const latest = fmpLatest([
      { symbol: "RY.TO", date: "2026-05-01", analystRatingsStrongBuy: 1 },
      { symbol: "RY.TO", date: "2026-08-01", analystRatingsStrongBuy: 7, analystRatingsHold: 2 },
    ])!;
    expect(latest.date).toBe("2026-08-01");
    const counts = fmpCounts(latest)!;
    expect(counts.strongBuy).toBe(7);
    expect(counts.hold).toBe(2);
  });
});

describe("tipranks normalization", () => {
  it("keeps the three-rung ladder without inventing conviction", () => {
    const counts = tipranksCounts({ nB: 8, nH: 4, nS: 1 })!;
    expect(counts.buy).toBe(8);
    expect(counts.strongBuy).toBe(0);
    expect(counts.underperform).toBe(0);
    expect(counts.sell).toBe(1);
  });

  it("reads the current period and its price target", () => {
    const reading = parseTipranks(RY, {
      companyName: "Royal Bank of Canada",
      consensuses: [
        { period: 1, nB: 1, nH: 1, nS: 1 },
        { period: 0, nB: 9, nH: 3, nS: 0 },
      ],
      ptConsensus: [
        { period: 1, priceTarget: 100 },
        { period: 0, priceTarget: 195, high: 210, low: 175 },
      ],
      prices: [{ p: 178 }],
      portfolioHoldingData: { analystConsensus: { consensus: "moderateBuy" } },
    })!;

    expect(reading.counts!.buy).toBe(9);
    expect(reading.targetMean).toBe(195);
    expect(reading.price).toBe(178);
    expect(reading.consensusLabel).toBe("Moderate Buy");
  });

  it("returns null when there is neither a rating nor a target", () => {
    expect(parseTipranks(RY, { companyName: "Royal Bank" })).toBeNull();
  });
});

describe("manual CSV", () => {
  const known = new Map([["RY.TO", RY]]);

  it("parses quoted fields and embedded commas", () => {
    const rows = parseCsv('symbol,note\nRY.TO,"a, b ""quoted"""\n');
    expect(rows[0].note).toBe('a, b "quoted"');
  });

  it("ignores comment lines and blank rows", () => {
    const rows = parseCsv("symbol,buy\n# a comment\n\nRY.TO,5\n");
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("RY.TO");
  });

  it("accepts a row and stamps its provenance", () => {
    const { readings } = parseManualCsv(
      "symbol,source,strongBuy,buy,hold,targetMean,analysts,asOf\nRY.TO,MarketWatch,4,6,2,195.5,12,2026-08-14\n",
      known,
      45,
      new Date("2026-08-15T00:00:00Z"),
    );
    expect(readings).toHaveLength(1);
    expect(readings[0].counts!.strongBuy).toBe(4);
    expect(readings[0].targetMean).toBe(195.5);
    expect(readings[0].analystCount).toBe(12);
    expect(readings[0].note).toMatch(/MarketWatch/);
  });

  it("drops rows that are older than the max age", () => {
    const { readings, expired } = parseManualCsv(
      "symbol,source,buy,asOf\nRY.TO,CNN,9,2026-01-01\n",
      known,
      45,
      new Date("2026-08-15T00:00:00Z"),
    );
    expect(readings).toHaveLength(0);
    expect(expired).toBe(1);
  });

  it("skips symbols that are not in the universe", () => {
    const { readings, skipped } = parseManualCsv(
      "symbol,buy\nZZZZ.TO,5\n",
      known,
      45,
      new Date("2026-08-15T00:00:00Z"),
    );
    expect(readings).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("strips currency formatting from targets", () => {
    const { readings } = parseManualCsv(
      'symbol,buy,targetMean\nRY.TO,5,"$1,234.50"\n',
      known,
      45,
      new Date("2026-08-15T00:00:00Z"),
    );
    expect(readings[0].targetMean).toBe(1234.5);
  });

  it("ignores a row with neither ratings nor a target", () => {
    const { readings } = parseManualCsv(
      "symbol,source\nRY.TO,MarketWatch\n",
      known,
      45,
      new Date("2026-08-15T00:00:00Z"),
    );
    expect(readings).toHaveLength(0);
  });
});
