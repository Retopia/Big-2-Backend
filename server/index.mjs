import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import registerSocketHandlers from "./socket.mjs";

const PORT = 3002;
const app = express();
const server = createServer(app);

const allowedOrigins = [
  "https://big2.prestontang.dev",
  "https://big2.live",
  "https://staging.big2.live",
  "https://www.big2.live",
  "http://localhost:5173",
  "http://localhost:4173",
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

registerSocketHandlers(io);

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// Start server
server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
