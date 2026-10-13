import { describe, expect, it } from "vitest";
import { normalizeUsername } from "./friends";

describe("usernames", () => {
  it("tidies what people type", () => {
    expect(normalizeUsername("@Shreya.K ")).toBe("shreya.k");
    expect(normalizeUsername("jay_patel7")).toBe("jay_patel7");
  });

  it("matches the database rule", () => {
    expect(normalizeUsername("ab")).toBeNull(); // too short
    expect(normalizeUsername("a".repeat(21))).toBeNull(); // too long
    expect(normalizeUsername(".jay")).toBeNull(); // must start with a letter or number
    expect(normalizeUsername("jay patel")).toBeNull(); // no spaces
    expect(normalizeUsername("jay-patel")).toBeNull(); // no dashes
  });
});
