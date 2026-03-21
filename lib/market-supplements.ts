import type { StockItem } from "@/lib/stocks-meta";

export const SUPPLEMENTAL_MARKET_ITEMS: StockItem[] = [
  {
    code: "000001.SH",
    name: "上证指数",
    market: "SH",
    industry: "指数",
    mentionCount: 0,
    lastMentionDate: "",
    publishedMentionCount: 0,
    publishedLastMentionDate: "",
    isMvp: false,
    aliases: ["上证", "沪指", "上证综指", "SSE", "sh000001"],
    latestPrice: null,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "399001.SZ",
    name: "深证成指",
    market: "SZ",
    industry: "指数",
    mentionCount: 0,
    lastMentionDate: "",
    publishedMentionCount: 0,
    publishedLastMentionDate: "",
    isMvp: false,
    aliases: ["深证", "深成指", "SZSE", "sz399001"],
    latestPrice: null,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "399300.SZ",
    name: "沪深300",
    market: "SZ",
    industry: "指数",
    mentionCount: 0,
    lastMentionDate: "",
    publishedMentionCount: 0,
    publishedLastMentionDate: "",
    isMvp: false,
    aliases: ["HS300", "沪深", "300指数", "CSI300", "sz399300"],
    latestPrice: null,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "399006.SZ",
    name: "创业板指",
    market: "SZ",
    industry: "指数",
    mentionCount: 0,
    lastMentionDate: "",
    publishedMentionCount: 0,
    publishedLastMentionDate: "",
    isMvp: false,
    aliases: ["创业板", "创业板指数", "GEM", "sz399006"],
    latestPrice: null,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "000688.SH",
    name: "科创50",
    market: "SH",
    industry: "指数",
    mentionCount: 0,
    lastMentionDate: "",
    publishedMentionCount: 0,
    publishedLastMentionDate: "",
    isMvp: false,
    aliases: ["科创", "科创50指数", "STAR50", "sh000688"],
    latestPrice: null,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "000905.SH",
    name: "中证500",
    market: "SH",
    industry: "指数",
    mentionCount: 0,
    lastMentionDate: "",
    publishedMentionCount: 0,
    publishedLastMentionDate: "",
    isMvp: false,
    aliases: ["500指数", "CSI500", "中证500指数", "sh000905"],
    latestPrice: null,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "510300.SH",
    name: "沪深300ETF",
    market: "SH",
    industry: "ETF",
    mentionCount: 0,
    lastMentionDate: "",
    publishedMentionCount: 0,
    publishedLastMentionDate: "",
    isMvp: false,
    aliases: ["300ETF", "沪深300ETF", "华泰300ETF", "sh510300"],
    latestPrice: null,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "510050.SH",
    name: "上证50ETF",
    market: "SH",
    industry: "ETF",
    mentionCount: 0,
    lastMentionDate: "",
    publishedMentionCount: 0,
    publishedLastMentionDate: "",
    isMvp: false,
    aliases: ["50ETF", "上证50", "上证50ETF", "sh510050"],
    latestPrice: null,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "159915.SZ",
    name: "创业板ETF",
    market: "SZ",
    industry: "ETF",
    mentionCount: 0,
    lastMentionDate: "",
    publishedMentionCount: 0,
    publishedLastMentionDate: "",
    isMvp: false,
    aliases: ["创业板ETF", "创业ETF", "sz159915"],
    latestPrice: null,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "588000.SH",
    name: "科创50ETF",
    market: "SH",
    industry: "ETF",
    mentionCount: 0,
    lastMentionDate: "",
    publishedMentionCount: 0,
    publishedLastMentionDate: "",
    isMvp: false,
    aliases: ["科创ETF", "科创50ETF", "sh588000"],
    latestPrice: null,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "512100.SH",
    name: "中证1000ETF",
    market: "SH",
    industry: "ETF",
    mentionCount: 0,
    lastMentionDate: "",
    publishedMentionCount: 0,
    publishedLastMentionDate: "",
    isMvp: false,
    aliases: ["1000ETF", "中证1000", "中证1000ETF", "sh512100"],
    latestPrice: null,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  }
];

export function mergeSupplementalMarketItems(items: StockItem[]) {
  const merged = new Map<string, StockItem>();

  for (const item of items) {
    merged.set(item.code, item);
  }

  for (const item of SUPPLEMENTAL_MARKET_ITEMS) {
    if (!merged.has(item.code)) {
      merged.set(item.code, { ...item });
    }
  }

  return [...merged.values()];
}
