#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { buildAnswerIndustries, buildAnswerTags } from "./answer-tagging.mjs";

const rootDir = process.cwd();
const articlesDir = path.join(rootDir, "content", "articles");

const HELP_TEXT = `
从知乎爬虫目录批量导入 Markdown 记录（自动兼容新旧目录结构）

用法：
  node tools/import-zhihu-records.mjs [参数]

参数：
  --type=answer        记录类型（answer/article/pin），默认 answer
  --dir=目录           自定义输入目录（覆盖 --type）
  --limit=N            限制导入数量（默认全部）
  --dry-run            仅预览，不写入
  --help               查看帮助
`;

main().catch((error) => {
  console.error(`导入失败：${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP_TEXT.trim());
    return;
  }

  const recordsRoot = options.dir ? "" : await resolveRecordsRoot(rootDir);
  const sourceDir = options.dir ? path.resolve(rootDir, options.dir) : path.join(recordsRoot, options.type, "by_category");

  const exists = await pathExists(sourceDir);
  if (!exists) {
    throw new Error(`输入目录不存在：${sourceDir}`);
  }

  const sourceFiles = await collectMarkdownFiles(sourceDir);
  if (!sourceFiles.length) {
    console.log(`没有找到可导入文章（目录：${sourceDir}）`);
    return;
  }

  const targets = options.limit > 0 ? sourceFiles.slice(0, options.limit) : sourceFiles;
  const existing = await readExistingArticles(articlesDir);
  const usedSlugs = new Set(existing.slugs);

  if (!options.dryRun) {
    await fs.mkdir(articlesDir, { recursive: true });
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let copiedImages = 0;

  for (const filePath of targets) {
    const parsed = await parseRecordMarkdown(filePath, options.type);
    const normalizedSourceUrl = normalizeSourceUrl(parsed.sourceUrl);

    const existingArticle = normalizedSourceUrl ? existing.bySourceUrl.get(normalizedSourceUrl) : null;
    const slug = existingArticle ? existingArticle.slug : ensureUniqueSlug(buildSlug(parsed, filePath), usedSlugs);
    if (!existingArticle) {
      usedSlugs.add(slug);
    }

    const imageResult = await rewriteAndCopyLocalImages({
      markdown: parsed.body,
      sourceMarkdownPath: filePath,
      slug,
      dryRun: options.dryRun
    });

    copiedImages += imageResult.copied;

    const series = parsed.category && parsed.category !== "待整理" ? parsed.category : "未分类系列";
    const category = series === "未分类系列" ? parsed.category || "未分类" : series;
    const tags =
      options.type === "answer"
        ? buildAnswerTags({
            title: parsed.title,
            body: imageResult.body || parsed.body,
            category: parsed.category,
            existingTags: parsed.tags
          })
        : normalizeTags(parsed.tags, parsed.category, parsed.type || options.type);
    const industries =
      options.type === "answer"
        ? buildAnswerIndustries({
            title: parsed.title,
            body: imageResult.body || parsed.body,
            category: parsed.category
          })
        : parsed.category === "教育"
          ? ["教育"]
          : [];
    const cover = imageResult.firstCover || existingArticle?.cover || "";
    const date = parsed.date || (await getFileDate(filePath));
    const outputPath = existingArticle?.filePath || path.join(articlesDir, `${slug}.md`);
    const markdown = buildArticleMarkdown({
      slug,
      title: parsed.title,
      date,
      series,
      category,
      status: existingArticle?.status || "unread",
      tags,
      industries,
      stocks: existingArticle?.stocks || [],
      cover,
      summary: createSummary(imageResult.body, parsed.title, parsed.category),
      sourceUrl: normalizedSourceUrl,
      sourcePlatform: parsed.sourcePlatform || "知乎",
      source: "zhihu",
      author: parsed.author || "山长 清一",
      body: imageResult.body
    });

    if (existingArticle?.raw === markdown) {
      skipped += 1;
      continue;
    }

    if (!options.dryRun) {
      await fs.writeFile(outputPath, markdown, "utf8");
    }

    if (normalizedSourceUrl) {
      existing.bySourceUrl.set(normalizedSourceUrl, {
        slug,
        filePath: outputPath,
        raw: markdown,
        status: existingArticle?.status || "unread",
        stocks: existingArticle?.stocks || [],
        cover
      });
    }
    if (existingArticle) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  console.log(
    options.dryRun
      ? `预览完成：计划新增 ${created} 篇，计划更新 ${updated} 篇，跳过 ${skipped} 篇，处理图片 ${copiedImages} 张。`
      : `导入完成：新增 ${created} 篇，更新 ${updated} 篇，跳过 ${skipped} 篇，处理图片 ${copiedImages} 张。`
  );
}

async function resolveRecordsRoot(root) {
  const candidates = [
    path.join(root, "山长知乎文章爬取", "output_final", "01_内容Markdown", "records_md", "by_type"),
    path.join(root, "山长知乎文章爬取", "output_final", "records_md", "by_type")
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `未找到知乎记录目录，已尝试：\n${candidates.map((item) => `- ${item}`).join("\n")}`
  );
}

function parseArgs(args) {
  const options = {
    type: "answer",
    dir: "",
    limit: 0,
    dryRun: false,
    help: false
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const pair = arg.match(/^--([a-zA-Z0-9_-]+)=(.*)$/);
    if (!pair) {
      throw new Error(`无法识别参数：${arg}`);
    }

    const key = pair[1];
    const value = pair[2];
    if (key === "type") {
      options.type = value || "answer";
      continue;
    }
    if (key === "dir") {
      options.dir = value;
      continue;
    }
    if (key === "limit") {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error("--limit 必须是非负整数");
      }
      options.limit = parsed;
      continue;
    }
    throw new Error(`不支持参数：--${key}`);
  }

  return options;
}

async function collectMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const output = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await collectMarkdownFiles(full)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    output.push(full);
  }

  return output.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

async function readExistingArticles(dir) {
  const bySourceUrl = new Map();
  const slugs = new Set();
  let entries = [];

  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { bySourceUrl, slugs };
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const full = path.join(dir, entry.name);
    const raw = await fs.readFile(full, "utf8");
    const parsed = matter(raw);
    const data = parsed.data || {};

    const slug = String(data.slug || path.basename(entry.name, ".md")).trim();
    slugs.add(slug);

    const sourceUrl = normalizeSourceUrl(data.source_url || data.sourceUrl || "");
    if (sourceUrl) {
      bySourceUrl.set(sourceUrl, {
        slug,
        filePath: full,
        raw,
        status: normalizeStatus(data.status),
        stocks: normalizeStringArray(data.stocks),
        cover: String(data.cover || "").trim()
      });
    }
  }

  return { bySourceUrl, slugs };
}

async function parseRecordMarkdown(filePath, recordType) {
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

  const categoryFromPath = inferCategoryFromPath(filePath);
  const type = String(metadata.type || recordType || "").trim().toLowerCase() || "answer";
  const body = bodyLines.join("\n").trim();
  const title = resolveRecordTitle({
    type,
    rawTitle,
    body
  });

  return {
    type,
    title,
    body,
    sourceUrl: metadata.link || "",
    sourcePlatform: "知乎",
    date: normalizeDate(metadata.date || ""),
    author: metadata.author || "",
    category: metadata.category || categoryFromPath,
    tags: splitTags(metadata.tags || "")
  };
}

function resolveRecordTitle({ type, rawTitle, body }) {
  if (type !== "pin") {
    return rawTitle || "未命名内容";
  }

  const compactTitle = normalizeTextForTitle(rawTitle);
  const shouldAutoGenerate =
    !compactTitle ||
    compactTitle.length > 34 ||
    compactTitle.includes("|") ||
    /<[^>]+>/.test(rawTitle) ||
    /作者[:：]|链接[:：]|来源[:：]/.test(compactTitle);

  if (!shouldAutoGenerate) {
    return rawTitle;
  }

  return `${buildAutoPinTitle(body || rawTitle)}（自动生成）`;
}

function buildAutoPinTitle(raw) {
  const text = normalizeTextForTitle(raw);
  if (!text) return "未命名想法";

  const chunks = text
    .split(/[。！？!?]/)
    .map((item) => item.trim())
    .filter(Boolean);

  let title = chunks.find((item) => item.length >= 6) || chunks[0] || text;
  if (title.length < 10 && chunks[1]) {
    title = `${title}：${chunks[1]}`;
  }

  title = title.replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").trim();
  if (title.length > 24) {
    title = `${title.slice(0, 24).replace(/[，,、；;：:\-]+$/g, "")}...`;
  }

  return title || "未命名想法";
}

function normalizeTextForTitle(raw) {
  return String(raw || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
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

function inferCategoryFromPath(filePath) {
  const parts = filePath.split(path.sep);
  const anchor = parts.lastIndexOf("by_category");
  if (anchor >= 0 && parts[anchor + 1]) {
    return parts[anchor + 1].trim();
  }
  return "未分类";
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

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return unique(
    value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  );
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim();
  if (normalized === "read" || normalized === "favorite") return normalized;
  return "unread";
}

function normalizeTags(tags, category, recordType) {
  const output = [...tags];
  const typeTag = resolveTypeTag(recordType);
  if (typeTag && !output.includes(typeTag)) {
    output.unshift(typeTag);
  }
  if (category && category !== "待整理" && !output.includes(category)) {
    output.push(category);
  }
  return unique(output);
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
  const fromUrl = parsed.sourceUrl.match(/\/answer\/(\d+)/);
  if (fromUrl) {
    return `zhihu-answer-${fromUrl[1]}`;
  }

  const pinUrl = parsed.sourceUrl.match(/\/pin\/(\d+)/);
  if (pinUrl) {
    return `zhihu-pin-${pinUrl[1]}`;
  }

  const articleUrl = parsed.sourceUrl.match(/\/p\/(\d+)/);
  if (articleUrl) {
    return `zhihu-article-${articleUrl[1]}`;
  }

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
  return `zhihu-answer-${hash}`;
}

function ensureUniqueSlug(baseSlug, usedSlugs) {
  if (!usedSlugs.has(baseSlug)) return baseSlug;
  let index = 2;
  while (usedSlugs.has(`${baseSlug}-${index}`)) {
    index += 1;
  }
  return `${baseSlug}-${index}`;
}

async function rewriteAndCopyLocalImages({ markdown, sourceMarkdownPath, slug, dryRun }) {
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
    const destinationAbs = path.join(articlesDir, destinationRel);
    if (!dryRun) {
      pendingCopies.push(
        fs.mkdir(path.dirname(destinationAbs), { recursive: true }).then(() => fs.copyFile(sourceFile, destinationAbs))
      );
    }

    copied += 1;
    if (!firstCover) {
      firstCover = `/images/articles/${encodePathSegments(destinationRel)}`;
    }

    return `![${altText}](${destinationRel}${suffix})`;
  });

  if (!dryRun) {
    await Promise.all(pendingCopies);
  }

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
    // keep original
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

function encodePathSegments(value) {
  return value
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function unique(items) {
  return [...new Set(items)];
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
