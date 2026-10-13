import { describe, expect, it } from "vitest";
import { hasSeenTour, markTourSeen, TOUR_KEY, TOUR_STEPS } from "./tour";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("welcome tour", () => {
  it("shows once per account, then is remembered", () => {
    const store = memoryStore();
    expect(hasSeenTour("jay", store)).toBe(false);
    markTourSeen("jay", store);
    expect(hasSeenTour("jay", store)).toBe(true);
    // A new account on the same phone still gets it.
    expect(hasSeenTour("new-account", store)).toBe(false);
  });

  it("gives the old whole-browser note to the first account only", () => {
    const store = memoryStore();
    store.setItem(TOUR_KEY, "1");
    expect(hasSeenTour("jay", store)).toBe(true);
    expect(store.data.has(TOUR_KEY)).toBe(false);
    expect(hasSeenTour("someone-else", store)).toBe(false);
  });

  it("stays out of the way when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(hasSeenTour("jay", blocked)).toBe(true);
    expect(() => markTourSeen("jay", blocked)).not.toThrow();
  });

  it("keeps every card short enough for a phone", () => {
    for (const step of TOUR_STEPS) expect(step.text.length).toBeLessThanOrEqual(240);
  });
});
