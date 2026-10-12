import { describe, expect, it } from "vitest";
import { DEFAULT_PALETTE, readPalette, savePalette, STORAGE_KEY } from "./palette";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("palette", () => {
  it("starts on Autumn", () => {
    expect(DEFAULT_PALETTE).toBe("autumn");
    expect(readPalette(memoryStore())).toBe("autumn");
  });

  it("remembers another look and forgets it when going back to the default", () => {
    const store = memoryStore();
    savePalette("teal", store);
    expect(readPalette(store)).toBe("teal");
    savePalette("autumn", store);
    expect(store.data.has(STORAGE_KEY)).toBe(false);
    expect(readPalette(store)).toBe("autumn");
  });

  it("ignores unknown saved values and blocked storage", () => {
    const store = memoryStore();
    store.setItem(STORAGE_KEY, "neon");
    expect(readPalette(store)).toBe("autumn");
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
    expect(readPalette(blocked)).toBe("autumn");
    expect(() => savePalette("teal", blocked)).not.toThrow();
  });
});
