const EPIC_URL =
  "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=it&country=IT&allowCountries=IT";

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
  const map = new Map();
  for (const g of list) map.set(g.title, g);
  return [...map.values()];
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
    const promos = el?.promotions;
    if (!promos) continue;

    // ✅ GIOCHI GRATIS ATTUALI
    for (const bucket of promos.promotionalOffers || []) {
      for (const offer of bucket.promotionalOffers || []) {
        const s = new Date(offer.startDate);
        const e = new Date(offer.endDate);

        // 🔑 FLAG UFFICIALE EPIC
        if (offer.discountSetting?.discountType !== "FREE") continue;
        if (s <= now && now < e) {
          current.push(normalize(el, s, e));
        }
      }
    }

    // ⏭️ PROSSIMI GIOCHI GRATIS
    for (const bucket of promos.upcomingPromotionalOffers || []) {
      for (const offer of bucket.promotionalOffers || []) {
        const s = new Date(offer.startDate);
        const e = new Date(offer.endDate);

        if (offer.discountSetting?.discountType !== "FREE") continue;
        if (s > now) {
          upcoming.push(normalize(el, s, e));
        }
      }
    }
  }

  return {
    current: uniqByTitle(current).sort((a, b) => a.end - b.end),
    upcoming: uniqByTitle(upcoming).sort((a, b) => a.start - b.start)
  };
}
