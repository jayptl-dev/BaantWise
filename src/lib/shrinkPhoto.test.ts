import { describe, expect, it } from "vitest";
import {
  encodeWithinLimits,
  exifSegment,
  fitWithin,
  KB,
  MAX_BYTES,
  photoTypeProblem,
  PhotoProblem,
  readExifOrientation,
} from "./shrinkPhoto";

// A pretend JPEG maker: returns a "file" of the size `sizeFor` says, and remembers
// every (size, quality) it was asked for.
function fakeEncoder(sizeFor: (maxSide: number, quality: number) => number) {
  const calls: string[] = [];
  const encode = async (maxSide: number, quality: number) => {
    calls.push(`${maxSide}@${quality}`);
    return { size: sizeFor(maxSide, quality) } as Blob;
  };
  return { encode, calls };
}

describe("photoTypeProblem", () => {
  it("accepts photos", () => {
    expect(photoTypeProblem("image/jpeg", "a.jpg")).toBeNull();
    expect(photoTypeProblem("image/png", "a.png")).toBeNull();
    expect(photoTypeProblem("image/heic", "IMG_1.HEIC")).toBeNull();
    expect(photoTypeProblem("", "IMG_1.jpeg")).toBeNull(); // some phones give no type
  });

  it("refuses anything else with a plain message", () => {
    expect(photoTypeProblem("application/pdf", "receipt.pdf")).toMatch(/isn't a photo/);
    expect(photoTypeProblem("text/plain", "notes.txt")).toMatch(/isn't a photo/);
    expect(photoTypeProblem("image/svg+xml", "logo.svg")).toMatch(/isn't a photo/);
    expect(photoTypeProblem("", "receipt.pdf")).toMatch(/isn't a photo/);
  });
});

describe("fitWithin", () => {
  it("shrinks the longest side to the limit", () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(1000, 4000, 2000)).toEqual({ width: 500, height: 2000 });
    expect(fitWithin(4000, 4000, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it("never makes a small photo bigger", () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });
});

describe("readExifOrientation", () => {
  const soi = [0xff, 0xd8];
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const sos = [0xff, 0xda, 0x00, 0x02];

  it("reads a big-endian orientation", () => {
    const bytes = new Uint8Array([...soi, ...exifSegment(6), ...sos]);
    expect(readExifOrientation(bytes)).toBe(6);
  });

  it("finds it after other blocks", () => {
    const bytes = new Uint8Array([...soi, ...app0, ...exifSegment(8), ...sos]);
    expect(readExifOrientation(bytes)).toBe(8);
  });

  it("reads a little-endian orientation", () => {
    const little = [
      0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
      0x01, 0x00,
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ];
    expect(readExifOrientation(new Uint8Array([...soi, ...little, ...sos]))).toBe(3);
  });

  it("says upright for anything else", () => {
    expect(readExifOrientation(new Uint8Array([...soi, ...app0, ...sos]))).toBe(1);
    expect(readExifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1); // a PNG
    expect(readExifOrientation(new Uint8Array([]))).toBe(1);
    expect(readExifOrientation(new Uint8Array([...soi, 0xff, 0xe1, 0x00]))).toBe(1); // cut short
    expect(readExifOrientation(new Uint8Array([...soi, ...exifSegment(6)]).slice(0, 25))).toBe(1);
  });
});

describe("encodeWithinLimits", () => {
  it("stops at the first quality that's 500 KB or less", async () => {
    const { encode, calls } = fakeEncoder((_, q) => (q >= 0.8 ? 700 * KB : 450 * KB));
    const blob = await encodeWithinLimits(encode);
    expect(blob.size).toBe(450 * KB);
    expect(calls).toEqual(["2000@0.8", "2000@0.7"]);
  });

  it("keeps 2000px when the lowest quality is between 500 and 900 KB", async () => {
    const { encode, calls } = fakeEncoder(() => 800 * KB);
    const blob = await encodeWithinLimits(encode);
    expect(blob.size).toBe(800 * KB);
    expect(calls).toEqual(["2000@0.8", "2000@0.7", "2000@0.6", "2000@0.5"]);
  });

  it("redoes it at 1600px when still over 900 KB", async () => {
    const { encode, calls } = fakeEncoder((side, q) => (side === 2000 ? 950 * KB : q >= 0.7 ? 600 * KB : 480 * KB));
    const blob = await encodeWithinLimits(encode);
    expect(blob.size).toBe(480 * KB);
    expect(calls).toEqual(["2000@0.8", "2000@0.7", "2000@0.6", "2000@0.5", "1600@0.8", "1600@0.7", "1600@0.6"]);
  });

  it("never returns anything over 1 MB", async () => {
    const { encode } = fakeEncoder(() => MAX_BYTES + 1);
    await expect(encodeWithinLimits(encode)).rejects.toBeInstanceOf(PhotoProblem);
  });

  it("allows exactly 1 MB", async () => {
    const { encode } = fakeEncoder(() => MAX_BYTES);
    expect((await encodeWithinLimits(encode)).size).toBe(MAX_BYTES);
  });
});
