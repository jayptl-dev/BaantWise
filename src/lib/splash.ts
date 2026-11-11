// The splash screen: the receipt that draws itself and tears in two while the app
// starts. Its markup and styles are in index.html so it shows before any of this
// code has loaded; this file only decides when the name appears and when the
// splash goes away.
//
// - The receipt starts drawing by itself (plain CSS).
// - The name is written in once the pen typeface has loaded (so it never appears
//   in the wrong lettering), and no earlier than 0.7s in.
// - The splash leaves when BOTH the animation has finished and the app knows who
//   is signed in. So it covers real waiting and never adds more than about 1.3s.
// - Later page loads in the same tab (for example coming back from Google sign-in)
//   and phones set to reduce motion get the still picture with no minimum wait.

const SEEN_KEY = "baantwise-splash-seen";
const NAME_AT_MS = 700; // when the receipt has finished tearing
const NAME_TAKES_MS = 600; // the name writing in, plus its underline
const FONT_PATIENCE_MS = 800; // how long to wait for the pen typeface before going ahead anyway

let appReady = false;
let nameShownAt: number | null = null;
let leaving = false;

const splash = () => document.getElementById("splash");
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function isQuick(): boolean {
  return (
    document.documentElement.classList.contains("splash-quick") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function leaveWhenDone() {
  const element = splash();
  if (!element || leaving || !appReady || nameShownAt === null) return;
  leaving = true;
  const wait = isQuick() ? 0 : Math.max(0, nameShownAt + NAME_TAKES_MS - performance.now());
  window.setTimeout(() => {
    element.classList.add("done");
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Private browsing can refuse storage; the splash just plays again next time.
    }
    window.setTimeout(() => element.remove(), 300);
  }, wait);
}

// Called once when the app's code starts (main.tsx).
export function beginSplash() {
  const element = splash();
  if (!element) return;
  const showName = () => {
    if (nameShownAt !== null) return;
    element.classList.add("named");
    nameShownAt = performance.now();
    leaveWhenDone();
  };
  if (isQuick()) return showName();
  const tearDone = sleep(Math.max(0, NAME_AT_MS - performance.now()));
  const penReady = document.fonts
    ? Promise.race([document.fonts.load('800 1em "Shantell Sans Variable"'), sleep(NAME_AT_MS + FONT_PATIENCE_MS)])
    : Promise.resolve();
  void Promise.all([tearDone, penReady]).then(showName, showName);
}

// Called when the app knows whether someone is signed in, so there's a real screen to show.
export function finishSplash() {
  appReady = true;
  leaveWhenDone();
}
