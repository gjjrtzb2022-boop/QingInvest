import { getServerDbPool } from "@/lib/server/db";
import { getStockByCode } from "@/lib/server/stock-catalog";
import type { StockItem } from "@/lib/stocks-meta";
import type {
  StockDetailAnnouncement,
  StockDetailPayload,
  StockDetailReport,
  StockDetailSnapshot
} from "@/lib/stocks-detail-types";

type SecurityRow = {
  symbol: string;
  name: string;
  exchange: "SH" | "SZ" | "BJ";
  board: string | null;
  industry_name: string | null;
  listed_at: string | null;
  listing_status: string | null;
  latest_snapshot_at: string | null;
};

type ReportRow = {
  report_kind: "yjbb" | "yjkb" | "yjyg";
  report_date: string;
  report_label: string | null;
  notice_date: string | null;
  industry_name: string | null;
  market_board: string | null;
  eps: number | null;
  bps: number | null;
  revenue: number | null;
  revenue_yoy: number | null;
  net_profit: number | null;
  net_profit_yoy: number | null;
  roe_weighted: number | null;
  gross_margin: number | null;
  predicted_change_text: string | null;
  predicted_change_percent: number | null;
  forecast_type: string | null;
};

type AnnouncementRow = {
  id: number;
  title: string;
  announcement_type: string | null;
  notice_date: string;
  display_time: string | null;
  detail_url: string | null;
  pdf_url: string | null;
  page_count: number | null;
  content_text: string | null;
  file_count: string | number | null;
};

const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const detailCache = new Map<string, { at: number; payload: StockDetailPayload }>();

export async function getStockDetail(code: string): Promise<StockDetailPayload> {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) {
    return {
      ok: false,
      code: "",
      stock: null,
      latestReports: [],
      reportTimeline: [],
      recentAnnouncements: [],
      error: "missing-code"
    };
  }

  const cached = detailCache.get(normalizedCode);
  if (cached && Date.now() - cached.at <= DETAIL_CACHE_TTL_MS) {
    return cached.payload;
  }

  const stock = await getStockByCode(normalizedCode);
  if (!stock) {
    return {
      ok: false,
      code: normalizedCode,
      stock: null,
      latestReports: [],
      reportTimeline: [],
      recentAnnouncements: [],
      error: "unknown-code"
    };
  }

  const pool = getServerDbPool();
  const bareCode = stock.code.split(".")[0] || stock.code;

  const [securityResult, reportsResult, timelineResult, announcementsResult] = await Promise.all([
    pool.query<SecurityRow>(
      `
        select symbol, name, exchange, board, industry_name, listed_at::text, listing_status, latest_snapshot_at::text
        from public.stock_securities
        where symbol = $1 or code = $2
        order by case when symbol = $1 then 0 else 1 end
        limit 1
      `,
      [stock.code, bareCode]
    ),
    pool.query<ReportRow>(
      `
        with ranked as (
          select
            report_kind,
            report_date::text,
            report_label,
            notice_date::text,
            industry_name,
            market_board,
            eps,
            bps,
            revenue,
            revenue_yoy,
            net_profit,
            net_profit_yoy,
            roe_weighted,
            gross_margin,
            predicted_change_text,
            predicted_change_percent,
            forecast_type,
            row_number() over (
              partition by report_kind
              order by report_date desc, notice_date desc nulls last, id desc
            ) as rn
          from public.stock_financial_reports
          where symbol = $1 or stock_code = $2
        )
        select
          report_kind,
          report_date,
          report_label,
          notice_date,
          industry_name,
          market_board,
          eps,
          bps,
          revenue,
          revenue_yoy,
          net_profit,
          net_profit_yoy,
          roe_weighted,
          gross_margin,
          predicted_change_text,
          predicted_change_percent,
          forecast_type
        from ranked
        where rn = 1
        order by report_date desc, notice_date desc nulls last
      `,
      [stock.code, bareCode]
    ),
    pool.query<ReportRow>(
      `
        select
          report_kind,
          report_date::text,
          report_label,
          notice_date::text,
          industry_name,
          market_board,
          eps,
          bps,
          revenue,
          revenue_yoy,
          net_profit,
          net_profit_yoy,
          roe_weighted,
          gross_margin,
          predicted_change_text,
          predicted_change_percent,
          forecast_type
        from public.stock_financial_reports
        where symbol = $1 or stock_code = $2
        order by
          report_date desc,
          notice_date desc nulls last,
          case report_kind when 'yjbb' then 0 when 'yjkb' then 1 else 2 end,
          id desc
        limit 12
      `,
      [stock.code, bareCode]
    ),
    pool.query<AnnouncementRow>(
      `
        select
          a.id,
          a.title,
          a.announcement_type,
          a.notice_date::text,
          a.display_time::text,
          a.detail_url,
          a.pdf_url,
          a.page_count,
          a.content_text,
          count(f.id) as file_count
        from public.stock_announcements a
        left join public.stock_announcement_files f on f.announcement_id = a.id
        where a.symbol = $1 or a.stock_code = $2
        group by a.id
        order by a.notice_date desc, a.display_time desc nulls last, a.id desc
        limit 8
      `,
      [stock.code, bareCode]
    )
  ]);

  const security = securityResult.rows[0];
  const payload: StockDetailPayload = {
    ok: true,
    code: stock.code,
    stock: security ? mapSecurityRow(stock.code, security) : mapFallbackStock(stock),
    latestReports: reportsResult.rows.map(mapReportRow),
    reportTimeline: timelineResult.rows.map(mapReportRow),
    recentAnnouncements: announcementsResult.rows.map(mapAnnouncementRow)
  };

  detailCache.set(normalizedCode, { at: Date.now(), payload });
  return payload;
}

function mapSecurityRow(code: string, row: SecurityRow): StockDetailSnapshot {
  return {
    code,
    name: normalizeName(row.name),
    market: row.exchange,
    industry: normalizeIndustry(row.industry_name),
    board: String(row.board || "").trim(),
    listedAt: sanitizeDate(row.listed_at),
    listingStatus: String(row.listing_status || "listed").trim(),
    latestSnapshotAt: sanitizeDateTime(row.latest_snapshot_at)
  };
}

function mapFallbackStock(stock: StockItem): StockDetailSnapshot {
  return {
    code: stock.code,
    name: stock.name,
    market: stock.market,
    industry: stock.industry,
    board: "",
    listedAt: "",
    listingStatus: "listed",
    latestSnapshotAt: null
  };
}

function mapReportRow(row: ReportRow): StockDetailReport {
  return {
    reportKind: row.report_kind,
    reportDate: sanitizeDate(row.report_date),
    reportLabel: formatReportLabel(row.report_label, row.report_kind, row.report_date),
    noticeDate: sanitizeDate(row.notice_date),
    industryName: normalizeIndustry(row.industry_name),
    marketBoard: String(row.market_board || "").trim(),
    eps: toNumber(row.eps),
    bps: toNumber(row.bps),
    revenue: toNumber(row.revenue),
    revenueYoy: toNumber(row.revenue_yoy),
    netProfit: toNumber(row.net_profit),
    netProfitYoy: toNumber(row.net_profit_yoy),
    roeWeighted: toNumber(row.roe_weighted),
    grossMargin: toNumber(row.gross_margin),
    predictedChangeText: String(row.predicted_change_text || "").trim(),
    predictedChangePercent: toNumber(row.predicted_change_percent),
    forecastType: String(row.forecast_type || "").trim()
  };
}

function mapAnnouncementRow(row: AnnouncementRow): StockDetailAnnouncement {
  return {
    id: Number(row.id),
    title: String(row.title || "").trim(),
    announcementType: String(row.announcement_type || "公告").trim(),
    noticeDate: sanitizeDate(row.notice_date),
    displayTime: sanitizeDateTime(row.display_time),
    detailUrl: String(row.detail_url || "").trim(),
    pdfUrl: String(row.pdf_url || "").trim(),
    pageCount: Number.isFinite(Number(row.page_count)) ? Number(row.page_count) : 0,
    contentText: compactText(String(row.content_text || "")),
    fileCount: Number.isFinite(Number(row.file_count)) ? Number(row.file_count) : 0
  };
}

function normalizeCode(value: string) {
  return String(value || "").trim().toUpperCase();
}

function normalizeName(value: string) {
  return String(value || "")
    .replace(/[\u00a0\u3000\s]+/g, "")
    .trim();
}

function normalizeIndustry(value: string | null) {
  return String(value || "")
    .replace(/^[A-Z]\s+/i, "")
    .trim();
}

function sanitizeDate(value: string | null) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

function sanitizeDateTime(value: string | null) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function reportKindLabel(kind: StockDetailReport["reportKind"]) {
  if (kind === "yjbb") return "业绩报表";
  if (kind === "yjkb") return "业绩快报";
  return "业绩预告";
}

function formatReportLabel(rawLabel: string | null, kind: StockDetailReport["reportKind"], reportDate: string) {
  const raw = String(rawLabel || "").trim();
  if (raw && /[\u4e00-\u9fa5]/.test(raw)) {
    return raw;
  }

  const annualMatch = raw.match(/^(\d{4})ANNUAL$/i);
  if (annualMatch) {
    return `${annualMatch[1]}年 年报`;
  }

  const quarterMatch = raw.match(/^(\d{4})Q([1-4])$/i);
  if (quarterMatch) {
    return quarterCodeToLabel(quarterMatch[1], Number(quarterMatch[2]));
  }

  const date = sanitizeDate(reportDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const year = date.slice(0, 4);
    const monthDay = date.slice(5);
    if (monthDay === "03-31") return `${year}年 一季报`;
    if (monthDay === "06-30") return `${year}年 半年报`;
    if (monthDay === "09-30") return `${year}年 三季报`;
    if (monthDay === "12-31") return `${year}年 年报`;
  }

  return raw || reportKindLabel(kind);
}

function quarterCodeToLabel(year: string, quarter: number) {
  if (quarter === 1) return `${year}年 一季报`;
  if (quarter === 2) return `${year}年 半年报`;
  if (quarter === 3) return `${year}年 三季报`;
  return `${year}年 年报`;
}
