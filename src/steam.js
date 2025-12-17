// src/steam.js
// Steam deals via IsThereAnyDeal:
// - prendo deal Steam (shops=61) con sort=-cut
// - filtro: type=game, mature=false, final<=MAX, cut>=MIN, regular>MAX
// - priorità: giochi presenti nei "most waitlisted" ITAD (popolarità oggettiva)
// Docs: deals/v2 (sort, shops, mature) + stats/most-waitlisted/v1 :contentReference[oaicite:3]{index=3}

const ITAD_API_KEY = process.env.ITAD_API_KEY;
const ITAD_COUNTRY = process.env.ITAD_COUNTRY || "IT";

const MAX_FINAL_EUR = Number(process.env.STEAM_MAX_FINAL_EUR || 9);
const MIN_DISCOUNT_PCT = Number(process.env.STEAM_MIN_DISCOUNT_PCT || 50);
const MAX_RESULTS = Number(process.env.STEAM_MAX_RESULTS || 60);

// fallback “AAA” dopo la popolarità
const AAA_ORIGINAL_PRICE = Number(process.env.STEAM_AAA_PRICE || 30);

const STEAM_SHOP_ID = 61;
const ITAD_DEALS_V2 = "https://api.isthereanydeal.com/deals/v2";
const ITAD_MOST_WAITLISTED = "https://api.isthereanydeal.com/stats/most-waitlisted/v1";

function fmtEuro(amount) {
  if (typeof amount !== "number") return null;
  return `${amount.toFixed(2).replace(".", ",")}€`;
}

async function itadGet(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": process.env.ITAD_UA || "epic-steam-discord-bot/1.0",
      "x-api-key": ITAD_API_KEY,
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`ITAD fetch failed: ${res.status}${txt ? " - " + txt.slice(0, 160) : ""}`);
  }
  return await res.json();
}

function buildDealsUrl() {
  const u = new URL(ITAD_DEALS_V2);
  u.searchParams.set("key", ITAD_API_KEY);
  u.searchParams.set("country", ITAD_COUNTRY);
  u.searchParams.set("shops", String(STEAM_SHOP_ID)); // Steam-only :contentReference[oaicite:4]{index=4}
  u.searchParams.set("limit", "200");                 // max 200 :contentReference[oaicite:5]{index=5}
  u.searchParams.set("offset", "0");
  u.searchParams.set("sort", "-cut");                 // highest cut :contentReference[oaicite:6]{index=6}
  return u.toString();
}

function buildMostWaitlistedUrl() {
  const u = new URL(ITAD_MOST_WAITLISTED);
  u.searchParams.set("key", ITAD_API_KEY);
  u.searchParams.set("offset", "0");
  u.searchParams.set("limit", "500"); // doc: fino a 500 :contentReference[oaicite:7]{index=7}
  return u.toString();
}

export async function fetchSteamDeals() {
  if (!ITAD_API_KEY) {
    throw new Error("ITAD_API_KEY mancante (registrala in isthereanydeal.com -> My Apps).");
  }

  // 1) Popolarità: lista “most waitlisted”
  let popularPos = new Map();
  try {
    const popular = await itadGet(buildMostWaitlistedUrl());
    // formato: array di { position, id, ... } :contentReference[oaicite:8]{index=8}
    for (const row of Array.isArray(popular) ? popular : []) {
      if (row?.id && typeof row.position === "number") popularPos.set(row.id, row.position);
    }
  } catch {
    // se fallisce, continuiamo comunque (non deve rompere il bot)
    popularPos = new Map();
  }

  // 2) Deals Steam (ITAD)
  const data = await itadGet(buildDealsUrl());
  const list = data?.list || [];

  const out = [];
  const seen = new Set();

  for (const item of list) {
    if (!item?.deal) continue;

    // SOLO giochi
    if (item.type && item.type !== "game") continue;

    // Escludi mature (campo presente in deals/v2) :contentReference[oaicite:9]{index=9}
    if (item.mature === true) continue;

    const deal = item.deal;
    const cut = Number(deal.cut ?? 0);
    const price = deal?.price?.amount;
    const regular = deal?.regular?.amount;
    const currency = deal?.price?.currency;

    if (currency && currency !== "EUR") continue;

    if (!(cut >= MIN_DISCOUNT_PCT)) continue;
    if (!(typeof price === "number" && price <= MAX_FINAL_EUR)) continue;
    if (!(typeof regular === "number" && regular > MAX_FINAL_EUR)) continue;

    const key = `${item.id}|${cut}|${price}|${regular}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      id: item.id,
      title: item.title || item.slug || "Senza titolo",
      url: deal.url || `https://isthereanydeal.com/game/${item.slug}/`,
      discountPercent: cut,
      originalEur: regular,
      finalEur: price,
      originalPriceText: fmtEuro(regular),
      finalPriceText: fmtEuro(price),
      end: deal.expiry ? new Date(deal.expiry) : null,

      // ranking helpers
      popularRank: popularPos.has(item.id) ? popularPos.get(item.id) : null,
      aaaBoost: (regular >= AAA_ORIGINAL_PRICE),
    });
  }

  // 3) Ordine “come lo vuoi tu”
  // - prima i popolari (most waitlisted) → rank più basso = più popolare
  // - poi AAA boost (originale alto)
  // - poi sconto alto
  // - poi prezzo basso
  out.sort((a, b) => {
    const ap = a.popularRank ?? 999999;
    const bp = b.popularRank ?? 999999;
    if (ap !== bp) return ap - bp;

    const aa = a.aaaBoost ? 1 : 0;
    const ba = b.aaaBoost ? 1 : 0;
    if (aa !== ba) return ba - aa;

    const ad = a.discountPercent ?? 0;
    const bd = b.discountPercent ?? 0;
    if (ad !== bd) return bd - ad;

    const af = a.finalEur ?? 999;
    const bf = b.finalEur ?? 999;
    if (af !== bf) return af - bf;

    return String(a.title).localeCompare(String(b.title));
  });

  return out.slice(0, MAX_RESULTS);
}
