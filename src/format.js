function fmtRome(dt) {
  // Europe/Rome
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(dt);
}

export function linesCurrent(games) {
  if (!games.length) return "Niente da segnalare 👀";
  return games
    .map((g) => `• **[${g.title}](${g.url})** — gratis fino a **${fmtRome(g.end)}**`)
    .join("\n");
}

export function linesUpcoming(games) {
  if (!games.length) return "Epic non ha ancora pubblicato i prossimi 👀";
  return games
    .map((g) => `• **[${g.title}](${g.url})** — dal **${fmtRome(g.start)}** al **${fmtRome(g.end)}**`)
    .join("\n");
}

export function makeFingerprint(current, upcoming) {
  const c = current.map((g) => `${g.title}|${g.url}|${g.end.toISOString()}`).join(";");
  const u = upcoming.slice(0, 5).map((g) => `${g.title}|${g.url}|${g.start.toISOString()}`).join(";");
  return `${c}||${u}`;
}
