import { describe, expect, it } from "vitest";
import { generateRoomCode, RoomStore } from "../server/rooms";

describe("RoomStore", () => {
  it("generates short readable room codes", () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    expect(code).not.toMatch(/[IO01]/);
  });

  it("creates, joins, starts, ranks, and finishes a heat", () => {
    const store = new RoomStore();
    const created = store.createRoom("host", "Host", 0);
    const joined = store.joinRoom(created.code, "guest", "Guest");
    expect(joined.players).toHaveLength(2);
    expect(joined.players[0].ready).toBe(true);
    expect(joined.players[1].ready).toBe(false);

    expect(() => store.startRace("host", 1000)).toThrow("All guests must be ready.");
    store.setReady("guest", true);
    const countdown = store.startRace("host", 1000);
    expect(countdown.status).toBe("countdown");
    expect(countdown.startedAt).toBe(4000);
    const racing = store.beginRace(created.code, 4000);
    expect(racing.status).toBe("racing");
    expect(racing.startedAt).toBe(4000);

    const updated = store.updateProgress("guest", {
      progress: 2,
      wpm: 72.22,
      accuracy: 98.88,
      streak: 1000,
      flowLevel: 9
    });
    const guest = updated.players.find((player) => player.id === "guest");
    expect(guest?.progress).toBe(1);
    expect(guest?.wpm).toBe(72.2);
    expect(guest?.accuracy).toBe(98.9);
    expect(guest?.streak).toBe(999);
    expect(guest?.flowLevel).toBe(3);

    const afterGuest = store.finishRace("guest", { progress: 1, wpm: 72, accuracy: 99, finishedAt: 1500 }, 1500);
    expect(afterGuest.status).toBe("racing");
    expect(afterGuest.finishDeadline).toBe(16_500);
    expect(afterGuest.results[0].name).toBe("Guest");
    expect(afterGuest.results[0].place).toBe(1);
    expect(afterGuest.results[0].didFinish).toBe(true);

    const intermission = store.finishRace("host", { progress: 1, wpm: 64, accuracy: 97, finishedAt: 1800 }, 1800);
    expect(intermission.status).toBe("intermission");
    expect(intermission.results.map((result) => result.name)).toEqual(["Guest", "Host"]);
    expect(intermission.results.map((result) => result.pointsAwarded)).toEqual([5, 3]);
    expect(intermission.players.map((player) => player.score)).toEqual([3, 5]);
  });

  it("closes the grid and ranks unfinished racers as DNF after the grace period", () => {
    const store = new RoomStore();
    const room = store.createRoom("host", "Host", 0);
    store.joinRoom(room.code, "guest", "Guest");
    store.setReady("guest", true);
    store.startRace("host", 1000);
    store.beginRace(room.code, 4000);
    store.updateProgress("guest", { progress: 0.6, wpm: 42, accuracy: 94 });
    const afterHost = store.finishRace("host", { progress: 1, wpm: 60, accuracy: 98, finishedAt: 5000 }, 5000);
    const closed = store.finalizeRace(room.code, afterHost.finishDeadline!);
    expect(closed?.status).toBe("intermission");
    expect(closed?.results.map((result) => [result.name, result.didFinish])).toEqual([
      ["Host", true],
      ["Guest", false]
    ]);
    expect(closed?.players.map((player) => player.score)).toEqual([5, 0]);
  });

  it("plays three increasingly difficult heats and ends with a cumulative score", () => {
    const store = new RoomStore();
    const room = store.createRoom("host", "Host", 0);
    expect(room.heatNumber).toBe(1);
    expect(room.passage).toContain("Smooth inputs");

    store.startRace("host", 1000);
    store.beginRace(room.code, 4000);
    const heatOne = store.finishRace("host", { progress: 1, wpm: 50, accuracy: 100, finishedAt: 5000 }, 5000);
    expect(heatOne.status).toBe("intermission");

    const heatTwoCountdown = store.startNextHeat("host", 6000, 0);
    expect(heatTwoCountdown.heatNumber).toBe(2);
    expect(heatTwoCountdown.passage).toContain("Three quick laps");
    store.beginRace(room.code, 9000);
    const heatTwo = store.finishRace("host", { progress: 1, wpm: 50, accuracy: 100, finishedAt: 10000 }, 10000);
    expect(heatTwo.status).toBe("intermission");

    const heatThreeCountdown = store.startNextHeat("host", 11000, 0);
    expect(heatThreeCountdown.heatNumber).toBe(3);
    expect(heatThreeCountdown.passage).toContain("Sector 9");
    store.beginRace(room.code, 14000);
    const match = store.finishRace("host", { progress: 1, wpm: 50, accuracy: 100, finishedAt: 15000 }, 15000);
    expect(match.status).toBe("finished");
    expect(match.players[0].score).toBe(15);
  });

  it("promotes a new host when the host leaves", () => {
    const store = new RoomStore();
    const room = store.createRoom("a", "A", 1);
    store.joinRoom(room.code, "b", "B");
    const afterLeave = store.leaveRoom("a");
    expect(afterLeave?.hostId).toBe("b");
    expect(afterLeave?.players[0].ready).toBe(true);
  });

  it("ignores a stale finish timer after its room is deleted", () => {
    const store = new RoomStore();
    const room = store.createRoom("host", "Host", 0);
    store.joinRoom(room.code, "guest", "Guest");
    store.setReady("guest", true);
    store.startRace("host", 1000);
    store.beginRace(room.code, 4000);
    const afterHost = store.finishRace("host", { progress: 1, wpm: 60, accuracy: 100, finishedAt: 5000 }, 5000);
    const deadline = afterHost.finishDeadline!;
    store.leaveRoom("host");
    store.leaveRoom("guest");
    expect(store.finalizeRace(room.code, deadline)).toBeNull();
  });
});
