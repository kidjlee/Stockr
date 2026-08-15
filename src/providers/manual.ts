/**
 * Manual overrides — `data/manual-ratings.csv`.
 *
 * The escape hatch for sources that cannot be fetched programmatically:
 * MarketWatch, CNN Markets, The Globe and Mail and similar sit behind bot
 * protection and terms that prohibit automated collection, but their numbers
 * are freely readable in a browser. Type what you see into the CSV and it
 * flows into the blend as a full source, with the same weighting rules as an
 * API-backed provider.
 *
 * Columns (header required, order free):
 *   symbol,source,strongBuy,buy,hold,underperform,sell,targetMean,targetHigh,
 *   targetLow,analysts,asOf,url,note
 *
 * Rows older than MANUAL_MAX_AGE_DAYS (default 45) are ignored so stale
 * hand-entered numbers cannot quietly dominate a ranking forever.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { EMPTY_COUNTS } from "../lib/score";
import type { Instrument, ProviderReading, RatingCounts } from "../lib/types";
import { nowIso, type Provider } from "./types";

export const MANUAL_CSV = path.join(process.cwd(), "data", "manual-ratings.csv");
const DEFAULT_MAX_AGE_DAYS = 45;

export const manualProvider: Provider = {
  id: "manual",
  label: "Manual entry",
  weight: 0.9,
  homepage: "",
  description:
    "Analyst numbers you transcribe yourself from sources that cannot be fetched automatically (MarketWatch, CNN, The Globe and Mail, a broker terminal). Rows carry an as-of date and expire after 45 days.",
  isEnabled: () => true,

  async fetch(instruments, ctx) {
    let csv: string;
    try {
      csv = await readFile(MANUAL_CSV, "utf8");
    } catch {
      return [];
    }

    const maxAgeDays = Number(process.env.MANUAL_MAX_AGE_DAYS) || DEFAULT_MAX_AGE_DAYS;
    const known = new Map(instruments.map((i) => [i.symbol.toUpperCase(), i]));
    const { readings, skipped, expired } = parseManualCsv(csv, known, maxAgeDays);

    if (expired) ctx.log(`${expired} row(s) ignored as stale (> ${maxAgeDays} days)`);
    if (skipped) ctx.log(`${skipped} row(s) skipped — symbol not in universe`);
    if (readings.length) ctx.log(`${readings.length} manual row(s) applied`);
    return readings;
  },
};

export function parseManualCsv(
  csv: string,
  known: Map<string, Instrument>,
  maxAgeDays: number,
  now = new Date(),
): { readings: ProviderReading[]; skipped: number; expired: number } {
  const rows = parseCsv(csv);
  const readings: ProviderReading[] = [];
  let skipped = 0;
  let expired = 0;

  for (const row of rows) {
    const symbol = (row.symbol ?? "").trim().toUpperCase();
    if (!symbol) continue;
    if (!known.has(symbol)) {
      skipped += 1;
      continue;
    }

    if (row.asof) {
      const asOf = new Date(row.asof);
      if (!Number.isNaN(asOf.getTime())) {
        const ageDays = (now.getTime() - asOf.getTime()) / 86_400_000;
        if (ageDays > maxAgeDays) {
          expired += 1;
          continue;
        }
      }
    }

    const counts: RatingCounts = {
      ...EMPTY_COUNTS,
      strongBuy: num(row.strongbuy) ?? 0,
      buy: num(row.buy) ?? 0,
      hold: num(row.hold) ?? 0,
      underperform: num(row.underperform) ?? 0,
      sell: num(row.sell) ?? 0,
    };
    const total =
      counts.strongBuy + counts.buy + counts.hold + counts.underperform + counts.sell;
    const targetMean = num(row.targetmean);
    if (total === 0 && !targetMean) continue;

    const source = (row.source ?? "manual").trim() || "manual";
    readings.push({
      provider: "manual",
      symbol,
      fetchedAt: nowIso(),
      counts: total > 0 ? counts : undefined,
      analystCount: num(row.analysts) ?? (total > 0 ? total : undefined),
      targetMean,
      targetHigh: num(row.targethigh),
      targetLow: num(row.targetlow),
      consensusLabel: undefined,
      sourceUrl: row.url?.trim() || undefined,
      note: `Hand-entered from ${source}${row.asof ? ` (as of ${row.asof.trim()})` : ""}${row.note ? ` — ${row.note.trim()}` : ""}`,
    });
  }

  return { readings, skipped, expired };
}

/** Minimal RFC-4180 reader: quoted fields, embedded commas, doubled quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const cleaned = rows.filter(
    (r) =>
      r.some((cell) => cell.trim().length) && !r[0]?.trim().startsWith("#"),
  );
  if (cleaned.length < 2) return [];

  const header = cleaned[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, ""));
  return cleaned.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key] = cells[index] ?? "";
    });
    return record;
  });
}

function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim().replace(/[$,]/g, "");
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}
