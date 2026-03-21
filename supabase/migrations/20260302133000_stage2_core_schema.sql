-- Stage 2 core schema: article runtime DB + user sync state + RLS
-- Scope note:
--   Content source of truth remains GitHub Markdown files under content/articles/**/*.md.
--   This schema is the runtime query/sync layer only.

begin;

create extension if not exists pgcrypto;

-- ---------- shared helpers ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_article_search_vector()
returns trigger
language plpgsql
as $$
begin
  new.search_vector =
      setweight(to_tsvector('simple', coalesce(new.title, '')), 'A')
      || setweight(to_tsvector('simple', coalesce(new.summary, '')), 'B')
      || setweight(to_tsvector('simple', coalesce(new.body_markdown, '')), 'C');
  return new;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, avatar_url, timezone, phone, email)
  values (
    new.id,
    '',
    '',
    'Asia/Shanghai',
    coalesce(new.phone, ''),
    coalesce(new.email, '')
  )
  on conflict (id) do update
    set phone = excluded.phone,
        email = excluded.email,
        updated_at = now();

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.user_sync_meta (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create or replace function public.handle_auth_user_contact_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set phone = coalesce(new.phone, ''),
         email = coalesce(new.email, ''),
         updated_at = now()
   where id = new.id;
  return new;
end;
$$;

-- ---------- identity / user domain ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null default '',
  avatar_url text not null default '',
  timezone text not null default 'Asia/Shanghai',
  phone text not null default '',
  email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'light' check (theme in ('light', 'dark')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_preferences_updated_at
before update on public.user_preferences
for each row
execute function public.set_updated_at();

create table if not exists public.user_sync_meta (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_import_at timestamptz,
  last_import_count integer not null default 0 check (last_import_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_sync_meta_updated_at
before update on public.user_sync_meta
for each row
execute function public.set_updated_at();

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

drop trigger if exists trg_auth_user_contact_updated on auth.users;
create trigger trg_auth_user_contact_updated
after update of email, phone on auth.users
for each row
execute function public.handle_auth_user_contact_update();

-- backfill for existing auth users
insert into public.profiles (id, username, avatar_url, timezone, phone, email)
select
  u.id,
  '',
  '',
  'Asia/Shanghai',
  coalesce(u.phone, ''),
  coalesce(u.email, '')
from auth.users u
on conflict (id) do update
  set phone = excluded.phone,
      email = excluded.email,
      updated_at = now();

insert into public.user_preferences (user_id)
select u.id
from auth.users u
on conflict (user_id) do nothing;

insert into public.user_sync_meta (user_id)
select u.id
from auth.users u
on conflict (user_id) do nothing;

-- ---------- content taxonomy ----------
create table if not exists public.series (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_series_updated_at
before update on public.series
for each row
execute function public.set_updated_at();

create table if not exists public.tags (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null unique,
  group_name text not null default '其他',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_tags_updated_at
before update on public.tags
for each row
execute function public.set_updated_at();

create table if not exists public.industries (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_industries_updated_at
before update on public.industries
for each row
execute function public.set_updated_at();

create table if not exists public.stocks (
  id bigint generated always as identity primary key,
  symbol text not null unique,
  name text not null default '',
  market text not null default 'CN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_stocks_updated_at
before update on public.stocks
for each row
execute function public.set_updated_at();

-- ---------- articles ----------
create table if not exists public.articles (
  id bigint generated always as identity primary key,
  slug text not null unique,
  title text not null,
  published_date date not null,
  series_id bigint references public.series(id) on delete set null,
  category text not null default '未分类',
  summary text not null default '',
  body_markdown text not null,
  cover_url text not null default '',
  content_path text not null unique,
  source_url text,
  source_platform text not null default '知乎',
  source_type text not null default 'article' check (source_type in ('article', 'answer', 'pin', 'manual')),
  author_name text not null default '山长 清一',
  is_published boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  search_vector tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_articles_content_path check (content_path like 'content/articles/%')
);

create unique index if not exists uq_articles_source_url
  on public.articles (source_url)
  where source_url is not null and btrim(source_url) <> '';

create index if not exists idx_articles_published_date on public.articles (published_date desc);
create index if not exists idx_articles_series_date on public.articles (series_id, published_date desc);
create index if not exists idx_articles_search_vector on public.articles using gin (search_vector);

create trigger trg_articles_updated_at
before update on public.articles
for each row
execute function public.set_updated_at();

create trigger trg_articles_search_vector
before insert or update of title, summary, body_markdown on public.articles
for each row
execute function public.set_article_search_vector();

create table if not exists public.article_tags (
  article_id bigint not null references public.articles(id) on delete cascade,
  tag_id bigint not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (article_id, tag_id)
);

create index if not exists idx_article_tags_tag_id on public.article_tags (tag_id);

create table if not exists public.article_industries (
  article_id bigint not null references public.articles(id) on delete cascade,
  industry_id bigint not null references public.industries(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (article_id, industry_id)
);

create index if not exists idx_article_industries_industry_id on public.article_industries (industry_id);

create table if not exists public.article_stocks (
  article_id bigint not null references public.articles(id) on delete cascade,
  stock_id bigint not null references public.stocks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (article_id, stock_id)
);

create index if not exists idx_article_stocks_stock_id on public.article_stocks (stock_id);

create table if not exists public.article_related (
  article_id bigint not null references public.articles(id) on delete cascade,
  related_article_id bigint not null references public.articles(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (article_id, related_article_id),
  constraint chk_article_related_not_self check (article_id <> related_article_id)
);

create index if not exists idx_article_related_related_article_id on public.article_related (related_article_id);

-- ---------- user reading state ----------
create table if not exists public.reading_states (
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id bigint not null references public.articles(id) on delete cascade,
  status text not null check (status in ('unread', 'read', 'favorite')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, article_id)
);

create index if not exists idx_reading_states_user_status on public.reading_states (user_id, status);
create index if not exists idx_reading_states_article_id on public.reading_states (article_id);

create trigger trg_reading_states_updated_at
before update on public.reading_states
for each row
execute function public.set_updated_at();

create table if not exists public.annotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id bigint not null references public.articles(id) on delete cascade,
  kind text not null default 'annotation' check (kind in ('annotation', 'quote')),
  quote text not null,
  note text not null default '',
  source_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_annotations_user_article_created_at
  on public.annotations (user_id, article_id, created_at desc);

create trigger trg_annotations_updated_at
before update on public.annotations
for each row
execute function public.set_updated_at();

-- ---------- sync logs ----------
create table if not exists public.sync_logs (
  id bigint generated always as identity primary key,
  batch_id text not null unique,
  source_scope text not null default 'content/articles/**/*.md',
  target_env text not null check (target_env in ('dev', 'prod')),
  sync_mode text not null check (sync_mode in ('incremental', 'full')),
  triggered_by text not null default 'manual',
  status text not null check (status in ('running', 'success', 'failed')),
  articles_seen integer not null default 0 check (articles_seen >= 0),
  articles_upserted integer not null default 0 check (articles_upserted >= 0),
  assets_uploaded integer not null default 0 check (assets_uploaded >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error_message text,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_sync_meta enable row level security;
alter table public.series enable row level security;
alter table public.tags enable row level security;
alter table public.industries enable row level security;
alter table public.stocks enable row level security;
alter table public.articles enable row level security;
alter table public.article_tags enable row level security;
alter table public.article_industries enable row level security;
alter table public.article_stocks enable row level security;
alter table public.article_related enable row level security;
alter table public.reading_states enable row level security;
alter table public.annotations enable row level security;
alter table public.sync_logs enable row level security;

-- own-row policies for user private tables
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "user_preferences_select_own"
  on public.user_preferences for select
  using (auth.uid() = user_id);

create policy "user_preferences_insert_own"
  on public.user_preferences for insert
  with check (auth.uid() = user_id);

create policy "user_preferences_update_own"
  on public.user_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_sync_meta_select_own"
  on public.user_sync_meta for select
  using (auth.uid() = user_id);

create policy "user_sync_meta_insert_own"
  on public.user_sync_meta for insert
  with check (auth.uid() = user_id);

create policy "user_sync_meta_update_own"
  on public.user_sync_meta for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "reading_states_select_own"
  on public.reading_states for select
  using (auth.uid() = user_id);

create policy "reading_states_insert_own"
  on public.reading_states for insert
  with check (auth.uid() = user_id);

create policy "reading_states_update_own"
  on public.reading_states for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "reading_states_delete_own"
  on public.reading_states for delete
  using (auth.uid() = user_id);

create policy "annotations_select_own"
  on public.annotations for select
  using (auth.uid() = user_id);

create policy "annotations_insert_own"
  on public.annotations for insert
  with check (auth.uid() = user_id);

create policy "annotations_update_own"
  on public.annotations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "annotations_delete_own"
  on public.annotations for delete
  using (auth.uid() = user_id);

-- public read policies for content tables
create policy "series_read_all"
  on public.series for select
  using (true);

create policy "tags_read_all"
  on public.tags for select
  using (true);

create policy "industries_read_all"
  on public.industries for select
  using (true);

create policy "stocks_read_all"
  on public.stocks for select
  using (true);

create policy "articles_read_all"
  on public.articles for select
  using (true);

create policy "article_tags_read_all"
  on public.article_tags for select
  using (true);

create policy "article_industries_read_all"
  on public.article_industries for select
  using (true);

create policy "article_stocks_read_all"
  on public.article_stocks for select
  using (true);

create policy "article_related_read_all"
  on public.article_related for select
  using (true);

-- sync_logs intentionally has no public/auth policies:
-- only service role should write/read operational sync logs.

commit;
