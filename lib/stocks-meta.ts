import stockMentions from "@/content/stocks-mentions.json";

export type StockItem = {
  code: string;
  name: string;
  market: "SH" | "SZ" | "BJ" | "HK";
  industry: string;
  mentionCount: number;
  lastMentionDate: string;
  publishedMentionCount: number;
  publishedLastMentionDate: string;
  isMvp: boolean;
  aliases: string[];
  latestPrice: number | null;
  latestPe: number | null;
  latestPb: number | null;
  latestDividendYield: number | null;
  marketCap: number | null;
  latestReportDate?: string;
  latestReportKind?: "yjbb" | "yjkb" | "yjyg";
  latestRevenueYoy?: number | null;
  latestNetProfitYoy?: number | null;
  latestRoe?: number | null;
  latestGrossMargin?: number | null;
};

type StockMentionStatsFile = {
  generatedAt: string;
  method: string;
  corpus?: {
    allArticleCount?: number;
    publishedArticleCount?: number;
  };
  stats: Record<
    string,
    {
      mentionCount: number;
      lastMentionDate: string;
      publishedMentionCount?: number;
      publishedLastMentionDate?: string;
    }
  >;
};

const STOCK_MENTION_SOURCE = (stockMentions as StockMentionStatsFile) || { stats: {} };

export const STOCK_MENTION_STATS = STOCK_MENTION_SOURCE.stats || {};

export const STOCK_MENTION_META = {
  generatedAt: typeof STOCK_MENTION_SOURCE.generatedAt === "string" ? STOCK_MENTION_SOURCE.generatedAt : "",
  allArticleCount: Number.isFinite(STOCK_MENTION_SOURCE.corpus?.allArticleCount)
    ? Number(STOCK_MENTION_SOURCE.corpus?.allArticleCount)
    : 0,
  publishedArticleCount: Number.isFinite(STOCK_MENTION_SOURCE.corpus?.publishedArticleCount)
    ? Number(STOCK_MENTION_SOURCE.corpus?.publishedArticleCount)
    : 0
};

export function getIndustryList(stocks: StockItem[]): string[] {
  return [...new Set(stocks.map((item) => item.industry).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-CN")
  );
}

export function scoreFromMention(stock: StockItem): number {
  const dividendScore = stock.latestDividendYield ? stock.latestDividendYield * 100 : 0;
  const pePenalty = stock.latestPe && stock.latestPe > 0 ? 30 / stock.latestPe : 0;
  return stock.mentionCount * 1.8 + dividendScore * 1.4 + pePenalty * 5;
}
