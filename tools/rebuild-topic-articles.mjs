#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import matter from "gray-matter";

const ROOT_DIR = process.cwd();
const ARTICLES_DIR = path.join(ROOT_DIR, "content", "articles");
const TOPIC_ROOT = path.join(
  ROOT_DIR,
  "山长知乎文章爬取",
  "清一投资号文章",
  "output_final",
  "04_专题归类_按链接汇总"
);
const TOPIC_REPORT_PATH = path.join(TOPIC_ROOT, "分类报告.json");

main().catch((error) => {
  console.error(`重建失败：${error.message}`);
  process.exitCode = 1;
});

async function main() {
  if (!(await pathExists(TOPIC_ROOT))) {
    throw new Error(`专题目录不存在：${TOPIC_ROOT}`);
  }

  const sourceFiles = await collectTopicMarkdownFiles(TOPIC_ROOT);
  if (!sourceFiles.length) {
    throw new Error(`专题目录下没有找到可导入文章：${TOPIC_ROOT}`);
  }
  const placeholderEntries = await readPlaceholderEntries(TOPIC_REPORT_PATH);

  const existing = await readExistingArticles(ARTICLES_DIR);
  await resetArticlesDirectory(ARTICLES_DIR);

  const usedSlugs = new Set();
  const duplicateSourceUrls = new Map();
  const publishedSlugs = [];

  let copiedImages = 0;
  let reusedExisting = 0;
  let placeholderCount = 0;

  for (const filePath of sourceFiles) {
    const parsed = await parseRecordMarkdown(filePath);
    const topic = inferTopicSeries(filePath);
    const sourcePath = toPosixPath(path.relative(TOPIC_ROOT, filePath));
    const normalizedSourceUrl = normalizeSourceUrl(parsed.sourceUrl);

    if (normalizedSourceUrl) {
      duplicateSourceUrls.set(normalizedSourceUrl, (duplicateSourceUrls.get(normalizedSourceUrl) || 0) + 1);
    }

    const existingArticle = consumeExistingArticle(existing, sourcePath, normalizedSourceUrl);
    if (existingArticle) {
      reusedExisting += 1;
    }

    const baseSlug = existingArticle?.slug || buildSlug(parsed, filePath);
    const slug = ensureUniqueSlug(baseSlug, usedSlugs);
    usedSlugs.add(slug);

    const imageResult = await rewriteAndCopyLocalImages({
      markdown: parsed.body,
      sourceMarkdownPath: filePath,
      slug
    });
    copiedImages += imageResult.copied;

    const date = parsed.date || (await getFileDate(filePath));
    const tags = buildTopicTags(parsed.tags, topic, parsed.category, parsed.type);
    const industries = buildTopicIndustries(topic, parsed.category, existingArticle?.industries || []);
    const stocks = existingArticle?.stocks || [];
    const cover = imageResult.firstCover || existingArticle?.cover || "";
    const summary = existingArticle?.summary || createSummary(imageResult.body, parsed.title, topic);
    const markdown = buildArticleMarkdown({
      slug,
      title: parsed.title,
      date,
      series: topic,
      category: parsed.category || topic,
      status: existingArticle?.status || "unread",
      tags,
      industries,
      stocks,
      cover,
      summary,
      source: "zhihu",
      sourceUrl: normalizedSourceUrl,
      sourcePlatform: parsed.sourcePlatform || "知乎",
      author: parsed.author || "清一投资号",
      sourcePath,
      body: imageResult.body
    });

    await fs.writeFile(path.join(ARTICLES_DIR, `${slug}.md`), markdown, "utf8");
    publishedSlugs.push(slug);
  }

  for (const entry of placeholderEntries) {
    const existingArticle = consumeExistingArticle(existing, entry.sourcePath, entry.sourceUrl);
    if (existingArticle) {
      reusedExisting += 1;
    }

    const baseSlug = existingArticle?.slug || buildSlug({ title: entry.title, sourceUrl: entry.sourceUrl }, entry.sourcePath);
    const slug = ensureUniqueSlug(baseSlug, usedSlugs);
    usedSlugs.add(slug);

    const markdown = buildArticleMarkdown({
      slug,
      title: entry.title,
      date: entry.date,
      series: entry.series,
      category: entry.category,
      status: existingArticle?.status || "unread",
      tags: entry.tags,
      industries: buildTopicIndustries(entry.series, entry.category, existingArticle?.industries || []),
      stocks: existingArticle?.stocks || [],
      cover: existingArticle?.cover || "",
      summary: entry.summary,
      source: "zhihu",
      sourceUrl: entry.sourceUrl,
      sourcePlatform: entry.sourcePlatform,
      author: entry.author,
      sourcePath: entry.sourcePath,
      placeholderStatus: entry.placeholderStatus,
      body: entry.body
    });

    await fs.writeFile(path.join(ARTICLES_DIR, `${slug}.md`), markdown, "utf8");
    publishedSlugs.push(slug);
    placeholderCount += 1;
  }

  await fs.writeFile(
    path.join(ARTICLES_DIR, "published-slugs.json"),
    `${JSON.stringify(publishedSlugs, null, 2)}\n`,
    "utf8"
  );

  runNodeScript("tools/build-articles.mjs");
  runNodeScript("tools/build-stock-mentions.mjs");

  const duplicateUrlCount = [...duplicateSourceUrls.values()].filter((count) => count > 1).length;
  console.log(`[rebuild:topic-articles] source=${TOPIC_ROOT}`);
  console.log(`[rebuild:topic-articles] imported=${publishedSlugs.length}`);
  console.log(`[rebuild:topic-articles] placeholders=${placeholderCount}`);
  console.log(`[rebuild:topic-articles] reusedExisting=${reusedExisting}`);
  console.log(`[rebuild:topic-articles] copiedImages=${copiedImages}`);
  console.log(`[rebuild:topic-articles] duplicateSourceUrls=${duplicateUrlCount}`);
}

async function collectTopicMarkdownFiles(rootDir) {
  const output = [];
  const stack = [rootDir];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      if (entry.name === "README.md") continue;
      output.push(fullPath);
    }
  }

  return output.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

async function readPlaceholderEntries(reportPath) {
  let report;
  try {
    report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  } catch {
    return [];
  }

  const rows = Array.isArray(report?.missing_entries) ? report.missing_entries : [];
  return rows.map((entry, index) => {
    const status = String(entry?.status || "").trim();
    const title = String(entry?.title || `专题占位条目 ${index + 1}`).trim();
    const series = String(entry?.category || "未分类专题").trim();
    const sourceUrl = normalizeSourceUrl(entry?.url || "");
    const placeholderStatus = status === "external" ? "external" : "missing_local";
    const category = placeholderStatus === "external" ? "外部链接" : "待补录";

    return {
      title,
      series,
      category,
      sourceUrl,
      placeholderStatus,
      sourcePlatform: inferSourcePlatform(sourceUrl),
      sourcePath: toPosixPath(path.posix.join(series, title, `${title}.md`)),
      date: "1970-01-01",
      author: "清一投资号",
      tags: buildPlaceholderTags(series, category, placeholderStatus),
      summary: buildPlaceholderSummary(title, series, placeholderStatus),
      body: buildPlaceholderBody(title, series, sourceUrl, placeholderStatus)
    };
  });
}

async function readExistingArticles(dir) {
  const bySourcePath = new Map();
  const bySourceUrl = new Map();

  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { bySourcePath, bySourceUrl };
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(dir, entry.name);
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = matter(raw);
    const data = parsed.data || {};
    const sourcePath = String(data.source_path || data.sourcePath || "").trim();
    const sourceUrl = normalizeSourceUrl(data.source_url || data.sourceUrl || "");
    const record = {
      slug: String(data.slug || path.basename(entry.name, ".md")).trim(),
      status: normalizeStatus(data.status),
      stocks: normalizeStringArray(data.stocks),
      industries: normalizeStringArray(data.industries),
      cover: String(data.cover || "").trim(),
      summary: String(data.summary || "").trim(),
      used: false
    };

    if (sourcePath) {
      bySourcePath.set(sourcePath, record);
    }
    if (sourceUrl) {
      const bucket = bySourceUrl.get(sourceUrl) || [];
      bucket.push(record);
      bySourceUrl.set(sourceUrl, bucket);
    }
  }

  return { bySourcePath, bySourceUrl };
}

function consumeExistingArticle(existing, sourcePath, sourceUrl) {
  const byPath = existing.bySourcePath.get(sourcePath);
  if (byPath && !byPath.used) {
    byPath.used = true;
    return byPath;
  }

  if (!sourceUrl) return null;
  const bucket = existing.bySourceUrl.get(sourceUrl) || [];
  const next = bucket.find((item) => !item.used);
  if (next) {
    next.used = true;
    return next;
  }

  return null;
}

async function resetArticlesDirectory(dir) {
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(entries.map((entry) => fs.rm(path.join(dir, entry.name), { recursive: true, force: true })));
}

async function parseRecordMarkdown(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.replace(/\r/g, "").split("\n");
  const h1Index = lines.findIndex((line) => /^#\s+/.test(line));
  const rawTitle = (h1Index >= 0 ? lines[h1Index].replace(/^#\s+/, "") : path.basename(filePath, ".md")).trim();
  const dividerIndex = lines.findIndex((line, index) => index > h1Index && line.trim() === "---");
  const metaBlock =
    h1Index >= 0 && dividerIndex > h1Index ? lines.slice(h1Index + 1, dividerIndex) : lines.slice(0, 24);
  const bodyLines = dividerIndex > -1 ? lines.slice(dividerIndex + 1) : lines.slice(h1Index + 1);

  const metadata = {};
  for (const line of metaBlock) {
    const match = line.trim().match(/^-\s*([^:：]+)\s*[:：]\s*(.+)$/);
    if (!match) continue;
    metadata[normalizeMetaKey(match[1])] = match[2].trim();
  }

  return {
    type: String(metadata.type || "article").trim().toLowerCase(),
    title: rawTitle || path.basename(filePath, ".md"),
    body: bodyLines.join("\n").trim(),
    sourceUrl: metadata.link || "",
    sourcePlatform: "知乎",
    date: normalizeDate(metadata.date || ""),
    author: metadata.author || "",
    category: metadata.category || "未分类",
    tags: splitTags(metadata.tags || "")
  };
}

function inferTopicSeries(filePath) {
  const relative = path.relative(TOPIC_ROOT, filePath);
  const [topic] = relative.split(path.sep);
  return String(topic || "未分类专题").trim();
}

function buildTopicTags(tags, topic, category, recordType) {
  const output = [...tags];
  const typeTag = resolveTypeTag(recordType);
  if (typeTag && !output.includes(typeTag)) {
    output.unshift(typeTag);
  }
  if (category && !output.includes(category)) {
    output.push(category);
  }
  if (topic && !output.includes(topic)) {
    output.push(topic);
  }
  return unique(output);
}

function buildPlaceholderTags(topic, category, placeholderStatus) {
  return unique([
    "文章",
    "专题占位",
    placeholderStatus === "external" ? "外部链接" : "待补录",
    category,
    topic
  ]);
}

function buildTopicIndustries(topic, category, existingIndustries) {
  const output = [...existingIndustries];
  const derived = inferIndustry(topic) || inferIndustry(category);
  if (derived && !output.includes(derived)) {
    output.push(derived);
  }
  return unique(output);
}

function inferIndustry(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("教育")) return "教育";
  if (text.includes("啤酒")) return "啤酒";
  if (text.includes("银行")) return "银行";
  if (text.includes("建筑")) return "建筑";
  if (text.includes("有色")) return "有色";
  return "";
}

function inferSourcePlatform(url) {
  const value = String(url || "").toLowerCase();
  if (value.includes("xueqiu.com")) return "雪球";
  if (value.includes("zhihu.com")) return "知乎";
  return "外部来源";
}

function buildPlaceholderSummary(title, topic, placeholderStatus) {
  if (placeholderStatus === "external") {
    return `该条目属于「${topic}」专题，目前站内仅保留目录占位与原始外链，正文未收入本地文章库。`;
  }
  return `该条目属于「${topic}」专题，目录中已登记，但本地正文暂缺，后续补抓后会替换为正式文章。`;
}

function buildPlaceholderBody(title, topic, sourceUrl, placeholderStatus) {
  const lines = [
    `# ${title}`,
    "",
    "## 条目状态",
    ""
  ];

  if (placeholderStatus === "external") {
    lines.push(`该条目收录在「${topic}」专题中，但当前本地只保留外部原始链接，正文尚未同步到站内。`);
  } else {
    lines.push(`该条目收录在「${topic}」专题中，但当前本地正文缺失，后续补抓后会替换为完整内容。`);
  }

  if (sourceUrl) {
    lines.push("", "## 原始链接", "", `[点击查看原文](${sourceUrl})`);
  }

  lines.push("", "## 说明", "");
  if (placeholderStatus === "external") {
    lines.push("这是一个专题占位条目，用来保留原始专题结构与专题内的位置。");
  } else {
    lines.push("这是一个待补录条目，用来标记专题目录里已有登记、但正文文件暂未就位的文章。");
  }

  return lines.join("\n");
}

function normalizeMetaKey(input) {
  const key = String(input).trim();
  if (key === "类型") return "type";
  if (key === "链接") return "link";
  if (key === "日期") return "date";
  if (key === "作者") return "author";
  if (key === "分类") return "category";
  if (key === "标签") return "tags";
  return key;
}

function splitTags(raw) {
  if (!raw) return [];
  return unique(
    raw
      .split(/[，,、|]/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function resolveTypeTag(recordType) {
  const normalized = String(recordType || "").trim().toLowerCase();
  if (normalized === "article") return "文章";
  if (normalized === "pin") return "想法";
  return "回答";
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) {
    return iso.toISOString().slice(0, 10);
  }
  return "";
}

async function getFileDate(filePath) {
  const stat = await fs.stat(filePath);
  return stat.mtime.toISOString().slice(0, 10);
}

function buildSlug(parsed, filePath) {
  const answerUrl = parsed.sourceUrl.match(/\/answer\/(\d+)/);
  if (answerUrl) return `zhihu-answer-${answerUrl[1]}`;

  const pinUrl = parsed.sourceUrl.match(/\/pin\/(\d+)/);
  if (pinUrl) return `zhihu-pin-${pinUrl[1]}`;

  const articleUrl = parsed.sourceUrl.match(/\/p\/(\d+)/);
  if (articleUrl) return `zhihu-article-${articleUrl[1]}`;

  const compactTitle = parsed.title
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  if (compactTitle) {
    const hash = createHash("md5")
      .update(`${parsed.sourceUrl}|${filePath}`)
      .digest("hex")
      .slice(0, 8);
    const clipped = compactTitle.slice(0, 56).replace(/-+$/g, "");
    return compactTitle.length > 56 ? `zhihu-${clipped}-${hash}` : `zhihu-${clipped}`;
  }

  const hash = createHash("md5").update(`${parsed.sourceUrl}|${filePath}`).digest("hex").slice(0, 10);
  return `zhihu-article-${hash}`;
}

function ensureUniqueSlug(baseSlug, usedSlugs) {
  if (!usedSlugs.has(baseSlug)) return baseSlug;
  let index = 2;
  while (usedSlugs.has(`${baseSlug}-${index}`)) {
    index += 1;
  }
  return `${baseSlug}-${index}`;
}

async function rewriteAndCopyLocalImages({ markdown, sourceMarkdownPath, slug }) {
  if (!markdown) {
    return { body: markdown, copied: 0, firstCover: "" };
  }

  let copied = 0;
  let firstCover = "";
  const pendingCopies = [];

  const body = markdown.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (matched, altText, rawTarget) => {
    const { url, suffix } = splitMarkdownLinkTarget(rawTarget);
    const normalized = normalizeLocalImageUrl(url);
    if (!normalized || isExternalUrl(normalized)) {
      return matched;
    }

    const sourceFile = resolveExistingSourceImage(path.dirname(sourceMarkdownPath), normalized);
    if (!sourceFile) {
      return matched;
    }

    const safeRel = sanitizeRelativePath(normalized);
    if (!safeRel) {
      return matched;
    }

    const destinationRel = path.posix.join(slug, safeRel);
    const destinationAbs = path.join(ARTICLES_DIR, destinationRel);
    pendingCopies.push(
      fs.mkdir(path.dirname(destinationAbs), { recursive: true }).then(() => fs.copyFile(sourceFile, destinationAbs))
    );

    copied += 1;
    if (!firstCover) {
      firstCover = `/images/articles/${encodePathSegments(destinationRel)}`;
    }

    return `![${altText}](${destinationRel}${suffix})`;
  });

  await Promise.all(pendingCopies);

  return { body, copied, firstCover };
}

function splitMarkdownLinkTarget(rawTarget) {
  const value = String(rawTarget || "").trim();
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

  const spaceIndex = value.search(/\s/);
  if (spaceIndex === -1) {
    return { url: value, suffix: "" };
  }

  return {
    url: value.slice(0, spaceIndex),
    suffix: value.slice(spaceIndex)
  };
}

function normalizeLocalImageUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";

  if (isExternalUrl(raw) || raw.startsWith("/")) {
    return raw;
  }

  const withoutQuery = raw.split(/[?#]/)[0];
  if (!withoutQuery) return "";

  return withoutQuery
    .replace(/^\.\/+/, "")
    .replace(/\\/g, "/");
}

function resolveExistingSourceImage(baseDir, relativePath) {
  const candidates = [relativePath];
  try {
    candidates.push(decodeURIComponent(relativePath));
  } catch {
    // keep original value
  }

  for (const candidate of candidates) {
    const full = path.resolve(baseDir, candidate);
    if (full.startsWith(baseDir) && existsSync(full)) {
      return full;
    }
  }

  return "";
}

function sanitizeRelativePath(value) {
  const cleaned = value
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^(\.\.\/)+/, "")
    .replace(/^\/+/, "");

  const segments = cleaned.split("/").filter(Boolean);
  if (!segments.length) return "";

  return segments
    .map((segment) => segment.replace(/[<>:"|?*]/g, "_"))
    .join("/");
}

function isExternalUrl(value) {
  return /^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith("data:") || value.startsWith("mailto:");
}

function createSummary(body, title, category) {
  const topic = summarizeTopic(title) || summarizeTopic(category) || "该主题";
  const plain = toSummaryPlainText(body);
  const sentences = splitSummarySentences(plain).map(normalizeSummarySentence).filter((item) => item.length >= 8);
  if (!sentences.length) {
    return `文章围绕${topic}展开，重点梳理了背景信息、过程细节与关键结论。`;
  }

  const thesis = pickBestSentence(sentences, scoreThesisSentence);
  const support = pickBestSentence(sentences, scoreSupportSentence, thesis ? [thesis] : []);
  const intent = pickBestSentence(sentences, scoreIntentSentence, [thesis, support].filter(Boolean));

  const lines = [];
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

function summarizeTopic(raw) {
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

function toSummaryPlainText(raw) {
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

function splitSummarySentences(text) {
  return String(text || "")
    .split(/[。！？!?；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSummarySentence(sentence) {
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

function clipSummaryPoint(text, maxLength) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trim()}...`;
}

function pickBestSentence(sentences, scorer, excluded = []) {
  let best = "";
  let bestScore = -Infinity;

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    if (excluded.some((item) => isSimilarSentence(item, sentence))) {
      continue;
    }

    const score = scorer(sentence, index, sentences.length);
    if (score > bestScore) {
      best = sentence;
      bestScore = score;
    }
  }

  return best;
}

function scoreThesisSentence(sentence, index, total) {
  let score = baseSentenceScore(sentence, index, total);
  if (containsAny(sentence, ["观点", "本质", "核心", "关键", "真正", "判断", "逻辑", "建议", "风险"])) score += 8;
  if (/不是.+而是/.test(sentence)) score += 2;
  if (containsAny(sentence, ["我认为", "我判断", "我觉得"])) score += 3;
  return score;
}

function scoreSupportSentence(sentence, index, total) {
  let score = baseSentenceScore(sentence, index, total);
  if (containsAny(sentence, ["数据", "结果", "过程", "案例", "买入", "卖出", "持仓", "分红", "训练", "比赛"])) score += 6;
  if (/\d/.test(sentence)) score += 2;
  return score;
}

function scoreIntentSentence(sentence, index, total) {
  let score = baseSentenceScore(sentence, index, total);
  if (containsAny(sentence, ["所以", "因此", "结论", "建议", "提醒", "应该", "必须", "要", "不要", "风险", "出路", "路径"])) {
    score += 8;
  }
  if (index >= Math.floor(total * 0.6)) {
    score += 3;
  }
  return score;
}

function baseSentenceScore(sentence, index, total) {
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

function isSimilarSentence(a, b) {
  const left = normalizeSentenceKey(a);
  const right = normalizeSentenceKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;

  const overlap = countOverlapChars(left, right);
  const ratio = overlap / Math.max(left.length, right.length);
  return ratio >= 0.7;
}

function normalizeSentenceKey(value) {
  return String(value || "")
    .replace(/[，,。；;：:！!？?\s\-"']/g, "")
    .trim();
}

function countOverlapChars(a, b) {
  const chars = new Set(a.split(""));
  let count = 0;
  for (const ch of b) {
    if (chars.has(ch)) count += 1;
  }
  return count;
}

function dedupeSummaryLines(lines) {
  const output = [];
  for (const line of lines) {
    const clean = String(line || "").trim();
    if (!clean) continue;
    if (output.some((item) => isSimilarSentence(item, clean))) continue;
    output.push(clean);
  }
  return output;
}

function containsAny(source, words) {
  const text = String(source || "");
  return words.some((word) => text.includes(word));
}

function buildArticleMarkdown(meta) {
  const lines = [
    "---",
    `slug: "${escapeYaml(meta.slug)}"`,
    `title: "${escapeYaml(meta.title)}"`,
    `date: "${escapeYaml(meta.date)}"`,
    `series: "${escapeYaml(meta.series)}"`,
    `category: "${escapeYaml(meta.category)}"`,
    `status: "${escapeYaml(meta.status || "unread")}"`
  ];

  appendYamlArray(lines, "tags", meta.tags);
  appendYamlArray(lines, "industries", meta.industries);
  appendYamlArray(lines, "stocks", meta.stocks || []);

  lines.push(
    `cover: "${escapeYaml(meta.cover)}"`,
    `summary: "${escapeYaml(meta.summary)}"`,
    `source: "${escapeYaml(meta.source)}"`,
    `source_url: "${escapeYaml(meta.sourceUrl)}"`,
    `source_platform: "${escapeYaml(meta.sourcePlatform)}"`,
    `author: "${escapeYaml(meta.author)}"`,
    `source_path: "${escapeYaml(meta.sourcePath)}"`,
    `placeholder_status: "${escapeYaml(meta.placeholderStatus || "none")}"`,
    "---",
    "",
    meta.body.trim()
  );

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function appendYamlArray(lines, key, values) {
  if (!values.length) {
    lines.push(`${key}: []`);
    return;
  }

  lines.push(`${key}:`);
  for (const value of values) {
    lines.push(`  - "${escapeYaml(value)}"`);
  }
}

function escapeYaml(input) {
  return String(input || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeSourceUrl(value) {
  return String(value || "").trim();
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim();
  if (normalized === "read" || normalized === "favorite") return normalized;
  return "unread";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return unique(
    value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  );
}

function encodePathSegments(value) {
  return value
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function toPosixPath(value) {
  return String(value || "").split(path.sep).join("/");
}

function unique(items) {
  return [...new Set(items)];
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function runNodeScript(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`${scriptPath} 执行失败`);
  }
}
