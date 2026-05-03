import { describe, expect, it } from "vitest";
import {
  calculateAccuracy,
  calculateProgress,
  calculateWpm,
  clampProgress,
  countCorrectPrefix
} from "../src/game/typingStats";

describe("typing stats", () => {
  it("clamps progress", () => {
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(0.42)).toBe(0.42);
    expect(clampProgress(2)).toBe(1);
    expect(clampProgress(Number.NaN)).toBe(0);
  });

  it("calculates accuracy against target text", () => {
    expect(calculateAccuracy("abcd", "")).toBe(100);
    expect(calculateAccuracy("abcd", "abxd")).toBe(75);
    expect(calculateAccuracy("abcd", "ab")).toBe(100);
  });

  it("tracks only the correct prefix for progress", () => {
    expect(calculateProgress("abcdef", "abc")).toBe(0.5);
    expect(calculateProgress("abcdef", "abxdef")).toBeCloseTo(2 / 6);
    expect(countCorrectPrefix("abcdef", "abxdef")).toBe(2);
  });

  it("calculates WPM from correct characters and elapsed time", () => {
    expect(calculateWpm(25, 60000)).toBe(5);
    expect(calculateWpm(50, 30000)).toBe(20);
    expect(calculateWpm(50, 0)).toBe(0);
  });
});
