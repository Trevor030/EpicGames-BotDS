// steam.js
// Steam “full-ish” deals: usa /search/results + force_infinite=1 (JSON) e pagina i risultati.
// Include sconti >= MIN_STEAM_DISCOUNT e mostra prezzo originale + scontato.

const MIN_STEAM_DISCOUNT = Number(process.env.MIN_STEAM_DISCOUNT || 90);
const CC = process.env.STEAM_CC || "IT";          // country code per prezzi
const LANG = process.env.STEAM_LANG || "italian"; // lingua
const PAGE_SIZE = Number(process.env.STEAM_PAGE_SIZE || 50);
const MAX_RESULTS = Number(process.env.STEAM_MAX_RESULTS || 200); // evita di scaricare “tutto Steam”

function formatMoneyFromText(txt) {
  // Nel results_html Steam spesso include già la valuta formattata (es. "4,99€"),
  // quindi qui lo lasciamo com’è.
  return (txt || "").replace(/\s+/g, " ").trim();
}

function parseResultsHtml(results_html) {
  const out = [];
  const blocks = results_html.split('class="search_result_row"');
  for (const b of blocks) {
    // appid: spesso in data-ds-appid o in /app/XXXX
    const appId =
      (b.match(/data-ds-appid="(\d+)"/)?.[1]) ||
      (b.match(/\/app\/(\d+)/)?.[1]);

    if (!appId) continue;

    const title =
      b.match(/class="title">([^<]+)</)?.[1]?.trim() || "Unknown";

    // sconto: "-90%" ecc
    const discountPercentStr = b.match(/class="search_discount[^"]*".*?<span>\s*-(\d+)%\s*<\/span>/s)?.[1];
    const discountPercent = discountPercentStr ? Number(discountPercentStr) : null;

    // prezzi: dentro search_price (può avere "original\nfinal" oppure solo uno)
    const priceRaw = b.match(/class="search_price[^"]*">([\s\S]*?)<\/div>/)?.[1] || "";
    const priceText = priceRaw
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Di solito se c’è sconto forte, trovi due prezzi nel testo.
    // Proviamo a estrarre gli ultimi due “token prezzo”.
    const moneyTokens = priceText.match(/[\d.,]+ ?[€$£]|[€$£] ?[\d.,]+/g) || [];
    const originalPriceText = moneyTokens.length >= 2 ? formatMoneyFromText(moneyTokens[moneyTokens.length - 2]) : null;
    const finalPriceText = moneyTokens.length >= 1 ? formatMoneyFromText(moneyTokens[moneyTokens.length - 1]) : null;

    out.push({
      appId: Number(appId),
      title,
      url: `https://store.steampowered.com/app/${appId}`,
      discountPercent,
      originalPriceText,
      finalPriceText,
      end: null, // lo search results non dà sempre una scadenza affidabile
    });
  }
  return out;
}

export async function fetchSteamDeals() {
  let start = 0;
  const all = [];

  while (all.length < MAX_RESULTS) {
    const url =
      `https://store.steampowered.com/search/results/` +
      `?specials=1&filter=discount&sort_by=Discount_DESC` +
      `&force_infinite=1&l=${encodeURIComponent(LANG)}&cc=${encodeURIComponent(CC)}` +
      `&start=${start}&count=${PAGE_SIZE}`;

    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`Steam search fetch failed: ${res.status}`);

    const data = await res.json();
    const html = data?.results_html || "";
    const pageItems = parseResultsHtml(html);

    if (!pageItems.length) break;

    for (const it of pageItems) {
      // filtra sconto forte
      const pct = Number(it.discountPercent || 0);
      if (pct < MIN_STEAM_DISCOUNT) continue;

      // dedup per appId + pct (evita ripetizioni)
      const key = `${it.appId}|${pct}`;
      if (!all.some(x => `${x.appId}|${x.discountPercent}` === key)) all.push(it);
      if (all.length >= MAX_RESULTS) break;
    }

    start += PAGE_SIZE;
  }

  // ordina: prima sconto più alto, poi alfabetico
  all.sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0) || a.title.localeCompare(b.title));
  return all;
}
