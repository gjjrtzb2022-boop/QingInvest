export type LiveSource = "tencent" | "eastmoney" | "sina" | "akshare";

export type LiveQuote = {
  code: string;
  latestPrice: number | null;
  changePercent: number | null;
  latestPe: number | null;
  latestPb: number | null;
  marketCap: number | null;
  updatedAt: string | null;
  source: LiveSource;
};

export type LiveFetchResult = {
  quotes: Map<string, LiveQuote>;
  activeSource: LiveSource | "mixed";
  sourcesUsed: LiveSource[];
  errors: Partial<Record<LiveSource, string>>;
};
