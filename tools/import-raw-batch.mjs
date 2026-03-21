#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(process.cwd());
const importScript = path.join(rootDir, "tools", "import-article.mjs");

const HELP_TEXT = `
批量导入 raw 目录的 TXT 原文

用法：
  node tools/import-raw-batch.mjs [可选参数]

可选参数：
  --dir=目录          原文目录，默认 raw
  --recursive         递归扫描子目录（默认否）
  --dry-run           预览模式，不写入 content/articles
  --archive           导入成功后移动到 raw/_imported
  --limit=N           最多处理 N 个文件
  --help              查看帮助
`;

main().catch((error) => {
  console.error(`批量导入失败：${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP_TEXT.trim());
    return;
  }

  const rawDir = path.resolve(rootDir, options.dir);
  const exists = await pathExists(rawDir);
  if (!exists) {
    console.log(`原文目录不存在：${rawDir}`);
    console.log("请先创建目录并放入 .txt 文件，例如 raw/2026-02-27-01.txt");
    return;
  }

  const files = await collectRawFiles(rawDir, options.recursive);
  if (!files.length) {
    console.log(`未找到可导入文件（目录：${rawDir}）。`);
    return;
  }

  const targetFiles = options.limit > 0 ? files.slice(0, options.limit) : files;
  console.log(`准备处理 ${targetFiles.length} 个文件（目录：${rawDir}）`);
  if (options.dryRun) {
    console.log("当前为预览模式，不会写入文章文件。");
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < targetFiles.length; i += 1) {
    const filePath = targetFiles[i];
    const relative = path.relative(rootDir, filePath);
    console.log(`\n[${i + 1}/${targetFiles.length}] ${relative}`);

    const result = runSingleImport(filePath, options.dryRun);
    if (!result.ok) {
      failed += 1;
      console.error(result.message);
      continue;
    }

    success += 1;
    console.log(result.message);

    if (options.archive && !options.dryRun) {
      const archived = await archiveRawFile(filePath, rawDir);
      console.log(`已归档原文：${path.relative(rootDir, archived)}`);
    }
  }

  console.log(`\n批量导入完成：成功 ${success}，失败 ${failed}。`);
  if (!options.dryRun) {
    console.log("建议下一步：npm run validate:articles && npm run build:articles");
  }
}

function parseArgs(args) {
  const options = {
    dir: "raw",
    recursive: false,
    dryRun: false,
    archive: false,
    limit: 0,
    help: false
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--recursive") {
      options.recursive = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--archive") {
      options.archive = true;
      continue;
    }

    const pair = arg.match(/^--([a-zA-Z0-9_-]+)=(.*)$/);
    if (!pair) {
      throw new Error(`无法识别参数：${arg}`);
    }

    const key = pair[1];
    const value = pair[2];
    if (key === "dir") {
      options.dir = value || "raw";
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

    throw new Error(`不支持参数 --${key}`);
  }

  return options;
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function collectRawFiles(dir, recursive) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!recursive) continue;
      if (entry.name === "_imported") continue;
      const sub = await collectRawFiles(full, recursive);
      out.push(...sub);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".txt")) continue;
    out.push(full);
  }

  return out.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function runSingleImport(filePath, dryRun) {
  const args = [importScript, filePath];
  if (dryRun) {
    args.push("--dry-run");
  }

  const result = spawnSync(process.execPath, args, { cwd: rootDir, encoding: "utf8" });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");

  if (result.status !== 0) {
    const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    return { ok: false, message: detail || "导入命令执行失败" };
  }

  if (dryRun) {
    const previewLine = stdout
      .split(/\r?\n/)
      .find((line) => line.includes("预览模式：将写入"));
    return { ok: true, message: previewLine || "预览成功" };
  }

  const createLine = stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("已创建："));
  return { ok: true, message: createLine || "导入成功" };
}

async function archiveRawFile(filePath, rawDir) {
  const archiveRoot = path.join(rawDir, "_imported");
  const relative = path.relative(rawDir, filePath);
  let target = path.join(archiveRoot, relative);

  await fs.mkdir(path.dirname(target), { recursive: true });

  if (await pathExists(target)) {
    const ext = path.extname(relative);
    const name = relative.slice(0, ext ? -ext.length : undefined);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    target = path.join(archiveRoot, `${name}-${stamp}${ext}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
  }

  await fs.rename(filePath, target);
  return target;
}

