export const PASSAGES = [
  "Three quick laps prove steady hands and clean rhythm beat frantic bursts every time.",
  "The best racers watch the road ahead while their fingers keep a calm and even cadence.",
  "Small mistakes cost speed, but patient correction keeps the finish line close."
];

export function selectPassage(seed: number = Date.now()): string {
  return PASSAGES[Math.abs(seed) % PASSAGES.length];
}
