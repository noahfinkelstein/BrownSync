import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

/**
 * Local-dev default matches .env.example (supabase start's Postgres port).
 * Production must set DATABASE_URL explicitly.
 */
const LOCAL_DEV_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * postgres.js client. Lazy: no connection is opened until the first query,
 * so building the app (e.g. for OpenAPI emission) never needs a database.
 */
export function createSql(databaseUrl = process.env.DATABASE_URL ?? LOCAL_DEV_DATABASE_URL): Sql {
  return postgres(databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 5,
  });
}
