import { io, Socket } from "socket.io-client";
import "./styles.css";
import { LobbyWorldScene } from "./game/LobbyWorldScene";
import { MenuFreeRoamScene } from "./game/MenuFreeRoamScene";
import { ThreeRaceScene } from "./game/ThreeRaceScene";
import {
  calculateAccuracy,
  calculateProgress,
  calculateWpm,
  countCorrectPrefix
} from "./game/typingStats";
import type { ClientToServerEvents, Room, ServerToClientEvents } from "../shared/types";

type AppView = "home" | "lobby" | "race" | "results";
type ActiveScene = LobbyWorldScene | MenuFreeRoamScene | ThreeRaceScene;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app root.");
const root = app;

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();
let currentRoom: Room | null = null;
let view: AppView = "home";
let scene: ActiveScene | null = null;
let typedText = "";
let raceStartMs = 0;
let finished = false;

socket.on("roomState", (room) => {
  currentRoom = room;
  if (room.status === "lobby") view = "lobby";
  if (room.status === "racing" && view !== "race") {
    view = "race";
    typedText = "";
    finished = false;
    raceStartMs = room.startedAt ?? Date.now();
  }
  if (room.status === "finished") view = "results";
  pulseUi();
  render();
});

socket.on("raceStarted", (room) => {
  currentRoom = room;
  view = "race";
  typedText = "";
  finished = false;
  raceStartMs = room.startedAt ?? Date.now();
  pulseUi();
  render();
});

socket.on("progressUpdate", (room) => {
  currentRoom = room;
  if (scene instanceof ThreeRaceScene) scene.updatePlayers(room.players);
  renderPlayerStrip();
});

socket.on("raceFinished", (room) => {
  currentRoom = room;
  view = "results";
  pulseUi();
  render();
});

socket.on("roomError", (message) => {
  setError(message);
});

render();

function render(): void {
  scene?.dispose();
  scene = null;
  root.replaceChildren();
  if (view === "home") renderHome();
  if (view === "lobby") renderLobby();
  if (view === "race") renderRace();
  if (view === "results") renderResults();
}

function renderHome(): void {
  const shell = el("main", "home-shell");
  const stage = el("section", "home-stage");
  const overlay = el("section", "home-overlay");
  const brand = el("div", "brand-panel");
  brand.append(el("p", "eyebrow", "Input Vector 03"), el("h1", "", "Type clean. Move faster."));

  const form = el("form", "entry-panel");
  form.innerHTML = `
    <label>
      <span>Operator</span>
      <input name="name" maxlength="18" autocomplete="nickname" placeholder="ADA" required />
    </label>
    <div class="split-actions">
      <button class="primary" name="intent" value="create" type="submit">Open Channel</button>
    </div>
    <label>
      <span>Channel Code</span>
      <input name="code" maxlength="5" autocomplete="off" placeholder="A7K2Q" />
    </label>
    <button name="intent" value="join" type="submit">Join Channel</button>
    <p class="error" id="error"></p>
  `;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "");
    const intent = submitter?.value;
    if (intent === "create") socket.emit("createRoom", name);
    if (intent === "join") socket.emit("joinRoom", { code: String(formData.get("code") ?? ""), name });
  });

  overlay.append(brand, form);
  shell.append(stage, overlay);
  root.append(shell);
  scene = new MenuFreeRoamScene(stage);
}

function renderLobby(): void {
  if (!currentRoom) return;
  const shell = el("main", "lobby-shell");
  const stage = el("section", "lobby-stage");
  const top = el("header", "lobby-top");
  top.append(el("div", "room-code", currentRoom.code), el("h1", "", "Channel"));

  const list = el("section", "player-list");
  currentRoom.players.forEach((player) => {
    const row = el("div", "player-row");
    row.innerHTML = `
      <span class="swatch" style="background:${player.color}"></span>
      <strong>${escapeHtml(player.name)}</strong>
      <span>${player.id === currentRoom?.hostId ? "Host" : player.ready ? "Ready" : "Not ready"}</span>
    `;
    list.append(row);
  });

  const controls = el("section", "lobby-controls");
  const me = currentRoom.players.find((player) => player.id === socket.id);
  const isHost = currentRoom.hostId === socket.id;
  if (!isHost) {
    const ready = el("button", me?.ready ? "primary" : "", me?.ready ? "Synced" : "Sync");
    ready.addEventListener("click", () => socket.emit("setReady", !me?.ready));
    controls.append(ready);
  }
  if (isHost) {
    const start = el("button", "primary", "Launch");
    start.addEventListener("click", () => socket.emit("startRace"));
    controls.append(start);
  }
  const leave = el("button", "", "Exit");
  leave.addEventListener("click", () => {
    socket.emit("leaveRoom");
    currentRoom = null;
    view = "home";
    render();
  });
  controls.append(leave, el("p", "error", ""));

  shell.append(stage, top, list, controls);
  root.append(shell);
  scene = new LobbyWorldScene(stage);
}

function renderRace(): void {
  if (!currentRoom) return;
  const shell = el("main", "race-shell");
  const stage = el("section", "stage");
  const overlay = el("section", "race-panel");
  overlay.innerHTML = `
    <div class="race-meta">
      <strong>${currentRoom.code}</strong>
      <span id="liveStats">0 WPM · 100% sync</span>
    </div>
    <div class="passage" id="passage"></div>
    <textarea id="typingInput" spellcheck="false" autocomplete="off" aria-label="Typing input"></textarea>
    <div class="player-strip" id="playerStrip"></div>
  `;
  shell.append(stage, overlay);
  root.append(shell);

  scene = new ThreeRaceScene(stage, socket.id);
  scene.updatePlayers(currentRoom.players);
  renderPassage();
  renderPlayerStrip();

  const input = document.querySelector<HTMLTextAreaElement>("#typingInput");
  input?.focus();
  input?.addEventListener("input", () => {
    if (!currentRoom || !input || finished) return;
    const previousTypedText = typedText;
    typedText = input.value;
    const correct = countCorrectPrefix(currentRoom.passage, typedText);
    const elapsed = Date.now() - raceStartMs;
    const payload = {
      progress: calculateProgress(currentRoom.passage, typedText),
      wpm: calculateWpm(correct, elapsed),
      accuracy: calculateAccuracy(currentRoom.passage, typedText)
    };
    updateLiveStats(payload.wpm, payload.accuracy);
    renderPassage();
    if (typedText.length > previousTypedText.length && scene instanceof ThreeRaceScene) {
      const typedCharIndex = typedText.length - 1;
      const correctChar = typedText[typedCharIndex] === currentRoom.passage[typedCharIndex];
      scene.emitTypingEffect(correctChar);
      if (!correctChar) pulseUi();
    }
    if (payload.progress >= 1) {
      finished = true;
      if (scene instanceof ThreeRaceScene) scene.triggerFinishBurst();
      pulseUi();
      socket.emit("finishRace", { ...payload, finishedAt: Date.now() });
      input.disabled = true;
    } else {
      socket.emit("updateProgress", payload);
    }
  });
}

function renderResults(): void {
  if (!currentRoom) return;
  const shell = el("main", "results-shell");
  shell.append(el("h1", "", "Readout"));
  const table = el("section", "results-table");
  const ranked = currentRoom.results.length > 0 ? currentRoom.results : currentRoom.players.map((player, index) => ({
    playerId: player.id,
    name: player.name,
    color: player.color,
    wpm: player.wpm,
    accuracy: player.accuracy,
    finishedAt: player.finishedAt ?? 0,
    place: index + 1
  }));
  ranked.forEach((result) => {
    const row = el("div", "result-row");
    row.innerHTML = `
      <span>${result.place}</span>
      <span class="swatch" style="background:${result.color}"></span>
      <strong>${escapeHtml(result.name)}</strong>
      <span>${result.wpm} WPM</span>
      <span>${result.accuracy}%</span>
    `;
    table.append(row);
  });
  const actions = el("div", "result-actions");
  if (currentRoom.hostId === socket.id) {
    const restart = el("button", "primary", "New Vector");
    restart.addEventListener("click", () => socket.emit("startRace"));
    actions.append(restart);
  }
  const home = el("button", "", "Exit");
  home.addEventListener("click", () => {
    socket.emit("leaveRoom");
    currentRoom = null;
    view = "home";
    render();
  });
  actions.append(home);
  shell.append(table, actions);
  root.append(shell);
}

function renderPassage(): void {
  if (!currentRoom) return;
  const passage = document.querySelector<HTMLDivElement>("#passage");
  if (!passage) return;
  passage.replaceChildren();
  for (let i = 0; i < currentRoom.passage.length; i += 1) {
    const char = currentRoom.passage[i];
    const span = el("span", "", char);
    if (i < typedText.length) span.className = typedText[i] === char ? "correct" : "wrong";
    if (i === typedText.length) span.className = "cursor";
    passage.append(span);
  }
}

function renderPlayerStrip(): void {
  if (!currentRoom) return;
  const strip = document.querySelector<HTMLDivElement>("#playerStrip");
  if (!strip) return;
  strip.replaceChildren();
  currentRoom.players.forEach((player) => {
    const item = el("div", "progress-item");
    item.innerHTML = `
      <span class="swatch" style="background:${player.color}"></span>
      <strong>${escapeHtml(player.name)}</strong>
      <span>${Math.round(player.progress * 100)}%</span>
    `;
    strip.append(item);
  });
}

function updateLiveStats(wpm: number, accuracy: number): void {
  const stats = document.querySelector("#liveStats");
  if (stats) stats.textContent = `${wpm} WPM · ${accuracy}% sync`;
}

function setError(message: string): void {
  const error = document.querySelector<HTMLElement>(".error");
  if (error) error.textContent = message;
  pulseUi();
}

function pulseUi(): void {
  root.classList.remove("ui-glitch");
  void root.offsetWidth;
  root.classList.add("ui-glitch");
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = ""
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[char];
  });
}
