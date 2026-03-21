import { cache } from "react";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";

export type ArticleStatus = "unread" | "read" | "favorite";
export type ArticlePlaceholderStatus = "none" | "external" | "missing_local";

export type Article = {
  slug: string;
  title: string;
  date: string;
  series: string;
  seriesSlug: string;
  category: string;
  status: ArticleStatus;
  tags: string[];
  industries: string[];
  stocks: string[];
  cover: string;
  summary: string;
  sourceUrl: string;
  sourcePath: string;
  placeholderStatus: ArticlePlaceholderStatus;
  relatedSlugs: string[];
  content: string;
  fileName: string;
};

export type ArticleListItem = Pick<
  Article,
  | "slug"
  | "title"
  | "date"
  | "series"
  | "seriesSlug"
  | "category"
  | "status"
  | "tags"
  | "industries"
  | "stocks"
  | "cover"
  | "summary"
  | "sourceUrl"
  | "sourcePath"
  | "placeholderStatus"
>;

export type ArticleHeading = {
  id: string;
  text: string;
  level: 2 | 3;
};

type ArticleSourceMode = "local" | "github";

type ArticleIndexRecord = ArticleListItem & {
  fileName: string;
};

type RawArticleIndexEntry = Partial<ArticleListItem> & {
  path?: string;
  sourcePath?: string;
  placeholderStatus?: string;
};

const ARTICLES_DIR = path.join(process.cwd(), "content", "articles");
const COVERS_DIR = path.join(process.cwd(), "content", "covers");
const INDEX_PATH = path.join(ARTICLES_DIR, "index.json");
const PUBLISHED_SLUGS_PATH = path.join(ARTICLES_DIR, "published-slugs.json");
const COVER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);
const DEFAULT_GITHUB_BRANCH = "main";
const DEFAULT_GITHUB_ARTICLES_PATH = "content/articles";

let coverLookupCache: Promise<Map<string, string>> | null = null;
let publishedSlugSetCache: Promise<Set<string> | null> | null = null;
let articleIndexCache: Promise<ArticleIndexRecord[]> | null = null;

export const getAllArticles = cache(async (): Promise<Article[]> => {
  const records = await readArticleIndexRecords();
  const articles: Article[] = [];
  for (const record of records) {
    // Keep article reads sequential so large corpora do not spike I/O and memory together.
    articles.push(await parseArticle(record.fileName, record));
  }

  return articles.sort((a, b) => b.date.localeCompare(a.date));
});

export const getAllArticleListItems = cache(async (): Promise<ArticleListItem[]> => {
  const records = await readArticleIndexRecords();
  return records.map(toArticleListItem);
});

export const getArticleByRoute = cache(
  async (seriesSlug: string, articleSlug: string): Promise<Article | undefined> => {
    const records = await readArticleIndexRecords();
    const matched = records.find((article) => article.slug === articleSlug && article.seriesSlug === seriesSlug);
    if (!matched) return undefined;
    return parseArticle(matched.fileName, matched);
  }
);

export async function getArticleBySlug(slug: string): Promise<Article | undefined> {
  const records = await readArticleIndexRecords();
  const matched = records.find((article) => article.slug === slug);
  if (!matched) return undefined;
  return parseArticle(matched.fileName, matched);
}

export async function getSeriesArticles(seriesSlug: string): Promise<ArticleListItem[]> {
  const articles = await getAllArticleListItems();
  return articles.filter((article) => article.seriesSlug === seriesSlug);
}

export async function getPrevNextInSeries(
  article: Pick<Article, "slug" | "seriesSlug">
): Promise<{ prev?: ArticleListItem; next?: ArticleListItem }> {
  const seriesArticles = await getSeriesArticles(article.seriesSlug);
  const index = seriesArticles.findIndex((item) => item.slug === article.slug);
  if (index === -1) return {};

  return {
    prev: seriesArticles[index + 1],
    next: seriesArticles[index - 1]
  };
}

export function getRelatedArticles(article: Article, allArticles: ArticleListItem[], limit = 6): ArticleListItem[] {
  const candidates = allArticles.filter((item) =>
    article.placeholderStatus === "none" ? item.placeholderStatus === "none" : true
  );

  const explicit = article.relatedSlugs
    .map((slug) => candidates.find((item) => item.slug === slug))
    .filter((item): item is ArticleListItem => Boolean(item))
    .slice(0, limit);
  if (explicit.length) {
    return explicit;
  }

  const scored = candidates
    .filter((item) => item.slug !== article.slug)
    .map((item) => ({ item, score: computeRelatedScore(article, item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.item.date.localeCompare(a.item.date))
    .slice(0, limit)
    .map((entry) => entry.item);

  if (scored.length) {
    return scored;
  }

  return candidates
    .filter((item) => item.slug !== article.slug && item.seriesSlug === article.seriesSlug)
    .slice(0, limit);
}

async function readArticleIndexRecords(): Promise<ArticleIndexRecord[]> {
  if (getArticleSourceMode() === "github") {
    return buildArticleIndexRecords();
  }

  if (!articleIndexCache) {
    articleIndexCache = buildArticleIndexRecords();
  }
  return articleIndexCache;
}

async function buildArticleIndexRecords(): Promise<ArticleIndexRecord[]> {
  const [entries, allowlist] = await Promise.all([readRawArticleIndexEntries(), readPublishedSlugSet()]);
  const records: ArticleIndexRecord[] = [];

  for (const entry of entries) {
    const normalized = await normalizeArticleIndexEntry(entry);
    if (!normalized) continue;
    if (allowlist && allowlist.size > 0 && !allowlist.has(normalized.slug)) continue;
    records.push(normalized);
  }

  return records.sort((a, b) => b.date.localeCompare(a.date));
}

async function readRawArticleIndexEntries(): Promise<RawArticleIndexEntry[]> {
  const fromIndexFile = await readRawArticleIndexFromIndexFile();
  if (fromIndexFile.length > 0) return fromIndexFile;
  return readRawArticleIndexByScanningMarkdown();
}

async function readRawArticleIndexFromIndexFile(): Promise<RawArticleIndexEntry[]> {
  try {
    const source = await readArticlesSourceText("index.json");
    const parsed = JSON.parse(source);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readRawArticleIndexByScanningMarkdown(): Promise<RawArticleIndexEntry[]> {
  const markdownFiles =
    getArticleSourceMode() === "github" ? await listGitHubMarkdownFiles() : await listLocalMarkdownFiles();
  const records: RawArticleIndexEntry[] = [];

  for (const fileName of markdownFiles) {
    const source = await readArticlesSourceText(fileName);
    const { data, content } = matter(source);
    const title = String(data.title || fileName.replace(/\.md$/, "")).trim();
    const category = String(data.category || "未分类").trim();

    records.push({
      slug: String(data.slug || fileName.replace(/\.md$/, "")).trim(),
      title,
      date: String(data.date || "1970-01-01").trim(),
      series: String(data.series || "未分类专题").trim(),
      category,
      status: normalizeStatus(String(data.status || "unread")),
      tags: normalizeArray(data.tags),
      industries: normalizeArray(data.industries),
      stocks: normalizeArray(data.stocks),
      cover: String(data.cover || "").trim(),
      summary: createSummary(content.trim(), String(data.summary || "").trim(), title, category),
      sourceUrl: String(data.source_url || data.sourceUrl || "").trim(),
      sourcePath: String(data.source_path || data.sourcePath || "").trim(),
      placeholderStatus: normalizePlaceholderStatus(
        String(data.placeholder_status || data.placeholderStatus || "none").trim()
      ),
      path: `content/articles/${fileName}`
    });
  }

  return records;
}

async function normalizeArticleIndexEntry(entry: RawArticleIndexEntry): Promise<ArticleIndexRecord | null> {
  const fileName = inferArticleFileName(entry);
  if (!fileName) return null;

  const slug = String(entry.slug || fileName.replace(/\.md$/, "")).trim();
  if (!slug) return null;

  const title = String(entry.title || slug).trim();
  const series = String(entry.series || "未分类专题").trim();
  const normalizedCover = normalizeArticleCoverUrl(String(entry.cover || "").trim(), fileName);
  const cover = normalizedCover || (await findAutoCoverByTitle(title, slug));
  const sourceUrl = String(entry.sourceUrl || "").trim();
  const sourcePath = String(entry.sourcePath || "").trim();
  const placeholderStatus = normalizePlaceholderStatus(String(entry.placeholderStatus || ""));

  return {
    slug,
    title,
    date: String(entry.date || "1970-01-01").trim(),
    series,
    seriesSlug: String(entry.seriesSlug || toPathSegment(series)).trim(),
    category: String(entry.category || "未分类").trim(),
    status: normalizeStatus(String(entry.status || "unread")),
    tags: normalizeArray(entry.tags),
    industries: normalizeArray(entry.industries),
    stocks: normalizeArray(entry.stocks),
    cover,
    summary: String(entry.summary || "").trim(),
    sourceUrl,
    sourcePath,
    placeholderStatus,
    fileName
  };
}

function inferArticleFileName(entry: RawArticleIndexEntry): string {
  const pathValue = String(entry.path || "").trim().replace(/\\/g, "/");
  if (pathValue) {
    const normalized = pathValue.replace(/^\.?\//, "");
    if (normalized.startsWith("content/articles/")) {
      return normalized.slice("content/articles/".length);
    }
    return normalized;
  }

  const slug = String(entry.slug || "").trim();
  return slug ? `${slug}.md` : "";
}

function toArticleListItem(article: ArticleIndexRecord): ArticleListItem {
  return {
    slug: article.slug,
    title: article.title,
    date: article.date,
    series: article.series,
    seriesSlug: article.seriesSlug,
    category: article.category,
    status: article.status,
    tags: article.tags,
    industries: article.industries,
    stocks: article.stocks,
    cover: article.cover,
    summary: article.summary,
    sourceUrl: article.sourceUrl,
    sourcePath: article.sourcePath,
    placeholderStatus: article.placeholderStatus
  };
}

export async function renderMarkdownToHtml(markdown: string): Promise<string> {
  const processed = await remark().use(remarkGfm).use(remarkHtml).process(markdown);
  return String(processed);
}

export function extractHeadings(markdown: string): ArticleHeading[] {
  const lines = markdown.split(/\r?\n/);
  const headings: ArticleHeading[] = [];

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      const text = h2Match[1].trim();
      headings.push({ id: slugifyHeading(text), text, level: 2 });
      continue;
    }

    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      const text = h3Match[1].trim();
      headings.push({ id: slugifyHeading(text), text, level: 3 });
    }
  }

  return headings;
}

export function addHeadingIds(html: string): string {
  let output = html;
  output = output.replace(/<h2>(.*?)<\/h2>/g, (_, inner) => {
    const plainText = stripHtml(inner);
    const id = slugifyHeading(plainText);
    return `<h2 id="${id}">${inner}</h2>`;
  });
  output = output.replace(/<h3>(.*?)<\/h3>/g, (_, inner) => {
    const plainText = stripHtml(inner);
    const id = slugifyHeading(plainText);
    return `<h3 id="${id}">${inner}</h3>`;
  });
  return output;
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, "");
}

function slugifyHeading(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/["'`]/g, "")
    .replace(/[.,!?;:()[\]{}]/g, "")
    .replace(/\//g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
}

async function readPublishedSlugSet(): Promise<Set<string> | null> {
  if (getArticleSourceMode() === "github") {
    return loadPublishedSlugSet();
  }

  if (!publishedSlugSetCache) {
    publishedSlugSetCache = loadPublishedSlugSet();
  }

  return publishedSlugSetCache;
}

async function loadPublishedSlugSet(): Promise<Set<string> | null> {
  try {
    const source = await readArticlesSourceText("published-slugs.json");
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) return null;

    const normalized = parsed
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (normalized.length === 0) return null;
    return new Set(normalized);
  } catch {
    return null;
  }
}

async function parseArticle(fileName: string, seed?: Partial<ArticleIndexRecord>): Promise<Article> {
  const source = await readArticlesSourceText(fileName);
  const { data, content } = matter(source);
  const normalizedContent = normalizeMarkdownImageUrls(content.trim(), fileName);

  const slug = String(data.slug || seed?.slug || fileName.replace(/\.md$/, "")).trim();
  const title = String(data.title || seed?.title || slug).trim();
  const date = String(data.date || seed?.date || "1970-01-01").trim();
  const series = String(data.series || seed?.series || "未分类专题").trim();
  const category = String(data.category || seed?.category || "未分类").trim();
  const explicitCover = normalizeArticleCoverUrl(String(data.cover || seed?.cover || "").trim(), fileName);
  const cover = explicitCover || (await findAutoCoverByTitle(title, slug));
  const sourceUrl = String(data.source_url || data.sourceUrl || seed?.sourceUrl || "").trim();
  const sourcePath = String(data.source_path || data.sourcePath || seed?.sourcePath || "").trim();
  const placeholderStatus = normalizePlaceholderStatus(
    String(data.placeholder_status || data.placeholderStatus || seed?.placeholderStatus || "")
  );

  return {
    slug,
    title,
    date,
    series,
    seriesSlug: toPathSegment(series),
    category,
    status: normalizeStatus(String(data.status || seed?.status || "unread")),
    tags: normalizeArray(data.tags),
    industries: normalizeArray(data.industries),
    stocks: normalizeArray(data.stocks),
    cover,
    summary: createSummary(
      normalizedContent,
      String(data.summary || seed?.summary || "").trim(),
      title,
      category
    ),
    sourceUrl,
    sourcePath,
    placeholderStatus,
    relatedSlugs: normalizeArray(data.related),
    content: normalizedContent,
    fileName
  };
}

async function findAutoCoverByTitle(title: string, slug: string): Promise<string> {
  const lookup = await getCoverLookup();
  const candidates = unique([
    ...coverLookupKeysFor(title),
    ...coverLookupKeysFor(slug)
  ]);

  for (const key of candidates) {
    const matched = lookup.get(key);
    if (matched) return matched;
  }

  return "";
}

function coverLookupKeysFor(value: string): string[] {
  const raw = value.trim();
  if (!raw) return [];
  const basic = normalizeCoverKey(raw);
  const kebab = normalizeCoverKey(
    raw
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
  return unique([basic, kebab]);
}

function normalizeCoverKey(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

async function getCoverLookup(): Promise<Map<string, string>> {
  if (!coverLookupCache) {
    coverLookupCache = buildCoverLookup();
  }
  return coverLookupCache;
}

async function buildCoverLookup(): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();
  const stack: string[] = [COVERS_DIR];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!COVER_EXTENSIONS.has(ext)) continue;

      const base = path.basename(entry.name, ext);
      const relative = path.relative(COVERS_DIR, absolute).split(path.sep).join("/");
      const route = `/covers/${relative}`;

      for (const key of coverLookupKeysFor(base)) {
        if (!lookup.has(key)) {
          lookup.set(key, route);
        }
      }
    }
  }

  return lookup;
}

function getArticleSourceMode(): ArticleSourceMode {
  return process.env.ARTICLE_SOURCE === "github" ? "github" : "local";
}

function getGitHubArticlesConfig() {
  const owner = String(process.env.ARTICLE_GITHUB_OWNER || "").trim();
  const repo = String(process.env.ARTICLE_GITHUB_REPO || "").trim();
  const branch = String(process.env.ARTICLE_GITHUB_BRANCH || DEFAULT_GITHUB_BRANCH).trim() || DEFAULT_GITHUB_BRANCH;
  const rawArticlesPath = String(process.env.ARTICLE_GITHUB_ARTICLES_PATH || "").trim();
  const articlesPath = normalizeGitHubArticlesPath(rawArticlesPath || DEFAULT_GITHUB_ARTICLES_PATH);
  const token = String(process.env.ARTICLE_GITHUB_TOKEN || "").trim();

  if (!owner || !repo) {
    throw new Error("ARTICLE_SOURCE=github 时必须配置 ARTICLE_GITHUB_OWNER 和 ARTICLE_GITHUB_REPO");
  }

  return { owner, repo, branch, articlesPath, token };
}

async function readArticlesSourceText(relativePath: string): Promise<string> {
  if (getArticleSourceMode() === "github") {
    return readGitHubArticlesText(relativePath);
  }

  return fs.readFile(path.join(ARTICLES_DIR, relativePath), "utf8");
}

async function readGitHubArticlesText(relativePath: string): Promise<string> {
  const config = getGitHubArticlesConfig();
  const repoPath = joinGitHubRepoPath(config.articlesPath, relativePath);
  const headers = new Headers({
    "User-Agent": "qingyishanzhang-site",
    Accept: config.token ? "application/vnd.github.raw" : "text/plain"
  });

  if (config.token) {
    headers.set("Authorization", `Bearer ${config.token}`);
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodePathSegments(repoPath)}?ref=${encodeURIComponent(config.branch)}`,
      {
        headers,
        cache: "no-store"
      }
    );
    if (!response.ok) {
      throw new Error(`GitHub 文章源读取失败: ${response.status} ${repoPath}`);
    }
    return response.text();
  }

  const response = await fetch(
    `https://raw.githubusercontent.com/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/${encodeURIComponent(config.branch)}/${encodePathSegments(repoPath)}`,
    {
      headers,
      cache: "no-store"
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub 文章源读取失败: ${response.status} ${repoPath}`);
  }
  return response.text();
}

async function listLocalMarkdownFiles(): Promise<string[]> {
  const entries = await fs.readdir(ARTICLES_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

async function listGitHubMarkdownFiles(): Promise<string[]> {
  const config = getGitHubArticlesConfig();
  const headers = new Headers({
    "User-Agent": "qingyishanzhang-site",
    Accept: "application/vnd.github+json"
  });

  if (config.token) {
    headers.set("Authorization", `Bearer ${config.token}`);
  }

  const response = await fetch(
    buildGitHubContentsApiUrl(config.owner, config.repo, config.articlesPath, config.branch),
    {
      headers,
      cache: "no-store"
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub 文章目录读取失败: ${response.status}`);
  }

  const payload = (await response.json()) as Array<{ type?: string; name?: string }> | { message?: string };
  if (!Array.isArray(payload)) return [];

  return payload
    .filter((item) => item.type === "file" && typeof item.name === "string" && item.name.endsWith(".md"))
    .map((item) => String(item.name))
    .sort();
}

function normalizeArticleCoverUrl(cover: string, fileName: string): string {
  const value = String(cover || "").trim();
  if (!value) return "";
  if (getArticleSourceMode() !== "github") return value;

  if (/^(?:[a-z]+:)?\/\//i.test(value)) return value;
  if (value.startsWith("/covers/")) return value;

  if (value.startsWith("/images/articles/")) {
    const relative = value.replace(/^\/images\/articles\//, "");
    return buildGitHubArticleAssetUrl(relative);
  }

  if (value.startsWith("content/articles/")) {
    const relative = value.replace(/^content\/articles\//, "");
    return buildGitHubArticleAssetUrl(relative);
  }

  if (value.startsWith("/")) {
    return value;
  }

  return normalizeMarkdownImageUrl(value, fileName);
}

function buildGitHubArticleAssetUrl(relativePath: string): string {
  const config = getGitHubArticlesConfig();
  const repoPath = joinGitHubRepoPath(config.articlesPath, relativePath);
  return `https://raw.githubusercontent.com/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/${encodeURIComponent(config.branch)}/${encodePathSegments(repoPath)}`;
}

function joinGitHubRepoPath(...segments: string[]): string {
  return segments
    .flatMap((segment) => String(segment || "").split("/"))
    .map((segment) => segment.trim())
    .filter((segment) => Boolean(segment) && segment !== ".")
    .join("/");
}

function normalizeGitHubArticlesPath(value: string): string {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "." || normalized === "/") {
    return "";
  }
  return normalized.replace(/^\/+|\/+$/g, "");
}

function buildGitHubContentsApiUrl(owner: string, repo: string, repoPath: string, branch: string): string {
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`;
  const encodedPath = encodePathSegments(repoPath);
  if (!encodedPath) {
    return `${base}?ref=${encodeURIComponent(branch)}`;
  }
  return `${base}/${encodedPath}?ref=${encodeURIComponent(branch)}`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeStatus(value: string): ArticleStatus {
  if (value === "read") return "read";
  if (value === "favorite") return "favorite";
  return "unread";
}

function normalizePlaceholderStatus(value: string): ArticlePlaceholderStatus {
  if (value === "external") return "external";
  if (value === "missing_local") return "missing_local";
  return "none";
}

function createSummary(content: string, summary: string, title: string, category: string): string {
  if (summary && summary.trim()) {
    return summary;
  }

  const topic = summarizeTopic(title) || summarizeTopic(category) || "该主题";
  const plain = toSummaryPlainText(content || summary);
  const sentences = splitSummarySentences(plain).map(normalizeSummarySentence).filter((item) => item.length >= 8);
  if (!sentences.length) {
    return `文章围绕${topic}展开，重点梳理了背景信息、过程细节与关键结论。`;
  }

  const thesis = pickBestSentence(sentences, scoreThesisSentence);
  const support = pickBestSentence(
    sentences,
    scoreSupportSentence,
    thesis ? [thesis] : []
  );
  const intent = pickBestSentence(
    sentences,
    scoreIntentSentence,
    [thesis, support].filter(Boolean)
  );

  const lines: string[] = [];
  lines.push(`文章围绕${topic}展开。`);
  if (thesis) {
    lines.push(`作者的核心观点是：${clipSummaryPoint(thesis, 54)}。`);
  }
  if (support && !isSimilarSentence(support, thesis)) {
    lines.push("文中结合具体经历与情境变化，对这一观点进行了展开说明。");
  }
  if (intent) {
    lines.push(`文章想传达的是：${clipSummaryPoint(intent, 54)}。`);
  }

  return dedupeSummaryLines(lines).join("");
}

function summarizeTopic(raw: string): string {
  const text = String(raw || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[“”"'`]/g, "")
    .trim();

  if (!text) return "";
  const stripped = text
    .replace(/^(关于|围绕|针对|对于|就|在|张清一[:：]\s*)/u, "")
    .replace(/^(我|我们|作者)\s*/u, "")
    .replace(/[。！!？?，,、；;：:]+$/u, "")
    .trim();
  if (!stripped) return "";
  return stripped.length > 24 ? `${stripped.slice(0, 24).trim()}...` : stripped;
}

function toSummaryPlainText(raw: string): string {
  return String(raw || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/<br\s*\/?>/gi, "。")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "。")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSummarySentences(text: string): string[] {
  return String(text || "")
    .split(/[。！？!?；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSummarySentence(sentence: string): string {
  const output = String(sentence || "")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/[“”"'`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(今天|今晚|近日|最近|目前|现在|随后|另外|然后|此外)\s*/u, "")
    .replace(/^(至于|要说起来|说白了|说到底)\s*/u, "")
    .replace(/^(好像就是|其实就是|其实|也许|可能|应该|大概|大约)\s*/u, "")
    .replace(/^说?不是[^是]{0,8}是/u, "是")
    .replace(/^(我们|我|作者|文中|文章中|本文)\s*/u, "")
    .replace(/我(突然)?想[:：]?\s*/g, "")
    .replace(/突然想[:：]?\s*/g, "")
    .replace(/我(认为|觉得|猜测|判断|观察到)\s*/g, "")
    .replace(/^的判断[,，]?\s*/u, "")
    .replace(/^[，,、；;：:\-\s]+/u, "")
    .replace(/[吗么呢吧？?]/g, "")
    .replace(/[，、；,:：\-]+$/u, "")
    .trim();

  if (!output) return "";
  if (/^们/.test(output)) return output.replace(/^们/, "").trim();
  if (/^(作者|链接|来源|编辑于|转[:：]|http|https|原标题)/.test(output)) return "";
  if (/^(而|但|所以|因此|另外|随后|然后|并且|不过)/.test(output) && output.length < 18) return "";
  if (output.length > 92) return clipSummaryPoint(output, 92);
  return output;
}

function clipSummaryPoint(text: string, maxLength: number): string {
  const value = String(text || "").trim();
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trim()}...`;
}

function pickBestSentence(sentences: string[], scorer: (value: string, index: number, total: number) => number, excluded: string[] = []): string {
  let best = "";
  let bestScore = -Infinity;

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    if (excluded.some((item) => isSimilarSentence(item, sentence))) continue;

    const score = scorer(sentence, index, sentences.length);
    if (score > bestScore) {
      best = sentence;
      bestScore = score;
    }
  }

  return best;
}

function scoreThesisSentence(sentence: string, index: number, total: number): number {
  let score = baseSentenceScore(sentence, index, total);
  if (containsAny(sentence, ["观点", "本质", "核心", "关键", "真正", "判断", "逻辑", "建议", "风险"])) score += 8;
  if (/不是.+而是/.test(sentence)) score += 2;
  if (containsAny(sentence, ["我认为", "我判断", "我觉得"])) score += 3;
  return score;
}

function scoreSupportSentence(sentence: string, index: number, total: number): number {
  let score = baseSentenceScore(sentence, index, total);
  if (containsAny(sentence, ["数据", "结果", "过程", "案例", "买入", "卖出", "持仓", "分红", "训练", "比赛"])) score += 6;
  if (/\d/.test(sentence)) score += 2;
  return score;
}

function scoreIntentSentence(sentence: string, index: number, total: number): number {
  let score = baseSentenceScore(sentence, index, total);
  if (containsAny(sentence, ["所以", "因此", "结论", "建议", "提醒", "应该", "必须", "要", "不要", "风险", "出路", "路径"])) {
    score += 8;
  }
  if (index >= Math.floor(total * 0.6)) score += 3;
  return score;
}

function baseSentenceScore(sentence: string, index: number, total: number): number {
  const length = sentence.length;
  let score = 0;
  if (length >= 12 && length <= 54) score += 4;
  else if (length > 54 && length <= 80) score += 2;
  else if (length < 8 || length > 90) score -= 4;

  if (index < Math.floor(total * 0.35)) score += 1;
  if (index >= Math.floor(total * 0.7)) score += 1;

  if (containsAny(sentence, ["哈哈", "呵呵", "表情", "转："])) score -= 4;
  if (/^(而|但|所以|因此|另外|随后|然后|并且|不过)/.test(sentence)) score -= 6;
  if (/^(作者|链接|来源|编辑于|转[:：]|http|https|原标题)/.test(sentence)) score -= 20;
  return score;
}

function isSimilarSentence(a: string, b: string): boolean {
  const left = normalizeSentenceKey(a);
  const right = normalizeSentenceKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;

  const overlap = countOverlapChars(left, right);
  const ratio = overlap / Math.max(left.length, right.length);
  return ratio >= 0.7;
}

function normalizeSentenceKey(value: string): string {
  return String(value || "")
    .replace(/[，,。；;：:！!？?\s\-"']/g, "")
    .trim();
}

function countOverlapChars(a: string, b: string): number {
  const chars = new Set(a.split(""));
  let count = 0;
  for (const ch of b) {
    if (chars.has(ch)) count += 1;
  }
  return count;
}

function dedupeSummaryLines(lines: string[]): string[] {
  const output: string[] = [];
  for (const line of lines) {
    const clean = String(line || "").trim();
    if (!clean) continue;
    if (output.some((item) => isSimilarSentence(item, clean))) continue;
    output.push(clean);
  }
  return output;
}

function containsAny(source: string, words: string[]): boolean {
  const text = String(source || "");
  return words.some((word) => text.includes(word));
}


function normalizeMarkdownImageUrls(markdown: string, fileName: string): string {
  if (!markdown) return markdown;

  return markdown.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (matched, altText: string, rawTarget: string) => {
    const { url, suffix } = splitMarkdownLinkTarget(rawTarget);
    const normalized = normalizeMarkdownImageUrl(url, fileName);
    if (!normalized || normalized === url) return matched;
    return `![${altText}](${normalized}${suffix})`;
  });
}

function splitMarkdownLinkTarget(rawTarget: string): { url: string; suffix: string } {
  const value = rawTarget.trim();
  if (!value) return { url: "", suffix: "" };

  if (value.startsWith("<")) {
    const end = value.indexOf(">");
    if (end > 0) {
      return {
        url: value.slice(1, end).trim(),
        suffix: value.slice(end + 1)
      };
    }
  }

  const firstWhitespace = value.search(/\s/);
  if (firstWhitespace === -1) {
    return { url: value, suffix: "" };
  }

  return {
    url: value.slice(0, firstWhitespace),
    suffix: value.slice(firstWhitespace)
  };
}

function normalizeMarkdownImageUrl(url: string, fileName: string): string {
  const value = url.trim();
  if (!value) return value;

  if (
    value.startsWith("#") ||
    value.startsWith("data:") ||
    value.startsWith("mailto:") ||
    /^(?:[a-z]+:)?\/\//i.test(value)
  ) {
    return value;
  }

  if (getArticleSourceMode() === "github") {
    if (value.startsWith("/covers/") || value.startsWith("/images/")) {
      if (value.startsWith("/images/articles/")) {
        const relative = value.replace(/^\/images\/articles\//, "");
        return buildGitHubArticleAssetUrl(relative);
      }
      return value;
    }
    if (value.startsWith("/")) {
      return value;
    }
  } else if (value.startsWith("/")) {
    return value;
  }

  const withoutPrefix = value
    .replace(/^\.\/+/, "")
    .replace(/^(?:\.\.\/)+/, "");

  if (withoutPrefix.startsWith("content/images/")) {
    const relative = withoutPrefix.replace(/^content\/images\//, "");
    return `/images/${encodePathSegments(relative)}`;
  }

  if (withoutPrefix.startsWith("images/")) {
    if (getArticleSourceMode() === "github") {
      const articleDir = path.posix.dirname(fileName.replace(/\\/g, "/"));
      const relative = articleDir === "." ? withoutPrefix : `${articleDir}/${withoutPrefix}`;
      return buildGitHubArticleAssetUrl(relative);
    }
    const relative = withoutPrefix.replace(/^images\//, "");
    return `/images/${encodePathSegments(relative)}`;
  }

  if (withoutPrefix.startsWith("content/articles/")) {
    const relative = withoutPrefix.replace(/^content\/articles\//, "");
    if (getArticleSourceMode() === "github") {
      return buildGitHubArticleAssetUrl(relative);
    }
    return `/images/articles/${encodePathSegments(relative)}`;
  }

  const articleDir = path.dirname(fileName);
  const relative = articleDir === "." ? withoutPrefix : `${articleDir}/${withoutPrefix}`;

  if (!relative) return value;
  if (getArticleSourceMode() === "github") {
    return buildGitHubArticleAssetUrl(relative);
  }
  return `/images/articles/${encodePathSegments(relative)}`;
}

function encodePathSegments(value: string): string {
  return value
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      let normalized = segment;
      try {
        normalized = decodeURIComponent(segment);
      } catch {
        normalized = segment;
      }
      return encodeURIComponent(normalized);
    })
    .join("/");
}

function toPathSegment(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[\\/]/g, "-")
    .replace(/[?#%]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "") || "uncategorized";
}

function computeRelatedScore(
  base: Pick<Article, "seriesSlug" | "category" | "tags" | "industries" | "stocks">,
  candidate: Pick<ArticleListItem, "seriesSlug" | "category" | "tags" | "industries" | "stocks">
): number {
  let score = 0;
  if (base.seriesSlug === candidate.seriesSlug) score += 4;
  if (base.category && candidate.category && base.category === candidate.category) score += 1;
  score += countOverlap(base.tags, candidate.tags) * 3;
  score += countOverlap(base.industries, candidate.industries) * 2;
  score += countOverlap(base.stocks, candidate.stocks) * 4;
  return score;
}

function countOverlap(source: string[], target: string[]): number {
  if (!source.length || !target.length) return 0;
  const set = new Set(source);
  return target.reduce((count, item) => (set.has(item) ? count + 1 : count), 0);
}
