# Stockr

Ranks TSX / TSXV listings and Canadian ETFs by **analyst consensus** — how the
sell side splits between Strong Buy / Buy and Underperform / Sell, and how far
the average price target sits above or below where the stock trades now.

Pull fresh insights once a day, get a ranked table.

```bash
npm install
npm run refresh     # pull analyst data, write today's snapshot
npm run dev         # http://localhost:3000
```

---

## What it does

- **Blends several analyst sources** into one 0–100 score per instrument, rather
  than trusting any single site's consensus.
- **Shows buy vs sell explicitly** — the share of Strong Buy + Buy against
  Underperform + Sell, and the spread between them, as a first-class column.
- **Compares average target to current price** on every row, with the full
  low/mean/high target range on the detail page.
- **Ranks ETFs too**, by looking through to their holdings (no analyst rates an
  index fund directly).
- **Keeps history** — one snapshot per trading day, so you can see a score, a
  target or a rating mix move over time.
- **Refreshes daily** by cron, GitHub Actions, or an HTTP call.

### Pages

| Route | What's there |
| --- | --- |
| `/` | Ranked table — sort by any column, filter by type, sector, analyst count |
| `/stock/[symbol]` | Per-source breakdown, target-range gauge, rating mix, history |
| `/etfs` | ETFs with look-through coverage |
| `/methodology` | Exactly how the score is built, and where it breaks down |
| `/api/rankings` | The rankings as JSON |
| `/api/refresh` | Token-protected refresh trigger |

---

## Sources

| Source | Status | What it gives |
| --- | --- | --- |
| **Yahoo Finance** | On, no key | Full five-rung rating distribution, mean/high/low targets, analyst counts, ETF holdings |
| **TradingView** | On, no key | Rating ladder, average target and estimate count — whole universe in one request |
| **Manual entry** | On, reads `data/manual-ratings.csv` | Numbers you transcribe from anywhere |
| **Finnhub** | Set `FINNHUB_API_KEY` | Independent rating distribution, price targets on paid tiers |
| **Financial Modeling Prep** | Set `FMP_API_KEY` | Sell-side grades and target consensus |
| **TipRanks** | Set `TIPRANKS_ENABLED=1` | Buy / Hold / Sell ladder and its own target consensus |

Copy `.env.example` to `.env` to add keys. Both keyed sources have free tiers.

A source that fails is skipped with a warning on the dashboard — the blend just
narrows. A refresh never dies because one site is down.

### MarketWatch, CNN, The Globe and Mail

You asked for these specifically, so here's the straight answer: they are not
fetched automatically, and I would not recommend making them so. All three
serve analyst data through bot-protected pages whose terms prohibit automated
collection, and scrapers against them break constantly. Rather than ship
adapters that quietly return nothing, there are two honest routes:

1. **Financial Modeling Prep** aggregates the same syndicated sell-side grades
   those portals display. Adding `FMP_API_KEY` covers most of what you'd get
   from scraping them, through a supported API.
2. **`data/manual-ratings.csv`** — read the numbers off the page and type them
   in. They blend in as a full-weight source, carry the source name into the UI,
   and expire after 45 days so stale hand-entered figures can't quietly sit at
   the top of the ranking forever.

```csv
symbol,source,strongBuy,buy,hold,underperform,sell,targetMean,targetHigh,targetLow,analysts,asOf,url,note
RY.TO,MarketWatch,4,6,2,0,0,195.50,215.00,175.00,12,2026-08-14,https://…,
ENB.TO,The Globe and Mail,3,8,5,1,0,64.25,72.00,55.00,17,2026-08-14,,
```

If you do want a live adapter for one of them, `src/providers/` is the place —
implement the `Provider` interface (about 30 lines, see `tipranks.ts` for the
shape) and add it to `ALL_PROVIDERS`.

---

## How the ranking works

Full detail lives at `/methodology` in the running app. The short version:

**1. Normalize.** Every source is mapped onto five rungs — Strong Buy, Buy,
Hold, Underperform, Sell — weighted +2, +1, 0, −1, −2. The weighted mean is
rescaled so an all-sell book scores 0, all-hold 50, all-strong-buy 100.

Yahoo and Finnhub label the fourth rung `sell` and the fifth `strongSell`, so
those map to Underperform and Sell. TipRanks publishes only three rungs and its
Buy is *not* promoted to Strong Buy. TradingView's `Recommend.All` is a
technical gauge, not analyst opinion, and is deliberately excluded.

**2. Blend.** Sources are treated as independent estimates of the *same* analyst
book, not as separate sets of analysts — so normalized distributions are
averaged rather than counts summed, and reported coverage is the largest count
any one source saw. Otherwise an analyst carried by three sites gets three
votes. Each source's influence scales with the coverage behind its reading, so a
25-analyst book outweighs a 1-analyst one by roughly 12×.

**3. Score.** Three inputs:

- **Rating consensus** (45%)
- **Target upside** (35%) — `(avg target − price) / price`, squashed through a
  tanh so +35% scores ~88 and +300% scores ~100 rather than running away with
  the table
- **Confidence** (20%) — analyst coverage, number of sources, and how much they
  agree

The result is pulled toward 50 in proportion to how little confidence there is.
A thinly covered name has to be genuinely well liked to outrank a widely
covered one.

**4. ETFs.** Scored by looking through to holdings: each position in the tracked
universe is scored on its own consensus, then rolled up by fund weight. Yahoo
publishes roughly the top ten holdings, so coverage is partial — and it caps the
fund's confidence directly. A fund where 45% of weight was scored is a
45%-informed opinion, and the page says so.

Weights live in `DEFAULT_WEIGHTS` in `src/lib/types.ts` if you want to retune.

### What it is not

Analyst consensus is a lagging, herding indicator, and 12-month targets get
revised in clusters after earnings — a big upside number often just means the
price fell before the targets did. This ranks opinion, not companies. It is not
investment advice.

---

## Daily refresh

Pick whichever fits how you're running it.

**GitHub Actions** (included) — `.github/workflows/daily-refresh.yml` runs at
21:30 UTC on weekdays, commits the snapshot back to the repo, and refuses to
commit a run that scored fewer than 20 instruments so a bad night can't wipe out
a good snapshot. Add `FINNHUB_API_KEY` / `FMP_API_KEY` as repo secrets if you
want those sources.

**Cron on a box you control:**

```cron
30 17 * * 1-5 cd /path/to/Stockr && /usr/bin/npm run refresh >> refresh.log 2>&1
```

**HTTP** — set `REFRESH_TOKEN` and point any scheduler at the endpoint:

```bash
curl -X POST -H "Authorization: Bearer $REFRESH_TOKEN" https://your-app/api/refresh
```

Without `REFRESH_TOKEN` set, the route returns 503 rather than defaulting to
open. On Vercel, add a `vercel.json` cron hitting the same path — note that the
filesystem is read-only there, so snapshots must come from the Actions workflow
committing them into the repo.

---

## Commands

```bash
npm run refresh                              # full refresh, writes a snapshot
npm run refresh -- --limit 25                # first 25 instruments only
npm run refresh -- --only yahoo,tradingview  # specific sources
npm run refresh -- --symbols RY.TO,ENB.TO --dry-run
npm run universe:refresh                     # rebuild the tracked list from TradingView
npm run probe -- yahoo RY.TO                 # see exactly what one source returns
npm run probe -- tradingview --raw           # dump TradingView's columns verbatim
npm test                                     # scoring + normalization tests
npm run typecheck
```

A full refresh of ~240 instruments takes a few minutes, most of it Yahoo's
per-symbol requests.

---

## The tracked universe

`config/universe.json` ships with 241 curated entries — 192 TSX/TSXV stocks
across every sector plus 49 Canadian ETFs. Tickers change (companies get taken
private, ratios change, listings move), so rebuild it from live data whenever it
drifts:

```bash
npm run universe:refresh -- --stocks 300 --funds 80
```

Symbols that no longer exist are simply skipped with a warning at refresh time.

---

## Layout

```
config/universe.json     tracked stocks and ETFs
data/snapshots/          one JSON file per trading day (minified)
data/latest.json         most recent snapshot, read by the UI
data/manual-ratings.csv  hand-entered analyst numbers
src/providers/           one file per source, all behind a common interface
src/lib/score.ts         pure scoring maths — fully unit tested
src/lib/aggregate.ts     multi-source blending
src/lib/etf.ts           ETF look-through
src/lib/pipeline.ts      universe → sources → score → rank
src/cli/                 refresh, probe, universe rebuild
src/app/                 Next.js dashboard
```

Snapshots are about 300 KB a day. If a few years of history gets unwieldy,
thinning old files is safe — the UI reads whatever is on disk:

```bash
find data/snapshots -name '2024-*.json' ! -name '*-01.json' -delete
```

## Troubleshooting

**A source returns nothing.** `npm run probe -- <source> RY.TO` prints the raw
response. Sites rename fields; TradingView especially. Column names for it are
in `TV_COLUMNS` in `src/providers/tradingview.ts`, and the provider falls back
to price-only rather than failing if a column is rejected.

**Yahoo returns 401 / invalid crumb.** Yahoo's cookie handshake occasionally
needs a retry from a fresh IP; `yahoo-finance2` handles the crumb itself, so try
the refresh again before changing anything.

**Everything scores 50.** No source returned ratings, so only the confidence
term survived. Check the dashboard banner and the `providerRuns` block in
`data/latest.json`.
