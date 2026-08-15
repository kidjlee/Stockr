/**
 * The refresh pipeline: universe -> providers -> aggregate -> score -> rank.
 *
 * Shared by the CLI (`npm run refresh`) and the `/api/refresh` route so a
 * scheduled HTTP ping and a cron job produce identical output.
 */
import { aggregate, rankRecords } from "./aggregate";
import { applyLookThrough, type HoldingRef } from "./etf";
import { enabledProviders, providerMetaMap, ALL_PROVIDERS } from "../providers/index";
import { yahooHoldings } from "../providers/yahoo";
import { loadUniverse } from "./universe";
import { indexBySymbol, torontoDate } from "./storage";
import {
  type ConsensusRecord,
  DEFAULT_WEIGHTS,
  type Instrument,
  type ProviderReading,
  type ProviderRunSummary,
  type ScoringWeights,
  type Snapshot,
} from "./types";

export interface RefreshOptions {
  /** Restrict to these provider ids. */
  only?: string[];
  /** Restrict to these symbols (useful when testing). */
  symbols?: string[];
  /** Cap the universe size. */
  limit?: number;
  concurrency?: number;
  weights?: ScoringWeights;
  universeFile?: string;
  log?: (message: string) => void;
}

export async function runRefresh(
  options: RefreshOptions = {},
): Promise<Snapshot> {
  const log = options.log ?? ((message: string) => console.log(message));
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const concurrency = options.concurrency ?? 6;

  let universe = await loadUniverse(options.universeFile);
  if (options.symbols?.length) {
    const wanted = new Set(options.symbols.map((s) => s.toUpperCase()));
    universe = universe.filter((i) => wanted.has(i.symbol));
  }
  if (options.limit && options.limit > 0) {
    universe = universe.slice(0, options.limit);
  }
  if (!universe.length) throw new Error("Universe is empty after filtering");

  const providers = enabledProviders(options.only);
  if (!providers.length) throw new Error("No providers are enabled");
  log(
    `Universe: ${universe.length} instruments | Providers: ${providers.map((p) => p.id).join(", ")}`,
  );

  yahooHoldings.clear();

  const readingsBySymbol = new Map<string, ProviderReading[]>();
  const providerRuns: ProviderRunSummary[] = [];

  // Providers run sequentially so a single refresh never opens dozens of
  // sockets across five hosts at once; each provider parallelizes internally.
  for (const provider of providers) {
    const started = Date.now();
    const ctx = {
      concurrency,
      log: (message: string) => log(`  [${provider.id}] ${message}`),
    };
    try {
      const readings = await provider.fetch(universe, ctx);
      for (const reading of readings) {
        const key = reading.symbol.toUpperCase();
        const list = readingsBySymbol.get(key) ?? [];
        list.push(reading);
        readingsBySymbol.set(key, list);
      }
      providerRuns.push({
        provider: provider.id,
        label: provider.label,
        enabled: true,
        ok: true,
        readings: readings.length,
        durationMs: Date.now() - started,
      });
      log(
        `✓ ${provider.label}: ${readings.length} reading(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      providerRuns.push({
        provider: provider.id,
        label: provider.label,
        enabled: true,
        ok: false,
        readings: 0,
        durationMs: Date.now() - started,
        error: message,
      });
      // One dead source must not sink the run — the blend simply narrows.
      log(`✗ ${provider.label} failed: ${message}`);
    }
  }

  for (const provider of ALL_PROVIDERS) {
    if (providers.some((p) => p.id === provider.id)) continue;
    providerRuns.push({
      provider: provider.id,
      label: provider.label,
      enabled: false,
      ok: false,
      readings: 0,
      durationMs: 0,
      error: provider.envVar
        ? `disabled — set ${provider.envVar}`
        : "disabled",
    });
  }

  const meta = providerMetaMap(providers);
  let records = universe.map((inst) =>
    aggregate(inst, readingsBySymbol.get(inst.symbol) ?? [], meta, weights),
  );

  records = applyEtfLookThrough(records, universe, weights);
  records = rankRecords(records);

  const rated = records.filter((r) => r.composite !== undefined).length;
  log(`Scored ${rated}/${records.length} instruments`);

  return {
    generatedAt: new Date().toISOString(),
    date: torontoDate(),
    universeSize: universe.length,
    providerRuns,
    records,
    scoring: weights,
  };
}

/**
 * Second pass over ETFs. Runs after stocks are scored because a fund's score
 * is built from its holdings' scores.
 */
function applyEtfLookThrough(
  records: ConsensusRecord[],
  universe: Instrument[],
  weights: ScoringWeights,
): ConsensusRecord[] {
  const index = indexBySymbol(records);
  const etfSymbols = new Set(
    universe.filter((i) => i.kind === "etf").map((i) => i.symbol),
  );
  if (!etfSymbols.size) return records;

  return records.map((record) => {
    if (!etfSymbols.has(record.symbol)) return record;
    // A fund with its own analyst coverage keeps it; look-through is only for
    // the (usual) case of no direct ratings.
    if (record.composite !== undefined && record.analystCount) return record;
    const holdings = yahooHoldings.get(record.symbol) as HoldingRef[] | undefined;
    return applyLookThrough(record, holdings, index, weights);
  });
}
