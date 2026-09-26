import { describe, expect, it } from "vitest";
import { makeNonce, sha256Hex } from "./googleSignIn";

describe("sha256Hex", () => {
  it("matches the standard SHA-256 test value", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("makeNonce", () => {
  it("gives Google the SHA-256 hash of the raw nonce that Supabase gets", async () => {
    const { raw, hashed } = await makeNonce();
    expect(hashed).toBe(await sha256Hex(raw));
  });

  it("makes a long random raw nonce", async () => {
    const { raw } = await makeNonce();
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never repeats", async () => {
    const first = await makeNonce();
    const second = await makeNonce();
    expect(first.raw).not.toBe(second.raw);
  });
});
