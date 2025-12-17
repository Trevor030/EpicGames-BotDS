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
const CONFIRM_RUNS = Number(process.env.CONFIRM_RUNS || 2); // ✅ debounce

if (!TOKEN || !CHANNEL_ID) throw new Error("DISCORD_TOKEN o DISCORD_CHANNEL_ID mancanti");

const state = loadState();
let lastHash = state.lastHash || "";
let lastMessageId = state.messageId || null;

let pendingHash = state.pendingHash ?? null;
let pendingCount = state.pendingCount ?? 0;

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

/**
 * ✅ Chiave di cambiamento "anti-rumore":
 * - EPIC: titolo + start/end + url (abbastanza stabile)
 * - STEAM: appId + discountPercent + end (NON prezzi) -> evita falsi cambi per micro-variazioni
 */
function changeKeyEpic(g) {
  return [
    (g.title || "").trim(),
    g.url || "",
    g.start instanceof Date ? g.start.toISOString() : "",
    g.end instanceof Date ? g.end.toISOString() : "",
  ].join("|");
}

function changeKeySteam(g) {
  return `${g.appId}|${g.discountPercent ?? ""}`;
}


function computeChangeHash({ epicCurrent, epicUpcoming, steamDeals }) {
  const eC = [...epicCurrent].map(changeKeyEpic).sort().join(";");
  const eU = [...epicUpcoming].map(changeKeyEpic).sort().join(";");
  const sD = [...steamDeals].map(changeKeySteam).sort().join(";");
  return `EPIC:${eC}||EPIC_UP:${eU}||STEAM:${sD}`;
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

  const content =
    `🔔 **Aggiornamento rilevato** (${reason})\n` +
    `🗓️ Pubblicato: <t:${ts}:F>  •  <t:${ts}:R>`;

  const embed = new EmbedBuilder()
    .setTitle("🎁 Giochi Gratis / Super Sconti – Epic + Steam")
    .addFields(
      { name: "🕒 Aggiornato", value: `**<t:${ts}:F>**\n(<t:${ts}:R>)`, inline: false },
      { name: "✅ Epic – Disponibili ora", value: safeField(currentText(epicCurrent)), inline: false },
      { name: "⏭️ Epic – Prossimi", value: safeField(upcomingText(epicUpcoming)), inline: false },
      { name: `🎮 Steam – Sconti ≥ ${minDisc}% (con prezzi)`, value: steamDealsText(steamDeals), inline: false }
    )
    .setFooter({ text: "Resta sempre 1 messaggio: il precedente viene eliminato." });

  return { content, embed, epicCurrent, epicUpcoming, steamDeals };
}

async function deletePreviousIfAny(channel) {
  if (!lastMessageId) return;
  try {
    const oldMsg = await channel.messages.fetch(lastMessageId);
    await oldMsg.delete();
  } catch {
    // ignoriamo (già cancellato / permessi / non trovato)
  } finally {
    lastMessageId = null;
  }
}

function persist() {
  saveState({
    lastHash,
    lastChangeAt: new Date().toISOString(),
    messageId: lastMessageId,
    pendingHash,
    pendingCount,
  });
}

/**
 * Debounce: notifichiamo solo se lo stesso nuovo hash appare per CONFIRM_RUNS volte consecutive.
 */
function shouldPublishWithDebounce(newHash, force) {
  if (force) {
    pendingHash = null;
    pendingCount = 0;
    return true;
  }

  if (newHash === lastHash) {
    // tornati allo stato noto: reset pending
    pendingHash = null;
    pendingCount = 0;
    persist();
    return false;
  }

  if (pendingHash === newHash) {
    pendingCount += 1;
  } else {
    pendingHash = newHash;
    pendingCount = 1;
  }

  persist();

  return pendingCount >= Math.max(1, CONFIRM_RUNS);
}

async function publishUpdated(client, force = false, reason = "auto") {
  const channel = await client.channels.fetch(CHANNEL_ID);
  const { content, embed, epicCurrent, epicUpcoming, steamDeals } = await buildPayload(reason);

  const newHash = computeChangeHash({ epicCurrent, epicUpcoming, steamDeals });

  if (!shouldPublishWithDebounce(newHash, force)) return;

  // ok confermato: pubblichiamo e resettiamo pending
  pendingHash = null;
  pendingCount = 0;

  await deletePreviousIfAny(channel);

  const sent = await channel.send({ content, embeds: [embed] });

  lastHash = newHash;
  lastMessageId = sent.id;

  persist();

  appendHistory({
    forced: !!force,
    reason,
    epic: {
      current: epicCurrent.map(g => ({ title: g.title, url: g.url, start: g.start?.toISOString(), end: g.end?.toISOString() })),
      upcoming: epicUpcoming.map(g => ({ title: g.title, url: g.url, start: g.start?.toISOString(), end: g.end?.toISOString() })),
    },
    steam: {
      deals: steamDeals.map(g => ({
        appId: g.appId,
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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
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

  // comando unico: pubblica esattamente come l’automatico, ma forzato
  if (cmd === CMD_FREE) {
    try {
      await publishUpdated(client, true, "manual");
      await msg.reply("✅ OK: messaggio aggiornato pubblicato (sostituendo il precedente).");
    } catch (e) {
      console.error(e);
      await msg.reply("❌ Errore durante il recupero delle offerte.");
    }
    return;
  }
});

client.login(TOKEN);
