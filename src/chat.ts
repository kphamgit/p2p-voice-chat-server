import { WebSocketServer, WebSocket } from 'ws';

// WebSocket + a liveness flag used by the heartbeat below.
interface ChatSocket extends WebSocket {
  isAlive: boolean;
}

// A single-room chat WebSocketServer in `noServer` mode. Every connected client
// is in one shared room; a JSON message from any client is relayed to the
// others. It does NOT attach to the HTTP server's "upgrade" event — the caller
// routes "/chat" upgrades to it (see index.ts), so it shares one HTTP server
// with the PeerJS WebSocket server.
export function createChatServer(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ChatSocket>();

  wss.on('connection', (socket) => {
    const ws = socket as ChatSocket;
    ws.isAlive = true;
    clients.add(ws);
    console.log(`💬 chat client connected (${clients.size} online)`);

    // Browsers auto-reply to server pings with a pong; mark the socket alive.
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      // The server is a dumb relay: forward the raw JSON string to everyone else.
      const text = data.toString();
      for (const client of clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(text);
        }
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`💬 chat client disconnected (${clients.size} online)`);
    });
  });

  // Heartbeat: every 30s, terminate clients that didn't pong since last round,
  // then ping the rest. The traffic also keeps Heroku's ~55s idle timeout away.
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
