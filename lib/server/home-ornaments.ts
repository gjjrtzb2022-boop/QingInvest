import { readFile } from "node:fs/promises";
import path from "node:path";
import { getStockCatalog } from "@/lib/server/stock-catalog";
import type { HomeMarketView, HomeOrnamentsPayload, HomeSentimentView, OrnamentIndexItem, OrnamentTone } from "@/lib/home-ornaments-types";

const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 12_000;
const TENCENT_CHUNK_SIZE = 420;
const TENCENT_CONCURRENCY = 4;
const TENCENT_HEADERS = {
  Referer: "https://gu.qq.com/",
  "User-Agent": "Mozilla/5.0",
  Accept: "*/*"
};
const EASTMONEY_HEADERS = {
  Referer: "https://quote.eastmoney.com/ztb/detail",
  "User-Agent": "Mozilla/5.0",
  Accept: "application/json, text/plain, */*"
};
const NEWS_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Accept: "text/html,application/xhtml+xml"
};

const MARKET_INDEX_GROUPS = {
  "a-share": ["sh000001", "sz399001", "sz399006"],
  hk: ["hkHSI", "hkHSCEI", "hkHSTECH"],
  us: ["usDJI", "usIXIC", "usINX"]
} as const;

type TencentQuote = {
  symbol: string;
  name: string;
  latestPrice: number | null;
  changePercent: number | null;
  changeAmount: number | null;
  high: number | null;
  low: number | null;
  updatedAtRaw: string;
};

type BreadthSnapshot = {
  total: number;
  received: number;
  up: number;
  down: number;
  flat: number;
};

type LimitPoolSnapshot = {
  upLimit: number;
  downLimit: number;
  tradeDate: string;
};

type NewsItem = {
  title: string;
  link: string;
};

type CacheEntry = {
  at: number;
  payload: HomeOrnamentsPayload;
};

type UniverseCacheEntry = {
  at: number;
  symbols: string[];
};

const cacheState: {
  entry: CacheEntry | null;
  inFlight: Promise<HomeOrnamentsPayload> | null;
} = {
  entry: null,
  inFlight: null
};

const universeCacheState: {
  entry: UniverseCacheEntry | null;
  inFlight: Promise<string[]> | null;
} = {
  entry: null,
  inFlight: null
};

export async function getHomeOrnamentsPayload(): Promise<HomeOrnamentsPayload> {
  const cached = cacheState.entry;
  if (cached && Date.now() - cached.at <= CACHE_TTL_MS) {
    return cached.payload;
  }

  if (!cacheState.inFlight) {
    cacheState.inFlight = buildHomeOrnamentsPayload()
      .then((payload) => {
        cacheState.entry = {
          at: Date.now(),
          payload
        };
        return payload;
      })
      .finally(() => {
        cacheState.inFlight = null;
      });
  }

  return cacheState.inFlight as Promise<HomeOrnamentsPayload>;
}

async function buildHomeOrnamentsPayload(): Promise<HomeOrnamentsPayload> {
  const [breadth, limitPool, marketQuotes, newsItems] = await Promise.all([
    fetchAshareBreadth(),
    fetchLimitPoolSnapshot(),
    fetchMarketIndexQuotes(),
    fetchMarketNews()
  ]);

  const fetchedAt = new Date().toISOString();
  const aShareIndices = buildIndexItems(MARKET_INDEX_GROUPS["a-share"], marketQuotes);
  const hkIndices = buildIndexItems(MARKET_INDEX_GROUPS.hk, marketQuotes);
  const usIndices = buildIndexItems(MARKET_INDEX_GROUPS.us, marketQuotes);

  const marketViews: HomeMarketView[] = [
    buildAShareView(breadth, limitPool, aShareIndices, latestAsOfFromSymbols(MARKET_INDEX_GROUPS["a-share"], marketQuotes)),
    buildIndexMarketView({
      key: "hk",
      label: "港股",
      name: "港股三大指数",
      indices: hkIndices,
      asOf: latestAsOfFromSymbols(MARKET_INDEX_GROUPS.hk, marketQuotes),
      notePrefix: "腾讯实时指数：恒生 / 国企 / 恒生科技"
    }),
    buildIndexMarketView({
      key: "us",
      label: "美股",
      name: "美股三大指数",
      indices: usIndices,
      asOf: latestAsOfFromSymbols(MARKET_INDEX_GROUPS.us, marketQuotes),
      notePrefix: "腾讯实时指数：道琼斯 / 纳指 / 标普500"
    })
  ];

  const sentimentViews = buildSentimentViews({
    breadth,
    limitPool,
    aShareIndices,
    newsItems,
    fetchedAt
  });

  return {
    ok: true,
    fetchedAt,
    marketViews,
    sentimentViews,
    sources: ["腾讯实时行情", "东方财富涨跌停池", "东方财富资讯精华"]
  };
}

async function fetchAshareBreadth(): Promise<BreadthSnapshot> {
  const symbols = await getAshareUniverseSymbols();

  const chunks = chunk(symbols, TENCENT_CHUNK_SIZE);
  const rawResponses = await mapWithConcurrency(chunks, TENCENT_CONCURRENCY, async (items) => {
    try {
      return await fetchTencentQuotes(items);
    } catch {
      return new Map<string, TencentQuote>();
    }
  });

  let received = 0;
  let up = 0;
  let down = 0;
  let flat = 0;

  for (const response of rawResponses) {
    for (const quote of response.values()) {
      if (quote.changePercent === null) continue;
      received += 1;
      if (quote.changePercent > 0.0001) {
        up += 1;
      } else if (quote.changePercent < -0.0001) {
        down += 1;
      } else {
        flat += 1;
      }
    }
  }

  if (received === 0) {
    throw new Error("a-share-breadth-unavailable");
  }

  return {
    total: symbols.length,
    received,
    up,
    down,
    flat
  };
}

async function getAshareUniverseSymbols() {
  const cached = universeCacheState.entry;
  if (cached && Date.now() - cached.at <= CACHE_TTL_MS) {
    return cached.symbols;
  }

  if (!universeCacheState.inFlight) {
    universeCacheState.inFlight = loadAshareUniverseSymbols()
      .then((symbols) => {
        universeCacheState.entry = {
          at: Date.now(),
          symbols
        };
        return symbols;
      })
      .finally(() => {
        universeCacheState.inFlight = null;
      });
  }

  return universeCacheState.inFlight as Promise<string[]>;
}

async function loadAshareUniverseSymbols() {
  const cachePath = path.join(process.cwd(), "raw", "stocks-cache", "a-share-universe-latest.json");

  try {
    const raw = await readFile(cachePath, "utf8");
    const payload = JSON.parse(raw) as {
      items?: Array<{
        code?: string;
        exchange?: string;
        is_active?: boolean;
      }>;
    };

    const symbols = (payload.items || [])
      .filter((item) => item?.is_active !== false)
      .map((item) => {
        const code = String(item?.code || "").trim();
        const exchange = String(item?.exchange || "").trim().toLowerCase();
        if (!/^\d{6}$/.test(code) || !/^(sh|sz|bj)$/.test(exchange)) {
          return "";
        }
        return `${exchange}${code}`;
      })
      .filter(Boolean);

    if (symbols.length > 1000) {
      return symbols;
    }
  } catch {
    // Fall back to the runtime catalog if the raw universe cache is unavailable.
  }

  const catalog = await getStockCatalog();
  return catalog
    .filter((item) => {
      const [code, market] = String(item.code || "").split(".");
      if (!/^\d{6}$/.test(code || "")) return false;
      if (!(market === "SH" || market === "SZ" || market === "BJ")) return false;
      return item.industry !== "指数" && item.industry !== "ETF";
    })
    .map((item) => {
      const [code, market] = String(item.code || "").split(".");
      return `${market.toLowerCase()}${code}`;
    });
}

async function fetchLimitPoolSnapshot(): Promise<LimitPoolSnapshot> {
  const compactDate = formatCompactDate(new Date().toISOString().slice(0, 10));
  const [upPayload, downPayload] = await Promise.all([
    fetchJsonWithRetry(`https://push2ex.eastmoney.com/getTopicZTPool?${new URLSearchParams({
      ut: "7eea3edcaed734bea9cbfc24409ed989",
      dpt: "wz.ztzt",
      Pageindex: "0",
      pagesize: "20",
      sort: "fbt:asc",
      date: compactDate
    }).toString()}`, EASTMONEY_HEADERS),
    fetchJsonWithRetry(`https://push2ex.eastmoney.com/getTopicDTPool?${new URLSearchParams({
      ut: "7eea3edcaed734bea9cbfc24409ed989",
      dpt: "wz.ztzt",
      Pageindex: "0",
      pagesize: "20",
      sort: "fund:asc",
      date: compactDate
    }).toString()}`, EASTMONEY_HEADERS)
  ]);

  const upCount = toNumber(upPayload?.data?.tc) ?? countFromPool(upPayload?.data?.pool) ?? 0;
  const downCount = toNumber(downPayload?.data?.tc) ?? countFromPool(downPayload?.data?.pool) ?? 0;
  const qdate = normalizeTradeDate(String(upPayload?.data?.qdate || downPayload?.data?.qdate || compactDate));

  return {
    upLimit: upCount,
    downLimit: downCount,
    tradeDate: qdate
  };
}

async function fetchMarketIndexQuotes() {
  const symbols = [...MARKET_INDEX_GROUPS["a-share"], ...MARKET_INDEX_GROUPS.hk, ...MARKET_INDEX_GROUPS.us];
  return fetchTencentQuotes(symbols);
}

async function fetchMarketNews(): Promise<NewsItem[]> {
  const html = await fetchTextWithRetry("https://finance.eastmoney.com/a/cywjh.html", NEWS_HEADERS);
  const pattern = /<li><span class="no">\d+<\/span>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/li>/g;
  const items: NewsItem[] = [];
  let match: RegExpExecArray | null = pattern.exec(html);

  while (match) {
    const title = decodeHtml(stripTags(match[2] || "")).trim();
    const link = decodeHtml((match[1] || "").trim());
    if (title && link) {
      items.push({ title, link });
    }
    match = pattern.exec(html);
  }

  return items.slice(0, 10);
}

function buildAShareView(
  breadth: BreadthSnapshot,
  limitPool: LimitPoolSnapshot,
  indices: OrnamentIndexItem[],
  asOf: string
): HomeMarketView {
  const coverageText = `${breadth.received}/${breadth.total}`;
  return {
    key: "a-share",
    label: "A股",
    name: "全市场广度",
    primary: {
      label: "上涨 / 下跌",
      value: `${formatCount(breadth.up)} / ${formatCount(breadth.down)}`,
      tone: breadth.up >= breadth.down ? "up" : "down"
    },
    secondary: {
      label: "涨停 / 跌停",
      value: `${limitPool.upLimit} / ${limitPool.downLimit}`,
      tone: limitPool.upLimit >= limitPool.downLimit ? "up" : "down"
    },
    indices,
    note: `${asOf} · 腾讯实时个股覆盖 ${coverageText}；涨跌停来自东方财富（交易日 ${limitPool.tradeDate}）`,
    asOf
  };
}

function buildIndexMarketView({
  key,
  label,
  name,
  indices,
  asOf,
  notePrefix
}: {
  key: string;
  label: string;
  name: string;
  indices: OrnamentIndexItem[];
  asOf: string;
  notePrefix: string;
}): HomeMarketView {
  const upCount = indices.filter((item) => item.tone === "up").length;
  const downCount = indices.filter((item) => item.tone === "down").length;
  const leader = pickLeader(indices);
  const leaderTone = leader?.tone ?? "neutral";
  return {
    key,
    label,
    name,
    primary: {
      label: "红盘 / 绿盘",
      value: `${upCount} / ${downCount}`,
      tone: upCount >= downCount ? "up" : "down"
    },
    secondary: {
      label: leader ? `${leader.tone === "down" ? "领跌指数" : "领涨指数"}` : "领涨指数",
      value: leader ? `${leader.name} ${leader.change}` : "暂无",
      tone: leaderTone
    },
    indices,
    note: `${asOf} · ${notePrefix}`,
    asOf
  };
}

function buildSentimentViews({
  breadth,
  limitPool,
  aShareIndices,
  newsItems,
  fetchedAt
}: {
  breadth: BreadthSnapshot;
  limitPool: LimitPoolSnapshot;
  aShareIndices: OrnamentIndexItem[];
  newsItems: NewsItem[];
  fetchedAt: string;
}): HomeSentimentView[] {
  const totalBreadth = Math.max(1, breadth.up + breadth.down + breadth.flat);
  const breadthRatio = (breadth.up + breadth.down) > 0 ? breadth.up / Math.max(1, breadth.up + breadth.down) : 0.5;
  const breadthScore = clamp(Math.round(breadthRatio * 100), 0, 100);
  const limitRatio = (limitPool.upLimit - limitPool.downLimit) / Math.max(1, limitPool.upLimit + limitPool.downLimit);
  const limitScore = clamp(Math.round(50 + limitRatio * 50), 0, 100);
  const indexMean = mean(
    aShareIndices
      .map((item) => parseSignedPercent(item.change))
      .filter((value): value is number => value !== null)
  );
  const indexScore = clamp(Math.round(50 + indexMean * 16), 0, 100);
  const score = clamp(Math.round(breadthScore * 0.55 + limitScore * 0.2 + indexScore * 0.25), 0, 100);
  const summary = toSentimentLabel(score);
  const upShare = breadth.up / totalBreadth;

  const sentimentView: HomeSentimentView = {
    key: "sentiment",
    label: "牛熊情绪指数",
    mode: "sentiment",
    score,
    summary,
    newsCount: newsItems.length,
    headline: `${score} / 100`,
    description: `按上涨占比、涨跌停差值、三大指数均值综合计算，当前偏向${summary}。`,
    highlights: [
      `上涨 ${formatCount(breadth.up)} 家，下跌 ${formatCount(breadth.down)} 家，平盘 ${formatCount(breadth.flat)} 家。`,
      `涨停 ${limitPool.upLimit} 家，跌停 ${limitPool.downLimit} 家，净差 ${limitPool.upLimit - limitPool.downLimit}。`,
      `上证 / 深成 / 创业板均值 ${formatSignedPercent(indexMean)}。`
    ],
    note: `公式：上涨占比 55% + 涨跌停差 20% + 三大指数均值 25%（交易日 ${limitPool.tradeDate}）`,
    components: [
      { label: "上涨占比", value: `${(upShare * 100).toFixed(1)}%`, tone: upShare >= 0.5 ? "up" : "down" },
      { label: "涨跌停强弱", value: `${limitPool.upLimit - limitPool.downLimit >= 0 ? "+" : ""}${limitPool.upLimit - limitPool.downLimit}`, tone: limitPool.upLimit >= limitPool.downLimit ? "up" : "down" },
      { label: "指数均值", value: formatSignedPercent(indexMean), tone: indexMean >= 0 ? "up" : "down" }
    ],
    asOf: formatAsOf(fetchedAt)
  };

  const displayedNews = newsItems.slice(0, 3);
  const newsView: HomeSentimentView = {
    key: "news",
    label: "今日核心新闻",
    mode: "news",
    summary: `东方财富 ${newsItems.length} 条`,
    newsCount: newsItems.length,
    headline: displayedNews[0]?.title || "暂无抓取结果",
    description: displayedNews[1]?.title || "当前未抓到更多资讯精华标题。",
    highlights: displayedNews.map((item, index) => `${index + 1}. ${item.title}`),
    note: `来源：东方财富资讯精华页 · 抓取时间 ${formatAsOf(fetchedAt)}`,
    asOf: formatAsOf(fetchedAt)
  };

  return [sentimentView, newsView];
}

async function fetchTencentQuotes(symbols: string[]): Promise<Map<string, TencentQuote>> {
  if (symbols.length === 0) return new Map();
  const url = `https://qt.gtimg.cn/q=${symbols.join(",")}`;
  const buffer = await fetchArrayBufferWithRetry(url, TENCENT_HEADERS);
  const raw = new TextDecoder("gbk").decode(buffer);
  return parseTencentBatch(raw);
}

function parseTencentBatch(raw: string) {
  const output = new Map<string, TencentQuote>();
  const pattern = /v_([^=]+)="([^"]*)";/g;
  let match: RegExpExecArray | null = pattern.exec(raw);

  while (match) {
    const symbol = String(match[1] || "").trim();
    const fields = String(match[2] || "").split("~");
    output.set(symbol, {
      symbol,
      name: fields[1] || symbol,
      latestPrice: toNumber(fields[3]),
      changeAmount: toNumber(fields[31]),
      changePercent: toNumber(fields[32]),
      high: toNumber(fields[33]),
      low: toNumber(fields[34]),
      updatedAtRaw: fields[30] || ""
    });
    match = pattern.exec(raw);
  }

  return output;
}

function buildIndexItems(symbols: readonly string[], quotes: Map<string, TencentQuote>): OrnamentIndexItem[] {
  return symbols.map((symbol) => {
    const quote = quotes.get(symbol);
    const changePercent = quote?.changePercent ?? null;
    return {
      name: quote?.name || symbol,
      price: quote?.latestPrice === null || quote?.latestPrice === undefined ? "--" : formatPrice(quote.latestPrice),
      change: changePercent === null ? "--" : formatSignedPercent(changePercent),
      tone: toneFromNumber(changePercent)
    };
  });
}

function latestAsOfFromSymbols(symbols: readonly string[], quotes: Map<string, TencentQuote>, fallbackDate?: string) {
  for (const symbol of symbols) {
    const quote = quotes.get(symbol);
    if (quote?.updatedAtRaw) return formatAsOf(quote.updatedAtRaw);
  }
  if (fallbackDate) return `${fallbackDate} 收盘`;
  return formatAsOf(new Date().toISOString());
}

function pickLeader(indices: OrnamentIndexItem[]) {
  return [...indices].sort((a, b) => Math.abs(parseSignedPercent(b.change) || 0) - Math.abs(parseSignedPercent(a.change) || 0))[0];
}

function toneFromNumber(value: number | null | undefined): OrnamentTone {
  if (value === null || value === undefined || Number.isNaN(value)) return "neutral";
  if (value > 0.0001) return "up";
  if (value < -0.0001) return "down";
  return "neutral";
}

function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: value >= 1000 ? 2 : 2,
    maximumFractionDigits: value >= 1000 ? 2 : 2
  }).format(value);
}

function formatSignedPercent(value: number) {
  const text = `${Math.abs(value).toFixed(2)}%`;
  if (value > 0) return `+${text}`;
  if (value < 0) return `-${text}`;
  return `0.00%`;
}

function parseSignedPercent(text: string) {
  const value = toNumber(String(text || "").replace(/%/g, ""));
  return value;
}

function toSentimentLabel(score: number) {
  if (score >= 80) return "亢奋";
  if (score >= 66) return "乐观";
  if (score >= 56) return "偏暖";
  if (score >= 45) return "中性";
  if (score >= 34) return "偏弱";
  return "低迷";
}

function mean(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function countFromPool(pool: unknown) {
  return Array.isArray(pool) ? pool.length : 0;
}

function normalizeTradeDate(raw: string) {
  const text = String(raw || "").replace(/[^\d]/g, "");
  if (text.length !== 8) return raw;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function formatCompactDate(value: string) {
  return value.replace(/-/g, "");
}

function formatAsOf(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "刚刚更新";
  if (/^\d{14}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8, 10)}:${text.slice(10, 12)}`;
  }
  if (/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return text.replace(/\//g, "-").slice(0, 16);
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return text.slice(0, 16);
  }
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai"
    }).format(date).replace("/", "-");
  }
  return text;
}

function stripTags(text: string) {
  return text.replace(/<[^>]+>/g, " ");
}

function decodeHtml(text: string) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function chunk<T>(items: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const width = Math.max(1, Math.min(concurrency, items.length || 1));
  const queue = [...items];
  const output: R[] = [];

  await Promise.all(
    Array.from({ length: width }, async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next === undefined) return;
        output.push(await worker(next));
      }
    })
  );

  return output;
}

async function fetchJsonWithRetry(url: string, headers: HeadersInit, retries = 3) {
  const text = await fetchTextWithRetry(url, headers, retries);
  return JSON.parse(text);
}

async function fetchTextWithRetry(url: string, headers: HeadersInit, retries = 3) {
  const buffer = await fetchArrayBufferWithRetry(url, headers, retries);
  return new TextDecoder().decode(buffer);
}

async function fetchArrayBufferWithRetry(url: string, headers: HeadersInit, retries = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers,
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`http-${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        throw new Error("empty-response");
      }
      return arrayBuffer;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await sleep(240 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(normalizeError(lastError));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "unknown-error");
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/,/g, "");
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}
