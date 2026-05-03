import { describe, expect, it } from "vitest";
import { generateRoomCode, RoomStore } from "../server/rooms";

describe("RoomStore", () => {
  it("generates short readable room codes", () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    expect(code).not.toMatch(/[IO01]/);
  });

  it("creates, joins, starts, ranks, and finishes a race", () => {
    const store = new RoomStore();
    const created = store.createRoom("host", "Host", 0);
    const joined = store.joinRoom(created.code, "guest", "Guest");
    expect(joined.players).toHaveLength(2);
    expect(joined.players[0].ready).toBe(true);
    expect(joined.players[1].ready).toBe(false);

    expect(() => store.startRace("host", 1000)).toThrow("All guests must be ready.");
    store.setReady("guest", true);
    const racing = store.startRace("host", 1000);
    expect(racing.status).toBe("racing");
    expect(racing.startedAt).toBe(1000);

    const updated = store.updateProgress("guest", { progress: 2, wpm: 72.22, accuracy: 98.88 });
    const guest = updated.players.find((player) => player.id === "guest");
    expect(guest?.progress).toBe(1);
    expect(guest?.wpm).toBe(72.2);
    expect(guest?.accuracy).toBe(98.9);

    const afterGuest = store.finishRace("guest", { progress: 1, wpm: 72, accuracy: 99, finishedAt: 1500 });
    expect(afterGuest.status).toBe("racing");
    expect(afterGuest.results[0].name).toBe("Guest");
    expect(afterGuest.results[0].place).toBe(1);

    const finished = store.finishRace("host", { progress: 1, wpm: 64, accuracy: 97, finishedAt: 1800 });
    expect(finished.status).toBe("finished");
    expect(finished.results.map((result) => result.name)).toEqual(["Guest", "Host"]);
  });

  it("promotes a new host when the host leaves", () => {
    const store = new RoomStore();
    const room = store.createRoom("a", "A", 1);
    store.joinRoom(room.code, "b", "B");
    const afterLeave = store.leaveRoom("a");
    expect(afterLeave?.hostId).toBe("b");
    expect(afterLeave?.players[0].ready).toBe(true);
  });
});
