import { NextResponse } from "next/server";
import { getSearchSuggestions } from "@/lib/site-search";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || "").trim();

  const payload = await getSearchSuggestions(query);

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
