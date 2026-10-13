import { describe, expect, it } from "vitest";
import { hasSeenTour, markTourSeen, TOUR_STEPS } from "./tour";

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("welcome tour", () => {
  it("shows once, then is remembered", () => {
    const store = memoryStore();
    expect(hasSeenTour(store)).toBe(false);
    markTourSeen(store);
    expect(hasSeenTour(store)).toBe(true);
  });

  it("stays out of the way when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(hasSeenTour(blocked)).toBe(true);
    expect(() => markTourSeen(blocked)).not.toThrow();
  });

  it("keeps every card short enough for a phone", () => {
    for (const step of TOUR_STEPS) expect(step.text.length).toBeLessThanOrEqual(240);
  });
});
