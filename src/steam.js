// src/steam.js (ITAD: Steam-only, con priorità ai titoli "grossi")
//
// Obiettivo: ≤ 9€ e sconto ≥ X%, ma mostrare roba tipo Tomb Raider / Assassin’s Creed
// invece di riempire la top-10 con giochi da 0,78€.
//
// Strategia:
// - prendo fino a 200 deal Steam da ITAD ordinati per sconto (-cut)
// - filtro i criteri
// - separo FREE (0,00€)
// - per i non-free ordino per "originale" decrescente (AAA boost), poi sconto, poi prezzo

const ITAD_API_KEY = process.env.ITAD_API_KEY;
const ITAD_COUNTRY = process.env.ITAD_COUNTRY || "IT";

const MAX_FINAL_EUR = Number(process.env.STEAM_MAX_FINAL_EUR || 9);
const MIN_DISCOUNT_PCT = Number(process.env.STEAM_MIN_DISCOUNT_PCT || 50);
const MAX_RESULTS = Number(process.env.STEAM_MAX_RESULTS || 60);

const ITAD_ENDPOINT = "https://api.isthereanydeal.com/deals/v2";
const STEAM_SHOP_ID = 61; // Steam shop id :contentReference[oaicite:1]{index=1}

function fmtEuro(amount) {
  if (typeof amount !== "number") return null;
  return `${amount.toFixed(2).replace(".", ",")}€`;
}

function buildUrl() {
  const u = new URL(ITAD_ENDPOINT);
  u.searchParams.set("key", ITAD_API_KEY);
  u.searchParams.set("country", ITAD_COUNTRY);
  u.searchParams.set("shops", String(STEAM_SHOP_ID));
  u.searchParams.set("limit", "200");     // max :contentReference[oaicite:2]{index=2}
  u.searchParams.set("offset", "0");
  u.searchParams.set("sort", "-cut");     // sconto più alto :contentReference[oaicite:3]{index=3}
  return u.toString();
}

async function itadFetch(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": process.env.ITAD_UA || "epic-steam-discord-bot/1.0",
      "x-api-key": ITAD_API_KEY, // ok anche se la chiave è già in query
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`ITAD fetch failed: ${res.status}${txt ? " - " + txt.slice(0, 160) : ""}`);
  }
  return await res.json();
}

export async function fetchSteamDeals() {
  if (!ITAD_API_KEY) {
    throw new Error("ITAD_API_KEY mancante (registrala in isthereanydeal.com -> My Apps).");
  }

  const data = await itadFetch(buildUrl());
  const list = data?.list || [];

  const deals = [];
  const seen = new Set();

  for (const item of list) {
    // spesso è "game" ma può essere anche "dlc": se vuoi SOLO giochi, lascia questa riga
    if (item?.type && item.type !== "game") continue;

    const deal = item?.deal;
    if (!deal) continue;

    const cut = Number(deal.cut ?? 0);
    const price = deal?.price?.amount;
    const regular = deal?.regular?.amount;
    const currency = deal?.price?.currency;

    // con ITAD_COUNTRY=IT dovresti essere in EUR
    if (currency && currency !== "EUR") continue;

    if (!(cut >= MIN_DISCOUNT_PCT)) continue;
    if (!(typeof price === "number" && price <= MAX_FINAL_EUR)) continue;

    // escludi “già economici”: regolare deve essere > soglia
    if (!(typeof regular === "number" && regular > MAX_FINAL_EUR)) continue;

    const key = `${item.id}|${cut}|${price}|${regular}`;
    if (seen.has(key)) continue;
    seen.add(key);

    deals.push({
      title: item.title || item.slug || "Senza titolo",
      url: deal.url || `https://isthereanydeal.com/game/${item.slug}/`,
      discountPercent: cut,
      originalEur: regular,
      finalEur: price,
      originalPriceText: fmtEuro(regular),
      finalPriceText: fmtEuro(price),
      end: deal.expiry ? new Date(deal.expiry) : null,
    });
  }

  // separa FREE (0,00€) e “AAA boost” sugli altri
  const free = deals
    .filter(d => d.finalEur === 0)
    .sort((a, b) => (b.originalEur ?? 0) - (a.originalEur ?? 0) || (b.discountPercent ?? 0) - (a.discountPercent ?? 0));

  const paid = deals
    .filter(d => d.finalEur !== 0)
    .sort((a, b) =>
      (b.originalEur ?? 0) - (a.originalEur ?? 0) ||        // AAA boost
      (b.discountPercent ?? 0) - (a.discountPercent ?? 0) || // più sconto
      (a.finalEur ?? 999) - (b.finalEur ?? 999) ||          // poi più economico
      a.title.localeCompare(b.title)
    );

  // output: prima gratis, poi “grossi”
  return [...free, ...paid].slice(0, MAX_RESULTS);
}
