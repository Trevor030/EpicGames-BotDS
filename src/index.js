import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { fetchEpicFreePromos } from "./epic.js";
import { fetchSteamDeals } from "./steam.js";
import { currentText, upcomingText } from "./format.js";
import { loadState, saveState } from "./state.js";
import { appendHistory } from "./history.js";

/* =======================
   CONFIG
======================= */
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const CHECK_MIN = Number(process.env.CHECK_EVERY_MIN || 60);
const CMD_FREE = process.env.CMD_FREE || "!free";
const CONFIRM_RUNS = Number(process.env.CONFIRM_RUNS || 2);
const FORCE_ON_BOOT = (process.env.FORCE_ON_BOOT || "true").toLowerCase() === "true";

// soglia per considerare un gioco Steam “conosciuto / AAA”
const AAA_ORIGINAL_PRICE = Number(process.env.STEAM_AAA_PRICE || 30);

if (!TOKEN || !CHANNEL_ID) {
  throw new Error("DISCORD_TOKEN o DISCORD_CHANNEL_ID mancanti");
}

/* =======================
   STATE
======================= */
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

/* =======================
   UTILS
======================= */
function safeField(text, fallback = "—") {
  if (!text || !text.trim()) return fallback;
  return text.length > 1024 ? text.slice(0, 1021) + "…" : text;
}

/* =======================
   STEAM FORMAT (AAA FIRST)
======================= */
function steamDealsText(deals) {
  if (!deals) return "⚠️ Steam: errore nel recupero.";
  if (!deals.length) return "—";

  const top = deals.filter(d => (d.originalEur ?? 0) >= AAA_ORIGINAL_PRICE);
  const other = deals.filter(d => (d.originalEur ?? 0) < AAA_ORIGINAL_PRICE);

  const render = (list, limit) =>
    list.slice(0, limit).map(g => {
      const price =
        g.originalPriceText && g.finalPriceText
          ? `💸 ${g.originalPriceText} → **${g.finalPriceText}** (-${g.discountPercent}%)`
          : `(-${g.discountPercent ?? "?"}%)`;

      const end =
        g.end instanceof Date
          ? `\n⏳ Fine: <t:${Math.floor(g.end.getTime() / 1000)}:R>`
          : "";

      return `• **${g.title}**\n${price}${end}\n${g.url}`;
    }).join("\n\n");

  let out = "";

  if (top.length) {
    out +=
   
      render(top, 6) +
      "\n\n";
  }



  return safeField(out.trim());
}

/* =======================
   HASH (ANTI-SPAM)
======================= */
function changeKeyEpic(g) {
  return [
    g.title || "",
    g.url || "",
    g.start instanceof Date ? g.start.toISOString() : "",
    g.end instanceof Date ? g.end.toISOString() : "",
  ].join("|");
}

function changeKeySteam(g) {
  const endIso = g.end instanceof Date ? g.end.toISOString() : "";
  return [
    g.title || "",
    g.finalEur ?? "",
    g.discountPercent ?? "",
    endIso,
  ].join("|");
}

function computeHash({ epicCurrent, epicUpcoming, steamDeals }) {
  const eC = epicCurrent.map(changeKeyEpic).sort().join(";");
  const eU = epicUpcoming.map(changeKeyEpic).sort().join(";");
  const sD = steamDeals
    ? steamDeals.map(changeKeySteam).sort().join(";")
    : "STEAM_ERROR";

  return `EPIC:${eC}||UP:${eU}||STEAM:${sD}`;
}

function shouldPublish(newHash, force) {
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

/* =======================
   DISCORD OPS
======================= */
async function deletePrevious(channel) {
  if (!lastMessageId) return;
  try {
    const msg = await channel.messages.fetch(lastMessageId);
    await msg.delete();
  } catch {
    // ignoriamo
  } finally {
    lastMessageId = null;
  }
}

async function buildPayload(reason) {
  const now = new Date();
  const ts = Math.floor(now.getTime() / 1000);

  const { current: epicCurrent, upcoming: epicUpcoming } =
    await fetchEpicFreePromos({ debug: false });

  let steamDeals = null;
  try {
    steamDeals = await fetchSteamDeals();
  } catch (e) {
    console.error("Steam fetch failed (ignored):", e);
    steamDeals = null;
  }

  const content =
    `🔔 **Aggiornamento offerte** (${reason})\n` +
    `🗓️ Pubblicato: <t:${ts}:F> • <t:${ts}:R>`;

  const embed = new EmbedBuilder()
    .setTitle("🎁 Giochi Gratis & Offerte")
    .addFields(
      {
        name: "🟣 EPIC GAMES — DISPONIBILI ORA",
        value: safeField(currentText(epicCurrent)),
        inline: false,
      },
      {
        name: "🟣 EPIC GAMES — PROSSIMI",
        value: safeField(upcomingText(epicUpcoming)),
        inline: false,
      },
      {
        name: "🔵 STEAM — OFFERTE IN RISALTO",
        value: steamDealsText(steamDeals),
        inline: false,
      }
    )
    .setFooter({
      text: "Epic Games Store + Steam (via IsThereAnyDeal) • messaggio unico aggiornato",
    });

  return { content, embed, epicCurrent, epicUpcoming, steamDeals };
}

async function publish(client, force = false, reason = "auto") {
  const channel = await client.channels.fetch(CHANNEL_ID);

  const { content, embed, epicCurrent, epicUpcoming, steamDeals } =
    await buildPayload(reason);

  const newHash = computeHash({ epicCurrent, epicUpcoming, steamDeals });
  if (!shouldPublish(newHash, force)) return;

  pendingHash = null;
  pendingCount = 0;

  await deletePrevious(channel);
  const sent = await channel.send({ content, embeds: [embed] });

  lastHash = newHash;
  lastMessageId = sent.id;
  persist();

  appendHistory({
    reason,
    forced: force,
    epic_now: epicCurrent.length,
    epic_upcoming: epicUpcoming.length,
    steam_count: steamDeals?.length ?? 0,
  });
}

/* =======================
   CLIENT
======================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let booted = false;
async function onBoot() {
  if (booted) return;
  booted = true;

  console.log(`🤖 Loggato come ${client.user.tag}`);

  try {
    await publish(client, FORCE_ON_BOOT, "boot");
  } catch (e) {
    console.error("Post iniziale fallito:", e);
  }

  setInterval(
    () => publish(client, false, "auto").catch(console.error),
    CHECK_MIN * 60_000
  );
}

// compatibile v14 + v15
client.once("ready", onBoot);
client.once("clientReady", onBoot);

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (msg.content.trim() !== CMD_FREE) return;

  try {
    await publish(client, true, "manual");
    await msg.reply("✅ Offerte aggiornate!");
  } catch (e) {
    console.error(e);
    await msg.reply("❌ Errore durante l’aggiornamento.");
  }
});

client.login(TOKEN);
