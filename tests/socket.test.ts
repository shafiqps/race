import http from "node:http";
import { AddressInfo } from "node:net";
import { io as Client, Socket } from "socket.io-client";
import { Server } from "socket.io";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRaceServer } from "../server/index";
import type { ClientToServerEvents, Room, ServerToClientEvents } from "../shared/types";

describe("socket room flow", () => {
  let httpServer: http.Server;
  let ioServer: Server<ClientToServerEvents, ServerToClientEvents>;
  let url: string;
  let sockets: Socket<ServerToClientEvents, ClientToServerEvents>[] = [];

  beforeEach(async () => {
    httpServer = http.createServer();
    ioServer = createRaceServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.disconnect());
    sockets = [];
    await ioServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("creates a room, joins a guest, starts, broadcasts progress, and finishes", async () => {
    const host = connect(url);
    const guest = connect(url);
    sockets.push(host, guest);

    const createdPromise = onceRoom(host);
    host.emit("createRoom", "Host");
    const created = await createdPromise;
    expect(created.players).toHaveLength(1);

    const joinedHostPromise = onceRoom(host, (room) => room.players.length === 2);
    const joinedGuestPromise = onceRoom(guest, (room) => room.players.length === 2);
    guest.emit("joinRoom", { code: created.code, name: "Guest" });
    const joinedHost = await joinedHostPromise;
    await joinedGuestPromise;
    expect(joinedHost.players.map((player) => player.name)).toEqual(["Host", "Guest"]);

    const readyPromise = onceRoom(host, (room) => room.players[1].ready);
    guest.emit("setReady", true);
    await readyPromise;

    const startedPromise = onceRaceStarted(guest);
    host.emit("startRace");
    const started = await startedPromise;
    expect(started.status).toBe("racing");

    const progressPromise = onceProgress(host);
    guest.emit("updateProgress", { progress: 0.5, wpm: 40, accuracy: 95 });
    const progress = await progressPromise;
    expect(progress.players.find((player) => player.name === "Guest")?.progress).toBe(0.5);

    const finishedPromise = onceFinished(guest);
    host.emit("finishRace", { progress: 1, wpm: 38, accuracy: 96, finishedAt: 2000 });
    guest.emit("finishRace", { progress: 1, wpm: 40, accuracy: 95, finishedAt: 1900 });
    const finished = await finishedPromise;
    expect(finished.status).toBe("finished");
    expect(finished.results).toHaveLength(2);
  });
});

function connect(url: string): Socket<ServerToClientEvents, ClientToServerEvents> {
  return Client(url, { transports: ["websocket"], forceNew: true });
}

function onceRoom(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  predicate: (room: Room) => boolean = () => true
): Promise<Room> {
  return new Promise((resolve) => {
    const handler = (room: Room) => {
      if (!predicate(room)) return;
      socket.off("roomState", handler);
      resolve(room);
    };
    socket.on("roomState", handler);
  });
}

function onceRaceStarted(socket: Socket<ServerToClientEvents, ClientToServerEvents>): Promise<Room> {
  return new Promise((resolve) => socket.once("raceStarted", resolve));
}

function onceProgress(socket: Socket<ServerToClientEvents, ClientToServerEvents>): Promise<Room> {
  return new Promise((resolve) => socket.once("progressUpdate", resolve));
}

function onceFinished(socket: Socket<ServerToClientEvents, ClientToServerEvents>): Promise<Room> {
  return new Promise((resolve) => socket.once("raceFinished", resolve));
}
