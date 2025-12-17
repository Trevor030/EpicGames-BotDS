// steam.js
// Steam via HTML (no JSON): filtra giochi con sconto e prezzo finale <= 9€
// ma esclude quelli che già costavano <= 9€ (originale > 9€)

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
  if (!txt) return null;
  const s = txt.replace(/\s+/g, " ").trim();
  const m = s.match(/(\d+[.,]\d{2})/);
  if (!m) return null;
  return Number(m[1].replace(",", "."));
}

function pickTwoPrices(priceText) {
  const tokens = priceText.match(/(?:€\s*)?\d+[.,]\d{2}\s*€?/g) || [];
  if (tokens.length < 2) return { original: null, final: null, originalText: null, finalText: null };

  const aText = tokens[tokens.length - 2].trim();
  const bText = tokens[tokens.length - 1].trim();
  const a = parseEuroToNumber(aText);
  const b = parseEuroToNumber(bText);
  if (a == null || b == null) return { original: null, final: null, originalText: null, finalText: null };

  const original = Math.max(a, b);
  const final = Math.min(a, b);

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

    const priceRaw = b.match(/class="search_price[^"]*">([\s\S]*?)<\/div>/)?.[1] || "";
    const priceText = priceRaw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const { original, final, originalText, finalText } = pickTwoPrices(priceText);

    // filtri richiesti
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
      end: null,
    });
  }

  return out;
}

async function fetchPage(start) {
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

  all.sort(
    (a, b) =>
      (a.finalEur ?? 999) - (b.finalEur ?? 999) ||
      (b.discountPercent ?? 0) - (a.discountPercent ?? 0) ||
      a.title.localeCompare(b.title)
  );

  return all;
}
