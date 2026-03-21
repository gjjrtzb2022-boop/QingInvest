import { NextResponse } from "next/server";
import { getStockDetail } from "@/lib/server/stock-detail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get("code") || "").trim();
  const fetchedAt = new Date().toISOString();

  if (!code) {
    return NextResponse.json(
      {
        ok: false,
        code: "",
        fetchedAt,
        stock: null,
        latestReports: [],
        reportTimeline: [],
        recentAnnouncements: [],
        error: "missing-code"
      },
      {
        status: 400,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }

  const payload = await getStockDetail(code);
  return NextResponse.json(
    {
      ...payload,
      fetchedAt
    },
    {
      status: payload.ok ? 200 : 404,
      headers: { "Cache-Control": "no-store" }
    }
  );
}
