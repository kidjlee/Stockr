"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ConsensusRecord } from "../lib/types";
import {
  ConfidenceBar,
  DeltaText,
  formatMoney,
  formatPercent,
  RatingBar,
  RatingLegend,
  Verdict,
} from "./ui";

type SortKey =
  | "rank"
  | "symbol"
  | "composite"
  | "price"
  | "targetMean"
  | "upside"
  | "bullishPct"
  | "bearishPct"
  | "buyVsSellSpread"
  | "analystCount"
  | "sources";

type KindFilter = "all" | "stock" | "etf";

const COLUMNS: { key: SortKey; label: string; numeric: boolean; title?: string }[] = [
  { key: "rank", label: "#", numeric: true },
  { key: "symbol", label: "Symbol", numeric: false },
  { key: "composite", label: "Score", numeric: true, title: "Blended analyst composite, 0–100" },
  { key: "price", label: "Price", numeric: true },
  { key: "targetMean", label: "Avg target", numeric: true, title: "Consensus mean price target" },
  { key: "upside", label: "Upside", numeric: true, title: "Avg target vs current price" },
  { key: "bullishPct", label: "Buy", numeric: true, title: "Strong Buy + Buy share of ratings" },
  { key: "bearishPct", label: "Sell", numeric: true, title: "Underperform + Sell share of ratings" },
  { key: "buyVsSellSpread", label: "Spread", numeric: true, title: "Buy share minus sell share" },
  { key: "analystCount", label: "Analysts", numeric: true },
  { key: "sources", label: "Src", numeric: true, title: "Number of independent sources" },
];

export default function RankingTable({
  records,
  sectors,
  defaultKind = "all",
}: {
  records: ConsensusRecord[];
  sectors: string[];
  defaultKind?: KindFilter;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>(defaultKind);
  const [sector, setSector] = useState("all");
  const [minAnalysts, setMinAnalysts] = useState(0);
  const [ratedOnly, setRatedOnly] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = records.filter((record) => {
      if (kind !== "all" && record.kind !== kind) return false;
      if (sector !== "all" && record.sector !== sector) return false;
      if (ratedOnly && record.composite === undefined) return false;
      if (minAnalysts > 0 && (record.analystCount ?? 0) < minAnalysts) return false;
      if (
        needle &&
        !record.symbol.toLowerCase().includes(needle) &&
        !record.name.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });

    const direction = sortDir === "asc" ? 1 : -1;
    return rows.sort((a, b) => {
      if (sortKey === "symbol") return a.symbol.localeCompare(b.symbol) * direction;
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      // Missing values always sink, regardless of direction.
      if (av === undefined && bv === undefined) return 0;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return (av - bv) * direction;
    });
  }, [records, query, kind, sector, minAnalysts, ratedOnly, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Rank and symbol read naturally ascending; every other column is
      // "biggest first".
      setSortDir(key === "rank" || key === "symbol" ? "asc" : "desc");
    }
  }

  return (
    <>
      <div className="controls">
        <input
          type="search"
          placeholder="Search symbol or name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search"
        />
        <div className="seg" role="group" aria-label="Instrument type">
          {(["all", "stock", "etf"] as KindFilter[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
            >
              {option === "all" ? "All" : option === "stock" ? "Stocks" : "ETFs"}
            </button>
          ))}
        </div>
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          aria-label="Sector"
        >
          <option value="all">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={minAnalysts}
          onChange={(e) => setMinAnalysts(Number(e.target.value))}
          aria-label="Minimum analysts"
        >
          {[0, 3, 5, 10, 15].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "Any coverage" : `${n}+ analysts`}
            </option>
          ))}
        </select>
        <label className="small dim" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={ratedOnly}
            onChange={(e) => setRatedOnly(e.target.checked)}
          />
          Rated only
        </label>
        <span className="count">{filtered.length} shown</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={`sortable${column.numeric ? " num" : ""}`}
                  title={column.title}
                  onClick={() => toggleSort(column.key)}
                >
                  {column.label}
                  {sortKey === column.key ? (
                    <span className="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>
                  ) : null}
                </th>
              ))}
              <th>Rating mix</th>
              <th>Verdict</th>
              <th title="Confidence: coverage, source breadth and agreement">Conf.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((record) => (
              <tr key={record.symbol}>
                <td className="num faint">{record.rank ?? "—"}</td>
                <td>
                  <Link href={`/stock/${encodeURIComponent(record.symbol)}`} className="sym">
                    {record.symbol}
                  </Link>
                  <div className="name">{record.name}</div>
                </td>
                <td className="num score">{record.composite?.toFixed(1) ?? "—"}</td>
                <td className="num">{formatMoney(record.price, record.currency)}</td>
                <td className="num">{formatMoney(record.targetMean, record.currency)}</td>
                <td className="num">
                  <DeltaText value={record.upside} />
                </td>
                <td className="num">{formatPercent(record.bullishPct, 0)}</td>
                <td className="num">{formatPercent(record.bearishPct, 0)}</td>
                <td className="num">
                  <DeltaText value={record.buyVsSellSpread} digits={0} />
                </td>
                <td className="num">{record.analystCount ?? "—"}</td>
                <td className="num faint">{record.sources.length || "—"}</td>
                <td>
                  <RatingBar distribution={record.distribution} />
                </td>
                <td>
                  <Verdict verdict={record.verdict} />
                </td>
                <td>
                  <ConfidenceBar value={record.confidence.overall} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <div className="empty">Nothing matches these filters.</div>
        ) : null}
      </div>
      <RatingLegend />
    </>
  );
}

function sortValue(record: ConsensusRecord, key: SortKey): number | undefined {
  switch (key) {
    case "rank":
      return record.rank;
    case "composite":
      return record.composite;
    case "price":
      return record.price;
    case "targetMean":
      return record.targetMean;
    case "upside":
      return record.upside;
    case "bullishPct":
      return record.bullishPct;
    case "bearishPct":
      return record.bearishPct;
    case "buyVsSellSpread":
      return record.buyVsSellSpread;
    case "analystCount":
      return record.analystCount;
    case "sources":
      return record.sources.length;
    default:
      return undefined;
  }
}
