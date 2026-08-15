import { ALL_PROVIDERS } from "../../providers/index";
import { loadLatest } from "../../lib/storage";
import { DEFAULT_WEIGHTS } from "../../lib/types";

export const dynamic = "force-dynamic";

export default async function MethodologyPage() {
  const snapshot = await loadLatest();
  const weights = snapshot?.scoring ?? DEFAULT_WEIGHTS;
  const runs = new Map(snapshot?.providerRuns.map((r) => [r.provider, r]) ?? []);

  return (
    <>
      <div className="page-head">
        <h1>Methodology</h1>
        <p className="lede">
          Every number on this site is somebody else&apos;s opinion, aggregated.
          This page describes exactly how those opinions are combined so you can
          judge whether the ranking means what you want it to mean.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Sources</h2>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th className="num">Weight</th>
                <th>Status</th>
                <th>What it contributes</th>
              </tr>
            </thead>
            <tbody>
              {ALL_PROVIDERS.map((provider) => {
                const run = runs.get(provider.id);
                return (
                  <tr key={provider.id}>
                    <td>
                      {provider.homepage ? (
                        <a href={provider.homepage} target="_blank" rel="noreferrer">
                          {provider.label}
                        </a>
                      ) : (
                        provider.label
                      )}
                    </td>
                    <td className="num">{provider.weight.toFixed(2)}</td>
                    <td className="small">
                      {run?.ok ? (
                        <span className="pos">{run.readings} readings</span>
                      ) : run?.enabled ? (
                        <span className="neg">failed</span>
                      ) : (
                        <span className="faint">
                          off{provider.envVar ? ` — set ${provider.envVar}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="dim small" style={{ whiteSpace: "normal", maxWidth: 460 }}>
                      {provider.description}
                      {provider.optIn ? ` Opt-in: ${provider.optIn}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Normalizing ratings</h2>
          <p className="small dim">
            Sources publish different ladders. Everything is mapped onto five
            rungs — Strong&nbsp;Buy, Buy, Hold, Underperform, Sell — weighted
            +2, +1, 0, −1, −2. The weighted mean is rescaled so an all-sell book
            is 0, an all-hold book is 50 and an all-strong-buy book is 100.
          </p>
          <ul className="tight small">
            <li>
              Yahoo and Finnhub label the fourth rung <code className="inline">sell</code>{" "}
              and the fifth <code className="inline">strongSell</code>; those map
              to Underperform and Sell respectively.
            </li>
            <li>
              TipRanks publishes only Buy / Hold / Sell. Its Buy is <em>not</em>{" "}
              promoted to Strong Buy — inventing conviction the source did not
              report would bias the blend upward.
            </li>
            <li>
              TradingView&apos;s <code className="inline">Recommend.All</code> is a{" "}
              <em>technical</em> gauge, not analyst opinion, and is deliberately
              excluded. Only its analyst count columns and price target are used.
            </li>
          </ul>
        </div>

        <div className="card">
          <h2>Blending sources</h2>
          <p className="small dim">
            Sources are treated as independent estimates of the same analyst
            book, not as separate sets of analysts. So normalized distributions
            are averaged rather than counts being summed — otherwise an analyst
            carried by three sites would be counted three times — and reported
            coverage is the largest count any single source saw.
          </p>
          <p className="small dim">
            Each source&apos;s influence is its trust weight scaled by how much
            coverage stands behind its reading, floored at 35% so a source that
            simply does not publish an analyst count still counts for something.
          </p>
          <p className="small dim">
            Price is the median across sources; a spread wider than 5% raises a
            warning, which usually means one source quoted a US cross-listing.
          </p>
        </div>

        <div className="card">
          <h2>The composite</h2>
          <p className="small dim">Three inputs, renormalized when one is missing:</p>
          <ul className="tight small">
            <li>
              <strong>Rating consensus</strong> ({(weights.consensus * 100).toFixed(0)}%)
              — the 0–100 score above.
            </li>
            <li>
              <strong>Target upside</strong> ({(weights.upside * 100).toFixed(0)}%) —
              (avg target − price) / price, squashed through a tanh at scale{" "}
              {weights.upsideScale}. So +35% upside scores about 88 and +200%
              scores about 100 rather than 300, which stops a broken micro cap
              with one stale target from topping the table.
            </li>
            <li>
              <strong>Confidence</strong> ({(weights.quality * 100).toFixed(0)}%) —
              50% analyst coverage (log-scaled against{" "}
              {weights.coverageBenchmark} analysts), 30% source breadth
              (benchmarked at {weights.breadthBenchmark} sources), 20% agreement
              between sources.
            </li>
          </ul>
          <p className="small dim">
            The result is then pulled toward 50 in proportion to how little
            confidence there is, by up to {(weights.shrinkage * 100).toFixed(0)}%.
            A thinly covered name has to be genuinely well liked to outrank a
            widely covered one.
          </p>
        </div>

        <div className="card">
          <h2>ETFs</h2>
          <p className="small dim">
            No analyst rates an index fund. Each ETF is scored by looking through
            to its holdings: positions that are in the tracked universe are
            scored individually and rolled up by fund weight. Yahoo publishes
            roughly the top ten holdings, so coverage is partial and directly
            caps the fund&apos;s confidence — a fund where 45% of weight was
            scored is a 45%-informed opinion.
          </p>
          <p className="small dim">
            Funds holding non-Canadian or unrated positions score on whatever
            part of the basket is visible, and say so on their page.
          </p>
        </div>

        <div className="card">
          <h2>Known limits</h2>
          <ul className="tight small">
            <li>
              Analyst targets are typically 12-month and are revised in clusters
              after earnings; a high upside often just means the price fell
              before the targets did.
            </li>
            <li>
              Consensus is a lagging, herding indicator. It is not a forecast.
            </li>
            <li>
              Aggregators disagree about who counts as a covering analyst, which
              is why source agreement is scored rather than assumed.
            </li>
            <li>
              Small caps with two analysts produce noisy scores. Use the
              minimum-analyst filter on the rankings table.
            </li>
          </ul>
        </div>

        <div className="card">
          <h2>Refresh cadence</h2>
          <p className="small dim">
            <code className="inline">npm run refresh</code> writes one snapshot per
            Toronto trading day under <code className="inline">data/snapshots/</code>.
            Re-running on the same day overwrites that day&apos;s file. History on
            each instrument page is read straight from those files.
          </p>
          <p className="small dim">
            Scheduling options are in the README: a GitHub Actions workflow that
            commits the snapshot, a cron entry, or a POST to{" "}
            <code className="inline">/api/refresh</code>.
          </p>
        </div>
      </div>

      <div className="footer">
        Stockr aggregates third-party analyst opinion for research. It is not
        investment advice, and no output should be treated as a recommendation to
        buy or sell anything.
      </div>
    </>
  );
}
