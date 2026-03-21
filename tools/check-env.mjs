#!/usr/bin/env node
import path from "node:path";
import { promises as fs, readFileSync } from "node:fs";

const ROOT_DIR = process.cwd();
const REPORT_DIR = path.join(ROOT_DIR, "raw", "sync-reports");

main().catch((error) => {
  console.error(`[check:env] ${formatError(error)}`);
  process.exitCode = 1;
});

async function main() {
  loadEnvFiles();
  const options = parseArgs(process.argv.slice(2));

  const baseRequired = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  ];
  const articleSourceMode = String(process.env.ARTICLE_SOURCE || "local").trim().toLowerCase();
  const articleSourceRequired =
    articleSourceMode === "github"
      ? ["ARTICLE_GITHUB_OWNER", "ARTICLE_GITHUB_REPO"]
      : [];
  const targetRequired =
    options.target === "prod"
      ? [...baseRequired, "CONTENT_SYNC_DATABASE_URL_PROD", "SUPABASE_SERVICE_ROLE_KEY"]
      : ["CONTENT_SYNC_DATABASE_URL_DEV"];

  const required = [...new Set([...baseRequired, ...targetRequired, ...articleSourceRequired])];
  const missing = required.filter((name) => !String(process.env[name] || "").trim());

  const checks = [];
  if (options.target === "dev") {
    for (const key of baseRequired) {
      if (!String(process.env[key] || "").trim()) {
        checks.push(`开发环境缺少 ${key}，将降级为本地模式（不影响文章构建）。`);
      }
    }
  }
  if (options.target === "prod") {
    const prodDb = String(process.env.CONTENT_SYNC_DATABASE_URL_PROD || "").trim();
    if (prodDb && /(127\.0\.0\.1|localhost|54322|55432)/.test(prodDb)) {
      checks.push("生产数据库地址看起来仍是本地地址，请确认已改为远端生产库。");
    }
  }
  if (articleSourceMode === "github") {
    const githubToken = String(process.env.ARTICLE_GITHUB_TOKEN || "").trim();
    if (!githubToken) {
      checks.push("ARTICLE_SOURCE=github 但未设置 ARTICLE_GITHUB_TOKEN，生产环境可能触发 GitHub 匿名限流。");
    }
  }

  const report = {
    tool: "check-env",
    generatedAt: new Date().toISOString(),
    batchId: options.batchId,
    options,
    required,
    missing,
    warnings: checks,
    status: missing.length === 0 ? "pass" : "fail",
    sample: {
      NEXT_PUBLIC_SUPABASE_URL: maskUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || ""),
      CONTENT_SYNC_DATABASE_URL_DEV: maskUrl(process.env.CONTENT_SYNC_DATABASE_URL_DEV || ""),
      CONTENT_SYNC_DATABASE_URL_PROD: maskUrl(process.env.CONTENT_SYNC_DATABASE_URL_PROD || ""),
      ARTICLE_SOURCE: articleSourceMode || "local",
      ARTICLE_GITHUB_OWNER: process.env.ARTICLE_GITHUB_OWNER || "",
      ARTICLE_GITHUB_REPO: process.env.ARTICLE_GITHUB_REPO || ""
    }
  };

  await writeReport(options.batchId, report);

  if (missing.length > 0) {
    throw new Error(`缺少环境变量：${missing.join(", ")}`);
  }

  if (checks.length > 0) {
    for (const warning of checks) {
      console.warn(`[check:env] warning: ${warning}`);
    }
  }

  console.log(`[check:env] target=${options.target} status=pass`);
  console.log(`[check:env] report=raw/sync-reports/check-env-${options.batchId}.json`);
}

function parseArgs(args) {
  const options = {
    target: process.env.CONTENT_SYNC_TARGET || "dev",
    batchId: buildBatchId()
  };

  for (const arg of args) {
    const match = arg.match(/^--([a-zA-Z0-9_-]+)=(.*)$/);
    if (!match) {
      throw new Error(`Unsupported argument: ${arg}`);
    }
    const [, key, value] = match;
    if (key === "target") {
      options.target = value || options.target;
      continue;
    }
    if (key === "batch-id") {
      options.batchId = value || options.batchId;
      continue;
    }
    throw new Error(`Unsupported flag: --${key}`);
  }

  if (!["dev", "prod"].includes(options.target)) {
    throw new Error(`--target only supports dev/prod, got: ${options.target}`);
  }

  return options;
}

function maskUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const user = parsed.username ? `${parsed.username}:***@` : "";
    return `${parsed.protocol}//${user}${parsed.host}${parsed.pathname}`;
  } catch {
    return raw.length > 24 ? `${raw.slice(0, 8)}...${raw.slice(-6)}` : "***";
  }
}

function loadEnvFiles() {
  const candidates = [".env.local", ".env"];
  for (const fileName of candidates) {
    const filePath = path.join(ROOT_DIR, fileName);
    let raw = "";
    try {
      raw = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1];
      if (process.env[key]) continue;
      process.env[key] = stripQuotes(match[2].trim());
    }
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function writeReport(batchId, report) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `check-env-${batchId}.json`);
  const latestPath = path.join(REPORT_DIR, "latest-check-env.json");
  const body = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(reportPath, body, "utf8");
  await fs.writeFile(latestPath, body, "utf8");
}

function buildBatchId() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function formatError(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
