/**
 * Loading and normalizing the tracked universe.
 *
 * The shipped list lives in `config/universe.json`. `npm run universe:refresh`
 * rebuilds it from TradingView's screener so it does not have to be
 * hand-maintained as the index changes.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Instrument, InstrumentKind } from "./types";

export interface UniverseEntry {
  symbol: string;
  name: string;
  kind: InstrumentKind;
  exchange?: string;
  sector?: string;
}

export interface UniverseFile {
  updatedAt?: string;
  source?: string;
  entries: UniverseEntry[];
}

export const UNIVERSE_PATH = path.join(process.cwd(), "config", "universe.json");

export async function loadUniverse(file = UNIVERSE_PATH): Promise<Instrument[]> {
  const raw = await readFile(file, "utf8");
  const parsed = JSON.parse(raw) as UniverseFile | UniverseEntry[];
  const entries = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(entries) || !entries.length) {
    throw new Error(`Universe file ${file} contains no entries`);
  }
  return dedupe(entries.map(toInstrument));
}

export async function saveUniverse(
  entries: UniverseEntry[],
  source: string,
  file = UNIVERSE_PATH,
): Promise<void> {
  const payload: UniverseFile = {
    updatedAt: new Date().toISOString(),
    source,
    entries: [...entries].sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Normalizes a universe entry into the shape providers consume, deriving the
 * exchange suffix and the TradingView ticker from the symbol.
 */
export function toInstrument(entry: UniverseEntry): Instrument {
  const symbol = entry.symbol.trim().toUpperCase();
  const suffix = symbol.endsWith(".V") ? "V" : symbol.endsWith(".TO") ? "TO" : "";
  const root = symbol.replace(/\.(TO|V)$/, "");
  const exchange = entry.exchange ?? (suffix === "V" ? "TSXV" : "TSX");
  // TradingView uses dashes where Yahoo uses dots for share classes
  // (Yahoo BBD-B.TO <-> TradingView TSX:BBD.B).
  const tvRoot = root.replace(/-/g, ".");

  return {
    symbol,
    root,
    name: entry.name?.trim() || symbol,
    kind: entry.kind,
    exchange,
    sector: entry.sector?.trim() || undefined,
    tvSymbol: `${exchange}:${tvRoot}`,
  };
}

function dedupe(instruments: Instrument[]): Instrument[] {
  const seen = new Map<string, Instrument>();
  for (const inst of instruments) {
    if (!seen.has(inst.symbol)) seen.set(inst.symbol, inst);
  }
  return [...seen.values()];
}
