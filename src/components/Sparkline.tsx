import type { HistoryPoint } from "../lib/storage";

/**
 * Two-series sparkline: price vs consensus mean target over the snapshots we
 * have. Rendered as inline SVG on the server — no charting dependency.
 */
export default function Sparkline({ points }: { points: HistoryPoint[] }) {
  const usable = points.filter(
    (p) => p.price !== undefined || p.targetMean !== undefined,
  );
  if (usable.length < 2) {
    return (
      <p className="small faint">
        Needs at least two daily snapshots to draw history — {usable.length} so far.
      </p>
    );
  }

  const width = 640;
  const height = 120;
  const padY = 10;

  const values = usable.flatMap((p) =>
    [p.price, p.targetMean].filter((v): v is number => v !== undefined),
  );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const x = (index: number) =>
    (index / (usable.length - 1)) * (width - 2) + 1;
  const y = (value: number) =>
    height - padY - ((value - min) / span) * (height - padY * 2);

  const line = (pick: (p: HistoryPoint) => number | undefined) => {
    const segments: string[] = [];
    let open = false;
    usable.forEach((point, index) => {
      const value = pick(point);
      if (value === undefined) {
        open = false;
        return;
      }
      segments.push(`${open ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`);
      open = true;
    });
    return segments.join(" ");
  };

  return (
    <>
      <svg
        className="spark"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Price and consensus target history"
      >
        <path d={line((p) => p.targetMean)} stroke="var(--accent)" strokeDasharray="4 3" />
        <path d={line((p) => p.price)} stroke="var(--text)" />
      </svg>
      <div className="legend">
        <span>
          <i style={{ background: "var(--text)" }} />
          Price
        </span>
        <span>
          <i style={{ background: "var(--accent)" }} />
          Avg target
        </span>
        <span className="faint">
          {usable[0].date} → {usable.at(-1)!.date}
        </span>
      </div>
    </>
  );
}
