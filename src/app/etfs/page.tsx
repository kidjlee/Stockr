import Link from "next/link";
import RankingTable from "../../components/RankingTable";
import { formatPercent, Stat } from "../../components/ui";
import { loadLatest } from "../../lib/storage";

export const dynamic = "force-dynamic";

export default async function EtfPage() {
  const snapshot = await loadLatest();
  if (!snapshot) {
    return (
      <div className="empty" style={{ paddingTop: 90 }}>
        <h1>No snapshot yet</h1>
        <p>
          Run <code>npm run refresh</code> first.
        </p>
      </div>
    );
  }

  const etfs = snapshot.records.filter((r) => r.kind === "etf");
  const scored = etfs.filter((r) => r.composite !== undefined);
  const withLookThrough = etfs.filter((r) => r.lookThrough);
  const avgCoverage =
    withLookThrough.length > 0
      ? withLookThrough.reduce((sum, r) => sum + (r.lookThrough?.coverage ?? 0), 0) /
        withLookThrough.length
      : undefined;

  return (
    <>
      <div className="page-head">
        <h1>Canadian ETFs</h1>
        <p className="lede">
          Analysts do not rate ETFs, so each fund is scored by looking through to
          its holdings: every position we can identify is scored on its own
          analyst consensus, then rolled up by fund weight. Coverage is partial by
          construction — Yahoo publishes roughly the top ten positions — so
          confidence is capped at the share of the fund we can actually see.
        </p>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="ETFs tracked" value={etfs.length} />
        <Stat
          label="Scored"
          value={scored.length}
          sub={`${etfs.length - scored.length} without usable holdings`}
        />
        <Stat
          label="Avg look-through coverage"
          value={formatPercent(avgCoverage, 0)}
          sub="Share of fund weight scored"
        />
        <Stat
          label="Best scoring"
          value={scored[0] ? scored[0].symbol : "—"}
          sub={scored[0]?.name}
        />
      </div>

      <RankingTable
        records={snapshot.records}
        sectors={[]}
        defaultKind="etf"
      />

      <div className="footer">
        A look-through score describes the analyst view of what the fund holds. It
        says nothing about fees, tracking error, liquidity or distribution policy.
        See <Link href="/methodology">methodology</Link>.
      </div>
    </>
  );
}
