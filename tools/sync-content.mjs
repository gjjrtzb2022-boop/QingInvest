#!/usr/bin/env node
import path from "node:path";
import { promises as fs, readFileSync } from "node:fs";
import matter from "gray-matter";
import pg from "pg";

const { Client } = pg;

const ROOT_DIR = process.cwd();
const ARTICLES_DIR = path.join(ROOT_DIR, "content", "articles");
const REPORT_DIR = path.join(ROOT_DIR, "raw", "sync-reports");
const DEFAULT_DEV_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const REQUIRED_FIELDS = ["slug", "title", "date", "series"];
const KNOWN_FRONT_MATTER_FIELDS = new Set([
  "slug",
  "title",
  "date",
  "series",
  "category",
  "status",
  "tags",
  "industries",
  "stocks",
  "cover",
  "summary",
  "source_url",
  "sourceUrl",
  "source_platform",
  "sourcePlatform",
  "source_type",
  "sourceType",
  "source",
  "author",
  "related"
]);

main().catch((error) => {
  console.error(`[sync:content] ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  loadEnvFiles();

  const options = parseArgs(process.argv.slice(2));
  validateOptions(options);

  const files = await collectMarkdownFiles(ARTICLES_DIR);
  const fileStats = await computeFileStats(files);

  if (options.ci && files.length === 0) {
    throw new Error("CI 模式下未发现任何 Markdown 文章，已阻断后续流程。");
  }

  const parseResult = await parseArticles(files);
  if (parseResult.errors.length > 0) {
    const message = parseResult.errors
      .slice(0, 6)
      .map((item) => `${item.file}: ${item.error}`)
      .join("; ");
    throw new Error(`解析失败 ${parseResult.errors.length} 个文件：${message}`);
  }

  const reportBase = {
    tool: "sync-content",
    stage: "stage-3-db-sync",
    generatedAt: new Date().toISOString(),
    batchId: options.batchId,
    options: {
      target: options.target,
      mode: options.mode,
      dryRun: options.dryRun,
      ci: options.ci
    },
    scope: {
      source: "content/articles/**/*.md",
      fileCount: files.length,
      totalBytes: fileStats.totalBytes,
      oldestMtimeIso: fileStats.oldestMtimeIso,
      newestMtimeIso: fileStats.newestMtimeIso
    },
    parsed: {
      articleCount: parseResult.articles.length,
      localImageRefs: parseResult.localImageRefs,
      uniqueSeries: countUnique(parseResult.articles.map((item) => item.series)),
      uniqueTags: countUnique(parseResult.articles.flatMap((item) => item.tags)),
      uniqueIndustries: countUnique(parseResult.articles.flatMap((item) => item.industries)),
      uniqueStocks: countUnique(parseResult.articles.flatMap((item) => item.stocks))
    },
    sampleFiles: files.slice(0, 8).map((filePath) => path.relative(ROOT_DIR, filePath))
  };

  if (options.dryRun) {
    const report = {
      ...reportBase,
      status: "dry_run",
      note: "仅预演：未写入数据库。"
    };
    await writeReports("sync-content", options.batchId, report);
    console.log(
      `[sync:content] 预演完成 target=${options.target} mode=${options.mode} files=${files.length} batch=${options.batchId}`
    );
    console.log(
      `[sync:content] 报告输出：${path.join("raw", "sync-reports", `sync-content-${options.batchId}.json`)}`
    );
    return;
  }

  const dbUrl = resolveDatabaseUrl(options);
  const dbSsl = resolveDbSsl(options);
  const client = new Client({
    connectionString: dbUrl,
    ssl: dbSsl ? { rejectUnauthorized: false } : undefined
  });

  let transactionStarted = false;
  const startedAt = Date.now();

  const counters = {
    articlesInserted: 0,
    articlesUpdated: 0,
    tagsLinked: 0,
    industriesLinked: 0,
    stocksLinked: 0,
    relatedLinked: 0,
    deactivatedInFullSync: 0
  };

  const seriesCache = new Map();
  const tagCache = new Map();
  const industryCache = new Map();
  const stockCache = new Map();
  const articleIdBySlug = new Map();

  try {
    await client.connect();
    await markSyncLogRunning(client, options, parseResult.articles.length);

    await client.query("begin");
    transactionStarted = true;

    for (const article of parseResult.articles) {
      const seriesId = await ensureSeriesId(client, article.series, seriesCache);

      const upserted = await upsertArticle(client, article, seriesId);
      articleIdBySlug.set(article.slug, upserted.articleId);

      if (upserted.inserted) {
        counters.articlesInserted += 1;
      } else {
        counters.articlesUpdated += 1;
      }

      const tagIds = await ensureTagIds(client, article.tags, tagCache);
      const industryIds = await ensureIndustryIds(client, article.industries, industryCache);
      const stockIds = await ensureStockIds(client, article.stocks, stockCache);

      counters.tagsLinked += await syncArticleTagLinks(client, upserted.articleId, tagIds);
      counters.industriesLinked += await syncArticleIndustryLinks(client, upserted.articleId, industryIds);
      counters.stocksLinked += await syncArticleStockLinks(client, upserted.articleId, stockIds);
    }

    counters.relatedLinked += await syncRelatedLinks(client, parseResult.articles, articleIdBySlug);

    if (options.mode === "full") {
      counters.deactivatedInFullSync = await deactivateMissingArticles(
        client,
        parseResult.articles.map((item) => item.contentPath)
      );
    }

    await client.query("commit");
    transactionStarted = false;

    const durationMs = Date.now() - startedAt;
    const upsertedCount = counters.articlesInserted + counters.articlesUpdated;

    await markSyncLogSuccess(client, options, {
      durationMs,
      articlesSeen: parseResult.articles.length,
      articlesUpserted: upsertedCount,
      assetsUploaded: 0,
      details: {
        ...counters,
        localImageRefs: parseResult.localImageRefs
      }
    });

    const report = {
      ...reportBase,
      status: "success",
      result: {
        durationMs,
        articlesSeen: parseResult.articles.length,
        articlesUpserted: upsertedCount,
        assetsUploaded: 0,
        counters
      }
    };
    await writeReports("sync-content", options.batchId, report);

    console.log(
      `[sync:content] 完成 target=${options.target} mode=${options.mode} seen=${parseResult.articles.length} upserted=${upsertedCount} batch=${options.batchId}`
    );
    console.log(
      `[sync:content] 详情 inserted=${counters.articlesInserted} updated=${counters.articlesUpdated} tags=${counters.tagsLinked} industries=${counters.industriesLinked} stocks=${counters.stocksLinked} related=${counters.relatedLinked}`
    );
    if (options.mode === "full") {
      console.log(`[sync:content] full 模式下已下线缺失文章：${counters.deactivatedInFullSync}`);
    }
    console.log(
      `[sync:content] 报告输出：${path.join("raw", "sync-reports", `sync-content-${options.batchId}.json`)}`
    );
  } catch (error) {
    if (transactionStarted) {
      await safeRollback(client);
    }

    const durationMs = Date.now() - startedAt;
    await markSyncLogFailed(client, options, {
      durationMs,
      articlesSeen: parseResult.articles.length,
      details: {
        ...counters,
        localImageRefs: parseResult.localImageRefs
      },
      errorMessage: formatErrorMessage(error)
    });

    const report = {
      ...reportBase,
      status: "failed",
      error: formatErrorMessage(error),
      result: {
        durationMs,
        counters
      }
    };
    await writeReports("sync-content", options.batchId, report);
    throw error;
  } finally {
    await safeClose(client);
  }
}

function parseArgs(args) {
  const options = {
    target: process.env.CONTENT_SYNC_TARGET || "dev",
    mode: process.env.CONTENT_SYNC_MODE || "incremental",
    dryRun: false,
    ci: false,
    batchId: buildBatchId(),
    dbUrl: ""
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--ci") {
      options.ci = true;
      continue;
    }

    const pair = arg.match(/^--([a-zA-Z0-9_-]+)=(.*)$/);
    if (!pair) {
      throw new Error(`无法识别参数：${arg}`);
    }

    const key = pair[1];
    const value = pair[2];

    if (key === "target") {
      options.target = value || options.target;
      continue;
    }
    if (key === "mode") {
      options.mode = value || options.mode;
      continue;
    }
    if (key === "batch-id") {
      options.batchId = value || options.batchId;
      continue;
    }
    if (key === "db-url") {
      options.dbUrl = value || "";
      continue;
    }

    throw new Error(`不支持参数：--${key}`);
  }

  return options;
}

function validateOptions(options) {
  if (!["dev", "prod"].includes(options.target)) {
    throw new Error(`--target 仅支持 dev/prod，当前为：${options.target}`);
  }
  if (!["incremental", "full"].includes(options.mode)) {
    throw new Error(`--mode 仅支持 incremental/full，当前为：${options.mode}`);
  }
}

function resolveDatabaseUrl(options) {
  if (options.dbUrl) return options.dbUrl;

  if (options.target === "dev") {
    return process.env.CONTENT_SYNC_DATABASE_URL_DEV || process.env.DATABASE_URL || DEFAULT_DEV_DB_URL;
  }

  const prodUrl = process.env.CONTENT_SYNC_DATABASE_URL_PROD || process.env.DATABASE_URL;
  if (!prodUrl) {
    throw new Error("prod 目标缺少数据库连接串，请设置 CONTENT_SYNC_DATABASE_URL_PROD 或 --db-url。");
  }
  return prodUrl;
}

function resolveDbSsl(options) {
  const explicit = normalizeBool(process.env.CONTENT_SYNC_DB_SSL);
  if (explicit !== null) return explicit;
  return options.target === "prod";
}

async function parseArticles(files) {
  const articles = [];
  const errors = [];
  let localImageRefs = 0;

  for (const filePath of files) {
    try {
      const parsed = await parseArticleFile(filePath);
      localImageRefs += parsed.localImageRefsCount;
      articles.push(parsed.article);
    } catch (error) {
      errors.push({
        file: path.relative(ROOT_DIR, filePath),
        error: formatErrorMessage(error)
      });
    }
  }

  return { articles, errors, localImageRefs };
}

async function parseArticleFile(filePath) {
  const relativePath = toPosix(path.relative(ROOT_DIR, filePath));
  if (!relativePath.startsWith("content/articles/")) {
    throw new Error(`非法内容路径（仅允许 content/articles）: ${relativePath}`);
  }

  const source = await fs.readFile(filePath, "utf8");
  const { data, content } = matter(source);

  const missingFields = REQUIRED_FIELDS.filter((field) => !hasMeaningfulValue(data[field]));
  if (missingFields.length > 0) {
    throw new Error(`front matter 缺失字段: ${missingFields.join(", ")}`);
  }

  const slug = normalizeText(data.slug);
  const title = normalizeText(data.title);
  const publishedDate = normalizeDate(data.date);
  const series = normalizeText(data.series) || "未分类系列";
  const category = normalizeText(data.category) || "未分类";
  const summary = normalizeText(data.summary);
  const coverUrl = normalizeText(data.cover);
  const sourceUrl = normalizeOptionalText(data.source_url ?? data.sourceUrl);
  const sourcePlatform = normalizeText(data.source_platform ?? data.sourcePlatform) || "知乎";
  const sourceType = normalizeSourceType(data.source_type ?? data.sourceType ?? data.source);
  const authorName = normalizeText(data.author) || "山长 清一";
  const bodyMarkdown = String(content || "").trim();

  const tags = normalizeStringArray(data.tags);
  const industries = normalizeStringArray(data.industries);
  const stocks = normalizeStringArray(data.stocks);
  const relatedSlugs = normalizeStringArray(data.related).filter((item) => item !== slug);
  const metadata = pickMetadata(data);
  const localImageRefsCount = extractLocalImageRefs(bodyMarkdown).length;

  const article = {
    slug,
    title,
    publishedDate,
    series,
    category,
    summary,
    bodyMarkdown,
    coverUrl,
    contentPath: relativePath,
    sourceUrl,
    sourcePlatform,
    sourceType,
    authorName,
    tags,
    industries,
    stocks,
    relatedSlugs,
    metadata
  };

  return { article, localImageRefsCount };
}

async function upsertArticle(client, article, seriesId) {
  const existingId = await findExistingArticleId(client, article.slug, article.sourceUrl);
  if (existingId) {
    await client.query(
      `
        update public.articles
           set slug = $1,
               title = $2,
               published_date = $3::date,
               series_id = $4,
               category = $5,
               summary = $6,
               body_markdown = $7,
               cover_url = $8,
               content_path = $9,
               source_url = $10,
               source_platform = $11,
               source_type = $12,
               author_name = $13,
               metadata = $14::jsonb,
               is_published = true,
               updated_at = now()
         where id = $15
      `,
      [
        article.slug,
        article.title,
        article.publishedDate,
        seriesId,
        article.category,
        article.summary,
        article.bodyMarkdown,
        article.coverUrl,
        article.contentPath,
        article.sourceUrl,
        article.sourcePlatform,
        article.sourceType,
        article.authorName,
        JSON.stringify(article.metadata),
        existingId
      ]
    );
    return { articleId: existingId, inserted: false };
  }

  const inserted = await client.query(
    `
      insert into public.articles (
        slug,
        title,
        published_date,
        series_id,
        category,
        summary,
        body_markdown,
        cover_url,
        content_path,
        source_url,
        source_platform,
        source_type,
        author_name,
        metadata,
        is_published
      ) values (
        $1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, true
      )
      returning id
    `,
    [
      article.slug,
      article.title,
      article.publishedDate,
      seriesId,
      article.category,
      article.summary,
      article.bodyMarkdown,
      article.coverUrl,
      article.contentPath,
      article.sourceUrl,
      article.sourcePlatform,
      article.sourceType,
      article.authorName,
      JSON.stringify(article.metadata)
    ]
  );

  return { articleId: inserted.rows[0].id, inserted: true };
}

async function findExistingArticleId(client, slug, sourceUrl) {
  if (sourceUrl) {
    const bySource = await client.query("select id from public.articles where source_url = $1 limit 1", [sourceUrl]);
    if (bySource.rowCount > 0) {
      return bySource.rows[0].id;
    }
  }

  const bySlug = await client.query("select id from public.articles where slug = $1 limit 1", [slug]);
  if (bySlug.rowCount > 0) {
    return bySlug.rows[0].id;
  }

  return null;
}

async function ensureSeriesId(client, name, cache) {
  const normalizedName = normalizeText(name) || "未分类系列";
  if (cache.has(normalizedName)) {
    return cache.get(normalizedName);
  }

  const slug = toPathSegment(normalizedName);
  const result = await client.query(
    `
      insert into public.series (slug, name)
      values ($1, $2)
      on conflict (slug) do update
        set name = excluded.name,
            updated_at = now()
      returning id
    `,
    [slug, normalizedName]
  );
  const id = result.rows[0].id;
  cache.set(normalizedName, id);
  return id;
}

async function ensureTagIds(client, tags, cache) {
  const ids = [];
  for (const tagName of dedupe(tags)) {
    if (cache.has(tagName)) {
      ids.push(cache.get(tagName));
      continue;
    }

    const slug = toPathSegment(tagName);
    const result = await client.query(
      `
        insert into public.tags (slug, name, group_name)
        values ($1, $2, $3)
        on conflict (slug) do update
          set name = excluded.name,
              updated_at = now()
        returning id
      `,
      [slug, tagName, "其他"]
    );
    const id = result.rows[0].id;
    cache.set(tagName, id);
    ids.push(id);
  }
  return dedupe(ids);
}

async function ensureIndustryIds(client, items, cache) {
  const ids = [];
  for (const industryName of dedupe(items)) {
    if (cache.has(industryName)) {
      ids.push(cache.get(industryName));
      continue;
    }

    const slug = toPathSegment(industryName);
    const result = await client.query(
      `
        insert into public.industries (slug, name)
        values ($1, $2)
        on conflict (slug) do update
          set name = excluded.name,
              updated_at = now()
        returning id
      `,
      [slug, industryName]
    );
    const id = result.rows[0].id;
    cache.set(industryName, id);
    ids.push(id);
  }
  return dedupe(ids);
}

async function ensureStockIds(client, items, cache) {
  const ids = [];
  for (const raw of dedupe(items)) {
    const symbol = normalizeText(raw);
    if (!symbol) continue;

    if (cache.has(symbol)) {
      ids.push(cache.get(symbol));
      continue;
    }

    const result = await client.query(
      `
        insert into public.stocks (symbol, name)
        values ($1, $2)
        on conflict (symbol) do update
          set name = case when public.stocks.name = '' then excluded.name else public.stocks.name end,
              updated_at = now()
        returning id
      `,
      [symbol, symbol]
    );
    const id = result.rows[0].id;
    cache.set(symbol, id);
    ids.push(id);
  }
  return dedupe(ids);
}

async function syncArticleTagLinks(client, articleId, tagIds) {
  return syncPairLinks(client, "article_tags", "tag_id", articleId, tagIds);
}

async function syncArticleIndustryLinks(client, articleId, industryIds) {
  return syncPairLinks(client, "article_industries", "industry_id", articleId, industryIds);
}

async function syncArticleStockLinks(client, articleId, stockIds) {
  return syncPairLinks(client, "article_stocks", "stock_id", articleId, stockIds);
}

async function syncPairLinks(client, tableName, targetColumn, articleId, targetIds) {
  await client.query(`delete from public.${tableName} where article_id = $1`, [articleId]);

  const ids = dedupe(targetIds);
  if (ids.length === 0) return 0;

  const values = [];
  const params = [articleId];
  for (let i = 0; i < ids.length; i += 1) {
    params.push(ids[i]);
    values.push(`($1, $${i + 2})`);
  }

  await client.query(
    `
      insert into public.${tableName} (article_id, ${targetColumn})
      values ${values.join(", ")}
      on conflict (article_id, ${targetColumn}) do nothing
    `,
    params
  );
  return ids.length;
}

async function syncRelatedLinks(client, articles, articleIdBySlug) {
  const unknownSlugs = new Set();
  for (const article of articles) {
    for (const relatedSlug of article.relatedSlugs) {
      if (!articleIdBySlug.has(relatedSlug)) {
        unknownSlugs.add(relatedSlug);
      }
    }
  }

  if (unknownSlugs.size > 0) {
    const lookup = await client.query(
      "select id, slug from public.articles where slug = any($1::text[])",
      [Array.from(unknownSlugs)]
    );
    for (const row of lookup.rows) {
      articleIdBySlug.set(row.slug, row.id);
    }
  }

  let linked = 0;
  for (const article of articles) {
    const articleId = articleIdBySlug.get(article.slug);
    if (!articleId) continue;

    await client.query("delete from public.article_related where article_id = $1", [articleId]);

    const dedupedRelated = dedupe(article.relatedSlugs)
      .map((slug) => articleIdBySlug.get(slug))
      .filter((id) => Number.isInteger(id) && id !== articleId);

    for (let i = 0; i < dedupedRelated.length; i += 1) {
      await client.query(
        `
          insert into public.article_related (article_id, related_article_id, sort_order)
          values ($1, $2, $3)
          on conflict (article_id, related_article_id)
          do update set sort_order = excluded.sort_order
        `,
        [articleId, dedupedRelated[i], i]
      );
      linked += 1;
    }
  }

  return linked;
}

async function deactivateMissingArticles(client, syncedContentPaths) {
  if (syncedContentPaths.length === 0) {
    return 0;
  }
  const result = await client.query(
    `
      update public.articles
         set is_published = false,
             updated_at = now()
       where content_path like 'content/articles/%'
         and is_published = true
         and not (content_path = any($1::text[]))
    `,
    [syncedContentPaths]
  );
  return result.rowCount || 0;
}

async function markSyncLogRunning(client, options, articlesSeen) {
  await client.query(
    `
      insert into public.sync_logs (
        batch_id,
        source_scope,
        target_env,
        sync_mode,
        triggered_by,
        status,
        articles_seen,
        details
      ) values (
        $1, $2, $3, $4, $5, 'running', $6, $7::jsonb
      )
      on conflict (batch_id) do update
        set target_env = excluded.target_env,
            sync_mode = excluded.sync_mode,
            triggered_by = excluded.triggered_by,
            status = 'running',
            articles_seen = excluded.articles_seen,
            error_message = null,
            details = excluded.details,
            started_at = now(),
            finished_at = null
    `,
    [
      options.batchId,
      "content/articles/**/*.md",
      options.target,
      options.mode,
      options.ci ? "ci" : "manual",
      articlesSeen,
      JSON.stringify({ dryRun: false })
    ]
  );
}

async function markSyncLogSuccess(client, options, payload) {
  await client.query(
    `
      update public.sync_logs
         set status = 'success',
             articles_seen = $2,
             articles_upserted = $3,
             assets_uploaded = $4,
             duration_ms = $5,
             details = $6::jsonb,
             finished_at = now(),
             error_message = null
       where batch_id = $1
    `,
    [
      options.batchId,
      payload.articlesSeen,
      payload.articlesUpserted,
      payload.assetsUploaded,
      payload.durationMs,
      JSON.stringify(payload.details)
    ]
  );
}

async function markSyncLogFailed(client, options, payload) {
  try {
    await client.query(
      `
        update public.sync_logs
           set status = 'failed',
               articles_seen = $2,
               duration_ms = $3,
               details = $4::jsonb,
               error_message = $5,
               finished_at = now()
         where batch_id = $1
      `,
      [
        options.batchId,
        payload.articlesSeen,
        payload.durationMs,
        JSON.stringify(payload.details),
        payload.errorMessage
      ]
    );
  } catch {
    // Intentionally ignore to preserve original failure.
  }
}

async function collectMarkdownFiles(dirPath) {
  const files = [];
  await walk(dirPath, files);
  return files.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

async function walk(dirPath, output) {
  let entries = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, output);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    output.push(fullPath);
  }
}

async function computeFileStats(files) {
  let totalBytes = 0;
  let oldestMtime = Number.POSITIVE_INFINITY;
  let newestMtime = 0;

  for (const filePath of files) {
    const stat = await fs.stat(filePath);
    totalBytes += stat.size;
    oldestMtime = Math.min(oldestMtime, stat.mtimeMs);
    newestMtime = Math.max(newestMtime, stat.mtimeMs);
  }

  return {
    totalBytes,
    oldestMtimeIso: Number.isFinite(oldestMtime) ? new Date(oldestMtime).toISOString() : null,
    newestMtimeIso: newestMtime > 0 ? new Date(newestMtime).toISOString() : null
  };
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return dedupe(
      value
        .map((item) => normalizeText(item))
        .filter(Boolean)
    );
  }

  if (typeof value === "string") {
    return dedupe(
      value
        .split(",")
        .map((item) => normalizeText(item))
        .filter(Boolean)
    );
  }

  return [];
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeOptionalText(value) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeDate(value) {
  const raw = normalizeText(value);
  const direct = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (direct) {
    return `${direct[1]}-${direct[2]}-${direct[3]}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const yyyy = `${parsed.getFullYear()}`;
    const mm = `${parsed.getMonth() + 1}`.padStart(2, "0");
    const dd = `${parsed.getDate()}`.padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  throw new Error(`非法日期格式: ${raw}`);
}

function normalizeSourceType(value) {
  const raw = normalizeText(value).toLowerCase();
  if (raw === "answer") return "answer";
  if (raw === "pin") return "pin";
  if (raw === "manual") return "manual";
  return "article";
}

function hasMeaningfulValue(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return Boolean(value);
}

function pickMetadata(frontMatter) {
  const metadata = {};
  for (const [key, value] of Object.entries(frontMatter || {})) {
    if (KNOWN_FRONT_MATTER_FIELDS.has(key)) continue;
    metadata[key] = value;
  }
  return metadata;
}

function extractLocalImageRefs(markdown) {
  const refs = [];
  const regex = /!\[[^\]]*]\(([^)]+)\)/g;
  let match = regex.exec(markdown || "");

  while (match) {
    const rawRef = normalizeText(match[1]);
    if (rawRef) {
      const ref = normalizeRef(rawRef);
      if (ref && !isRemoteRef(ref)) {
        refs.push(ref);
      }
    }
    match = regex.exec(markdown || "");
  }

  return refs;
}

function normalizeRef(ref) {
  return ref
    .replace(/^<|>$/g, "")
    .replace(/^["']|["']$/g, "")
    .split("?")[0]
    .split("#")[0]
    .trim();
}

function isRemoteRef(ref) {
  return /^(https?:)?\/\//i.test(ref) || ref.startsWith("data:");
}

function toPathSegment(value) {
  return normalizeText(value)
    .replace(/\s+/g, "-")
    .replace(/[\\/]/g, "-")
    .replace(/[?#%]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "") || "uncategorized";
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function dedupe(items) {
  return [...new Set(items)];
}

function countUnique(items) {
  return dedupe(items.map((item) => normalizeText(item)).filter(Boolean)).length;
}

async function writeReports(prefix, batchId, report) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `${prefix}-${batchId}.json`);
  const latestPath = path.join(REPORT_DIR, `latest-${prefix}.json`);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(reportPath, serialized, "utf8");
  await fs.writeFile(latestPath, serialized, "utf8");
}

function buildBatchId() {
  const now = new Date();
  const yyyy = `${now.getFullYear()}`;
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");
  const dd = `${now.getDate()}`.padStart(2, "0");
  const hh = `${now.getHours()}`.padStart(2, "0");
  const mi = `${now.getMinutes()}`.padStart(2, "0");
  const ss = `${now.getSeconds()}`.padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function loadEnvFiles() {
  const shellKeys = new Set(Object.keys(process.env));
  loadEnvFile(path.join(ROOT_DIR, ".env"), { shellKeys, allowOverrideFromFile: false });
  loadEnvFile(path.join(ROOT_DIR, ".env.local"), { shellKeys, allowOverrideFromFile: true });
}

function loadEnvFile(filePath, context) {
  try {
    const source = readFileSync(filePath, "utf8");
    const lines = source.split(/\r?\n/);
    for (const line of lines) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;

      const { key, value } = parsed;
      if (context.shellKeys.has(key)) continue;
      if (!context.allowOverrideFromFile && process.env[key] !== undefined) continue;

      process.env[key] = value;
    }
  } catch {
    // Ignore missing env files.
  }
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;

  const key = match[1];
  let value = match[2] || "";
  value = value.trim();

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  value = value.replace(/\\n/g, "\n");
  return { key, value };
}

function normalizeBool(value) {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return null;
}

function formatErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function safeRollback(client) {
  try {
    await client.query("rollback");
  } catch {
    // Ignore rollback failures.
  }
}

async function safeClose(client) {
  try {
    await client.end();
  } catch {
    // Ignore close failures.
  }
}
