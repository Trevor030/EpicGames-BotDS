// steam.js
// Prende gli sconti "specials" e filtra quelli al 100% (temporaneamente gratuiti)

const STEAM_SPECIALS = "https://store.steampowered.com/api/featuredcategories?l=italian";

function normalizeSteam(app) {
  return {
    title: app.name,
    start: null,
    end: app.discount_expiration ? new Date(app.discount_expiration * 1000) : null,
    url: `https://store.steampowered.com/app/${app.id}`,
  };
}

export async function fetchSteamFreeGames() {
  const res = await fetch(STEAM_SPECIALS);
  if (!res.ok) throw new Error(`Steam fetch failed: ${res.status}`);

  const data = await res.json();
  const specials = data?.specials?.items ?? [];

  return specials
    .filter(app => app.discount_percent === 100 && app.is_free === false)
    .map(normalizeSteam)
    .sort((a, b) => {
      const ae = a.end ? a.end.getTime() : Number.MAX_SAFE_INTEGER;
      const be = b.end ? b.end.getTime() : Number.MAX_SAFE_INTEGER;
      return ae - be;
    });
}
