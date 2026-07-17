import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Server } from "socket.io";
import { RoomStore } from "./rooms";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/types";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const distDir = path.resolve(process.cwd(), "dist");
const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const MAX_CONNECTIONS_PER_IP = 20;
const EVENT_LIMIT = 120;
const EVENT_WINDOW_MS = 10_000;

export function createRaceServer(httpServer: http.Server): Server<ClientToServerEvents, ServerToClientEvents> {
  const store = new RoomStore();
  const connectionsByIp = new Map<string, number>();
  const raceIo = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : false,
      methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 16_384,
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin));
    }
  });

  raceIo.on("connection", (socket) => {
    const ip = socket.handshake.address;
    const connectionCount = (connectionsByIp.get(ip) ?? 0) + 1;
    connectionsByIp.set(ip, connectionCount);
    if (connectionCount > MAX_CONNECTIONS_PER_IP) {
      socket.disconnect(true);
      decrementConnectionCount(connectionsByIp, ip);
      return;
    }

    let eventCount = 0;
    let eventWindowStartedAt = Date.now();
    socket.use((_event, next) => {
      const now = Date.now();
      if (now - eventWindowStartedAt >= EVENT_WINDOW_MS) {
        eventWindowStartedAt = now;
        eventCount = 0;
      }
      eventCount += 1;
      if (eventCount > EVENT_LIMIT) {
        next(new Error("Too many requests."));
        return;
      }
      next();
    });

    socket.on("createRoom", (name) => {
      try {
        const room = store.createRoom(socket.id, requireName(name));
        socket.join(room.code);
        socket.emit("roomState", room);
      } catch (error) {
        socket.emit("roomError", getErrorMessage(error));
      }
    });

    socket.on("joinRoom", (payload) => {
      try {
        if (!payload || typeof payload !== "object") throw new Error("Invalid room request.");
        const { code, name } = payload as { code?: unknown; name?: unknown };
        const room = store.joinRoom(requireRoomCode(code), socket.id, requireName(name));
        socket.join(room.code);
        raceIo.to(room.code).emit("roomState", room);
      } catch (error) {
        socket.emit("roomError", getErrorMessage(error));
      }
    });

    socket.on("setReady", (ready) => {
      try {
        if (typeof ready !== "boolean") throw new Error("Invalid ready state.");
        const room = store.setReady(socket.id, ready);
        raceIo.to(room.code).emit("roomState", room);
      } catch (error) {
        socket.emit("roomError", getErrorMessage(error));
      }
    });

    socket.on("startRace", () => {
      try {
        const existingRoom = store.getRoomForPlayer(socket.id);
        const room = existingRoom?.status === "finished"
          ? store.restartLobby(socket.id)
          : existingRoom?.status === "intermission"
            ? store.startNextHeat(socket.id)
            : store.startRace(socket.id);
        if (room.status === "lobby") {
          raceIo.to(room.code).emit("roomState", room);
          return;
        }
        raceIo.to(room.code).emit("roomState", room);
        const expectedStartAt = room.startedAt;
        if (room.status === "countdown" && expectedStartAt !== null) {
          setTimeout(() => {
            const racingRoom = store.beginRace(room.code, expectedStartAt);
            if (racingRoom.status !== "racing") return;
            raceIo.to(racingRoom.code).emit("raceStarted", racingRoom);
            raceIo.to(racingRoom.code).emit("roomState", racingRoom);
          }, Math.max(0, expectedStartAt - Date.now()));
        }
      } catch (error) {
        socket.emit("roomError", getErrorMessage(error));
      }
    });

    socket.on("updateProgress", (payload) => {
      try {
        const room = store.updateProgress(socket.id, requireProgress(payload));
        raceIo.to(room.code).emit("progressUpdate", room);
      } catch (error) {
        socket.emit("roomError", getErrorMessage(error));
      }
    });

    socket.on("finishRace", (payload) => {
      try {
        const beforeFinish = store.getRoomForPlayer(socket.id);
        const room = store.finishRace(socket.id, { ...requireProgress(payload), finishedAt: Date.now() });
        raceIo.to(room.code).emit(room.status === "racing" ? "progressUpdate" : "raceFinished", room);
        raceIo.to(room.code).emit("roomState", room);
        if (beforeFinish?.finishDeadline === null && room.finishDeadline !== null) {
          const expectedDeadline = room.finishDeadline;
          setTimeout(() => {
            const finishedRoom = store.finalizeRace(room.code, expectedDeadline);
            if (!finishedRoom) return;
            raceIo.to(finishedRoom.code).emit("raceFinished", finishedRoom);
            raceIo.to(finishedRoom.code).emit("roomState", finishedRoom);
          }, Math.max(0, expectedDeadline - Date.now()));
        }
      } catch (error) {
        socket.emit("roomError", getErrorMessage(error));
      }
    });

    socket.on("leaveRoom", () => {
      emitLeave(socket.id, store, raceIo);
    });

    socket.on("disconnect", () => {
      decrementConnectionCount(connectionsByIp, ip);
      emitLeave(socket.id, store, raceIo);
    });
  });

  return raceIo;
}

if (/[/\\](?:server[/\\]index\.ts|dist-server[/\\]index\.cjs)$/.test(process.argv[1] ?? "")) {
  const server = http.createServer((request, response) => {
    void serveRequest(request, response);
  });
  createRaceServer(server);
  server.listen(port, host, () => {
    console.log(`Typing race server listening on http://${host}:${port}`);
  });
}

async function serveRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  try {
    setSecurityHeaders(response);
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", "http://localhost");
    const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const filePath = path.resolve(distDir, `.${requestPath}`);
    if (!filePath.startsWith(distDir)) {
      response.writeHead(403);
      response.end();
      return;
    }

    await sendFile(filePath, response);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      response.writeHead(500);
      response.end("Internal server error");
      return;
    }

    const acceptsHtml = request.headers.accept?.includes("text/html") ?? false;
    if (acceptsHtml) {
      await sendFile(path.join(distDir, "index.html"), response);
      return;
    }

    response.writeHead(404);
    response.end();
  }
}

function setSecurityHeaders(response: http.ServerResponse): void {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
}

function requireName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid player name.");
  return value;
}

function requireRoomCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z2-9]{5}$/i.test(value)) throw new Error("Invalid room code.");
  return value.toUpperCase();
}

function requireProgress(value: unknown): { progress: number; wpm: number; accuracy: number; streak?: number; flowLevel?: number } {
  if (!value || typeof value !== "object") throw new Error("Invalid race update.");
  const payload = value as Record<string, unknown>;
  const numbers = [payload.progress, payload.wpm, payload.accuracy];
  if (numbers.some((metric) => typeof metric !== "number" || !Number.isFinite(metric))) {
    throw new Error("Invalid race update.");
  }
  if (payload.streak !== undefined && (typeof payload.streak !== "number" || !Number.isFinite(payload.streak))) {
    throw new Error("Invalid race update.");
  }
  if (payload.flowLevel !== undefined && (typeof payload.flowLevel !== "number" || !Number.isFinite(payload.flowLevel))) {
    throw new Error("Invalid race update.");
  }
  return {
    progress: payload.progress as number,
    wpm: payload.wpm as number,
    accuracy: payload.accuracy as number,
    streak: payload.streak as number | undefined,
    flowLevel: payload.flowLevel as number | undefined
  };
}

function decrementConnectionCount(counts: Map<string, number>, ip: string): void {
  const next = (counts.get(ip) ?? 1) - 1;
  if (next <= 0) counts.delete(ip);
  else counts.set(ip, next);
}

async function sendFile(filePath: string, response: http.ServerResponse): Promise<void> {
  const content = await fs.readFile(filePath);
  response.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": filePath.includes(`${path.sep}assets${path.sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache"
  });
  response.end(content);
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath);
  const types: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  return types[extension] ?? "application/octet-stream";
}

function emitLeave(
  playerId: string,
  store: RoomStore,
  raceIo: Server<ClientToServerEvents, ServerToClientEvents>
): void {
  const room = store.leaveRoom(playerId);
  if (room) raceIo.to(room.code).emit("roomState", room);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
