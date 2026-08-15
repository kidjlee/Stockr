#!/usr/bin/env tsx
/**
 * Rebuild `config/universe.json` from TradingView's Canada screener, so the
 * tracked list follows the market instead of being hand-maintained.
 *
 *   npm run universe:refresh                 # 250 stocks + 60 funds
 *   npm run universe:refresh -- --stocks 300 --funds 80
 *   npm run universe:refresh -- --dry-run
 */
import { scanTopByMarketCap } from "../providers/tradingview";
import { saveUniverse, type UniverseEntry } from "../lib/universe";

const COLUMNS = ["name", "description", "sector", "market_cap_basic", "type", "exchange"];

async function main() {
  const argv = process.argv.slice(2);
  const stockCount = numberFlag(argv, "--stocks") ?? 250;
  const fundCount = numberFlag(argv, "--funds") ?? 60;
  const dryRun = argv.includes("--dry-run");

  console.log(`Fetching top ${stockCount} stocks and ${fundCount} funds from TradingView…`);
  const [stocks, funds] = await Promise.all([
    scanTopByMarketCap(stockCount, "stock"),
    scanTopByMarketCap(fundCount, "fund"),
  ]);

  const entries: UniverseEntry[] = [
    ...toEntries(stocks.data ?? [], "stock"),
    ...toEntries(funds.data ?? [], "etf"),
  ];

  if (!entries.length) {
    throw new Error(
      "TradingView returned no rows — the screener columns may have been renamed. Run `npm run probe -- tradingview` to inspect the raw response.",
    );
  }

  const stockN = entries.filter((e) => e.kind === "stock").length;
  console.log(`Built ${entries.length} entries (${stockN} stocks, ${entries.length - stockN} funds)`);

  if (dryRun) {
    console.log(entries.slice(0, 20));
    console.log("Dry run — universe.json not written.");
    return;
  }

  await saveUniverse(entries, "tradingview:canada-screener");
  console.log("Wrote config/universe.json");
}

function toEntries(
  rows: { s: string; d: unknown[] }[],
  kind: "stock" | "etf",
): UniverseEntry[] {
  const at = (row: { d: unknown[] }, column: string) => row.d[COLUMNS.indexOf(column)];
  const entries: UniverseEntry[] = [];

  for (const row of rows) {
    // `s` is "TSX:RY" / "TSXV:ABC".
    const [exchange, tvRoot] = row.s.split(":");
    if (!exchange || !tvRoot) continue;
    if (!["TSX", "TSXV"].includes(exchange)) continue;

    // TradingView writes share classes as BBD.B; Yahoo wants BBD-B.TO.
    const yahooRoot = tvRoot.replace(/\./g, "-");
    const suffix = exchange === "TSXV" ? ".V" : ".TO";

    entries.push({
      symbol: `${yahooRoot}${suffix}`,
      name: String(at(row, "description") ?? yahooRoot),
      kind,
      exchange,
      sector: str(at(row, "sector")),
    });
  }
  return entries;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberFlag(argv: string[], flag: string): number | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) ? value : undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
