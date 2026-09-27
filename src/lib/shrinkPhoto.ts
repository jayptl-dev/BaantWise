// Turns a photo from the camera or gallery into a small, upright JPEG before it
// leaves the phone. Used for receipt photos now, and later for receipt scanning.
//
// How: draw it onto a canvas (turned upright if the photo's EXIF data says it was
// taken sideways), longest side at most 2000px (tall receipts need the pixels),
// then save as JPEG at quality 0.8, 0.7, 0.6, 0.5 until it's 500 KB or less. If
// it's still over 900 KB, do it again at 1600px. Nothing over 1 MB is ever
// returned. Re-drawing it also drops the EXIF data, including where it was taken.

export const KB = 1024;
export const TARGET_BYTES = 500 * KB; // good enough: stop here
export const REDO_BYTES = 900 * KB; // over this after all the qualities: try a smaller size
export const MAX_BYTES = 1024 * KB; // the receipts bucket refuses anything bigger
export const LONGEST_SIDE = 2000;
export const SMALLER_SIDE = 1600;
export const QUALITIES = [0.8, 0.7, 0.6, 0.5];
const MAX_INPUT_BYTES = 50 * KB * KB; // a photo this big would be too slow to open on a phone

// A problem with the chosen photo, already in plain words for the screen.
export class PhotoProblem extends Error {}

const PHOTO_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif|avif)$/i;

// Why this file can't be used as a photo, or null if it looks fine. Some phones
// give no type at all, so the file name is checked too.
export function photoTypeProblem(type: string, name: string): string | null {
  const photoType = type.startsWith("image/") && type !== "image/svg+xml";
  if (photoType || (type === "" && PHOTO_EXTENSIONS.test(name))) return null;
  return "That file isn't a photo. Choose a picture, like a JPG or PNG.";
}

// The size to draw at: the longest side at most `maxSide`, never made bigger.
export function fitWithin(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Which way up a JPEG was taken (EXIF "Orientation", 1 to 8), read from its first
// bytes. 1 means upright, and is also the answer for anything that isn't a JPEG
// or has no orientation. Never throws.
export function readExifOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return 1; // not a marker, or the picture itself starts
    const length = view.getUint16(offset + 2);
    const start = offset + 4;
    const isExif =
      marker === 0xffe1 &&
      start + 6 <= view.byteLength &&
      view.getUint32(start) === 0x45786966 && // "Exif"
      view.getUint16(start + 4) === 0;
    if (isExif) return orientationFromTiff(view, start + 6);
    offset += 2 + length;
  }
  return 1;
}

function orientationFromTiff(view: DataView, tiff: number): number {
  if (tiff + 8 > view.byteLength) return 1;
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return 1;
  const little = order === 0x4949; // "II" = little-endian, "MM" = big-endian
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > view.byteLength) return 1;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) return 1;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

// A JPEG maker: `encode(maxSide, quality)` draws the photo at that size and saves it.
export type Encode = (maxSide: number, quality: number) => Promise<Blob>;

// The size rules above, separate from the drawing so they can be tested.
export async function encodeWithinLimits(encode: Encode): Promise<Blob> {
  let blob = await tryQualities(encode, LONGEST_SIDE);
  if (blob.size > REDO_BYTES) blob = await tryQualities(encode, SMALLER_SIDE);
  if (blob.size > MAX_BYTES) {
    throw new PhotoProblem("That photo is too detailed to send, even after shrinking it. Try another photo.");
  }
  return blob;
}

async function tryQualities(encode: Encode, maxSide: number): Promise<Blob> {
  let blob: Blob | undefined;
  for (const quality of QUALITIES) {
    blob = await encode(maxSide, quality);
    if (blob.size <= TARGET_BYTES) break;
  }
  return blob!;
}

// The whole job: check the file, open it, and return a small upright JPEG.
// Throws PhotoProblem with a plain message if it can't.
export async function shrinkPhoto(file: File): Promise<Blob> {
  const typeProblem = photoTypeProblem(file.type, file.name);
  if (typeProblem) throw new PhotoProblem(typeProblem);
  if (file.size > MAX_INPUT_BYTES) throw new PhotoProblem("That photo is too big to open. Choose a smaller one.");

  const [image, orientation] = await Promise.all([
    openImage(file),
    file
      .slice(0, 256 * KB)
      .arrayBuffer()
      .then((buffer) => readExifOrientation(new Uint8Array(buffer)))
      .catch(() => 1),
  ]);
  // Most browsers already turn the photo upright when opening it; only turn it
  // ourselves if this one doesn't.
  const turn = orientation > 1 && !(await browserTurnsPhotos()) ? orientation : 1;

  const canvases = new Map<number, HTMLCanvasElement>();
  try {
    return await encodeWithinLimits((maxSide, quality) => {
      let canvas = canvases.get(maxSide);
      if (!canvas) {
        canvas = drawUpright(image, turn, maxSide);
        canvases.set(maxSide, canvas);
      }
      return toJpeg(canvas, quality);
    });
  } finally {
    // Let the phone free the memory straight away.
    for (const canvas of canvases.values()) canvas.width = canvas.height = 0;
  }
}

async function openImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("empty image");
    return image;
  } catch {
    throw new PhotoProblem("We couldn't open that photo. Try taking it again, or choose a JPG or PNG.");
  } finally {
    // The decoded picture stays usable after this.
    URL.revokeObjectURL(url);
  }
}

// Draws the photo upright on a new canvas, longest side at most `maxSide`.
// `turn` is the EXIF orientation still to apply (1 = already upright).
function drawUpright(image: HTMLImageElement, turn: number, maxSide: number): HTMLCanvasElement {
  const sideways = turn >= 5; // 5 to 8 swap width and height
  const upright = sideways
    ? fitWithin(image.naturalHeight, image.naturalWidth, maxSide)
    : fitWithin(image.naturalWidth, image.naturalHeight, maxSide);
  // The size to draw the photo at, as it's stored (before turning).
  const width = sideways ? upright.height : upright.width;
  const height = sideways ? upright.width : upright.height;

  const canvas = document.createElement("canvas");
  canvas.width = upright.width;
  canvas.height = upright.height;
  const context = canvas.getContext("2d");
  if (!context) throw new PhotoProblem("This browser can't prepare photos. Try another browser.");
  // JPEG has no see-through parts, so a see-through PNG gets a white background.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  switch (turn) {
    case 2: context.transform(-1, 0, 0, 1, width, 0); break;
    case 3: context.transform(-1, 0, 0, -1, width, height); break;
    case 4: context.transform(1, 0, 0, -1, 0, height); break;
    case 5: context.transform(0, 1, 1, 0, 0, 0); break;
    case 6: context.transform(0, 1, -1, 0, height, 0); break;
    case 7: context.transform(0, -1, -1, 0, height, width); break;
    case 8: context.transform(0, -1, 1, 0, 0, width); break;
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob && blob.type === "image/jpeg") resolve(blob);
        else reject(new PhotoProblem("This browser can't prepare photos. Try another browser."));
      },
      "image/jpeg",
      quality,
    );
  });
}

// Whether this browser turns photos upright by itself when opening them. Checked
// once, with a tiny 2×1 JPEG marked "turned 90°": if it opens as 1×2, it does.
let turnsPhotos: Promise<boolean> | undefined;
function browserTurnsPhotos(): Promise<boolean> {
  turnsPhotos ??= (async () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 1;
      const plain = new Uint8Array(await (await toJpeg(canvas, 0.9)).arrayBuffer());
      const turned = new Blob([plain.slice(0, 2), exifSegment(6), plain.slice(2)], { type: "image/jpeg" });
      const image = await openImage(turned);
      return image.naturalWidth === 1;
    } catch {
      return true; // every current browser does
    }
  })();
  return turnsPhotos;
}

// A minimal EXIF block that only says which way up the photo is.
export function exifSegment(orientation: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff, 0xe1, 0x00, 0x22, // APP1 marker, then its length (34 bytes)
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif" and two zero bytes
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF header, first list at byte 8
    0x00, 0x01, // one entry:
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation
    0x00, 0x00, 0x00, 0x00, // no more lists
  ]);
}
