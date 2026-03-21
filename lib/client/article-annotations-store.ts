import {
  addCloudAnnotationsBySlug,
  deleteCloudAnnotationsByIds,
  loadCloudAnnotationsBySlug
} from "@/lib/client/content-sync-bridge";
import { recordSyncMetric } from "@/lib/client/sync-observability";

export type AnnotationKind = "annotation" | "quote";

export type ArticleAnnotation = {
  id: string;
  quote: string;
  note: string;
  createdAt: string;
  kind: AnnotationKind;
};

type AnnotationInput = {
  quote: string;
  note?: string;
  kind?: AnnotationKind;
};

type PendingCreate = {
  slug: string;
  localId: string;
  payload: {
    quote: string;
    note: string;
    kind: AnnotationKind;
  };
  key: string;
};

const KEY_PREFIX = "article-annotations:";
const CLOUD_ID_PREFIX = "cloud:";
const SYNC_DELAY_MS = 560;
const REMOTE_CACHE_TTL_MS = 12000;
export const ARTICLE_ANNOTATIONS_CHANGED_EVENT = "article-annotations-changed";

const pendingCreatesBySlug = new Map<string, PendingCreate[]>();
const pendingDeleteIds = new Set<string>();
const pendingTouchedSlugs = new Set<string>();
let flushTimer: number | null = null;
let flushInFlight = false;

const remoteCache = new Map<string, { at: number; items: ArticleAnnotation[] }>();

function getStorageKey(slug: string): string {
  return `${KEY_PREFIX}${slug}`;
}

function normalize(items: unknown): ArticleAnnotation[] {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const raw = item as Partial<ArticleAnnotation>;
      const quote = typeof raw.quote === "string" ? raw.quote.trim() : "";
      if (!quote) return null;

      return {
        id:
          typeof raw.id === "string" && raw.id
            ? raw.id
            : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        quote,
        note: typeof raw.note === "string" ? raw.note.trim() : "",
        createdAt:
          typeof raw.createdAt === "string" && raw.createdAt
            ? raw.createdAt
            : new Date().toISOString(),
        kind: raw.kind === "quote" ? "quote" : "annotation"
      } satisfies ArticleAnnotation;
    })
    .filter((item): item is ArticleAnnotation => Boolean(item));
}

export function readArticleAnnotations(slug: string): ArticleAnnotation[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(getStorageKey(slug));
    if (!raw) return [];

    return normalize(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveArticleAnnotations(slug: string, items: ArticleAnnotation[]): void {
  if (typeof window === "undefined") return;

  const normalized = normalize(items);
  window.localStorage.setItem(getStorageKey(slug), JSON.stringify(normalized));
  window.dispatchEvent(
    new CustomEvent(ARTICLE_ANNOTATIONS_CHANGED_EVENT, {
      detail: { slug, count: normalized.length }
    })
  );
}

export function addArticleAnnotation(slug: string, input: AnnotationInput): ArticleAnnotation | null {
  const payload = normalizeAnnotationInput(input);
  if (!payload) return null;

  const entry: ArticleAnnotation = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    quote: payload.quote,
    note: payload.note,
    createdAt: new Date().toISOString(),
    kind: payload.kind
  };

  const current = readArticleAnnotations(slug);
  saveArticleAnnotations(slug, [entry, ...current]);
  return entry;
}

export function removeArticleAnnotation(slug: string, id: string): void {
  if (!id) return;

  const next = readArticleAnnotations(slug).filter((item) => item.id !== id);
  saveArticleAnnotations(slug, next);
}

export async function readManagedArticleAnnotations(slug: string): Promise<ArticleAnnotation[]> {
  const local = readArticleAnnotations(slug);
  const cached = remoteCache.get(slug);

  if (cached && Date.now() - cached.at <= REMOTE_CACHE_TTL_MS) {
    return mergeAnnotations(cached.items, local);
  }

  const startedAt = Date.now();
  try {
    const remoteRows = await loadCloudAnnotationsBySlug(slug);
    const remote = remoteRows.map((row) => ({
      id: `${CLOUD_ID_PREFIX}${row.id}`,
      quote: row.quote.trim().slice(0, 600),
      note: row.note.trim(),
      createdAt: normalizeIsoDate(row.created_at),
      kind: row.kind === "quote" ? "quote" : "annotation"
    })) satisfies ArticleAnnotation[];

    remoteCache.set(slug, {
      at: Date.now(),
      items: remote
    });

    recordSyncMetric("annotation", {
      ok: true,
      durationMs: Date.now() - startedAt,
      count: remote.length
    });

    return mergeAnnotations(remote, local);
  } catch (error) {
    recordSyncMetric("annotation", {
      ok: false,
      durationMs: Date.now() - startedAt,
      error: formatError(error)
    });
    return local;
  }
}

export async function addManagedArticleAnnotation(
  slug: string,
  input: AnnotationInput
): Promise<ArticleAnnotation | null> {
  const payload = normalizeAnnotationInput(input);
  if (!payload) return null;

  const entry: ArticleAnnotation = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    quote: payload.quote,
    note: payload.note,
    createdAt: new Date().toISOString(),
    kind: payload.kind
  };

  const current = readArticleAnnotations(slug);
  saveArticleAnnotations(slug, [entry, ...current]);

  queueCreate(slug, entry);
  return entry;
}

export async function removeManagedArticleAnnotation(
  slug: string,
  target: ArticleAnnotation
): Promise<void> {
  const local = readArticleAnnotations(slug);
  const targetKey = annotationKey(target);
  const nextLocal = local.filter((item) => {
    if (item.id === target.id) return false;
    return annotationKey(item) !== targetKey;
  });

  const localChanged = nextLocal.length !== local.length;
  if (localChanged) {
    saveArticleAnnotations(slug, nextLocal);
  }

  cancelPendingCreate(slug, target);
  removeFromRemoteCache(slug, targetKey);

  const remoteId = cloudIdFromAnnotationId(target.id) || findRemoteIdByKey(slug, targetKey);
  if (remoteId) {
    queueDelete(slug, remoteId);
    return;
  }

  if (!localChanged && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(ARTICLE_ANNOTATIONS_CHANGED_EVENT, {
        detail: { slug, source: "local" }
      })
    );
  }
}

function queueCreate(slug: string, item: ArticleAnnotation): void {
  const key = annotationKey(item);
  const list = pendingCreatesBySlug.get(slug) || [];
  list.push({
    slug,
    localId: item.id,
    key,
    payload: {
      quote: item.quote,
      note: item.note,
      kind: item.kind
    }
  });
  pendingCreatesBySlug.set(slug, list);
  pendingTouchedSlugs.add(slug);
  scheduleFlush();
}

function queueDelete(slug: string, cloudId: string): void {
  const value = cloudId.trim();
  if (!value) return;
  pendingDeleteIds.add(value);
  pendingTouchedSlugs.add(slug);
  scheduleFlush();
}

function cancelPendingCreate(slug: string, target: ArticleAnnotation): void {
  const list = pendingCreatesBySlug.get(slug);
  if (!list || list.length === 0) return;

  const targetKey = annotationKey(target);
  const next = list.filter((item) => item.localId !== target.id && item.key !== targetKey);

  if (next.length > 0) {
    pendingCreatesBySlug.set(slug, next);
  } else {
    pendingCreatesBySlug.delete(slug);
  }
}

function removeFromRemoteCache(slug: string, targetKey: string): void {
  const cached = remoteCache.get(slug);
  if (!cached) return;

  const next = cached.items.filter((item) => annotationKey(item) !== targetKey);
  remoteCache.set(slug, {
    at: cached.at,
    items: next
  });
}

function findRemoteIdByKey(slug: string, targetKey: string): string | null {
  const cached = remoteCache.get(slug);
  if (!cached) return null;

  const matched = cached.items.find((item) => annotationKey(item) === targetKey);
  if (!matched) return null;
  return cloudIdFromAnnotationId(matched.id);
}

function scheduleFlush(): void {
  if (typeof window === "undefined") return;
  if (flushTimer) {
    window.clearTimeout(flushTimer);
  }
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushManagedQueue();
  }, SYNC_DELAY_MS);
}

async function flushManagedQueue(): Promise<void> {
  if (flushInFlight) return;
  if (pendingCreatesBySlug.size === 0 && pendingDeleteIds.size === 0) return;

  flushInFlight = true;
  const startedAt = Date.now();

  const createSnapshot = new Map<string, PendingCreate[]>();
  for (const [slug, items] of pendingCreatesBySlug.entries()) {
    createSnapshot.set(slug, [...items]);
  }
  const deleteSnapshot = [...pendingDeleteIds];
  const touchedSnapshot = [...pendingTouchedSlugs];

  pendingCreatesBySlug.clear();
  pendingDeleteIds.clear();
  pendingTouchedSlugs.clear();

  try {
    let syncCount = 0;

    for (const [slug, items] of createSnapshot.entries()) {
      if (items.length === 0) continue;
      const rows = await addCloudAnnotationsBySlug(
        slug,
        items.map((item) => item.payload)
      );
      syncCount += rows.length;
      remoteCache.delete(slug);
    }

    if (deleteSnapshot.length > 0) {
      const deleted = await deleteCloudAnnotationsByIds(deleteSnapshot);
      syncCount += deleted;
    }

    for (const slug of touchedSnapshot) {
      remoteCache.delete(slug);
      emitChanged(slug, "cloud");
    }

    recordSyncMetric("annotation", {
      ok: true,
      durationMs: Date.now() - startedAt,
      count: syncCount || deleteSnapshot.length
    });
  } catch (error) {
    for (const [slug, items] of createSnapshot.entries()) {
      const current = pendingCreatesBySlug.get(slug) || [];
      pendingCreatesBySlug.set(slug, [...items, ...current]);
    }
    for (const id of deleteSnapshot) {
      pendingDeleteIds.add(id);
    }
    for (const slug of touchedSnapshot) {
      pendingTouchedSlugs.add(slug);
    }

    recordSyncMetric("annotation", {
      ok: false,
      durationMs: Date.now() - startedAt,
      count: createSnapshot.size + deleteSnapshot.length,
      error: formatError(error)
    });
  } finally {
    flushInFlight = false;
    if (pendingCreatesBySlug.size > 0 || pendingDeleteIds.size > 0) {
      scheduleFlush();
    }
  }
}

function mergeAnnotations(remote: ArticleAnnotation[], local: ArticleAnnotation[]): ArticleAnnotation[] {
  const output: ArticleAnnotation[] = [];
  const keys = new Set<string>();

  for (const item of remote) {
    const key = annotationKey(item);
    if (keys.has(key)) continue;
    keys.add(key);
    output.push(item);
  }

  for (const item of local) {
    const key = annotationKey(item);
    if (keys.has(key)) continue;
    keys.add(key);
    output.push(item);
  }

  output.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return output;
}

function normalizeAnnotationInput(input: AnnotationInput): { quote: string; note: string; kind: AnnotationKind } | null {
  const quote = (input.quote || "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (!quote) return null;

  return {
    quote,
    note: (input.note || "").trim(),
    kind: input.kind === "quote" ? "quote" : "annotation"
  };
}

function annotationKey(item: ArticleAnnotation): string {
  return [item.kind, item.quote.trim(), item.note.trim()].join("|").toLowerCase();
}

function cloudIdFromAnnotationId(id: string): string | null {
  if (!id.startsWith(CLOUD_ID_PREFIX)) return null;
  const value = id.slice(CLOUD_ID_PREFIX.length).trim();
  return value || null;
}

function normalizeIsoDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function emitChanged(slug: string, source: "cloud" | "local") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ARTICLE_ANNOTATIONS_CHANGED_EVENT, {
      detail: { slug, source }
    })
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
