// The app's look ("palette"): its colours, chosen in Profile and saved in this browser
// only (nothing goes to the database). Autumn is Baantwise's own look and the default.
//
// To add a look (say, a winter one): add it to PALETTES, then give it a colour block
// in index.css under :root[data-palette="<key>"] (light) and the same inside the
// prefers-color-scheme: dark block. index.html applies the saved look before the page
// paints, so keep STORAGE_KEY and the attribute name in step with the script there.

export const PALETTES = [
  { key: "autumn", label: "Autumn", note: "Rust, evergreen and birch. The Baantwise look." },
  { key: "teal", label: "Teal", note: "Calm teal and cool grey." },
] as const;

export type PaletteKey = (typeof PALETTES)[number]["key"];

export const DEFAULT_PALETTE: PaletteKey = "autumn";
export const STORAGE_KEY = "baantwise-palette";

// The colour the phone paints around the page (address bar, status bar), per look.
const THEME_COLORS: Record<PaletteKey, { light: string; dark: string }> = {
  autumn: { light: "#f4eee6", dark: "#17120f" },
  teal: { light: "#eef3f1", dark: "#0f1716" },
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function isPalette(value: unknown): value is PaletteKey {
  return PALETTES.some((p) => p.key === value);
}

// The saved look, or the default. Private windows and blocked storage can throw.
export function readPalette(store: Store | undefined = safeStorage()): PaletteKey {
  try {
    const saved = store?.getItem(STORAGE_KEY);
    return isPalette(saved) ? saved : DEFAULT_PALETTE;
  } catch {
    return DEFAULT_PALETTE;
  }
}

// Saves the look (the default is saved as "nothing", so a future default change reaches it).
export function savePalette(key: PaletteKey, store: Store | undefined = safeStorage()) {
  try {
    if (key === DEFAULT_PALETTE) store?.removeItem(STORAGE_KEY);
    else store?.setItem(STORAGE_KEY, key);
  } catch {
    // Can't save here (private window): the look still changes until the page closes.
  }
}

// Switches the page to a look right away.
export function applyPalette(key: PaletteKey) {
  const root = document.documentElement;
  if (key === DEFAULT_PALETTE) delete root.dataset.palette;
  else root.dataset.palette = key;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = meta.media.includes("dark") ? THEME_COLORS[key].dark : THEME_COLORS[key].light;
  }
}

function safeStorage(): Store | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
