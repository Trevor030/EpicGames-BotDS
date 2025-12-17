function steamDealsText(deals) {
  if (!deals) return "⚠️ Steam (ITAD): errore nel recupero (riprovare più tardi).";
  if (!deals.length) return "—";

  const top = deals.slice(0, 10);
  const lines = top.map(g => {
    const pricePart =
      g.originalPriceText && g.finalPriceText
        ? `💸 ${g.originalPriceText} → **${g.finalPriceText}** (-${g.discountPercent}%)`
        : `(-${g.discountPercent ?? "?"}%)`;

    const endPart =
      g.end instanceof Date
        ? `\n⏳ Fine: <t:${Math.floor(g.end.getTime() / 1000)}:R>`
        : "";

    return `• **${g.title}**\n${pricePart}${endPart}\n${g.url}`;
  });

  const extra = deals.length > 10 ? `\n\n(+${deals.length - 10} altri)` : "";
  return safeField(lines.join("\n\n") + extra);
}
