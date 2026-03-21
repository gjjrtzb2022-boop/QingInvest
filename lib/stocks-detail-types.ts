export type StockDetailReport = {
  reportKind: "yjbb" | "yjkb" | "yjyg";
  reportDate: string;
  reportLabel: string;
  noticeDate: string;
  industryName: string;
  marketBoard: string;
  eps: number | null;
  bps: number | null;
  revenue: number | null;
  revenueYoy: number | null;
  netProfit: number | null;
  netProfitYoy: number | null;
  roeWeighted: number | null;
  grossMargin: number | null;
  predictedChangeText: string;
  predictedChangePercent: number | null;
  forecastType: string;
};

export type StockDetailAnnouncement = {
  id: number;
  title: string;
  announcementType: string;
  noticeDate: string;
  displayTime: string | null;
  detailUrl: string;
  pdfUrl: string;
  pageCount: number;
  contentText: string;
  fileCount: number;
};

export type StockDetailSnapshot = {
  code: string;
  name: string;
  market: "SH" | "SZ" | "BJ" | "HK";
  industry: string;
  board: string;
  listedAt: string;
  listingStatus: string;
  latestSnapshotAt: string | null;
};

export type StockDetailPayload = {
  ok: boolean;
  code: string;
  stock: StockDetailSnapshot | null;
  latestReports: StockDetailReport[];
  reportTimeline: StockDetailReport[];
  recentAnnouncements: StockDetailAnnouncement[];
  error?: string;
};
