import { NextResponse } from "next/server";
import { getStockByCode } from "@/lib/server/stock-catalog";
import { fetchStockKlineWithFallback, type KlinePeriod } from "@/lib/stocks-kline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PERIODS: KlinePeriod[] = ["intraday", "five_day", "day", "week", "month", "quarter", "year"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get("code") || "").trim();
  const periodParam = (searchParams.get("period") || "day").trim();
  const period = PERIODS.includes(periodParam as KlinePeriod) ? (periodParam as KlinePeriod) : "day";
  const fetchedAt = new Date().toISOString();

  if (!code) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing-code",
        fetchedAt,
        period,
        points: []
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const stock = await getStockByCode(code);
  if (!stock) {
    return NextResponse.json(
      {
        ok: false,
        error: "unknown-code",
        fetchedAt,
        period,
        points: []
      },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const result = await fetchStockKlineWithFallback(stock, period);
    return NextResponse.json(
      {
        ok: true,
        fetchedAt,
        code: stock.code,
        period,
        source: result.source,
        points: result.points
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        fetchedAt,
        code: stock.code,
        period,
        error: error instanceof Error ? error.message : "kline-fetch-error",
        points: []
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
