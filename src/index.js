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
const CONFIRM_RUNS = Number(process.env.CONFIRM_RUNS || 2);
const FORCE_ON_BOOT = (process.env.FORCE_ON_BOOT || "false").toLowerCase() === "true";

if (!TOKEN || !CHANNEL_ID) throw new Error("DISCORD_TOKEN o DISCORD_CHANNEL_ID mancanti");

const state = loadState();
let lastHash = state.lastHash || "";
let lastMessageId = state.messageId || null;
let pendingHash = state.pendingHash ?? null;
let pendingCount = state.pendingCount ?? 0;

function persist() {
  saveState({
    lastHash,
    lastChangeAt: new Date().toISOString(),
    messageId: lastMessageId,
    pendingHash,
    pendingCount,
  });
}

function safeField(text, fallback = "—") {
  if (!text || !text.trim()) return fallback;
  return text.length > 1024 ? text.slice(0, 1021) + "…" : text;
}

function steamDealsText(deals) {
  if (!deals) return "⚠️ Steam: errore nel recupero (riprovare più tardi).";
  if (!deals.length) return "—";

  const top = deals.slice(0, 10);
  const lines = top.map(g => {
    const price =
      g.originalPriceText && g.finalPriceText
        ? `💸 ${g.originalPriceText} → **${g.finalPriceText}** (-${g.discountPercent}%)`
        : `(-${g.discountPercent ?? "?"}%)`;

    return `• **${g.title}**\n${price}\n${g.url}`;
  });

  const extra = deals.length > 10 ? `\n\n(+${deals.length - 10} altri)` : "";
  return safeField(lines.join("\n\n") + extra);
}

// Chiavi “stabili” per evitare notifiche a caso
function changeKeyEpic(g) {
  return [
    (g.title || "").trim(),
    g.url || "",
    g.start instanceof Date ? g.start.toISOString() : "",
    g.end instanceof Date ? g.end.toISOString() : "",
  ].join("|");
}

function changeKeySteam(g) {
  // appId + prezzo finale numerico + percentuale
  return `${g.appId}|${g.finalEur ?? ""}|${g.discountPercent ?? ""}`;
}

function computeHash({ epicCurrent, epicUpcoming, steamDeals }) {
  const eC = [...epicCurrent].map(changeKeyEpic).sort().join(";");
  const eU = [...epicUpcoming].map(changeKeyEpic).sort().join(";");
  const sD = steamDeals ? [...steamDeals].map(changeKeySteam).sort().join(";") : "STEAM_ERROR";
  return `EPIC:${eC}||EPIC_UP:${eU}||STEAM:${sD}`;
}

function shouldPublishWithDebounce(newHash, force) {
  if (force) {
    pendingHash = null;
    pendingCount = 0;
    return true;
  }

  if (newHash === lastHash) {
    pendingHash = null;
    pendingCount = 0;
    persist();
    return false;
  }

  if (pendingHash === newHash) pendingCount += 1;
  else {
    pendingHash = newHash;
    pendingCount = 1;
  }

  persist();
  return pendingCount >= Math.max(1, CONFIRM_RUNS);
}

async function deletePreviousIfAny(channel) {
  if (!lastMessageId) return;
  try {
    const oldMsg = await channel.messages.fetch(lastMessageId);
    await oldMsg.delete();
  } catch {
    // ignoriamo (non trovato / già cancellato / permessi)
  } finally {
    lastMessageId = null;
  }
}

async function buildPayload(reason) {
  const now = new Date();
  const ts = Math.floor(now.getTime() / 1000);

  const { current: epicCurrent, upcoming: epicUpcoming } =
    await fetchEpicFreePromos({ debug: false });

  // Steam best-effort
  let steamDeals = null;
  try {
    steamDeals = await fetchSteamDeals();
  } catch (e) {
    console.error("Steam fetch failed (ignored):", e);
    steamDeals = null;
  }

  const maxEur = Number(process.env.STEAM_MAX_FINAL_EUR || 9);

  const content =
    `🔔 **Aggiornamento rilevato** (${reason})\n` +
    `🗓️ Pubblicato: <t:${ts}:F>  •  <t:${ts}:R>`;

  const embed = new EmbedBuilder()
    .setTitle("🎁 Giochi Gratis / Offerte – Epic + Steam")
    .addFields(
      { name: "🕒 Aggiornato", value: `**<t:${ts}:F>**\n(<t:${ts}:R>)`, inline: false },
      { name: "✅ Epic – Disponibili ora", value: safeField(currentText(epicCurrent)), inline: false },
      { name: "⏭️ Epic – Prossimi", value: safeField(upcomingText(epicUpcoming)), inline: false },
      { name: `🎮 Steam – Scontati ≤ ${maxEur}€ (ma non già ≤ ${maxEur}€)`, value: steamDealsText(steamDeals), inline: false }
    )
    .setFooter({ text: "Resta sempre 1 messaggio: il precedente viene eliminato." });

  return { content, embed, epicCurrent, epicUpcoming, steamDeals };
}

async function publishUpdated(client, force = false, reason = "auto") {
  const channel = await client.channels.fetch(CHANNEL_ID);

  const { content, embed, epicCurrent, epicUpcoming, steamDeals } = await buildPayload(reason);
  const newHash = computeHash({ epicCurrent, epicUpcoming, steamDeals });

  if (!shouldPublishWithDebounce(newHash, force)) return;

  // confermato → reset pending
  pendingHash = null;
  pendingCount = 0;

  await deletePreviousIfAny(channel);

  const sent = await channel.send({ content, embeds: [embed] });

  lastHash = newHash;
  lastMessageId = sent.id;
  persist();

  appendHistory({ forced: !!force, reason });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ✅ EVENTO GIUSTO: "ready"
client.once("ready", async () => {
  console.log(`🤖 Loggato come ${client.user.tag}`);

  try {
    await publishUpdated(client, true, "boot");
  } catch (e) {
    console.error("Post iniziale fallito:", e);
  }

  setInterval(() => publishUpdated(client, false, "auto").catch(console.error), CHECK_MIN * 60_000);
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const cmd = msg.content.trim();

  if (cmd === CMD_FREE) {
    try {
      await publishUpdated(client, true, "manual");
      await msg.reply("✅ OK: messaggio aggiornato pubblicato (sostituendo il precedente).");
    } catch (e) {
      console.error(e);
      await msg.reply("❌ Errore durante il recupero delle offerte.");
    }
  }
});

client.login(TOKEN);
