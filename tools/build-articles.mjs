import { promises as fs } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(process.cwd());
const articlesDir = path.join(rootDir, "content", "articles");
const indexPath = path.join(articlesDir, "index.json");

const REQUIRED_FIELDS = ["slug", "title", "date"];

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

function createSummary(body, fallback) {
  if (fallback) return fallback;
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.length > 140 ? `${compact.slice(0, 140)}...` : compact;
}

function ensureArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

async function build() {
  const entries = await fs.readdir(articlesDir, { withFileTypes: true });
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  const index = [];

  for (const fileName of markdownFiles) {
    const filePath = path.join(articlesDir, fileName);
    const source = await fs.readFile(filePath, "utf8");
    const { meta, body } = parseFrontMatter(source);

    const slug = meta.slug;
    for (const field of REQUIRED_FIELDS) {
      if (!meta[field]) {
        throw new Error(`Missing required field \"${field}\" in ${fileName}`);
      }
    }

    index.push({
      slug,
      title: meta.title,
      date: meta.date,
      series: meta.series || "未分类专题",
      category: meta.category || "未分类",
      status: meta.status || "unread",
      tags: ensureArray(meta.tags),
      industries: ensureArray(meta.industries),
      stocks: ensureArray(meta.stocks),
      cover: meta.cover || "",
      summary: createSummary(body, meta.summary),
      path: `content/articles/${fileName}`,
      sourcePath: meta.source_path || meta.sourcePath || "",
      placeholderStatus: meta.placeholder_status || meta.placeholderStatus || "none"
    });
  }

  index.sort((a, b) => b.date.localeCompare(a.date));
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  console.log(`Generated ${index.length} articles -> ${indexPath}`);
}

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
