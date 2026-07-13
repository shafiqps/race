export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function calculateAccuracy(target: string, typed: string): number {
  if (typed.length === 0) return 100;
  let correct = 0;
  for (let index = 0; index < typed.length; index += 1) {
    if (typed[index] === target[index]) correct += 1;
  }
  return Math.round((correct / typed.length) * 1000) / 10;
}

export function calculateKeystrokeAccuracy(attempts: number, mistakes: number): number {
  if (attempts <= 0) return 100;
  const safeMistakes = Math.max(0, Math.min(attempts, mistakes));
  return Math.round(((attempts - safeMistakes) / attempts) * 1000) / 10;
}

export function calculateFlowLevel(streak: number): number {
  if (streak >= 50) return 3;
  if (streak >= 25) return 2;
  if (streak >= 10) return 1;
  return 0;
}

export function calculateProgress(target: string, typed: string): number {
  if (target.length === 0) return 0;
  let matchingPrefix = 0;
  while (matchingPrefix < typed.length && typed[matchingPrefix] === target[matchingPrefix]) {
    matchingPrefix += 1;
  }
  return clampProgress(matchingPrefix / target.length);
}

export function calculateWpm(correctChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  const minutes = elapsedMs / 60000;
  return Math.max(0, Math.round((correctChars / 5 / minutes) * 10) / 10);
}

export function countCorrectPrefix(target: string, typed: string): number {
  let count = 0;
  while (count < typed.length && typed[count] === target[count]) count += 1;
  return count;
}
