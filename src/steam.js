// src/steam.js — ITAD Steam-only + STRICT AAA via keyword whitelist + pagination
const ITAD_API_KEY = process.env.ITAD_API_KEY;
const ITAD_COUNTRY = process.env.ITAD_COUNTRY || "IT";

const MAX_FINAL_EUR = Number(process.env.STEAM_MAX_FINAL_EUR || 9);
const MIN_DISCOUNT_PCT = Number(process.env.STEAM_MIN_DISCOUNT_PCT || 50);
const MAX_RESULTS = Number(process.env.STEAM_MAX_RESULTS || 60);

const STRICT_AAA = (process.env.STEAM_STRICT_AAA || "false").toLowerCase() === "true";
const AAA_TARGET = Number(process.env.STEAM_AAA_TARGET || 12);
const AAA_KEYWORDS_RAW = process.env.STEAM_AAA_KEYWORDS || "";
const AAA_RE = AAA_KEYWORDS_RAW
  ? new RegExp(`(${AAA_KEYWORDS_RAW})`, "i")
  : null;

const STEAM_SHOP_ID = 61;
const ITAD_DEALS_V2 = "https://api.isthereanydeal.com/deals/v2";

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

function buildDealsUrl(offset, limit) {
  const u = new URL(ITAD_DEALS_V2);
  u.searchParams.set("key", ITAD_API_KEY);
  u.searchParams.set("country", ITAD_COUNTRY);
  u.searchParams.set("shops", String(STEAM_SHOP_ID));
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("offset", String(offset));
  u.searchParams.set("sort", "-cut"); // partiamo da sconti alti
  return u.toString();
}

function isAAA(title) {
  if (!AAA_RE) return true; // se non hai impostato keywords, non filtra
  return AAA_RE.test(title || "");
}

export async function fetchSteamDeals() {
  if (!ITAD_API_KEY) {
    throw new Error("ITAD_API_KEY mancante (registrala in isthereanydeal.com -> My Apps).");
  }

  const want = STRICT_AAA ? Math.max(1, AAA_TARGET) : Math.max(10, Math.min(MAX_RESULTS, 200));
  const pageSize = 200;

  const out = [];
  const seen = new Set();

  let offset = 0;
  let loops = 0;

  // paginiamo finché troviamo abbastanza (AAA o normali), ma senza fare loop infinito
  while (out.length < want && loops < 10) {
    loops += 1;
    const data = await itadGet(buildDealsUrl(offset, pageSize));
    const list = data?.list || [];
    if (!list.length) break;

    for (const item of list) {
      if (!item?.deal) continue;
      if (item.type && item.type !== "game") continue;
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

      const title = item.title || item.slug || "Senza titolo";

      // ⭐ filtro “super famosi”
      if (STRICT_AAA && !isAAA(title)) continue;

      const key = `${item.id}|${cut}|${price}|${regular}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        id: item.id,
        title,
        url: deal.url || `https://isthereanydeal.com/game/${item.slug}/`,
        discountPercent: cut,
        originalEur: regular,
        finalEur: price,
        originalPriceText: fmtEuro(regular),
        finalPriceText: fmtEuro(price),
        end: deal.expiry ? new Date(deal.expiry) : null,
      });

      if (out.length >= want) break;
    }

    // se ITAD dice che non ha altro, stop
    if (!data?.hasMore) break;

    offset = Number(data?.nextOffset ?? (offset + pageSize));
    if (!Number.isFinite(offset)) break;
  }

  // ordina: prima “più grossi” (originale alto), poi sconto, poi prezzo
  out.sort((a, b) =>
    (b.originalEur ?? 0) - (a.originalEur ?? 0) ||
    (b.discountPercent ?? 0) - (a.discountPercent ?? 0) ||
    (a.finalEur ?? 999) - (b.finalEur ?? 999) ||
    a.title.localeCompare(b.title)
  );

  return STRICT_AAA ? out.slice(0, want) : out.slice(0, Math.min(MAX_RESULTS, out.length));
}
