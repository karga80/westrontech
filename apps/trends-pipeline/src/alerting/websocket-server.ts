import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { env } from "@/config/env";
import { createLogger } from "@/shared/logger";
import type { FinalAlert } from "@/shared/types";

const log = createLogger("ws-server");

const PING_INTERVAL_MS = 30_000;
const STALE_TIMEOUT_MS = 90_000;

interface WsClient {
  socket: WebSocket;
  lastPong: number;
}

const clients = new Map<string, WsClient>();

function broadcastAlert(message: string): void {
  for (const [id, client] of clients.entries()) {
    try {
      client.socket.send(message);
    } catch {
      clients.delete(id);
    }
  }
}

export async function startWebSocketServer(): Promise<void> {
  const app = Fastify({ logger: false });
  await app.register(websocket);

  app.get("/trends/feed", { websocket: true }, (socket, req) => {
    const token = (req.query as Record<string, string>)["token"];
    if (token !== env.WESTRON_USER_TOKEN) {
      socket.close(4001, "Unauthorized");
      return;
    }

    const clientId = `client:${Date.now()}:${Math.random()}`;
    clients.set(clientId, { socket: socket as unknown as WebSocket, lastPong: Date.now() });
    log.info({ clientId, totalClients: clients.size }, "WS client connected");

    socket.on("pong", () => {
      const c = clients.get(clientId);
      if (c) c.lastPong = Date.now();
    });

    socket.on("close", () => {
      clients.delete(clientId);
      log.info({ clientId, totalClients: clients.size }, "WS client disconnected");
    });

    // Send snapshot of last 50 alerts on connect
    socket.send(JSON.stringify({ type: "feed.snapshot", payload: [] }));
  });

  // Ping loop
  setInterval(() => {
    const now = Date.now();
    for (const [id, client] of clients.entries()) {
      if (now - client.lastPong > STALE_TIMEOUT_MS) {
        log.warn({ id }, "Dropping stale WS connection");
        client.socket.close();
        clients.delete(id);
      } else {
        try {
          (client.socket as unknown as { ping: () => void }).ping();
        } catch {
          clients.delete(id);
        }
      }
    }
  }, PING_INTERVAL_MS);

  await app.listen({ port: env.WS_PORT, host: "127.0.0.1" });
  log.info({ port: env.WS_PORT }, "WebSocket server started");
}

export function pushAlert(alert: FinalAlert): void {
  const message = JSON.stringify({ type: "alert.new", payload: alert });
  broadcastAlert(message);
}

export function getConnectedClients(): number {
  return clients.size;
}
