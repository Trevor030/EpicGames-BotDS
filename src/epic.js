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
      : "https://store.epicgames.com/it/free-games",
    // campi utili per debug/filtri
    offerType: el.offerType,
    discountPrice: el?.price?.totalPrice?.discountPrice,
    originalPrice: el?.price?.totalPrice?.originalPrice
  };
}

function uniqByUrl(list) {
  const m = new Map();
  for (const g of list) m.set(g.url, g);
  return [...m.values()];
}

// Heuristica robusta: promo "free-claim" quando almeno UNO di questi segnali è vero
function isFreeClaim(el, offer) {
  const ds = offer?.discountSetting;

  // segnale 1: Epic sometimes marca chiaramente FREE
  if (ds?.discountType === "FREE") return true;

  // segnale 2: percentuale (in alcuni feed è 100, in altri 0)
  if (typeof ds?.discountPercentage === "number") {
    if (ds.discountPercentage === 100 || ds.discountPercentage === 0) return true;
  }

  // segnale 3: prezzo scontato 0 nel blocco price (quando affidabile)
  const dp = el?.price?.totalPrice?.discountPrice;
  if (typeof dp === "number" && dp === 0) return true;

  return false;
}

export async function fetchEpicFreePromos({ debug = false } = {}) {
  const res = await fetch(EPIC_URL);
  if (!res.ok) throw new Error(`Epic fetch failed: ${res.status} ${res.statusText}`);

  const data = await res.json();
  const elements = data?.data?.Catalog?.searchStore?.elements ?? [];
  const now = new Date();

  const current = [];
  const upcoming = [];

  // debug: raccogliamo qualche info utile
  const debugSamples = [];

  for (const el of elements) {
    const promos = el?.promotions;
    if (!promos) continue;

    // Promo attive
    for (const bucket of promos.promotionalOffers || []) {
      for (const offer of bucket.promotionalOffers || []) {
        const s = new Date(offer.startDate);
        const e = new Date(offer.endDate);
        if (!(s <= now && now < e)) continue;

        const free = isFreeClaim(el, offer);
        if (debug && debugSamples.length < 10) {
          debugSamples.push({
            title: el.title,
            offerType: el.offerType,
            start: offer.startDate,
            end: offer.endDate,
            discountType: offer?.discountSetting?.discountType,
            discountPct: offer?.discountSetting?.discountPercentage,
            discountPrice: el?.price?.totalPrice?.discountPrice,
            originalPrice: el?.price?.totalPrice?.originalPrice,
            freeDetected: free
          });
        }

        if (!free) continue;
        current.push(normalize(el, s, e));
      }
    }

    // Promo future
    for (const bucket of promos.upcomingPromotionalOffers || []) {
      for (const offer of bucket.promotionalOffers || []) {
        const s = new Date(offer.startDate);
        const e = new Date(offer.endDate);
        if (!(s > now)) continue;

        const free = isFreeClaim(el, offer);
        if (debug && debugSamples.length < 10) {
          debugSamples.push({
            title: el.title,
            offerType: el.offerType,
            start: offer.startDate,
            end: offer.endDate,
            discountType: offer?.discountSetting?.discountType,
            discountPct: offer?.discountSetting?.discountPercentage,
            discountPrice: el?.price?.totalPrice?.discountPrice,
            originalPrice: el?.price?.totalPrice?.originalPrice,
            freeDetected: free
          });
        }

        if (!free) continue;
        upcoming.push(normalize(el, s, e));
      }
    }
  }

  const out = {
    current: uniqByUrl(current).sort((a, b) => a.end - b.end),
    upcoming: uniqByUrl(upcoming).sort((a, b) => a.start - b.start)
  };

  if (debug) out.debugSamples = debugSamples;
  return out;
}
