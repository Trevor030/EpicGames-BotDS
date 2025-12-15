const EPIC_URL =
  "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=it&country=IT&allowCountries=IT";

function isActuallyFree(el) {
  const price = el?.price?.totalPrice;
  if (!price) return false;

  const discountPrice = price.discountPrice; // centesimi
  const originalPrice = price.originalPrice; // centesimi

  // Gratis in promo = scontato a 0 ma non già free-to-play permanente
  return discountPrice === 0 && originalPrice > 0;
}

function normalize(el, start, end) {
  const slug = el.productSlug || el.urlSlug || "";
  return {
    title: el.title || "Senza titolo",
    start,
    end,
    url: slug
      ? `https://store.epicgames.com/it/p/${slug}`
      : "https://store.epicgames.com/it/free-games"
  };
}

function uniqByTitle(list) {
  const m = new Map();
  for (const g of list) m.set(g.title, g);
  return [...m.values()];
}

export async function fetchEpicGames() {
  const res = await fetch(EPIC_URL);
  if (!res.ok) throw new Error(`Epic fetch failed: ${res.status}`);

  const data = await res.json();
  const elements = data?.data?.Catalog?.searchStore?.elements ?? [];
  const now = new Date();

  const current = [];
  const upcoming = [];

  for (const el of elements) {
    if (!el?.promotions) continue;
    if (!isActuallyFree(el)) continue; // <-- filtro chiave

    // promo attive
    for (const p of el.promotions.promotionalOffers || []) {
      for (const o of p.promotionalOffers || []) {
        const s = new Date(o.startDate);
        const e = new Date(o.endDate);
        if (s <= now && now < e) current.push(normalize(el, s, e));
      }
    }

    // promo future
    for (const p of el.promotions.upcomingPromotionalOffers || []) {
      for (const o of p.promotionalOffers || []) {
        const s = new Date(o.startDate);
        const e = new Date(o.endDate);
        if (s > now) upcoming.push(normalize(el, s, e));
      }
    }
  }

  return {
    current: uniqByTitle(current).sort((a, b) => a.end - b.end),
    upcoming: uniqByTitle(upcoming).sort((a, b) => a.start - b.start)
  };
}
