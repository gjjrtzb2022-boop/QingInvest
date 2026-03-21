import { Pool } from "pg";

const DEFAULT_DEV_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

declare global {
  // eslint-disable-next-line no-var
  var __stockTestPgPool: Pool | undefined;
}

function parseBoolean(value: string | undefined, fallback = false) {
  if (!value) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
}

function resolveDatabaseUrl() {
  const target = String(process.env.CONTENT_SYNC_TARGET || "dev").trim().toLowerCase();
  if (target === "prod") {
    return process.env.CONTENT_SYNC_DATABASE_URL_PROD || process.env.DATABASE_URL || "";
  }
  return process.env.CONTENT_SYNC_DATABASE_URL_DEV || process.env.DATABASE_URL || DEFAULT_DEV_DB_URL;
}

export function getServerDbPool() {
  if (!global.__stockTestPgPool) {
    const connectionString = resolveDatabaseUrl();
    if (!connectionString) {
      throw new Error("missing-stock-database-url");
    }

    const useSsl = parseBoolean(process.env.CONTENT_SYNC_DB_SSL, false);
    global.__stockTestPgPool = new Pool({
      connectionString,
      max: 10,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined
    });
  }

  return global.__stockTestPgPool;
}
