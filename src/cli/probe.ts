#!/usr/bin/env tsx
/**
 * Inspect what a single provider actually returns for a few symbols.
 *
 * Use this first when a provider stops producing readings — it prints the raw
 * response so a renamed field is obvious in seconds.
 *
 *   npm run probe -- yahoo RY.TO
 *   npm run probe -- tradingview RY.TO ENB.TO
 *   npm run probe -- tradingview --raw
 */
import { ALL_PROVIDERS } from "../providers/index";
import { scan, TV_COLUMNS } from "../providers/tradingview";
import { toInstrument } from "../lib/universe";

async function main() {
  const argv = process.argv.slice(2);
  const raw = argv.includes("--raw");
  const positional = argv.filter((a) => !a.startsWith("--"));
  const providerId = positional[0];
  const symbols = positional.slice(1);

  if (!providerId) {
    console.log(
      `Usage: npm run probe -- <provider> [symbols...] [--raw]\n\nProviders: ${ALL_PROVIDERS.map((p) => p.id).join(", ")}`,
    );
    process.exit(1);
  }

  const provider = ALL_PROVIDERS.find((p) => p.id === providerId);
  if (!provider) {
    console.error(`Unknown provider "${providerId}"`);
    process.exit(1);
  }

  const targets = (symbols.length ? symbols : ["RY.TO", "ENB.TO", "SHOP.TO"]).map(
    (symbol) => toInstrument({ symbol, name: symbol, kind: "stock" }),
  );

  console.log(`Provider: ${provider.label} (enabled: ${provider.isEnabled()})`);
  if (!provider.isEnabled() && provider.envVar) {
    console.log(`Set ${provider.envVar} to enable it.`);
  }

  // The TradingView scanner is the one worth dumping verbatim — its column
  // names change and a positional response is unreadable without the map.
  if (raw && providerId === "tradingview") {
    const response = await scan(targets.map((t) => t.tvSymbol), TV_COLUMNS);
    for (const row of response.data ?? []) {
      console.log(`\n${row.s}`);
      TV_COLUMNS.forEach((column, index) => {
        console.log(`  ${column.padEnd(30)} ${JSON.stringify(row.d[index])}`);
      });
    }
    return;
  }

  const readings = await provider.fetch(targets, {
    concurrency: 3,
    log: (message) => console.log(`  [${provider.id}] ${message}`),
  });

  if (!readings.length) {
    console.log("\nNo readings returned.");
    return;
  }
  console.log(`\n${readings.length} reading(s):`);
  console.dir(readings, { depth: 4 });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
