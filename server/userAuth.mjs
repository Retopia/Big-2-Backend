import crypto from "crypto";
import bcrypt from "bcryptjs";
import { generateUserId } from "./utils/id.mjs";
import { query } from "./db.mjs";
import {
  PLAYER_NAME_MAX_LENGTH,
  validatePlayerName,
} from "./utils/nameValidation.mjs";

const USER_AUTH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return { ok: false, error: "Email is required." };
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  return { ok: true, value: email };
}

function validatePassword(value) {
  if (typeof value !== "string" || !value) {
    return { ok: false, error: "Password is required." };
  }
  if (value.length > 200) {
    return { ok: false, error: "Password is too long." };
  }
  return { ok: true, value };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function serializeUser(row) {
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    username: row.username,
    rating: Number(row.rating ?? 1500),
    gamesPlayed: Number(row.games_played ?? 0),
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
  };
}

async function getUserWithRatingById(userId) {
  const result = await query(
    `
      SELECT
        users.id,
        users.email,
        users.username,
        ratings.rating,
        ratings.games_played,
        ratings.wins,
        ratings.losses
      FROM users
      LEFT JOIN ratings ON ratings.user_id = users.id
      WHERE users.id = $1
      LIMIT 1
    `,
    [userId]
  );

  return serializeUser(result.rows[0]);
}

export async function registerUser({ email, username, password }) {
  const emailValidation = validateEmail(email);
  if (!emailValidation.ok) {
    return { ok: false, status: 400, message: emailValidation.error };
  }

  const usernameValidation = validatePlayerName(username);
  if (!usernameValidation.ok) {
    return { ok: false, status: 400, message: usernameValidation.error };
  }

  if (usernameValidation.value.length > PLAYER_NAME_MAX_LENGTH) {
    return { ok: false, status: 400, message: "Username is too long." };
  }

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.ok) {
    return { ok: false, status: 400, message: passwordValidation.error };
  }

  const userId = generateUserId();
  const passwordHash = await bcrypt.hash(passwordValidation.value, 12);

  try {
    await query(
      `
        INSERT INTO users (id, email, username, password_hash)
        VALUES ($1, $2, $3, $4)
      `,
      [userId, emailValidation.value, usernameValidation.value, passwordHash]
    );
    await query("INSERT INTO ratings (user_id) VALUES ($1)", [userId]);
  } catch (error) {
    if (error?.code === "23505") {
      return {
        ok: false,
        status: 409,
        message: "That email or username is already registered.",
      };
    }
    throw error;
  }

  const user = await getUserWithRatingById(userId);
  const session = await createUserSession(userId);
  return { ok: true, user, session };
}

export async function loginUser({ email, password }) {
  const emailValidation = validateEmail(email);
  if (!emailValidation.ok) {
    return { ok: false, status: 400, message: emailValidation.error };
  }

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.ok) {
    return { ok: false, status: 400, message: passwordValidation.error };
  }

  const result = await query(
    "SELECT id, password_hash FROM users WHERE email = $1 LIMIT 1",
    [emailValidation.value]
  );
  const row = result.rows[0];
  const passwordHash = row?.password_hash || "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidin";
  const valid = await bcrypt.compare(passwordValidation.value, passwordHash);

  if (!row || !valid) {
    return { ok: false, status: 401, message: "Invalid email or password." };
  }

  await query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [row.id]);

  const user = await getUserWithRatingById(row.id);
  const session = await createUserSession(row.id);
  return { ok: true, user, session };
}

export async function createUserSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const sessionId = generateUserId();
  const expiresAt = new Date(Date.now() + USER_AUTH_TOKEN_TTL_MS);

  await query(
    `
      INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
      VALUES ($1, $2, $3, $4)
    `,
    [sessionId, userId, hashToken(token), expiresAt]
  );

  return {
    token,
    expiresAt: expiresAt.getTime(),
  };
}

export function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== "string") return null;

  const [scheme, ...rest] = authHeader.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;

  const token = rest.join(" ").trim();
  return token || null;
}

export async function getUserByToken(token) {
  if (typeof token !== "string" || !token) return null;

  const result = await query(
    `
      SELECT user_id
      FROM user_sessions
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
      LIMIT 1
    `,
    [hashToken(token)]
  );

  const session = result.rows[0];
  if (!session) return null;

  await query(
    "UPDATE user_sessions SET last_seen_at = NOW() WHERE token_hash = $1",
    [hashToken(token)]
  );

  return getUserWithRatingById(session.user_id);
}

export async function revokeUserSession(token) {
  if (typeof token !== "string" || !token) return;

  await query(
    `
      UPDATE user_sessions
      SET revoked_at = NOW()
      WHERE token_hash = $1 AND revoked_at IS NULL
    `,
    [hashToken(token)]
  );
}

export async function getUserFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  return getUserByToken(token);
}
