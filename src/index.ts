import "dotenv/config";
import express from "express";
import cors from "cors";
import { ExpressPeerServer } from "peer";
import { WebSocketServer } from "ws";
import type { ServerOptions } from "ws";
import { createChatServer } from "./chat.js";
import { createPresenceServer, type AuthedRequest } from "./presence.js";
import authRoutes from "./routes/auth.js";
import recordingRoutes from "./routes/recording.js";
import levelRoutes from "./routes/level.js";
import unitRoutes from "./routes/unit.js";
import dialogRoutes from "./routes/dialog.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { verifyAuthToken } from "./jwt.js";
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

// /auth is public (login/register must be reachable; /auth/me guards itself).
app.use("/auth", authRoutes);

// Everything below requires a valid `Authorization: Bearer <token>` (see
// requireAuth). Unauthenticated requests get 401 before reaching the handlers.
app.use("/levels", requireAuth, levelRoutes);
app.use("/units", requireAuth, unitRoutes);
app.use("/dialogs", requireAuth, dialogRoutes);

// Voice-chat recording uploads + presigned playback URLs.
app.use("/recordings", requireAuth, recordingRoutes);

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
const presenceWss = createPresenceServer();

// Single upgrade router for the whole server:
//   "/chat"     → chat (auth-gated)
//   "/presence" → presence/online-users (auth-gated)
//   "/myapp/*"  → PeerJS signaling
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const { pathname } = url;

  if (pathname === "/chat" || pathname === "/presence") {
    // Both sockets require a valid token. Browsers can't set custom headers on a
    // WebSocket, so it arrives as a ?token= query param. Verification is a
    // stateless signature check (no DB), run once here — not per message.
    const token = url.searchParams.get("token");
    let payload;
    try {
      if (!token) throw new Error("missing token");
      payload = verifyAuthToken(token);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    if (pathname === "/chat") {
      chatWss.handleUpgrade(req, socket, head, (ws) => chatWss.emit("connection", ws, req));
    } else {
      // Attach the verified identity so the presence server can trust it.
      (req as AuthedRequest).presenceUser = {
        userId: Number(payload.sub),
        name: String(payload.name),
      };
      presenceWss.handleUpgrade(req, socket, head, (ws) => presenceWss.emit("connection", ws, req));
    }
    return;
  }

  if (pathname.startsWith("/myapp")) {
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
