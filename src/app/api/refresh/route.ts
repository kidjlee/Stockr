import { NextResponse } from "next/server";
import { runRefresh } from "../../../lib/pipeline";
import { saveSnapshot } from "../../../lib/storage";

export const dynamic = "force-dynamic";
// A full refresh across every provider takes minutes, not seconds.
export const maxDuration = 300;

/**
 * Trigger a refresh over HTTP so a hosted scheduler (Vercel Cron, Cloud
 * Scheduler, an uptime pinger) can drive the daily update.
 *
 * Requires `REFRESH_TOKEN` to be set, and the caller to present it as
 * `Authorization: Bearer <token>` or `?token=`. Without the env var the route
 * refuses to run at all rather than defaulting to open — an unauthenticated
 * endpoint here is a free way for anyone to burn your API quota.
 */
export async function POST(request: Request) {
  const expected = process.env.REFRESH_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json(
      {
        error:
          "REFRESH_TOKEN is not set. Set it in the environment to enable HTTP-triggered refreshes.",
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  const supplied = bearer || url.searchParams.get("token") || "";

  if (!timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logs: string[] = [];
  try {
    const snapshot = await runRefresh({
      only: splitParam(url.searchParams.get("only")),
      symbols: splitParam(url.searchParams.get("symbols")),
      limit: numberParam(url.searchParams.get("limit")),
      log: (message) => logs.push(message),
    });

    const file = await saveSnapshot(snapshot);
    return NextResponse.json({
      ok: true,
      date: snapshot.date,
      file,
      universeSize: snapshot.universeSize,
      scored: snapshot.records.filter((r) => r.composite !== undefined).length,
      providers: snapshot.providerRuns,
      logs,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        logs,
      },
      { status: 500 },
    );
  }
}

/** Vercel Cron issues GETs, so accept those too. */
export async function GET(request: Request) {
  return await POST(request);
}

function splitParam(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

function numberParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Constant-time compare so the token cannot be guessed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
