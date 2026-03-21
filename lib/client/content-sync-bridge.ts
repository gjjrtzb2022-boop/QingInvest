import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/client/supabase-browser";

type AuthContext = {
  supabase: SupabaseClient;
  userId: string;
};

type CloudAnnotationRow = {
  id: string;
  kind: string;
  quote: string;
  note: string;
  created_at: string;
};

const slugToArticleIdCache = new Map<string, number>();

export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error) return null;

  const userId = data.session?.user?.id || "";
  if (!userId) return null;

  return { supabase, userId };
}

export async function resolveArticleIdBySlug(
  slug: string,
  context: AuthContext
): Promise<number | null> {
  const normalized = slug.trim();
  if (!normalized) return null;

  const cached = slugToArticleIdCache.get(normalized);
  if (cached) return cached;

  const { data, error } = await context.supabase
    .from("articles")
    .select("id, slug")
    .eq("slug", normalized)
    .maybeSingle();

  if (error || !data) return null;

  const id = Number(data.id);
  const rowSlug = String(data.slug || "").trim();
  if (!rowSlug || !Number.isFinite(id)) return null;

  slugToArticleIdCache.set(rowSlug, id);
  return id;
}

export async function resolveArticleIdsBySlug(
  slugs: string[],
  context: AuthContext
): Promise<Map<string, number>> {
  const normalized = unique(slugs.map((item) => item.trim()).filter(Boolean));
  const output = new Map<string, number>();
  const missing: string[] = [];

  for (const slug of normalized) {
    const cached = slugToArticleIdCache.get(slug);
    if (cached) {
      output.set(slug, cached);
    } else {
      missing.push(slug);
    }
  }

  for (const chunk of chunkArray(missing, 120)) {
    if (chunk.length === 0) continue;
    const { data, error } = await context.supabase
      .from("articles")
      .select("id, slug")
      .in("slug", chunk);
    if (error) continue;

    for (const row of data || []) {
      const id = Number(row.id);
      const slug = String(row.slug || "").trim();
      if (!slug || !Number.isFinite(id)) continue;
      slugToArticleIdCache.set(slug, id);
      output.set(slug, id);
    }
  }

  return output;
}

export async function loadCloudStatusesBySlug(
  slugs: string[]
): Promise<Record<string, "unread" | "read" | "favorite">> {
  const context = await getAuthContext();
  if (!context) return {};

  const slugToId = await resolveArticleIdsBySlug(slugs, context);
  const ids = unique(Array.from(slugToId.values())).filter((item) => Number.isFinite(item));
  if (ids.length === 0) return {};

  const idToSlug = new Map<number, string>();
  for (const [slug, id] of slugToId.entries()) {
    idToSlug.set(id, slug);
  }

  const output: Record<string, "unread" | "read" | "favorite"> = {};
  for (const chunk of chunkArray(ids, 150)) {
    const { data, error } = await context.supabase
      .from("reading_states")
      .select("article_id, status")
      .eq("user_id", context.userId)
      .in("article_id", chunk);
    if (error) continue;

    for (const row of data || []) {
      const id = Number(row.article_id);
      const slug = idToSlug.get(id);
      if (!slug) continue;
      const status = row.status === "read" ? "read" : row.status === "favorite" ? "favorite" : "unread";
      output[slug] = status;
    }
  }

  return output;
}

export async function saveCloudStatusBySlug(
  slug: string,
  status: "unread" | "read" | "favorite"
): Promise<boolean> {
  const result = await saveCloudStatusesBySlug([{ slug, status }]);
  return result.saved > 0;
}

export async function saveCloudStatusesBySlug(
  entries: Array<{ slug: string; status: "unread" | "read" | "favorite" }>
): Promise<{ saved: number; skipped: number }> {
  const normalized = entries
    .map((item) => ({
      slug: item.slug.trim(),
      status: item.status
    }))
    .filter((item) => Boolean(item.slug));
  if (normalized.length === 0) {
    return { saved: 0, skipped: 0 };
  }

  const context = await getAuthContext();
  if (!context) return { saved: 0, skipped: normalized.length };

  const slugToId = await resolveArticleIdsBySlug(
    normalized.map((item) => item.slug),
    context
  );

  const payload = normalized
    .map((item) => {
      const articleId = slugToId.get(item.slug);
      if (!articleId) return null;
      return {
        user_id: context.userId,
        article_id: articleId,
        status: item.status
      };
    })
    .filter((item): item is { user_id: string; article_id: number; status: "unread" | "read" | "favorite" } => Boolean(item));

  if (payload.length === 0) {
    return { saved: 0, skipped: normalized.length };
  }

  for (const chunk of chunkArray(payload, 250)) {
    const { error } = await context.supabase.from("reading_states").upsert(
      chunk,
      { onConflict: "user_id,article_id" }
    );
    if (error) {
      return {
        saved: 0,
        skipped: normalized.length
      };
    }
  }

  return {
    saved: payload.length,
    skipped: normalized.length - payload.length
  };
}

export async function loadCloudAnnotationsBySlug(slug: string): Promise<CloudAnnotationRow[]> {
  const context = await getAuthContext();
  if (!context) return [];

  const articleId = await resolveArticleIdBySlug(slug, context);
  if (!articleId) return [];

  const { data, error } = await context.supabase
    .from("annotations")
    .select("id, kind, quote, note, created_at")
    .eq("user_id", context.userId)
    .eq("article_id", articleId)
    .order("created_at", { ascending: false });

  if (error) return [];

  return (data || []).map((row) => ({
    id: String(row.id),
    kind: String(row.kind || "annotation"),
    quote: String(row.quote || ""),
    note: String(row.note || ""),
    created_at: String(row.created_at || "")
  }));
}

export async function addCloudAnnotationBySlug(
  slug: string,
  input: { quote: string; note: string; kind: "annotation" | "quote" }
): Promise<CloudAnnotationRow | null> {
  const rows = await addCloudAnnotationsBySlug(slug, [input]);
  return rows[0] || null;
}

export async function addCloudAnnotationsBySlug(
  slug: string,
  inputs: Array<{ quote: string; note: string; kind: "annotation" | "quote" }>
): Promise<CloudAnnotationRow[]> {
  if (inputs.length === 0) return [];

  const context = await getAuthContext();
  if (!context) return [];

  const articleId = await resolveArticleIdBySlug(slug, context);
  if (!articleId) return [];

  const { data, error } = await context.supabase
    .from("annotations")
    .insert(
      inputs.map((input) => ({
        user_id: context.userId,
        article_id: articleId,
        kind: input.kind,
        quote: input.quote,
        note: input.note
      }))
    )
    .select("id, kind, quote, note, created_at")
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: String(row.id),
    kind: String(row.kind || "annotation"),
    quote: String(row.quote || ""),
    note: String(row.note || ""),
    created_at: String(row.created_at || "")
  }));
}

export async function deleteCloudAnnotationById(annotationId: string): Promise<boolean> {
  const deleted = await deleteCloudAnnotationsByIds([annotationId]);
  return deleted > 0;
}

export async function deleteCloudAnnotationsByIds(annotationIds: string[]): Promise<number> {
  const normalized = unique(annotationIds.map((item) => item.trim()).filter(Boolean));
  if (normalized.length === 0) return 0;

  const context = await getAuthContext();
  if (!context) return 0;

  let deleted = 0;
  for (const chunk of chunkArray(normalized, 200)) {
    const { data, error } = await context.supabase
      .from("annotations")
      .delete()
      .eq("user_id", context.userId)
      .in("id", chunk)
      .select("id");

    if (error) continue;
    deleted += (data || []).length;
  }

  return deleted;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const output: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
