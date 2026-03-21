#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(process.cwd());
const articlesDir = path.join(rootDir, "content", "articles");

const REQUIRED_FIELDS = ["slug", "title", "date"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

main().catch((error) => {
  console.error(`校验失败：${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const files = await listMarkdownFiles(articlesDir);
  if (!files.length) {
    console.log("未发现文章文件（content/articles/*.md）。");
    return;
  }

  const errors = [];
  const slugToFile = new Map();

  for (const fileName of files) {
    const filePath = path.join(articlesDir, fileName);
    const source = await fs.readFile(filePath, "utf8");
    const { meta } = parseFrontMatter(source);

    for (const field of REQUIRED_FIELDS) {
      if (!meta[field] || String(meta[field]).trim() === "") {
        errors.push(`${fileName}: 缺少必填字段 ${field}`);
      }
    }

    const slug = String(meta.slug || "").trim();
    const date = String(meta.date || "").trim();

    if (slug && !SLUG_PATTERN.test(slug)) {
      errors.push(`${fileName}: slug 格式非法（只允许 a-z, 0-9, -） -> ${slug}`);
    }

    if (date && !DATE_PATTERN.test(date)) {
      errors.push(`${fileName}: date 格式非法（必须 YYYY-MM-DD） -> ${date}`);
    }

    if (slug) {
      if (slugToFile.has(slug)) {
        errors.push(`${fileName}: slug 重复，已被 ${slugToFile.get(slug)} 使用 -> ${slug}`);
      } else {
        slugToFile.set(slug, fileName);
      }
    }
  }

  if (errors.length) {
    console.error(`发现 ${errors.length} 个问题：`);
    for (const issue of errors) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`校验通过：${files.length} 篇文章元数据合法。`);
}

async function listMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

function parseFrontMatter(source) {
  if (!source.startsWith("---\n")) {
    return { meta: {}, body: source };
  }

  const end = source.indexOf("\n---\n", 4);
  if (end === -1) {
    return { meta: {}, body: source };
  }

  const raw = source.slice(4, end).split("\n");
  const body = source.slice(end + 5);
  const meta = {};

  let currentArrayKey = null;
  for (const line of raw) {
    if (!line.trim()) continue;

    const arrayMatch = line.match(/^\s*-\s+(.*)$/);
    if (arrayMatch && currentArrayKey) {
      meta[currentArrayKey].push(stripQuotes(arrayMatch[1]));
      continue;
    }

    const pairMatch = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!pairMatch) continue;

    const key = pairMatch[1];
    const rawValue = pairMatch[2];

    if (!rawValue) {
      meta[key] = [];
      currentArrayKey = key;
      continue;
    }

    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      meta[key] = rawValue
        .slice(1, -1)
        .split(",")
        .map((item) => stripQuotes(item))
        .map((item) => item.trim())
        .filter(Boolean);
      currentArrayKey = null;
      continue;
    }

    meta[key] = stripQuotes(rawValue);
    currentArrayKey = null;
  }

  return { meta, body };
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
