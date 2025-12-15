const EPIC_URL =
  "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=it&country=IT&allowCountries=IT";

function isMysteryTitle(title) {
  return /^mystery game\b/i.test(title || "");
}

function normalize(el, start, end, isMystery = false) {
  const slug = el.productSlug || el.urlSlug || "";
  return {
    title: isMystery ? "🎁 Gioco misterioso" : (el.title || "Senza titolo"),
    start,
    end,
    url: slug
      ? `https://store.epicgames.com/it/p/${slug}`
      : "https://store.epicgames.com/it/free-games"
  };
}

function uniqByUrl(list) {
  const m = new Map();
  for (const g of list) m.set(g.url + g.title, g);
  return [...m.values()];
}

function isFreeClaim(el, offer) {
  const tp = el?.price?.totalPrice;
  const dp = tp?.discountPrice;
  if (typeof dp !== "number" || dp !== 0) return false;

  const ds = offer?.discountSetting;
  if (!ds) return false;

  if (ds.discountType === "FREE") return true;
  if (typeof ds.discountPercentage === "number" && ds.discountPercentage === 0) return true;

  return false;
}

export async function fetchEpicFreePromos() {
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

    // DISPONIBILI ORA (mai mystery)
    for (const bucket of promos.promotionalOffers || []) {
      for (const offer of bucket.promotionalOffers || []) {
        const s = new Date(offer.startDate);
        const e = new Date(offer.endDate);
        if (!(s <= now && now < e)) continue;
        if (!isFreeClaim(el, offer)) continue;
        if (isMysteryTitle(el.title)) continue;

        current.push(normalize(el, s, e, false));
      }
    }

    // PROSSIMI (mystery ammesso ma “rinominato”)
    for (const bucket of promos.upcomingPromotionalOffers || []) {
      for (const offer of bucket.promotionalOffers || []) {
        const s = new Date(offer.startDate);
        const e = new Date(offer.endDate);
        if (!(s > now)) continue;
        if (!isFreeClaim(el, offer)) continue;

        const mystery = isMysteryTitle(el.title);
        upcoming.push(normalize(el, s, e, mystery));
      }
    }
  }

  return {
    current: uniqByUrl(current).sort((a, b) => a.end - b.end),
    upcoming: uniqByUrl(upcoming).sort((a, b) => a.start - b.start)
  };
}
