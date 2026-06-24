import {
  getBearerToken,
  getUserByToken,
  loginUser,
  registerUser,
  revokeUserSession,
} from "./userAuth.mjs";

function sendDatabaseUnavailable(res) {
  res.status(503).json({
    message: "Account storage is not configured. Set DATABASE_URL to enable accounts.",
  });
}

function handleAuthError(error, res) {
  if (error?.code === "DATABASE_UNAVAILABLE") {
    sendDatabaseUnavailable(res);
    return true;
  }

  console.error("Auth route error:", error);
  res.status(500).json({ message: "Unable to complete account request." });
  return true;
}

export default function registerAuthRoutes(app) {
  app.post("/api/auth/register", async (req, res) => {
    try {
      const result = await registerUser(req.body || {});
      if (!result.ok) {
        res.status(result.status || 400).json({ message: result.message });
        return;
      }

      res.status(201).json({
        ok: true,
        user: result.user,
        token: result.session.token,
        expiresAt: result.session.expiresAt,
      });
    } catch (error) {
      handleAuthError(error, res);
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const result = await loginUser(req.body || {});
      if (!result.ok) {
        res.status(result.status || 400).json({ message: result.message });
        return;
      }

      res.json({
        ok: true,
        user: result.user,
        token: result.session.token,
        expiresAt: result.session.expiresAt,
      });
    } catch (error) {
      handleAuthError(error, res);
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const token = getBearerToken(req);
      if (token) await revokeUserSession(token);
      res.json({ ok: true });
    } catch (error) {
      handleAuthError(error, res);
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const token = getBearerToken(req);
      if (!token) {
        res.json({ authenticated: false, user: null });
        return;
      }

      const user = await getUserByToken(token);
      if (!user) {
        res.status(401).json({ authenticated: false, user: null });
        return;
      }

      res.json({ authenticated: true, user });
    } catch (error) {
      handleAuthError(error, res);
    }
  });
}
