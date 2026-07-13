import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { RoomStore } from "./rooms";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/types";

const port = Number(process.env.PORT ?? 3001);
const distDir = path.resolve(process.cwd(), "dist");

export function createRaceServer(httpServer: http.Server): Server<ClientToServerEvents, ServerToClientEvents> {
  const store = new RoomStore();
  const raceIo = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true,
      methods: ["GET", "POST"]
    }
  });

  raceIo.on("connection", (socket) => {
    socket.on("createRoom", (name) => {
      try {
        const room = store.createRoom(socket.id, name);
        socket.join(room.code);
        socket.emit("roomState", room);
      } catch (error) {
        socket.emit("roomError", getErrorMessage(error));
      }
    });

    socket.on("joinRoom", ({ code, name }) => {
      try {
        const room = store.joinRoom(code, socket.id, name);
        socket.join(room.code);
        raceIo.to(room.code).emit("roomState", room);
      } catch (error) {
        socket.emit("roomError", getErrorMessage(error));
      }
    });

    socket.on("setReady", (ready) => {
      try {
        const room = store.setReady(socket.id, ready);
        raceIo.to(room.code).emit("roomState", room);
      } catch (error) {
        socket.emit("roomError", getErrorMessage(error));
      }
    });

    socket.on("startRace", () => {
      try {
        const existingRoom = store.getRoomForPlayer(socket.id);
        const room = existingRoom?.status === "finished" ? store.restartLobby(socket.id) : store.startRace(socket.id);
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
        const room = store.updateProgress(socket.id, payload);
        raceIo.to(room.code).emit("progressUpdate", room);
      } catch (error) {
        socket.emit("roomError", getErrorMessage(error));
      }
    });

    socket.on("finishRace", (payload) => {
      try {
        const room = store.finishRace(socket.id, payload);
        raceIo.to(room.code).emit(room.status === "finished" ? "raceFinished" : "progressUpdate", room);
        raceIo.to(room.code).emit("roomState", room);
      } catch (error) {
        socket.emit("roomError", getErrorMessage(error));
      }
    });

    socket.on("leaveRoom", () => {
      emitLeave(socket.id, store, raceIo);
    });

    socket.on("disconnect", () => {
      emitLeave(socket.id, store, raceIo);
    });
  });

  return raceIo;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = http.createServer((request, response) => {
    void serveRequest(request, response);
  });
  createRaceServer(server);
  server.listen(port, "0.0.0.0", () => {
    console.log(`Typing race server listening on http://0.0.0.0:${port}`);
  });
}

async function serveRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  try {
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
