import { describe, expect, it } from "vitest";
import {
  identifierCandidates,
  pickLatest as zacksLatest,
  toCounts as zacksCounts,
} from "../src/providers/zacks";
import {
  latestPerAnalyst,
  normalizeRating,
  toReading as benzingaToReading,
} from "../src/providers/benzinga";
import { toInstrument } from "../src/lib/universe";

const RY = toInstrument({ symbol: "RY.TO", name: "Royal Bank", kind: "stock" });

describe("zacks (via Intrinio) normalization", () => {
  it("maps the snapshot's five counts straight across", () => {
    const counts = zacksCounts({
      strong_buys: 6,
      buys: 4,
      holds: 3,
      sells: 1,
      strong_sells: 1,
    })!;
    expect(counts).toEqual({
      strongBuy: 6,
      buy: 4,
      hold: 3,
      underperform: 1,
      sell: 1,
    });
  });

  it("returns undefined for an empty snapshot rather than a zeroed book", () => {
    expect(zacksCounts({})).toBeUndefined();
  });

  it("picks the snapshot with the most recent rating_date, not array order", () => {
    const latest = zacksLatest([
      { rating_date: "2026-05-01", buys: 1 },
      { rating_date: "2026-08-01", buys: 9 },
      { rating_date: "2026-07-01", buys: 5 },
    ])!;
    expect(latest.rating_date).toBe("2026-08-01");
  });

  it("returns undefined for an empty or missing snapshot list", () => {
    expect(zacksLatest([])).toBeUndefined();
    expect(zacksLatest(undefined)).toBeUndefined();
  });

  it("tries the plain root before Canadian-suffixed variants", () => {
    expect(identifierCandidates(RY)).toEqual(["RY", "RY:CA", "RY.TO"]);
  });
});

describe("benzinga rating-word normalization", () => {
  it("maps common sell-side vocabulary onto the five rungs", () => {
    expect(normalizeRating("Outperform")).toBe("buy");
    expect(normalizeRating("Sector Perform")).toBe("hold");
    expect(normalizeRating("Underweight")).toBe("underperform");
    expect(normalizeRating("Strong Buy")).toBe("strongBuy");
    expect(normalizeRating("Sell")).toBe("sell");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizeRating("  bUY  ")).toBe("buy");
  });

  it("drops words it doesn't recognize rather than guessing", () => {
    expect(normalizeRating("Speculative Buy Under Review")).toBeUndefined();
    expect(normalizeRating(undefined)).toBeUndefined();
  });
});

describe("benzinga latestPerAnalyst", () => {
  const now = new Date("2026-08-18T00:00:00Z");
  const cutoff = now.getTime() - 365 * 86_400_000;

  it("keeps only each analyst's most recent action", () => {
    const rows = latestPerAnalyst(
      [
        { analyst_id: "a1", date: "2026-01-01", rating_current: "Hold" },
        { analyst_id: "a1", date: "2026-06-01", rating_current: "Buy" },
        { analyst_id: "a2", date: "2026-05-01", rating_current: "Sell" },
      ],
      cutoff,
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.analyst_id === "a1")?.rating_current).toBe("Buy");
  });

  it("excludes actions older than the lookback window", () => {
    const rows = latestPerAnalyst(
      [{ analyst_id: "a1", date: "2020-01-01", rating_current: "Buy" }],
      cutoff,
    );
    expect(rows).toHaveLength(0);
  });

  it("falls back to analyst_name when analyst_id is missing", () => {
    const rows = latestPerAnalyst(
      [{ analyst_name: "Jane Doe", date: "2026-06-01", rating_current: "Buy" }],
      cutoff,
    );
    expect(rows).toHaveLength(1);
  });

  it("drops rows with no analyst identity or no date", () => {
    const rows = latestPerAnalyst(
      [
        { date: "2026-06-01", rating_current: "Buy" },
        { analyst_id: "a1", rating_current: "Buy" },
      ],
      cutoff,
    );
    expect(rows).toHaveLength(0);
  });
});

describe("benzinga toReading", () => {
  const now = new Date("2026-08-18T00:00:00Z");

  it("builds a consensus from each analyst's latest call and averages targets", () => {
    const { reading, dropped } = benzingaToReading(
      RY,
      [
        { analyst_id: "a1", date: "2026-06-01", rating_current: "Buy", pt_current: "180" },
        { analyst_id: "a2", date: "2026-07-01", rating_current: "Hold", pt_current: "170" },
        // Superseded by the more recent Buy call above — must not double count a1.
        { analyst_id: "a1", date: "2026-01-01", rating_current: "Sell", pt_current: "140" },
      ],
      now,
    );
    expect(dropped).toBe(0);
    expect(reading!.counts).toEqual({
      strongBuy: 0,
      buy: 1,
      hold: 1,
      underperform: 0,
      sell: 0,
    });
    expect(reading!.analystCount).toBe(2);
    expect(reading!.targetMean).toBeCloseTo(175);
    expect(reading!.note).toMatch(/most recent call/);
  });

  it("prefers the split-adjusted target when both are present", () => {
    const { reading } = benzingaToReading(
      RY,
      [
        {
          analyst_id: "a1",
          date: "2026-06-01",
          rating_current: "Buy",
          pt_current: "180",
          adjusted_pt_current: "90",
        },
      ],
      now,
    );
    expect(reading!.targetMean).toBe(90);
  });

  it("still reports a target-only reading when the rating word is unrecognized", () => {
    const { reading, dropped } = benzingaToReading(
      RY,
      [{ analyst_id: "a1", date: "2026-06-01", rating_current: "Speculative Buy", pt_current: "180" }],
      now,
    );
    expect(dropped).toBe(1);
    expect(reading!.counts).toBeUndefined();
    expect(reading!.targetMean).toBe(180);
  });

  it("returns null when there is nothing usable at all", () => {
    const { reading } = benzingaToReading(RY, [], now);
    expect(reading).toBeNull();
  });
});
