import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { fetchEpicFreePromos } from "./epic.js";
import { fetchSteamDeals } from "./steam.js";
import { currentText, upcomingText } from "./format.js";
import { loadState, saveState } from "./state.js";
import { appendHistory } from "./history.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const CHECK_MIN = Number(process.env.CHECK_EVERY_MIN || 60);

const CMD_FREE = process.env.CMD_FREE || "!free";

if (!TOKEN || !CHANNEL_ID) throw new Error("DISCORD_TOKEN o DISCORD_CHANNEL_ID mancanti");

const state = loadState();
let lastHash = state.lastHash || "";
let lastMessageId = state.messageId || null;

function stableKey(g) {
  return [
    (g.title || "").trim(),
    g.url || "",
    g.start instanceof Date ? g.start.toISOString() : String(g.start || ""),
    g.end instanceof Date ? g.end.toISOString() : String(g.end || ""),
    String(g.discountPercent ?? ""),
    String(g.originalCents ?? ""),
    String(g.finalCents ?? ""),
    String(g.currency ?? ""),
  ].join("|");
}

function hashAll({ epicCurrent, epicUpcoming, steamDeals }) {
  const eC = [...epicCurrent].map(stableKey).sort().join(";");
  const eU = [...epicUpcoming].map(stableKey).sort().join(";");
  const sD = [...steamDeals].map(stableKey).sort().join(";");
  return `EPIC:${eC}||EPIC_UP:${eU}||STEAM_DEALS:${sD}`;
}

function safeField(text, fallback = "—") {
  if (!text || !text.trim()) return fallback;
  return text.length > 1024 ? text.slice(0, 1021) + "…" : text;
}

function steamDealsText(deals) {
  if (!deals?.length) return "—";

  const top = deals.slice(0, 10);

  const lines = top.map(g => {
    const pricePart =
      g.originalPriceText && g.finalPriceText
        ? `💸 ${g.originalPriceText} → **${g.finalPriceText}** (-${g.discountPercent}%)`
        : `(-${g.discountPercent ?? "?"}%)`;

    const endPart = g.end
      ? `\n⏳ Scade: <t:${Math.floor(g.end.getTime() / 1000)}:R>`
      : "";

    return `• **${g.title}**\n${pricePart}\n${g.url}${endPart}`;
  });

  const extra = deals.length > 10 ? `\n\n(+${deals.length - 10} altri)` : "";
  return safeField(lines.join("\n\n") + extra);
}

async function buildPayload(reason) {
  const now = new Date();
  const ts = Math.floor(now.getTime() / 1000);

  const [{ current: epicCurrent, upcoming: epicUpcoming }, steamDeals] =
    await Promise.all([
      fetchEpicFreePromos({ debug: false }),
      fetchSteamDeals(),
    ]);

  const minDisc = Number(process.env.MIN_STEAM_DISCOUNT || 90);

  // AVVISO BEN VISIBILE (testo del messaggio)
  const content =
    `🔔 **Aggiornamento rilevato** (${reason})\n` +
    `🗓️ Pubblicato: <t:${ts}:F>  •  <t:${ts}:R>`;

  // EMBED con data ben leggibile
  const embed = new EmbedBuilder()
    .setTitle("🎁 Giochi Gratis / Super Sconti – Epic + Steam")
    .addFields(
      {
        name: "🕒 Aggiornato",
        value: `**<t:${ts}:F>**\n(<t:${ts}:R>)`,
        inline: false,
      },
      { name: "✅ Epic – Disponibili ora", value: safeField(currentText(epicCurrent)), inline: false },
      { name: "⏭️ Epic – Prossimi", value: safeField(upcomingText(epicUpcoming)), inline: false },
      { name: `🎮 Steam – Sconti ≥ ${minDisc}% (con prezzi)`, value: steamDealsText(steamDeals), inline: false }
    )
    .setFooter({ text: "Il messaggio precedente viene eliminato: resta sempre solo quello aggiornato." });

  return { content, embed, epicCurrent, epicUpcoming, steamDeals };
}

async function deletePreviousIfAny(channel) {
  if (!lastMessageId) return;

  try {
    const oldMsg = await channel.messages.fetch(lastMessageId);
    await oldMsg.delete();
  } catch {
    // se non esiste più / permessi / già cancellato: ignoriamo
  } finally {
    lastMessageId = null;
  }
}

/**
 * Pubblica aggiornamento:
 * - se non cambia nulla e force=false => silenzio
 * - se cambia (o force=true) => cancella il vecchio e manda il nuovo
 */
async function publishUpdated(client, force = false, reason = "auto") {
  const channel = await client.channels.fetch(CHANNEL_ID);

  const { content, embed, epicCurrent, epicUpcoming, steamDeals } = await buildPayload(reason);

  const hash = hashAll({ epicCurrent, epicUpcoming, steamDeals });

  if (!force && hash === lastHash) return;

  // c'è un update vero (o forzato): elimina il vecchio, poi manda il nuovo
  await deletePreviousIfAny(channel);

  const sent = await channel.send({ content, embeds: [embed] });

  // aggiorna stato persistente
  lastHash = hash;
  lastMessageId = sent.id;

  saveState({
    lastHash,
    lastChangeAt: new Date().toISOString(),
    messageId: lastMessageId,
  });

  // storico SOLO quando pubblichiamo davvero
  appendHistory({
    forced: !!force,
    reason,
    epic: {
      current: epicCurrent.map(g => ({ title: g.title, url: g.url, start: g.start?.toISOString(), end: g.end?.toISOString() })),
      upcoming: epicUpcoming.map(g => ({ title: g.title, url: g.url, start: g.start?.toISOString(), end: g.end?.toISOString() })),
    },
    steam: {
      deals: steamDeals.map(g => ({
        title: g.title,
        url: g.url,
        discountPercent: g.discountPercent,
        originalPrice: g.originalPriceText,
        finalPrice: g.finalPriceText,
        end: g.end?.toISOString?.() ?? null,
      })),
    },
  });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("clientReady", async () => {
  console.log(`🤖 Loggato come ${client.user.tag}`);

  const FORCE_ON_BOOT = (process.env.FORCE_ON_BOOT || "false").toLowerCase() === "true";

  try {
    await publishUpdated(client, FORCE_ON_BOOT, "boot");
  } catch (e) {
    console.error("Post iniziale fallito:", e);
  }

  setInterval(() => publishUpdated(client, false, "auto").catch(console.error), CHECK_MIN * 60_000);
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const cmd = msg.content.trim();

  // Comando unico: pubblica ESATTAMENTE come l’automatico,
  // sostituendo il messaggio precedente
  if (cmd === CMD_FREE) {
    try {
      await publishUpdated(client, true, "manual");
      await msg.reply("✅ OK: ho pubblicato il messaggio aggiornato (sostituendo il precedente).");
    } catch (e) {
      console.error(e);
      await msg.reply("❌ Errore durante il recupero delle offerte.");
    }
    return;
  }

  if (cmd === "!epicdebug") {
    try {
      const { debugSamples, current, upcoming } = await fetchEpicFreePromos({ debug: true });

      const lines = (debugSamples || []).map(s =>
        `• ${s.title} | free=${s.freeDetected} | type=${s.discountType ?? "-"} pct=${s.discountPct ?? "-"} | dp=${s.discountPrice ?? "-"} op=${s.originalPrice ?? "-"}`
      );

      await msg.reply(
        "🧪 **EPIC DEBUG (top 10 promo viste)**\n" +
        (lines.length ? lines.join("\n") : "(nessun sample)") +
        `\n\nCurrent found: ${current.length} | Upcoming found: ${upcoming.length}`
      );
    } catch (e) {
      console.error(e);
      await msg.reply("❌ Debug fallito (vedi log).");
    }
  }
});

client.login(TOKEN);
