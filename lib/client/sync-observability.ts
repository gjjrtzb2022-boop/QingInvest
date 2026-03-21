export type SyncMetricChannel = "status" | "annotation";

export type SyncMetricEvent = {
  at: number;
  channel: SyncMetricChannel;
  ok: boolean;
  durationMs: number;
  count: number;
  error: string;
};

export type SyncMetricSummary = {
  total: number;
  failed: number;
  averageDurationMs: number;
  lastFailureAt: number | null;
  lastFailureMessage: string;
  byChannel: Record<SyncMetricChannel, { total: number; failed: number }>;
};

const STORAGE_KEY = "sync-observability-events-v1";
const MAX_EVENTS = 240;

export function recordSyncMetric(
  channel: SyncMetricChannel,
  payload: { ok: boolean; durationMs: number; count?: number; error?: string }
): void {
  if (typeof window === "undefined") return;

  const event: SyncMetricEvent = {
    at: Date.now(),
    channel,
    ok: Boolean(payload.ok),
    durationMs: Number.isFinite(payload.durationMs) ? Math.max(0, payload.durationMs) : 0,
    count: Number.isFinite(payload.count) ? Math.max(1, Number(payload.count)) : 1,
    error: payload.error ? String(payload.error).slice(0, 320) : ""
  };

  const current = readRawEvents();
  const next = [...current, event].slice(-MAX_EVENTS);
  writeRawEvents(next);
}

export function readSyncMetricSummary(hours = 24): SyncMetricSummary {
  const now = Date.now();
  const since = now - Math.max(1, hours) * 60 * 60 * 1000;
  const events = readRawEvents().filter((item) => item.at >= since);

  const base: SyncMetricSummary = {
    total: 0,
    failed: 0,
    averageDurationMs: 0,
    lastFailureAt: null,
    lastFailureMessage: "",
    byChannel: {
      status: { total: 0, failed: 0 },
      annotation: { total: 0, failed: 0 }
    }
  };

  if (events.length === 0) return base;

  let totalDuration = 0;
  for (const event of events) {
    base.total += 1;
    base.byChannel[event.channel].total += 1;
    totalDuration += event.durationMs;

    if (!event.ok) {
      base.failed += 1;
      base.byChannel[event.channel].failed += 1;
      if (!base.lastFailureAt || event.at > base.lastFailureAt) {
        base.lastFailureAt = event.at;
        base.lastFailureMessage = event.error || "未知错误";
      }
    }
  }

  base.averageDurationMs = Math.round(totalDuration / events.length);
  return base;
}

export function readSyncMetricEvents(hours = 24): SyncMetricEvent[] {
  const now = Date.now();
  const since = now - Math.max(1, hours) * 60 * 60 * 1000;
  return readRawEvents()
    .filter((item) => item.at >= since)
    .sort((a, b) => b.at - a.at);
}

export function clearSyncMetricEvents(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

function readRawEvents(): SyncMetricEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const event = item as Partial<SyncMetricEvent>;
        if (event.channel !== "status" && event.channel !== "annotation") return null;
        return {
          at: typeof event.at === "number" ? event.at : Date.now(),
          channel: event.channel,
          ok: Boolean(event.ok),
          durationMs: typeof event.durationMs === "number" ? Math.max(0, event.durationMs) : 0,
          count: typeof event.count === "number" ? Math.max(1, event.count) : 1,
          error: typeof event.error === "string" ? event.error : ""
        } satisfies SyncMetricEvent;
      })
      .filter((item): item is SyncMetricEvent => Boolean(item));
  } catch {
    return [];
  }
}

function writeRawEvents(events: SyncMetricEvent[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Ignore quota write errors; sync path should not break on telemetry.
  }
}
