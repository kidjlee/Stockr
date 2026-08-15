import Link from "next/link";
import RankingTable from "../components/RankingTable";
import { DeltaText, formatPercent, Stat } from "../components/ui";
import { loadLatest, loadPrevious } from "../lib/storage";
import type { ConsensusRecord } from "../lib/types";

// Snapshots are read from disk on every request so a mid-session refresh
// shows up without a rebuild.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const snapshot = await loadLatest();
  if (!snapshot) return <NoData />;

  const records = snapshot.records;
  const rated = records.filter((r) => r.composite !== undefined);
  const stocks = rated.filter((r) => r.kind === "stock");
  const sectors = [...new Set(records.map((r) => r.sector).filter(Boolean))].sort() as string[];

  const strongBuys = rated.filter((r) => r.verdict === "Strong Buy").length;
  const bearish = rated.filter((r) =>
    ["Underperform", "Sell"].includes(r.verdict),
  ).length;
  const medianUpside = median(
    stocks.map((r) => r.upside).filter((v): v is number => v !== undefined),
  );

  const previous = await loadPrevious();
  const movers = computeMovers(records, previous?.records ?? []);

  return (
    <>
      <div className="page-head">
        <h1>TSX analyst consensus rankings</h1>
        <p className="lede">
          {records.length} TSX / TSXV listings and Canadian ETFs, ranked by a blend of
          sell-side rating distribution, price-target upside and how much
          coverage stands behind it. Snapshot {snapshot.date}.
        </p>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat
          label="Rated instruments"
          value={rated.length}
          sub={`${records.length - rated.length} with no coverage found`}
        />
        <Stat
          label="Strong Buy"
          value={strongBuys}
          sub={`${bearish} rated Underperform or Sell`}
          tone="pos"
        />
        <Stat
          label="Median upside"
          value={formatPercent(medianUpside)}
          sub="Stocks only, avg target vs price"
          tone={medianUpside !== undefined && medianUpside < 0 ? "neg" : "pos"}
        />
        <Stat
          label="Sources live"
          value={snapshot.providerRuns.filter((p) => p.ok).length}
          sub={snapshot.providerRuns
            .filter((p) => p.ok)
            .map((p) => p.label)
            .join(", ")}
        />
      </div>

      {movers.length ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>Biggest score moves since {previous?.date}</h3>
          <div className="grid grid-4">
            {movers.map((mover) => (
              <div key={mover.symbol}>
                <Link href={`/stock/${encodeURIComponent(mover.symbol)}`} className="sym">
                  {mover.symbol}
                </Link>{" "}
                <span className={mover.delta >= 0 ? "pos mono" : "neg mono"}>
                  {mover.delta >= 0 ? "+" : ""}
                  {mover.delta.toFixed(1)}
                </span>
                <div className="name">{mover.name}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <FailedProviders snapshot={snapshot} />

      <RankingTable records={records} sectors={sectors} />

      <div className="footer">
        Generated {new Date(snapshot.generatedAt).toUTCString()} · analyst data is
        third-party opinion, not investment advice. See{" "}
        <Link href="/methodology">methodology</Link>.
      </div>
    </>
  );
}

function FailedProviders({
  snapshot,
}: {
  snapshot: { providerRuns: { enabled: boolean; ok: boolean; label: string; error?: string }[] };
}) {
  const failed = snapshot.providerRuns.filter((p) => p.enabled && !p.ok);
  if (!failed.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      {failed.map((p) => (
        <div className="warn" key={p.label}>
          <strong>{p.label}</strong> did not return data on this run — {p.error}.
          Scores below are blended from the remaining sources.
        </div>
      ))}
    </div>
  );
}

function NoData() {
  return (
    <div className="empty" style={{ paddingTop: 90 }}>
      <h1>No snapshot yet</h1>
      <p className="lede" style={{ margin: "0 auto 18px" }}>
        Pull the first set of analyst insights, then reload this page.
      </p>
      <p>
        <code>npm run refresh</code>
      </p>
    </div>
  );
}

function computeMovers(
  current: ConsensusRecord[],
  previous: ConsensusRecord[],
  limit = 8,
) {
  if (!previous.length) return [];
  const before = new Map(previous.map((r) => [r.symbol, r]));
  const moves: { symbol: string; name: string; delta: number }[] = [];

  for (const record of current) {
    const prior = before.get(record.symbol);
    if (record.composite === undefined || prior?.composite === undefined) continue;
    const delta = record.composite - prior.composite;
    if (Math.abs(delta) < 0.5) continue;
    moves.push({ symbol: record.symbol, name: record.name, delta });
  }

  return moves
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
