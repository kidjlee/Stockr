import Link from "next/link";
import { notFound } from "next/navigation";
import Sparkline from "../../../components/Sparkline";
import {
  ConfidenceBar,
  DeltaText,
  formatMoney,
  formatPercent,
  RatingBar,
  RatingLegend,
  Stat,
  Verdict,
} from "../../../components/ui";
import { loadHistory, loadLatest } from "../../../lib/storage";
import { RATING_BUCKETS, RATING_LABELS } from "../../../lib/types";

export const dynamic = "force-dynamic";

export default async function StockPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const wanted = decodeURIComponent(symbol).toUpperCase();

  const snapshot = await loadLatest();
  const record = snapshot?.records.find((r) => r.symbol === wanted);
  if (!record) notFound();

  const history = await loadHistory(record.symbol);
  const currency = record.currency ?? "CAD";
  // Hoisted so the narrowing survives into the map callback below.
  const distribution = record.distribution;

  return (
    <>
      <div className="page-head">
        <div className="small dim" style={{ marginBottom: 6 }}>
          <Link href="/">← All rankings</Link>
        </div>
        <h1>
          <span className="mono">{record.symbol}</span>{" "}
          <span className="dim" style={{ fontWeight: 400 }}>
            {record.name}
          </span>
        </h1>
        <div className="small">
          <span className="pill">{record.exchange}</span>
          <span className="pill">{record.kind === "etf" ? "ETF" : "Stock"}</span>
          {record.sector ? <span className="pill">{record.sector}</span> : null}
          {record.rank ? <span className="pill">rank #{record.rank}</span> : null}
        </div>
      </div>

      {record.warnings?.map((warning) => (
        <div className="warn" key={warning}>
          {warning}
        </div>
      ))}

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat
          label="Composite score"
          value={record.composite?.toFixed(1) ?? "—"}
          sub={<Verdict verdict={record.verdict} />}
        />
        <Stat
          label="Price"
          value={formatMoney(record.price, currency)}
          sub={`${record.analystCount ?? 0} analyst(s) · ${record.sources.length} source(s)`}
        />
        <Stat
          label="Average target"
          value={formatMoney(record.targetMean, currency)}
          sub={
            record.targetLow && record.targetHigh
              ? `range ${formatMoney(record.targetLow, currency)} – ${formatMoney(record.targetHigh, currency)}`
              : "no target range reported"
          }
        />
        <Stat
          label="Upside to target"
          value={<DeltaText value={record.upside} />}
          sub="Avg target vs last price"
        />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <h3>Buy vs sell</h3>
          {distribution ? (
            <>
              <RatingBar distribution={distribution} large />
              <RatingLegend />
              <table style={{ marginTop: 14 }}>
                <tbody>
                  {RATING_BUCKETS.map((bucket) => (
                    <tr key={bucket}>
                      <td style={{ borderBottom: 0, padding: "3px 0" }}>
                        {RATING_LABELS[bucket]}
                      </td>
                      <td
                        className="num"
                        style={{ borderBottom: 0, padding: "3px 0" }}
                      >
                        {formatPercent(distribution[bucket], 0)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ padding: "8px 0 0", borderBottom: 0 }}>
                      <strong>Buy − Sell spread</strong>
                    </td>
                    <td className="num" style={{ padding: "8px 0 0", borderBottom: 0 }}>
                      <DeltaText value={record.buyVsSellSpread} digits={0} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          ) : (
            <p className="small faint">
              No rating distribution published for this instrument.
            </p>
          )}
        </div>

        <div className="card">
          <h3>Price vs target range</h3>
          <TargetGauge record={record} />
          <h3 style={{ marginTop: 20 }}>Score breakdown</h3>
          <table>
            <tbody>
              <ScoreRow label="Rating consensus" value={record.consensusScore} />
              <ScoreRow label="Target upside" value={record.upsideScore} />
              <tr>
                <td style={{ borderBottom: 0, padding: "3px 0" }}>Confidence</td>
                <td className="num" style={{ borderBottom: 0, padding: "3px 0" }}>
                  <ConfidenceBar value={record.confidence.overall} />{" "}
                  {(record.confidence.overall * 100).toFixed(0)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="small faint" style={{ marginTop: 10 }}>
            Coverage {(record.confidence.coverage * 100).toFixed(0)}% · breadth{" "}
            {(record.confidence.breadth * 100).toFixed(0)}% · source agreement{" "}
            {(record.confidence.agreement * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>What each source says</h2>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th className="num">Score</th>
                <th>Their label</th>
                <th className="num">Analysts</th>
                <th className="num">Price</th>
                <th className="num">Avg target</th>
                <th className="num">Upside</th>
                <th>Rating mix</th>
                <th className="num">Blend weight</th>
              </tr>
            </thead>
            <tbody>
              {record.providers.map((provider) => (
                <tr key={provider.provider}>
                  <td>
                    {provider.sourceUrl ? (
                      <a href={provider.sourceUrl} target="_blank" rel="noreferrer">
                        {provider.label}
                      </a>
                    ) : (
                      provider.label
                    )}
                    {provider.note ? (
                      <div className="name" title={provider.note}>
                        {provider.note}
                      </div>
                    ) : null}
                  </td>
                  <td className="num score">
                    {provider.consensusScore?.toFixed(1) ?? "—"}
                  </td>
                  <td className="dim small">{provider.consensusLabel ?? "—"}</td>
                  <td className="num">{provider.analystCount ?? "—"}</td>
                  <td className="num">{formatMoney(provider.price, currency)}</td>
                  <td className="num">{formatMoney(provider.targetMean, currency)}</td>
                  <td className="num">
                    <DeltaText value={provider.upside} />
                  </td>
                  <td>
                    <RatingBar distribution={provider.counts} />
                  </td>
                  <td className="num faint">{provider.weight.toFixed(2)}</td>
                </tr>
              ))}
              {record.providers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="faint">
                    No source returned analyst data for this instrument.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {record.lookThrough ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2>Look-through holdings</h2>
          <p className="small dim">
            ETFs are not rated by analysts. This score is the weighted average of
            the analyst scores of the holdings we can see —{" "}
            {formatPercent(record.lookThrough.coverage, 0)} of fund weight.
          </p>
          <table>
            <thead>
              <tr>
                <th>Holding</th>
                <th className="num">Fund weight</th>
                <th className="num">Score</th>
                <th className="num">Upside</th>
              </tr>
            </thead>
            <tbody>
              {record.lookThrough.holdings.map((holding) => (
                <tr key={holding.symbol}>
                  <td>
                    <span className="sym">{holding.symbol}</span>
                    <div className="name">{holding.name}</div>
                  </td>
                  <td className="num">{formatPercent(holding.weight, 2)}</td>
                  <td className="num score">{holding.composite?.toFixed(1) ?? "—"}</td>
                  <td className="num">
                    <DeltaText value={holding.upside} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="card">
        <h2>History</h2>
        <Sparkline points={history} />
      </div>

      <div className="footer">
        Analyst opinion aggregated from third parties. Not investment advice.
      </div>
    </>
  );
}

function ScoreRow({ label, value }: { label: string; value: number | undefined }) {
  return (
    <tr>
      <td style={{ borderBottom: 0, padding: "3px 0" }}>{label}</td>
      <td className="num" style={{ borderBottom: 0, padding: "3px 0" }}>
        {value?.toFixed(1) ?? "—"}
      </td>
    </tr>
  );
}

/**
 * Places the current price and the mean target on the low→high target range so
 * you can see at a glance whether the street's floor is already above spot.
 */
function TargetGauge({
  record,
}: {
  record: {
    price?: number;
    targetLow?: number;
    targetHigh?: number;
    targetMean?: number;
    currency?: string;
  };
}) {
  const { price, targetLow, targetHigh, targetMean } = record;
  const currency = record.currency ?? "CAD";
  const points = [price, targetLow, targetHigh, targetMean].filter(
    (v): v is number => v !== undefined,
  );
  if (points.length < 2) {
    return <p className="small faint">Not enough target data to plot a range.</p>;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pos = (value: number) => `${(((value - min) / span) * 96 + 2).toFixed(1)}%`;

  return (
    <>
      <div className="gauge">
        <div className="gauge-track" />
        {price !== undefined ? (
          <>
            <div className="gauge-mark" style={{ left: pos(price) }} />
            <div className="gauge-tip" style={{ left: pos(price) }}>
              now {formatMoney(price, currency)}
            </div>
          </>
        ) : null}
        {targetMean !== undefined ? (
          <>
            <div className="gauge-mark target" style={{ left: pos(targetMean) }} />
            <div
              className="gauge-tip"
              style={{ left: pos(targetMean), top: 30, color: "var(--accent)" }}
            >
              avg {formatMoney(targetMean, currency)}
            </div>
          </>
        ) : null}
      </div>
      <div className="small faint" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{formatMoney(min, currency)}</span>
        <span>{formatMoney(max, currency)}</span>
      </div>
    </>
  );
}
