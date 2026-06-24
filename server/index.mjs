import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import registerSocketHandlers from "./socket.mjs";
import registerAdminRoutes from "./admin.mjs";
import registerAuthRoutes from "./authRoutes.mjs";
import registerLeaderboardRoutes from "./leaderboardRoutes.mjs";
import registerProfileRoutes from "./profileRoutes.mjs";
import { initDatabase } from "./db.mjs";
import * as dotenv from "dotenv";

dotenv.config();
await initDatabase();

const PORT = Number.parseInt(process.env.PORT, 10) || 3002;
const app = express();
const server = createServer(app);
app.set("trust proxy", 1);

const allowedOrigins = new Set([
  "https://big2.prestontang.dev",
  "https://big2.live",
  "https://staging.big2.live",
  "https://www.big2.live",
]);

const LOCAL_DEV_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return allowedOrigins.has(origin) || LOCAL_DEV_ORIGIN_PATTERN.test(origin);
}

function validateCorsOrigin(origin, callback) {
  if (isAllowedOrigin(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error(`CORS origin not allowed: ${origin}`));
}

const corsOptions = {
  origin: validateCorsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(
  cors(corsOptions)
);
app.options("*", cors(corsOptions));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: validateCorsOrigin,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

registerSocketHandlers(io);
registerAuthRoutes(app);
registerLeaderboardRoutes(app);
registerProfileRoutes(app);
registerAdminRoutes(app, io);

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// Start server
server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
