// steam.js
// Legge "specials" da Steam e include sconti forti (>= MIN_STEAM_DISCOUNT)
// Mostra prezzo originale + scontato + percentuale

const STEAM_SPECIALS = "https://store.steampowered.com/api/featuredcategories?l=italian";
const MIN_STEAM_DISCOUNT = Number(process.env.MIN_STEAM_DISCOUNT || 90); // 90 di default

function formatMoney(cents, currency) {
  if (typeof cents !== "number") return null;

  // Steam spesso usa centesimi (EUR, USD, ecc.). Per sicurezza: divide per 100.
  const amount = cents / 100;

  // Se currency è tipo "EUR", proviamo Intl
  try {
    return new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // fallback semplice
    return `${amount.toFixed(2)} ${currency || ""}`.trim();
  }
}

function normalizeSteam(app) {
  const currency = app.currency || null;

  const original = typeof app.original_price === "number" ? app.original_price : null;
  const final = typeof app.final_price === "number" ? app.final_price : null;

  return {
    title: app.name,
    url: `https://store.steampowered.com/app/${app.id}`,
    discountPercent: app.discount_percent ?? null,

    // prezzi raw (centesimi)
    originalCents: original,
    finalCents: final,
    currency,

    // prezzi già formattati
    originalPriceText: original != null ? formatMoney(original, currency) : null,
    finalPriceText: final != null ? formatMoney(final, currency) : null,

    // scadenza sconto
    end: app.discount_expiration ? new Date(app.discount_expiration * 1000) : null,

    // utile per filtrare fuori i giochi F2P
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
      // escludi F2P
      if (app.is_free === true) return false;

      // sconto forte >= 90% (o quello che imposti)
      const pct = Number(app.discount_percent || 0);
      if (pct < MIN_STEAM_DISCOUNT) return false;

      // serve che esistano prezzi coerenti
      if (typeof app.original_price !== "number" || typeof app.final_price !== "number") return false;

      return true;
    })
    .map(normalizeSteam)
    .sort((a, b) => {
      // prima i più scontati, poi quelli che scadono prima
      const dp = (b.discountPercent ?? 0) - (a.discountPercent ?? 0);
      if (dp !== 0) return dp;

      const ae = a.end ? a.end.getTime() : Number.MAX_SAFE_INTEGER;
      const be = b.end ? b.end.getTime() : Number.MAX_SAFE_INTEGER;
      return ae - be;
    });
}
