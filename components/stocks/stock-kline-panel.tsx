"use client";

import { useEffect, useRef, useState } from "react";
import type { StockItem } from "@/lib/stocks-meta";
import type { KlinePeriod, KlinePoint } from "@/lib/stocks-kline";

type StockKlinePanelProps = {
  stock: StockItem;
};

type KlineResponse = {
  ok?: boolean;
  code?: string;
  period?: KlinePeriod;
  source?: string;
  fetchedAt?: string;
  error?: string;
  points?: KlinePoint[];
};

type CachedClientKline = {
  at: number;
  payload: KlineResponse;
};

const PERIOD_OPTIONS: Array<{ value: KlinePeriod; label: string }> = [
  { value: "intraday", label: "分时" },
  { value: "five_day", label: "五日" },
  { value: "day", label: "日K" },
  { value: "week", label: "周K" },
  { value: "month", label: "月K" },
  { value: "quarter", label: "季K" },
  { value: "year", label: "年K" }
];
const CLIENT_KLINE_CACHE_TTL_MS = 2 * 60 * 1000;
const CLIENT_KLINE_CACHE = new Map<string, CachedClientKline>();
let chartLibraryPromise: Promise<typeof import("lightweight-charts")> | null = null;

export function StockKlinePanel({ stock }: StockKlinePanelProps) {
  const [period, setPeriod] = useState<KlinePeriod>("day");
  const [points, setPoints] = useState<KlinePoint[]>([]);
  const [source, setSource] = useState<string>("未知");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverPoint, setHoverPoint] = useState<KlinePoint | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ left: 12, top: 12 });
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const latestHoverKeyRef = useRef<number | null>(null);

  useEffect(() => {
    const syncTheme = () => {
      const mode = document.documentElement.getAttribute("data-theme");
      setTheme(mode === "dark" ? "dark" : "light");
    };
    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let canceled = false;
    const cacheKey = `${stock.code}:${period}`;

    const pullKline = async () => {
      const cached = CLIENT_KLINE_CACHE.get(cacheKey);
      const isFresh = cached && Date.now() - cached.at <= CLIENT_KLINE_CACHE_TTL_MS;
      if (cached?.payload.points?.length) {
        applyKlinePayload(cached.payload, true);
      } else {
        setLoading(true);
        setError(null);
      }

      if (isFresh) {
        setLoading(false);
        return;
      }

      setLoading(!cached?.payload.points?.length);
      setError(null);
      try {
        const response = await fetch(`/api/stocks/kline/?code=${encodeURIComponent(stock.code)}&period=${period}`, {
          cache: "no-store"
        });

        const payload = (await response.json()) as KlineResponse;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `kline-http-${response.status}`);
        }

        if (canceled) return;
        CLIENT_KLINE_CACHE.set(cacheKey, {
          at: Date.now(),
          payload
        });
        applyKlinePayload(payload, true);
      } catch (fetchError) {
        if (canceled) return;
        if (!cached?.payload.points?.length) {
          setPoints([]);
          setHoverPoint(null);
          setTooltipVisible(false);
          setError(fetchError instanceof Error ? fetchError.message : "kline-fetch-error");
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    const applyKlinePayload = (payload: KlineResponse, resetHover: boolean) => {
      const nextPoints = payload.points || [];
      setPoints(nextPoints);
      if (resetHover) {
        setHoverPoint(nextPoints[nextPoints.length - 1] || null);
        setTooltipVisible(false);
        latestHoverKeyRef.current = nextPoints[nextPoints.length - 1]?.time || null;
      }
      setSource(payload.source || "未知");
      setFetchedAt(payload.fetchedAt || null);
      setError(null);
    };

    pullKline();
    return () => {
      canceled = true;
    };
  }, [period, stock.code]);

  useEffect(() => {
    if (!chartHostRef.current || points.length === 0) return;
    let removed = false;
    let cleanup: (() => void) | null = null;

    const draw = async () => {
      if (!chartLibraryPromise) {
        chartLibraryPromise = import("lightweight-charts");
      }
      const chartLib = chartLibraryPromise;

      const {
        ColorType,
        createChart,
        CrosshairMode,
        LineStyle,
        CandlestickSeries,
        HistogramSeries,
        LineSeries
      } = await chartLib;

      if (removed || !chartHostRef.current) return;
      chartHostRef.current.innerHTML = "";
      const host = chartHostRef.current;

      const chart = createChart(host, {
        height: 360,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: theme === "dark" ? "#9eb0c6" : "#5d6e86",
          fontSize: 12
        },
        rightPriceScale: {
          borderColor: theme === "dark" ? "#304053" : "#d7e0ea"
        },
        timeScale: {
          borderColor: theme === "dark" ? "#304053" : "#d7e0ea",
          timeVisible: true,
          secondsVisible: period === "intraday"
        },
        grid: {
          vertLines: {
            color: theme === "dark" ? "rgba(72,92,118,0.22)" : "rgba(133,153,180,0.2)",
            style: LineStyle.Dashed
          },
          horzLines: {
            color: theme === "dark" ? "rgba(72,92,118,0.2)" : "rgba(133,153,180,0.18)",
            style: LineStyle.Dashed
          }
        },
        crosshair: {
          mode: CrosshairMode.Normal
        },
        localization: {
          locale: "zh-CN"
        }
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#d63b3b",
        downColor: "#14945b",
        wickUpColor: "#d63b3b",
        wickDownColor: "#14945b",
        borderUpColor: "#d63b3b",
        borderDownColor: "#14945b",
        priceLineVisible: false
      });

      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: "",
        color: "rgba(62,126,217,0.45)",
        priceFormat: { type: "volume" }
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.78,
          bottom: 0
        }
      });

      const candleData = points.map((item) => ({
        time: item.time as any,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close
      }));
      candleSeries.setData(candleData);

      const volumeData = points.map((item) => ({
        time: item.time as any,
        value: item.volume ?? 0,
        color: (item.change ?? 0) >= 0 ? "rgba(214,59,59,0.48)" : "rgba(20,148,91,0.48)"
      }));
      volumeSeries.setData(volumeData);

      const maConfigs = [
        { window: 5, color: "#f59e0b" },
        { window: 10, color: "#2563eb" },
        { window: 20, color: "#d946ef" },
        { window: 30, color: "#f97316" },
        { window: 60, color: "#10b981" }
      ];
      for (const config of maConfigs) {
        const lineSeries = chart.addSeries(LineSeries, {
          color: config.color,
          lineWidth: 1,
          priceLineVisible: false
        });
        lineSeries.setData(buildMovingAverage(points, config.window).map((item) => ({ time: item.time as any, value: item.value })));
      }

      applyDefaultVisibleRange(chart, points, period);

      const pointMap = new Map(points.map((item) => [item.time, item]));
      const onCrosshairMove = (param: any) => {
        if (!param || !param.time || !param.point) {
          setTooltipVisible(false);
          return;
        }
        const point = pointMap.get(normalizeChartTime(param.time));
        if (!point) {
          setTooltipVisible(false);
          return;
        }

        if (latestHoverKeyRef.current !== point.time) {
          latestHoverKeyRef.current = point.time;
          setHoverPoint(point);
        }
        setTooltipVisible(true);

        const width = host.clientWidth || 0;
        const tooltipWidth = 230;
        const nextLeft = Math.min(Math.max(8, param.point.x + 14), Math.max(8, width - tooltipWidth - 8));
        setTooltipPos({ left: nextLeft, top: 10 });
      };

      chart.subscribeCrosshairMove(onCrosshairMove);
      const onMouseEnter = () => {
        if (latestHoverKeyRef.current !== null) {
          setTooltipVisible(true);
        }
      };
      const onMouseLeave = () => {
        setTooltipVisible(false);
      };
      host.addEventListener("mouseenter", onMouseEnter);
      host.addEventListener("mouseleave", onMouseLeave);

      const resizeObserver = new ResizeObserver((entries) => {
        const size = entries[0]?.contentRect;
        if (!size) return;
        chart.applyOptions({ width: Math.floor(size.width) });
      });
      resizeObserver.observe(host);

      cleanup = () => {
        resizeObserver.disconnect();
        chart.unsubscribeCrosshairMove(onCrosshairMove);
        host.removeEventListener("mouseenter", onMouseEnter);
        host.removeEventListener("mouseleave", onMouseLeave);
        chart.remove();
      };
    };

    draw();

    return () => {
      removed = true;
      if (cleanup) cleanup();
    };
  }, [period, points, theme]);

  const activePoint = hoverPoint || points[points.length - 1] || null;
  const sourceLabel = formatSourceLabel(source);
  const periodLabel = PERIOD_OPTIONS.find((item) => item.value === period)?.label || period;

  return (
    <section className="stock-kline-panel">
      <header className="stock-kline-toolbar">
        <div className="stock-kline-tabs">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`stock-kline-tab ${period === option.value ? "active" : ""}`}
              onClick={() => setPeriod(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="stock-kline-meta">
          <span>来源：{sourceLabel}</span>
          <span>{fetchedAt ? `更新时间 ${formatClock(fetchedAt)}` : "等待数据..."}</span>
        </p>
      </header>

      <div className="stock-kline-chart-host" ref={chartHostRef}>
        {loading ? <div className="stock-kline-state">加载图表中...</div> : null}
        {!loading && error ? <div className="stock-kline-state error">图表加载失败：{error}</div> : null}
      </div>

      {tooltipVisible && activePoint ? (
        <article className="stock-kline-tooltip" style={{ left: tooltipPos.left, top: tooltipPos.top }}>
          <p className="time">
            {periodLabel} {activePoint.label}
          </p>
          <p>
            开盘价 <strong>{formatPrice(activePoint.open)}</strong>
          </p>
          <p>
            最高价 <strong>{formatPrice(activePoint.high)}</strong>
          </p>
          <p>
            最低价 <strong>{formatPrice(activePoint.low)}</strong>
          </p>
          <p>
            收盘价 <strong>{formatPrice(activePoint.close)}</strong>
          </p>
          <p>
            涨跌额 <strong className={changeToneClass(activePoint.change)}>{formatSigned(activePoint.change)}</strong>
          </p>
          <p>
            涨跌幅{" "}
            <strong className={changeToneClass(activePoint.changePercent)}>
              {formatSignedPercent(activePoint.changePercent)}
            </strong>
          </p>
          <p>
            成交量 <strong>{formatVolume(activePoint.volume)}</strong>
          </p>
          <p>
            成交额 <strong>{formatAmount(activePoint.amount)}</strong>
          </p>
        </article>
      ) : null}
    </section>
  );
}

function buildMovingAverage(points: KlinePoint[], windowSize: number): Array<{ time: number; value: number }> {
  const output: Array<{ time: number; value: number }> = [];
  let sum = 0;
  const queue: number[] = [];

  for (const point of points) {
    queue.push(point.close);
    sum += point.close;
    if (queue.length > windowSize) {
      sum -= queue.shift() || 0;
    }
    if (queue.length === windowSize) {
      output.push({
        time: point.time,
        value: Number((sum / windowSize).toFixed(3))
      });
    }
  }
  return output;
}

function normalizeChartTime(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "object" && value) {
    const maybe = value as { year?: number; month?: number; day?: number };
    if (maybe.year && maybe.month && maybe.day) {
      const ms = Date.parse(
        `${String(maybe.year).padStart(4, "0")}-${String(maybe.month).padStart(2, "0")}-${String(maybe.day).padStart(
          2,
          "0"
        )}T00:00:00+08:00`
      );
      if (Number.isFinite(ms)) return Math.floor(ms / 1000);
    }
  }
  return Number.NaN;
}

function formatSourceLabel(source: string): string {
  if (source === "tencent") return "腾讯";
  if (source === "eastmoney") return "东方财富";
  if (source === "mixed") return "多源";
  return source || "未知";
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return value.toFixed(2);
}

function formatSigned(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function formatSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatVolume(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toFixed(2)}万手`;
  }
  return `${value.toFixed(0)}手`;
}

function formatAmount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(2)}亿`;
  }
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toFixed(2)}万`;
  }
  return value.toFixed(0);
}

function changeToneClass(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "";
}

function applyDefaultVisibleRange(
  chart: {
    timeScale: () => {
      setVisibleLogicalRange: (range: { from: number; to: number }) => void;
      fitContent: () => void;
    };
  },
  points: KlinePoint[],
  period: KlinePeriod
) {
  if (points.length === 0) return;

  const visibleBars = getDefaultVisibleBars(period);
  if (points.length <= visibleBars + 2) {
    chart.timeScale().fitContent();
    return;
  }

  const rightPadding = Math.min(Math.max(visibleBars * 0.08, 2), 6);
  const to = points.length - 1 + rightPadding;
  const from = Math.max(0, points.length - visibleBars);
  chart.timeScale().setVisibleLogicalRange({ from, to });
}

function getDefaultVisibleBars(period: KlinePeriod) {
  if (period === "intraday") return 240;
  if (period === "five_day") return 240 * 5;
  return 40;
}
