import { IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

// Identity taken from the verified auth token (attached by the upgrade handler).
export interface PresenceUser {
  userId: number;
  name: string; // login username; authoritative, from the token
}

// The upgrade handler stashes the verified user here before emitting 'connection'.
export interface AuthedRequest extends IncomingMessage {
  presenceUser?: PresenceUser;
}

interface PresenceSocket extends WebSocket {
  isAlive: boolean;
  user: PresenceUser;    // authoritative identity (username) from the token
  peerId: string | null; // set once the client sends its PeerJS id via 'hello'
}

// A presence WebSocketServer in `noServer` mode (routed by index.ts, like the
// chat server). It tracks who's online and their PeerJS id, and broadcasts the
// roster whenever it changes so every client can render a live "who to call"
// list. Only connections that have announced a peerId appear in the roster.
export function createPresenceServer(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<PresenceSocket>();

  const rosterMessage = () =>
    JSON.stringify({
      type: 'roster',
      users: [...clients]
        .filter((c) => c.peerId)
        .map((c) => ({ userId: c.user.userId, name: c.user.name, peerId: c.peerId })),
    });

  const broadcast = () => {
    const msg = rosterMessage();
    for (const c of clients) {
      if (c.readyState === WebSocket.OPEN) c.send(msg);
    }
  };

  wss.on('connection', (socket, req: AuthedRequest) => {
    const ws = socket as PresenceSocket;
    const user = req.presenceUser;
    if (!user) {
      // Shouldn't happen (upgrade verified the token), but fail closed.
      ws.close();
      return;
    }
    ws.isAlive = true;
    ws.user = user;
    ws.peerId = null;
    clients.add(ws);
    console.log(`🟢 presence connect: ${user.name} (${clients.size} online)`);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; peerId?: string };
        // 'hello' announces this client's PeerJS id, which puts them in the
        // roster (under their token username) and notifies everyone.
        if (msg.type === 'hello' && typeof msg.peerId === 'string') {
          ws.peerId = msg.peerId;
          broadcast();
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`🔴 presence disconnect: ${user.name} (${clients.size} online)`);
      broadcast();
    });

    // Send the current roster immediately so the newcomer sees who's already online.
    ws.send(rosterMessage());
  });

  // Heartbeat (mirrors the chat server): drop dead sockets, keep the rest warm.
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}
