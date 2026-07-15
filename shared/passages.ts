export type PassageDifficulty = "easy" | "medium" | "hard";

export interface PassageEntry {
  difficulty: PassageDifficulty;
  text: string;
}

export const PASSAGE_ENTRIES: PassageEntry[] = [
  { difficulty: "easy", text: "Smooth inputs and steady breathing keep a fast machine under control." },
  { difficulty: "easy", text: "Every clean word brings the next checkpoint a little closer." },
  { difficulty: "easy", text: "Look ahead, trust your rhythm, and let the speed build naturally." },
  { difficulty: "easy", text: "Quick hands can win a sprint, but calm hands finish every race." },
  { difficulty: "easy", text: "The green lights sweep past as six bright runners enter the final turn." },
  { difficulty: "easy", text: "Find the pace that feels easy, then hold it all the way home." },
  { difficulty: "medium", text: "Three quick laps prove steady hands and clean rhythm beat frantic bursts every time." },
  { difficulty: "medium", text: "The best racers watch the road ahead while their fingers keep a calm, even cadence." },
  { difficulty: "medium", text: "Small mistakes cost speed, but patient correction keeps the finish line close." },
  { difficulty: "medium", text: "At checkpoint seven, the leader hesitated; two rivals immediately swept past." },
  { difficulty: "medium", text: "A perfect launch means little if your rhythm breaks halfway through the circuit." },
  { difficulty: "medium", text: "Stay loose through the corners, accelerate on each clean word, and never chase a mistake." },
  { difficulty: "hard", text: "Sector 9 opens at 06:45; hit 98% accuracy before the signal switches." },
  { difficulty: "hard", text: "The engineer warned, \"Boost is finite--precision isn't,\" before closing the channel." },
  { difficulty: "hard", text: "Vector-12 changed lanes twice, recovered from a 0.8-second delay, and won by 3%." },
  { difficulty: "hard", text: "Can a 72-WPM racer hold formation through rain, glare, crosswinds, and grid-lock?" },
  { difficulty: "hard", text: "Input sequence: K-7, apex_left, 40%, then release the clutch at exactly 2,400 RPM." },
  { difficulty: "hard", text: "Risk rises quickly after 110 WPM: breathe, reset, and choose accuracy over panic." }
];

export const PASSAGES = PASSAGE_ENTRIES.map((entry) => entry.text);

export function selectPassage(
  seed: number = Date.now(),
  difficulty?: PassageDifficulty
): string {
  const pool = difficulty
    ? PASSAGE_ENTRIES.filter((entry) => entry.difficulty === difficulty).map((entry) => entry.text)
    : PASSAGES;
  return pool[Math.abs(seed) % pool.length];
}

export function difficultyForHeat(heatNumber: number): PassageDifficulty {
  if (heatNumber <= 1) return "easy";
  if (heatNumber === 2) return "medium";
  return "hard";
}
