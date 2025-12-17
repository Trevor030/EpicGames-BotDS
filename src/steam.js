// steam.js
// Usa /search/results?force_infinite=1 (JSON). Se Steam risponde HTML, fai fallback parsing diretto.

const MIN_STEAM_DISCOUNT = Number(process.env.MIN_STEAM_DISCOUNT || 90);
const CC = process.env.STEAM_CC || "IT";
const LANG = process.env.STEAM_LANG || "italian";
const PAGE_SIZE = Number(process.env.STEAM_PAGE_SIZE || 50);
const MAX_RESULTS = Number(process.env.STEAM_MAX_RESULTS || 200);

const BASE_URL = "https://store.steampowered.com/search/results/";

function parseResultsHtml(results_html) {
  const out = [];
  const blocks = results_html.split('class="search_result_row"');

  for (const b of blocks) {
    const appId =
      b.match(/data-ds-appid="(\d+)"/)?.[1] ||
      b.match(/\/app\/(\d+)/)?.[1];

    if (!appId) continue;

    const title =
      b.match(/class="title">([^<]+)</)?.[1]?.trim() || "Unknown";

    const discountPercentStr =
      b.match(/class="search_discount[^"]*".*?<span>\s*-(\d+)%\s*<\/span>/s)?.[1];

    const discountPercent = discountPercentStr ? Number(discountPercentStr) : null;

    // prezzi (testo già formattato)
    const priceRaw = b.match(/class="search_price[^"]*">([\s\S]*?)<\/div>/)?.[1] || "";
    const priceText = priceRaw
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const moneyTokens =
      priceText.match(/[\d.,]+ ?[€$£]|[€$£] ?[\d.,]+/g) || [];

    const originalPriceText = moneyTokens.length >= 2 ? moneyTokens[moneyTokens.length - 2] : null;
    const finalPriceText = moneyTokens.length >= 1 ? moneyTokens[moneyTokens.length - 1] : null;

    out.push({
      appId: Number(appId),
      title,
      url: `https://store.steampowered.com/app/${appId}`,
      discountPercent,
      originalPriceText: originalPriceText?.trim() || null,
      finalPriceText: finalPriceText?.trim() || null,
      end: null,
    });
  }

  return out;
}

function makeHeaders() {
  // headers “da browser” (Steam spesso li gradisce)
  return {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    "User-Agent":
      process.env.STEAM_UA ||
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://store.steampowered.com/search/?specials=1",
  };
}

async function fetchSteamPage(start) {
  const url =
    `${BASE_URL}?specials=1&filter=discount&sort_by=Discount_DESC` +
    `&force_infinite=1&l=${encodeURIComponent(LANG)}&cc=${encodeURIComponent(CC)}` +
    `&start=${start}&count=${PAGE_SIZE}`;

  const res = await fetch(url, { headers: makeHeaders() });
  const text = await res.text();

  // Se è JSON, parse; se è HTML, fallback
  if (text.trim().startsWith("{")) {
    const data = JSON.parse(text);
    return { ok: true, resultsHtml: data?.results_html || "" };
  }

  // HTML: a volte Steam restituisce una pagina intera, ma dentro può esserci comunque results_html
  // Se non contiene risultati, segnaliamo non-ok.
  return { ok: false, html: text };
}

export async function fetchSteamDeals() {
  let start = 0;
  const all = [];
  const seen = new Set();

  while (all.length < MAX_RESULTS) {
    const page = await fetchSteamPage(start);

    let items = [];

    if (page.ok) {
      items = parseResultsHtml(page.resultsHtml);
    } else {
      // fallback: proviamo a parsare direttamente l’HTML intero
      items = parseResultsHtml(page.html || "");
      if (!items.length) {
        // Steam ci sta bloccando / non ci dà dati utili
        break;
      }
    }

    if (!items.length) break;

    for (const it of items) {
      const pct = Number(it.discountPercent || 0);
      if (pct < MIN_STEAM_DISCOUNT) continue;

      const key = `${it.appId}|${pct}`;
      if (seen.has(key)) continue;
      seen.add(key);

      all.push(it);
      if (all.length >= MAX_RESULTS) break;
    }

    start += PAGE_SIZE;
  }

  all.sort(
    (a, b) =>
      (b.discountPercent || 0) - (a.discountPercent || 0) ||
      a.title.localeCompare(b.title)
  );

  return all;
}
