import pg from "pg";

const { Pool } = pg;

let pool = null;
let initialized = false;

export function hasDatabaseConfig() {
  return Boolean(process.env.DATABASE_URL);
}

function getSslConfig() {
  const sslMode = process.env.PGSSLMODE || process.env.DATABASE_SSL;
  if (sslMode === "require" || sslMode === "true") {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

export function getPool() {
  if (!hasDatabaseConfig()) return null;

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: getSslConfig(),
    });
  }

  return pool;
}

export async function query(text, params = []) {
  const activePool = getPool();
  if (!activePool) {
    const error = new Error("Database is not configured.");
    error.code = "DATABASE_UNAVAILABLE";
    throw error;
  }

  return activePool.query(text, params);
}

/**
 * Run `fn(client)` inside a single transaction. Commits on success, rolls back on
 * any error, and always releases the client. `fn` should use `client.query(...)`.
 */
export async function withTransaction(fn) {
  const activePool = getPool();
  if (!activePool) {
    const error = new Error("Database is not configured.");
    error.code = "DATABASE_UNAVAILABLE";
    throw error;
  }

  const client = await activePool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failures — surface the original error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function initDatabase() {
  if (!hasDatabaseConfig()) {
    console.warn("DATABASE_URL is not configured; account features are disabled.");
    return false;
  }

  if (initialized) return true;

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS ratings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL DEFAULT 1500,
      games_played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      room_name TEXT NOT NULL,
      player_count INTEGER NOT NULL,
      rated BOOLEAN NOT NULL DEFAULT FALSE,
      winner_user_id TEXT REFERENCES users(id),
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS match_participants (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      guest_display_name TEXT,
      display_name TEXT NOT NULL,
      placement INTEGER,
      cards_remaining INTEGER,
      rating_before INTEGER,
      rating_after INTEGER,
      rating_delta INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Enforce username uniqueness case-insensitively (the column-level UNIQUE only
    -- catches exact-case dupes, so "Bob"/"bob" could both register without this).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
      ON users (LOWER(username));

    -- Soft-delete marker for accounts. Deleted accounts are hidden from the
    -- leaderboard and blocked from logging in, but their match history (which
    -- stores a display_name snapshot per row) stays intact.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
      ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash
      ON user_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_match_participants_match_id
      ON match_participants(match_id);
    CREATE INDEX IF NOT EXISTS idx_match_participants_user_id
      ON match_participants(user_id);
  `);

  initialized = true;
  console.log("Postgres schema ready.");
  return true;
}
