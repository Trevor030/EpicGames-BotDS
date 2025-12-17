// src/steam.js
// Steam deals via IsThereAnyDeal API (no scraping).
//
// Filtri:
// - solo Steam shop (shops=61)
// - prezzo scontato <= MAX_FINAL_EUR
// - sconto >= MIN_DISCOUNT_PCT
// - esclude giochi "già economici": prezzo regolare > MAX_FINAL_EUR
//
// Richiede: ITAD_API_KEY (env)

const ITAD_API_KEY = process.env.ITAD_API_KEY;
const ITAD_COUNTRY = process.env.ITAD_COUNTRY || "IT";

const MAX_FINAL_EUR = Number(process.env.STEAM_MAX_FINAL_EUR || 9);
const MIN_DISCOUNT_PCT = Number(process.env.STEAM_MIN_DISCOUNT_PCT || 50);
const MAX_RESULTS = Number(process.env.STEAM_MAX_RESULTS || 60);

const ITAD_ENDPOINT = "https://api.isthereanydeal.com/deals/v2";
const STEAM_SHOP_ID = 61; // usato nei parametri shops (Steam) :contentReference[oaicite:2]{index=2}

function fmtEuro(amount) {
  if (typeof amount !== "number") return null;
  return `${amount.toFixed(2).replace(".", ",")}€`;
}

function makeUrl(offset, limit) {
  const u = new URL(ITAD_ENDPOINT);
  u.searchParams.set("country", ITAD_COUNTRY);
  u.searchParams.set("shops", String(STEAM_SHOP_ID));
  u.searchParams.set("sort", "price"); // lowest price :contentReference[oaicite:3]{index=3}
  u.searchParams.set("offset", String(offset));
  u.searchParams.set("limit", String(limit));
  // auth: ITAD usa API key; in molti esempi ITAD è in query "key".
  u.searchParams.set("key", ITAD_API_KEY);
  return u.toString();
}

async function itadFetch(url) {
  // Mettiamo anche header, così copriamo entrambi gli stili (query+header)
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": process.env.ITAD_UA || "epic-steam-discord-bot/1.0",
      "x-api-key": ITAD_API_KEY,
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`ITAD fetch failed: ${res.status} ${txt ? "- " + txt.slice(0, 120) : ""}`);
  }
  return await res.json();
}

export async function fetchSteamDeals() {
  if (!ITAD_API_KEY) {
    throw new Error("ITAD_API_KEY mancante (registrala in isthereanydeal.com -> My Apps).");
  }

  const wanted = Math.max(10, Math.min(MAX_RESULTS, 200)); // limite pratico
  const pageSize = 200; // max per docs :contentReference[oaicite:4]{index=4}

  let offset = 0;
  let hasMore = true;

  const out = [];
  const seen = new Set();

  while (hasMore && out.length < wanted) {
    const url = makeUrl(offset, pageSize);
    const data = await itadFetch(url);

    const list = data?.list || [];
    for (const item of list) {
      const deal = item?.deal;
      if (!deal) continue;

      const cut = Number(deal.cut ?? 0);
      const price = deal?.price?.amount;
      const regular = deal?.regular?.amount;
      const currency = deal?.price?.currency;

      // per IT conviene assicurarsi EUR (se ITAD_COUNTRY=IT di norma è EUR)
      if (currency && currency !== "EUR") continue;

      if (!(cut >= MIN_DISCOUNT_PCT)) continue;
      if (!(typeof price === "number" && price <= MAX_FINAL_EUR)) continue;

      // escludi giochi già economici: regolare deve essere > MAX_FINAL_EUR
      if (!(typeof regular === "number" && regular > MAX_FINAL_EUR)) continue;

      const key = `${item.id}|${cut}|${price}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        appId: null, // ITAD qui non dà sempre appId Steam diretto
        title: item.title || item.slug || "Senza titolo",
        url: deal.url || `https://isthereanydeal.com/game/${item.slug}/`, // ITAD shortlink o fallback
        discountPercent: cut,
        originalEur: regular,
        finalEur: price,
        originalPriceText: fmtEuro(regular),
        finalPriceText: fmtEuro(price),
        end: deal.expiry ? new Date(deal.expiry) : null,
      });

      if (out.length >= wanted) break;
    }

    hasMore = !!data?.hasMore;
    offset = Number(data?.nextOffset ?? (offset + pageSize));
    if (!Number.isFinite(offset)) break;
  }

  out.sort(
    (a, b) =>
      (a.finalEur ?? 999) - (b.finalEur ?? 999) ||
      (b.discountPercent ?? 0) - (a.discountPercent ?? 0) ||
      a.title.localeCompare(b.title)
  );

  return out.slice(0, wanted);
}
