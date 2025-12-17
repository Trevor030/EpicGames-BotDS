// steam.js (SteamDB version)
// Fonte: SteamDB "Current Steam Sales" (HTML table)
// Filtri:
// - finalEur <= MAX_FINAL_EUR
// - discountPercent >= MIN_DISCOUNT_PCT
// - excludeAlreadyCheap: stimiamo originale = final / (1 - discount/100) e richiediamo originale > MAX_FINAL_EUR

const MAX_FINAL_EUR = Number(process.env.STEAM_MAX_FINAL_EUR || 9);
const MIN_DISCOUNT_PCT = Number(process.env.STEAM_MIN_DISCOUNT_PCT || 50);
const MAX_RESULTS = Number(process.env.STEAM_MAX_RESULTS || 60);

// SteamDB mostra EU/Euro a seconda del contesto; qui parse “€” dalla tabella.
const STEAMDB_SALES_URL = process.env.STEAMDB_SALES_URL || "https://steamdb.info/sales/";

function makeHeaders() {
  return {
    "Accept": "text/html, */*;q=0.9",
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    "User-Agent":
      process.env.STEAMDB_UA ||
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": "https://steamdb.info/",
  };
}

function parseEuroNumber(txt) {
  // "2,99€" -> 2.99
  if (!txt) return null;
  const m = txt.match(/(\d+[.,]\d{2})\s*€/);
  if (!m) return null;
  return Number(m[1].replace(",", "."));
}

function estimateOriginal(finalEur, discountPct) {
  if (finalEur == null || !discountPct) return null;
  const f = 1 - discountPct / 100;
  if (f <= 0) return null;
  return finalEur / f;
}

function formatEuro(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  // 2 decimali con virgola
  return `${n.toFixed(2).replace(".", ",")}€`;
}

function parseSteamDbSales(html) {
  // Pattern robusto:
  // 1) trova link /app/<appid>/ e titolo
  // 2) nelle immediate vicinanze trova "-XX% YY,YY€"
  //
  // Esempio (dal testo pagina):
  // Assassin's Creed® Origins ... -90% 5,99€
  const out = [];
  const re = /href="\/app\/(\d+)\/"[^>]*>([^<]+)<\/a>[\s\S]{0,250}?-([0-9]{1,3})%\s+([0-9]+[.,][0-9]{2})€/g;

  let m;
  while ((m = re.exec(html)) !== null) {
    const appId = Number(m[1]);
    const title = (m[2] || "").trim();
    const discountPercent = Number(m[3]);
    const finalEur = Number(String(m[4]).replace(",", "."));

    if (!appId || !title) continue;
    if (!Number.isFinite(finalEur)) continue;

    out.push({
      appId,
      title,
      url: `https://store.steampowered.com/app/${appId}`,
      discountPercent,
      finalEur,
      end: null,
    });
  }

  // dedupe per appId (tieni la prima occorrenza)
  const seen = new Set();
  return out.filter(x => (seen.has(x.appId) ? false : (seen.add(x.appId), true)));
}

export async function fetchSteamDeals() {
  const res = await fetch(STEAMDB_SALES_URL, { headers: makeHeaders() });
  if (!res.ok) throw new Error(`SteamDB fetch failed: ${res.status}`);
  const html = await res.text();

  let deals = parseSteamDbSales(html);

  // filtri
  deals = deals.filter(d => (d.discountPercent || 0) >= MIN_DISCOUNT_PCT);
  deals = deals.filter(d => (d.finalEur ?? 999) <= MAX_FINAL_EUR);

  // escludi giochi “già economici” stimando il prezzo originale
  deals = deals
    .map(d => {
      const orig = estimateOriginal(d.finalEur, d.discountPercent);
      return {
        ...d,
        originalEur: orig,
        originalPriceText: orig ? formatEuro(orig) : null,
        finalPriceText: formatEuro(d.finalEur),
      };
    })
    .filter(d => {
      // se non riesco a stimare, lo tengo comunque (ma in pratica orig c’è sempre con discount>0)
      if (typeof d.originalEur !== "number") return true;
      return d.originalEur > MAX_FINAL_EUR;
    });

  // ordina: più economici prima, poi sconto più alto
  deals.sort(
    (a, b) =>
      (a.finalEur ?? 999) - (b.finalEur ?? 999) ||
      (b.discountPercent ?? 0) - (a.discountPercent ?? 0) ||
      a.title.localeCompare(b.title)
  );

  return deals.slice(0, MAX_RESULTS);
}
