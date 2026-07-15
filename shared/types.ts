export type RaceStatus = "lobby" | "countdown" | "racing" | "intermission" | "finished";

export interface Player {
  id: string;
  name: string;
  color: string;
  ready: boolean;
  progress: number;
  wpm: number;
  accuracy: number;
  finishedAt: number | null;
  score: number;
  streak: number;
  flowLevel: number;
}

export interface RaceResult {
  playerId: string;
  name: string;
  color: string;
  wpm: number;
  accuracy: number;
  finishedAt: number;
  place: number;
  didFinish: boolean;
  pointsAwarded: number;
}

export interface Room {
  code: string;
  hostId: string;
  players: Player[];
  status: RaceStatus;
  passage: string;
  startedAt: number | null;
  finishDeadline: number | null;
  heatNumber: number;
  totalHeats: number;
  results: RaceResult[];
}

export interface ProgressPayload {
  progress: number;
  wpm: number;
  accuracy: number;
  streak?: number;
  flowLevel?: number;
}

export interface FinishPayload extends ProgressPayload {
  finishedAt: number;
}

export interface ServerToClientEvents {
  roomState: (room: Room) => void;
  raceStarted: (room: Room) => void;
  progressUpdate: (room: Room) => void;
  raceFinished: (room: Room) => void;
  roomError: (message: string) => void;
}

export interface ClientToServerEvents {
  createRoom: (name: string) => void;
  joinRoom: (payload: { code: string; name: string }) => void;
  setReady: (ready: boolean) => void;
  startRace: () => void;
  updateProgress: (payload: ProgressPayload) => void;
  finishRace: (payload: FinishPayload) => void;
  leaveRoom: () => void;
}
