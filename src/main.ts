import { io, Socket } from "socket.io-client";
import "./styles.css";
import { LobbyWorldScene } from "./game/LobbyWorldScene";
import { MenuFreeRoamScene } from "./game/MenuFreeRoamScene";
import { ThreeRaceScene } from "./game/ThreeRaceScene";
import {
  calculateFlowLevel,
  calculateKeystrokeAccuracy,
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
let keystrokeAttempts = 0;
let mistakes = 0;
let currentStreak = 0;
let longestStreak = 0;
let countdownTimer: number | null = null;
let finishWatchTimer: number | null = null;
let raceAlertTimer: number | null = null;
let lastLocalRank: number | null = null;
let lastFlowLevel = 0;
let finalStretchAnnounced = false;

socket.on("roomState", (room) => {
  const previousView = view;
  currentRoom = room;
  if (room.status === "countdown") {
    view = "race";
    resetRaceSession(room.startedAt ?? Date.now());
  }
  if (room.status === "lobby") view = "lobby";
  if (room.status === "racing" && view !== "race") {
    view = "race";
    resetRaceSession(room.startedAt ?? Date.now());
  }
  if (room.status === "intermission" || room.status === "finished") view = "results";
  pulseUi();

  if (previousView === "lobby" && view === "lobby" && scene instanceof LobbyWorldScene) {
    refreshLobbyLayout();
    return;
  }
  if (previousView === "race" && view === "race" && scene instanceof ThreeRaceScene) {
    scene.updatePlayers(room.players);
    renderPlayerStrip();
    updateFinishWatch();
    return;
  }
  render();
});

socket.on("raceStarted", (room) => {
  currentRoom = room;
  view = "race";
  raceStartMs = room.startedAt ?? Date.now();
  lastLocalRank = getLocalRank(room);
  pulseUi();
  render();
});

socket.on("progressUpdate", (room) => {
  detectRaceMoments(room);
  currentRoom = room;
  if (scene instanceof ThreeRaceScene) scene.updatePlayers(room.players);
  renderPlayerStrip();
  updateFinishWatch();
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
  clearCountdownTimer();
  clearFinishWatchTimer();
  clearRaceAlertTimer();
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
  const layout = createLobbyLayout(currentRoom);
  shell.append(stage, createSystemHeader(`private channel / ${currentRoom.code}`), layout, createSystemFooter());
  root.append(createSkipLink(), shell);
  const lobbyScene = new LobbyWorldScene(stage, currentRoom.code);
  lobbyScene.updateActivity(
    currentRoom.players.length,
    currentRoom.players.filter((player) => player.ready).length
  );
  scene = lobbyScene;
}

function createLobbyLayout(room: Room): HTMLElement {
  const layout = el("section", "lobby-layout");
  const identity = el("header", "lobby-identity");
  identity.innerHTML = `
    <p class="eyebrow">Private channel established</p>
    <h1>Channel</h1>
    <p class="lobby-copy">Share this code with your crew. The host can launch when every incoming runner is synced.</p>
    <div class="code-block">
      <span>race access key</span>
      <div class="room-code" aria-label="Channel code ${room.code}">${room.code}</div>
    </div>
  `;

  const list = el("section", "player-list");
  list.setAttribute("aria-label", "Connected racers");
  const rosterHeader = el("header", "roster-head");
  rosterHeader.innerHTML = `
    <div><span>02 / active links</span><strong>Runner roster</strong></div>
    <span>${String(room.players.length).padStart(2, "0")} / 06</span>
  `;
  list.append(rosterHeader);
  room.players.forEach((player, index) => {
    const row = el("div", "player-row");
    const state = player.id === room.hostId ? "host" : player.ready ? "synced" : "standby";
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
  controlCopy.innerHTML = `<span>03 / race command</span><strong>${room.hostId === socket.id ? "Grid is under your control" : "Awaiting host launch"}</strong>`;
  controls.append(controlCopy);
  const me = room.players.find((player) => player.id === socket.id);
  const isHost = room.hostId === socket.id;
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
  return layout;
}

function refreshLobbyLayout(): void {
  if (!currentRoom) return;
  const existing = root.querySelector<HTMLElement>(".lobby-layout");
  if (!existing) {
    render();
    return;
  }
  existing.replaceWith(createLobbyLayout(currentRoom));
  if (scene instanceof LobbyWorldScene) {
    scene.updateActivity(
      currentRoom.players.length,
      currentRoom.players.filter((player) => player.ready).length
    );
  }
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
      <div class="meta-group"><span>match heat</span><strong>${currentRoom.heatNumber} / ${currentRoom.totalHeats}</strong></div>
      <div class="meta-group meta-live"><span>live telemetry</span><strong id="liveStats" aria-live="polite">0 WPM · 100% sync</strong></div>
      <div class="meta-group meta-flow"><span>flow chain</span><strong id="flowStats">0 streak · flow 0</strong></div>
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
    <section class="finish-watch" id="finishWatch" hidden aria-live="polite">
      <div><span>finish confirmed</span><strong id="finishPlace">Position pending</strong></div>
      <div><span>spectator feed</span><strong id="finishDeadline">Waiting for rivals</strong></div>
    </section>
    <div class="race-alert" id="raceAlert" hidden aria-live="assertive"></div>
  `;
  shell.append(stage, createSystemHeader("race feed / live"), overlay);
  root.append(createSkipLink(), shell);

  if (currentRoom.status === "countdown") {
    const countdown = el("div", "countdown-overlay");
    countdown.innerHTML = `<span>race link synchronized</span><strong id="countdownValue">3</strong><small>hold position</small>`;
    shell.append(countdown);
  }

  scene = new ThreeRaceScene(stage, socket.id);
  scene.updatePlayers(currentRoom.players);
  renderPassage();
  renderPlayerStrip();

  const input = document.querySelector<HTMLTextAreaElement>("#typingInput");
  if (input) input.disabled = currentRoom.status !== "racing";
  if (currentRoom.status === "countdown") startCountdown(currentRoom.startedAt ?? Date.now());
  else input?.focus();
  input?.addEventListener("input", () => {
    if (!currentRoom || !input || finished) return;
    const previousTypedText = typedText;
    typedText = input.value;
    recordNewKeystrokes(currentRoom.passage, previousTypedText, typedText);
    const correct = countCorrectPrefix(currentRoom.passage, typedText);
    const elapsed = Date.now() - raceStartMs;
    const payload = {
      progress: calculateProgress(currentRoom.passage, typedText),
      wpm: calculateWpm(correct, elapsed),
      accuracy: calculateKeystrokeAccuracy(keystrokeAttempts, mistakes),
      streak: currentStreak,
      flowLevel: calculateFlowLevel(currentStreak)
    };
    updateLiveStats(payload.wpm, payload.accuracy);
    updateFlowStats();
    checkFinalStretch(payload.progress);
    renderPassage();
    if (typedText.length > previousTypedText.length && scene instanceof ThreeRaceScene) {
      const typedCharIndex = typedText.length - 1;
      const correctChar = typedText[typedCharIndex] === currentRoom.passage[typedCharIndex];
      scene.emitTypingEffect(correctChar, payload.flowLevel);
      if (!correctChar) {
        scene.triggerStumble();
        showRaceAlert("SIGNAL BREAK // FLOW LOST", "error");
        pulseUi();
      }
    }
    if (payload.progress >= 1) {
      finished = true;
      if (scene instanceof ThreeRaceScene) scene.triggerFinishBurst();
      pulseUi();
      socket.emit("finishRace", { ...payload, finishedAt: Date.now() });
      input.disabled = true;
      updateFinishWatch();
    } else {
      socket.emit("updateProgress", payload);
    }
  });
}

function renderResults(): void {
  if (!currentRoom) return;
  const matchComplete = currentRoom.status === "finished";
  const shell = el("main", "results-shell");
  shell.id = "main-content";
  const resultsHeading = el("header", "results-heading");
  resultsHeading.innerHTML = `
    <p class="eyebrow">${matchComplete ? "Match complete" : `Heat ${currentRoom.heatNumber} complete`} / ${currentRoom.code}</p>
    <h1>Readout</h1>
    <p>${matchComplete ? "Final match standings across all three transmissions." : `Prepare for heat ${currentRoom.heatNumber + 1}. The next transmission increases in difficulty.`}</p>
  `;
  const table = el("section", "results-table");
  table.setAttribute("aria-label", "Race results");
  const tableHeader = el("div", "results-header");
  tableHeader.innerHTML = `<span>rank</span><span>runner</span><span>velocity</span><span>sync</span><span>points</span>`;
  table.append(tableHeader);
  const ranked = currentRoom.results.length > 0 ? currentRoom.results : currentRoom.players.map((player, index) => ({
    playerId: player.id,
    name: player.name,
    color: player.color,
    wpm: player.wpm,
    accuracy: player.accuracy,
    finishedAt: player.finishedAt ?? 0,
    place: index + 1,
    didFinish: player.finishedAt !== null,
    pointsAwarded: 0
  }));
  if (matchComplete) {
    const scores = new Map(currentRoom.players.map((player) => [player.id, player.score]));
    ranked.sort((left, right) =>
      (scores.get(right.playerId) ?? 0) - (scores.get(left.playerId) ?? 0) || left.place - right.place
    );
  }
  ranked.forEach((result, index) => {
    const rowClass = result.didFinish
      ? index === 0 ? "result-row winner-row" : "result-row"
      : "result-row dnf-row";
    const row = el("div", rowClass);
    row.style.setProperty("--player-color", result.color);
    row.innerHTML = `
      <span class="result-place">${matchComplete ? String(index + 1).padStart(2, "0") : result.didFinish ? String(result.place).padStart(2, "0") : "DNF"}</span>
      <span class="result-runner"><span class="swatch"></span><strong>${escapeHtml(result.name)}</strong>${index === 0 ? `<small>${matchComplete ? "match champion" : "heat leader"}</small>` : !result.didFinish ? "<small>signal timeout</small>" : matchComplete ? `<small>heat finish #${result.place}</small>` : ""}</span>
      <span class="result-metric"><small>velocity</small><strong>${result.didFinish ? result.wpm : "--"}</strong><em>WPM</em></span>
      <span class="result-metric result-sync"><small>sync</small><strong>${result.accuracy}</strong><em>%</em></span>
      <span class="result-metric result-points"><small>${matchComplete ? "total" : "awarded"}</small><strong>${matchComplete ? currentRoom!.players.find((player) => player.id === result.playerId)?.score ?? 0 : `+${result.pointsAwarded}`}</strong><em>PTS</em></span>
    `;
    table.append(row);
  });
  const actions = el("div", "result-actions");
  const actionCopy = el("div", "control-copy");
  actionCopy.innerHTML = `<span>next command</span><strong>${currentRoom.hostId === socket.id ? matchComplete ? "Run a new match" : `Launch heat ${currentRoom.heatNumber + 1} of ${currentRoom.totalHeats}` : "Wait for the host or disconnect"}</strong>`;
  actions.append(actionCopy);
  if (currentRoom.hostId === socket.id) {
    const restart = el("button", "primary", matchComplete ? "New Match" : "Next Heat");
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
  const rankedPlayers = rankPlayers(currentRoom);
  rankedPlayers.forEach((player, index) => {
    const item = el("div", "progress-item");
    const progress = Math.round(player.progress * 100);
    const ahead = rankedPlayers[index - 1];
    const gap = ahead
      ? Math.max(0, Math.ceil((ahead.progress - player.progress) * currentRoom!.passage.length))
      : 0;
    const gapLabel = player.finishedAt !== null
      ? "finished"
      : index === 0 ? "race leader" : `${gap} chars behind`;
    item.style.setProperty("--player-color", player.color);
    item.style.setProperty("--progress", `${progress}%`);
    item.innerHTML = `
      <span class="swatch"></span>
      <span class="lane-rank">#${index + 1}</span>
      <strong>${escapeHtml(player.name)}</strong>
      <span>${progress}%</span>
      <small>${gapLabel}</small>
      <span class="progress-track" aria-hidden="true"><i></i></span>
    `;
    item.setAttribute("aria-label", `${player.name}, position ${index + 1}, ${progress} percent complete, ${gapLabel}`);
    strip.append(item);
  });
}

function updateFinishWatch(): void {
  if (!finished || !currentRoom) return;
  const panel = document.querySelector<HTMLElement>("#finishWatch");
  if (!panel) return;
  panel.hidden = false;
  const myResult = currentRoom.results.find((result) => result.playerId === socket.id);
  const place = panel.querySelector<HTMLElement>("#finishPlace");
  if (place) place.textContent = myResult ? `Position #${myResult.place}` : "Position pending";

  const updateDeadline = (): void => {
    const deadline = panel.querySelector<HTMLElement>("#finishDeadline");
    if (!deadline || !currentRoom) return;
    if (currentRoom.finishDeadline === null) {
      deadline.textContent = "Waiting for rivals";
      return;
    }
    const seconds = Math.max(0, Math.ceil((currentRoom.finishDeadline - Date.now()) / 1000));
    deadline.textContent = `${seconds}s until grid closes`;
  };
  updateDeadline();
  if (finishWatchTimer === null) finishWatchTimer = window.setInterval(updateDeadline, 250);
}

function clearFinishWatchTimer(): void {
  if (finishWatchTimer === null) return;
  window.clearInterval(finishWatchTimer);
  finishWatchTimer = null;
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

function updateFlowStats(): void {
  const stats = document.querySelector<HTMLElement>("#flowStats");
  if (!stats) return;
  const flowLevel = calculateFlowLevel(currentStreak);
  stats.textContent = `${currentStreak} streak · flow ${flowLevel}`;
  stats.dataset.level = String(flowLevel);
  if (flowLevel > lastFlowLevel) {
    const labels = ["", "FLOW ONLINE", "FLOW SURGE", "MAXIMUM FLOW"];
    showRaceAlert(`${labels[flowLevel]} // ${currentStreak} STREAK`, "flow");
  }
  lastFlowLevel = flowLevel;
}

function recordNewKeystrokes(target: string, previous: string, next: string): void {
  if (next.length <= previous.length || !next.startsWith(previous)) return;
  for (let index = previous.length; index < next.length; index += 1) {
    keystrokeAttempts += 1;
    if (next[index] === target[index]) {
      currentStreak += 1;
      longestStreak = Math.max(longestStreak, currentStreak);
    } else {
      mistakes += 1;
      currentStreak = 0;
    }
  }
}

function resetRaceSession(startedAt: number): void {
  typedText = "";
  finished = false;
  raceStartMs = startedAt;
  keystrokeAttempts = 0;
  mistakes = 0;
  currentStreak = 0;
  longestStreak = 0;
  lastLocalRank = null;
  lastFlowLevel = 0;
  finalStretchAnnounced = false;
}

function rankPlayers(room: Room): Room["players"] {
  const resultPlaces = new Map(room.results.map((result) => [result.playerId, result.place]));
  return [...room.players].sort((left, right) => {
    const leftPlace = resultPlaces.get(left.id);
    const rightPlace = resultPlaces.get(right.id);
    if (leftPlace !== undefined || rightPlace !== undefined) {
      if (leftPlace === undefined) return 1;
      if (rightPlace === undefined) return -1;
      return leftPlace - rightPlace;
    }
    return right.progress - left.progress || right.wpm - left.wpm;
  });
}

function getLocalRank(room: Room): number | null {
  const index = rankPlayers(room).findIndex((player) => player.id === socket.id);
  return index < 0 ? null : index + 1;
}

function detectRaceMoments(room: Room): void {
  const nextRank = getLocalRank(room);
  if (nextRank === null) return;
  if (lastLocalRank !== null && nextRank < lastLocalRank) {
    showRaceAlert(`OVERTAKE // POSITION #${nextRank}`, "flow");
  } else if (lastLocalRank !== null && nextRank > lastLocalRank) {
    showRaceAlert(`RIVAL PASSED // POSITION #${nextRank}`, "error");
  }
  lastLocalRank = nextRank;
  const me = room.players.find((player) => player.id === socket.id);
  if (me) checkFinalStretch(me.progress);
}

function checkFinalStretch(progress: number): void {
  if (progress < 0.8 || finalStretchAnnounced) return;
  finalStretchAnnounced = true;
  showRaceAlert("FINAL STRETCH // HOLD THE LINE", "flow");
}

function showRaceAlert(message: string, tone: "flow" | "error"): void {
  const alert = document.querySelector<HTMLElement>("#raceAlert");
  if (!alert) return;
  if (raceAlertTimer !== null) window.clearTimeout(raceAlertTimer);
  alert.hidden = false;
  alert.dataset.tone = tone;
  alert.textContent = message;
  alert.classList.remove("is-active");
  void alert.offsetWidth;
  alert.classList.add("is-active");
  raceAlertTimer = window.setTimeout(() => {
    alert.hidden = true;
    raceAlertTimer = null;
  }, 1300);
}

function clearRaceAlertTimer(): void {
  if (raceAlertTimer === null) return;
  window.clearTimeout(raceAlertTimer);
  raceAlertTimer = null;
}

function startCountdown(startedAt: number): void {
  const update = (): void => {
    const value = document.querySelector<HTMLElement>("#countdownValue");
    if (!value) return;
    value.textContent = String(Math.max(1, Math.ceil((startedAt - Date.now()) / 1000)));
  };
  update();
  countdownTimer = window.setInterval(update, 100);
}

function clearCountdownTimer(): void {
  if (countdownTimer === null) return;
  window.clearInterval(countdownTimer);
  countdownTimer = null;
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
