import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { fetchEpicFreePromos } from "./epic.js";
import { fetchSteamDeals } from "./steam.js";
import { currentText, upcomingText } from "./format.js";
import { loadState, saveState } from "./state.js";
import { appendHistory } from "./history.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const CHECK_MIN = Number(process.env.CHECK_EVERY_MIN || 60);

// Comando unico per vedere "quello che uscirebbe automatico"
const CMD_FREE = process.env.CMD_FREE || "!free";

if (!TOKEN || !CHANNEL_ID) throw new Error("DISCORD_TOKEN o DISCORD_CHANNEL_ID mancanti");

// stato persistente
const state = loadState();
let lastHash = state.lastHash || "";

function stableKey(g) {
  return [
    (g.title || "").trim(),
    g.url || "",
    g.start instanceof Date ? g.start.toISOString() : String(g.start || ""),
    g.end instanceof Date ? g.end.toISOString() : String(g.end || ""),
    // Steam extra
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

  // limitiamo per non esplodere l’embed
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

async function buildEmbed() {
  const [{ current: epicCurrent, upcoming: epicUpcoming }, steamDeals] =
    await Promise.all([
      fetchEpicFreePromos({ debug: false }),
      fetchSteamDeals(),
    ]);

  const minDisc = Number(process.env.MIN_STEAM_DISCOUNT || 90);

  const embed = new EmbedBuilder()
    .setTitle("🎁 Giochi Gratis / Super Sconti – Epic + Steam")
    .addFields(
      { name: "✅ Epic – Disponibili ora", value: safeField(currentText(epicCurrent)), inline: false },
      { name: "⏭️ Epic – Prossimi", value: safeField(upcomingText(epicUpcoming)), inline: false },
      { name: `🎮 Steam – Sconti ≥ ${minDisc}% (con prezzi)`, value: steamDealsText(steamDeals), inline: false }
    )
    .setFooter({ text: "Notifico solo quando cambia qualcosa (zero spam)" });

  return { embed, epicCurrent, epicUpcoming, steamDeals };
}

/**
 * Posta l'embed:
 * - force=false: solo se cambia rispetto all'ultimo hash salvato
 * - force=true: posta sempre (comando manuale o boot forzato)
 */
async function postFreebies(client, force = false, where = "channel") {
  const channel = await client.channels.fetch(CHANNEL_ID);
  const { embed, epicCurrent, epicUpcoming, steamDeals } = await buildEmbed();

  const hash = hashAll({ epicCurrent, epicUpcoming, steamDeals });

  if (!force && hash === lastHash) return;

  lastHash = hash;
  saveState({ lastHash, lastChangeAt: new Date().toISOString() });

  appendHistory({
    forced: !!force,
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
    where,
  });

  await channel.send({ embeds: [embed] });
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
    await postFreebies(client, FORCE_ON_BOOT, "boot");
  } catch (e) {
    console.error("Post iniziale fallito:", e);
  }

  setInterval(() => postFreebies(client, false, "interval").catch(console.error), CHECK_MIN * 60_000);
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const cmd = msg.content.trim();

  // ✅ comando unico
  if (cmd === CMD_FREE) {
    try {
      await postFreebies(client, true, "command");
      await msg.reply("✅ Inviato lo stesso messaggio che uscirebbe in automatico.");
    } catch (e) {
      console.error(e);
      await msg.reply("❌ Errore durante il recupero delle offerte.");
    }
    return;
  }

  // debug Epic (come prima)
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
      await msg.reply("❌ Debug fallito (vedi log container).");
    }
  }
});

client.login(TOKEN);
