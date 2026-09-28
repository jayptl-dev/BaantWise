// The fixed list of expense categories, in the order the picker shows them.
// The database only accepts these keys (a check on expenses.category), so the two
// must stay in step. Charts and receipt scanning use this same list.
export const CATEGORIES = [
  { key: "food", emoji: "🍔", label: "Food" },
  { key: "groceries", emoji: "🛒", label: "Groceries" },
  { key: "transport", emoji: "🚕", label: "Transport" },
  { key: "housing", emoji: "🏠", label: "Housing" },
  { key: "utilities", emoji: "💡", label: "Utilities" },
  { key: "entertainment", emoji: "🎬", label: "Entertainment" },
  { key: "travel", emoji: "✈️", label: "Travel" },
  { key: "shopping", emoji: "🛍️", label: "Shopping" },
  { key: "health", emoji: "🏥", label: "Health" },
  { key: "other", emoji: "📌", label: "Other" },
] as const;

export type Category = (typeof CATEGORIES)[number];
export type CategoryKey = Category["key"];

// What a new expense gets when nothing else fits (the database's default too).
export const DEFAULT_CATEGORY: CategoryKey = "other";

export function isCategoryKey(value: unknown): value is CategoryKey {
  return CATEGORIES.some((c) => c.key === value);
}

// The category for a key from the database, or Other if it's missing or unknown.
export function categoryFor(key: string | null | undefined): Category {
  return CATEGORIES.find((c) => c.key === key) ?? categoryFor(DEFAULT_CATEGORY);
}

// Words and short phrases (up to 3 words) that suggest a category. To add one, put it
// in the right list: capitals, accents and apostrophes don't matter ("Tim Horton's" is
// the same as "tim hortons"). A plural ending in "s" is found from its singular, so
// "pizza" also covers "pizzas". Leave out words that could mean two categories,
// like "metro", "subway", "ticket", "phone", "insurance", "bill" or "water" on their own.
export const CATEGORY_KEYWORDS: Record<CategoryKey, readonly string[]> = {
  food: [
    "food", "meal", "lunch", "dinner", "supper", "breakfast", "brunch", "snack", "catering",
    "coffee", "cafe", "tea", "latte", "espresso", "smoothie", "bubble tea", "boba",
    "restaurant", "resto", "diner", "bistro", "cafeteria",
    "pizza", "pizzeria", "burger", "sushi", "shawarma", "pho", "ramen", "taco", "burrito",
    "poutine", "sandwich", "bagel", "noodles", "dumplings", "dim sum", "bbq", "barbecue",
    "wings", "fries", "dessert", "ice cream", "gelato", "cupcake", "bakery", "donut", "doughnut",
    "bar", "pub", "brewery", "happy hour", "drink", "drinks", "cocktail", "beer", "wine",
    "lcbo", "saq", "beer store", "liquor store",
    "takeout", "take out", "delivery", "doordash", "skip the dishes", "skipthedishes",
    "uber eats", "ubereats",
    "mcdonalds", "mcdo", "tim hortons", "timmies", "tims", "starbucks", "second cup",
    "harveys", "wendys", "kfc", "popeyes", "burger king", "dairy queen", "five guys",
    "mary browns", "taco bell", "chick fil a", "pizza pizza", "pizza hut", "dominos",
    "swiss chalet", "st hubert", "boston pizza", "the keg", "kelseys", "montanas",
    "east side marios", "jack astors", "cactus club", "chipotle", "osmows", "mr sub",
    "quiznos", "freshii", "booster juice",
    "repas", "souper", "dejeuner", "bouffe", "boulangerie", "patisserie", "brasserie", "biere",
  ],
  groceries: [
    "grocery", "groceries", "grocer", "supermarket", "produce", "farmers market", "butcher",
    "milk", "eggs", "bread", "fruit", "vegetables", "veggies", "meat", "bulk barn", "instacart",
    "no frills", "nofrills", "loblaws", "sobeys", "freshco", "food basics", "costco",
    "superstore", "farm boy", "longos", "whole foods", "safeway", "save on foods",
    "thrifty foods", "fortinos", "zehrs", "valu mart", "independent grocer", "foodland",
    "t&t", "h mart", "adonis", "iga", "provigo", "maxi", "super c",
    "epicerie", "supermarche",
  ],
  transport: [
    "uber", "lyft", "taxi", "cab", "rideshare", "ride share", "car share", "bike share",
    "gas", "fuel", "gasoline", "petrol", "diesel", "ev charging", "supercharger",
    "costco gas", "canadian tire gas",
    "parking", "toll", "407", "presto", "ttc", "go train", "go transit", "oc transpo", "stm",
    "translink", "transit", "bus", "train", "streetcar", "lrt", "skytrain", "compass card",
    "opus card", "carte opus",
    "car wash", "oil change", "tire", "tires", "brakes", "mechanic", "car repair",
    "car maintenance", "towing", "car insurance",
    "esso", "petro canada", "shell", "pioneer", "ultramar", "chevron",
    "bixi", "zipcar", "communauto",
    "essence", "stationnement", "autobus", "peage",
  ],
  housing: [
    "rent", "mortgage", "condo fee", "condo fees", "strata", "property tax", "property taxes",
    "landlord", "apartment", "damage deposit", "tenant insurance", "home insurance",
    "furniture", "mattress", "couch", "sofa", "ikea", "wayfair", "structube", "leons",
    "the brick", "sleep country", "home depot", "rona", "lowes", "home hardware", "hardware",
    "repair", "renovation", "handyman", "plumber", "electrician", "locksmith", "hvac", "furnace",
    "cleaning", "cleaner", "lawn", "landscaping", "snow removal",
    "movers", "moving", "u haul", "storage",
    "loyer", "hypotheque", "taxe fonciere", "taxes foncieres", "assurance habitation",
    "meubles", "reparation", "plombier", "electricien", "menage", "demenagement",
  ],
  utilities: [
    "utility", "utilities", "hydro", "electricity", "electric bill", "power bill",
    "water bill", "water heater", "enercare", "reliance", "gas bill", "heating", "enbridge",
    "sewer", "hydro one", "hydro ottawa", "hydro quebec", "bc hydro", "toronto hydro",
    "manitoba hydro", "alectra", "fortis", "fortisbc", "epcor", "atco", "enmax", "saskpower",
    "nova scotia power", "nb power",
    "internet", "wifi", "wi fi", "starlink", "teksavvy",
    "phone bill", "phone plan", "cell plan", "mobile plan", "data plan",
    "rogers", "bell", "telus", "fido", "koodo", "virgin", "freedom mobile", "public mobile",
    "chatr", "lucky mobile", "sasktel", "shaw", "videotron", "cogeco", "eastlink",
    "electricite", "chauffage",
  ],
  entertainment: [
    "movie", "movies", "cinema", "cineplex", "theatre", "theater", "concert", "show",
    "comedy", "ticketmaster", "hockey game", "festival", "party", "nightclub",
    "netflix", "spotify", "disney", "disney plus", "crave", "prime video", "apple tv",
    "paramount plus", "hbo", "youtube premium", "twitch",
    "xbox", "playstation", "ps5", "nintendo", "steam", "video games",
    "bowling", "karaoke", "arcade", "golf", "billiards", "escape room", "laser tag",
    "paintball", "karting", "museum", "science centre", "aquarium", "zoo",
    "amusement park", "canadas wonderland", "la ronde",
    "spectacle", "musee", "jeux video",
  ],
  travel: [
    "travel", "trip", "vacation", "getaway", "honeymoon",
    "flight", "airfare", "airline", "plane", "airport", "layover", "baggage", "luggage", "passport",
    "travel insurance", "air canada", "westjet", "porter", "flair", "air transat", "sunwing",
    "via rail", "bc ferries",
    "hotel", "motel", "airbnb", "vrbo", "hostel", "resort", "cruise", "camping", "campsite",
    "parks canada", "expedia", "booking com", "hotels com", "car rental", "rental car", "hertz",
    "voyage", "vacances", "avion", "billet d avion", "aeroport", "auberge", "croisiere",
  ],
  shopping: [
    "shopping", "mall", "gift", "present", "clothes", "clothing", "jacket", "jeans", "shoe",
    "shoes", "boots", "sneakers", "electronics", "laptop", "headphones", "earbuds", "books",
    "toys",
    "amazon", "walmart", "best buy", "canadian tire", "winners", "marshalls", "homesense",
    "home sense", "sport chek", "sportchek", "sporting life", "dollarama", "dollar tree",
    "dollar store", "giant tiger", "value village", "simons", "hudsons bay", "old navy",
    "uniqlo", "zara", "aritzia", "lululemon", "nike", "adidas", "sephora", "staples", "indigo",
    "apple store", "canada computers", "memory express", "ebay", "etsy", "shein", "temu",
    "aliexpress",
    "cadeau", "cadeaux", "vetements", "souliers", "chaussures", "magasinage",
  ],
  health: [
    "pharmacy", "drugstore", "medicine", "medication", "meds", "prescription", "vitamin",
    "vitamins", "tylenol", "advil", "flu shot", "vaccine",
    "doctor", "clinic", "medical", "hospital", "dentist", "dental", "orthodontist",
    "physio", "physiotherapy", "massage", "chiropractor", "chiro", "naturopath",
    "dermatologist", "therapy", "therapist", "counselling", "counseling", "psychologist",
    "optometrist", "optician", "eye exam", "glasses", "contact lenses",
    "gym", "fitness", "goodlife", "fit4less", "crossfit", "orangetheory", "pilates", "yoga",
    "ymca",
    "shoppers", "shoppers drug mart", "rexall", "london drugs", "jean coutu", "pharmaprix",
    "familiprix", "uniprix", "brunet",
    "pharmacie", "dentiste", "medecin", "clinique", "hopital", "ordonnance", "medicaments",
    "lunettes", "optometriste", "physiotherapie",
  ],
  other: [],
};

// Makes two bits of text comparable: lowercase, no accents, apostrophes removed, anything
// else that isn't a letter or digit turned into a space, single spaces.
// "Tim Horton’s Café!" → "tim hortons cafe".
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // the accents, split off by normalize("NFD")
    .replace(/['’‘ʼ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Every keyword (made comparable), with its category.
const KEYWORDS = new Map<string, CategoryKey>(
  CATEGORIES.flatMap((c) => CATEGORY_KEYWORDS[c.key].map((word) => [normalizeText(word), c.key] as const)),
);

// A phrase's category, also trying it without a trailing "s" ("pizzas" → "pizza").
function keywordCategory(phrase: string): CategoryKey | undefined {
  return KEYWORDS.get(phrase) ?? (phrase.endsWith("s") ? KEYWORDS.get(phrase.slice(0, -1)) : undefined);
}

// Earlier expenses in the group, newest first.
export type PastExpense = { description: string; category: CategoryKey };

// The category to suggest for a new expense's description:
// 1. If this group already has an expense with the same description (compared with
//    normalizeText), the category of the most recent one, unless that's Other.
// 2. Otherwise a keyword: the longest match wins (3 words, then 2, then 1), and for the
//    same length the first one in the description ("Gas bill" → Utilities, "Uber home"
//    → Transport, "Uber Eats" → Food).
// 3. Otherwise Other.
export function suggestCategory(description: string, history: readonly PastExpense[] = []): CategoryKey {
  const text = normalizeText(description);
  if (text === "") return DEFAULT_CATEGORY;

  const past = history.find((expense) => normalizeText(expense.description) === text);
  if (past && past.category !== DEFAULT_CATEGORY) return past.category;

  const words = text.split(" ");
  for (let size = 3; size >= 1; size--) {
    for (let start = 0; start + size <= words.length; start++) {
      const found = keywordCategory(words.slice(start, start + size).join(" "));
      if (found) return found;
    }
  }
  return DEFAULT_CATEGORY;
}
