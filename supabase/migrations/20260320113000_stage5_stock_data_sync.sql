begin;

create table if not exists public.stock_securities (
  id bigint generated always as identity primary key,
  symbol text not null unique,
  code text not null unique,
  name text not null default '',
  exchange text not null default '' check (exchange in ('', 'SH', 'SZ', 'BJ')),
  market text not null default 'CN',
  board text not null default '',
  industry_name text not null default '',
  secid text not null default '',
  listing_status text not null default 'listed',
  is_active boolean not null default true,
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
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stock_securities_exchange on public.stock_securities (exchange);
create index if not exists idx_stock_securities_board on public.stock_securities (board);
create index if not exists idx_stock_securities_industry on public.stock_securities (industry_name);
create index if not exists idx_stock_securities_snapshot_at on public.stock_securities (latest_snapshot_at desc nulls last);
create index if not exists idx_stock_securities_name on public.stock_securities (name);

create trigger trg_stock_securities_updated_at
before update on public.stock_securities
for each row
execute function public.set_updated_at();

create table if not exists public.stock_financial_reports (
  id bigint generated always as identity primary key,
  stock_security_id bigint references public.stock_securities(id) on delete set null,
  source_record_key text not null unique,
  symbol text not null,
  stock_code text not null,
  stock_name text not null default '',
  report_kind text not null check (report_kind in ('yjbb', 'yjkb', 'yjyg')),
  report_date date not null,
  report_period text not null default '',
  report_label text not null default '',
  notice_date date,
  industry_name text not null default '',
  market_board text not null default '',
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
  predicted_metric text not null default '',
  predicted_change_text text not null default '',
  predicted_value double precision,
  predicted_change_percent double precision,
  predicted_reason text not null default '',
  forecast_type text not null default '',
  previous_period_value double precision,
  is_latest boolean,
  source text not null default 'eastmoney',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stock_financial_reports_stock_date
  on public.stock_financial_reports (stock_code, report_date desc, notice_date desc nulls last);
create index if not exists idx_stock_financial_reports_kind_date
  on public.stock_financial_reports (report_kind, report_date desc);
create index if not exists idx_stock_financial_reports_security_id
  on public.stock_financial_reports (stock_security_id);

create trigger trg_stock_financial_reports_updated_at
before update on public.stock_financial_reports
for each row
execute function public.set_updated_at();

create table if not exists public.stock_announcements (
  id bigint generated always as identity primary key,
  stock_security_id bigint references public.stock_securities(id) on delete set null,
  source_record_key text not null unique,
  announcement_code text not null,
  symbol text not null,
  stock_code text not null,
  stock_name text not null default '',
  title text not null,
  announcement_type text not null default '',
  announcement_type_code text not null default '',
  notice_date date not null,
  display_time timestamptz,
  detail_url text not null default '',
  pdf_url text not null default '',
  page_count integer not null default 0 check (page_count >= 0),
  language text not null default '',
  attach_type text not null default '',
  content_text text not null default '',
  source text not null default 'eastmoney',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stock_announcements_code on public.stock_announcements (announcement_code);
create index if not exists idx_stock_announcements_stock_date on public.stock_announcements (stock_code, notice_date desc);
create index if not exists idx_stock_announcements_type_date on public.stock_announcements (announcement_type, notice_date desc);
create index if not exists idx_stock_announcements_security_id on public.stock_announcements (stock_security_id);

create trigger trg_stock_announcements_updated_at
before update on public.stock_announcements
for each row
execute function public.set_updated_at();

create table if not exists public.stock_announcement_files (
  id bigint generated always as identity primary key,
  announcement_id bigint not null references public.stock_announcements(id) on delete cascade,
  file_seq integer not null default 1,
  file_type text not null default '',
  file_name text not null default '',
  file_size_kb double precision,
  file_url text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (announcement_id, file_url)
);

create index if not exists idx_stock_announcement_files_announcement
  on public.stock_announcement_files (announcement_id);

create trigger trg_stock_announcement_files_updated_at
before update on public.stock_announcement_files
for each row
execute function public.set_updated_at();

create table if not exists public.stock_sync_runs (
  id bigint generated always as identity primary key,
  batch_id text not null unique,
  sync_scope text not null check (sync_scope in ('universe', 'reports', 'announcements', 'full')),
  target_env text not null check (target_env in ('dev', 'prod')),
  sync_mode text not null check (sync_mode in ('incremental', 'full', 'backfill')),
  triggered_by text not null default 'manual',
  status text not null check (status in ('running', 'success', 'failed')),
  stocks_seen integer not null default 0 check (stocks_seen >= 0),
  stocks_upserted integer not null default 0 check (stocks_upserted >= 0),
  reports_upserted integer not null default 0 check (reports_upserted >= 0),
  announcements_upserted integer not null default 0 check (announcements_upserted >= 0),
  announcement_files_upserted integer not null default 0 check (announcement_files_upserted >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error_message text,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.stock_securities enable row level security;
alter table public.stock_financial_reports enable row level security;
alter table public.stock_announcements enable row level security;
alter table public.stock_announcement_files enable row level security;
alter table public.stock_sync_runs enable row level security;

create policy "stock_securities_select_public"
  on public.stock_securities for select
  using (true);

create policy "stock_financial_reports_select_public"
  on public.stock_financial_reports for select
  using (true);

create policy "stock_announcements_select_public"
  on public.stock_announcements for select
  using (true);

create policy "stock_announcement_files_select_public"
  on public.stock_announcement_files for select
  using (true);

commit;
