import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
await loadLocalEnvFiles();

const imageExt = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".svg"]);
const articleSourceMode = process.env.ARTICLE_SOURCE === "github" ? "github" : "local";
const syncPairs = [
  { source: path.join(root, "content", "covers"), target: path.join(root, "public", "covers"), label: "covers" },
  { source: path.join(root, "content", "images"), target: path.join(root, "public", "images"), label: "images" }
];

for (const pair of syncPairs) {
  await fs.mkdir(pair.source, { recursive: true });
  await fs.rm(pair.target, { recursive: true, force: true });
  await fs.mkdir(pair.target, { recursive: true });
  await copyDir(pair.source, pair.target);
  console.log(`Synced ${pair.label}: ${pair.source} -> ${pair.target}`);
}

if (articleSourceMode === "github") {
  await fs.rm(path.join(root, "public", "images", "articles"), { recursive: true, force: true });
  console.log("Skipped article image sync because ARTICLE_SOURCE=github");
} else {
  await syncArticleImages(
    path.join(root, "content", "articles"),
    path.join(root, "public", "images", "articles")
  );
}

async function copyDir(source, target) {
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      await copyDir(from, to);
      continue;
    }
    await fs.copyFile(from, to);
  }
}

async function syncArticleImages(sourceRoot, targetRoot) {
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });

  const count = await copyImageFilesOnly(sourceRoot, targetRoot);
  console.log(`Synced article images: ${sourceRoot} -> ${targetRoot} (${count})`);
}

async function copyImageFilesOnly(source, target) {
  const entries = await fs.readdir(source, { withFileTypes: true });
  let copied = 0;

  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      copied += await copyImageFilesOnly(from, to);
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!imageExt.has(ext)) continue;

    await fs.copyFile(from, to);
    copied += 1;
  }

  return copied;
}

async function loadLocalEnvFiles() {
  await loadEnvFile(path.join(root, ".env.local"));
  await loadEnvFile(path.join(root, ".env"));
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
