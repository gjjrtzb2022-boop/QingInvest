import { NextResponse } from "next/server";
import {
  getStockCatalog,
  getStockCatalogByCodes,
  getStockCatalogSummary,
  searchStockCatalog
} from "@/lib/server/stock-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fetchedAt = new Date().toISOString();
  const codes = (searchParams.get("codes") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const query = (searchParams.get("q") || "").trim();
  const limitParam = Number(searchParams.get("limit") || "0");
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 6000) : null;

  try {
    const [summary, stocks] = await Promise.all([
      getStockCatalogSummary(),
      codes.length > 0 ? getStockCatalogByCodes(codes) : query ? searchStockCatalog(query, limit ?? 20) : getStockCatalog()
    ]);

    const payloadStocks = limit ? stocks.slice(0, limit) : stocks;

    return NextResponse.json(
      {
        ok: true,
        fetchedAt,
        total: summary.total,
        exchangeCounts: summary.exchangeCounts,
        industries: summary.industries,
        complete: payloadStocks.length >= summary.total,
        stocks: payloadStocks
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
        total: 0,
        exchangeCounts: { SH: 0, SZ: 0, BJ: 0 },
        industries: [],
        stocks: [],
        error: error instanceof Error ? error.message : "stock-catalog-error"
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
