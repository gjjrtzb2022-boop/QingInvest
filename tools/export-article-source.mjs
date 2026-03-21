#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const ROOT_DIR = process.cwd();
const SOURCE_DIR = path.join(ROOT_DIR, "content", "articles");
const TARGET_DIR = path.join(ROOT_DIR, "dist", "article-source", "content", "articles");
const SOURCE_INDEX_PATH = path.join(SOURCE_DIR, "index.json");
const SOURCE_PUBLISHED_PATH = path.join(SOURCE_DIR, "published-slugs.json");
const QINGYI_SOURCE_ROOT = path.join(
  ROOT_DIR,
  "山长知乎文章爬取",
  "清一投资号文章",
  "output_final",
  "04_专题归类_按链接汇总"
);

await fs.rm(path.join(ROOT_DIR, "dist", "article-source"), { recursive: true, force: true });
await fs.mkdir(TARGET_DIR, { recursive: true });

const sourceIndex = JSON.parse(await fs.readFile(SOURCE_INDEX_PATH, "utf8"));
const publishedSlugs = JSON.parse(await fs.readFile(SOURCE_PUBLISHED_PATH, "utf8"));
const originalPathMap = await buildOriginalPathMap(QINGYI_SOURCE_ROOT);

const exportedIndex = [];

for (const entry of sourceIndex) {
  const slug = String(entry.slug || "").trim();
  if (!slug) continue;

  const sourceMarkdownPath = path.join(SOURCE_DIR, `${slug}.md`);
  const rawMarkdown = await fs.readFile(sourceMarkdownPath, "utf8");
  const parsed = matter(rawMarkdown);
  const sourceUrl = String(parsed.data.source_url || parsed.data.sourceUrl || "").trim();
  const sourcePath = normalizeOriginalSourcePath(String(parsed.data.source_path || parsed.data.sourcePath || "").trim());

  const exportMarkdownRelPath = buildExportMarkdownPath({
    slug,
    title: String(parsed.data.title || entry.title || slug).trim(),
    series: String(parsed.data.series || entry.series || "未分类专题").trim(),
    category: String(parsed.data.category || entry.category || "未分类").trim(),
    sourcePath,
    originalPathMap,
    sourceUrl
  });

  const exportDirRel = path.posix.dirname(exportMarkdownRelPath);
  const rewrittenBody = rewriteMarkdownForPrettyExport(parsed.content, slug);
  const rewrittenCover = rewriteCoverForPrettyExport(String(parsed.data.cover || entry.cover || "").trim(), slug);
  const nextData = {
    ...parsed.data,
    cover: rewrittenCover
  };
  const outputMarkdown = matter.stringify(rewrittenBody, nextData, { lineWidth: 0 }).replace(/\r\n/g, "\n");

  const targetMarkdownPath = path.join(TARGET_DIR, exportMarkdownRelPath);
  await fs.mkdir(path.dirname(targetMarkdownPath), { recursive: true });
  await fs.writeFile(targetMarkdownPath, outputMarkdown, "utf8");

  const assetSourceDir = path.join(SOURCE_DIR, slug);
  if (await pathExists(assetSourceDir)) {
    await copyDirectoryContents(assetSourceDir, path.join(TARGET_DIR, exportDirRel));
  }

  exportedIndex.push({
    ...entry,
    cover: rewrittenCover,
    path: exportMarkdownRelPath
  });
}

await fs.writeFile(path.join(TARGET_DIR, "index.json"), `${JSON.stringify(exportedIndex, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(TARGET_DIR, "published-slugs.json"), `${JSON.stringify(publishedSlugs, null, 2)}\n`, "utf8");

const stats = await countTree(TARGET_DIR);
console.log(`[export:article-source] source=${SOURCE_DIR}`);
console.log(`[export:article-source] target=${TARGET_DIR}`);
console.log(`[export:article-source] directories=${stats.directories} files=${stats.files}`);

async function buildOriginalPathMap(rootDir) {
  const map = new Map();
  if (!(await pathExists(rootDir))) {
    return map;
  }

  const files = await collectMarkdownFiles(rootDir);
  for (const filePath of files) {
    const source = await fs.readFile(filePath, "utf8");
    const link = extractOriginalSourceUrl(source);
    if (!link) continue;
    const relative = path.relative(rootDir, filePath).split(path.sep).join("/");
    map.set(link, relative);
  }

  return map;
}

function extractOriginalSourceUrl(source) {
  const lines = String(source || "").replace(/\r/g, "").split("\n").slice(0, 20);
  for (const line of lines) {
    const match = line.trim().match(/^-\s*链接\s*[:：]\s*(.+)$/);
    if (match) {
      return match[1].trim();
    }
  }
  return "";
}

async function collectMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const output = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await collectMarkdownFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") {
      output.push(fullPath);
    }
  }

  return output;
}

function buildExportMarkdownPath({ slug, title, series, category, sourcePath, originalPathMap, sourceUrl }) {
  if (sourcePath) {
    return sourcePath;
  }

  const originalPath = sourceUrl ? originalPathMap.get(sourceUrl) : "";
  if (originalPath) {
    return originalPath;
  }

  const safeSeries = sanitizePathSegment(series || "未分类专题");
  const safeCategory = sanitizePathSegment(category || "未分类");
  const safeTitle = sanitizePathSegment(title || slug);
  return path.posix.join(safeSeries, safeCategory, safeTitle, `${safeTitle}.md`);
}

function sanitizePathSegment(value) {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|]/g, (char) => {
      const replacements = {
        "\\": "＼",
        "/": "／",
        ":": "：",
        "*": "＊",
        "?": "？",
        '"': "＂",
        "<": "＜",
        ">": "＞",
        "|": "｜"
      };
      return replacements[char] || "_";
    })
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim();

  return cleaned || "未命名";
}

function normalizeOriginalSourcePath(value) {
  const normalized = String(value || "").trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!normalized || normalized.startsWith("../")) {
    return "";
  }
  return normalized;
}

function rewriteMarkdownForPrettyExport(markdown, slug) {
  return String(markdown || "").replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (matched, altText, rawTarget) => {
    const { url, suffix } = splitMarkdownLinkTarget(rawTarget);
    const rewritten = rewriteLocalAssetReference(url, slug);
    if (!rewritten || rewritten === url) return matched;
    return `![${altText}](${rewritten}${suffix})`;
  });
}

function rewriteCoverForPrettyExport(cover, slug) {
  return rewriteLocalAssetReference(String(cover || "").trim(), slug);
}

function rewriteLocalAssetReference(value, slug) {
  const input = String(value || "").trim();
  if (!input) return input;
  if (/^(?:[a-z]+:)?\/\//i.test(input) || input.startsWith("/covers/") || input.startsWith("#")) {
    return input;
  }

  const decoded = tryDecodeURIComponent(input);
  const candidates = [input, decoded].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = candidate.replace(/\\/g, "/");

    const slugPrefix = `${slug}/`;
    if (normalized.startsWith(slugPrefix)) {
      return normalized.slice(slugPrefix.length);
    }

    const rootPrefix = `/images/articles/${slug}/`;
    if (normalized.startsWith(rootPrefix)) {
      return normalized.slice(rootPrefix.length);
    }

    const contentPrefix = `content/articles/${slug}/`;
    if (normalized.startsWith(contentPrefix)) {
      return normalized.slice(contentPrefix.length);
    }
  }

  return input;
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

  const firstWhitespace = value.search(/\s/);
  if (firstWhitespace === -1) {
    return { url: value, suffix: "" };
  }

  return {
    url: value.slice(0, firstWhitespace),
    suffix: value.slice(firstWhitespace)
  };
}

function tryDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function copyDirectoryContents(sourceDir, targetDir) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(targetPath, { recursive: true });
      await copyDirectoryContents(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) continue;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }
}

async function countTree(rootDir) {
  let files = 0;
  let directories = 0;
  const stack = [rootDir];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    directories += 1;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files += 1;
      }
    }
  }

  return { files, directories };
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
