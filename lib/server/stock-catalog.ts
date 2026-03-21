import { getServerDbPool } from "@/lib/server/db";
import { mergeSupplementalMarketItems } from "@/lib/market-supplements";
import { STOCKS_DATA as STOCKS_DATA_FALLBACK } from "@/lib/stocks";
import { STOCK_MENTION_STATS, scoreFromMention, type StockItem } from "@/lib/stocks-meta";

type DbStockRow = {
  symbol: string;
  code: string;
  name: string;
  exchange: "SH" | "SZ" | "BJ";
  board: string | null;
  industry_name: string | null;
  latest_price: number | null;
  dynamic_pe: number | null;
  pb_ratio: number | null;
  dividend_yield: number | null;
  total_market_cap: number | null;
  latest_report_date: string | null;
  latest_report_kind: "yjbb" | "yjkb" | "yjyg" | null;
  latest_revenue_yoy: number | null;
  latest_net_profit_yoy: number | null;
  latest_roe_weighted: number | null;
  latest_gross_margin: number | null;
};

type CatalogCacheEntry = {
  at: number;
  source: "db" | "fallback";
  stocks: StockItem[];
};

export type StockCatalogSummary = {
  total: number;
  exchangeCounts: Record<"SH" | "SZ" | "BJ", number>;
  industries: string[];
};

export type StockCatalogBootstrap = {
  total: number;
  stocks: StockItem[];
  complete: boolean;
};

const CACHE_TTL_MS = 60_000;
const cacheState: { entry: CatalogCacheEntry | null; inFlight: Promise<CatalogCacheEntry> | null } = {
  entry: null,
  inFlight: null
};

export async function getStockCatalog(): Promise<StockItem[]> {
  const entry = await getCatalogEntry();
  return entry.stocks;
}

export async function getStockCatalogByCodes(codes: string[]): Promise<StockItem[]> {
  if (codes.length === 0) return [];
  const catalog = await getStockCatalog();
  const normalizedCodes = codes.map(normalizeStockCode).filter(Boolean);
  const order = new Map(normalizedCodes.map((code, index) => [code, index]));

  return catalog
    .filter((stock) => normalizedCodes.some((requestedCode) => matchesRequestedCode(stock.code, requestedCode)))
    .sort((a, b) => {
      const aOrder = normalizedCodes.find((requestedCode) => matchesRequestedCode(a.code, requestedCode));
      const bOrder = normalizedCodes.find((requestedCode) => matchesRequestedCode(b.code, requestedCode));
      return (order.get(aOrder || "") ?? Number.MAX_SAFE_INTEGER) - (order.get(bOrder || "") ?? Number.MAX_SAFE_INTEGER);
    });
}

export async function getStockByCode(code: string): Promise<StockItem | null> {
  const normalized = normalizeStockCode(code);
  if (!normalized) return null;
  const catalog = await getStockCatalog();
  return catalog.find((stock) => matchesRequestedCode(stock.code, normalized)) ?? null;
}

export async function searchStockCatalog(query: string, limit = 5): Promise<StockItem[]> {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const catalog = await getStockCatalog();
  return catalog
    .map((stock) => ({ stock, score: scoreStockMatch(stock, normalizedQuery) }))
    .filter((item): item is { stock: StockItem; score: number } => item.score > 0)
    .sort((a, b) => b.score - a.score || b.stock.mentionCount - a.stock.mentionCount || a.stock.code.localeCompare(b.stock.code))
    .slice(0, Math.max(1, limit))
    .map((item) => item.stock);
}

export async function getDefaultRealtimeStocks(limit = 24): Promise<StockItem[]> {
  const catalog = await getStockCatalog();
  return [...catalog]
    .sort((a, b) => {
      if (b.mentionCount !== a.mentionCount) return b.mentionCount - a.mentionCount;
      if (b.publishedMentionCount !== a.publishedMentionCount) return b.publishedMentionCount - a.publishedMentionCount;
      return a.code.localeCompare(b.code);
    })
    .slice(0, Math.max(1, limit));
}

export async function getStockCatalogSummary(): Promise<StockCatalogSummary> {
  const catalog = await getStockCatalog();
  const exchangeCounts: Record<"SH" | "SZ" | "BJ", number> = { SH: 0, SZ: 0, BJ: 0 };

  for (const stock of catalog) {
    if (stock.market === "SH" || stock.market === "SZ" || stock.market === "BJ") {
      exchangeCounts[stock.market] += 1;
    }
  }

  return {
    total: catalog.length,
    exchangeCounts,
    industries: [...new Set(catalog.map((stock) => stock.industry).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "zh-CN")
    )
  };
}

export async function getStockCatalogBootstrap(options?: {
  code?: string;
  industry?: string;
  mode?: "workbench" | "screener";
}): Promise<StockCatalogBootstrap> {
  const catalog = await getStockCatalog();
  const ranked = [...catalog].sort(compareStockRank);
  const selectedCode = normalizeStockCode(options?.code || "");
  const selectedStock = selectedCode
    ? catalog.find((stock) => matchesRequestedCode(stock.code, selectedCode))
    : null;
  const industry = String(options?.industry || "").trim();
  const mode = options?.mode === "screener" ? "screener" : "workbench";
  const bucket = new Map<string, StockItem>();

  const addStocks = (items: StockItem[]) => {
    for (const item of items) {
      if (item?.code && !bucket.has(item.code)) {
        bucket.set(item.code, item);
      }
    }
  };

  if (selectedStock) {
    addStocks([selectedStock]);
  }

  addStocks(ranked.filter((stock) => stock.mentionCount >= 12).slice(0, 8));
  addStocks(ranked.filter((stock) => stock.isMvp && stock.mentionCount >= 4 && stock.mentionCount < 12).slice(0, 12));

  if (mode === "screener" && industry) {
    addStocks(ranked.filter((stock) => stock.industry === industry).slice(0, 180));
  } else {
    addStocks(ranked.slice(0, 180));
  }

  if (bucket.size < 220) {
    addStocks(catalog.filter((stock) => stock.market === "SH").slice(0, 20));
    addStocks(catalog.filter((stock) => stock.market === "SZ").slice(0, 20));
    addStocks(catalog.filter((stock) => stock.market === "BJ").slice(0, 20));
  }

  return {
    total: catalog.length,
    stocks: [...bucket.values()],
    complete: false
  };
}

async function getCatalogEntry(): Promise<CatalogCacheEntry> {
  const cached = cacheState.entry;
  if (cached && Date.now() - cached.at <= CACHE_TTL_MS) {
    return cached;
  }

  if (!cacheState.inFlight) {
    cacheState.inFlight = queryCatalogFromDb()
      .then((entry) => {
        cacheState.entry = entry;
        return entry;
      })
      .finally(() => {
        cacheState.inFlight = null;
      });
  }

  return cacheState.inFlight;
}

async function queryCatalogFromDb(): Promise<CatalogCacheEntry> {
  try {
    const pool = getServerDbPool();
    const result = await pool.query<DbStockRow>(
      `
        select
          s.symbol,
          s.code,
          s.name,
          s.exchange,
          s.board,
          s.industry_name,
          s.latest_price,
          s.dynamic_pe,
          s.pb_ratio,
          s.dividend_yield,
          s.total_market_cap,
          fr.latest_report_date,
          fr.latest_report_kind,
          fr.latest_revenue_yoy,
          fr.latest_net_profit_yoy,
          fr.latest_roe_weighted,
          fr.latest_gross_margin
        from public.stock_securities s
        left join lateral (
          select
            report_date::text as latest_report_date,
            report_kind as latest_report_kind,
            revenue_yoy as latest_revenue_yoy,
            net_profit_yoy as latest_net_profit_yoy,
            roe_weighted as latest_roe_weighted,
            gross_margin as latest_gross_margin
          from public.stock_financial_reports fr
          where fr.stock_code = s.code
            and (
              fr.revenue_yoy is not null
              or fr.net_profit_yoy is not null
              or fr.roe_weighted is not null
              or fr.gross_margin is not null
            )
          order by
            fr.report_date desc,
            fr.notice_date desc nulls last,
            case fr.report_kind when 'yjbb' then 0 when 'yjkb' then 1 else 2 end,
            fr.id desc
          limit 1
        ) fr on true
        where s.is_active = true
          and s.exchange in ('SH', 'SZ', 'BJ')
        order by s.exchange asc, s.code asc
      `
    );

    return {
      at: Date.now(),
      source: "db",
      stocks: mergeSupplementalMarketItems(result.rows.map(mapDbRowToStockItem))
    };
  } catch (error) {
    console.warn("[stock-catalog] database unavailable, using static fallback catalog", error);
    return {
      at: Date.now(),
      source: "fallback",
      stocks: mergeSupplementalMarketItems(STOCKS_DATA_FALLBACK.map((stock) => ({ ...stock })))
    };
  }
}

function mapDbRowToStockItem(row: DbStockRow): StockItem {
  const code = normalizeStockCode(row.symbol || `${row.code}.${row.exchange}`);
  const mention = STOCK_MENTION_STATS[code];
  const mentionCount = sanitizeCount(mention?.mentionCount);
  const publishedMentionCount = sanitizeCount(mention?.publishedMentionCount);

  return {
    code,
    name: normalizeSecurityName(row.name),
    market: row.exchange,
    industry: normalizeIndustryName(row.industry_name, row.board),
    mentionCount,
    lastMentionDate: sanitizeDateString(mention?.lastMentionDate),
    publishedMentionCount,
    publishedLastMentionDate: sanitizeDateString(mention?.publishedLastMentionDate),
    isMvp: mentionCount >= 4,
    aliases: [],
    latestPrice: toNumber(row.latest_price),
    latestPe: toNumber(row.dynamic_pe),
    latestPb: toNumber(row.pb_ratio),
    latestDividendYield: normalizeDividendYield(row.dividend_yield),
    marketCap: toNumber(row.total_market_cap),
    latestReportDate: sanitizeDateString(row.latest_report_date),
    latestReportKind: row.latest_report_kind ?? undefined,
    latestRevenueYoy: toNumber(row.latest_revenue_yoy),
    latestNetProfitYoy: toNumber(row.latest_net_profit_yoy),
    latestRoe: toNumber(row.latest_roe_weighted),
    latestGrossMargin: toNumber(row.latest_gross_margin)
  };
}

function normalizeSecurityName(value: string) {
  return String(value || "")
    .replace(/[\u00a0\u3000\s]+/g, "")
    .trim();
}

function normalizeIndustryName(industryName: string | null, board: string | null) {
  const normalized = String(industryName || "")
    .replace(/^[A-Z]\s+/i, "")
    .trim();
  if (normalized) return normalized;

  const normalizedBoard = String(board || "").trim();
  if (normalizedBoard.includes("科创")) return "科创板";
  if (normalizedBoard.includes("创业")) return "创业板";
  if (normalizedBoard.includes("北交")) return "北交所";
  return normalizedBoard || "未分类";
}

function normalizeDividendYield(value: number | null) {
  const numeric = toNumber(value);
  if (numeric === null) return null;
  if (numeric > 1) return numeric / 100;
  return numeric;
}

function sanitizeDateString(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return "";
}

function sanitizeCount(value: unknown) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : 0;
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeStockCode(value: string) {
  const trimmed = String(value || "").trim().toUpperCase();
  if (!trimmed) return "";
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(trimmed)) return trimmed;
  const bareCodeMatch = trimmed.match(/^(\d{6})$/);
  if (bareCodeMatch) return bareCodeMatch[1];
  return trimmed;
}

function matchesRequestedCode(stockCode: string, requestedCode: string) {
  if (!requestedCode) return false;
  if (stockCode === requestedCode) return true;
  return !requestedCode.includes(".") && stockCode.startsWith(`${requestedCode}.`);
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[【】（）()《》〈〉[\]{}，。、“”\"'‘’·,.!?:：;；\-_/\\|]/g, "");
}

function scoreStockMatch(stock: StockItem, query: string) {
  const fields = [
    { value: stock.name, exact: 240, prefix: 164, partial: 110 },
    { value: stock.code, exact: 260, prefix: 186, partial: 128 },
    { value: stock.code.split(".")[0] || "", exact: 250, prefix: 180, partial: 120 },
    { value: stock.industry, exact: 92, prefix: 64, partial: 38 },
    ...stock.aliases.map((alias) => ({ value: alias, exact: 210, prefix: 148, partial: 96 }))
  ];

  let best = 0;
  for (const field of fields) {
    const normalized = normalizeSearchText(field.value);
    if (!normalized) continue;
    if (normalized === query) {
      best = Math.max(best, field.exact);
      continue;
    }
    if (normalized.startsWith(query)) {
      best = Math.max(best, field.prefix);
      continue;
    }
    if (normalized.includes(query)) {
      best = Math.max(best, field.partial);
    }
  }

  if (best === 0) return 0;
  return best + Math.min(stock.mentionCount, 20) + Math.min(stock.publishedMentionCount, 12);
}

function compareStockRank(a: StockItem, b: StockItem) {
  if (b.mentionCount !== a.mentionCount) return b.mentionCount - a.mentionCount;
  const scoreDelta = scoreFromMention(b) - scoreFromMention(a);
  if (scoreDelta !== 0) return scoreDelta;
  return a.code.localeCompare(b.code);
}
