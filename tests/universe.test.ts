import { describe, expect, it } from "vitest";
import { loadUniverse, toInstrument } from "../src/lib/universe";

describe("toInstrument", () => {
  it("derives root, exchange and TradingView ticker for a TSX listing", () => {
    const inst = toInstrument({ symbol: "ry.to", name: "Royal Bank", kind: "stock" });
    expect(inst.symbol).toBe("RY.TO");
    expect(inst.root).toBe("RY");
    expect(inst.exchange).toBe("TSX");
    expect(inst.tvSymbol).toBe("TSX:RY");
  });

  it("recognizes TSX Venture listings", () => {
    const inst = toInstrument({ symbol: "TOI.V", name: "Topicus", kind: "stock" });
    expect(inst.exchange).toBe("TSXV");
    expect(inst.tvSymbol).toBe("TSXV:TOI");
  });

  it("translates share classes between Yahoo and TradingView notation", () => {
    // Yahoo writes BBD-B.TO where TradingView writes TSX:BBD.B.
    expect(toInstrument({ symbol: "BBD-B.TO", name: "Bombardier", kind: "stock" }).tvSymbol).toBe(
      "TSX:BBD.B",
    );
    expect(toInstrument({ symbol: "TECK-B.TO", name: "Teck", kind: "stock" }).tvSymbol).toBe(
      "TSX:TECK.B",
    );
  });

  it("handles REIT unit tickers", () => {
    const inst = toInstrument({ symbol: "REI-UN.TO", name: "RioCan", kind: "stock" });
    expect(inst.root).toBe("REI-UN");
    expect(inst.tvSymbol).toBe("TSX:REI.UN");
  });

  it("falls back to the symbol when no name is given", () => {
    expect(toInstrument({ symbol: "X.TO", name: "", kind: "stock" }).name).toBe("X.TO");
  });
});

describe("the shipped universe", () => {
  it("loads, and every entry is well formed", async () => {
    const universe = await loadUniverse();
    expect(universe.length).toBeGreaterThan(150);

    for (const inst of universe) {
      expect(inst.symbol).toMatch(/^[A-Z0-9.\-]+\.(TO|V)$/);
      expect(["stock", "etf"]).toContain(inst.kind);
      expect(["TSX", "TSXV"]).toContain(inst.exchange);
      expect(inst.tvSymbol).toContain(":");
      expect(inst.name.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate symbols", async () => {
    const universe = await loadUniverse();
    expect(new Set(universe.map((i) => i.symbol)).size).toBe(universe.length);
  });

  it("tracks both stocks and ETFs", async () => {
    const universe = await loadUniverse();
    expect(universe.filter((i) => i.kind === "stock").length).toBeGreaterThan(100);
    expect(universe.filter((i) => i.kind === "etf").length).toBeGreaterThan(20);
  });
});
