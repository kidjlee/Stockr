import { NextResponse } from "next/server";
import { loadLatest, loadSnapshot } from "../../../lib/storage";

export const dynamic = "force-dynamic";

/**
 * Read the current rankings as JSON.
 *
 *   /api/rankings
 *   /api/rankings?kind=etf&limit=25
 *   /api/rankings?date=2026-08-14&minAnalysts=5
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const snapshot = date ? await loadSnapshot(date) : await loadLatest();

  if (!snapshot) {
    return NextResponse.json(
      { error: date ? `No snapshot for ${date}` : "No snapshot yet — run `npm run refresh`" },
      { status: 404 },
    );
  }

  const kind = url.searchParams.get("kind");
  const sector = url.searchParams.get("sector");
  const minAnalysts = Number(url.searchParams.get("minAnalysts")) || 0;
  const limit = Number(url.searchParams.get("limit")) || 0;
  const ratedOnly = url.searchParams.get("ratedOnly") !== "false";

  let records = snapshot.records;
  if (kind && kind !== "all") records = records.filter((r) => r.kind === kind);
  if (sector) records = records.filter((r) => r.sector === sector);
  if (ratedOnly) records = records.filter((r) => r.composite !== undefined);
  if (minAnalysts > 0) {
    records = records.filter((r) => (r.analystCount ?? 0) >= minAnalysts);
  }
  if (limit > 0) records = records.slice(0, limit);

  return NextResponse.json({
    date: snapshot.date,
    generatedAt: snapshot.generatedAt,
    count: records.length,
    providers: snapshot.providerRuns.filter((p) => p.enabled),
    records,
  });
}
