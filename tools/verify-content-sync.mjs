#!/usr/bin/env node
import path from "node:path";
import { promises as fs } from "node:fs";
import matter from "gray-matter";

const ROOT_DIR = process.cwd();
const ARTICLES_DIR = path.join(ROOT_DIR, "content", "articles");
const REPORT_DIR = path.join(ROOT_DIR, "raw", "sync-reports");
const REQUIRED_FIELDS = ["slug", "title", "date", "series"];

main().catch((error) => {
  console.error(`[verify:content-sync] ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const markdownFiles = await collectMarkdownFiles(ARTICLES_DIR);
  if (options.ci && markdownFiles.length === 0) {
    throw new Error("CI 模式下未发现 Markdown 文章，已阻断后续流程。");
  }

  const frontMatterIssues = [];
  const imageMissingIssues = [];

  for (const filePath of markdownFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = matter(raw);
    const missingFields = REQUIRED_FIELDS.filter((field) => !hasMeaningfulValue(parsed.data[field]));
    if (missingFields.length > 0) {
      frontMatterIssues.push({
        file: path.relative(ROOT_DIR, filePath),
        missing: missingFields
      });
    }

    const localRefs = extractLocalImageRefs(parsed.content);
    for (const ref of localRefs) {
      const resolved = path.resolve(path.dirname(filePath), ref);
      if (!(await pathExists(resolved))) {
        imageMissingIssues.push({
          file: path.relative(ROOT_DIR, filePath),
          ref,
          resolved: path.relative(ROOT_DIR, resolved)
        });
      }
    }
  }

  const report = {
    tool: "verify-content-sync",
    stage: "stage-1-bootstrap",
    generatedAt: new Date().toISOString(),
    batchId: options.batchId,
    options,
    scope: {
      source: "content/articles/**/*.md",
      fileCount: markdownFiles.length
    },
    checks: {
      requiredFrontMatter: REQUIRED_FIELDS,
      missingFrontMatterCount: frontMatterIssues.length,
      missingImageRefCount: imageMissingIssues.length
    },
    issues: {
      frontMatter: frontMatterIssues.slice(0, 80),
      missingImageRefs: imageMissingIssues.slice(0, 80)
    },
    status:
      frontMatterIssues.length === 0 && imageMissingIssues.length === 0
        ? "pass"
        : options.ci
          ? "fail"
          : "warn"
  };

  await writeReports("verify-content-sync", options.batchId, report);

  console.log(
    `[verify:content-sync] 文件=${markdownFiles.length} frontMatter缺失=${frontMatterIssues.length} 缺图=${imageMissingIssues.length}`
  );
  console.log(
    `[verify:content-sync] 报告输出：${path.join("raw", "sync-reports", `verify-content-sync-${options.batchId}.json`)}`
  );

  if (options.ci && (frontMatterIssues.length > 0 || imageMissingIssues.length > 0)) {
    throw new Error("CI 模式校验失败：存在 front matter 缺失或图片引用缺失。");
  }
}

function parseArgs(args) {
  const options = {
    target: process.env.CONTENT_SYNC_TARGET || "dev",
    ci: false,
    batchId: buildBatchId()
  };

  for (const arg of args) {
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
    if (key === "batch-id") {
      options.batchId = value || options.batchId;
      continue;
    }

    throw new Error(`不支持参数：--${key}`);
  }

  return options;
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

function extractLocalImageRefs(markdown) {
  const refs = [];
  const regex = /!\[[^\]]*]\(([^)]+)\)/g;
  let match = regex.exec(markdown);

  while (match) {
    const rawRef = (match[1] || "").trim();
    if (!rawRef) {
      match = regex.exec(markdown);
      continue;
    }

    const ref = normalizeRef(rawRef);
    if (!ref || isRemoteRef(ref)) {
      match = regex.exec(markdown);
      continue;
    }

    refs.push(ref);
    match = regex.exec(markdown);
  }

  return refs;
}

function normalizeRef(ref) {
  let output = ref;
  output = output.replace(/^<|>$/g, "");
  output = output.replace(/^["']|["']$/g, "");
  output = output.split("?")[0];
  output = output.split("#")[0];
  return output.trim();
}

function isRemoteRef(ref) {
  return /^(https?:)?\/\//i.test(ref) || ref.startsWith("data:");
}

function hasMeaningfulValue(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return Boolean(value);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
