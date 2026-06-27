import "dotenv/config";
import express from "express";
import cors from "cors";
import { ExpressPeerServer } from "peer";
import { WebSocketServer } from "ws";
import type { ServerOptions } from "ws";
import { createChatServer } from "./chat.js";
import recordingRoutes from "./routes/recording.js";
import levelRoutes from "./routes/level.js";
import unitRoutes from "./routes/unit.js";
import { prisma } from "./prisma.js";

const app = express();

// Restrict CORS to known origins. Set CORS_ORIGIN to your Cloudflare domain in
// production (comma-separated for multiple). Defaults to the Vite dev server.
const allowedOrigins = (process.env["CORS_ORIGIN"] ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.use("/levels", levelRoutes);
app.use("/units", unitRoutes);

// Voice-chat recording uploads + presigned playback URLs.
app.use("/recordings", recordingRoutes);

const port = Number(process.env["PORT"]) || 3000;

const server = app.listen(port, () => {
  console.log(`✅ Server listening on port ${port}`);
});

// Verify the database connection on startup (Prisma connects lazily otherwise).
prisma
  .$connect()
  .then(() => console.log("✅ Database connection successful"))
  .catch((err) => console.error("❌ Database connection failed:", err));

// PeerJS and chat both need WebSockets on this one HTTP server. To stop the two
// ws servers from fighting over the "upgrade" event, we put BOTH in `noServer`
// mode and route upgrades ourselves below (one ws-server-per-path otherwise
// 400s the other's paths).
let peerWss!: WebSocketServer;
const peerServer = ExpressPeerServer(server, {
  path: "/",
  createWebSocketServer: (options: ServerOptions) => {
    peerWss = new WebSocketServer({ ...options, server: undefined, noServer: true });
    return peerWss;
  },
});
app.use("/myapp", peerServer);

const chatWss = createChatServer();

// Single upgrade router for the whole server: "/chat" → chat, "/myapp/*" → PeerJS.
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "", "http://localhost");
  if (pathname === "/chat") {
    chatWss.handleUpgrade(req, socket, head, (ws) => chatWss.emit("connection", ws, req));
  } else if (pathname.startsWith("/myapp")) {
    peerWss.handleUpgrade(req, socket, head, (ws) => peerWss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});


// Clean up on shutdown.
async function shutdown() {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
