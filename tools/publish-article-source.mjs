#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT_DIR = process.cwd();
const EXPORT_ROOT = path.join(ROOT_DIR, "dist", "article-source");
const EXPORT_ARTICLES_DIR = path.join(EXPORT_ROOT, "content", "articles");
const DEFAULT_BRANCH = "article-source";

await loadLocalEnvFiles();
await ensureExportBundle();

const publishSourceDir = resolvePublishSourceDir();
const remoteUrl = resolvePublishRemoteUrl();
const branch = String(process.env.ARTICLE_SOURCE_PUBLISH_BRANCH || DEFAULT_BRANCH).trim() || DEFAULT_BRANCH;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "article-source-publish-"));
const publishRepoDir = path.join(tempRoot, "repo");

try {
  await fs.mkdir(publishRepoDir, { recursive: true });

  run("git", ["init"], { cwd: publishRepoDir });
  run("git", ["remote", "add", "origin", remoteUrl], { cwd: publishRepoDir });

  const branchExists = run("git", ["ls-remote", "--exit-code", "--heads", remoteUrl, branch], {
    cwd: publishRepoDir,
    allowFailure: true,
    stdio: "pipe"
  }).status === 0;

  if (branchExists) {
    run("git", ["fetch", "--depth", "1", "origin", branch], { cwd: publishRepoDir });
    run("git", ["checkout", "-B", branch, "FETCH_HEAD"], { cwd: publishRepoDir });
  } else {
    run("git", ["checkout", "--orphan", branch], { cwd: publishRepoDir });
  }

  await clearDirectory(publishRepoDir, [".git"]);
  await copyDirectoryContents(publishSourceDir, publishRepoDir);

  run("git", ["add", "-A"], { cwd: publishRepoDir });

  const diff = run("git", ["diff", "--cached", "--quiet"], {
    cwd: publishRepoDir,
    allowFailure: true,
    stdio: "pipe"
  });
  if (diff.status === 0) {
    console.log(`[publish:article-source] no changes detected on branch ${branch}`);
    process.exit(0);
  }

  const userName = resolveGitConfig("user.name", "Codex");
  const userEmail = resolveGitConfig("user.email", "codex@local");
  run("git", ["config", "user.name", userName], { cwd: publishRepoDir });
  run("git", ["config", "user.email", userEmail], { cwd: publishRepoDir });

  const articleCount = await countMarkdownFiles(EXPORT_ARTICLES_DIR);
  const commitMessage =
    String(process.env.ARTICLE_SOURCE_PUBLISH_MESSAGE || "").trim() ||
    `chore: publish article source (${articleCount} articles)`;

  run("git", ["commit", "-m", commitMessage], { cwd: publishRepoDir });
  run("git", ["push", "-u", "origin", branch], { cwd: publishRepoDir });

  console.log(`[publish:article-source] remote=${remoteUrl}`);
  console.log(`[publish:article-source] branch=${branch}`);
  console.log(`[publish:article-source] published articles=${articleCount}`);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function ensureExportBundle() {
  const skipExport = String(process.env.ARTICLE_SOURCE_PUBLISH_SKIP_EXPORT || "").trim() === "true";
  if (skipExport && (await exists(EXPORT_ARTICLES_DIR))) {
    return;
  }

  run(process.execPath, ["tools/export-article-source.mjs"], { cwd: ROOT_DIR });
}

function resolvePublishRemoteUrl() {
  const explicitUrl = String(process.env.ARTICLE_SOURCE_PUBLISH_REMOTE_URL || "").trim();
  if (explicitUrl) return explicitUrl;

  const remoteName = String(process.env.ARTICLE_SOURCE_PUBLISH_REMOTE || "origin").trim() || "origin";
  const result = run("git", ["remote", "get-url", remoteName], {
    cwd: ROOT_DIR,
    stdio: "pipe"
  });
  return result.stdout.trim();
}

function resolvePublishSourceDir() {
  const publishSource = String(process.env.ARTICLE_SOURCE_PUBLISH_SOURCE || "").trim();
  if (publishSource === "articles-root") {
    return EXPORT_ARTICLES_DIR;
  }

  const customSourceDir = String(process.env.ARTICLE_SOURCE_PUBLISH_SOURCE_DIR || "").trim();
  if (customSourceDir) {
    return path.isAbsolute(customSourceDir) ? customSourceDir : path.join(ROOT_DIR, customSourceDir);
  }

  return EXPORT_ROOT;
}

function resolveGitConfig(key, fallback) {
  const result = run("git", ["config", "--get", key], {
    cwd: ROOT_DIR,
    allowFailure: true,
    stdio: "pipe"
  });
  return result.status === 0 ? result.stdout.trim() || fallback : fallback;
}

async function clearDirectory(targetDir, keepEntries = []) {
  const keep = new Set(keepEntries);
  const entries = await fs.readdir(targetDir);
  await Promise.all(
    entries.map(async (entry) => {
      if (keep.has(entry)) return;
      await fs.rm(path.join(targetDir, entry), { recursive: true, force: true });
    })
  );
}

async function copyDirectoryContents(sourceDir, targetDir) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    await fs.cp(sourcePath, targetPath, { recursive: true });
  }
}

async function countMarkdownFiles(targetDir) {
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    const entryPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      count += await countMarkdownFiles(entryPath);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      count += 1;
    }
  }

  return count;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function loadLocalEnvFiles() {
  await loadEnvFile(path.join(ROOT_DIR, ".env.local"));
  await loadEnvFile(path.join(ROOT_DIR, ".env"));
}

async function loadEnvFile(filePath) {
  let source = "";
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT_DIR,
    encoding: "utf8",
    stdio: options.stdio || "inherit"
  });

  if (!options.allowFailure && result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    const output = [stdout, stderr].filter(Boolean).join("\n");
    throw new Error(output || `${command} ${args.join(" ")} failed with status ${result.status}`);
  }

  return result;
}
