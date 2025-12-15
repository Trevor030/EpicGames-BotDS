function fmt(dt) {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(dt);
}

export function currentText(games) {
  if (!games.length) return "Nessun gioco gratuito al momento 👀";
  return games
    .map(g => `• **[${g.title}](${g.url})** — fino al **${fmt(g.end)}**`)
    .join("\n");
}

export function upcomingText(games) {
  if (!games.length) return "Epic non ha ancora annunciato i prossimi 🎁";
  return games
    .map(g => `• **[${g.title}](${g.url})** — dal **${fmt(g.start)}**`)
    .join("\n");
}
