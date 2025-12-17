// steam.js
// Steam deals via HTML (no JSON), filtro:
// - prezzo scontato <= MAX_FINAL_EUR
// - prezzo originale > MAX_FINAL_EUR (così escludi giochi già sotto 9€)
// - solo giochi con discountPercent > 0

const CC = process.env.STEAM_CC || "IT";
const LANG = process.env.STEAM_LANG || "italian";

const MAX_FINAL_EUR = Number(process.env.STEAM_MAX_FINAL_EUR || 9);
const MAX_RESULTS = Number(process.env.STEAM_MAX_RESULTS || 120);
const PAGE_SIZE = Number(process.env.STEAM_PAGE_SIZE || 50);

function makeHeaders() {
  return {
    "Accept": "text/html, */*;q=0.9",
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    "User-Agent":
      process.env.STEAM_UA ||
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": "https://store.steampowered.com/search/?specials=1",
  };
}

function parseEuroToNumber(txt) {
  // prende "8,99€" / "€8.99" / "8,99 €" -> 8.99
  if (!txt) return null;
  const s = txt.replace(/\s+/g, " ").trim();
  const m = s.match(/(\d+[.,]\d{2})/);
  if (!m) return null;
  return Number(m[1].replace(",", "."));
}

function pickTwoPrices(priceText) {
  // Estrae fino a 2 prezzi dal testo, e li ordina (originale=max, finale=min)
  // Esempi: "35,99€ 3,59€" oppure "€35.99 €3.59"
  const tokens = priceText.match(/(?:€\s*)?\d+[.,]\d{2}\s*€?/g) || [];
  if (tokens.length < 2) return { original: null, final: null, originalText: null, finalText: null };

  const aText = tokens[tokens.length - 2].trim();
  const bText = tokens[tokens.length - 1].trim();
  const a = parseEuroToNumber(aText);
  const b = parseEuroToNumber(bText);

  if (a == null || b == null) return { original: null, final: null, originalText: null, finalText: null };

  const original = Math.max(a, b);
  const final = Math.min(a, b);

  // scegli i testi coerenti con original/final
  const originalText = (original === a ? aText : bText).replace(/\s+/g, " ").trim();
  const finalText = (final === a ? aText : bText).replace(/\s+/g, " ").trim();

  return { original, final, originalText, finalText };
}

function parseSearchHtml(html) {
  const out = [];
  const blocks = html.split('class="search_result_row"');

  for (const b of blocks) {
    const appId =
      b.match(/data-ds-appid="(\d+)"/)?.[1] ||
      b.match(/\/app\/(\d+)/)?.[1];
    if (!appId) continue;

    const title = b.match(/class="title">([^<]+)</)?.[1]?.trim();
    if (!title) continue;

    const discountPercentStr =
      b.match(/class="search_discount[^"]*".*?<span>\s*-(\d+)%\s*<\/span>/s)?.[1];
    const discountPercent = discountPercentStr ? Number(discountPercentStr) : 0;

    // prezzi
    const priceRaw = b.match(/class="search_price[^"]*">([\s\S]*?)<\/div>/)?.[1] || "";
    const priceText = priceRaw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const { original, final, originalText, finalText } = pickTwoPrices(priceText);

    // filtri richiesti:
    // - deve esserci sconto
    // - deve esserci coppia prezzi (originale + scontato)
    // - finale <= 9
    // - originale > 9 (escludi giochi già economici)
    if (!discountPercent || discountPercent <= 0) continue;
    if (original == null || final == null) continue;
    if (!(final <= MAX_FINAL_EUR)) continue;
    if (!(original > MAX_FINAL_EUR)) continue;

    out.push({
      appId: Number(appId),
      title,
      url: `https://store.steampowered.com/app/${appId}`,
      discountPercent,
      originalEur: original,
      finalEur: final,
      originalPriceText: originalText,
      finalPriceText: finalText,
      end: null, // la search HTML non dà sempre una scadenza affidabile
    });
  }

  return out;
}

async function fetchPage(start) {
  // “specials=1” + maxprice=9 + sort by price (così trovi più “sotto 9€”)
  const url =
    `https://store.steampowered.com/search/results/?specials=1&filter=discount&sort_by=Price_ASC` +
    `&maxprice=${encodeURIComponent(String(MAX_FINAL_EUR))}` +
    `&l=${encodeURIComponent(LANG)}&cc=${encodeURIComponent(CC)}` +
    `&start=${start}&count=${PAGE_SIZE}`;

  const res = await fetch(url, { headers: makeHeaders() });
  if (!res.ok) throw new Error(`Steam HTML fetch failed: ${res.status}`);
  return await res.text();
}

export async function fetchSteamDeals() {
  const all = [];
  const seen = new Set();
  let start = 0;

  while (all.length < MAX_RESULTS) {
    const html = await fetchPage(start);
    const items = parseSearchHtml(html);

    if (!items.length) break;

    for (const it of items) {
      const key = `${it.appId}|${it.discountPercent}|${it.finalEur}`;
      if (seen.has(key)) continue;
      seen.add(key);

      all.push(it);
      if (all.length >= MAX_RESULTS) break;
    }

    start += PAGE_SIZE;
  }

  // ordina: prima i più economici, poi più sconto
  all.sort(
    (a, b) =>
      (a.finalEur ?? 999) - (b.finalEur ?? 999) ||
      (b.discountPercent ?? 0) - (a.discountPercent ?? 0) ||
      a.title.localeCompare(b.title)
  );

  return all;
}
