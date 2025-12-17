// src/steam.js
// Steam deals via IsThereAnyDeal (ITAD) - no scraping.
//
// Features:
// - Steam-only (shops=61)
// - Filters: final <= MAX_FINAL_EUR, cut >= MIN_DISCOUNT_PCT, regular > MAX_FINAL_EUR
// - Exclude mature content if item.mature === true
// - Only type=game
// - Optional strict AAA filtering via keyword list (STEAM_STRICT_AAA=true)
// - Deduplicate editions (Base/Deluxe/Gold/etc): keep ONLY the cheapest variant per normalized title
// - Pagination (multiple pages) so you don't miss big titles

const ITAD_API_KEY = process.env.ITAD_API_KEY;
const ITAD_COUNTRY = process.env.ITAD_COUNTRY || "IT";

const MAX_FINAL_EUR = Number(process.env.STEAM_MAX_FINAL_EUR || 9);
const MIN_DISCOUNT_PCT = Number(process.env.STEAM_MIN_DISCOUNT_PCT || 50);
const MAX_RESULTS = Number(process.env.STEAM_MAX_RESULTS || 60);

const STRICT_AAA = (process.env.STEAM_STRICT_AAA || "false").toLowerCase() === "true";
const AAA_TARGET = Number(process.env.STEAM_AAA_TARGET || 12);

// Keywords separated by |
// Example: "assassin's creed|tomb raider|grand theft auto|elden ring"
const AAA_KEYWORDS_RAW = process.env.STEAM_AAA_KEYWORDS || "";
const AAA_KEYWORDS = AAA_KEYWORDS_RAW
  .split("|")
  .map(s => s.trim())
  .filter(Boolean);

// Prevent false positives from very short tokens (e.g., "ea")
const MIN_TOKEN_LEN = Number(process.env.STEAM_AAA_MIN_TOKEN_LEN || 4);

const STEAM_SHOP_ID = 61;
const ITAD_DEALS_V2 = "https://api.isthereanydeal.com/deals/v2";

function fmtEuro(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  return `${amount.toFixed(2).replace(".", ",")}€`;
}

async function itadGet(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": process.env.ITAD_UA || "epic-steam-discord-bot/1.0",
      "x-api-key": ITAD_API_KEY, // ok even if key is in query
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
  u.searchParams.set("sort", "-cut"); // start from biggest discounts
  return u.toString();
}

/**
 * Normalize title to group editions/variants.
 * Goal: same "game family" should map to same key even if edition differs.
 *
 * Strategy:
 * - lowercase
 * - remove bracketed parts (often edition tags)
 * - remove common separators/punctuation
 * - collapse whitespace
 *
 * NOTE: We do NOT remove edition words here; we want to group broadly but safely.
 */
function normalizeTitleKey(title) {
  let t = (title || "").toLowerCase();

  // remove stuff in parentheses/brackets
  t = t.replace(/\(.*?\)/g, " ");
  t = t.replace(/\[.*?\]/g, " ");

  // normalize separators/punctuation
  t = t.replace(/[:\-–—|•·]/g, " ");

  // collapse spaces
  t = t.replace(/\s+/g, " ").trim();

  return t;
}

/**
 * Robust AAA matcher:
 * - For phrases/long keywords -> substring includes
 * - For short tokens (<=3) -> require word boundary match, and only if it's a "safe" short token (len==3 alnum)
 * - Ignores too-short risky tokens (like "ea") by default
 */
function isAAA(title) {
  if (!AAA_KEYWORDS.length) return true; // if no keywords configured, do not filter
  const t = (title || "").toLowerCase();

  for (const raw of AAA_KEYWORDS) {
    const kw = raw.toLowerCase();
    const compact = kw.replace(/\s+/g, "");

    // short token handling
    if (compact.length <= 3) {
      // ignore dangerous short tokens unless exactly 3 alnum (e.g., "gta" ok)
      const okShort = /^[a-z0-9]{3}$/.test(compact);
      if (!okShort) continue;
      if (compact.length < MIN_TOKEN_LEN) {
        const re = new RegExp(`\\b${compact}\\b`, "i");
        if (re.test(t)) return true;
        continue;
      }
    }

    // for normal keywords: simple includes
    if (t.includes(kw)) return true;
  }

  return false;
}

export async function fetchSteamDeals() {
  if (!ITAD_API_KEY) {
    throw new Error("ITAD_API_KEY mancante (registrala in isthereanydeal.com -> My Apps).");
  }

  // In strict AAA mode, we want to *display* about AAA_TARGET,
  // but we should scan more to avoid missing titles.
  const want = STRICT_AAA ? Math.max(1, AAA_TARGET) : Math.max(10, Math.min(MAX_RESULTS, 200));

  const pageSize = 200;
  const maxPages = Number(process.env.ITAD_MAX_PAGES || 10);

  // Dedupe map: key = normalized title; value = cheapest deal object
  const byGame = new Map();

  // Also dedupe identical item variants by id+price+cut to reduce noise
  const seenRaw = new Set();

  let offset = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const data = await itadGet(buildDealsUrl(offset, pageSize));
    const list = data?.list || [];
    if (!list.length) break;

    for (const item of list) {
      if (!item?.deal) continue;

      // only games
      if (item.type && item.type !== "game") continue;

      // exclude mature
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

      // strict AAA filter
      if (STRICT_AAA && !isAAA(title)) continue;

      const rawKey = `${item.id}|${cut}|${price}|${regular}`;
      if (seenRaw.has(rawKey)) continue;
      seenRaw.add(rawKey);

      const candidate = {
        id: item.id,
        title,
        url: deal.url || `https://isthereanydeal.com/game/${item.slug}/`,
        discountPercent: cut,
        originalEur: regular,
        finalEur: price,
        originalPriceText: fmtEuro(regular),
        finalPriceText: fmtEuro(price),
        end: deal.expiry ? new Date(deal.expiry) : null,
      };

      // ✅ DEDUPE EDITIONS: keep the cheapest variant among same "game family"
      const gameKey = normalizeTitleKey(title);
      const existing = byGame.get(gameKey);

      if (!existing) {
        byGame.set(gameKey, candidate);
      } else {
        // keep the cheapest
        if ((candidate.finalEur ?? 999) < (existing.finalEur ?? 999)) {
          byGame.set(gameKey, candidate);
        } else if (
          (candidate.finalEur ?? 999) === (existing.finalEur ?? 999) &&
          (candidate.discountPercent ?? 0) > (existing.discountPercent ?? 0)
        ) {
          // tie-breaker: higher discount
          byGame.set(gameKey, candidate);
        }
      }
    }

    // stop paging early only if we already have "enough" unique matches
    // (but we still might miss a specific title; increase ITAD_MAX_PAGES if needed)
    const uniqueCount = byGame.size;
    if (uniqueCount >= want * 3) break; // collect more than needed, then we sort & slice

    if (!data?.hasMore) break;
    offset = Number(data?.nextOffset ?? (offset + pageSize));
    if (!Number.isFinite(offset)) break;
  }

  const uniqueGames = Array.from(byGame.values());

  // Sort: for strict AAA, prefer bigger originals (often more "known") then discount then final price
  uniqueGames.sort((a, b) =>
    (b.originalEur ?? 0) - (a.originalEur ?? 0) ||
    (b.discountPercent ?? 0) - (a.discountPercent ?? 0) ||
    (a.finalEur ?? 999) - (b.finalEur ?? 999) ||
    a.title.localeCompare(b.title)
  );

  // Final slice
  if (STRICT_AAA) return uniqueGames.slice(0, want);
  return uniqueGames.slice(0, Math.min(MAX_RESULTS, uniqueGames.length));
}
