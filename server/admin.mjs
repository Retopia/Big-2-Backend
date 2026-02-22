import crypto from "crypto";
import bcrypt from "bcryptjs";
import {
  adminSessions,
  announcementState,
  getActiveLLMModel,
  getDefaultLLMModel,
  rooms,
  setActiveLLMModel,
  usernameToPlayer,
} from "./state.mjs";
import { broadcastRoomList } from "./utils/broadcast.mjs";
import { validateRoomName } from "./utils/nameValidation.mjs";

const ADMIN_COOKIE_NAME = "big2_admin_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_TOUCH_WINDOW_MS = 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 20;
const ANNOUNCEMENT_MAX_LENGTH = 280;
const DEFAULT_ANNOUNCEMENT_DURATION_MS = 30 * 1000;
const MAX_ANNOUNCEMENT_DURATION_MS = 5 * 60 * 1000;
const LLM_MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,100}$/;

const loginAttemptsByIp = new Map();
let announcementTimeoutHandle = null;

const ALLOWED_ANNOUNCEMENT_TYPES = new Set([
  "info",
  "success",
  "warning",
  "error",
]);

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};

  return cookieHeader.split(";").reduce((acc, part) => {
    const [name, ...rest] = part.trim().split("=");
    if (!name) return acc;
    const rawValue = rest.join("=");
    try {
      acc[name] = decodeURIComponent(rawValue);
    } catch {
      acc[name] = rawValue;
    }
    return acc;
  }, {});
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function isSecureRequest(req) {
  const host = req.headers.host || "";
  if (host.includes("localhost") || host.includes("127.0.0.1")) {
    return false;
  }

  if (req.secure) return true;
  return req.headers["x-forwarded-proto"] === "https";
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function setAdminCookie(req, res, token, expiresAt) {
  const secure = isSecureRequest(req);
  res.cookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    // Cross-site admin panel requests (www.big2.live -> api.big2...) require SameSite=None.
    sameSite: secure ? "none" : "lax",
    secure,
    path: "/",
    expires: new Date(expiresAt),
  });
}

function clearAdminCookie(req, res) {
  const secure = isSecureRequest(req);
  res.clearCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure,
    path: "/",
  });
}

function getValidSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[ADMIN_COOKIE_NAME];
  if (!token) return null;

  const session = adminSessions.get(token);
  if (!session) return null;

  const currentTime = Date.now();
  if (session.expiresAt <= currentTime) {
    adminSessions.delete(token);
    return null;
  }

  session.lastSeenAt = currentTime;
  if (session.expiresAt - currentTime < SESSION_TOUCH_WINDOW_MS) {
    session.expiresAt = currentTime + SESSION_TTL_MS;
  }

  return { token, session };
}

function requireAdminSession(req, res, next) {
  const activeSession = getValidSession(req);
  if (!activeSession) {
    res.status(401).json({ message: "Unauthorized." });
    return;
  }

  req.adminSession = activeSession;
  next();
}

function isRateLimited(ip) {
  const now = Date.now();
  const existing = loginAttemptsByIp.get(ip);
  if (!existing) return false;

  if (existing.windowStart + LOGIN_WINDOW_MS < now) {
    loginAttemptsByIp.delete(ip);
    return false;
  }

  return existing.count >= MAX_LOGIN_ATTEMPTS;
}

function registerFailedLogin(ip) {
  const now = Date.now();
  const existing = loginAttemptsByIp.get(ip);

  if (!existing || existing.windowStart + LOGIN_WINDOW_MS < now) {
    loginAttemptsByIp.set(ip, { count: 1, windowStart: now });
    return;
  }

  existing.count += 1;
}

function clearLoginFailures(ip) {
  loginAttemptsByIp.delete(ip);
}

function normalizeAnnouncement() {
  const announcement = announcementState.current;
  if (!announcement) return null;

  if (announcement.expiresAt <= Date.now()) {
    announcementState.current = null;
    return null;
  }

  return announcement;
}

function clearAnnouncement(io) {
  if (announcementTimeoutHandle) {
    clearTimeout(announcementTimeoutHandle);
    announcementTimeoutHandle = null;
  }

  if (!announcementState.current) return;

  const removed = announcementState.current;
  announcementState.current = null;
  io.emit("announcementCleared", { id: removed.id });
}

function setAnnouncement(io, announcement) {
  clearAnnouncement(io);
  announcementState.current = announcement;
  io.emit("announcement", announcement);

  const ttl = Math.max(0, announcement.expiresAt - Date.now());
  announcementTimeoutHandle = setTimeout(() => {
    clearAnnouncement(io);
  }, ttl);
}

function closeRoom(io, room, reason = "This room was closed by admin.") {
  if (room.status === "playing") {
    room.status = "waiting";
    room.gameState = null;
    io.to(room.id).emit("gameError", { message: reason });
  }

  room.players.forEach((player) => {
    player.room = null;
    if (!player.isAI && player.id) {
      io.to(player.id).emit("forceLeave");
      io.sockets.sockets.get(player.id)?.leave(room.id);
    }
  });

  rooms.delete(room.name);
  broadcastRoomList(io, rooms);
}

function roomSummary(room, io) {
  return {
    id: room.id,
    name: room.name,
    status: room.status,
    playerCount: room.players.length,
    hasActiveGame: room.status === "playing" && Boolean(room.gameState),
    players: room.players.map((player) => ({
      id: player.id || null,
      name: player.name,
      isAI: Boolean(player.isAI),
      difficulty: player.difficulty || null,
      connected: Boolean(player.id && io.sockets.sockets.get(player.id)),
    })),
  };
}

function getPlayersSnapshot(io) {
  const snapshot = [];
  const seenHumans = new Set();

  usernameToPlayer.forEach((player, username) => {
    if (!player || player.isAI) return;
    if (seenHumans.has(username)) return;
    seenHumans.add(username);

    const isConnected = Boolean(player.id && io.sockets.sockets.get(player.id));
    if (!isConnected) return;

    const roomName =
      typeof player.room === "string" && rooms.has(player.room)
        ? player.room
        : null;

    snapshot.push({
      id: player.id || null,
      socketId: player.id || null,
      name: username,
      roomName,
      isAI: false,
      difficulty: null,
      connected: true,
    });
  });

  rooms.forEach((room) => {
    room.players.forEach((player) => {
      if (!player?.isAI) return;
      snapshot.push({
        id: null,
        socketId: null,
        name: player.name,
        roomName: room.name,
        isAI: true,
        difficulty: player.difficulty || null,
        connected: true,
      });
    });
  });

  snapshot.sort((a, b) => {
    if (a.isAI !== b.isAI) return a.isAI ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return snapshot;
}

export default function registerAdminRoutes(app, io) {
  app.get("/admin/api/session", (req, res) => {
    const activeSession = getValidSession(req);
    if (!activeSession) {
      res.json({ authenticated: false });
      return;
    }

    const { token, session } = activeSession;
    setAdminCookie(req, res, token, session.expiresAt);
    res.json({
      authenticated: true,
      expiresAt: session.expiresAt,
    });
  });

  app.post("/admin/api/login", async (req, res) => {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      res.status(429).json({ message: "Too many login attempts. Try again later." });
      return;
    }

    const rawPassword = req.body?.password;
    if (typeof rawPassword !== "string" || !rawPassword) {
      res.status(400).json({ message: "Password is required." });
      return;
    }

    const passwordHash = process.env.ADMIN_PASSWORD_HASH;
    const fallbackPassword = process.env.ADMIN_PASSWORD;
    if (!passwordHash && !fallbackPassword) {
      res.status(503).json({
        message:
          "Admin authentication is not configured. Set ADMIN_PASSWORD_HASH (preferred) or ADMIN_PASSWORD.",
      });
      return;
    }

    let isValid = false;
    if (passwordHash) {
      try {
        isValid = await bcrypt.compare(rawPassword, passwordHash);
      } catch (error) {
        console.error("Failed to verify admin password hash:", error);
      }
    } else if (fallbackPassword) {
      isValid = rawPassword === fallbackPassword;
    }

    if (!isValid) {
      registerFailedLogin(ip);
      res.status(401).json({ message: "Invalid password." });
      return;
    }

    clearLoginFailures(ip);

    const token = createSessionToken();
    const createdAt = Date.now();
    const expiresAt = createdAt + SESSION_TTL_MS;
    adminSessions.set(token, {
      createdAt,
      expiresAt,
      lastSeenAt: createdAt,
      ip,
    });

    setAdminCookie(req, res, token, expiresAt);
    res.json({
      ok: true,
      expiresAt,
    });
  });

  app.post("/admin/api/logout", (req, res) => {
    const activeSession = getValidSession(req);
    if (activeSession) {
      adminSessions.delete(activeSession.token);
    }
    clearAdminCookie(req, res);
    res.json({ ok: true });
  });

  app.get("/admin/api/rooms", requireAdminSession, (req, res) => {
    const roomList = [...rooms.values()].map((room) => roomSummary(room, io));
    res.json({ rooms: roomList });
  });

  app.get("/admin/api/players", requireAdminSession, (_req, res) => {
    res.json({ players: getPlayersSnapshot(io) });
  });

  app.post("/admin/api/rooms/close", requireAdminSession, (req, res) => {
    const validation = validateRoomName(req.body?.roomName);
    if (!validation.ok) {
      res.status(400).json({ message: validation.error });
      return;
    }

    const room = rooms.get(validation.value);
    if (!room) {
      res.status(404).json({ message: "Room not found." });
      return;
    }

    const reason =
      typeof req.body?.reason === "string" && req.body.reason.trim()
        ? req.body.reason.trim().slice(0, 200)
        : "This room was closed by admin.";

    closeRoom(io, room, reason);
    res.json({ ok: true });
  });

  app.get("/admin/api/ai", requireAdminSession, (_req, res) => {
    res.json({
      llmModel: getActiveLLMModel(),
      defaultLlmModel: getDefaultLLMModel(),
      hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    });
  });

  app.post("/admin/api/ai/model", requireAdminSession, (req, res) => {
    const rawModel = typeof req.body?.model === "string" ? req.body.model.trim() : "";
    if (!rawModel) {
      res.status(400).json({ message: "Model is required." });
      return;
    }

    if (!LLM_MODEL_PATTERN.test(rawModel)) {
      res.status(400).json({
        message:
          "Invalid model format. Use letters, numbers, and . _ : / - only.",
      });
      return;
    }

    const nextModel = setActiveLLMModel(rawModel);
    res.json({ ok: true, llmModel: nextModel });
  });

  app.get("/admin/api/announcement", requireAdminSession, (_req, res) => {
    res.json({ announcement: normalizeAnnouncement() });
  });

  app.post("/admin/api/announcement", requireAdminSession, (req, res) => {
    const rawMessage = typeof req.body?.message === "string" ? req.body.message : "";
    const message = rawMessage.trim();
    if (!message) {
      res.status(400).json({ message: "Announcement message is required." });
      return;
    }
    if (message.length > ANNOUNCEMENT_MAX_LENGTH) {
      res.status(400).json({
        message: `Announcement must be ${ANNOUNCEMENT_MAX_LENGTH} characters or fewer.`,
      });
      return;
    }

    const type = ALLOWED_ANNOUNCEMENT_TYPES.has(req.body?.type)
      ? req.body.type
      : "info";

    const durationMs = Number.parseInt(req.body?.durationMs, 10);
    const effectiveDurationMs = Number.isInteger(durationMs)
      ? Math.min(Math.max(durationMs, 1000), MAX_ANNOUNCEMENT_DURATION_MS)
      : DEFAULT_ANNOUNCEMENT_DURATION_MS;

    const now = Date.now();
    const announcement = {
      id: crypto.randomBytes(8).toString("hex"),
      message,
      type,
      createdAt: now,
      expiresAt: now + effectiveDurationMs,
    };

    setAnnouncement(io, announcement);
    res.json({ ok: true, announcement });
  });

  app.delete("/admin/api/announcement", requireAdminSession, (_req, res) => {
    clearAnnouncement(io);
    res.json({ ok: true });
  });
}
