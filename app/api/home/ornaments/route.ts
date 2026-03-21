import { NextResponse } from "next/server";
import { getHomeOrnamentsPayload } from "@/lib/server/home-ornaments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await getHomeOrnamentsPayload();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "home-ornaments-error";
    return NextResponse.json(
      {
        ok: false,
        error: message
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
