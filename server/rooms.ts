import { difficultyForHeat, selectPassage } from "../shared/passages";
import type { FinishPayload, Player, ProgressPayload, RaceResult, Room } from "../shared/types";

const COLORS = ["#e84a5f", "#2a9d8f", "#f4a261", "#457b9d", "#8f5cff", "#ffbe0b"];
export const FINISH_GRACE_MS = 15_000;
export const TOTAL_HEATS = 3;
const PLACE_POINTS = [5, 3, 2, 1, 0, 0];

export class RoomStore {
  private rooms = new Map<string, Room>();
  private playerRooms = new Map<string, string>();

  createRoom(playerId: string, name: string, seed = Date.now()): Room {
    const code = this.generateUniqueCode();
    const room: Room = {
      code,
      hostId: playerId,
      players: [this.createPlayer(playerId, name, 0)],
      status: "lobby",
      passage: selectPassage(seed, difficultyForHeat(1)),
      startedAt: null,
      finishDeadline: null,
      heatNumber: 1,
      totalHeats: TOTAL_HEATS,
      results: []
    };
    this.rooms.set(code, room);
    this.playerRooms.set(playerId, code);
    return cloneRoom(room);
  }

  joinRoom(code: string, playerId: string, name: string): Room {
    const room = this.requireRoom(code.toUpperCase());
    if (room.status !== "lobby") throw new Error("Race already started.");
    if (room.players.length >= COLORS.length) throw new Error("Room is full.");
    if (!room.players.some((player) => player.id === playerId)) {
      room.players.push(this.createPlayer(playerId, name, room.players.length));
    }
    this.playerRooms.set(playerId, room.code);
    return cloneRoom(room);
  }

  setReady(playerId: string, ready: boolean): Room {
    const room = this.requirePlayerRoom(playerId);
    const player = this.requirePlayer(room, playerId);
    player.ready = ready;
    return cloneRoom(room);
  }

  startRace(playerId: string, now = Date.now()): Room {
    const room = this.requirePlayerRoom(playerId);
    if (room.hostId !== playerId) throw new Error("Only the host can start.");
    if (room.status !== "lobby") throw new Error("Race already started.");
    const guests = room.players.filter((player) => player.id !== room.hostId);
    if (guests.length > 0 && guests.some((player) => !player.ready)) {
      throw new Error("All guests must be ready.");
    }
    room.status = "countdown";
    room.startedAt = now + 3000;
    room.finishDeadline = null;
    room.results = [];
    room.players.forEach((player) => {
      player.progress = 0;
      player.wpm = 0;
      player.accuracy = 100;
      player.finishedAt = null;
    });
    return cloneRoom(room);
  }

  startNextHeat(playerId: string, now = Date.now(), seed = now): Room {
    const room = this.requirePlayerRoom(playerId);
    if (room.hostId !== playerId) throw new Error("Only the host can start the next heat.");
    if (room.status !== "intermission") throw new Error("The next heat is not ready.");
    room.heatNumber += 1;
    room.passage = selectPassage(seed, difficultyForHeat(room.heatNumber));
    this.prepareCountdown(room, now);
    return cloneRoom(room);
  }

  beginRace(code: string, expectedStartAt: number): Room {
    const room = this.requireRoom(code);
    if (room.status !== "countdown" || room.startedAt !== expectedStartAt) {
      return cloneRoom(room);
    }
    room.status = "racing";
    return cloneRoom(room);
  }

  restartLobby(playerId: string, seed = Date.now()): Room {
    const room = this.requirePlayerRoom(playerId);
    if (room.hostId !== playerId) throw new Error("Only the host can restart.");
    room.status = "lobby";
    room.heatNumber = 1;
    room.totalHeats = TOTAL_HEATS;
    room.passage = selectPassage(seed, difficultyForHeat(1));
    room.startedAt = null;
    room.finishDeadline = null;
    room.results = [];
    room.players.forEach((player) => {
      player.ready = player.id === room.hostId;
      player.progress = 0;
      player.wpm = 0;
      player.accuracy = 100;
      player.finishedAt = null;
      player.streak = 0;
      player.flowLevel = 0;
      player.score = 0;
    });
    return cloneRoom(room);
  }

  updateProgress(playerId: string, payload: ProgressPayload): Room {
    const room = this.requirePlayerRoom(playerId);
    if (room.status !== "racing") return cloneRoom(room);
    const player = this.requirePlayer(room, playerId);
    if (player.finishedAt !== null) return cloneRoom(room);
    player.progress = clamp(payload.progress);
    player.wpm = sanitizeMetric(payload.wpm);
    player.accuracy = sanitizeAccuracy(payload.accuracy);
    player.streak = sanitizeStreak(payload.streak);
    player.flowLevel = sanitizeFlowLevel(payload.flowLevel);
    return cloneRoom(room);
  }

  finishRace(playerId: string, payload: FinishPayload, now = Date.now()): Room {
    const room = this.requirePlayerRoom(playerId);
    if (room.status !== "racing") return cloneRoom(room);
    const player = this.requirePlayer(room, playerId);
    player.progress = 1;
    player.wpm = sanitizeMetric(payload.wpm);
    player.accuracy = sanitizeAccuracy(payload.accuracy);
    player.streak = sanitizeStreak(payload.streak);
    player.flowLevel = sanitizeFlowLevel(payload.flowLevel);
    player.finishedAt = now;
    if (!room.results.some((result) => result.playerId === playerId)) {
      room.results.push(toResult(player, room.results.length + 1, true, now));
    }
    room.finishDeadline ??= now + FINISH_GRACE_MS;
    if (room.results.length === room.players.length) {
      this.completeHeat(room);
    }
    return cloneRoom(room);
  }

  finalizeRace(code: string, expectedDeadline: number): Room | null {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return null;
    if (room.status !== "racing" || room.finishDeadline !== expectedDeadline) return null;
    const unfinished = room.players
      .filter((player) => player.finishedAt === null)
      .sort((left, right) => right.progress - left.progress || right.wpm - left.wpm);
    unfinished.forEach((player) => {
      room.results.push(toResult(player, room.results.length + 1, false, expectedDeadline));
    });
    this.completeHeat(room);
    return cloneRoom(room);
  }

  leaveRoom(playerId: string): Room | null {
    const code = this.playerRooms.get(playerId);
    if (!code) return null;
    const room = this.rooms.get(code);
    this.playerRooms.delete(playerId);
    if (!room) return null;
    room.players = room.players.filter((player) => player.id !== playerId);
    if (room.status === "racing" || room.status === "countdown") {
      room.results = room.results.filter((result) => result.playerId !== playerId);
    }
    if (room.players.length === 0) {
      this.rooms.delete(code);
      return null;
    }
    if (room.hostId === playerId) {
      room.hostId = room.players[0].id;
      room.players[0].ready = true;
    }
    if (room.status === "racing" && room.results.length === room.players.length) {
      this.completeHeat(room);
    }
    return cloneRoom(room);
  }

  getRoomForPlayer(playerId: string): Room | null {
    const code = this.playerRooms.get(playerId);
    return code ? cloneRoom(this.requireRoom(code)) : null;
  }

  getRoom(code: string): Room | null {
    const room = this.rooms.get(code.toUpperCase());
    return room ? cloneRoom(room) : null;
  }

  generateUniqueCode(): string {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    return code;
  }

  private createPlayer(id: string, name: string, colorIndex: number): Player {
    return {
      id,
      name: cleanName(name),
      color: COLORS[colorIndex % COLORS.length],
      ready: colorIndex === 0,
      progress: 0,
      wpm: 0,
      accuracy: 100,
      finishedAt: null,
      score: 0,
      streak: 0,
      flowLevel: 0
    };
  }

  private requirePlayerRoom(playerId: string): Room {
    const code = this.playerRooms.get(playerId);
    if (!code) throw new Error("Join or create a room first.");
    return this.requireRoom(code);
  }

  private requireRoom(code: string): Room {
    const room = this.rooms.get(code);
    if (!room) throw new Error("Room not found.");
    return room;
  }

  private requirePlayer(room: Room, playerId: string): Player {
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error("Player not in room.");
    return player;
  }

  private prepareCountdown(room: Room, now: number): void {
    room.status = "countdown";
    room.startedAt = now + 3000;
    room.finishDeadline = null;
    room.results = [];
    room.players.forEach((player) => {
      player.progress = 0;
      player.wpm = 0;
      player.accuracy = 100;
      player.finishedAt = null;
      player.streak = 0;
      player.flowLevel = 0;
    });
  }

  private completeHeat(room: Room): void {
    room.results.forEach((result) => {
      result.pointsAwarded = result.didFinish ? PLACE_POINTS[result.place - 1] ?? 0 : 0;
      const player = room.players.find((candidate) => candidate.id === result.playerId);
      if (player) player.score += result.pointsAwarded;
    });
    room.status = room.heatNumber >= room.totalHeats ? "finished" : "intermission";
    room.finishDeadline = null;
  }
}

export function generateRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 5; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function cleanName(name: string): string {
  const trimmed = name.trim().slice(0, 18);
  return trimmed.length > 0 ? trimmed : "Racer";
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sanitizeMetric(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 10) / 10);
}

function sanitizeAccuracy(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function sanitizeStreak(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(999, Math.floor(value ?? 0)));
}

function sanitizeFlowLevel(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(3, Math.floor(value ?? 0)));
}

function toResult(
  player: Player,
  place: number,
  didFinish: boolean,
  finishedAt: number
): RaceResult {
  return {
    playerId: player.id,
    name: player.name,
    color: player.color,
    wpm: player.wpm,
    accuracy: player.accuracy,
    finishedAt,
    place,
    didFinish,
    pointsAwarded: 0
  };
}

function cloneRoom(room: Room): Room {
  return {
    ...room,
    players: room.players.map((player) => ({ ...player })),
    results: room.results.map((result) => ({ ...result }))
  };
}
