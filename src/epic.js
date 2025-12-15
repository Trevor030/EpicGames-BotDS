const EPIC_PROMO_URL =
  "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=it&country=IT&allowCountries=IT";

// Product page HTML: usiamo un check semplice e robusto.
// Quando un gioco è “giveaway”, sulla pagina appare chiaramente "-100%" e "Free".
// (Esempio: Hogwarts Legacy è mostrato come -100% / Free) 
async function isFreeOnProductPage(url) {
  try {
    const res = await fetch(url, { headers: { "user-agent": "epic-discord-bot" } });
    if (!res.ok) return false;
    const html = await res.text();

    // Heuristica: deve contenere "-100%" e una dicitura "Free" / "Gratis".
    // (La lingua pagina può variare: usiamo entrambe.)
    const has100 = html.includes("-100%") || html.includes("100% off");
    const hasFree = html.includes(">Free<") || html.includes(">Gratis<") || html.includes("Free ");
    return has100 && hasFree;
  } catch {
    return false;
  }
}

function normalize(el, start, end) {
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

function uniqByUrl(list) {
  const map = new Map();
  for (const g of list) map.set(g.url, g);
  return [...map.values()];
}

export async function fetchEpicFreePromos({ maxChecks = 10 } = {}) {
  const res = await fetch(EPIC_PROMO_URL);
  if (!res.ok) throw new Error(`Epic promo feed failed: ${res.status}`);

  const data = await res.json();
  const elements = data?.data?.Catalog?.searchStore?.elements ?? [];
  const now = new Date();

  // 1) Candidati dal feed (solo per finestre temporali)
  const currentCandidates = [];
  const upcomingCandidates = [];

  for (const el of elements) {
    const promos = el?.promotions;
    if (!promos) continue;

    for (const bucket of promos.promotionalOffers || []) {
      for (const offer of bucket.promotionalOffers || []) {
        const s = new Date(offer.startDate);
        const e = new Date(offer.endDate);
        if (s <= now && now < e) currentCandidates.push(normalize(el, s, e));
      }
    }

    for (const bucket of promos.upcomingPromotionalOffers || []) {
      for (const offer of bucket.promotionalOffers || []) {
        const s = new Date(offer.startDate);
        const e = new Date(offer.endDate);
        if (s > now) upcomingCandidates.push(normalize(el, s, e));
      }
    }
  }

  // Dedup
  const currentUnique = uniqByUrl(currentCandidates).sort((a, b) => a.end - b.end);
  const upcomingUnique = uniqByUrl(upcomingCandidates).sort((a, b) => a.start - b.start);

  // 2) Verifica “FREE -100%” sulla pagina prodotto (limitiamo controlli per non esagerare)
  async function filterFree(list) {
    const out = [];
    for (const g of list) {
      if (out.length >= maxChecks) break; // evita troppi fetch
      const ok = await isFreeOnProductPage(g.url);
      if (ok) out.push(g);
    }
    return out;
  }

  const current = await filterFree(currentUnique);
  const upcoming = await filterFree(upcomingUnique);

  return { current, upcoming };
}
