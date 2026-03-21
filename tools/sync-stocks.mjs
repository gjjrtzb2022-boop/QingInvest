#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildBatchId,
  buildDateRange,
  buildQuarterPeriods,
  chunk,
  codeToSecid,
  codeToSymbol,
  compactDateToLabel,
  createDbClient,
  dedupe,
  detectBoard,
  detectExchange,
  fetchJsonWithRetry,
  fetchJsonpWithRetry,
  formatCompactDate,
  latestCompletedQuarterEnd,
  loadEnvFiles,
  markStockSyncRunFailed,
  markStockSyncRunRunning,
  markStockSyncRunSuccess,
  normalizeDate,
  normalizeError,
  normalizeText,
  normalizeTimestamp,
  parseBoolean,
  safeClose,
  stringifyJsonForDb,
  toNumber,
  writeReport,
  writeStockCache
} from "./lib/stock-sync-core.mjs";

const execFileAsync = promisify(execFile);
const UNIVERSE_ENDPOINT = "https://82.push2.eastmoney.com/api/qt/clist/get";
const YJBB_ENDPOINT = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const DATACENTER_ENDPOINT = "https://datacenter.eastmoney.com/securities/api/data/v1/get";
const ANNOUNCEMENT_INDEX_ENDPOINT = "https://np-anotice-stock.eastmoney.com/api/security/ann";
const ANNOUNCEMENT_CONTENT_ENDPOINT = "https://np-cnotice-stock-test.eastmoney.com/api/content/ann";

const UNIVERSE_FIELDS = [
  "f1",
  "f2",
  "f3",
  "f4",
  "f8",
  "f9",
  "f12",
  "f13",
  "f14",
  "f20",
  "f21",
  "f23",
  "f100",
  "f115",
  "f124"
].join(",");

const ANNOUNCEMENT_TYPE_MAP = {
  全部: "0",
  财务报告: "1",
  融资公告: "2",
  风险提示: "3",
  信息变更: "4",
  重大事项: "5",
  资产重组: "6",
  持股变动: "7"
};

const REPORT_CONFIGS = {
  yjbb: {
    endpoint: YJBB_ENDPOINT,
    pageSize: 500,
    buildParams(reportDate, pageNumber) {
      return {
        sortColumns: "UPDATE_DATE,SECURITY_CODE",
        sortTypes: "-1,-1",
        pageSize: "500",
        pageNumber: String(pageNumber),
        reportName: "RPT_LICO_FN_CPD",
        columns: "ALL",
        filter: `(REPORTDATE='${toEastmoneyDate(reportDate)}')`
      };
    }
  },
  yjkb: {
    endpoint: DATACENTER_ENDPOINT,
    pageSize: 500,
    buildParams(reportDate, pageNumber) {
      return {
        sortColumns: "UPDATE_DATE,SECURITY_CODE",
        sortTypes: "-1,-1",
        pageSize: "500",
        pageNumber: String(pageNumber),
        reportName: "RPT_FCI_PERFORMANCEE",
        columns: "ALL",
        filter:
          `(SECURITY_TYPE_CODE in ("058001001","058001008"))(TRADE_MARKET_CODE!="069001017")` +
          `(REPORT_DATE='${toEastmoneyDate(reportDate)}')`
      };
    }
  },
  yjyg: {
    endpoint: DATACENTER_ENDPOINT,
    pageSize: 500,
    buildParams(reportDate, pageNumber) {
      return {
        sortColumns: "NOTICE_DATE,SECURITY_CODE",
        sortTypes: "-1,-1",
        pageSize: "500",
        pageNumber: String(pageNumber),
        reportName: "RPT_PUBLIC_OP_NEWPREDICT",
        columns: "ALL",
        filter: `(REPORT_DATE='${toEastmoneyDate(reportDate)}')`
      };
    }
  }
};

main().catch((error) => {
  console.error(`[sync:stocks] ${normalizeError(error)}`);
  process.exitCode = 1;
});

async function main() {
  loadEnvFiles();

  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const counters = {
    stocksSeen: 0,
    stocksUpserted: 0,
    reportsUpserted: 0,
    announcementsUpserted: 0,
    announcementFilesUpserted: 0,
    announcementContentsHydrated: 0,
    announcementContentFailures: 0,
    reportPeriodsFetched: 0,
    announcementDatesFetched: 0
  };

  let client = null;
  const report = {
    tool: "sync-stocks",
    generatedAt: new Date().toISOString(),
    batchId: options.batchId,
    options: {
      target: options.target,
      scope: options.scope,
      mode: options.mode,
      dryRun: options.dryRun,
      reportKinds: options.reportKinds,
      reportStart: options.reportStart,
      reportEnd: options.reportEnd,
      announcementStart: options.announcementStart,
      announcementEnd: options.announcementEnd,
      announcementTypes: options.announcementTypes,
      hydrateAnnouncements: options.hydrateAnnouncements,
      announcementContentLimit: options.announcementContentLimit,
      universePageSize: options.universePageSize
    },
    stages: {}
  };

  try {
    if (!options.dryRun) {
      client = await createDbClient(options.target, options.dbUrl, options.dbSsl);
      await markStockSyncRunRunning(client, options, {
        dryRun: false,
        reportKinds: options.reportKinds,
        announcementTypes: options.announcementTypes
      });
    }

    let securityMap = new Map();

    if (options.scope === "universe" || options.scope === "full") {
      const universeStage = await syncUniverseStage(options, client);
      counters.stocksSeen += universeStage.count;
      counters.stocksUpserted += universeStage.upsertedCount;
      report.stages.universe = universeStage.report;
      securityMap = universeStage.securityMap;
    }

    if (!securityMap.size && client && (options.scope === "reports" || options.scope === "announcements" || options.scope === "full")) {
      securityMap = await loadSecurityMap(client);
    }

    if (options.scope === "reports" || options.scope === "full") {
      const reportsStage = await syncReportsStage(options, client, securityMap);
      counters.reportsUpserted += reportsStage.upsertedCount;
      counters.reportPeriodsFetched += reportsStage.periodCount;
      report.stages.reports = reportsStage.report;
      if (!securityMap.size && client) {
        securityMap = await loadSecurityMap(client);
      }
    }

    if (options.scope === "announcements" || options.scope === "full") {
      const announcementsStage = await syncAnnouncementsStage(options, client, securityMap);
      counters.announcementsUpserted += announcementsStage.upsertedCount;
      counters.announcementFilesUpserted += announcementsStage.fileUpsertedCount;
      counters.announcementContentsHydrated += announcementsStage.hydratedCount;
      counters.announcementContentFailures += announcementsStage.hydrationFailures;
      counters.announcementDatesFetched += announcementsStage.dateCount;
      report.stages.announcements = announcementsStage.report;
    }

    const durationMs = Date.now() - startedAt;
    report.status = options.dryRun ? "dry_run" : "success";
    report.result = {
      durationMs,
      counters
    };

    if (!options.dryRun && client) {
      await markStockSyncRunSuccess(client, options, {
        stocksSeen: counters.stocksSeen,
        stocksUpserted: counters.stocksUpserted,
        reportsUpserted: counters.reportsUpserted,
        announcementsUpserted: counters.announcementsUpserted,
        announcementFilesUpserted: counters.announcementFilesUpserted,
        durationMs,
        details: {
          announcementContentsHydrated: counters.announcementContentsHydrated,
          announcementContentFailures: counters.announcementContentFailures,
          reportPeriodsFetched: counters.reportPeriodsFetched,
          announcementDatesFetched: counters.announcementDatesFetched
        }
      });
    }

    await writeReport("sync-stocks", options.batchId, report);
    console.log(
      `[sync:stocks] 完成 scope=${options.scope} mode=${options.mode} stocks=${counters.stocksUpserted} reports=${counters.reportsUpserted} announcements=${counters.announcementsUpserted} files=${counters.announcementFilesUpserted} batch=${options.batchId}`
    );
    console.log(`[sync:stocks] 报告输出 raw/sync-reports/sync-stocks-${options.batchId}.json`);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    report.status = "failed";
    report.error = normalizeError(error);
    report.result = {
      durationMs,
      counters
    };

    if (!options.dryRun && client) {
      await markStockSyncRunFailed(client, options, {
        stocksSeen: counters.stocksSeen,
        stocksUpserted: counters.stocksUpserted,
        reportsUpserted: counters.reportsUpserted,
        announcementsUpserted: counters.announcementsUpserted,
        announcementFilesUpserted: counters.announcementFilesUpserted,
        durationMs,
        details: {
          announcementContentsHydrated: counters.announcementContentsHydrated,
          announcementContentFailures: counters.announcementContentFailures,
          reportPeriodsFetched: counters.reportPeriodsFetched,
          announcementDatesFetched: counters.announcementDatesFetched
        },
        errorMessage: normalizeError(error)
      });
    }

    await writeReport("sync-stocks", options.batchId, report);
    throw error;
  } finally {
    await safeClose(client);
  }
}

function parseArgs(args) {
  const latestQuarter = latestCompletedQuarterEnd();
  const defaultAnnouncementEnd = normalizeDate(new Date()) || "";
  const defaultAnnouncementStart = normalizeDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)) || defaultAnnouncementEnd;

  const options = {
    target: process.env.CONTENT_SYNC_TARGET || "dev",
    scope: "full",
    mode: "incremental",
    dryRun: false,
    ci: false,
    batchId: buildBatchId(),
    dbUrl: "",
    dbSsl: undefined,
    reportStart: "",
    reportEnd: "",
    reportKinds: ["yjbb", "yjkb", "yjyg"],
    reportLimitPeriods: 0,
    announcementStart: defaultAnnouncementStart,
    announcementEnd: defaultAnnouncementEnd,
    announcementTypes: ["全部"],
    hydrateAnnouncements: true,
    announcementContentLimit: 0,
    universePageSize: 200,
    universeMaxPages: 0
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--ci") {
      options.ci = true;
      continue;
    }

    const matched = arg.match(/^--([a-zA-Z0-9_-]+)=(.*)$/);
    if (!matched) {
      throw new Error(`Unsupported argument: ${arg}`);
    }

    const [, key, value] = matched;
    if (key === "target") {
      options.target = value || options.target;
      continue;
    }
    if (key === "scope") {
      options.scope = value || options.scope;
      continue;
    }
    if (key === "mode") {
      options.mode = value || options.mode;
      continue;
    }
    if (key === "batch-id") {
      options.batchId = value || options.batchId;
      continue;
    }
    if (key === "db-url") {
      options.dbUrl = value || options.dbUrl;
      continue;
    }
    if (key === "db-ssl") {
      options.dbSsl = parseBoolean(value);
      continue;
    }
    if (key === "report-start") {
      options.reportStart = formatCompactDate(value);
      continue;
    }
    if (key === "report-end") {
      options.reportEnd = formatCompactDate(value);
      continue;
    }
    if (key === "report-kinds") {
      options.reportKinds = dedupe(
        value
          .split(",")
          .map((item) => normalizeText(item).toLowerCase())
          .filter(Boolean)
      );
      continue;
    }
    if (key === "report-limit-periods") {
      options.reportLimitPeriods = Math.max(0, Number(value) || 0);
      continue;
    }
    if (key === "announcement-start") {
      options.announcementStart = normalizeDate(value) || options.announcementStart;
      continue;
    }
    if (key === "announcement-end") {
      options.announcementEnd = normalizeDate(value) || options.announcementEnd;
      continue;
    }
    if (key === "announcement-types") {
      options.announcementTypes = dedupe(
        value
          .split(",")
          .map((item) => normalizeText(item))
          .filter(Boolean)
      );
      continue;
    }
    if (key === "hydrate-announcements") {
      options.hydrateAnnouncements = parseBoolean(value, true);
      continue;
    }
    if (key === "announcement-content-limit") {
      options.announcementContentLimit = Math.max(0, Number(value) || 0);
      continue;
    }
    if (key === "universe-page-size") {
      options.universePageSize = Math.max(50, Math.min(500, Number(value) || options.universePageSize));
      continue;
    }
    if (key === "universe-max-pages") {
      options.universeMaxPages = Math.max(0, Number(value) || 0);
      continue;
    }

    throw new Error(`Unsupported flag: --${key}`);
  }

  if (!["dev", "prod"].includes(options.target)) {
    throw new Error(`Unsupported target: ${options.target}`);
  }
  if (!["universe", "reports", "announcements", "full"].includes(options.scope)) {
    throw new Error(`Unsupported scope: ${options.scope}`);
  }
  if (!["incremental", "full", "backfill"].includes(options.mode)) {
    throw new Error(`Unsupported mode: ${options.mode}`);
  }

  const latestPeriods = takeLatestPeriods(latestQuarter, options.mode === "incremental" ? 4 : 0);
  if (!options.reportStart) {
    options.reportStart = options.mode === "incremental" ? latestPeriods[0] || latestQuarter : "20100331";
  }
  if (!options.reportEnd) {
    options.reportEnd = latestQuarter;
  }
  if (options.reportStart > options.reportEnd) {
    throw new Error(`report-start 不能晚于 report-end: ${options.reportStart} > ${options.reportEnd}`);
  }

  for (const kind of options.reportKinds) {
    if (!REPORT_CONFIGS[kind]) {
      throw new Error(`Unsupported report kind: ${kind}`);
    }
  }
  for (const typeName of options.announcementTypes) {
    if (!(typeName in ANNOUNCEMENT_TYPE_MAP)) {
      throw new Error(`Unsupported announcement type: ${typeName}`);
    }
  }
  if ((options.scope === "announcements" || options.scope === "full") && options.announcementStart > options.announcementEnd) {
    throw new Error(
      `announcement-start 不能晚于 announcement-end: ${options.announcementStart} > ${options.announcementEnd}`
    );
  }

  return options;
}

async function syncUniverseStage(options, client) {
  console.log("[sync:stocks] 正在抓取 A 股主数据...");
  const universe = await fetchAStockUniverse(options);
  await writeStockCache("a-share-universe-latest.json", {
    generatedAt: new Date().toISOString(),
    count: universe.length,
    items: universe
  });

  let upsertedCount = 0;
  if (client) {
    upsertedCount = await upsertStockSecurities(client, universe);
  }

  const securityMap = client ? await loadSecurityMap(client) : new Map();
  return {
    count: universe.length,
    upsertedCount: client ? upsertedCount : 0,
    securityMap,
    report: {
      count: universe.length,
      sample: universe.slice(0, 6),
      cacheFile: "raw/stocks-cache/a-share-universe-latest.json"
    }
  };
}

async function fetchAStockUniverse(options) {
  try {
    const firstPage = await fetchUniversePage(1, options.universePageSize);
    const total = firstPage.total;
    const totalPages = options.universeMaxPages
      ? Math.min(options.universeMaxPages, Math.max(1, Math.ceil(total / options.universePageSize)))
      : Math.max(1, Math.ceil(total / options.universePageSize));

    const pages = [firstPage.items];
    const pageNumbers = [];
    for (let page = 2; page <= totalPages; page += 1) {
      pageNumbers.push(page);
    }

    for (const page of pageNumbers) {
      const result = await fetchUniversePage(page, options.universePageSize);
      pages.push(result.items);
    }

    return pages
      .flat()
      .filter((item) => item && item.code)
      .sort((left, right) => left.code.localeCompare(right.code, "en"));
  } catch (error) {
    console.warn(`[sync:stocks] Eastmoney A 股主数据抓取失败，改用交易所官方源兜底: ${normalizeError(error)}`);
    return fetchOfficialUniverseFallback();
  }
}

async function fetchUniversePage(pageNumber, pageSize) {
  const url = new URL(UNIVERSE_ENDPOINT);
  url.search = new URLSearchParams({
    pn: String(pageNumber),
    pz: String(pageSize),
    po: "1",
    np: "1",
    ut: "bd1d9ddb04089700cf9c27f6f7426281",
    fltt: "2",
    invt: "2",
    fid: "f12",
    fs: "m:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23,m:0 t:81 s:2048",
    fields: UNIVERSE_FIELDS
  }).toString();

  const payload = await fetchJsonWithRetry(url.toString(), {
    headers: {
      Referer: "https://quote.eastmoney.com/"
    },
    retries: 6,
    timeoutMs: 18_000,
    backoffMs: 900
  });

  const diff = Array.isArray(payload?.data?.diff) ? payload.data.diff : [];
  const total = Number(payload?.data?.total) || diff.length;

  return {
    total,
    items: diff.map(mapUniverseRow).filter(Boolean)
  };
}

function mapUniverseRow(row) {
  const code = normalizeText(row?.f12).padStart(6, "0");
  if (!/^\d{6}$/.test(code)) return null;

  const exchange = detectExchange(code);
  return {
    symbol: codeToSymbol(code),
    code,
    name: normalizeText(row?.f14),
    exchange,
    market: "CN",
    board: detectBoard(code),
    industry_name: normalizeText(row?.f100),
    secid: codeToSecid(code),
    listing_status: "listed",
    is_active: true,
    listed_at: null,
    latest_price: toNumber(row?.f2),
    change_percent: toNumber(row?.f3),
    change_amount: toNumber(row?.f4),
    turnover_rate: toNumber(row?.f8),
    volume_ratio: null,
    dynamic_pe: toNumber(row?.f9),
    pb_ratio: toNumber(row?.f23),
    dividend_yield: toNumber(row?.f115),
    total_market_cap: toNumber(row?.f20),
    float_market_cap: toNumber(row?.f21),
    latest_snapshot_at: normalizeTimestamp(row?.f124) || new Date().toISOString(),
    metadata: {
      source: "eastmoney-clist",
      marketCode: row?.f13 ?? null,
      raw: {
        f1: row?.f1 ?? null,
        f2: row?.f2 ?? null,
        f3: row?.f3 ?? null,
        f4: row?.f4 ?? null,
        f8: row?.f8 ?? null,
        f9: row?.f9 ?? null,
        f20: row?.f20 ?? null,
        f21: row?.f21 ?? null,
        f23: row?.f23 ?? null,
        f100: row?.f100 ?? null,
        f115: row?.f115 ?? null,
        f124: row?.f124 ?? null
      }
    }
  };
}

async function fetchOfficialUniverseFallback() {
  const scriptPath = `${process.cwd()}/tools/fetch-official-stock-universe.py`;
  const { stdout } = await execFileAsync("python3", [scriptPath], {
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024
  });
  const payload = JSON.parse((stdout || "").trim());
  if (!payload?.ok) {
    throw new Error(payload?.error || "official-universe-fallback-failed");
  }
  for (const warning of payload.warnings || []) {
    console.warn(`[sync:stocks] 官方股票列表警告: ${warning}`);
  }
  return Array.isArray(payload.stocks) ? payload.stocks : [];
}

async function syncReportsStage(options, client, securityMap) {
  const periods = resolveReportPeriods(options);
  console.log(`[sync:stocks] 正在抓取财报与业绩数据 periods=${periods.length} kinds=${options.reportKinds.join(",")}`);

  const allRows = [];
  for (const kind of options.reportKinds) {
    for (const period of periods) {
      const rows = await fetchFinancialReports(kind, period);
      allRows.push(...rows.map((row) => mapFinancialReportRow(kind, row)));
    }
  }

  const normalizedRows = allRows.filter(Boolean);
  const dedupedRows = dedupeBy(normalizedRows, (item) => item.source_record_key);
  let upsertedCount = 0;
  if (client && dedupedRows.length > 0) {
    const fullSecurityMap = securityMap.size ? securityMap : await loadSecurityMap(client);
    const ensuredSecurityMap = await ensureSecurityRows(client, fullSecurityMap, dedupedRows);
    upsertedCount = await upsertFinancialReports(client, dedupedRows, ensuredSecurityMap);
  }

  return {
    periodCount: periods.length,
    upsertedCount: client ? upsertedCount : 0,
    report: {
      periodCount: periods.length,
      rowCount: dedupedRows.length,
      rawRowCount: normalizedRows.length,
      kinds: options.reportKinds,
      periods,
      sample: dedupedRows.slice(0, 5)
    }
  };
}

function resolveReportPeriods(options) {
  const periods = buildQuarterPeriods(options.reportStart, options.reportEnd);
  if (options.reportLimitPeriods > 0) {
    return periods.slice(-options.reportLimitPeriods);
  }
  return periods;
}

function takeLatestPeriods(endCompactDate, count) {
  const periods = buildQuarterPeriods("20100331", endCompactDate);
  if (!count || count <= 0) return periods;
  return periods.slice(-count);
}

async function fetchFinancialReports(kind, compactDate) {
  const config = REPORT_CONFIGS[kind];
  const first = await fetchFinancialReportPage(config, compactDate, 1);
  const totalPages = first.pages;
  const rows = [...first.rows];
  const pageNumbers = [];
  for (let page = 2; page <= totalPages; page += 1) {
    pageNumbers.push(page);
  }

  for (const batch of chunk(pageNumbers, 2)) {
    const results = await Promise.all(batch.map((page) => fetchFinancialReportPage(config, compactDate, page)));
    for (const result of results) {
      rows.push(...result.rows);
    }
  }

  console.log(`[sync:stocks] 财报 kind=${kind} period=${compactDate} rows=${rows.length}`);
  return rows;
}

async function fetchFinancialReportPage(config, compactDate, pageNumber) {
  const url = new URL(config.endpoint);
  url.search = new URLSearchParams(config.buildParams(compactDate, pageNumber)).toString();
  const payload = await fetchJsonWithRetry(url.toString(), {
    retries: 5,
    timeoutMs: 18_000,
    backoffMs: 800
  });
  const result = payload?.result || {};
  return {
    pages: Number(result.pages) || 1,
    rows: Array.isArray(result.data) ? result.data : []
  };
}

function mapFinancialReportRow(kind, row) {
  const code = normalizeText(row?.SECURITY_CODE).padStart(6, "0");
  if (!/^\d{6}$/.test(code)) return null;

  const reportDate = normalizeDate(row?.REPORTDATE || row?.REPORT_DATE);
  const noticeDate = normalizeDate(row?.NOTICE_DATE || row?.UPDATE_DATE) || reportDate;
  const symbol = normalizeText(row?.SECUCODE) || codeToSymbol(code);
  const marketSuffix = symbol.split(".").pop()?.toUpperCase() || "";
  if (!["SH", "SZ", "BJ"].includes(marketSuffix)) {
    return null;
  }
  const securityType = normalizeText(row?.SECURITY_TYPE);
  const securityTypeCode = normalizeText(row?.SECURITY_TYPE_CODE);
  if (securityType && securityType !== "A股") {
    return null;
  }
  if (securityTypeCode && !["058001001", "058001008"].includes(securityTypeCode)) {
    return null;
  }
  const reportLabel = normalizeText(row?.DATATYPE) || compactDateToLabel(formatCompactDate(reportDate || ""));
  const base = {
    source_record_key: `${kind}:${code}:${reportDate || "unknown"}:${noticeDate || "unknown"}`,
    symbol,
    stock_code: code,
    stock_name: normalizeText(row?.SECURITY_NAME_ABBR),
    report_kind: kind,
    report_date: reportDate,
    report_period: compactDateToLabel(formatCompactDate(reportDate || "")),
    report_label: reportLabel,
    notice_date: noticeDate,
    industry_name: normalizeText(row?.PUBLISHNAME),
    market_board: normalizeText(row?.TRADE_MARKET),
    eps: toNumber(row?.BASIC_EPS),
    deduct_eps: toNumber(row?.DEDUCT_BASIC_EPS),
    revenue: toNumber(row?.TOTAL_OPERATE_INCOME),
    revenue_last_year: toNumber(row?.TOTAL_OPERATE_INCOME_SQ),
    revenue_yoy: toNumber(row?.YSTZ),
    revenue_qoq: toNumber(row?.YSHZ ?? row?.DJDYSHZ),
    net_profit: toNumber(row?.PARENT_NETPROFIT),
    net_profit_last_year: toNumber(row?.PARENT_NETPROFIT_SQ),
    net_profit_yoy: toNumber(row?.SJLTZ ?? row?.JLRTBZCL),
    net_profit_qoq: toNumber(row?.SJLHZ ?? row?.DJDJLHZ),
    bps: toNumber(row?.BPS ?? row?.PARENT_BVPS),
    roe_weighted: toNumber(row?.WEIGHTAVG_ROE),
    operating_cashflow_per_share: toNumber(row?.MGJYXJJE),
    gross_margin: toNumber(row?.XSMLL),
    predicted_metric: "",
    predicted_change_text: "",
    predicted_value: null,
    predicted_change_percent: null,
    predicted_reason: "",
    forecast_type: "",
    previous_period_value: null,
    is_latest: row?.IS_LATEST === "T" ? true : row?.IS_LATEST === "F" ? false : null,
    source: "eastmoney",
    raw_payload: row
  };

  if (kind === "yjyg") {
    const lowerAmount = toNumber(row?.PREDICT_AMT_LOWER);
    const upperAmount = toNumber(row?.PREDICT_AMT_UPPER);
    const lowerAmp = toNumber(row?.ADD_AMP_LOWER);
    const upperAmp = toNumber(row?.ADD_AMP_UPPER);

    base.predicted_metric = normalizeText(row?.PREDICT_FINANCE);
    base.predicted_change_text = normalizeText(row?.PREDICT_CONTENT);
    base.predicted_value = averageNullable(lowerAmount, upperAmount, toNumber(row?.FORECAST_JZ));
    base.predicted_change_percent = averageNullable(lowerAmp, upperAmp, toNumber(row?.INCREASE_JZ));
    base.predicted_reason = normalizeText(row?.CHANGE_REASON_EXPLAIN);
    base.forecast_type = normalizeText(row?.PREDICT_TYPE);
    base.previous_period_value = toNumber(row?.PREYEAR_SAME_PERIOD);
  }

  if (!base.report_date) return null;
  return base;
}

async function syncAnnouncementsStage(options, client, securityMap) {
  const dates = buildDateRange(options.announcementStart, options.announcementEnd);
  console.log(`[sync:stocks] 正在抓取公告数据 dates=${dates.length} types=${options.announcementTypes.join(",")}`);

  const rows = [];
  for (const date of dates) {
    for (const typeName of options.announcementTypes) {
      const items = await fetchAnnouncementIndex(typeName, date);
      rows.push(...items.flatMap((item) => mapAnnouncementIndexRow(item)));
    }
  }

  const dedupedRows = dedupeBy(rows.filter(Boolean), (item) => item.source_record_key);
  let hydratedCount = 0;
  let hydrationFailures = 0;
  if (options.hydrateAnnouncements && dedupedRows.length > 0) {
    const artCodes = dedupe(dedupedRows.map((item) => item.announcement_code));
    const limitedArtCodes =
      options.announcementContentLimit > 0 ? artCodes.slice(0, options.announcementContentLimit) : artCodes;
    const detailMap = new Map();

    for (const batch of chunk(limitedArtCodes, 4)) {
      const batchResults = await Promise.all(
        batch.map(async (artCode) => {
          try {
            const detail = await fetchAnnouncementContent(artCode);
            hydratedCount += 1;
            return [artCode, detail];
          } catch (error) {
            hydrationFailures += 1;
            console.warn(`[sync:stocks] 公告正文抓取失败 art_code=${artCode} error=${normalizeError(error)}`);
            return [artCode, null];
          }
        })
      );

      for (const [artCode, detail] of batchResults) {
        detailMap.set(artCode, detail);
      }
    }

    for (const row of dedupedRows) {
      const detail = detailMap.get(row.announcement_code);
      if (!detail) continue;
      row.pdf_url = detail.pdf_url;
      row.page_count = detail.page_count;
      row.language = detail.language;
      row.attach_type = detail.attach_type;
      row.content_text = detail.content_text;
      row.raw_payload = {
        index: row.raw_payload,
        detail: detail.raw_payload
      };
      row._attachments = detail.attachments;
    }
  }

  let upsertedCount = 0;
  let fileUpsertedCount = 0;
  if (client && dedupedRows.length > 0) {
    const fullSecurityMap = securityMap.size ? securityMap : await loadSecurityMap(client);
    const ensuredSecurityMap = await ensureSecurityRows(client, fullSecurityMap, dedupedRows);
    upsertedCount = await upsertAnnouncements(client, dedupedRows, ensuredSecurityMap);
    fileUpsertedCount = await upsertAnnouncementFiles(client, dedupedRows);
  }

  return {
    dateCount: dates.length,
    upsertedCount: client ? upsertedCount : 0,
    fileUpsertedCount: client ? fileUpsertedCount : 0,
    hydratedCount,
    hydrationFailures,
    report: {
      dateCount: dates.length,
      rowCount: dedupedRows.length,
      hydratedCount,
      hydrationFailures,
      sample: dedupedRows.slice(0, 5).map(stripAnnouncementPrivateFields)
    }
  };
}

async function fetchAnnouncementIndex(typeName, date) {
  const first = await fetchAnnouncementIndexPage(typeName, date, 1);
  const totalPages = first.pages;
  const rows = [...first.rows];
  const pageNumbers = [];
  for (let page = 2; page <= totalPages; page += 1) {
    pageNumbers.push(page);
  }

  for (const batch of chunk(pageNumbers, 2)) {
    const results = await Promise.all(batch.map((page) => fetchAnnouncementIndexPage(typeName, date, page)));
    for (const result of results) {
      rows.push(...result.rows);
    }
  }

  console.log(`[sync:stocks] 公告 type=${typeName} date=${date} rows=${rows.length}`);
  return rows;
}

async function fetchAnnouncementIndexPage(typeName, date, pageNumber) {
  const url = new URL(ANNOUNCEMENT_INDEX_ENDPOINT);
  url.search = new URLSearchParams({
    sr: "-1",
    page_size: "100",
    page_index: String(pageNumber),
    ann_type: "A",
    client_source: "web",
    f_node: ANNOUNCEMENT_TYPE_MAP[typeName],
    s_node: "0",
    begin_time: date,
    end_time: date
  }).toString();

  const payload = await fetchJsonWithRetry(url.toString(), {
    retries: 5,
    timeoutMs: 18_000,
    backoffMs: 900
  });
  const data = payload?.data || {};
  return {
    pages: Math.max(1, Math.ceil((Number(data.total_hits) || 0) / 100)),
    rows: Array.isArray(data.list) ? data.list : []
  };
}

function mapAnnouncementIndexRow(row) {
  const columns = Array.isArray(row?.columns) ? row.columns : [];
  const column = columns[0] || {};
  const announcementType = normalizeText(column.column_name);
  const announcementTypeCode = normalizeText(column.column_code);
  const noticeDate = normalizeDate(row?.notice_date);
  const displayTime = normalizeAnnouncementDisplayTime(row?.display_time || row?.eiTime);
  const artCode = normalizeText(row?.art_code);
  const title = normalizeText(row?.title || row?.title_ch);
  const codes = normalizeAnnouncementCodes(row?.codes);

  return codes.map((codeItem) => {
    const stockCode = normalizeText(codeItem?.stock_code).padStart(6, "0");
    if (!/^\d{6}$/.test(stockCode)) return null;
    return {
      source_record_key: `${artCode}:${stockCode}`,
      announcement_code: artCode,
      symbol: codeToSymbol(stockCode),
      stock_code: stockCode,
      stock_name: normalizeText(codeItem?.short_name),
      title,
      announcement_type: announcementType,
      announcement_type_code: announcementTypeCode,
      notice_date: noticeDate,
      display_time: displayTime,
      detail_url: `https://data.eastmoney.com/notices/detail/${stockCode}/${artCode}.html`,
      pdf_url: "",
      page_count: 0,
      language: "",
      attach_type: "",
      content_text: "",
      source: "eastmoney",
      raw_payload: row,
      _attachments: []
    };
  });
}

function normalizeAnnouncementCodes(codes) {
  if (!Array.isArray(codes)) return [];
  const filtered = codes.filter((item) => normalizeText(item?.ann_type).startsWith("A"));
  return filtered.length > 0 ? filtered : codes;
}

async function fetchAnnouncementContent(artCode) {
  const url = new URL(ANNOUNCEMENT_CONTENT_ENDPOINT);
  url.search = new URLSearchParams({
    art_code: artCode,
    client_source: "web",
    page_index: "1",
    cb: "callback"
  }).toString();

  const payload = await fetchJsonpWithRetry(url.toString(), {
    retries: 5,
    timeoutMs: 18_000,
    backoffMs: 800
  });
  const data = payload?.data || {};
  const attachments = (Array.isArray(data.attach_list) ? data.attach_list : []).map((item) => ({
    file_seq: Number(item?.seq) || 1,
    file_type: normalizeText(item?.attach_type),
    file_name: fileNameFromUrl(item?.attach_url),
    file_size_kb: toNumber(item?.attach_size),
    file_url: normalizeText(item?.attach_url),
    raw_payload: item
  }));

  return {
    pdf_url: normalizeText(data.attach_url_web || data.attach_url),
    page_count: Math.max(0, Number(data.page_size) || 0),
    language: normalizeText(data.language),
    attach_type: normalizeText(data.attach_type),
    content_text: normalizeText(data.notice_content),
    attachments,
    raw_payload: {
      notice_title: normalizeText(data.notice_title),
      notice_date: normalizeDate(data.notice_date),
      page_size: Math.max(0, Number(data.page_size) || 0),
      language: normalizeText(data.language),
      attach_type: normalizeText(data.attach_type),
      attach_url_web: normalizeText(data.attach_url_web || data.attach_url),
      is_rich: data.is_rich ?? null,
      is_rich2: data.is_rich2 ?? null,
      is_ai_summary: data.is_ai_summary ?? null
    }
  };
}

async function loadSecurityMap(client) {
  const result = await client.query(`select id, code, symbol, name from public.stock_securities`);
  const map = new Map();
  for (const row of result.rows || []) {
    map.set(normalizeText(row.code).padStart(6, "0"), {
      id: Number(row.id),
      code: normalizeText(row.code).padStart(6, "0"),
      symbol: normalizeText(row.symbol),
      name: normalizeText(row.name)
    });
  }
  return map;
}

async function ensureSecurityRows(client, currentMap, rows) {
  const missing = [];
  for (const row of rows) {
    const code = normalizeText(row.stock_code || row.code).padStart(6, "0");
    if (!/^\d{6}$/.test(code) || currentMap.has(code)) continue;
    missing.push({
      symbol: normalizeText(row.symbol) || codeToSymbol(code),
      code,
      name: normalizeText(row.stock_name || row.name),
      exchange: detectExchange(code),
      market: "CN",
      board: detectBoard(code),
      industry_name: normalizeText(row.industry_name),
      secid: codeToSecid(code),
      listing_status: "listed",
      is_active: true,
      listed_at: null,
      latest_price: null,
      change_percent: null,
      change_amount: null,
      turnover_rate: null,
      volume_ratio: null,
      dynamic_pe: null,
      pb_ratio: null,
      dividend_yield: null,
      total_market_cap: null,
      float_market_cap: null,
      latest_snapshot_at: null,
      metadata: {
        source: "placeholder-from-disclosure"
      }
    });
  }

  if (missing.length > 0) {
    await upsertStockSecurities(client, dedupeBy(missing, (item) => item.code));
  }
  return loadSecurityMap(client);
}

async function upsertStockSecurities(client, rows) {
  let affected = 0;
  for (const batch of chunk(rows, 400)) {
    await client.query(
      `
        with input as (
          select * from json_to_recordset($1::json) as x(
            symbol text,
            code text,
            name text,
            exchange text,
            market text,
            board text,
            industry_name text,
            secid text,
            listing_status text,
            is_active boolean,
            listed_at date,
            latest_price double precision,
            change_percent double precision,
            change_amount double precision,
            turnover_rate double precision,
            volume_ratio double precision,
            dynamic_pe double precision,
            pb_ratio double precision,
            dividend_yield double precision,
            total_market_cap double precision,
            float_market_cap double precision,
            latest_snapshot_at timestamptz,
            metadata jsonb
          )
        )
        insert into public.stock_securities (
          symbol,
          code,
          name,
          exchange,
          market,
          board,
          industry_name,
          secid,
          listing_status,
          is_active,
          listed_at,
          latest_price,
          change_percent,
          change_amount,
          turnover_rate,
          volume_ratio,
          dynamic_pe,
          pb_ratio,
          dividend_yield,
          total_market_cap,
          float_market_cap,
          latest_snapshot_at,
          metadata
        )
        select
          symbol,
          code,
          name,
          exchange,
          market,
          board,
          industry_name,
          secid,
          listing_status,
          is_active,
          listed_at,
          latest_price,
          change_percent,
          change_amount,
          turnover_rate,
          volume_ratio,
          dynamic_pe,
          pb_ratio,
          dividend_yield,
          total_market_cap,
          float_market_cap,
          latest_snapshot_at,
          coalesce(metadata, '{}'::jsonb)
        from input
        on conflict (symbol) do update
          set code = excluded.code,
              name = excluded.name,
              exchange = excluded.exchange,
              market = excluded.market,
              board = excluded.board,
              industry_name = excluded.industry_name,
              secid = excluded.secid,
              listing_status = excluded.listing_status,
              is_active = excluded.is_active,
              listed_at = coalesce(excluded.listed_at, public.stock_securities.listed_at),
              latest_price = excluded.latest_price,
              change_percent = excluded.change_percent,
              change_amount = excluded.change_amount,
              turnover_rate = excluded.turnover_rate,
              volume_ratio = excluded.volume_ratio,
              dynamic_pe = excluded.dynamic_pe,
              pb_ratio = excluded.pb_ratio,
              dividend_yield = excluded.dividend_yield,
              total_market_cap = excluded.total_market_cap,
              float_market_cap = excluded.float_market_cap,
              latest_snapshot_at = excluded.latest_snapshot_at,
              metadata = excluded.metadata,
              updated_at = now()
      `,
      [stringifyJsonForDb(batch)]
    );
    affected += batch.length;
  }
  return affected;
}

async function upsertFinancialReports(client, rows, securityMap) {
  const mapped = rows.map((row) => ({
    ...row,
    stock_security_id: securityMap.get(row.stock_code)?.id || null
  }));
  let affected = 0;
  const sql = `
        with input as (
          select * from json_to_recordset($1::json) as x(
            stock_security_id bigint,
            source_record_key text,
            symbol text,
            stock_code text,
            stock_name text,
            report_kind text,
            report_date date,
            report_period text,
            report_label text,
            notice_date date,
            industry_name text,
            market_board text,
            eps double precision,
            deduct_eps double precision,
            revenue double precision,
            revenue_last_year double precision,
            revenue_yoy double precision,
            revenue_qoq double precision,
            net_profit double precision,
            net_profit_last_year double precision,
            net_profit_yoy double precision,
            net_profit_qoq double precision,
            bps double precision,
            roe_weighted double precision,
            operating_cashflow_per_share double precision,
            gross_margin double precision,
            predicted_metric text,
            predicted_change_text text,
            predicted_value double precision,
            predicted_change_percent double precision,
            predicted_reason text,
            forecast_type text,
            previous_period_value double precision,
            is_latest boolean,
            source text,
            raw_payload jsonb
          )
        )
        insert into public.stock_financial_reports (
          stock_security_id,
          source_record_key,
          symbol,
          stock_code,
          stock_name,
          report_kind,
          report_date,
          report_period,
          report_label,
          notice_date,
          industry_name,
          market_board,
          eps,
          deduct_eps,
          revenue,
          revenue_last_year,
          revenue_yoy,
          revenue_qoq,
          net_profit,
          net_profit_last_year,
          net_profit_yoy,
          net_profit_qoq,
          bps,
          roe_weighted,
          operating_cashflow_per_share,
          gross_margin,
          predicted_metric,
          predicted_change_text,
          predicted_value,
          predicted_change_percent,
          predicted_reason,
          forecast_type,
          previous_period_value,
          is_latest,
          source,
          raw_payload
        )
        select
          stock_security_id,
          source_record_key,
          symbol,
          stock_code,
          stock_name,
          report_kind,
          report_date,
          report_period,
          report_label,
          notice_date,
          industry_name,
          market_board,
          eps,
          deduct_eps,
          revenue,
          revenue_last_year,
          revenue_yoy,
          revenue_qoq,
          net_profit,
          net_profit_last_year,
          net_profit_yoy,
          net_profit_qoq,
          bps,
          roe_weighted,
          operating_cashflow_per_share,
          gross_margin,
          predicted_metric,
          predicted_change_text,
          predicted_value,
          predicted_change_percent,
          predicted_reason,
          forecast_type,
          previous_period_value,
          is_latest,
          source,
          coalesce(raw_payload, '{}'::jsonb)
        from input
        on conflict (source_record_key) do update
          set stock_security_id = excluded.stock_security_id,
              symbol = excluded.symbol,
              stock_code = excluded.stock_code,
              stock_name = excluded.stock_name,
              report_kind = excluded.report_kind,
              report_date = excluded.report_date,
              report_period = excluded.report_period,
              report_label = excluded.report_label,
              notice_date = excluded.notice_date,
              industry_name = excluded.industry_name,
              market_board = excluded.market_board,
              eps = excluded.eps,
              deduct_eps = excluded.deduct_eps,
              revenue = excluded.revenue,
              revenue_last_year = excluded.revenue_last_year,
              revenue_yoy = excluded.revenue_yoy,
              revenue_qoq = excluded.revenue_qoq,
              net_profit = excluded.net_profit,
              net_profit_last_year = excluded.net_profit_last_year,
              net_profit_yoy = excluded.net_profit_yoy,
              net_profit_qoq = excluded.net_profit_qoq,
              bps = excluded.bps,
              roe_weighted = excluded.roe_weighted,
              operating_cashflow_per_share = excluded.operating_cashflow_per_share,
              gross_margin = excluded.gross_margin,
              predicted_metric = excluded.predicted_metric,
              predicted_change_text = excluded.predicted_change_text,
              predicted_value = excluded.predicted_value,
              predicted_change_percent = excluded.predicted_change_percent,
              predicted_reason = excluded.predicted_reason,
              forecast_type = excluded.forecast_type,
              previous_period_value = excluded.previous_period_value,
              is_latest = excluded.is_latest,
              source = excluded.source,
              raw_payload = excluded.raw_payload,
              updated_at = now()
      `;

  for (const batch of chunk(mapped, 400)) {
    affected += await executeJsonBatchWithFallback(client, sql, batch, {
      entityLabel: "financial-report",
      keyField: "source_record_key"
    });
  }

  return affected;
}

async function upsertAnnouncements(client, rows, securityMap) {
  const mapped = rows.map((row) => ({
    ...row,
    stock_security_id: securityMap.get(row.stock_code)?.id || null
  }));
  let affected = 0;
  const sql = `
        with input as (
          select * from json_to_recordset($1::json) as x(
            stock_security_id bigint,
            source_record_key text,
            announcement_code text,
            symbol text,
            stock_code text,
            stock_name text,
            title text,
            announcement_type text,
            announcement_type_code text,
            notice_date date,
            display_time timestamptz,
            detail_url text,
            pdf_url text,
            page_count integer,
            language text,
            attach_type text,
            content_text text,
            source text,
            raw_payload jsonb
          )
        )
        insert into public.stock_announcements (
          stock_security_id,
          source_record_key,
          announcement_code,
          symbol,
          stock_code,
          stock_name,
          title,
          announcement_type,
          announcement_type_code,
          notice_date,
          display_time,
          detail_url,
          pdf_url,
          page_count,
          language,
          attach_type,
          content_text,
          source,
          raw_payload
        )
        select
          stock_security_id,
          source_record_key,
          announcement_code,
          symbol,
          stock_code,
          stock_name,
          title,
          announcement_type,
          announcement_type_code,
          notice_date,
          display_time,
          detail_url,
          pdf_url,
          page_count,
          language,
          attach_type,
          content_text,
          source,
          coalesce(raw_payload, '{}'::jsonb)
        from input
        on conflict (source_record_key) do update
          set stock_security_id = excluded.stock_security_id,
              announcement_code = excluded.announcement_code,
              symbol = excluded.symbol,
              stock_code = excluded.stock_code,
              stock_name = excluded.stock_name,
              title = excluded.title,
              announcement_type = excluded.announcement_type,
              announcement_type_code = excluded.announcement_type_code,
              notice_date = excluded.notice_date,
              display_time = excluded.display_time,
              detail_url = excluded.detail_url,
              pdf_url = excluded.pdf_url,
              page_count = excluded.page_count,
              language = excluded.language,
              attach_type = excluded.attach_type,
              content_text = excluded.content_text,
              source = excluded.source,
              raw_payload = excluded.raw_payload,
              updated_at = now()
      `;

  for (const batch of chunk(mapped, 300)) {
    affected += await executeJsonBatchWithFallback(
      client,
      sql,
      batch.map(stripAnnouncementPrivateFields),
      {
        entityLabel: "announcement",
        keyField: "source_record_key"
      }
    );
  }

  return affected;
}

async function upsertAnnouncementFiles(client, rows) {
  const sourceKeys = rows
    .filter((row) => Array.isArray(row._attachments) && row._attachments.length > 0)
    .map((row) => row.source_record_key);
  if (sourceKeys.length === 0) return 0;

  const announcementResult = await client.query(
    `
      select id, source_record_key
        from public.stock_announcements
       where source_record_key = any($1::text[])
    `,
    [sourceKeys]
  );
  const idMap = new Map();
  for (const row of announcementResult.rows || []) {
    idMap.set(normalizeText(row.source_record_key), Number(row.id));
  }

  const files = [];
  for (const row of rows) {
    const announcementId = idMap.get(row.source_record_key);
    if (!announcementId) continue;
    for (const attachment of row._attachments || []) {
      if (!attachment.file_url) continue;
      files.push({
        announcement_id: announcementId,
        file_seq: attachment.file_seq,
        file_type: attachment.file_type,
        file_name: attachment.file_name,
        file_size_kb: attachment.file_size_kb,
        file_url: attachment.file_url,
        raw_payload: attachment.raw_payload
      });
    }
  }

  let affected = 0;
  for (const batch of chunk(files, 300)) {
    await client.query(
      `
        with input as (
          select * from json_to_recordset($1::json) as x(
            announcement_id bigint,
            file_seq integer,
            file_type text,
            file_name text,
            file_size_kb double precision,
            file_url text,
            raw_payload jsonb
          )
        )
        insert into public.stock_announcement_files (
          announcement_id,
          file_seq,
          file_type,
          file_name,
          file_size_kb,
          file_url,
          raw_payload
        )
        select
          announcement_id,
          file_seq,
          file_type,
          file_name,
          file_size_kb,
          file_url,
          coalesce(raw_payload, '{}'::jsonb)
        from input
        on conflict (announcement_id, file_url) do update
          set file_seq = excluded.file_seq,
              file_type = excluded.file_type,
              file_name = excluded.file_name,
              file_size_kb = excluded.file_size_kb,
              raw_payload = excluded.raw_payload,
              updated_at = now()
      `,
      [stringifyJsonForDb(batch)]
    );
    affected += batch.length;
  }

  return affected;
}

async function executeJsonBatchWithFallback(client, sql, rows, options) {
  if (rows.length === 0) return 0;

  try {
    await client.query(sql, [stringifyJsonForDb(rows)]);
    return rows.length;
  } catch (error) {
    console.warn(
      `[sync:stocks] 批量写入降级为逐条写入 type=${options.entityLabel} size=${rows.length} error=${normalizeError(error)}`
    );
  }

  let affected = 0;
  for (const row of rows) {
    try {
      await client.query(sql, [stringifyJsonForDb([row])]);
      affected += 1;
      continue;
    } catch (error) {
      const fallbackRow = {
        ...row,
        raw_payload: {}
      };
      try {
        await client.query(sql, [stringifyJsonForDb([fallbackRow])]);
        affected += 1;
        console.warn(
          `[sync:stocks] 已移除 raw_payload 后写入 type=${options.entityLabel} key=${row[options.keyField] || ""}`
        );
      } catch (retryError) {
        console.warn(
          `[sync:stocks] 跳过异常记录 type=${options.entityLabel} key=${row[options.keyField] || ""} error=${normalizeError(retryError)}`
        );
      }
    }
  }

  return affected;
}

function toEastmoneyDate(compactDate) {
  return `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
}

function averageNullable(...values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function dedupeBy(items, selector) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = selector(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function normalizeAnnouncementDisplayTime(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const custom = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}):(\d{1,3})$/);
  if (custom) {
    return new Date(`${custom[1]}T${custom[2]}.${custom[3].padStart(3, "0")}+08:00`).toISOString();
  }
  return normalizeTimestamp(raw);
}

function fileNameFromUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  const withoutQuery = raw.split("?")[0];
  const parts = withoutQuery.split("/").filter(Boolean);
  return parts[parts.length - 1] || withoutQuery;
}

function stripAnnouncementPrivateFields(row) {
  const { _attachments, ...rest } = row;
  return rest;
}
