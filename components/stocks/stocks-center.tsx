"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { pinyin } from "pinyin-pro";
import { STOCK_MENTION_META, getIndustryList, scoreFromMention, type StockItem } from "@/lib/stocks-meta";
import type { StockDetailAnnouncement, StockDetailPayload, StockDetailReport } from "@/lib/stocks-detail-types";
import type { LiveQuote } from "@/lib/stocks-types";
import { StockKlinePanel } from "@/components/stocks/stock-kline-panel";

type StocksMode = "workbench" | "screener";
type LiveMonitor = {
  currentSource?: string | null;
  lastSwitchAt?: string | null;
  lastFetchAt?: string | null;
  requestCount?: number;
  successCount?: number;
  failCount?: number;
  providerStats?: Record<string, { success: number; fail: number }>;
  lastError?: string | null;
};

type StockCatalogResponse = {
  ok?: boolean;
  total?: number;
  stocks?: StockItem[];
  complete?: boolean;
  error?: string;
};

type StocksCenterProps = {
  initialCatalogStocks?: StockItem[];
  initialCatalogTotal?: number;
  initialCatalogComplete?: boolean;
};

type DrawerState =
  | { kind: "report"; item: StockDetailReport }
  | { kind: "announcement"; item: StockDetailAnnouncement }
  | null;

const DATE_OPTIONS = [
  "2026-03-04",
  "2026-02-27",
  "2026-02-21",
  "2026-02-14",
  "2026-02-07",
  "2026-01-31",
  "2026-01-24",
  "2026-01-17",
  "2026-01-10",
  "2025-04-21"
];

const SCREENING_STRATEGIES = ["高股息", "低波动", "高确定性", "低估值", "现金流"] as const;
const LIVE_POLL_INTERVAL_MS = 1_000;
const CATALOG_FETCH_LIMIT = 6_000;
const RECOMMENDED_LIST_LIMIT = 12;
const WORKBENCH_ALL_STOCKS_PAGE_SIZE = 28;
const SCREENER_TABLE_PAGE_SIZE = 40;
const stockDetailCache = new Map<string, StockDetailPayload>();

const TAG_GROUPS = {
  main: ["铜", "半导体", "农药化肥", "银行", "证券", "白酒", "工程机械", "食品"],
  extra: ["供需错配", "周期复苏", "业绩修复", "低估折价", "分红提升", "逆向配置", "现金牛"]
} as const;

export function StocksCenter({
  initialCatalogStocks = [],
  initialCatalogTotal = 0,
  initialCatalogComplete = false
}: StocksCenterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const mode: StocksMode = searchParams.get("mode") === "screener" ? "screener" : "workbench";
  const queryCode = (searchParams.get("code") || "").trim();
  const queryIndustry = (searchParams.get("scr_ind") || "").trim();
  const queryDate = (searchParams.get("date") || "").trim();

  const [searchInput, setSearchInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [activeStrategy, setActiveStrategy] = useState<(typeof SCREENING_STRATEGIES)[number]>("高股息");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [maxPe, setMaxPe] = useState(30);
  const [maxPb, setMaxPb] = useState(6);
  const [minDividend, setMinDividend] = useState(1);
  const [maxMarketCapBillion, setMaxMarketCapBillion] = useState(2000);
  const [minMentionCount, setMinMentionCount] = useState(3);
  const [minRevenueYoy, setMinRevenueYoy] = useState(-100);
  const [minNetProfitYoy, setMinNetProfitYoy] = useState(-100);
  const [minRoe, setMinRoe] = useState(0);
  const [onlyMvp, setOnlyMvp] = useState(true);
  const [catalogStocks, setCatalogStocks] = useState<StockItem[]>(initialCatalogStocks);
  const [catalogTotal, setCatalogTotal] = useState(initialCatalogTotal || initialCatalogStocks.length);
  const [catalogLoading, setCatalogLoading] = useState(initialCatalogStocks.length === 0);
  const [catalogComplete, setCatalogComplete] = useState(initialCatalogComplete);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<StockDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [drawerState, setDrawerState] = useState<DrawerState>(null);
  const [allStocksPage, setAllStocksPage] = useState(1);
  const [screenerPage, setScreenerPage] = useState(1);
  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveQuote>>({});
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveSource, setLiveSource] = useState<string | null>(null);
  const [liveMonitor, setLiveMonitor] = useState<LiveMonitor | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchKeyword(searchInput.trim());
    }, 120);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let canceled = false;
    const controller = new AbortController();

    const loadCatalog = async () => {
      if (catalogComplete) return;
      if (initialCatalogStocks.length === 0) {
        setCatalogLoading(true);
      }
      try {
        const response = await fetch(`/api/stocks/catalog?limit=${CATALOG_FETCH_LIMIT}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json()) as StockCatalogResponse;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `catalog-http-${response.status}`);
        }
        if (canceled) return;
        const stocks = Array.isArray(payload.stocks) ? payload.stocks : [];
        setCatalogStocks(stocks);
        setCatalogTotal(typeof payload.total === "number" ? payload.total : stocks.length);
        setCatalogComplete(Boolean(payload.complete) || stocks.length >= (payload.total || stocks.length));
        setCatalogError(null);
      } catch (error) {
        if (canceled || controller.signal.aborted) return;
        if (initialCatalogStocks.length === 0) {
          setCatalogStocks([]);
          setCatalogTotal(0);
        }
        setCatalogError(error instanceof Error ? error.message : "catalog-fetch-error");
      } finally {
        if (!canceled) {
          setCatalogLoading(false);
        }
      }
    };

    void loadCatalog();

    return () => {
      canceled = true;
      controller.abort();
    };
  }, [catalogComplete, initialCatalogStocks.length]);

  const selectedDate = DATE_OPTIONS.includes(queryDate) ? queryDate : DATE_OPTIONS[0];
  const dateIndex = Math.max(DATE_OPTIONS.indexOf(selectedDate), 0);

  const stocksWithLive = useMemo(
    () =>
      catalogStocks.map((stock) => {
        const quote = liveQuotes[stock.code];
        return mergeLiveStock(stock, quote);
      }),
    [catalogStocks, liveQuotes]
  );

  const searchableStocks = useMemo(
    () =>
      stocksWithLive.map((stock) => ({
        stock,
        searchBlob: buildStockSearchBlob(stock)
      })),
    [stocksWithLive]
  );

  const visibleStocks = useMemo(() => {
    const keyword = normalizeSearchKeyword(searchKeyword);
    if (!keyword) return stocksWithLive;

    return searchableStocks
      .filter((entry) => entry.searchBlob.includes(keyword))
      .map((entry) => entry.stock);
  }, [searchKeyword, searchableStocks, stocksWithLive]);

  const strictList = useMemo(
    () =>
      [...visibleStocks]
        .filter((stock) => stock.mentionCount >= 12)
        .sort((a, b) => b.mentionCount - a.mentionCount || scoreFromMention(b) - scoreFromMention(a))
        .slice(0, 8),
    [visibleStocks]
  );

  const qualityPool = useMemo(
    () =>
      [...visibleStocks]
        .filter((stock) => stock.isMvp && stock.mentionCount >= 4 && stock.mentionCount < 12)
        .sort((a, b) => scoreFromMention(b) - scoreFromMention(a))
        .slice(0, 6),
    [visibleStocks]
  );

  const allStocks = useMemo(
    () => [...visibleStocks].sort((a, b) => b.mentionCount - a.mentionCount || scoreFromMention(b) - scoreFromMention(a)),
    [visibleStocks]
  );

  const recommendedStocks = useMemo(() => {
    const bucket = new Map<string, StockItem>();
    for (const item of strictList) {
      if (!bucket.has(item.code)) bucket.set(item.code, item);
    }
    for (const item of qualityPool) {
      if (!bucket.has(item.code)) bucket.set(item.code, item);
    }
    return [...bucket.values()]
      .sort((a, b) => b.mentionCount - a.mentionCount || scoreFromMention(b) - scoreFromMention(a))
      .slice(0, RECOMMENDED_LIST_LIMIT);
  }, [qualityPool, strictList]);

  const recommendedCodes = useMemo(() => new Set(recommendedStocks.map((item) => item.code)), [recommendedStocks]);

  const allBrowseStocks = useMemo(
    () => allStocks.filter((item) => !recommendedCodes.has(item.code)),
    [allStocks, recommendedCodes]
  );

  const selectedStock = useMemo(() => {
    const fromQuery = visibleStocks.find((item) => item.code === queryCode);
    if (fromQuery) return fromQuery;
    return recommendedStocks[0] || allBrowseStocks[0] || allStocks[0] || null;
  }, [allBrowseStocks, allStocks, queryCode, recommendedStocks, visibleStocks]);

  const industries = useMemo(() => getIndustryList(stocksWithLive), [stocksWithLive]);

  const totalAllStockPages = Math.max(1, Math.ceil(allBrowseStocks.length / WORKBENCH_ALL_STOCKS_PAGE_SIZE));

  const displayedAllStocks = useMemo(() => {
    const currentPage = Math.min(allStocksPage, totalAllStockPages);
    const start = (currentPage - 1) * WORKBENCH_ALL_STOCKS_PAGE_SIZE;
    const base = allBrowseStocks.slice(start, start + WORKBENCH_ALL_STOCKS_PAGE_SIZE);
    if (selectedStock && !base.some((item) => item.code === selectedStock.code)) {
      if (!recommendedCodes.has(selectedStock.code)) {
        return [selectedStock, ...base.slice(0, Math.max(WORKBENCH_ALL_STOCKS_PAGE_SIZE - 1, 0))];
      }
    }
    return base;
  }, [allBrowseStocks, allStocksPage, recommendedCodes, selectedStock, totalAllStockPages]);

  const topSummary = useMemo(() => {
    const pulse = hash(selectedDate);
    return {
      recommendedCount: recommendedStocks.length,
      watchCount: allStocks.length,
      risingCount: 8 + (pulse % 13),
      warningCount: 2 + (pulse % 4)
    };
  }, [allStocks.length, recommendedStocks.length, selectedDate]);

  const screenerStocks = useMemo(() => {
    return stocksWithLive.filter((stock) => {
      if (queryIndustry && stock.industry !== queryIndustry) return false;
      if (onlyMvp && !stock.isMvp) return false;
      if (stock.mentionCount < minMentionCount) return false;

      if (!matchStrategy(stock, activeStrategy)) return false;

      if (activeTags.length > 0) {
        const bucket = [stock.industry, stock.name, ...stock.aliases].join(" ");
        const hasTag = activeTags.some((tag) => bucket.includes(tag));
        if (!hasTag) return false;
      }

      if (stock.latestDividendYield !== null && stock.latestDividendYield < minDividend / 100) return false;
      if (stock.latestPe !== null && stock.latestPe > maxPe) return false;
      if (stock.latestPb !== null && stock.latestPb > maxPb) return false;
      if (minRevenueYoy > -100 && (stock.latestRevenueYoy === null || stock.latestRevenueYoy === undefined || stock.latestRevenueYoy < minRevenueYoy)) {
        return false;
      }
      if (
        minNetProfitYoy > -100 &&
        (stock.latestNetProfitYoy === null || stock.latestNetProfitYoy === undefined || stock.latestNetProfitYoy < minNetProfitYoy)
      ) {
        return false;
      }
      if (minRoe > 0 && (stock.latestRoe === null || stock.latestRoe === undefined || stock.latestRoe < minRoe)) {
        return false;
      }

      if (stock.marketCap !== null && stock.marketCap > maxMarketCapBillion * 1_000_000_000) return false;
      return true;
    }).sort((a, b) => computeStrategyScore(b, activeStrategy) - computeStrategyScore(a, activeStrategy));
  }, [
    activeStrategy,
    activeTags,
    maxMarketCapBillion,
    maxPb,
    maxPe,
    minDividend,
    minMentionCount,
    minNetProfitYoy,
    minRevenueYoy,
    minRoe,
    onlyMvp,
    queryIndustry,
    stocksWithLive
  ]);

  const totalScreenerPages = Math.max(1, Math.ceil(screenerStocks.length / SCREENER_TABLE_PAGE_SIZE));

  const displayedScreenerStocks = useMemo(() => {
    const currentPage = Math.min(screenerPage, totalScreenerPages);
    const start = (currentPage - 1) * SCREENER_TABLE_PAGE_SIZE;
    return screenerStocks.slice(start, start + SCREENER_TABLE_PAGE_SIZE);
  }, [screenerPage, screenerStocks, totalScreenerPages]);

  const screenerHitRate = useMemo(() => {
    if (!stocksWithLive.length) return 0;
    return Math.round((screenerStocks.length / stocksWithLive.length) * 100);
  }, [screenerStocks.length, stocksWithLive.length]);

  const liveStatusSource = liveSource || liveMonitor?.currentSource || null;
  const providerFailStats = {
    tencent: liveMonitor?.providerStats?.tencent?.fail ?? 0,
    eastmoney: liveMonitor?.providerStats?.eastmoney?.fail ?? 0,
    sina: liveMonitor?.providerStats?.sina?.fail ?? 0,
    akshare: liveMonitor?.providerStats?.akshare?.fail ?? 0
  };

  const selectedChangePercent = selectedStock ? resolveChangePercent(selectedStock.code, liveQuotes) : 0;

  const liveRequestCodes = useMemo(() => {
    const bucket = new Set<string>();

    const push = (stock: StockItem | null | undefined) => {
      if (stock?.code) {
        bucket.add(stock.code);
      }
    };

    push(selectedStock);
    recommendedStocks.slice(0, RECOMMENDED_LIST_LIMIT).forEach(push);

    if (mode === "workbench") {
      displayedAllStocks.slice(0, 18).forEach(push);
    } else {
      displayedScreenerStocks.slice(0, 24).forEach(push);
    }

    return [...bucket].slice(0, 36);
  }, [displayedAllStocks, displayedScreenerStocks, mode, recommendedStocks, selectedStock]);

  const liveRequestKey = liveRequestCodes.join(",");

  useEffect(() => {
    let mounted = true;
    let inFlight = false;

    const pullLiveQuotes = async () => {
      if (catalogStocks.length === 0 || !liveRequestKey) {
        if (mounted) {
          setLiveQuotes({});
        }
        return;
      }
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/stocks/realtime?codes=${encodeURIComponent(liveRequestKey)}`, {
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error(`live-http-${response.status}`);
        }

        const payload = (await response.json()) as {
          ok?: boolean;
          source?: string;
          sourcesUsed?: string[];
          fetchedAt?: string;
          monitor?: LiveMonitor;
          quotes?: LiveQuote[];
        };

        if (!mounted) return;
        const nextMap: Record<string, LiveQuote> = {};
        for (const quote of payload.quotes || []) {
          if (quote?.code) {
            nextMap[quote.code] = quote;
          }
        }
        setLiveQuotes(nextMap);
        setLiveUpdatedAt(payload.fetchedAt || new Date().toISOString());
        setLiveSource(typeof payload.source === "string" ? payload.source : null);
        setLiveMonitor(payload.monitor || null);
        setLiveError(null);
      } catch (error) {
        if (!mounted) return;
        setLiveError(error instanceof Error ? error.message : "live-fetch-error");
      } finally {
        inFlight = false;
      }
    };

    void pullLiveQuotes();
    const interval = window.setInterval(pullLiveQuotes, LIVE_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [catalogStocks.length, liveRequestKey]);

  useEffect(() => {
    setAllStocksPage(1);
  }, [searchKeyword]);

  useEffect(() => {
    setScreenerPage(1);
  }, [
    activeStrategy,
    activeTags,
    maxMarketCapBillion,
    maxPb,
    maxPe,
    minDividend,
    minMentionCount,
    minNetProfitYoy,
    minRevenueYoy,
    minRoe,
    onlyMvp,
    queryIndustry
  ]);

  useEffect(() => {
    if (allStocksPage > totalAllStockPages) {
      setAllStocksPage(totalAllStockPages);
    }
  }, [allStocksPage, totalAllStockPages]);

  useEffect(() => {
    if (screenerPage > totalScreenerPages) {
      setScreenerPage(totalScreenerPages);
    }
  }, [screenerPage, totalScreenerPages]);

  useEffect(() => {
    if (!selectedStock) return;
    const index = allBrowseStocks.findIndex((item) => item.code === selectedStock.code);
    if (index === -1) return;
    const nextPage = Math.floor(index / WORKBENCH_ALL_STOCKS_PAGE_SIZE) + 1;
    if (nextPage !== allStocksPage) {
      setAllStocksPage(nextPage);
    }
  }, [allBrowseStocks, allStocksPage, selectedStock]);

  useEffect(() => {
    let canceled = false;
    const controller = new AbortController();

    const loadDetail = async () => {
      if (!selectedStock?.code) {
        setDetailState(null);
        setDetailError(null);
        setDetailLoading(false);
        return;
      }

      const cached = stockDetailCache.get(selectedStock.code);
      if (cached) {
        setDetailState(cached);
        setDetailError(cached.ok ? null : cached.error || null);
      } else {
        setDetailLoading(true);
        setDetailError(null);
      }

      try {
        const response = await fetch(`/api/stocks/detail?code=${encodeURIComponent(selectedStock.code)}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json()) as StockDetailPayload & { error?: string };
        if (canceled || controller.signal.aborted) return;
        stockDetailCache.set(selectedStock.code, payload);
        setDetailState(payload);
        setDetailError(payload.ok ? null : payload.error || `detail-http-${response.status}`);
      } catch (error) {
        if (canceled || controller.signal.aborted) return;
        setDetailError(error instanceof Error ? error.message : "detail-fetch-error");
      } finally {
        if (!canceled) {
          setDetailLoading(false);
        }
      }
    };

    void loadDetail();

    return () => {
      canceled = true;
      controller.abort();
    };
  }, [selectedStock?.code]);

  useEffect(() => {
    setDrawerState(null);
  }, [selectedStock?.code]);

  const updateParams = (mutator: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString());
    mutator(next);
    const target = next.toString() ? `${pathname}?${next.toString()}` : pathname;
    router.replace(target, { scroll: false });
  };

  const switchMode = (nextMode: StocksMode) => {
    updateParams((next) => {
      next.set("mode", nextMode);
      if (selectedStock?.code) {
        next.set("code", selectedStock.code);
      }
      next.set("date", selectedDate);
    });
  };

  const setSelectedCode = (code: string) => {
    updateParams((next) => {
      next.set("mode", "workbench");
      next.set("code", code);
      next.set("date", selectedDate);
    });
  };

  const setScreenerIndustry = (industry: string) => {
    updateParams((next) => {
      next.set("mode", "screener");
      next.set("date", selectedDate);
      if (!industry || queryIndustry === industry) {
        next.delete("scr_ind");
      } else {
        next.set("scr_ind", industry);
      }
    });
  };

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => {
      if (prev.includes(tag)) {
        return prev.filter((item) => item !== tag);
      }
      return [...prev, tag];
    });
  };

  const resetScreenerFilters = () => {
    setMaxPe(30);
    setMaxPb(6);
    setMinDividend(1);
    setMaxMarketCapBillion(2000);
    setMinMentionCount(3);
    setMinRevenueYoy(-100);
    setMinNetProfitYoy(-100);
    setMinRoe(0);
    setOnlyMvp(true);
    setActiveStrategy("高股息");
    setActiveTags([]);
    setScreenerIndustry("");
  };

  const shiftDate = (step: -1 | 1) => {
    const nextIndex = Math.min(Math.max(0, dateIndex + step), DATE_OPTIONS.length - 1);
    const nextDate = DATE_OPTIONS[nextIndex];
    updateParams((next) => {
      next.set("date", nextDate);
      if (!next.get("mode")) next.set("mode", mode);
    });
  };

  const detailSnapshot = detailState?.stock || null;
  const latestReports = detailState?.latestReports || [];
  const reportTimeline = detailState?.reportTimeline || [];
  const recentAnnouncements = detailState?.recentAnnouncements || [];

  return (
    <>
      <div className="stocks-page-shell">
        <section className="stocks-hero">
        <p className="stocks-hero-kicker">选股中心</p>
        <h1>选股中心</h1>
        <p>在工作台查看股票详情并管理自选，或使用选股器进行多指标筛选。</p>
      </section>

      <section className="stocks-topbar">
        <div className="stocks-topbar-left">
          <div className="stocks-date-pager">
            <span className="date-pill">{selectedDate}</span>
            <button type="button" onClick={() => shiftDate(-1)} disabled={dateIndex <= 0} aria-label="上一日期">
              ←
            </button>
            <button
              type="button"
              onClick={() => shiftDate(1)}
              disabled={dateIndex >= DATE_OPTIONS.length - 1}
              aria-label="下一日期"
            >
              →
            </button>
          </div>
          <div className="stocks-topbar-meta">
            <span className="topbar-meta-pill">推荐 {topSummary.recommendedCount}</span>
            <span className="topbar-meta-pill">观察 {topSummary.watchCount}</span>
            <span className={`topbar-meta-pill ${catalogError ? "down" : catalogLoading ? "" : "up"}`}>
              {catalogError ? "股票库异常" : catalogLoading ? "股票库加载中" : `A股库 ${catalogTotal || stocksWithLive.length}`}
            </span>
            <span className="topbar-meta-pill up">上涨 {topSummary.risingCount}</span>
            <span className="topbar-meta-pill down">预警 {topSummary.warningCount}</span>
            <span className={`topbar-meta-pill ${liveError ? "down" : "up"}`}>
              {liveError ? "实时连接异常" : `实时 ${formatLiveSource(liveStatusSource)} ${formatClock(liveUpdatedAt)}`}
            </span>
            <span className="topbar-meta-pill">
              口径 库 {STOCK_MENTION_META.allArticleCount} / 站 {STOCK_MENTION_META.publishedArticleCount}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="stocks-orange-btn"
          onClick={() => switchMode(mode === "workbench" ? "screener" : "workbench")}
        >
          {mode === "workbench" ? "切换到筛选器" : "切换到工作台"}
        </button>
      </section>

      <section className="stocks-mode-switch">
        <button type="button" className={mode === "workbench" ? "active" : ""} onClick={() => switchMode("workbench")}>
          <span className="stocks-mode-icon" aria-hidden="true">
            ⌘
          </span>
          工作台
        </button>
        <button type="button" className={mode === "screener" ? "active" : ""} onClick={() => switchMode("screener")}>
          <span className="stocks-mode-icon" aria-hidden="true">
            ▽
          </span>
          筛选器
        </button>
      </section>

      <section className="stocks-live-monitor" aria-label="实时抓取监控">
        <div className="live-monitor-grid">
          <article className="live-monitor-cell">
            <p>当前来源</p>
            <strong>{formatLiveSource(liveStatusSource)}</strong>
          </article>
          <article className="live-monitor-cell">
            <p>最近切换</p>
            <strong>{formatClock(liveMonitor?.lastSwitchAt || null)}</strong>
          </article>
          <article className="live-monitor-cell">
            <p>抓取成功率</p>
            <strong>{formatSuccessRate(liveMonitor?.successCount ?? 0, liveMonitor?.requestCount ?? 0)}</strong>
          </article>
          <article className="live-monitor-cell">
            <p>累计失败</p>
            <strong>{liveMonitor?.failCount ?? 0}</strong>
          </article>
        </div>
        <p className="live-monitor-summary">
          接口失败统计：腾讯 {providerFailStats.tencent} · 东财 {providerFailStats.eastmoney} · 新浪 {providerFailStats.sina} · AK
          {providerFailStats.akshare}
        </p>
      </section>

        {mode === "workbench" ? (
        <section className="stocks-workbench-layout">
          <aside className="stocks-sidebar">
            <div className="stocks-sidebar-intro">
              <div>
                <p className="stocks-sidebar-kicker">股票工作台</p>
                <h2>按参考站的层级重组为三栏导航</h2>
              </div>
              <div className="stocks-sidebar-stat-grid">
                <article className="stocks-sidebar-stat-card">
                  <span>推荐池</span>
                  <strong>{recommendedStocks.length}</strong>
                  <p>山长优先关注</p>
                </article>
                <article className="stocks-sidebar-stat-card">
                  <span>全库</span>
                  <strong>{catalogTotal || stocksWithLive.length}</strong>
                  <p>含股票 / 指数 / ETF</p>
                </article>
                <article className="stocks-sidebar-stat-card">
                  <span>实时源</span>
                  <strong>{formatLiveSource(liveStatusSource)}</strong>
                  <p>{liveError ? "当前异常" : `更新 ${formatClock(liveUpdatedAt)}`}</p>
                </article>
              </div>
            </div>

            <div className="stocks-sidebar-search search-shell">
              <span className="search-shell-icon" aria-hidden="true">
                ⌕
              </span>
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="搜索股票代码、名称、拼音缩写"
              />
            </div>

            <StockSection
              title="山长推荐"
              badge={`${recommendedStocks.length} 只`}
              description="优先展示山长重点提及、且当前可继续跟踪的标的。"
              items={recommendedStocks}
              activeCode={selectedStock?.code || ""}
              onSelect={setSelectedCode}
              tone="featured"
            />
            <WatchlistPlaceholderCard />
            <section className="stock-section-shell">
              <StockSection
                title="全部"
                badge={`${allBrowseStocks.length} 只`}
                description="其余标的统一归入这里，支持代码、关键词和拼音检索。"
                items={displayedAllStocks}
                activeCode={selectedStock?.code || ""}
                onSelect={setSelectedCode}
                compact
                tone="neutral"
              />
              <PagerRow
                page={Math.min(allStocksPage, totalAllStockPages)}
                totalPages={totalAllStockPages}
                onPageChange={setAllStocksPage}
                summary={`第 ${Math.min(allStocksPage, totalAllStockPages)} / ${totalAllStockPages} 页`}
              />
            </section>
          </aside>

          <div className="stocks-main-panel">
            {!selectedStock ? (
              <div className="stocks-empty-state">
                {catalogLoading ? "股票库加载中..." : catalogError ? `股票库加载失败：${catalogError}` : "暂无股票数据"}
              </div>
            ) : (
              <>
                <section className="stocks-main-overview">
                  <div className="stocks-main-header">
                    <div>
                      <p className="stocks-main-kicker">股票概览</p>
                      <h2>{selectedStock.name}</h2>
                      <p>
                        <span className="code">{selectedStock.code}</span>
                        <span className="market">{selectedStock.market}</span>
                        <span className="industry">{selectedStock.industry}</span>
                      </p>
                    </div>
                    <div className="stocks-price-box">
                      <p className="label">最新价</p>
                      <p className="price">{formatPrice(selectedStock.latestPrice)}</p>
                      <p className={`change ${selectedChangePercent >= 0 ? "up" : "down"}`}>
                        {formatSignedPercent(selectedChangePercent)}
                      </p>
                    </div>
                  </div>

                  <div className="stocks-overview-stat-grid">
                    <OverviewStatCard label="全文库提及" value={`${selectedStock.mentionCount} 次`} />
                    <OverviewStatCard label="站内已上线" value={`${selectedStock.publishedMentionCount} 次`} />
                    <OverviewStatCard label="最近提及" value={formatDateLabel(selectedStock.lastMentionDate)} />
                    <OverviewStatCard label="实时来源" value={liveError ? "连接异常" : formatLiveSource(liveStatusSource)} />
                  </div>

                  <div className="workbench-quick-row">
                    <span className="quick-pill active">策略 {resolveStrategyLabel(selectedStock)}</span>
                    <span className="quick-pill">行业 {selectedStock.industry}</span>
                    <span className="quick-pill">分红 {formatPercent(selectedStock.latestDividendYield)}</span>
                    <span className="quick-pill">营收同比 {formatRatioPercent(selectedStock.latestRevenueYoy ?? null)}</span>
                    <span className="quick-pill">净利同比 {formatRatioPercent(selectedStock.latestNetProfitYoy ?? null)}</span>
                    <span className="quick-pill">ROE {formatRatioPercent(selectedStock.latestRoe ?? null)}</span>
                    {detailSnapshot?.board ? <span className="quick-pill">板块 {detailSnapshot.board}</span> : null}
                  </div>
                </section>

                <section className="stocks-chart-shell">
                  <StockKlinePanel stock={selectedStock} />
                </section>

                <div className="stocks-metric-grid">
                  <MetricCell label="市盈率 PE" value={formatNullable(selectedStock.latestPe, 2)} />
                  <MetricCell label="市净率 PB" value={formatNullable(selectedStock.latestPb, 2)} />
                  <MetricCell label="股息率" value={formatPercent(selectedStock.latestDividendYield)} />
                  <MetricCell label="总市值" value={formatMarketCap(selectedStock.marketCap)} />
                  <MetricCell label="全文库提及" value={`${selectedStock.mentionCount} 次`} />
                  <MetricCell label="全文库最近提及" value={formatDateLabel(selectedStock.lastMentionDate)} />
                  <MetricCell label="已上线提及" value={`${selectedStock.publishedMentionCount} 次`} />
                  <MetricCell label="站内最近提及" value={formatDateLabel(selectedStock.publishedLastMentionDate)} />
                </div>

                <section className="stocks-detail-grid">
                  <article className="stocks-note-card compact">
                    <header>
                      <h3>财报快照</h3>
                      <span>
                        {detailLoading ? "同步中" : latestReports.length > 0 ? `已接入 ${latestReports.length} 类` : "等待同步"}
                      </span>
                    </header>
                    {detailError ? (
                      <p className="stocks-inline-state">财报读取失败：{detailError}</p>
                    ) : latestReports.length === 0 ? (
                      <p className="stocks-inline-state">当前暂无可展示的财报摘要。</p>
                    ) : (
                      <div className="stock-detail-stack">
                        {latestReports.map((report) => (
                          <button
                            key={`${report.reportKind}-${report.reportDate}`}
                            type="button"
                            className="stock-detail-row stock-detail-button"
                            onClick={() => setDrawerState({ kind: "report", item: report })}
                          >
                            <div className="stock-detail-row-head">
                              <strong>{report.reportLabel || reportKindLabel(report.reportKind)}</strong>
                              <span>{formatDateLabel(report.reportDate)}</span>
                            </div>
                            <p>
                              营收 {formatFinanceValue(report.revenue)} / 同比 {formatRatioPercent(report.revenueYoy)} · 净利{" "}
                              {formatFinanceValue(report.netProfit)} / 同比 {formatRatioPercent(report.netProfitYoy)}
                            </p>
                            <p>
                              ROE {formatRatioPercent(report.roeWeighted)} · 毛利率 {formatRatioPercent(report.grossMargin)} · EPS{" "}
                              {formatNullable(report.eps, 2)}
                            </p>
                            {report.predictedChangeText || report.forecastType ? (
                              <p>
                                预告 {report.forecastType || "更新"} {report.predictedChangeText || formatRatioPercent(report.predictedChangePercent)}
                              </p>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </article>

                  <article className="stocks-note-card compact">
                    <header>
                      <h3>公告追踪</h3>
                      <span>
                        {detailLoading ? "同步中" : recentAnnouncements.length > 0 ? `最近 ${recentAnnouncements.length} 条` : "等待同步"}
                      </span>
                    </header>
                    {detailError ? (
                      <p className="stocks-inline-state">公告读取失败：{detailError}</p>
                    ) : recentAnnouncements.length === 0 ? (
                      <p className="stocks-inline-state">当前暂无公告摘要。</p>
                    ) : (
                      <div className="stock-detail-stack">
                        {recentAnnouncements.map((announcement) => (
                          <button
                            key={announcement.id}
                            type="button"
                            className="stock-detail-row stock-detail-button"
                            onClick={() => setDrawerState({ kind: "announcement", item: announcement })}
                          >
                            <div className="stock-detail-row-head">
                              <strong>{announcement.title}</strong>
                              <span>{formatDateLabel(announcement.noticeDate)}</span>
                            </div>
                            <p>
                              {announcement.announcementType || "公告"} · {announcement.pageCount > 0 ? `${announcement.pageCount} 页` : "未标注页数"} ·
                              附件 {announcement.fileCount}
                            </p>
                            <p>{shortenInlineText(announcement.contentText || "暂无正文摘要。", 96)}</p>
                            <div className="stock-detail-links">
                              <span>点击查看详情</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </article>
                </section>

                <section className="stocks-note-card">
                  <header>
                    <h3>财报时间轴</h3>
                    <span>{detailLoading ? "同步中" : `最近 ${reportTimeline.length} 条`}</span>
                  </header>
                  {detailError ? (
                    <p className="stocks-inline-state">财报时间轴读取失败：{detailError}</p>
                  ) : reportTimeline.length === 0 ? (
                    <p className="stocks-inline-state">当前暂无可回溯的财报时间轴。</p>
                  ) : (
                    <div className="stock-timeline-list">
                      {reportTimeline.map((report) => (
                        <button
                          key={`timeline-${report.reportKind}-${report.reportDate}-${report.noticeDate}`}
                          type="button"
                          className="stock-timeline-item"
                          onClick={() => setDrawerState({ kind: "report", item: report })}
                        >
                          <span className="stock-timeline-dot" aria-hidden="true" />
                          <div className="stock-timeline-copy">
                            <div className="stock-timeline-head">
                              <strong>{report.reportLabel || reportKindLabel(report.reportKind)}</strong>
                              <span>{formatDateLabel(report.reportDate)}</span>
                            </div>
                            <p>
                              营收同比 {formatRatioPercent(report.revenueYoy)} · 净利同比 {formatRatioPercent(report.netProfitYoy)} · ROE{" "}
                              {formatRatioPercent(report.roeWeighted)}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="stocks-note-card">
                  <header>
                    <h3>阅读摘记</h3>
                    <span>来自文章库</span>
                  </header>
                  <ul>
                    {buildHighlights(selectedStock).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>

                <section className="stocks-note-card compact">
                  <header>
                    <h3>候选池状态</h3>
                    <span>筛选后快照</span>
                  </header>
                  <div className="pool-progress-list">
                    <ProgressRow label="严格筛选通过率" value={Math.min(100, Math.round((strictList.length / 8) * 100))} />
                    <ProgressRow label="山长推荐覆盖率" value={Math.min(100, Math.round((recommendedStocks.length / RECOMMENDED_LIST_LIMIT) * 100))} />
                    <ProgressRow
                      label="全库可浏览度"
                      value={catalogTotal > 0 ? Math.min(100, Math.round((allBrowseStocks.length / catalogTotal) * 100)) : 0}
                    />
                    <ProgressRow label="当前行业热度" value={Math.max(30, Math.round(scoreFromMention(selectedStock) * 2.6))} />
                  </div>
                </section>
              </>
            )}
          </div>
        </section>
      ) : (
        <section className="stocks-screener-layout">
          <aside className="screener-sidebar">
            <ScreenerSlider
              label="最小股息率"
              value={`${minDividend}%`}
              current={minDividend}
              min={0}
              max={10}
              step={1}
              onValue={setMinDividend}
            />
            <ScreenerSlider label="最大 PE" value={`≤ ${maxPe}`} current={maxPe} min={5} max={80} step={1} onValue={setMaxPe} />
            <ScreenerSlider label="最大 PB" value={`≤ ${maxPb}`} current={maxPb} min={1} max={20} step={1} onValue={setMaxPb} />
            <ScreenerSlider
              label="最小全文库提及"
              value={`≥ ${minMentionCount}`}
              current={minMentionCount}
              min={0}
              max={20}
              step={1}
              onValue={setMinMentionCount}
            />
            <ScreenerSlider
              label="最大市值"
              value={`≤ ${maxMarketCapBillion} 亿`}
              current={maxMarketCapBillion}
              min={100}
              max={3000}
              step={100}
              onValue={setMaxMarketCapBillion}
            />
            <ScreenerSlider
              label="最小营收同比"
              value={`≥ ${minRevenueYoy}%`}
              current={minRevenueYoy}
              min={-100}
              max={200}
              step={10}
              onValue={setMinRevenueYoy}
            />
            <ScreenerSlider
              label="最小净利同比"
              value={`≥ ${minNetProfitYoy}%`}
              current={minNetProfitYoy}
              min={-100}
              max={300}
              step={10}
              onValue={setMinNetProfitYoy}
            />
            <ScreenerSlider
              label="最小 ROE"
              value={`≥ ${minRoe}%`}
              current={minRoe}
              min={0}
              max={30}
              step={1}
              onValue={setMinRoe}
            />

            <label className="screener-checkbox">
              <input type="checkbox" checked={onlyMvp} onChange={(event) => setOnlyMvp(event.target.checked)} />
              仅看高关注股票
            </label>

            <button type="button" className="screener-reset-btn" onClick={resetScreenerFilters}>
              重置筛选
            </button>
          </aside>

          <div className="screener-main">
            <div className="screener-strategy-row">
              {SCREENING_STRATEGIES.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`strategy-chip ${activeStrategy === item ? "active" : ""}`}
                  onClick={() => setActiveStrategy(item)}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="screener-chip-panel">
              <p className="screener-chip-title">行业</p>
              <div className="screener-chip-wrap">
                <button
                  type="button"
                  className={`industry-chip ${queryIndustry ? "" : "active"}`}
                  onClick={() => setScreenerIndustry("")}
                >
                  全部
                </button>
                {industries.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`industry-chip ${queryIndustry === item ? "active" : ""}`}
                    onClick={() => setScreenerIndustry(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="screener-chip-panel">
              <p className="screener-chip-title">策略标签</p>
              <div className="screener-chip-wrap">
                {[...TAG_GROUPS.main, ...TAG_GROUPS.extra].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`tag-chip ${activeTags.includes(tag) ? "active" : ""}`}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="screener-hitline">
              <div className="screener-hitline-header">
                <span>策略命中度</span>
                <strong>{screenerHitRate}%</strong>
              </div>
              <div className="screener-hit-bar">
                <span style={{ width: `${Math.max(8, screenerHitRate)}%` }} />
              </div>
            </div>

            <div className="screener-summary-row">
              <span>共筛出 {screenerStocks.length} 只</span>
              <span>
                当前第 {Math.min(screenerPage, totalScreenerPages)} / {totalScreenerPages} 页
              </span>
              <span>策略 {activeStrategy}</span>
              <span>{liveError ? "静态模式" : `实时模式(${formatLiveSource(liveSource)})`}</span>
              <span>提及口径 库 {STOCK_MENTION_META.allArticleCount} / 站 {STOCK_MENTION_META.publishedArticleCount}</span>
              <span>日期 {selectedDate}</span>
            </div>

            <div className="screener-table-wrap">
              <table className="screener-table">
                <thead>
                  <tr>
                    <th>股票</th>
                    <th>行业</th>
                    <th>评分</th>
                    <th>PE</th>
                    <th>PB</th>
                    <th>股息率</th>
                    <th>营收同比</th>
                    <th>净利同比</th>
                    <th>ROE</th>
                    <th>提及(库/站)</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedScreenerStocks.map((item) => (
                    <tr key={item.code}>
                      <td>
                        <strong>{item.name}</strong>
                        <span>{item.code}</span>
                      </td>
                      <td>{item.industry}</td>
                      <td>{computeStrategyScore(item, activeStrategy).toFixed(1)}</td>
                      <td>{formatNullable(item.latestPe, 2)}</td>
                      <td>{formatNullable(item.latestPb, 2)}</td>
                      <td>{formatPercent(item.latestDividendYield)}</td>
                      <td>{formatRatioPercent(item.latestRevenueYoy ?? null)}</td>
                      <td>{formatRatioPercent(item.latestNetProfitYoy ?? null)}</td>
                      <td>{formatRatioPercent(item.latestRoe ?? null)}</td>
                      <td>{item.mentionCount} / {item.publishedMentionCount}</td>
                      <td>
                        <button type="button" onClick={() => setSelectedCode(item.code)}>
                          查看
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PagerRow
              page={Math.min(screenerPage, totalScreenerPages)}
              totalPages={totalScreenerPages}
              onPageChange={setScreenerPage}
              summary={`当前页 ${displayedScreenerStocks.length} / 共 ${screenerStocks.length} 只`}
            />
          </div>
        </section>
        )}
      </div>

      {drawerState ? (
        <StockDetailDrawer drawer={drawerState} onClose={() => setDrawerState(null)} />
      ) : null}
    </>
  );
}

function StockSection({
  title,
  badge,
  description,
  items,
  activeCode,
  onSelect,
  compact,
  tone = "neutral"
}: {
  title: string;
  badge: string;
  description?: string;
  items: StockItem[];
  activeCode: string;
  onSelect: (code: string) => void;
  compact?: boolean;
  tone?: "featured" | "neutral";
}) {
  return (
    <section className={`stock-section-card ${compact ? "compact" : ""} tone-${tone}`}>
      <header>
        <div>
          <h3>{title}</h3>
          {description ? <p className="stock-section-description">{description}</p> : null}
        </div>
        <span>{badge}</span>
      </header>
      <div className="stock-section-list">
        {items.length > 0 ? (
          items.map((item) => (
            <button
              key={item.code}
              type="button"
              className={`stock-row-btn ${activeCode === item.code ? "active" : ""}`}
              onClick={() => onSelect(item.code)}
            >
              <div className="stock-row-main">
                <p>{item.name}</p>
                <span>
                  {item.code} · {item.industry}
                </span>
              </div>
              <div className="stock-row-side">
                <strong>{formatPrice(item.latestPrice)}</strong>
                <span>{item.mentionCount} 次</span>
              </div>
            </button>
          ))
        ) : (
          <div className="stock-placeholder-box">当前搜索条件下暂无股票。</div>
        )}
      </div>
    </section>
  );
}

function WatchlistPlaceholderCard() {
  return (
    <section className="stock-section-card stock-watchlist-card tone-watchlist">
      <header>
        <div>
          <h3>自选</h3>
          <p className="stock-section-description">后续将按用户独立存储分组、收藏和排序。</p>
        </div>
        <button type="button" className="watchlist-placeholder-btn" disabled>
          即将开放
        </button>
      </header>
      <div className="stock-placeholder-box">还没有自选股，后续可按用户账号独立保存。</div>
    </section>
  );
}

function PagerRow({
  page,
  totalPages,
  onPageChange,
  summary
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  summary: string;
}) {
  return (
    <div className="stocks-pager-row">
      <span>{summary}</span>
      <div className="stocks-pager-controls">
        <button type="button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}>
          上一页
        </button>
        <strong>
          {page} / {totalPages}
        </strong>
        <button type="button" onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>
          下一页
        </button>
      </div>
    </div>
  );
}

function buildStockSearchBlob(stock: StockItem) {
  const baseTokens = [stock.code, stock.code.split(".")[0] || "", stock.name, stock.industry, ...stock.aliases];
  const pinyinTokens = [stock.name, ...stock.aliases]
    .flatMap((item) => buildPinyinTokens(item))
    .filter(Boolean);

  return [...baseTokens, ...pinyinTokens]
    .map((item) => normalizeSearchKeyword(item))
    .filter(Boolean)
    .join(" ");
}

function buildPinyinTokens(value: string) {
  const text = String(value || "").trim();
  if (!text) return [];
  return [
    pinyin(text, { toneType: "none" }),
    pinyin(text, { pattern: "first", toneType: "none" })
  ];
}

function normalizeSearchKeyword(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[üǖǘǚǜ]/g, "v")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function StockDetailDrawer({ drawer, onClose }: { drawer: DrawerState; onClose: () => void }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (!drawer) return null;

  const isReport = drawer.kind === "report";

  return (
    <div className="stock-drawer-overlay" role="presentation" onClick={onClose}>
      <aside
        className="stock-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={isReport ? "财报详情" : "公告详情"}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="stock-drawer-header">
          <div>
            <p className="stock-drawer-kicker">{isReport ? "财报详情" : "公告详情"}</p>
            <h3>{isReport ? drawer.item.reportLabel || reportKindLabel(drawer.item.reportKind) : drawer.item.title}</h3>
          </div>
          <button type="button" className="stock-drawer-close" onClick={onClose} aria-label="关闭详情">
            关闭
          </button>
        </header>

        {isReport ? (
          <div className="stock-drawer-body">
            <div className="stock-drawer-meta-grid">
              <MetricCell label="报表日期" value={formatDateLabel(drawer.item.reportDate)} />
              <MetricCell label="披露日期" value={formatDateLabel(drawer.item.noticeDate)} />
              <MetricCell label="营收" value={formatFinanceValue(drawer.item.revenue)} />
              <MetricCell label="净利润" value={formatFinanceValue(drawer.item.netProfit)} />
              <MetricCell label="营收同比" value={formatRatioPercent(drawer.item.revenueYoy)} />
              <MetricCell label="净利同比" value={formatRatioPercent(drawer.item.netProfitYoy)} />
              <MetricCell label="ROE" value={formatRatioPercent(drawer.item.roeWeighted)} />
              <MetricCell label="毛利率" value={formatRatioPercent(drawer.item.grossMargin)} />
              <MetricCell label="EPS" value={formatNullable(drawer.item.eps, 2)} />
              <MetricCell label="BPS" value={formatNullable(drawer.item.bps, 2)} />
              <MetricCell label="行业" value={drawer.item.industryName || "—"} />
              <MetricCell label="板块" value={drawer.item.marketBoard || "—"} />
            </div>

            {drawer.item.predictedChangeText || drawer.item.forecastType ? (
              <section className="stock-drawer-copy">
                <h4>预告说明</h4>
                <p>
                  {drawer.item.forecastType || "更新"} {drawer.item.predictedChangeText || formatRatioPercent(drawer.item.predictedChangePercent)}
                </p>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="stock-drawer-body">
            <div className="stock-drawer-meta-grid">
              <MetricCell label="公告日期" value={formatDateLabel(drawer.item.noticeDate)} />
              <MetricCell label="显示时间" value={formatDateTimeLabel(drawer.item.displayTime)} />
              <MetricCell label="公告类型" value={drawer.item.announcementType || "公告"} />
              <MetricCell label="页数" value={drawer.item.pageCount > 0 ? `${drawer.item.pageCount} 页` : "—"} />
              <MetricCell label="附件数" value={`${drawer.item.fileCount}`} />
            </div>

            <section className="stock-drawer-copy">
              <h4>正文摘要</h4>
              <p>{drawer.item.contentText || "当前公告暂无可提取的正文摘要。"}</p>
            </section>

            <div className="stock-drawer-links">
              {drawer.item.detailUrl ? (
                <a href={drawer.item.detailUrl} target="_blank" rel="noreferrer">
                  打开详情页
                </a>
              ) : null}
              {drawer.item.pdfUrl ? (
                <a href={drawer.item.pdfUrl} target="_blank" rel="noreferrer">
                  打开 PDF
                </a>
              ) : null}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-cell">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function OverviewStatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="stocks-overview-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ProgressRow({ label, value }: { label: string; value: number }) {
  const safe = Math.max(0, Math.min(100, value));
  return (
    <div className="pool-progress-row">
      <div className="pool-progress-header">
        <span>{label}</span>
        <strong>{safe}%</strong>
      </div>
      <div className="pool-progress-track">
        <span style={{ width: `${safe}%` }} />
      </div>
    </div>
  );
}

function ScreenerSlider({
  label,
  value,
  current,
  min,
  max,
  step,
  onValue
}: {
  label: string;
  value: string;
  current: number;
  min: number;
  max: number;
  step: number;
  onValue: (value: number) => void;
}) {
  return (
    <label className="screener-slider">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(event) => onValue(Number(event.target.value))}
      />
    </label>
  );
}

function resolveStrategyLabel(stock: StockItem): (typeof SCREENING_STRATEGIES)[number] {
  if ((stock.latestRoe ?? 0) >= 12 && (stock.latestNetProfitYoy ?? -999) >= 12) return "高确定性";
  if ((stock.latestDividendYield ?? 0) >= 0.03) return "高股息";
  if ((stock.latestPe ?? 99) <= 12 && (stock.latestPb ?? 99) <= 1.6) return "低估值";
  if (stock.mentionCount >= 14) return "高确定性";
  if ((stock.latestPe ?? 99) <= 16) return "低波动";
  return "现金流";
}

function matchStrategy(stock: StockItem, strategy: (typeof SCREENING_STRATEGIES)[number]): boolean {
  switch (strategy) {
    case "高股息":
      return (stock.latestDividendYield ?? 0) >= 0.02;
    case "低波动":
      return (stock.latestPe ?? 99) <= 18 && (stock.latestPb ?? 99) <= 3 && (stock.latestNetProfitYoy ?? -999) >= -20;
    case "高确定性":
      return stock.mentionCount >= 6 && (stock.latestRoe ?? 0) >= 8;
    case "低估值":
      return (stock.latestPe ?? 99) <= 12 && (stock.latestPb ?? 99) <= 1.8;
    case "现金流":
      return (stock.latestDividendYield ?? 0) >= 0.01 || ((stock.latestPe ?? 99) <= 10 && (stock.latestRoe ?? 0) >= 6);
    default:
      return true;
  }
}

function computeStrategyScore(stock: StockItem, strategy: (typeof SCREENING_STRATEGIES)[number]): number {
  const base = scoreFromMention(stock);
  const dividend = (stock.latestDividendYield ?? 0) * 100;
  const pe = stock.latestPe ?? 40;
  const pb = stock.latestPb ?? 8;
  const certainty = stock.mentionCount * 1.5;
  const financeBoost =
    Math.max(-40, Math.min(stock.latestRevenueYoy ?? 0, 80)) * 0.08 +
    Math.max(-40, Math.min(stock.latestNetProfitYoy ?? 0, 120)) * 0.1 +
    Math.max(0, Math.min(stock.latestRoe ?? 0, 20)) * 1.4 +
    Math.max(0, Math.min(stock.latestGrossMargin ?? 0, 60)) * 0.05;
  switch (strategy) {
    case "高股息":
      return base + financeBoost * 0.35 + dividend * 2.2 - pe * 0.1;
    case "低波动":
      return base + financeBoost * 0.45 + certainty + Math.max(0, 20 - pe) + Math.max(0, 4 - pb) * 3;
    case "高确定性":
      return base + financeBoost + certainty * 1.4 + Math.max(0, 4 - pb);
    case "低估值":
      return base + financeBoost * 0.5 + Math.max(0, 25 - pe) * 1.6 + Math.max(0, 3 - pb) * 5;
    case "现金流":
      return base + financeBoost * 0.55 + dividend * 1.8 + Math.max(0, 15 - pe) * 0.9;
    default:
      return base + financeBoost * 0.4;
  }
}

function mergeLiveStock(stock: StockItem, quote: LiveQuote | undefined): StockItem {
  if (!quote) return stock;
  return {
    ...stock,
    latestPrice: quote.latestPrice ?? stock.latestPrice,
    latestPe: quote.latestPe ?? stock.latestPe,
    latestPb: quote.latestPb ?? stock.latestPb,
    marketCap: quote.marketCap ?? stock.marketCap
  };
}

function resolveChangePercent(code: string, liveQuotes: Record<string, LiveQuote>): number {
  const liveValue = liveQuotes[code]?.changePercent;
  if (liveValue !== null && liveValue !== undefined && Number.isFinite(liveValue)) {
    return liveValue;
  }
  const value = hash(code);
  return ((value % 900) - 450) / 100;
}

function formatClock(iso: string | null): string {
  if (!iso) return "--:--:--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function formatLiveSource(source: string | null): string {
  if (!source) return "未知";
  if (source === "tencent") return "腾讯";
  if (source === "eastmoney") return "东方财富";
  if (source === "sina") return "新浪";
  if (source === "akshare") return "AKShare";
  if (source === "mixed") return "多源";
  return source;
}

function formatSuccessRate(success: number, total: number): string {
  if (total <= 0) return "0.0%";
  const rate = (Math.max(0, success) / total) * 100;
  return `${rate.toFixed(1)}%`;
}

function buildHighlights(stock: StockItem): string[] {
  const publishedLine =
    stock.publishedMentionCount > 0
      ? `当前站内已上线文章命中 ${stock.publishedMentionCount} 次，最近可读提及日期 ${formatDateLabel(stock.publishedLastMentionDate)}。`
      : "当前站内暂无已上线文章直接提及，相关讨论仍主要来自全文库整理。";

  return [
    `${stock.name} 在全文库中累计提及 ${stock.mentionCount} 次，最近一次全文库提及日期 ${formatDateLabel(stock.lastMentionDate)}。`,
    publishedLine,
    `当前行业为 ${stock.industry}，选股器的关注度排序仍以全文库提及频率参与计算。`,
    stock.latestDividendYield !== null
      ? `股息率约 ${formatPercent(stock.latestDividendYield)}，可用于防守型仓位配置。`
      : "暂无稳定分红数据，建议结合现金流再评估。",
    stock.latestPe !== null
      ? `估值端 PE ${formatNullable(stock.latestPe, 2)}，建议与历史分位一起观察。`
      : "暂缺有效 PE，建议重点看营收质量与资产负债结构。"
  ];
}

function hash(value: string): number {
  let output = 0;
  for (let i = 0; i < value.length; i += 1) {
    output = (output << 5) - output + value.charCodeAt(i);
    output |= 0;
  }
  return Math.abs(output);
}

function formatNullable(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function formatSignedPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function formatMarketCap(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const yi = value / 100_000_000;
  if (yi >= 10_000) {
    return `${(yi / 10_000).toFixed(2)} 万亿`;
  }
  return `${yi.toFixed(1)} 亿`;
}

function formatFinanceValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(2)} 亿`;
  }
  if (abs >= 10_000) {
    return `${(value / 10_000).toFixed(2)} 万`;
  }
  return value.toFixed(2);
}

function formatRatioPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

function formatDateLabel(value: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "—";
}

function formatDateTimeLabel(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function reportKindLabel(value: "yjbb" | "yjkb" | "yjyg") {
  if (value === "yjbb") return "业绩报表";
  if (value === "yjkb") return "业绩快报";
  return "业绩预告";
}

function shortenInlineText(value: string, limit: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(limit - 1, 1))}…`;
}
