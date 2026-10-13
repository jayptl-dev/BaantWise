// The welcome tour: a few pop-up cards that explain what Baantwise does, shown once
// to someone new (remembered in this browser only), and again from Profile.

export const TOUR_KEY = "baantwise-tour-seen";
// Fired by Profile → "Show the welcome tour again"; AppLayout listens for it.
export const SHOW_TOUR_EVENT = "baantwise:show-tour";

export type TourStep = { emoji: string; title: string; text: string };

export const TOUR_STEPS: TourStep[] = [
  {
    emoji: "👋",
    title: "Welcome to Baantwise",
    text: "Split bills with the people you live, travel or eat with. It's free, with no ads. Here's what everything does, in under a minute.",
  },
  {
    emoji: "🏠",
    title: "Groups",
    text: "Make a group for your home, a trip or a night out, and share the invite link so others can join. Just looking? Tap Try a sample group to play with a pretend house first.",
  },
  {
    emoji: "➕",
    title: "Add an expense",
    text: "Tap Add expense, type what it was for and how much. Split it equally, by exact amounts, by percent or by shares. Choose who can see it: the whole group, or only the people in it.",
  },
  {
    emoji: "🧾",
    title: "Scan a receipt",
    text: "Take a photo of a receipt and Baantwise fills in the amount and the items. Then split it item by item, so everyone pays for what they had.",
  },
  {
    emoji: "⚖️",
    title: "Who owes whom",
    text: "The slip at the top of each group shows what you're owed or what you owe. Baantwise works out the fewest payments to settle up. When someone pays, tap Pay or Received. Baantwise never touches real money.",
  },
  {
    emoji: "📧",
    title: "Bills that fill themselves in",
    text: "Forward a bill email, like hydro or internet, to your group's bill address and Baantwise reads the amount for you. Rent and other repeating bills can add themselves with Recurring.",
  },
  {
    emoji: "🙋",
    title: "Your profile",
    text: "Add your Interac e-Transfer or PayPal.Me so friends can pay you back in one tap, and pick a look you like. You can see this tour again there anytime.",
  },
  {
    emoji: "📲",
    title: "Put it on your home screen",
    text: "Open Baantwise like an app. iPhone: in Safari, tap Share, then Add to Home Screen. Android: in Chrome, tap ⋮ (top right), then Install app or Add to Home screen.",
  },
];

type Store = Pick<Storage, "getItem" | "setItem">;

export function hasSeenTour(store: Store | undefined = safeStorage()): boolean {
  try {
    // If storage can't be read, don't keep showing the tour on every page.
    return store ? store.getItem(TOUR_KEY) === "1" : true;
  } catch {
    return true;
  }
}

export function markTourSeen(store: Store | undefined = safeStorage()) {
  try {
    store?.setItem(TOUR_KEY, "1");
  } catch {
    // Private window: it just shows once per visit.
  }
}

function safeStorage(): Store | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
