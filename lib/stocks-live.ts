import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StockItem } from "@/lib/stocks-meta";
import type { LiveFetchResult, LiveQuote, LiveSource } from "@/lib/stocks-types";

const execFileAsync = promisify(execFile);
const PROVIDER_ORDER: LiveSource[] = ["sina", "eastmoney", "tencent", "akshare"];
const LIVE_FETCH_TIMEOUT_MS = 2_500;
const EASTMONEY_CONCURRENCY = 12;
const AKSHARE_TIMEOUT_MS = 12_000;

export async function fetchLiveQuotesWithFallback(stocks: StockItem[]): Promise<LiveFetchResult> {
  if (stocks.length === 0) {
    return {
      quotes: new Map<string, LiveQuote>(),
      activeSource: "mixed",
      sourcesUsed: [],
      errors: {}
    };
  }

  const mergedQuotes = new Map<string, LiveQuote>();
  const errors: Partial<Record<LiveSource, string>> = {};
  const sourceSet = new Set<LiveSource>();
  let remaining = [...stocks];

  for (const source of PROVIDER_ORDER) {
    if (remaining.length === 0) break;

    try {
      const partial = await fetchFromSource(source, remaining);
      if (partial.size === 0) {
        errors[source] = "empty-response";
        continue;
      }

      for (const stock of remaining) {
        const quote = partial.get(stock.code);
        if (!quote || !isUsableQuote(quote)) continue;
        mergedQuotes.set(stock.code, quote);
        sourceSet.add(source);
      }
      remaining = remaining.filter((stock) => !mergedQuotes.has(stock.code));
    } catch (error) {
      errors[source] = normalizeError(error);
    }
  }

  if (mergedQuotes.size === 0) {
    throw new Error(
      `all-live-providers-failed:${PROVIDER_ORDER.map((source) => `${source}=${errors[source] || "n/a"}`).join(",")}`
    );
  }

  const sourcesUsed = PROVIDER_ORDER.filter((source) => sourceSet.has(source));
  const activeSource = sourcesUsed.length === 1 ? sourcesUsed[0] : "mixed";

  return {
    quotes: mergedQuotes,
    activeSource,
    sourcesUsed,
    errors
  };
}

async function fetchFromSource(source: LiveSource, stocks: StockItem[]): Promise<Map<string, LiveQuote>> {
  if (source === "tencent") return fetchTencentLiveQuotes(stocks);
  if (source === "eastmoney") return fetchEastmoneyLiveQuotes(stocks);
  if (source === "sina") return fetchSinaLiveQuotes(stocks);
  return fetchAkshareLiveQuotes(stocks);
}

async function fetchTencentLiveQuotes(stocks: StockItem[]): Promise<Map<string, LiveQuote>> {
  const symbolMap = new Map<string, StockItem>();
  const symbols = stocks.map((stock) => {
    const symbol = toTencentSymbol(stock);
    symbolMap.set(symbol, stock);
    return symbol;
  });

  const response = await fetchWithTimeout(`https://qt.gtimg.cn/q=${symbols.join(",")}`, {
    cache: "no-store",
    headers: {
      Referer: "https://gu.qq.com/",
      "User-Agent": "Mozilla/5.0"
    },
    timeoutMs: LIVE_FETCH_TIMEOUT_MS
  });
  if (!response.ok) {
    throw new Error(`http-${response.status}`);
  }

  const raw = await response.text();
  return parseTencentBatch(raw, symbolMap);
}

async function fetchSinaLiveQuotes(stocks: StockItem[]): Promise<Map<string, LiveQuote>> {
  const symbolMap = new Map<string, StockItem>();
  const symbols = stocks.map((stock) => {
    const symbol = toSinaSymbol(stock);
    symbolMap.set(symbol, stock);
    return symbol;
  });

  const response = await fetchWithTimeout(`https://hq.sinajs.cn/list=${symbols.join(",")}`, {
    cache: "no-store",
    headers: {
      Referer: "https://finance.sina.com.cn/",
      "User-Agent": "Mozilla/5.0"
    },
    timeoutMs: LIVE_FETCH_TIMEOUT_MS
  });
  if (!response.ok) {
    throw new Error(`http-${response.status}`);
  }

  const rawBuffer = await response.arrayBuffer();
  const raw = new TextDecoder("gbk").decode(rawBuffer);
  return parseSinaBatch(raw, symbolMap);
}

async function fetchEastmoneyLiveQuotes(stocks: StockItem[]): Promise<Map<string, LiveQuote>> {
  const result = new Map<string, LiveQuote>();
  const mapped = await mapWithConcurrency(stocks, EASTMONEY_CONCURRENCY, async (stock) => {
    const secid = toEastmoneySecid(stock);
    const params = new URLSearchParams({
      secid,
      ut: "fa5fd1943c7b386f172d6893dbfba10b",
      invt: "2",
      fields: "f43,f57,f170,f162,f167,f116"
    });

    const response = await fetchWithTimeout(`https://push2.eastmoney.com/api/qt/stock/get?${params.toString()}`, {
      cache: "no-store",
      headers: {
        Referer: "https://quote.eastmoney.com/",
        "User-Agent": "Mozilla/5.0"
      },
      timeoutMs: LIVE_FETCH_TIMEOUT_MS
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      data?: {
        f43?: number;
        f57?: string;
        f170?: number;
        f162?: number;
        f167?: number;
        f116?: number;
      };
    };
    const data = payload.data;
    if (!data?.f57) return null;

    return {
      code: stock.code,
      latestPrice: fromScaled(data.f43),
      changePercent: fromScaled(data.f170),
      latestPe: fromScaled(data.f162),
      latestPb: fromScaled(data.f167),
      marketCap: toNumber(data.f116),
      updatedAt: null,
      source: "eastmoney"
    } satisfies LiveQuote;
  });

  for (const item of mapped) {
    if (item?.code) {
      result.set(item.code, item);
    }
  }
  return result;
}

async function fetchAkshareLiveQuotes(stocks: StockItem[]): Promise<Map<string, LiveQuote>> {
  const codes = stocks.map((stock) => stock.code.split(".")[0]);
  const scriptPath = `${process.cwd()}/tools/fetch-akshare-quotes.py`;

  const { stdout } = await execFileAsync("python3", [scriptPath, "--codes", codes.join(",")], {
    timeout: AKSHARE_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      TQDM_DISABLE: "1"
    }
  });

  const payload = JSON.parse((stdout || "").trim()) as {
    ok?: boolean;
    error?: string;
    quotes?: Array<{
      code?: string;
      latest_price?: number | null;
      change_percent?: number | null;
      latest_pe?: number | null;
      latest_pb?: number | null;
      market_cap?: number | null;
      updated_at?: string | null;
    }>;
  };

  if (!payload.ok) {
    throw new Error(payload.error || "akshare-response-error");
  }

  const codeMap = new Map(stocks.map((stock) => [stock.code.split(".")[0], stock.code]));
  const result = new Map<string, LiveQuote>();

  for (const item of payload.quotes || []) {
    if (!item.code) continue;
    const fullCode = codeMap.get(item.code);
    if (!fullCode) continue;
    result.set(fullCode, {
      code: fullCode,
      latestPrice: toNumber(item.latest_price),
      changePercent: toNumber(item.change_percent),
      latestPe: toNumber(item.latest_pe),
      latestPb: toNumber(item.latest_pb),
      marketCap: toNumber(item.market_cap),
      updatedAt: typeof item.updated_at === "string" ? item.updated_at : null,
      source: "akshare"
    });
  }

  return result;
}

function parseTencentBatch(raw: string, symbolMap: Map<string, StockItem>): Map<string, LiveQuote> {
  const output = new Map<string, LiveQuote>();
  const pattern = /v_([a-z]{2}\d+)="([^"]*)";/g;
  let match: RegExpExecArray | null = pattern.exec(raw);

  while (match) {
    const symbol = (match[1] || "").toLowerCase();
    const stock = symbolMap.get(symbol);
    if (stock) {
      const fields = (match[2] || "").split("~");
      const marketCapYi = toNumber(fields[44]);
      output.set(stock.code, {
        code: stock.code,
        latestPrice: toNumber(fields[3]),
        changePercent: toNumber(fields[32]),
        latestPe: toNumber(fields[39]),
        latestPb: toNumber(fields[46]),
        marketCap: marketCapYi === null ? null : marketCapYi * 100_000_000,
        updatedAt: toIsoCompact(fields[30]),
        source: "tencent"
      });
    }
    match = pattern.exec(raw);
  }

  return output;
}

function parseSinaBatch(raw: string, symbolMap: Map<string, StockItem>): Map<string, LiveQuote> {
  const output = new Map<string, LiveQuote>();
  const pattern = /var hq_str_([a-z]{2}\d+)="([^"]*)";/g;
  let match: RegExpExecArray | null = pattern.exec(raw);

  while (match) {
    const symbol = (match[1] || "").toLowerCase();
    const stock = symbolMap.get(symbol);
    if (stock) {
      const fields = (match[2] || "").split(",");
      const latestPrice = toNumber(fields[3]);
      const prevClose = toNumber(fields[2]);
      const changePercent =
        latestPrice !== null && prevClose !== null && prevClose !== 0 ? ((latestPrice - prevClose) / prevClose) * 100 : null;

      output.set(stock.code, {
        code: stock.code,
        latestPrice,
        changePercent,
        latestPe: null,
        latestPb: null,
        marketCap: null,
        updatedAt: toIsoDateTime(fields[30], fields[31]),
        source: "sina"
      });
    }
    match = pattern.exec(raw);
  }

  return output;
}

function toTencentSymbol(stock: Pick<StockItem, "code" | "market">): string {
  const numeric = stock.code.split(".")[0] || stock.code;
  if (stock.market === "SH") return `sh${numeric}`;
  if (stock.market === "SZ") return `sz${numeric}`;
  if (stock.market === "BJ") return `bj${numeric}`;
  if (stock.market === "HK") return `hk${numeric}`;
  return `sh${numeric}`;
}

function toSinaSymbol(stock: Pick<StockItem, "code" | "market">): string {
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

function toIsoCompact(raw: string | undefined): string | null {
  if (!raw || raw.length !== 14) return null;
  const normalized = raw.replace(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
    "$1-$2-$3T$4:$5:$6+08:00"
  );
  return normalized.includes("T") ? normalized : null;
}

function toIsoDateTime(dateRaw: string | undefined, timeRaw: string | undefined): string | null {
  if (!dateRaw || !timeRaw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return null;
  if (!/^\d{2}:\d{2}:\d{2}$/.test(timeRaw)) return null;
  return `${dateRaw}T${timeRaw}+08:00`;
}

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fromScaled(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed === null ? null : parsed / 100;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "unknown-error";
}

function isUsableQuote(quote: LiveQuote): boolean {
  return quote.latestPrice !== null && Number.isFinite(quote.latestPrice);
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = typeof init.timeoutMs === "number" ? init.timeoutMs : LIVE_FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(new Error(`timeout-${timeoutMs}ms`)), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const result = new Array<R>(items.length);
  let index = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      result[current] = await handler(items[current], current);
    }
  });

  await Promise.all(workers);
  return result;
}
