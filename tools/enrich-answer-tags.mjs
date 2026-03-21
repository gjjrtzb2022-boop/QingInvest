#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { buildAnswerIndustries, buildAnswerTags } from "./answer-tagging.mjs";

const rootDir = process.cwd();
const articlesDir = path.join(rootDir, "content", "articles");

main().catch((error) => {
  console.error(`补全标签失败：${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const files = await collectMarkdownFiles(articlesDir);
  let scanned = 0;
  let updatedTags = 0;
  let updatedIndustries = 0;

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = matter(raw);
    const sourceUrl = String(parsed.data.source_url || parsed.data.sourceUrl || "").trim();
    if (!/\/answer\//.test(sourceUrl)) continue;

    scanned += 1;
    const existingTags = normalizeArray(parsed.data.tags);
    const existingIndustries = normalizeArray(parsed.data.industries);
    const nextTags = buildAnswerTags({
      title: String(parsed.data.title || ""),
      body: parsed.content,
      category: String(parsed.data.category || parsed.data.series || ""),
      existingTags
    });
    const nextIndustries = buildAnswerIndustries({
      title: String(parsed.data.title || ""),
      body: parsed.content,
      category: String(parsed.data.category || parsed.data.series || ""),
      existing: existingIndustries
    });

    if (isSame(existingTags, nextTags) && isSame(existingIndustries, nextIndustries)) {
      continue;
    }

    let nextRaw = replaceFieldListInFrontmatter(raw, "tags", nextTags);
    nextRaw = replaceFieldListInFrontmatter(nextRaw, "industries", nextIndustries);
    if (nextRaw !== raw) {
      await fs.writeFile(filePath, nextRaw, "utf8");
      if (!isSame(existingTags, nextTags)) updatedTags += 1;
      if (!isSame(existingIndustries, nextIndustries)) updatedIndustries += 1;
    }
  }

  console.log(
    `处理完成：扫描 ${scanned} 篇回答，更新标签 ${updatedTags} 篇，更新行业 ${updatedIndustries} 篇。`
  );
}

async function collectMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[，,、|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function replaceFieldListInFrontmatter(raw, key, values) {
  if (!raw.startsWith("---\n")) return raw;
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return raw;

  const frontmatter = raw.slice(4, end);
  const lines = frontmatter.split("\n");
  const fieldLines = renderFieldLines(key, values);

  let start = -1;
  let finish = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (new RegExp(`^${key}:\\s*`).test(lines[i])) {
      start = i;
      finish = i + 1;
      if (!/\[\s*]/.test(lines[i])) {
        while (finish < lines.length && /^\s*-\s+/.test(lines[finish])) {
          finish += 1;
        }
      }
      break;
    }
  }

  if (start === -1) {
    const insertBefore = lines.findIndex((line) => /^(stocks|cover|summary):/.test(line));
    const index = insertBefore === -1 ? lines.length : insertBefore;
    lines.splice(index, 0, ...fieldLines);
  } else {
    lines.splice(start, finish - start, ...fieldLines);
  }

  const rewritten = lines.join("\n");
  return `${raw.slice(0, 4)}${rewritten}${raw.slice(end)}`;
}

function renderFieldLines(key, values) {
  if (!values.length) return [`${key}: []`];
  return [`${key}:`, ...values.map((item) => `  - "${escapeYaml(item)}"`)];
}

function escapeYaml(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function isSame(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
