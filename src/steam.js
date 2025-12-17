// steam.js
const STEAM_SPECIALS = "https://store.steampowered.com/api/featuredcategories?l=italian";
const MIN_STEAM_DISCOUNT = Number(process.env.MIN_STEAM_DISCOUNT || 90);

function formatMoney(cents, currency) {
  if (typeof cents !== "number") return null;
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || ""}`.trim();
  }
}

function normalizeSteam(app) {
  const currency = app.currency || null;
  const original = typeof app.original_price === "number" ? app.original_price : null;
  const final = typeof app.final_price === "number" ? app.final_price : null;

  return {
    appId: app.id, // ✅ chiave stabile
    title: app.name,
    url: `https://store.steampowered.com/app/${app.id}`,
    discountPercent: app.discount_percent ?? null,

    // prezzi (solo display)
    originalCents: original,
    finalCents: final,
    currency,
    originalPriceText: original != null ? formatMoney(original, currency) : null,
    finalPriceText: final != null ? formatMoney(final, currency) : null,

    end: app.discount_expiration ? new Date(app.discount_expiration * 1000) : null,
    isFreeToPlay: app.is_free === true,
  };
}

export async function fetchSteamDeals() {
  const res = await fetch(STEAM_SPECIALS);
  if (!res.ok) throw new Error(`Steam fetch failed: ${res.status}`);

  const data = await res.json();
  const specials = data?.specials?.items ?? [];

  return specials
    .filter(app => {
      if (app.is_free === true) return false;
      const pct = Number(app.discount_percent || 0);
      if (pct < MIN_STEAM_DISCOUNT) return false;
      if (typeof app.original_price !== "number" || typeof app.final_price !== "number") return false;
      return true;
    })
    .map(normalizeSteam)
    .sort((a, b) => {
      const dp = (b.discountPercent ?? 0) - (a.discountPercent ?? 0);
      if (dp !== 0) return dp;
      const ae = a.end ? a.end.getTime() : Number.MAX_SAFE_INTEGER;
      const be = b.end ? b.end.getTime() : Number.MAX_SAFE_INTEGER;
      return ae - be;
    });
}
