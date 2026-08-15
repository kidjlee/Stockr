import type { Metadata } from "next";
import Link from "next/link";
import { loadLatest } from "../lib/storage";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stockr — TSX analyst consensus rankings",
  description:
    "Ranks TSX / TSXV stocks and Canadian ETFs by blended analyst consensus and price-target upside.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const snapshot = await loadLatest();

  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              Stock<span>r</span>
            </Link>
            <nav className="nav">
              <Link href="/">Rankings</Link>
              <Link href="/etfs">ETFs</Link>
              <Link href="/methodology">Methodology</Link>
            </nav>
            <div className="topbar-meta">
              {snapshot
                ? `updated ${snapshot.date} · ${snapshot.records.length} tracked`
                : "no data yet"}
            </div>
          </div>
        </header>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
