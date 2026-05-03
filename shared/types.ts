export type RaceStatus = "lobby" | "countdown" | "racing" | "finished";

export interface Player {
  id: string;
  name: string;
  color: string;
  ready: boolean;
  progress: number;
  wpm: number;
  accuracy: number;
  finishedAt: number | null;
}

export interface RaceResult {
  playerId: string;
  name: string;
  color: string;
  wpm: number;
  accuracy: number;
  finishedAt: number;
  place: number;
}

export interface Room {
  code: string;
  hostId: string;
  players: Player[];
  status: RaceStatus;
  passage: string;
  startedAt: number | null;
  results: RaceResult[];
}

export interface ProgressPayload {
  progress: number;
  wpm: number;
  accuracy: number;
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
