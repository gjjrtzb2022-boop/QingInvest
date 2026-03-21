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
  console.error(`[check:migrations] ${formatError(error)}`);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = await collectMigrationFiles(MIGRATIONS_DIR);
  if (files.length === 0) {
    throw new Error("No migration files found in supabase/migrations.");
  }

  const adminClient = new Client({
    connectionString: options.dbUrl,
    ssl: options.dbSsl ? { rejectUnauthorized: false } : undefined
  });

  const startedAt = Date.now();
  await adminClient.connect();

  const tempDbName = buildTempDbName(options.batchId);
  const workerDbUrl = withDatabase(options.dbUrl, tempDbName);

  try {
    await createTempDatabase(adminClient, tempDbName);

    const workerClient = new Client({
      connectionString: workerDbUrl,
      ssl: options.dbSsl ? { rejectUnauthorized: false } : undefined
    });

    await workerClient.connect();

    try {
      await resetDatabase(workerClient);
      await applyMigrations(workerClient, files);
      const fullSnapshot = await snapshotSchema(workerClient);
      const fullHash = hashSnapshot(fullSnapshot);

      const latestFile = files[files.length - 1];
      const previousFiles = files.slice(0, -1);

      await resetDatabase(workerClient);
      await applyMigrations(workerClient, previousFiles);
      const previousSnapshot = await snapshotSchema(workerClient);
      const previousHash = hashSnapshot(previousSnapshot);

      await applyMigrations(workerClient, [latestFile]);
      const afterLatestSnapshot = await snapshotSchema(workerClient);
      const afterLatestHash = hashSnapshot(afterLatestSnapshot);

      // Rollback rehearsal path: rebuild to N-1 from scratch and verify deterministic schema state.
      await resetDatabase(workerClient);
      await applyMigrations(workerClient, previousFiles);
      const rebuiltPreviousSnapshot = await snapshotSchema(workerClient);
      const rebuiltPreviousHash = hashSnapshot(rebuiltPreviousSnapshot);

      if (previousHash !== rebuiltPreviousHash) {
        throw new Error(
          "Rollback rehearsal failed: rebuilding to N-1 migrations produced a different schema fingerprint."
        );
      }

      const durationMs = Date.now() - startedAt;
      const report = {
        tool: "check-migrations",
        generatedAt: new Date().toISOString(),
        batchId: options.batchId,
        options: {
          dbUrl: maskDbUrl(options.dbUrl),
          dbSsl: options.dbSsl,
          tempDb: tempDbName
        },
        scope: {
          migrationDir: path.relative(ROOT_DIR, MIGRATIONS_DIR),
          migrationCount: files.length,
          migrations: files.map((file) => path.relative(ROOT_DIR, file))
        },
        rehearsal: {
          latestMigration: path.basename(latestFile),
          previousHash,
          rebuiltPreviousHash,
          afterLatestHash,
          fullHash,
          rollbackRebuildDeterministic: previousHash === rebuiltPreviousHash
        },
        status: "pass",
        durationMs
      };

      await writeReport(options.batchId, report);

      console.log(`[check:migrations] migrations=${files.length} status=pass durationMs=${durationMs}`);
      console.log(
        `[check:migrations] latest=${path.basename(latestFile)} previous=${previousHash.slice(0, 12)} afterLatest=${afterLatestHash.slice(0, 12)} full=${fullHash.slice(0, 12)}`
      );
      console.log(`[check:migrations] report=raw/sync-reports/check-migrations-${options.batchId}.json`);
    } finally {
      await workerClient.end().catch(() => undefined);
    }
  } finally {
    await dropTempDatabase(adminClient, tempDbName).catch(() => undefined);
    await adminClient.end().catch(() => undefined);
  }
}

function parseArgs(args) {
  const options = {
    batchId: buildBatchId(),
    dbUrl: process.env.MIGRATION_CHECK_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_DB_URL,
    dbSsl: parseBoolean(process.env.MIGRATION_CHECK_DB_SSL)
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
  const files = await fs.readdir(dirPath).catch(() => []);
  const sqlFiles = files
    .filter((name) => name.toLowerCase().endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"));

  const timestamps = new Set();
  const output = [];

  for (const name of sqlFiles) {
    const match = name.match(/^(\d{14})_(.+)\.sql$/);
    if (!match) {
      throw new Error(`Invalid migration filename (expected 14-digit prefix): ${name}`);
    }
    const stamp = match[1];
    if (timestamps.has(stamp)) {
      throw new Error(`Duplicate migration timestamp prefix: ${stamp}`);
    }
    timestamps.add(stamp);
    output.push(path.join(dirPath, name));
  }

  return output;
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
  return `migration_gate_${batchId.replace(/[^0-9]/g, "")}_${suffix}`.toLowerCase();
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
      select null::uuid
    $$;
  `);
}

async function applyMigrations(client, files) {
  for (const filePath of files) {
    const sql = await fs.readFile(filePath, "utf8");
    if (!sql.trim()) continue;
    try {
      await client.query(sql);
    } catch (error) {
      throw new Error(`${path.relative(ROOT_DIR, filePath)} failed: ${formatError(error)}`);
    }
  }
}

async function snapshotSchema(client) {
  const columns = await client.query(`
    select table_schema, table_name, column_name, ordinal_position, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema not in ('pg_catalog', 'information_schema')
    order by table_schema, table_name, ordinal_position
  `);
  const constraints = await client.query(`
    select
      n.nspname as schema_name,
      c.relname as table_name,
      con.conname as constraint_name,
      con.contype as constraint_type,
      pg_get_constraintdef(con.oid, true) as definition
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
    order by schema_name, table_name, constraint_name
  `);
  const indexes = await client.query(`
    select schemaname, tablename, indexname, indexdef
    from pg_indexes
    where schemaname not in ('pg_catalog', 'information_schema')
    order by schemaname, tablename, indexname
  `);
  const policies = await client.query(`
    select schemaname, tablename, policyname, permissive, roles, cmd, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
    from pg_policies
    where schemaname not in ('pg_catalog', 'information_schema')
    order by schemaname, tablename, policyname
  `);
  const triggers = await client.query(`
    select event_object_schema, event_object_table, trigger_name, event_manipulation, action_timing, action_statement
    from information_schema.triggers
    where event_object_schema not in ('pg_catalog', 'information_schema')
    order by event_object_schema, event_object_table, trigger_name
  `);
  const functions = await client.query(`
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as args,
      pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
    order by schema_name, function_name, args
  `);

  return {
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    policies: policies.rows,
    triggers: triggers.rows,
    functions: functions.rows
  };
}

function hashSnapshot(snapshot) {
  return crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

async function writeReport(batchId, report) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `check-migrations-${batchId}.json`);
  const latestPath = path.join(REPORT_DIR, "latest-check-migrations.json");
  const body = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(reportPath, body, "utf8");
  await fs.writeFile(latestPath, body, "utf8");
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function parseBoolean(value) {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function maskDbUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.username ? `${parsed.username}:***@` : ""}${parsed.host}${parsed.pathname}`;
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
