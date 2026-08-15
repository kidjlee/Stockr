#!/usr/bin/env tsx
/**
 * Pull fresh analyst data and write a snapshot.
 *
 *   npm run refresh
 *   npm run refresh -- --limit 25
 *   npm run refresh -- --only yahoo,tradingview
 *   npm run refresh -- --symbols RY.TO,ENB.TO --dry-run
 */
import { runRefresh } from "../lib/pipeline";
import { saveSnapshot } from "../lib/storage";
import { DEFAULT_WEIGHTS } from "../lib/types";

interface Args {
  only?: string[];
  symbols?: string[];
  limit?: number;
  concurrency?: number;
  dryRun: boolean;
  top: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, top: 15 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--only":
        args.only = next()?.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--symbols":
        args.symbols = next()?.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--limit":
        args.limit = Number(next());
        break;
      case "--concurrency":
        args.concurrency = Number(next());
        break;
      case "--top":
        args.top = Number(next()) || 15;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith("--")) {
          console.error(`Unknown flag: ${arg}`);
          printHelp();
          process.exit(1);
        }
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: npm run refresh -- [options]

  --only <ids>         Comma-separated provider ids (yahoo, tradingview, finnhub, tipranks, fmp, manual)
  --symbols <list>     Restrict to specific symbols, e.g. RY.TO,ENB.TO
  --limit <n>          Only process the first n instruments
  --concurrency <n>    Per-provider request concurrency (default 6)
  --top <n>            How many rows to print when finished (default 15)
  --dry-run            Fetch and score, but do not write a snapshot
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();

  const snapshot = await runRefresh({
    only: args.only,
    symbols: args.symbols,
    limit: args.limit,
    concurrency: args.concurrency,
    weights: DEFAULT_WEIGHTS,
  });

  const ranked = snapshot.records.filter((r) => r.composite !== undefined);
  console.log(`\nTop ${Math.min(args.top, ranked.length)} by analyst composite:`);
  console.log(
    pad("#", 4) +
      pad("Symbol", 12) +
      pad("Score", 8) +
      pad("Verdict", 14) +
      pad("Price", 11) +
      pad("Target", 11) +
      pad("Upside", 10) +
      pad("Buy%", 8) +
      pad("Sell%", 8) +
      "Sources",
  );
  for (const record of ranked.slice(0, args.top)) {
    console.log(
      pad(String(record.rank ?? "-"), 4) +
        pad(record.symbol, 12) +
        pad(record.composite?.toFixed(1) ?? "-", 8) +
        pad(record.verdict, 14) +
        pad(fmt(record.price), 11) +
        pad(fmt(record.targetMean), 11) +
        pad(pct(record.upside), 10) +
        pad(pct(record.bullishPct), 8) +
        pad(pct(record.bearishPct), 8) +
        record.sources.join(","),
    );
  }

  const failed = snapshot.providerRuns.filter((p) => p.enabled && !p.ok);
  if (failed.length) {
    console.log(
      `\nWarning: ${failed.length} provider(s) failed — ${failed.map((f) => `${f.provider} (${f.error})`).join("; ")}`,
    );
  }

  if (args.dryRun) {
    console.log("\nDry run — no snapshot written.");
  } else {
    const file = await saveSnapshot(snapshot);
    console.log(`\nWrote ${file}`);
  }
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

function pad(value: string, width: number): string {
  return value.length >= width ? `${value.slice(0, width - 1)} ` : value.padEnd(width);
}

function fmt(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(2);
}

function pct(value: number | undefined): string {
  return value === undefined ? "-" : `${(value * 100).toFixed(1)}%`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
