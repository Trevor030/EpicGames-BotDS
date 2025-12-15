const EPIC_FREE_URL =
  "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=it&country=IT&allowCountries=IT";

function parseDate(iso) {
  // ISO tipo 2025-12-12T16:00:00.000Z
  return new Date(iso);
}

function normalizeGame(el, start, end) {
  const slug = el.productSlug || el.urlSlug || "";
  const url = slug
    ? `https://store.epicgames.com/it/p/${slug}`
    : "https://store.epicgames.com/it/free-games";

  return {
    title: el.title || "Senza titolo",
    start,
    end,
    url
  };
}

function dedupeAndSort(games, keyFn, sortFn) {
  const seen = new Set();
  const out = [];
  for (const g of games) {
    const k = keyFn(g);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(g);
  }
  out.sort(sortFn);
  return out;
}

export async function fetchFreeGames() {
  const res = await fetch(EPIC_FREE_URL, { headers: { "user-agent": "epic-free-bot" } });
  if (!res.ok) throw new Error(`Epic fetch failed: ${res.status} ${res.statusText}`);
  const data = await res.json();

  const elements = data?.data?.Catalog?.searchStore?.elements ?? [];
  const now = new Date();

  const current = [];
  const upcoming = [];

  for (const el of elements) {
    const promos = el.promotions;
    if (!promos) continue;

    // promo attive
    for (const bucket of (promos.promotionalOffers || [])) {
      for (const offer of (bucket.promotionalOffers || [])) {
        const start = parseDate(offer.startDate);
        const end = parseDate(offer.endDate);
        if (start <= now && now < end) current.push(normalizeGame(el, start, end));
      }
    }

    // promo future (quando Epic le pubblica)
    for (const bucket of (promos.upcomingPromotionalOffers || [])) {
      for (const offer of (bucket.promotionalOffers || [])) {
        const start = parseDate(offer.startDate);
        const end = parseDate(offer.endDate);
        if (start > now) upcoming.push(normalizeGame(el, start, end));
      }
    }
  }

  const currentClean = dedupeAndSort(
    current,
    (g) => `${g.title}|${g.url}|${g.end.toISOString()}`,
    (a, b) => a.end - b.end
  );

  const upcomingClean = dedupeAndSort(
    upcoming,
    (g) => `${g.title}|${g.url}|${g.start.toISOString()}`,
    (a, b) => a.start - b.start
  );

  return { current: currentClean, upcoming: upcomingClean };
}
