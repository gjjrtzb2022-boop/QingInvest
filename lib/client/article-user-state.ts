import {
  loadCloudStatusesBySlug,
  saveCloudStatusesBySlug
} from "@/lib/client/content-sync-bridge";
import { recordSyncMetric } from "@/lib/client/sync-observability";

export type ArticleUserStatus = "unread" | "read" | "favorite";

const KEY_PREFIX = "article-state:";
export const ARTICLE_STATE_CHANGED_EVENT = "article-state-changed";
const STATUS_SYNC_DELAY_MS = 420;

const pendingSyncMap = new Map<string, ArticleUserStatus>();
let syncTimer: number | null = null;
let syncInFlight = false;

export function normalizeArticleStatus(value: string | null | undefined): ArticleUserStatus {
  if (value === "read") return "read";
  if (value === "favorite") return "favorite";
  return "unread";
}

export function getStoredStatus(slug: string): ArticleUserStatus | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(`${KEY_PREFIX}${slug}`);
  if (!value) return null;
  return normalizeArticleStatus(value);
}

export function setStoredStatus(slug: string, status: ArticleUserStatus): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${KEY_PREFIX}${slug}`, status);
  window.dispatchEvent(new CustomEvent(ARTICLE_STATE_CHANGED_EVENT, { detail: { slug, status } }));
}

export function readAllStoredStatuses(): Record<string, ArticleUserStatus> {
  if (typeof window === "undefined") return {};

  const map: Record<string, ArticleUserStatus> = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(KEY_PREFIX)) continue;

    const slug = key.slice(KEY_PREFIX.length);
    if (!slug) continue;

    map[slug] = normalizeArticleStatus(window.localStorage.getItem(key));
  }

  return map;
}

export async function readEffectiveStatuses(slugs: string[]): Promise<Record<string, ArticleUserStatus>> {
  const localMap = readAllStoredStatuses();
  const remoteMap = await loadCloudStatusesBySlug(slugs);
  return {
    ...localMap,
    ...remoteMap
  };
}

export async function setManagedStatus(slug: string, status: ArticleUserStatus): Promise<void> {
  setStoredStatus(slug, status);
  queueStatusSync(slug, status);
}

function queueStatusSync(slug: string, status: ArticleUserStatus): void {
  if (typeof window === "undefined") return;
  pendingSyncMap.set(slug, status);
  if (syncTimer) {
    window.clearTimeout(syncTimer);
  }
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    void flushStatusSyncQueue();
  }, STATUS_SYNC_DELAY_MS);
}

async function flushStatusSyncQueue(): Promise<void> {
  if (syncInFlight) return;
  if (pendingSyncMap.size === 0) return;

  syncInFlight = true;
  const startedAt = Date.now();
  const batch = Array.from(pendingSyncMap.entries()).map(([slug, status]) => ({
    slug,
    status
  }));
  pendingSyncMap.clear();

  try {
    const result = await saveCloudStatusesBySlug(batch);
    recordSyncMetric("status", {
      ok: result.saved > 0 || result.skipped >= 0,
      durationMs: Date.now() - startedAt,
      count: batch.length,
      error: result.saved > 0 ? "" : "cloud status sync skipped or failed"
    });

    if (typeof window !== "undefined") {
      for (const item of batch) {
        window.dispatchEvent(
          new CustomEvent(ARTICLE_STATE_CHANGED_EVENT, {
            detail: { slug: item.slug, status: item.status, source: "cloud" }
          })
        );
      }
    }
  } catch (error) {
    for (const item of batch) {
      pendingSyncMap.set(item.slug, item.status);
    }
    recordSyncMetric("status", {
      ok: false,
      durationMs: Date.now() - startedAt,
      count: batch.length,
      error: formatError(error)
    });
  } finally {
    syncInFlight = false;
    if (pendingSyncMap.size > 0) {
      if (typeof window !== "undefined") {
        if (syncTimer) {
          window.clearTimeout(syncTimer);
        }
        syncTimer = window.setTimeout(() => {
          syncTimer = null;
          void flushStatusSyncQueue();
        }, STATUS_SYNC_DELAY_MS);
      }
    }
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
