function fmtDate(d) {
  if (!(d instanceof Date)) return "";
  const ts = Math.floor(d.getTime() / 1000);
  return `<t:${ts}:R>`;
}

export function currentText(list) {
  if (!list?.length) return "—";
  return list
    .map(g => `• **${g.title}**\n${g.url}\n⏳ Fine: ${fmtDate(g.end)}`)
    .join("\n\n");
}

export function upcomingText(list) {
  if (!list?.length) return "—";
  return list
    .map(g => `• **${g.title}**\n${g.url}\n🗓️ Inizia: ${fmtDate(g.start)}`)
    .join("\n\n");
}
