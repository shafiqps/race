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
  shell.id = "main-content";
  const stage = el("section", "home-stage");
  stage.setAttribute("aria-hidden", "true");
  const overlay = el("section", "home-overlay");
  const brand = el("div", "brand-panel");
  brand.innerHTML = `
    <div class="hero-telemetry">
      <span>WPM-LINK / 03</span>
      <span class="signal-dot">live grid</span>
    </div>
    <p class="eyebrow">Competitive typing protocol</p>
    <h1 aria-label="Keyrush"><span class="title-outline">KEY</span><span>RUSH</span></h1>
    <p class="hero-copy">Every clean keystroke moves your runner. Miss the signal and lose the line.</p>
    <div class="key-hints" aria-label="World controls">
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</span>
      <span><kbd>drag</kbd> look</span>
      <span><kbd>space</kbd> jump</span>
    </div>
  `;

  const form = el("form", "entry-panel");
  form.innerHTML = `
    <div class="panel-index">
      <span>01 / establish link</span>
      <span class="signal-dot">network ready</span>
    </div>
    <div class="panel-heading">
      <p>Enter the grid</p>
      <span>Choose a callsign, then open a private race or intercept an existing channel.</span>
    </div>
    <label class="field">
      <span>Operator callsign</span>
      <input name="name" maxlength="18" autocomplete="nickname" placeholder="ADA" required />
    </label>
    <button class="primary action-button" name="intent" value="create" type="submit">
      <span>Open Channel</span><small>host a new race</small>
    </button>
    <div class="panel-divider"><span>or intercept a signal</span></div>
    <label class="field">
      <span>Channel Code</span>
      <input name="code" maxlength="5" autocomplete="off" placeholder="A7K2Q" />
    </label>
    <button class="action-button" name="intent" value="join" type="submit">
      <span>Join Channel</span><small>connect with a code</small>
    </button>
    <p class="error" id="error" aria-live="polite"></p>
    <p class="privacy-note">No account. No install. Your callsign expires when you disconnect.</p>
  `;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "").trim();
    const intent = submitter?.value;
    if (intent === "create") socket.emit("createRoom", name);
    if (intent === "join") {
      const code = String(formData.get("code") ?? "").trim().toUpperCase();
      if (!/^[A-Z2-9]{5}$/.test(code)) {
        const error = form.querySelector<HTMLElement>(".error");
        if (error) error.textContent = "Enter the five-character channel code.";
        pulseUi();
        return;
      }
      socket.emit("joinRoom", { code, name });
    }
  });

  overlay.append(brand, form);
  shell.append(stage, createSystemHeader("public access / node 03"), overlay, createSystemFooter());
  root.append(createSkipLink(), shell);
  scene = new MenuFreeRoamScene(stage);
}

function renderLobby(): void {
  if (!currentRoom) return;
  const shell = el("main", "lobby-shell");
  shell.id = "main-content";
  const stage = el("section", "lobby-stage");
  stage.setAttribute("aria-hidden", "true");

  const layout = el("section", "lobby-layout");
  const identity = el("header", "lobby-identity");
  identity.innerHTML = `
    <p class="eyebrow">Private channel established</p>
    <h1>Channel</h1>
    <p class="lobby-copy">Share this code with your crew. The host can launch when every incoming runner is synced.</p>
    <div class="code-block">
      <span>race access key</span>
      <div class="room-code" aria-label="Channel code ${currentRoom.code}">${currentRoom.code}</div>
    </div>
  `;

  const list = el("section", "player-list");
  list.setAttribute("aria-label", "Connected racers");
  const rosterHeader = el("header", "roster-head");
  rosterHeader.innerHTML = `
    <div><span>02 / active links</span><strong>Runner roster</strong></div>
    <span>${String(currentRoom.players.length).padStart(2, "0")} / 06</span>
  `;
  list.append(rosterHeader);
  currentRoom.players.forEach((player, index) => {
    const row = el("div", "player-row");
    const state = player.id === currentRoom?.hostId ? "host" : player.ready ? "synced" : "standby";
    row.style.setProperty("--player-color", player.color);
    row.dataset.state = state;
    row.innerHTML = `
      <span class="lane-index">${String(index + 1).padStart(2, "0")}</span>
      <span class="swatch"></span>
      <span class="player-name"><strong>${escapeHtml(player.name)}</strong><small>lane ${index + 1}</small></span>
      <span class="player-state">${state}</span>
    `;
    list.append(row);
  });

  const controls = el("section", "lobby-controls");
  const controlCopy = el("div", "control-copy");
  controlCopy.innerHTML = `<span>03 / race command</span><strong>${currentRoom.hostId === socket.id ? "Grid is under your control" : "Awaiting host launch"}</strong>`;
  controls.append(controlCopy);
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
  const lobbyError = el("p", "error", "");
  lobbyError.setAttribute("aria-live", "polite");
  controls.append(leave, lobbyError);

  layout.append(identity, list, controls);
  shell.append(stage, createSystemHeader(`private channel / ${currentRoom.code}`), layout, createSystemFooter());
  root.append(createSkipLink(), shell);
  scene = new LobbyWorldScene(stage);
}

function renderRace(): void {
  if (!currentRoom) return;
  const shell = el("main", "race-shell");
  shell.id = "main-content";
  const stage = el("section", "stage");
  stage.setAttribute("aria-hidden", "true");
  const overlay = el("section", "race-panel");
  overlay.innerHTML = `
    <div class="race-meta">
      <div class="meta-group"><span>channel</span><strong>${currentRoom.code}</strong></div>
      <div class="meta-group meta-live"><span>live telemetry</span><strong id="liveStats" aria-live="polite">0 WPM · 100% sync</strong></div>
    </div>
    <div class="typing-deck">
      <div class="deck-label"><span>01 / transmission</span><span>type the sequence exactly</span></div>
      <div class="passage" id="passage"></div>
      <label class="typing-label" for="typingInput"><span>Input buffer</span><small>mistakes break your velocity chain</small></label>
      <textarea id="typingInput" spellcheck="false" autocomplete="off" aria-label="Typing input" placeholder="TYPE TRANSMISSION HERE"></textarea>
    </div>
    <div class="lane-board">
      <div class="deck-label"><span>02 / lane telemetry</span><span>live race position</span></div>
      <div class="player-strip" id="playerStrip"></div>
    </div>
  `;
  shell.append(stage, createSystemHeader("race feed / live"), overlay);
  root.append(createSkipLink(), shell);

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
  shell.id = "main-content";
  const resultsHeading = el("header", "results-heading");
  resultsHeading.innerHTML = `
    <p class="eyebrow">Transmission complete / ${currentRoom.code}</p>
    <h1>Readout</h1>
    <p>Final velocity and signal accuracy from the grid.</p>
  `;
  const table = el("section", "results-table");
  table.setAttribute("aria-label", "Race results");
  const tableHeader = el("div", "results-header");
  tableHeader.innerHTML = `<span>rank</span><span>runner</span><span>velocity</span><span>sync</span>`;
  table.append(tableHeader);
  const ranked = currentRoom.results.length > 0 ? currentRoom.results : currentRoom.players.map((player, index) => ({
    playerId: player.id,
    name: player.name,
    color: player.color,
    wpm: player.wpm,
    accuracy: player.accuracy,
    finishedAt: player.finishedAt ?? 0,
    place: index + 1
  }));
  ranked.forEach((result, index) => {
    const row = el("div", index === 0 ? "result-row winner-row" : "result-row");
    row.style.setProperty("--player-color", result.color);
    row.innerHTML = `
      <span class="result-place">${String(result.place).padStart(2, "0")}</span>
      <span class="result-runner"><span class="swatch"></span><strong>${escapeHtml(result.name)}</strong>${index === 0 ? "<small>grid leader</small>" : ""}</span>
      <span class="result-metric"><small>velocity</small><strong>${result.wpm}</strong><em>WPM</em></span>
      <span class="result-metric"><small>sync</small><strong>${result.accuracy}</strong><em>%</em></span>
    `;
    table.append(row);
  });
  const actions = el("div", "result-actions");
  const actionCopy = el("div", "control-copy");
  actionCopy.innerHTML = `<span>next command</span><strong>${currentRoom.hostId === socket.id ? "Run the protocol again" : "Wait for the host or disconnect"}</strong>`;
  actions.append(actionCopy);
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
  const resultsContent = el("section", "results-content");
  resultsContent.append(resultsHeading, table, actions);
  shell.append(createSystemHeader("race archive / final"), resultsContent, createSystemFooter());
  root.append(createSkipLink(), shell);
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
    const progress = Math.round(player.progress * 100);
    item.style.setProperty("--player-color", player.color);
    item.style.setProperty("--progress", `${progress}%`);
    item.innerHTML = `
      <span class="swatch"></span>
      <strong>${escapeHtml(player.name)}</strong>
      <span>${progress}%</span>
      <span class="progress-track" aria-hidden="true"><i></i></span>
    `;
    item.setAttribute("aria-label", `${player.name}, ${progress} percent complete`);
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

function createSkipLink(): HTMLAnchorElement {
  const link = el("a", "skip-link", "Skip to race controls");
  link.href = "#main-content";
  return link;
}

function createSystemHeader(label: string): HTMLElement {
  const header = el("header", "system-header");
  const wordmark = el("div", "wordmark");
  wordmark.innerHTML = `<span>K//</span>R`;
  const route = el("p", "system-route", label);
  const status = el("div", "system-status");
  status.innerHTML = `<span>net <b>online</b></span><span>build 0.7.13</span>`;
  header.append(wordmark, route, status);
  return header;
}

function createSystemFooter(): HTMLElement {
  const footer = el("footer", "system-footer");
  footer.innerHTML = `<span>KEYRUSH NETWORK</span><span>latency compensated</span><span>© 2089 / all racers anonymous</span>`;
  return footer;
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
