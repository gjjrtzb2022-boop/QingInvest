import type { StockItem } from "@/lib/stocks-meta";

export type KlinePeriod = "intraday" | "five_day" | "day" | "week" | "month" | "quarter" | "year";
export type KlineSource = "tencent" | "eastmoney" | "mixed";

export type KlinePoint = {
  time: number;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  amount: number | null;
  turnover: number | null;
  change: number | null;
  changePercent: number | null;
};

export type KlineResult = {
  period: KlinePeriod;
  source: KlineSource;
  points: KlinePoint[];
};

type CachedKline = {
  at: number;
  result: KlineResult;
};

const HISTORY_LIMITS: Record<Exclude<KlinePeriod, "intraday" | "five_day">, number> = {
  day: 20_000,
  week: 5_000,
  month: 2_400,
  quarter: 800,
  year: 300
};
const KLINE_CACHE_TTL_MS = 2 * 60 * 1000;
const KLINE_CACHE = new Map<string, CachedKline>();
const TENCENT_SAFE_LIMITS = [1200, 800, 500, 320];

export async function fetchStockKlineWithFallback(stock: StockItem, period: KlinePeriod): Promise<KlineResult> {
  const cacheKey = `${stock.code}:${period}`;
  const now = Date.now();
  const cached = KLINE_CACHE.get(cacheKey);
  if (cached && now - cached.at <= KLINE_CACHE_TTL_MS) {
    return cached.result;
  }

  try {
    const result =
      period === "intraday" || period === "five_day"
        ? await fetchMinuteSeriesWithFallback(stock, period)
        : await fetchCandleSeriesWithFallback(stock, period);
    KLINE_CACHE.set(cacheKey, { at: now, result });
    return result;
  } catch (error) {
    // If providers temporarily fail, serve recent cached points instead of hard fail.
    if (cached && cached.result.points.length > 0) {
      return {
        ...cached.result,
        source: "mixed"
      };
    }
    throw error;
  }
}

async function fetchMinuteSeriesWithFallback(stock: StockItem, period: KlinePeriod): Promise<KlineResult> {
  const attempts: Array<() => Promise<KlineResult>> = [
    async () => ({
      period,
      source: "tencent",
      points: period === "intraday" ? await fetchTencentIntraday(stock) : await fetchTencentFiveDay(stock)
    }),
    async () => ({
      period,
      source: "eastmoney",
      points: await fetchEastmoneyTrends(stock, period === "intraday" ? 1 : 5)
    })
  ];

  if (period === "five_day") {
    attempts.push(async () => ({
      period,
      source: "mixed",
      points: await buildFiveDayFallbackFromDaily(stock)
    }));
  }

  return runKlineAttempts(attempts, period);
}

async function fetchCandleSeriesWithFallback(stock: StockItem, period: KlinePeriod): Promise<KlineResult> {
  const attempts: Array<() => Promise<KlineResult>> = [
    async () => ({
      period,
      source: "eastmoney",
      points: await fetchEastmoneyKline(stock, period)
    }),
    async () => ({
      period,
      source: "tencent",
      points: await fetchTencentKline(stock, period)
    })
  ];

  return runKlineAttemptsSequential(attempts, period);
}

async function runKlineAttempts(attempts: Array<() => Promise<KlineResult>>, period: KlinePeriod): Promise<KlineResult> {
  if (attempts.length === 0) {
    throw new Error(`kline-${period}-fetch-failed:no-attempts`);
  }

  const wrappedAttempts = attempts.map(async (attempt) => {
    try {
      const result = await attempt();
      if (result.points.length === 0) {
        throw new Error(`${result.source}:empty`);
      }
      return {
        ...result,
        points: sortKlinePoints(result.points)
      };
    } catch (error) {
      throw new Error(normalizeError(error));
    }
  });

  try {
    const result = await Promise.any(wrappedAttempts);
    return result;
  } catch (error) {
    const aggregate = error as AggregateError & { errors?: unknown[] };
    const errors = (aggregate.errors || []).map(normalizeError);
    throw new Error(`kline-${period}-fetch-failed:${errors.join("|")}`);
  }
}

async function runKlineAttemptsSequential(
  attempts: Array<() => Promise<KlineResult>>,
  period: KlinePeriod
): Promise<KlineResult> {
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result.points.length > 0) {
        return {
          ...result,
          points: sortKlinePoints(result.points)
        };
      }
      errors.push(`${result.source}:empty`);
    } catch (error) {
      errors.push(normalizeError(error));
    }
  }

  throw new Error(`kline-${period}-fetch-failed:${errors.join("|")}`);
}

async function fetchEastmoneyKline(stock: StockItem, period: KlinePeriod): Promise<KlinePoint[]> {
  const secid = toEastmoneySecid(stock);
  const klt = mapPeriodToEastmoneyKlt(period);
  const lmt = mapPeriodToLimit(period);

  const params = new URLSearchParams({
    secid,
    klt,
    fqt: "1",
    lmt: String(lmt),
    end: "20500101",
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
  });

  const response = await fetchWithRetry(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params.toString()}`, {
    cache: "no-store",
    headers: {
      Referer: "https://quote.eastmoney.com/",
      "User-Agent": "Mozilla/5.0"
    },
    timeoutMs: 8_000,
    retries: 1
  });
  if (!response.ok) {
    throw new Error(`eastmoney-kline-http-${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: {
      klines?: string[];
    };
  };
  const rows = payload.data?.klines || [];

  return rows
    .map((row): KlinePoint | null => {
      const parts = row.split(",");
      const date = parts[0];
      const openRaw = toNumber(parts[1]);
      const closeRaw = toNumber(parts[2]);
      const highRaw = toNumber(parts[3]);
      const lowRaw = toNumber(parts[4]);
      const volume = toNumber(parts[5]);
      const amount = toNumber(parts[6]);
      const changePercent = toNumber(parts[8]);
      const change = toNumber(parts[9]);
      const turnover = toNumber(parts[10]);
      const time = toUnix(`${date} 15:00`);
      const open =
        openRaw !== null && openRaw > 0
          ? openRaw
          : closeRaw !== null && closeRaw > 0
            ? closeRaw
            : null;
      const close =
        closeRaw !== null && closeRaw > 0
          ? closeRaw
          : openRaw !== null && openRaw > 0
            ? openRaw
            : null;
      if (!Number.isFinite(time) || open === null || close === null) {
        return null;
      }
      const high = Math.max(open, close, highRaw ?? Number.NEGATIVE_INFINITY);
      const low = Math.min(open, close, lowRaw ?? Number.POSITIVE_INFINITY);

      return {
        time,
        label: date,
        open,
        high,
        low,
        close,
        volume,
        amount,
        turnover,
        change,
        changePercent
      };
    })
    .filter((item): item is KlinePoint => item !== null);
}

async function fetchEastmoneyTrends(stock: StockItem, ndays: 1 | 5): Promise<KlinePoint[]> {
  const params = new URLSearchParams({
    secid: toEastmoneySecid(stock),
    ndays: String(ndays),
    iscr: "0",
    iscca: "0",
    fields1: "f1,f2,f3,f4,f5,f6,f7,f8",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58"
  });

  const response = await fetchWithRetry(`https://push2his.eastmoney.com/api/qt/stock/trends2/get?${params.toString()}`, {
    cache: "no-store",
    headers: {
      Referer: "https://quote.eastmoney.com/",
      "User-Agent": "Mozilla/5.0"
    },
    timeoutMs: 8_000,
    retries: 1
  });
  if (!response.ok) {
    throw new Error(`eastmoney-trends-http-${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: {
      trends?: string[];
    };
  };
  const rows = payload.data?.trends || [];

  const output: KlinePoint[] = [];
  let prevClose: number | null = null;

  for (const row of rows) {
    const parts = row.split(",");
    const dateTime = parts[0];
    const priceRaw = toNumber(parts[1]);
    const priceFallback = toNumber(parts[2]);
    const highRaw = toNumber(parts[3]);
    const lowRaw = toNumber(parts[4]);
    const volume = toNumber(parts[5]);
    const amount = toNumber(parts[6]);
    const close =
      priceRaw !== null && priceRaw > 0
        ? priceRaw
        : priceFallback !== null && priceFallback > 0
          ? priceFallback
          : null;
    const time = toUnix(dateTime);

    if (!Number.isFinite(time) || close === null) continue;

    const open = prevClose ?? close;
    const high = Math.max(open, close, highRaw ?? Number.NEGATIVE_INFINITY);
    const low = Math.min(open, close, lowRaw ?? Number.POSITIVE_INFINITY);
    const change = close - open;
    const changePercent = open !== 0 ? (change / open) * 100 : null;

    output.push({
      time,
      label: dateTime,
      open,
      high,
      low,
      close,
      volume,
      amount,
      turnover: null,
      change,
      changePercent
    });

    prevClose = close;
  }

  return output;
}

async function fetchTencentIntraday(stock: StockItem): Promise<KlinePoint[]> {
  const symbol = toTencentSymbol(stock);
  const params = new URLSearchParams({
    code: symbol,
    _var: "minute_data"
  });

  const response = await fetchWithRetry(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?${params.toString()}`, {
    cache: "no-store",
    headers: {
      Referer: "https://gu.qq.com/",
      "User-Agent": "Mozilla/5.0"
    },
    timeoutMs: 8_000,
    retries: 1
  });
  if (!response.ok) {
    throw new Error(`tencent-minute-http-${response.status}`);
  }

  const text = await response.text();
  const payload = parseTencentWrappedJson(text, "minute_data");
  const entry = payload?.data?.[symbol];
  const date = entry?.data?.date as string | undefined;
  const lines = (entry?.data?.data || []) as string[];
  return parseTencentMinuteLines(lines, date);
}

async function fetchTencentFiveDay(stock: StockItem): Promise<KlinePoint[]> {
  const symbol = toTencentSymbol(stock);
  const params = new URLSearchParams({
    code: symbol,
    _var: "five_day_data"
  });

  const response = await fetchWithRetry(`https://web.ifzq.gtimg.cn/appstock/app/day/query?${params.toString()}`, {
    cache: "no-store",
    headers: {
      Referer: "https://gu.qq.com/",
      "User-Agent": "Mozilla/5.0"
    },
    timeoutMs: 8_000,
    retries: 1
  });
  if (!response.ok) {
    throw new Error(`tencent-day-http-${response.status}`);
  }

  const text = await response.text();
  const payload = parseTencentWrappedJson(text, "five_day_data");
  const entry = payload?.data?.[symbol];
  const dayRows = (entry?.data?.data || []) as Array<{ date?: string; data?: string[] }>;

  const output: KlinePoint[] = [];
  for (const day of dayRows) {
    output.push(...parseTencentMinuteLines(day.data || [], day.date));
  }
  return output;
}

async function fetchTencentKline(stock: StockItem, period: KlinePeriod): Promise<KlinePoint[]> {
  const symbol = toTencentSymbol(stock);
  const tencentPeriod = mapPeriodToTencentKline(period);

  if (period === "quarter") {
    const monthly = await fetchTencentKlineRaw(symbol, "month", HISTORY_LIMITS.month);
    return aggregateByQuarter(monthly);
  }

  if (period === "year") {
    const yearly = await fetchTencentKlineRaw(symbol, "year", HISTORY_LIMITS.year);
    if (yearly.length > 2) {
      return normalizeTencentKlineRows(yearly);
    }
    const monthly = await fetchTencentKlineRaw(symbol, "month", HISTORY_LIMITS.month);
    return aggregateByYear(monthly);
  }

  const rows = await fetchTencentKlineRaw(symbol, tencentPeriod, mapPeriodToLimit(period));
  return normalizeTencentKlineRows(rows);
}

async function fetchTencentKlineRaw(symbol: string, period: "day" | "week" | "month" | "year", lmt: number) {
  const candidateLimits = uniqueNumbers([lmt, ...TENCENT_SAFE_LIMITS]);

  for (const candidateLimit of candidateLimits) {
    const params = new URLSearchParams({
      param: `${symbol},${period},,,${candidateLimit}`,
      _var: "kline_data"
    });
    const response = await fetchWithRetry(`https://web.ifzq.gtimg.cn/appstock/app/kline/KLine?${params.toString()}`, {
      cache: "no-store",
      headers: {
        Referer: "https://gu.qq.com/",
        "User-Agent": "Mozilla/5.0"
      },
      timeoutMs: 8_000,
      retries: 1
    });
    if (!response.ok) {
      throw new Error(`tencent-kline-http-${response.status}`);
    }

    const text = await response.text();
    const payload = parseTencentWrappedJson(text, "kline_data");
    const entry = payload?.data?.[symbol];
    const rows = (entry?.[period] || []) as string[][];
    if (rows.length > 0) {
      return rows;
    }
  }

  return [];
}

function normalizeTencentKlineRows(rows: string[][]): KlinePoint[] {
  return rows
    .map((row, index): KlinePoint | null => {
      const date = row[0];
      const openRaw = toNumber(row[1]);
      const closeRaw = toNumber(row[2]);
      const highRaw = toNumber(row[3]);
      const lowRaw = toNumber(row[4]);
      const volume = toNumber(row[5]);
      const time = toUnix(`${date} 15:00`);
      const open =
        openRaw !== null && openRaw > 0
          ? openRaw
          : closeRaw !== null && closeRaw > 0
            ? closeRaw
            : null;
      const close =
        closeRaw !== null && closeRaw > 0
          ? closeRaw
          : openRaw !== null && openRaw > 0
            ? openRaw
            : null;
      if (!Number.isFinite(time) || open === null || close === null) {
        return null;
      }
      const high = Math.max(open, close, highRaw ?? Number.NEGATIVE_INFINITY);
      const low = Math.min(open, close, lowRaw ?? Number.POSITIVE_INFINITY);

      const prevCloseRaw = index > 0 ? toNumber(rows[index - 1][2]) : null;
      const prevOpenRaw = index > 0 ? toNumber(rows[index - 1][1]) : null;
      const prevClose =
        prevCloseRaw !== null && prevCloseRaw > 0
          ? prevCloseRaw
          : prevOpenRaw !== null && prevOpenRaw > 0
            ? prevOpenRaw
            : open;
      const change = prevClose !== null ? close - prevClose : null;
      const changePercent = prevClose ? ((close - prevClose) / prevClose) * 100 : null;

      return {
        time,
        label: date,
        open,
        high,
        low,
        close,
        volume,
        amount: null,
        turnover: null,
        change,
        changePercent
      };
    })
    .filter((item): item is KlinePoint => item !== null);
}

function aggregateByQuarter(rows: string[][]): KlinePoint[] {
  const grouped = new Map<string, string[][]>();
  for (const row of rows) {
    const date = row[0] || "";
    const [yearRaw, monthRaw] = date.split("-");
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    if (!year || !month) continue;
    const quarter = Math.floor((month - 1) / 3) + 1;
    const key = `${year}-Q${quarter}`;
    const bucket = grouped.get(key) || [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  const sortedKeys = [...grouped.keys()].sort();
  const outputRows: string[][] = [];
  for (const key of sortedKeys) {
    const bucket = grouped.get(key) || [];
    bucket.sort((a, b) => (a[0] || "").localeCompare(b[0] || ""));
    if (bucket.length === 0) continue;
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    const high = Math.max(...bucket.map((item) => toNumber(item[3]) || Number.NEGATIVE_INFINITY));
    const low = Math.min(...bucket.map((item) => toNumber(item[4]) || Number.POSITIVE_INFINITY));
    const volume = bucket.reduce((sum, item) => sum + (toNumber(item[5]) || 0), 0);

    outputRows.push([last[0], first[1], last[2], String(high), String(low), String(volume)]);
  }
  return normalizeTencentKlineRows(outputRows);
}

function aggregateByYear(rows: string[][]): KlinePoint[] {
  const grouped = new Map<string, string[][]>();
  for (const row of rows) {
    const date = row[0] || "";
    const year = date.split("-")[0];
    if (!year) continue;
    const bucket = grouped.get(year) || [];
    bucket.push(row);
    grouped.set(year, bucket);
  }

  const sortedKeys = [...grouped.keys()].sort();
  const outputRows: string[][] = [];
  for (const key of sortedKeys) {
    const bucket = grouped.get(key) || [];
    bucket.sort((a, b) => (a[0] || "").localeCompare(b[0] || ""));
    if (bucket.length === 0) continue;
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    const high = Math.max(...bucket.map((item) => toNumber(item[3]) || Number.NEGATIVE_INFINITY));
    const low = Math.min(...bucket.map((item) => toNumber(item[4]) || Number.POSITIVE_INFINITY));
    const volume = bucket.reduce((sum, item) => sum + (toNumber(item[5]) || 0), 0);

    outputRows.push([last[0], first[1], last[2], String(high), String(low), String(volume)]);
  }
  return normalizeTencentKlineRows(outputRows);
}

function parseTencentMinuteLines(lines: string[], dateRaw?: string): KlinePoint[] {
  const baseDate = normalizeDate(dateRaw);
  if (!baseDate) return [];

  const output: KlinePoint[] = [];
  let prevClose: number | null = null;
  let prevCumVolume: number | null = null;
  let prevCumAmount: number | null = null;

  for (const line of lines) {
    const [hhmm, priceRaw, cumVolumeRaw, cumAmountRaw] = line.split(" ");
    const close = toNumber(priceRaw);
    const cumVolume = toNumber(cumVolumeRaw);
    const cumAmount = toNumber(cumAmountRaw);
    if (!hhmm || close === null) continue;

    const label = `${baseDate} ${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
    const time = toUnix(label);
    if (!Number.isFinite(time)) continue;

    const open = prevClose ?? close;
    const high = Math.max(open, close);
    const low = Math.min(open, close);
    const volume =
      cumVolume === null ? null : prevCumVolume === null || cumVolume < prevCumVolume ? cumVolume : cumVolume - prevCumVolume;
    const amount =
      cumAmount === null ? null : prevCumAmount === null || cumAmount < prevCumAmount ? cumAmount : cumAmount - prevCumAmount;
    const change = close - open;
    const changePercent = open !== 0 ? (change / open) * 100 : null;

    output.push({
      time,
      label,
      open,
      high,
      low,
      close,
      volume,
      amount,
      turnover: null,
      change,
      changePercent
    });

    prevClose = close;
    prevCumVolume = cumVolume;
    prevCumAmount = cumAmount;
  }

  return output;
}

function parseTencentWrappedJson(raw: string, varName: string): any {
  const trimmed = raw.trim();
  if (trimmed.startsWith(`${varName}=`)) {
    return JSON.parse(trimmed.slice(varName.length + 1));
  }
  return JSON.parse(trimmed);
}

function toTencentSymbol(stock: Pick<StockItem, "code" | "market">): string {
  const numeric = stock.code.split(".")[0] || stock.code;
  if (stock.market === "SH") return `sh${numeric}`;
  if (stock.market === "SZ") return `sz${numeric}`;
  if (stock.market === "BJ") return `bj${numeric}`;
  if (stock.market === "HK") return `hk${numeric}`;
  return `sh${numeric}`;
}

function toEastmoneySecid(stock: Pick<StockItem, "code" | "market">): string {
  const numeric = stock.code.split(".")[0] || stock.code;
  if (stock.market === "SH") return `1.${numeric}`;
  if (stock.market === "SZ") return `0.${numeric}`;
  if (stock.market === "BJ") return `0.${numeric}`;
  return `116.${numeric}`;
}

function mapPeriodToEastmoneyKlt(period: KlinePeriod): string {
  if (period === "day") return "101";
  if (period === "week") return "102";
  if (period === "month") return "103";
  if (period === "quarter") return "104";
  if (period === "year") return "105";
  return "101";
}

function mapPeriodToTencentKline(period: KlinePeriod): "day" | "week" | "month" | "year" {
  if (period === "week") return "week";
  if (period === "month" || period === "quarter") return "month";
  if (period === "year") return "year";
  return "day";
}

function mapPeriodToLimit(period: KlinePeriod): number {
  if (period === "day") return HISTORY_LIMITS.day;
  if (period === "week") return HISTORY_LIMITS.week;
  if (period === "month") return HISTORY_LIMITS.month;
  if (period === "quarter") return HISTORY_LIMITS.quarter;
  if (period === "year") return HISTORY_LIMITS.year;
  return HISTORY_LIMITS.day;
}

async function buildFiveDayFallbackFromDaily(stock: StockItem): Promise<KlinePoint[]> {
  const daily = await fetchTencentKline(stock, "day");
  return daily.slice(-5).map((point) => ({
    ...point,
    label: point.label.split(" ")[0] || point.label
  }));
}

async function fetchWithRetry(
  input: string,
  options: {
    cache: RequestCache;
    headers: Record<string, string>;
    timeoutMs: number;
    retries: number;
  }
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const response = await fetch(input, {
        cache: options.cache,
        headers: options.headers,
        signal: AbortSignal.timeout(options.timeoutMs)
      });
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < options.retries) {
        await sleep(240 * (attempt + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("fetch-failed");
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function uniqueNumbers(items: number[]): number[] {
  return [...new Set(items.filter((item) => Number.isFinite(item) && item > 0).map((item) => Math.floor(item)))];
}

function normalizeDate(raw?: string): string | null {
  if (!raw) return null;
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

function toUnix(dateTime: string): number {
  const normalized = dateTime.includes("T") ? dateTime : dateTime.replace(" ", "T");
  const full = normalized.includes("+") ? normalized : `${normalized}+08:00`;
  const ms = Date.parse(full);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Number.NaN;
}

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "unknown-error";
}

function sortKlinePoints(points: KlinePoint[]): KlinePoint[] {
  return [...points].sort((a, b) => a.time - b.time);
}
