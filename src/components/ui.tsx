import {
  RATING_BUCKETS,
  RATING_LABELS,
  type RatingBucket,
  type RatingCounts,
} from "../lib/types";

export function formatMoney(value: number | undefined, currency = "CAD") {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const symbol = currency === "USD" ? "US$" : "$";
  return `${symbol}${value.toFixed(2)}`;
}

export function formatPercent(value: number | undefined, digits = 1) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatSignedPercent(value: number | undefined, digits = 1) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

export function verdictClass(verdict: string) {
  return `verdict v-${verdict.toLowerCase().replace(/\s+/g, "-")}`;
}

export function Verdict({ verdict }: { verdict: string }) {
  return <span className={verdictClass(verdict)}>{verdict}</span>;
}

export function DeltaText({
  value,
  digits = 1,
}: {
  value: number | undefined;
  digits?: number;
}) {
  if (value === undefined || !Number.isFinite(value)) {
    return <span className="faint">—</span>;
  }
  return (
    <span className={value >= 0 ? "pos" : "neg"}>
      {formatSignedPercent(value, digits)}
    </span>
  );
}

/**
 * Stacked bar showing the blended rating distribution. Takes fractions
 * (summing to 1) or raw counts — both are normalized here.
 */
export function RatingBar({
  distribution,
  large = false,
}: {
  distribution: Record<RatingBucket, number> | RatingCounts | undefined;
  large?: boolean;
}) {
  if (!distribution) {
    return <span className="faint small">no ratings</span>;
  }
  const total = RATING_BUCKETS.reduce((sum, b) => sum + (distribution[b] || 0), 0);
  if (total <= 0) return <span className="faint small">no ratings</span>;

  const title = RATING_BUCKETS.filter((b) => distribution[b] > 0)
    .map((b) => `${RATING_LABELS[b]} ${((distribution[b] / total) * 100).toFixed(0)}%`)
    .join(" · ");

  return (
    <span className={large ? "ratingbar ratingbar-lg" : "ratingbar"} title={title}>
      {RATING_BUCKETS.map((bucket) => {
        const share = (distribution[bucket] || 0) / total;
        if (share <= 0) return null;
        return (
          <span
            key={bucket}
            className={`b-${bucket}`}
            style={{ width: `${share * 100}%` }}
          />
        );
      })}
    </span>
  );
}

export function RatingLegend() {
  return (
    <div className="legend">
      {RATING_BUCKETS.map((bucket) => (
        <span key={bucket}>
          <i className={`b-${bucket}`} style={{ background: bucketColor(bucket) }} />
          {RATING_LABELS[bucket]}
        </span>
      ))}
    </div>
  );
}

function bucketColor(bucket: RatingBucket) {
  return {
    strongBuy: "var(--strong-buy)",
    buy: "var(--buy)",
    hold: "var(--hold)",
    underperform: "var(--underperform)",
    sell: "var(--sell)",
  }[bucket];
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ""}`}>{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  return (
    <span title={`${(value * 100).toFixed(0)}% confidence`}>
      <span className="confbar">
        <span style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
    </span>
  );
}
