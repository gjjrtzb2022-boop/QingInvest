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
};

type StockBaseItem = Omit<StockItem, "publishedMentionCount" | "publishedLastMentionDate"> &
  Partial<Pick<StockItem, "publishedMentionCount" | "publishedLastMentionDate">>;

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
const STOCK_MENTION_STATS = STOCK_MENTION_SOURCE.stats || {};

export const STOCK_MENTION_META = {
  generatedAt: typeof STOCK_MENTION_SOURCE.generatedAt === "string" ? STOCK_MENTION_SOURCE.generatedAt : "",
  allArticleCount: Number.isFinite(STOCK_MENTION_SOURCE.corpus?.allArticleCount)
    ? Number(STOCK_MENTION_SOURCE.corpus?.allArticleCount)
    : 0,
  publishedArticleCount: Number.isFinite(STOCK_MENTION_SOURCE.corpus?.publishedArticleCount)
    ? Number(STOCK_MENTION_SOURCE.corpus?.publishedArticleCount)
    : 0
};

const STOCKS_DATA_BASE: StockBaseItem[] = [
  {
    code: "601899.SH",
    name: "紫金矿业",
    market: "SH",
    industry: "铜",
    mentionCount: 34,
    lastMentionDate: "2026-02-26",
    publishedMentionCount: 0,
    publishedLastMentionDate: "",
    isMvp: true,
    aliases: ["铜王", "ZJKY", "紫金"],
    latestPrice: 37.1,
    latestPe: 17.8,
    latestPb: 5.83,
    latestDividendYield: 0.0102,
    marketCap: 986479098010
  },
  {
    code: "000960.SZ",
    name: "锡业股份",
    market: "SZ",
    industry: "小金属",
    mentionCount: 31,
    lastMentionDate: "2026-01-31",
    publishedMentionCount: 0,
    publishedLastMentionDate: "",
    isMvp: true,
    aliases: ["锡王", "XYGF2", "锡业"],
    latestPrice: 40.32,
    latestPe: 32.09,
    latestPb: 3.02,
    latestDividendYield: 0.0072,
    marketCap: 66343818240
  },
  {
    code: "600989.SH",
    name: "宝丰能源",
    market: "SH",
    industry: "化工原料",
    mentionCount: 27,
    lastMentionDate: "2026-03-04",
    publishedMentionCount: 0,
    publishedLastMentionDate: "",
    isMvp: true,
    aliases: ["塑料王", "BFNY", "宝丰"],
    latestPrice: 28.59,
    latestPe: 19.5,
    latestPb: 4.56,
    latestDividendYield: 0.0161,
    marketCap: 209660762400
  },
  {
    code: "002170.SZ",
    name: "芭田股份",
    market: "SZ",
    industry: "农药化肥",
    mentionCount: 20,
    lastMentionDate: "2026-01-28",
    isMvp: true,
    aliases: ["BTGF", "芭田"],
    latestPrice: 14.51,
    latestPe: 15.73,
    latestPb: 3.83,
    latestDividendYield: 0.0193,
    marketCap: 14040891700
  },
  {
    code: "000792.SZ",
    name: "盐湖股份",
    market: "SZ",
    industry: "农药化肥",
    mentionCount: 20,
    lastMentionDate: "2026-01-26",
    isMvp: true,
    aliases: ["钾王", "锂王", "YHGF", "盐湖"],
    latestPrice: 36.77,
    latestPe: 30.63,
    latestPb: 4.74,
    latestDividendYield: 0,
    marketCap: 194571120825
  },
  {
    code: "600096.SH",
    name: "云天化",
    market: "SH",
    industry: "农药化肥",
    mentionCount: 20,
    lastMentionDate: "2026-01-24",
    isMvp: true,
    aliases: ["磷王", "YTH", "云天化"],
    latestPrice: 42.67,
    latestPe: 12.84,
    latestPb: 3.21,
    latestDividendYield: 0.0328,
    marketCap: 77787013169
  },
  {
    code: "688525.SH",
    name: "佰维存储",
    market: "SH",
    industry: "半导体",
    mentionCount: 17,
    lastMentionDate: "2026-03-04",
    isMvp: true,
    aliases: ["存储", "BWCC", "佰维"],
    latestPrice: 209.33,
    latestPe: null,
    latestPb: 20.91,
    latestDividendYield: null,
    marketCap: 97784678761
  },
  {
    code: "605599.SH",
    name: "菜百股份",
    market: "SH",
    industry: "服饰",
    mentionCount: 17,
    lastMentionDate: "2026-02-13",
    isMvp: true,
    aliases: ["金店", "CBGF", "菜百"],
    latestPrice: 24.07,
    latestPe: 22.59,
    latestPb: 4.5,
    latestDividendYield: 0.0299,
    marketCap: 18721111646
  },
  {
    code: "603233.SH",
    name: "大参林",
    market: "SH",
    industry: "医药商业",
    mentionCount: 16,
    lastMentionDate: "2026-02-08",
    isMvp: true,
    aliases: ["药店", "DSL", "大参林"],
    latestPrice: 19.83,
    latestPe: 18.43,
    latestPb: 3.12,
    latestDividendYield: 0.0313,
    marketCap: 22583357823
  },
  {
    code: "600219.SH",
    name: "南山铝业",
    market: "SH",
    industry: "铝",
    mentionCount: 16,
    lastMentionDate: "2026-01-28",
    isMvp: true,
    aliases: ["低价铝", "NSLY", "南山"],
    latestPrice: 7.44,
    latestPe: 13.34,
    latestPb: 1.64,
    latestDividendYield: 0.0228,
    marketCap: 85438739904
  },
  {
    code: "002749.SZ",
    name: "国光股份",
    market: "SZ",
    industry: "农药化肥",
    mentionCount: 15,
    lastMentionDate: "2026-02-15",
    isMvp: true,
    aliases: ["GGGF", "国光"],
    latestPrice: 14.21,
    latestPe: 16.76,
    latestPb: 3.44,
    latestDividendYield: 0.0633,
    marketCap: 6626955706
  },
  {
    code: "600015.SH",
    name: "华夏银行",
    market: "SH",
    industry: "银行",
    mentionCount: 11,
    lastMentionDate: "2026-02-13",
    isMvp: true,
    aliases: ["HXYH", "华夏", "烂银行"],
    latestPrice: 6.87,
    latestPe: 3.94,
    latestPb: 0.3,
    latestDividendYield: 0.059,
    marketCap: 109335558795
  },
  {
    code: "688027.SH",
    name: "国盾量子",
    market: "SH",
    industry: "通信设备",
    mentionCount: 10,
    lastMentionDate: "2026-01-15",
    isMvp: true,
    aliases: ["量王", "GDLZ", "国盾"],
    latestPrice: 699.88,
    latestPe: null,
    latestPb: 22.4,
    latestDividendYield: 0,
    marketCap: 71990356680
  },
  {
    code: "603199.SH",
    name: "九华旅游",
    market: "SH",
    industry: "旅游景点",
    mentionCount: 10,
    lastMentionDate: "2026-01-20",
    isMvp: true,
    aliases: ["佛光普照", "JHLY", "九华"],
    latestPrice: 41.36,
    latestPe: 21.48,
    latestPb: 2.83,
    latestDividendYield: 0.0164,
    marketCap: 4577724800
  },
  {
    code: "600519.SH",
    name: "贵州茅台",
    market: "SH",
    industry: "白酒",
    mentionCount: 9,
    lastMentionDate: "2026-03-02",
    isMvp: true,
    aliases: ["GWMT", "茅台", "茅子"],
    latestPrice: 1405,
    latestPe: 18.88,
    latestPb: 6.84,
    latestDividendYield: 0.0367,
    marketCap: 1759439631000
  },
  {
    code: "601168.SH",
    name: "西部矿业",
    market: "SH",
    industry: "铜",
    mentionCount: 9,
    lastMentionDate: "2025-10-27",
    isMvp: true,
    aliases: ["XBKY", "西矿"],
    latestPrice: 31.59,
    latestPe: 12.91,
    latestPb: 4.26,
    latestDividendYield: 0.0317,
    marketCap: 75278970000
  },
  {
    code: "000651.SZ",
    name: "格力电器",
    market: "SZ",
    industry: "家用电器",
    mentionCount: 8,
    lastMentionDate: "2026-02-08",
    isMvp: true,
    aliases: ["GLDQ", "空调", "格力"],
    latestPrice: 37.4,
    latestPe: 6.4,
    latestPb: 1.45,
    latestDividendYield: 0.0802,
    marketCap: 209492573180
  },
  {
    code: "601009.SH",
    name: "南京银行",
    market: "SH",
    industry: "银行",
    mentionCount: 8,
    lastMentionDate: "2026-02-14",
    isMvp: true,
    aliases: ["NJYH", "南银"],
    latestPrice: 11.26,
    latestPe: 6.41,
    latestPb: 0.66,
    latestDividendYield: 0.0485,
    marketCap: 139213766672
  },
  {
    code: "688256.SH",
    name: "寒武纪-U",
    market: "SH",
    industry: "半导体",
    mentionCount: 7,
    lastMentionDate: "2026-02-04",
    isMvp: true,
    aliases: ["寒王", "HWJ", "寒武纪"],
    latestPrice: 1154.88,
    latestPe: 259.65,
    latestPb: 43.05,
    latestDividendYield: null,
    marketCap: 486995803776
  },
  {
    code: "600036.SH",
    name: "招商银行",
    market: "SH",
    industry: "银行",
    mentionCount: 7,
    lastMentionDate: "2026-02-13",
    isMvp: true,
    aliases: ["ZSYH", "招行", "好银行"],
    latestPrice: 39.19,
    latestPe: 6.59,
    latestPb: 0.78,
    latestDividendYield: 0.051,
    marketCap: 988365749064
  },
  {
    code: "601838.SH",
    name: "成都银行",
    market: "SH",
    industry: "银行",
    mentionCount: 5,
    lastMentionDate: "2026-01-08",
    isMvp: true,
    aliases: ["CDYH", "成银"],
    latestPrice: 16.94,
    latestPe: 5.4,
    latestPb: 0.71,
    latestDividendYield: 0.0526,
    marketCap: 71799095676
  },
  {
    code: "600016.SH",
    name: "民生银行",
    market: "SH",
    industry: "银行",
    mentionCount: 5,
    lastMentionDate: "2026-02-14",
    isMvp: true,
    aliases: ["MSYH", "民生"],
    latestPrice: 3.88,
    latestPe: 5.56,
    latestPb: 0.25,
    latestDividendYield: 0.0495,
    marketCap: 169875783780
  },
  {
    code: "601229.SH",
    name: "上海银行",
    market: "SH",
    industry: "银行",
    mentionCount: 5,
    lastMentionDate: "2026-01-20",
    isMvp: true,
    aliases: ["SHYH", "沪银"],
    latestPrice: 9.73,
    latestPe: 5.75,
    latestPb: 0.53,
    latestDividendYield: 0.0514,
    marketCap: 138253668273
  },
  {
    code: "601288.SH",
    name: "农业银行",
    market: "SH",
    industry: "银行",
    mentionCount: 4,
    lastMentionDate: "2026-01-08",
    isMvp: true,
    aliases: ["NYYH", "农行"],
    latestPrice: 6.71,
    latestPe: 8.11,
    latestPb: 0.74,
    latestDividendYield: 0.0361,
    marketCap: 2348386157469
  },
  {
    code: "000858.SZ",
    name: "五粮液",
    market: "SZ",
    industry: "白酒",
    mentionCount: 5,
    lastMentionDate: "2026-03-02",
    isMvp: true,
    aliases: ["WLY", "酒老二", "五粮液"],
    latestPrice: 102.37,
    latestPe: 13.49,
    latestPb: 2.79,
    latestDividendYield: 0.0561,
    marketCap: 397360210960
  },
  {
    code: "601088.SH",
    name: "中国神华",
    market: "SH",
    industry: "煤炭开采",
    mentionCount: 5,
    lastMentionDate: "2026-01-19",
    isMvp: true,
    aliases: ["煤王", "ZGSH", "神华"],
    latestPrice: 45.77,
    latestPe: 14.67,
    latestPb: 2.19,
    latestDividendYield: 0.0494,
    marketCap: 909382160400
  },
  {
    code: "000002.SZ",
    name: "万科A",
    market: "SZ",
    industry: "全国地产",
    mentionCount: 4,
    lastMentionDate: "2025-12-06",
    isMvp: true,
    aliases: ["WKA", "万科"],
    latestPrice: 4.72,
    latestPe: null,
    latestPb: 0.32,
    latestDividendYield: 0,
    marketCap: 56312948840
  },
  {
    code: "300059.SZ",
    name: "东方财富",
    market: "SZ",
    industry: "证券",
    mentionCount: 3,
    lastMentionDate: "2025-10-17",
    isMvp: false,
    aliases: ["东财", "财富"],
    latestPrice: 21.58,
    latestPe: 26.93,
    latestPb: 3.84,
    latestDividendYield: 0.0028,
    marketCap: 341051133566
  },
  {
    code: "601198.SH",
    name: "东兴证券",
    market: "SH",
    industry: "证券",
    mentionCount: 4,
    lastMentionDate: "2026-01-13",
    isMvp: true,
    aliases: ["DXZQ", "小东"],
    latestPrice: 13.58,
    latestPe: 19.95,
    latestPb: 1.48,
    latestDividendYield: 0.0106,
    marketCap: 43896609890
  },
  {
    code: "601059.SH",
    name: "信达证券",
    market: "SH",
    industry: "证券",
    mentionCount: 4,
    lastMentionDate: "2026-01-08",
    isMvp: true,
    aliases: ["XDZQ", "小达"],
    latestPrice: 17.48,
    latestPe: 29.92,
    latestPb: 2.15,
    latestDividendYield: 0.0037,
    marketCap: 56687640000
  },
  {
    code: "920371.BJ",
    name: "欧福蛋业",
    market: "BJ",
    industry: "食品",
    mentionCount: 4,
    lastMentionDate: "2026-02-27",
    isMvp: true,
    aliases: ["鸡蛋加工", "蛋制品", "OFDY"],
    latestPrice: 10.83,
    latestPe: 36.61,
    latestPb: 3.73,
    latestDividendYield: 0.0092,
    marketCap: 2224974765
  },
  {
    code: "920599.BJ",
    name: "同力股份",
    market: "BJ",
    industry: "工程机械",
    mentionCount: 4,
    lastMentionDate: "2026-02-27",
    isMvp: true,
    aliases: ["小车车", "TLGF", "同力"],
    latestPrice: 20.85,
    latestPe: 11.1,
    latestPb: 2.93,
    latestDividendYield: 0.0336,
    marketCap: 9643646250
  },
  {
    code: "603517.SH",
    name: "绝味食品",
    market: "SH",
    industry: "食品",
    mentionCount: 2,
    lastMentionDate: "2025-12-24",
    isMvp: true,
    aliases: ["JWSP", "绝味"],
    latestPrice: 11.87,
    latestPe: 150.64,
    latestPb: 1.13,
    latestDividendYield: 0.0531,
    marketCap: 7193242553
  },
  {
    code: "000932.SZ",
    name: "华菱钢铁",
    market: "SZ",
    industry: "钢铁",
    mentionCount: 14,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["HLGT", "华菱"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "601668.SH",
    name: "中国建筑",
    market: "SH",
    industry: "建筑工程",
    mentionCount: 11,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["ZGJZ", "中建"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "601958.SH",
    name: "金钼股份",
    market: "SH",
    industry: "小金属",
    mentionCount: 13,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["JMGF", "金钼"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "002532.SZ",
    name: "天山铝业",
    market: "SZ",
    industry: "铝",
    mentionCount: 12,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["TSLY", "天铝"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "600737.SH",
    name: "中粮糖业",
    market: "SH",
    industry: "食品",
    mentionCount: 10,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["ZLTY", "中粮糖业"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "002461.SZ",
    name: "珠江啤酒",
    market: "SZ",
    industry: "啤酒",
    mentionCount: 18,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["ZJPJ", "珠啤"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "600573.SH",
    name: "惠泉啤酒",
    market: "SH",
    industry: "啤酒",
    mentionCount: 17,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["HQPJ", "惠泉"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "000729.SZ",
    name: "燕京啤酒",
    market: "SZ",
    industry: "啤酒",
    mentionCount: 19,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["YJPJ", "燕啤", "燕京"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "00390.HK",
    name: "中国中铁",
    market: "HK",
    industry: "基建",
    mentionCount: 9,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["ZZT-HK", "中铁H"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "01618.HK",
    name: "中国中冶",
    market: "HK",
    industry: "基建",
    mentionCount: 9,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["ZZY-HK", "中冶H"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "601618.SH",
    name: "中国中冶",
    market: "SH",
    industry: "基建",
    mentionCount: 10,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["ZZY-A", "中冶A"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "601390.SH",
    name: "中国中铁",
    market: "SH",
    industry: "基建",
    mentionCount: 10,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["ZZT-A", "中铁A"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "601166.SH",
    name: "兴业银行",
    market: "SH",
    industry: "银行",
    mentionCount: 8,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["XYYH", "兴业"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "600251.SH",
    name: "冠农股份",
    market: "SH",
    industry: "农药化肥",
    mentionCount: 8,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["GNGF", "冠农"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "000060.SZ",
    name: "中金岭南",
    market: "SZ",
    industry: "小金属",
    mentionCount: 24,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["ZJLN", "岭南"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  },
  {
    code: "000630.SZ",
    name: "铜陵有色",
    market: "SZ",
    industry: "铜",
    mentionCount: 25,
    lastMentionDate: "2026-03-07",
    isMvp: true,
    aliases: ["TLYS", "铜陵"],
    latestPrice: 0,
    latestPe: null,
    latestPb: null,
    latestDividendYield: null,
    marketCap: null
  }
];

export const STOCKS_DATA: StockItem[] = STOCKS_DATA_BASE.map((stock) => {
  const stat = STOCK_MENTION_STATS?.[stock.code];
  if (!stat) {
    const publishedLastMentionDate: string = stock.publishedLastMentionDate ?? "";
    return {
      ...stock,
      publishedMentionCount: stock.publishedMentionCount ?? 0,
      publishedLastMentionDate
    };
  }

  const mentionCount = Number.isFinite(stat.mentionCount) ? Math.max(0, Math.floor(stat.mentionCount)) : stock.mentionCount;
  const hasValidDate = typeof stat.lastMentionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stat.lastMentionDate);
  const publishedMentionCount = Number.isFinite(stat.publishedMentionCount)
    ? Math.max(0, Math.floor(Number(stat.publishedMentionCount)))
    : stock.publishedMentionCount ?? 0;
  const hasValidPublishedDate =
    typeof stat.publishedLastMentionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stat.publishedLastMentionDate);
  const publishedLastMentionDate: string = hasValidPublishedDate
    ? String(stat.publishedLastMentionDate)
    : stock.publishedLastMentionDate ?? "";

  return {
    ...stock,
    mentionCount,
    lastMentionDate: hasValidDate ? stat.lastMentionDate : stock.lastMentionDate,
    publishedMentionCount,
    publishedLastMentionDate
  };
});

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
