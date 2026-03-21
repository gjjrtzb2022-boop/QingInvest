import { NextResponse } from "next/server";
import { getDefaultRealtimeStocks, getStockCatalogByCodes } from "@/lib/server/stock-catalog";
import { fetchLiveQuotesWithFallback } from "@/lib/stocks-live";
import type { LiveSource } from "@/lib/stocks-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProviderStats = Record<LiveSource, { success: number; fail: number }>;

type MonitorState = {
  currentSource: LiveSource | "mixed" | null;
  lastSwitchAt: string | null;
  lastFetchAt: string | null;
  requestCount: number;
  successCount: number;
  failCount: number;
  providerStats: ProviderStats;
  lastError: string | null;
};

const monitorState: MonitorState = {
  currentSource: null,
  lastSwitchAt: null,
  lastFetchAt: null,
  requestCount: 0,
  successCount: 0,
  failCount: 0,
  providerStats: createProviderStats(),
  lastError: null
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fetchedAt = new Date().toISOString();
  const codes = (searchParams.get("codes") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const targetStocks = codes.length > 0 ? await getStockCatalogByCodes(codes) : await getDefaultRealtimeStocks(24);

  if (targetStocks.length === 0) {
    return NextResponse.json(
      {
        ok: true,
        source: "mixed",
        sourcesUsed: [],
        providerErrors: {},
        coverage: {
          received: 0,
          total: 0
        },
        fetchedAt,
        monitor: snapshotMonitor(),
        quotes: []
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }

  try {
    const live = await fetchLiveQuotesWithFallback(targetStocks);
    markMonitorSuccess(live.activeSource, live.sourcesUsed, live.errors, fetchedAt);
    return NextResponse.json(
      {
        ok: true,
        source: live.activeSource,
        sourcesUsed: live.sourcesUsed,
        providerErrors: live.errors,
        coverage: {
          received: live.quotes.size,
          total: targetStocks.length
        },
        fetchedAt,
        monitor: snapshotMonitor(),
        quotes: Array.from(live.quotes.values())
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "live-quote-error";
    markMonitorFailure(parseProviderErrorsFromMessage(message), message, fetchedAt);
    return NextResponse.json(
      {
        ok: false,
        source: "mixed",
        sourcesUsed: [],
        providerErrors: {},
        coverage: {
          received: 0,
          total: targetStocks.length
        },
        fetchedAt,
        monitor: snapshotMonitor(),
        error: message,
        quotes: []
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

function createProviderStats(): ProviderStats {
  return {
    tencent: { success: 0, fail: 0 },
    eastmoney: { success: 0, fail: 0 },
    sina: { success: 0, fail: 0 },
    akshare: { success: 0, fail: 0 }
  };
}

function snapshotMonitor() {
  return {
    currentSource: monitorState.currentSource,
    lastSwitchAt: monitorState.lastSwitchAt,
    lastFetchAt: monitorState.lastFetchAt,
    requestCount: monitorState.requestCount,
    successCount: monitorState.successCount,
    failCount: monitorState.failCount,
    providerStats: {
      tencent: { ...monitorState.providerStats.tencent },
      eastmoney: { ...monitorState.providerStats.eastmoney },
      sina: { ...monitorState.providerStats.sina },
      akshare: { ...monitorState.providerStats.akshare }
    },
    lastError: monitorState.lastError
  };
}

function markMonitorSuccess(
  activeSource: LiveSource | "mixed",
  sourcesUsed: LiveSource[],
  errors: Partial<Record<LiveSource, string>>,
  fetchedAt: string
) {
  monitorState.requestCount += 1;
  monitorState.successCount += 1;
  monitorState.lastFetchAt = fetchedAt;
  monitorState.lastError = null;

  if (monitorState.currentSource !== activeSource) {
    monitorState.lastSwitchAt = fetchedAt;
    monitorState.currentSource = activeSource;
  }

  for (const source of sourcesUsed) {
    monitorState.providerStats[source].success += 1;
  }

  for (const [source, message] of Object.entries(errors)) {
    if (!message) continue;
    const typedSource = source as LiveSource;
    monitorState.providerStats[typedSource].fail += 1;
  }
}

function markMonitorFailure(errors: Partial<Record<LiveSource, string>>, message: string, fetchedAt: string) {
  monitorState.requestCount += 1;
  monitorState.failCount += 1;
  monitorState.lastFetchAt = fetchedAt;
  monitorState.lastError = message;

  for (const [source, detail] of Object.entries(errors)) {
    if (!detail) continue;
    const typedSource = source as LiveSource;
    monitorState.providerStats[typedSource].fail += 1;
  }
}

function parseProviderErrorsFromMessage(message: string): Partial<Record<LiveSource, string>> {
  const output: Partial<Record<LiveSource, string>> = {};
  const marker = "all-live-providers-failed:";
  const index = message.indexOf(marker);
  if (index === -1) return output;

  const pairs = message
    .slice(index + marker.length)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const equalIndex = pair.indexOf("=");
    if (equalIndex === -1) continue;
    const source = pair.slice(0, equalIndex).trim() as LiveSource;
    const detail = pair.slice(equalIndex + 1).trim();
    if (source === "tencent" || source === "eastmoney" || source === "sina" || source === "akshare") {
      output[source] = detail;
    }
  }

  return output;
}
