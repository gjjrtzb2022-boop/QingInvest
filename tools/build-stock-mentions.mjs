#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const ROOT_DIR = process.cwd();
const ARTICLES_DIR = path.join(ROOT_DIR, "content", "articles");
const PUBLISHED_SLUGS_PATH = path.join(ARTICLES_DIR, "published-slugs.json");
const OUTPUT_PATH = path.join(ROOT_DIR, "content", "stocks-mentions.json");
const STOCKS_FILE = path.join(ROOT_DIR, "lib", "stocks.ts");
const STOCKS_DATA = await readStockProfiles(STOCKS_FILE);
const PUBLISHED_SLUGS = new Set(await readPublishedSlugs(PUBLISHED_SLUGS_PATH));

const TOKEN_STOPWORDS = new Set([
  "银行",
  "证券",
  "白酒",
  "中铁",
  "中冶",
  "神华",
  "茅台",
  "五粮液",
  "财富",
  "空调",
  "金店"
]);

const files = (await fs.readdir(ARTICLES_DIR))
  .filter((name) => name.endsWith(".md"))
  .sort((a, b) => a.localeCompare(b, "zh-CN"));

const output = {
  generatedAt: new Date().toISOString(),
  method: "frontmatter+title+summary+body-token-match",
  corpus: {
    allArticleCount: files.length,
    publishedArticleCount: PUBLISHED_SLUGS.size
  },
  stats: {}
};

for (const stock of STOCKS_DATA) {
  output.stats[stock.code] = {
    mentionCount: 0,
    lastMentionDate: "",
    publishedMentionCount: 0,
    publishedLastMentionDate: ""
  };
}

for (const fileName of files) {
  const absolutePath = path.join(ARTICLES_DIR, fileName);
  const slug = fileName.replace(/\.md$/i, "");
  const isPublished = PUBLISHED_SLUGS.has(slug);
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = matter(raw);
  const placeholderStatus = String(parsed.data?.placeholder_status || parsed.data?.placeholderStatus || "").trim();
  if (placeholderStatus && placeholderStatus !== "none") {
    continue;
  }
  const date = normalizeDate(parsed.data?.date);
  const frontStocks = toStringArray(parsed.data?.stocks).map((item) => item.toLowerCase());
  const textPool = [
    String(parsed.data?.title || ""),
    String(parsed.data?.summary || ""),
    parsed.content || ""
  ]
    .join("\n")
    .toLowerCase();

  for (const stock of STOCKS_DATA) {
    const target = output.stats[stock.code];
    if (!target) continue;
    if (isMentioned(stock, frontStocks, textPool)) {
      target.mentionCount += 1;
      if (date && (!target.lastMentionDate || date > target.lastMentionDate)) {
        target.lastMentionDate = date;
      }
      if (isPublished) {
        target.publishedMentionCount += 1;
        if (date && (!target.publishedLastMentionDate || date > target.publishedLastMentionDate)) {
          target.publishedLastMentionDate = date;
        }
      }
    }
  }
}

await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`[build:stock-mentions] wrote ${OUTPUT_PATH}`);
console.log(
  `[build:stock-mentions] stocks=${Object.keys(output.stats).length} files=${files.length}`
);

function isMentioned(stock, frontStocks, textPool) {
  const codeRaw = stock.code.toLowerCase();
  const codeNumeric = codeRaw.split(".")[0];
  const stockName = stock.name.toLowerCase();

  if (frontStocks.includes(codeRaw) || frontStocks.includes(codeNumeric) || frontStocks.includes(stockName)) {
    return true;
  }

  const tokens = buildSearchTokens(stock);
  return tokens.some((token) => textPool.includes(token));
}

function buildSearchTokens(stock) {
  const tokens = [stock.name, ...(stock.aliases || [])]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      if (TOKEN_STOPWORDS.has(item)) return false;
      // Keep Chinese aliases with length >= 2.
      if (/[\u4e00-\u9fff]/.test(item)) {
        return item.length >= 2;
      }
      // Keep latin/digit aliases with length >= 4 to avoid noisy matches.
      return item.length >= 4;
    })
    .map((item) => item.toLowerCase());

  return [...new Set(tokens)];
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const short = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(short)) return short;
  return "";
}

async function readPublishedSlugs(filePath) {
  try {
    const source = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
    if (Array.isArray(parsed?.slugs)) {
      return parsed.slugs.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    return [];
  }
  return [];
}

async function readStockProfiles(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  const matches = source.matchAll(
    /\{\s*code:\s*"([^"]+)"[\s\S]*?name:\s*"([^"]+)"[\s\S]*?aliases:\s*\[([^\]]*)\]/g
  );

  const rows = [];
  for (const match of matches) {
    const code = String(match[1] || "").trim();
    const name = String(match[2] || "").trim();
    const aliasesRaw = String(match[3] || "");
    const aliases = [...aliasesRaw.matchAll(/"([^"]+)"/g)]
      .map((item) => item[1])
      .filter(Boolean);
    if (!code || !name) continue;
    rows.push({ code, name, aliases });
  }

  return rows;
}
