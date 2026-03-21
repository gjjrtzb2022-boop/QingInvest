#!/usr/bin/env node
import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import pg from "pg";

const { Client } = pg;

const ROOT_DIR = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT_DIR, "supabase", "migrations");
const REPORT_DIR = path.join(ROOT_DIR, "raw", "sync-reports");
const DEFAULT_DB_URL = "postgresql://postgres:postgres@127.0.0.1:55432/postgres";

main().catch((error) => {
  console.error(`[verify:rls] ${formatError(error)}`);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const migrations = await collectMigrationFiles(MIGRATIONS_DIR);
  if (migrations.length === 0) {
    throw new Error("No migration files found in supabase/migrations.");
  }

  const adminClient = new Client({
    connectionString: options.dbUrl,
    ssl: options.dbSsl ? { rejectUnauthorized: false } : undefined
  });
  await adminClient.connect();

  const tempDbName = buildTempDbName(options.batchId);
  const workerDbUrl = withDatabase(options.dbUrl, tempDbName);
  const startedAt = Date.now();

  try {
    await createTempDatabase(adminClient, tempDbName);

    const worker = new Client({
      connectionString: workerDbUrl,
      ssl: options.dbSsl ? { rejectUnauthorized: false } : undefined
    });
    await worker.connect();

    try {
      await resetDatabase(worker);
      await applyMigrations(worker, migrations);
      await setupRoles(worker);

      const seed = await seedData(worker);
      const checks = await runChecks(worker, seed);
      const failed = checks.filter((item) => !item.pass);

      const report = {
        tool: "verify-rls",
        generatedAt: new Date().toISOString(),
        batchId: options.batchId,
        options: {
          dbUrl: maskUrl(options.dbUrl),
          dbSsl: options.dbSsl,
          tempDb: tempDbName
        },
        scope: {
          migrations: migrations.map((item) => path.relative(ROOT_DIR, item))
        },
        checks,
        status: failed.length === 0 ? "pass" : "fail",
        durationMs: Date.now() - startedAt
      };

      await writeReport(options.batchId, report);
      if (failed.length > 0) {
        throw new Error(`RLS 验证失败 ${failed.length} 项：${failed.map((item) => item.name).join(", ")}`);
      }

      console.log(`[verify:rls] status=pass checks=${checks.length}`);
      console.log(`[verify:rls] report=raw/sync-reports/verify-rls-${options.batchId}.json`);
    } finally {
      await worker.end().catch(() => undefined);
    }
  } finally {
    await dropTempDatabase(adminClient, tempDbName).catch(() => undefined);
    await adminClient.end().catch(() => undefined);
  }
}

function parseArgs(args) {
  const options = {
    batchId: buildBatchId(),
    dbUrl: process.env.RLS_CHECK_DATABASE_URL || process.env.MIGRATION_CHECK_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_DB_URL,
    dbSsl: parseBoolean(process.env.RLS_CHECK_DB_SSL)
  };

  for (const arg of args) {
    const match = arg.match(/^--([a-zA-Z0-9_-]+)=(.*)$/);
    if (!match) {
      throw new Error(`Unsupported argument: ${arg}`);
    }
    const [, key, value] = match;

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
    throw new Error(`Unsupported flag: --${key}`);
  }

  return options;
}

async function collectMigrationFiles(dirPath) {
  const names = await fs.readdir(dirPath).catch(() => []);
  return names
    .filter((name) => name.toLowerCase().endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((name) => path.join(dirPath, name));
}

async function createTempDatabase(client, dbName) {
  const quoted = quoteIdentifier(dbName);
  await client.query(`drop database if exists ${quoted}`);
  await client.query(`create database ${quoted}`);
}

async function dropTempDatabase(client, dbName) {
  const quoted = quoteIdentifier(dbName);
  await client.query(
    `
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname = $1
        and pid <> pg_backend_pid()
    `,
    [dbName]
  );
  await client.query(`drop database if exists ${quoted}`);
}

function withDatabase(dbUrl, dbName) {
  const parsed = new URL(dbUrl);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

function buildTempDbName(batchId) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `rls_gate_${batchId.replace(/[^0-9]/g, "")}_${suffix}`.toLowerCase();
}

async function resetDatabase(client) {
  const roleResult = await client.query("select current_user as role_name");
  const roleName = roleResult.rows[0]?.role_name || "postgres";
  const quotedRole = quoteIdentifier(roleName);

  await client.query(`
    drop schema if exists public cascade;
    create schema public;
    grant all on schema public to ${quotedRole};
    grant all on schema public to public;
  `);

  await client.query(`
    drop schema if exists auth cascade;
    create schema auth;
    grant all on schema auth to ${quotedRole};
    grant all on schema auth to public;
  `);

  await client.query("create extension if not exists pgcrypto");

  await client.query(`
    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      phone text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await client.query(`
    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
}

async function applyMigrations(client, files) {
  for (const filePath of files) {
    const sql = await fs.readFile(filePath, "utf8");
    if (!sql.trim()) continue;
    await client.query(sql);
  }
}

async function setupRoles(client) {
  const roleResult = await client.query("select current_user as role_name");
  const currentRole = String(roleResult.rows[0]?.role_name || "postgres");
  const quotedCurrent = quoteIdentifier(currentRole);

  await client.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'rls_tester') then
        create role rls_tester;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'content_reader') then
        create role content_reader;
      end if;
    end $$;
  `);

  await client.query("grant usage on schema public, auth to rls_tester, content_reader");
  await client.query("grant select, insert, update, delete on all tables in schema public to rls_tester");
  await client.query("grant select on all tables in schema public to content_reader");
  await client.query("grant usage, select on all sequences in schema public to rls_tester, content_reader");
  await client.query(`grant rls_tester to ${quotedCurrent}`);
  await client.query(`grant content_reader to ${quotedCurrent}`);
}

async function seedData(client) {
  const userA = deterministicUuid("rls-user-a");
  const userB = deterministicUuid("rls-user-b");

  await client.query(
    `
      insert into auth.users (id, email, phone)
      values ($1, 'user.a@example.com', '+8613800000001'),
             ($2, 'user.b@example.com', '+8613800000002')
      on conflict (id) do nothing
    `,
    [userA, userB]
  );

  const { rows: seriesRows } = await client.query(
    `
      insert into public.series (slug, name)
      values ('acceptance-series', '验收系列')
      on conflict (slug) do update set name = excluded.name
      returning id
    `
  );
  const seriesId = Number(seriesRows[0].id);

  const { rows: articleRows } = await client.query(
    `
      insert into public.articles (
        slug, title, published_date, series_id, category, summary, body_markdown, cover_url, content_path, source_url, source_type, author_name, is_published
      )
      values (
        'rls-check-article',
        'RLS 验收文章',
        current_date,
        $1,
        '测试',
        'RLS 验收摘要',
        '# hello',
        '',
        'content/articles/rls-check-article.md',
        'https://example.com/rls-check-article',
        'manual',
        'QA Bot',
        true
      )
      on conflict (slug) do update set title = excluded.title
      returning id
    `,
    [seriesId]
  );
  const articleId = Number(articleRows[0].id);

  await client.query("delete from public.reading_states where user_id in ($1, $2)", [userA, userB]);
  await client.query("delete from public.annotations where user_id in ($1, $2)", [userA, userB]);

  await client.query(
    `
      insert into public.reading_states (user_id, article_id, status)
      values ($1, $3, 'read'), ($2, $3, 'favorite')
      on conflict (user_id, article_id) do update set status = excluded.status
    `,
    [userA, userB, articleId]
  );

  await client.query(
    `
      insert into public.annotations (user_id, article_id, kind, quote, note)
      values ($1, $3, 'annotation', 'A user quote', 'A user note'),
             ($2, $3, 'quote', 'B user quote', '')
    `,
    [userA, userB, articleId]
  );

  return { userA, userB, articleId };
}

async function runChecks(client, seed) {
  const checks = [];

  await withRole(client, "content_reader", "", async () => {
    const articleCount = Number((await client.query("select count(*)::int as c from public.articles")).rows[0].c);
    checks.push({
      name: "public_articles_readable_for_reader",
      pass: articleCount >= 1,
      detail: `count=${articleCount}`
    });

    const privateCount = Number((await client.query("select count(*)::int as c from public.reading_states")).rows[0].c);
    checks.push({
      name: "private_reading_states_hidden_for_reader",
      pass: privateCount === 0,
      detail: `count=${privateCount}`
    });
  });

  await withRole(client, "rls_tester", seed.userA, async () => {
    const ownStates = Number((await client.query("select count(*)::int as c from public.reading_states")).rows[0].c);
    checks.push({
      name: "user_a_can_read_own_state",
      pass: ownStates === 1,
      detail: `count=${ownStates}`
    });

    const ownAnnotations = Number((await client.query("select count(*)::int as c from public.annotations")).rows[0].c);
    checks.push({
      name: "user_a_can_read_own_annotations",
      pass: ownAnnotations === 1,
      detail: `count=${ownAnnotations}`
    });

    const profileRows = Number((await client.query("select count(*)::int as c from public.profiles")).rows[0].c);
    checks.push({
      name: "user_a_can_read_own_profile",
      pass: profileRows === 1,
      detail: `count=${profileRows}`
    });

    const updateOther = await client.query(
      `
        update public.reading_states
           set status = 'read'
         where user_id = $1
         returning user_id
      `,
      [seed.userB]
    );
    checks.push({
      name: "user_a_cannot_update_user_b_state",
      pass: updateOther.rowCount === 0,
      detail: `updated=${updateOther.rowCount}`
    });
  });

  await withRole(client, "rls_tester", seed.userB, async () => {
    const ownStates = Number((await client.query("select count(*)::int as c from public.reading_states")).rows[0].c);
    checks.push({
      name: "user_b_can_read_own_state",
      pass: ownStates === 1,
      detail: `count=${ownStates}`
    });
  });

  return checks;
}

async function withRole(client, roleName, jwtSub, handler) {
  await client.query("begin");
  try {
    await client.query(`set local role ${quoteIdentifier(roleName)}`);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [jwtSub || ""]);
    await handler();
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function writeReport(batchId, report) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `verify-rls-${batchId}.json`);
  const latestPath = path.join(REPORT_DIR, "latest-verify-rls.json");
  const body = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(reportPath, body, "utf8");
  await fs.writeFile(latestPath, body, "utf8");
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function deterministicUuid(seed) {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function parseBoolean(value) {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function maskUrl(value) {
  try {
    const parsed = new URL(value);
    const user = parsed.username ? `${parsed.username}:***@` : "";
    return `${parsed.protocol}//${user}${parsed.host}${parsed.pathname}`;
  } catch {
    return "<invalid>";
  }
}

function buildBatchId() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function formatError(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
