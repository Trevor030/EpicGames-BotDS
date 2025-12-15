const EPIC_URL =
  "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=it&country=IT&allowCountries=IT";

function normalize(el, start, end) {
  const slug = el.productSlug || el.urlSlug || "";
  return {
    title: el.title,
    start,
    end,
    url: slug
      ? `https://store.epicgames.com/it/p/${slug}`
      : "https://store.epicgames.com/it/free-games"
  };
}

export async function fetchEpicGames() {
  const res = await fetch(EPIC_URL);
  if (!res.ok) throw new Error("Epic fetch failed");

  const data = await res.json();
  const elements = data.data.Catalog.searchStore.elements;
  const now = new Date();

  const current = [];
  const upcoming = [];

  for (const el of elements) {
    const promos = el.promotions;
    if (!promos) continue;

    for (const p of promos.promotionalOffers || []) {
      for (const o of p.promotionalOffers || []) {
        const s = new Date(o.startDate);
        const e = new Date(o.endDate);
        if (s <= now && now < e) current.push(normalize(el, s, e));
      }
    }

    for (const p of promos.upcomingPromotionalOffers || []) {
      for (const o of p.promotionalOffers || []) {
        const s = new Date(o.startDate);
        const e = new Date(o.endDate);
        if (s > now) upcoming.push(normalize(el, s, e));
      }
    }
  }

  return {
    current: [...new Map(current.map(g => [g.title, g])).values()],
    upcoming: [...new Map(upcoming.map(g => [g.title, g])).values()]
  };
}
