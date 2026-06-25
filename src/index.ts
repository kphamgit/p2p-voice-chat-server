import "dotenv/config";
import express from "express";
import cors from "cors";
import { ExpressPeerServer } from "peer";
// --- Database disabled for PeerJS-only testing (no DB provisioned yet) ---
// import { prisma } from "./prisma.js";
// import levelRoutes from "./routes/level.js";

const app = express();

// Restrict CORS to known origins. Set CORS_ORIGIN to your Cloudflare domain in
// production (comma-separated for multiple). Defaults to the Vite dev server.
const allowedOrigins = (process.env["CORS_ORIGIN"] ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// app.use("/levels", levelRoutes); // DB-backed route, disabled for PeerJS-only testing

const port = Number(process.env["PORT"]) || 3000;

const server = app.listen(port, () => {
  console.log(`✅ Server listening on http://localhost:${port}`);
});

// Mount the PeerJS signaling server on the existing Express server so it
// shares the single port (required on Heroku, which exposes only $PORT).
// The path must match the frontend's `new Peer({ ..., path: "/myapp" })`.
const peerServer = ExpressPeerServer(server, { path: "/" });
app.use("/myapp", peerServer);


// Clean up on shutdown.
async function shutdown() {
  // await prisma.$disconnect(); // DB disabled for PeerJS-only testing
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
