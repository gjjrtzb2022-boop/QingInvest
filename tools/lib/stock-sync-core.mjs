import path from "node:path";
import { promises as fs, readFileSync } from "node:fs";
import pg from "pg";

const { Client } = pg;

export const ROOT_DIR = process.cwd();
export const REPORT_DIR = path.join(ROOT_DIR, "raw", "sync-reports");
export const STOCK_CACHE_DIR = path.join(ROOT_DIR, "raw", "stocks-cache");

export const EASTMONEY_HEADERS = {
  Referer: "https://data.eastmoney.com/",
  "User-Agent": "Mozilla/5.0",
  Accept: "application/json, text/javascript, */*; q=0.01"
};

const DEFAULT_DEV_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export function loadEnvFiles() {
  const shellKeys = new Set(Object.keys(process.env));
  loadEnvFile(path.join(ROOT_DIR, ".env"), { shellKeys, allowOverrideFromFile: false });
  loadEnvFile(path.join(ROOT_DIR, ".env.local"), { shellKeys, allowOverrideFromFile: true });
}

export function buildBatchId() {
  const now = new Date();
  const yyyy = `${now.getFullYear()}`;
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");
  const dd = `${now.getDate()}`.padStart(2, "0");
  const hh = `${now.getHours()}`.padStart(2, "0");
  const mi = `${now.getMinutes()}`.padStart(2, "0");
  const ss = `${now.getSeconds()}`.padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

export function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(raw);
}

export function resolveDatabaseUrl(target, explicitDbUrl = "") {
  if (explicitDbUrl) return explicitDbUrl;
  if (target === "prod") {
    const prodUrl = process.env.CONTENT_SYNC_DATABASE_URL_PROD || process.env.DATABASE_URL;
    if (!prodUrl) {
      throw new Error("prod 目标缺少数据库连接串，请设置 CONTENT_SYNC_DATABASE_URL_PROD 或 --db-url。");
    }
    return prodUrl;
  }
  return process.env.CONTENT_SYNC_DATABASE_URL_DEV || process.env.DATABASE_URL || DEFAULT_DEV_DB_URL;
}

export function resolveDbSsl(explicitValue) {
  if (typeof explicitValue === "boolean") return explicitValue;
  return parseBoolean(process.env.CONTENT_SYNC_DB_SSL);
}

export async function createDbClient(target, explicitDbUrl = "", explicitSsl) {
  const connectionString = resolveDatabaseUrl(target, explicitDbUrl);
  const ssl = resolveDbSsl(explicitSsl);
  const client = new Client({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : undefined
  });
  await client.connect();
  return client;
}

export async function safeClose(client) {
  if (!client) return;
  await client.end().catch(() => undefined);
}

export async function safeRollback(client) {
  if (!client) return;
  await client.query("rollback").catch(() => undefined);
}

export async function writeReport(prefix, batchId, report) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `${prefix}-${batchId}.json`);
  const latestPath = path.join(REPORT_DIR, `latest-${prefix}.json`);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(reportPath, serialized, "utf8");
  await fs.writeFile(latestPath, serialized, "utf8");
}

export async function writeStockCache(fileName, payload) {
  await fs.mkdir(STOCK_CACHE_DIR, { recursive: true });
  const targetPath = path.join(STOCK_CACHE_DIR, fileName);
  await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function markStockSyncRunRunning(client, options, details) {
  await client.query(
    `
      insert into public.stock_sync_runs (
        batch_id,
        sync_scope,
        target_env,
        sync_mode,
        triggered_by,
        status,
        details
      ) values ($1, $2, $3, $4, $5, 'running', $6::jsonb)
      on conflict (batch_id) do update
        set sync_scope = excluded.sync_scope,
            target_env = excluded.target_env,
            sync_mode = excluded.sync_mode,
            triggered_by = excluded.triggered_by,
            status = 'running',
            details = excluded.details,
            error_message = null,
            started_at = now(),
            finished_at = null
    `,
    [
      options.batchId,
      options.scope,
      options.target,
      options.mode,
      options.ci ? "ci" : "manual",
      JSON.stringify(details || {})
    ]
  );
}

export async function markStockSyncRunSuccess(client, options, payload) {
  await client.query(
    `
      update public.stock_sync_runs
         set status = 'success',
             stocks_seen = $2,
             stocks_upserted = $3,
             reports_upserted = $4,
             announcements_upserted = $5,
             announcement_files_upserted = $6,
             duration_ms = $7,
             details = $8::jsonb,
             error_message = null,
             finished_at = now()
       where batch_id = $1
    `,
    [
      options.batchId,
      payload.stocksSeen,
      payload.stocksUpserted,
      payload.reportsUpserted,
      payload.announcementsUpserted,
      payload.announcementFilesUpserted,
      payload.durationMs,
      JSON.stringify(payload.details || {})
    ]
  );
}

export async function markStockSyncRunFailed(client, options, payload) {
  try {
    await client.query(
      `
        update public.stock_sync_runs
           set status = 'failed',
               stocks_seen = $2,
               stocks_upserted = $3,
               reports_upserted = $4,
               announcements_upserted = $5,
               announcement_files_upserted = $6,
               duration_ms = $7,
               details = $8::jsonb,
               error_message = $9,
               finished_at = now()
         where batch_id = $1
      `,
      [
        options.batchId,
        payload.stocksSeen,
        payload.stocksUpserted,
        payload.reportsUpserted,
        payload.announcementsUpserted,
        payload.announcementFilesUpserted,
        payload.durationMs,
        JSON.stringify(payload.details || {}),
        payload.errorMessage
      ]
    );
  } catch {
    // Preserve the original error.
  }
}

export async function fetchJsonWithRetry(url, options = {}) {
  const text = await fetchTextWithRetry(url, options);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`json-parse-error:${normalizeError(error)}`);
  }
}

export async function fetchJsonpWithRetry(url, options = {}) {
  const text = await fetchTextWithRetry(url, options);
  const matched = text.trim().match(/^[^(]+\(([\s\S]*)\)\s*;?$/);
  if (!matched) {
    throw new Error("jsonp-parse-error:unexpected-body");
  }
  try {
    return JSON.parse(matched[1]);
  } catch (error) {
    throw new Error(`jsonp-parse-error:${normalizeError(error)}`);
  }
}

export async function fetchTextWithRetry(url, options = {}) {
  const retries = Number.isFinite(options.retries) ? Number(options.retries) : 5;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 15_000;
  const backoffMs = Number.isFinite(options.backoffMs) ? Number(options.backoffMs) : 800;
  const headers = {
    ...EASTMONEY_HEADERS,
    ...(options.headers || {})
  };

  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body,
        cache: "no-store",
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`http-${response.status}`);
      }
      if (!text.trim()) {
        throw new Error("empty-response");
      }
      return text;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await sleep(backoffMs * attempt + Math.round(Math.random() * 120));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(normalizeError(lastError));
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const resolved = [];
  const queue = [...items];
  const width = Math.max(1, Math.min(Number(concurrency) || 1, items.length || 1));
  const runners = Array.from({ length: width }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) return;
      resolved.push(await worker(next));
    }
  });
  await Promise.all(runners);
  return resolved;
}

export function chunk(items, size) {
  const width = Math.max(1, Number(size) || 1);
  const output = [];
  for (let index = 0; index < items.length; index += width) {
    output.push(items.slice(index, index + width));
  }
  return output;
}

export function dedupe(items) {
  return [...new Set(items)];
}

export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function toNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/,/g, "");
  if (!text || text === "-" || text === "--" || text.toLowerCase() === "nan") {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeDate(value) {
  const raw = normalizeText(value);
  if (!raw) return null;

  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }

  const direct = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) {
    return `${direct[1]}-${direct[2]}-${direct[3]}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDate(parsed);
  }

  return null;
}

export function normalizeTimestamp(value) {
  if (!value && value !== 0) return null;
  const direct = normalizeDate(value);
  if (direct && String(value).includes(":")) {
    const parsed = new Date(String(value).replace(/\s+/, "T"));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const numeric = toNumber(value);
  if (numeric !== null && numeric > 0) {
    const millis = numeric > 1e12 ? numeric : numeric * 1000;
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return null;
}

export function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const yyyy = `${date.getFullYear()}`;
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatCompactDate(value) {
  return normalizeText(value).replace(/-/g, "");
}

export function addDays(dateLike, offset) {
  const date = new Date(`${normalizeDate(dateLike)}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + offset);
  return formatDate(date);
}

export function buildDateRange(startDate, endDate) {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  if (!start || !end) return [];
  if (start > end) return [];
  const dates = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function latestCompletedQuarterEnd() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const quarterEnds = [
    `${year - 1}-12-31`,
    `${year}-03-31`,
    `${year}-06-30`,
    `${year}-09-30`,
    `${year}-12-31`
  ];
  for (let index = quarterEnds.length - 1; index >= 0; index -= 1) {
    if (quarterEnds[index] < formatDate(now)) {
      return quarterEnds[index].replace(/-/g, "");
    }
  }
  return `${year - 1}1231`;
}

export function buildQuarterPeriods(startCompactDate, endCompactDate) {
  const start = formatCompactDate(startCompactDate);
  const end = formatCompactDate(endCompactDate);
  if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || start > end) {
    return [];
  }

  const output = [];
  for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year += 1) {
    for (const suffix of ["0331", "0630", "0930", "1231"]) {
      const candidate = `${year}${suffix}`;
      if (candidate >= start && candidate <= end) {
        output.push(candidate);
      }
    }
  }
  return output;
}

export function compactDateToLabel(compactDate) {
  const raw = formatCompactDate(compactDate);
  const year = raw.slice(0, 4);
  const suffix = raw.slice(4);
  if (suffix === "0331") return `${year}Q1`;
  if (suffix === "0630") return `${year}H1`;
  if (suffix === "0930") return `${year}Q3`;
  if (suffix === "1231") return `${year}ANNUAL`;
  return raw;
}

export function detectExchange(code) {
  const value = normalizeText(code);
  if (/^(4|8|92)/.test(value)) return "BJ";
  if (/^(5|6|9|688|689)/.test(value)) return "SH";
  return "SZ";
}

export function codeToSymbol(code) {
  const normalized = normalizeText(code).padStart(6, "0");
  return `${normalized}.${detectExchange(normalized)}`;
}

export function codeToSecid(code) {
  const normalized = normalizeText(code).padStart(6, "0");
  return `${detectExchange(normalized) === "SH" ? 1 : 0}.${normalized}`;
}

export function detectBoard(code) {
  const value = normalizeText(code).padStart(6, "0");
  if (/^(4|8|92)/.test(value)) return "北交所";
  if (/^688/.test(value)) return "科创板";
  if (/^(300|301)/.test(value)) return "创业板";
  if (/^(600|601|603|605)/.test(value)) return "上证主板";
  if (/^(000|001|002|003)/.test(value)) return "深证主板";
  return "A股";
}

export function normalizeError(error) {
  if (!error) return "unknown-error";
  if (error instanceof Error) {
    const cause = error.cause ? normalizeError(error.cause) : "";
    return cause && cause !== error.message ? `${error.message}:${cause}` : error.message;
  }
  return String(error);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stringifyJsonForDb(value) {
  return JSON.stringify(sanitizeJsonValue(value)).replace(/\\u0000/g, "");
}

function sanitizeJsonValue(value) {
  if (typeof value === "string") {
    return stripInvalidUnicode(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeJsonValue(item)])
    );
  }
  return value;
}

function stripInvalidUnicode(value) {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) {
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] + value[index + 1];
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }
    output += value[index];
  }
  return output;
}

function loadEnvFile(filePath, context) {
  try {
    const source = readFileSync(filePath, "utf8");
    const lines = source.split(/\r?\n/);
    for (const line of lines) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const { key, value } = parsed;
      if (context.shellKeys.has(key)) continue;
      if (!context.allowOverrideFromFile && process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
  } catch {
    // Ignore missing env files.
  }
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const matched = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!matched) return null;
  let value = (matched[2] || "").trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  value = value.replace(/\\n/g, "\n");
  return { key: matched[1], value };
}
