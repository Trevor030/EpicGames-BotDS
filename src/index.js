import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { fetchEpicFreePromos } from "./epic.js";
import { currentText, upcomingText } from "./format.js";
import { loadState, saveState } from "./state.js";
import { appendHistory } from "./history.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const CHECK_MIN = Number(process.env.CHECK_EVERY_MIN || 60);

if (!TOKEN || !CHANNEL_ID) throw new Error("DISCORD_TOKEN o DISCORD_CHANNEL_ID mancanti");

// stato persistente
const state = loadState(); // { lastHash, lastChangeAt }
let lastHash = state.lastHash || "";

function stableKey(g) {
  // più stabile di title+date: include url e start/end
  return [
    (g.title || "").trim(),
    g.url || "",
    g.start instanceof Date ? g.start.toISOString() : String(g.start || ""),
    g.end instanceof Date ? g.end.toISOString() : String(g.end || ""),
  ].join("|");
}

function hashGames(current, upcoming) {
  const c = [...current].map(stableKey).sort().join(";");
  const u = [...upcoming].map(stableKey).sort().join(";");
  return `${c}||${u}`;
}

function safeField(text, fallback = "—") {
  if (!text || !text.trim()) return fallback;
  // Discord embed field value max 1024 chars
  return text.length > 1024 ? text.slice(0, 1021) + "…" : text;
}

async function postEpic(client, force = false) {
  const channel = await client.channels.fetch(CHANNEL_ID);
  const { current, upcoming } = await fetchEpicFreePromos({ debug: false });

  const hash = hashGames(current, upcoming);

  // notify only on real change (persisted)
  if (!force && hash === lastHash) return;

  lastHash = hash;
  saveState({ lastHash, lastChangeAt: new Date().toISOString() });

  // salva storico SOLO quando cambia (o quando forzi)
  appendHistory({
    forced: !!force,
    current: current.map(g => ({ title: g.title, url: g.url, start: g.start?.toISOString(), end: g.end?.toISOString() })),
    upcoming: upcoming.map(g => ({ title: g.title, url: g.url, start: g.start?.toISOString(), end: g.end?.toISOString() })),
  });

  const embed = new EmbedBuilder()
    .setTitle("🎁 Epic Games – Giochi Gratis")
    .addFields(
      { name: "✅ Disponibili ora", value: safeField(currentText(current)), inline: false },
      { name: "⏭️ Prossimi", value: safeField(upcomingText(upcoming)), inline: false }
    )
    .setFooter({ text: "Ti scrivo solo quando cambia qualcosa (zero spam)" });

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

  // qui scegli tu:
  // - force=true: posta sempre al boot
  // - force=false: posta al boot SOLO se cambia rispetto all’ultimo stato salvato
  const FORCE_ON_BOOT = (process.env.FORCE_ON_BOOT || "false").toLowerCase() === "true";

  try {
    await postEpic(client, FORCE_ON_BOOT);
  } catch (e) {
    console.error("Post iniziale fallito:", e);
  }

  setInterval(() => postEpic(client, false).catch(console.error), CHECK_MIN * 60_000);
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const cmd = msg.content.trim();

  if (cmd === "!epic") {
    try {
      await postEpic(client, true);
      await msg.reply("✅ Aggiornamento Epic inviato!");
    } catch (e) {
      console.error(e);
      await msg.reply("❌ Errore durante l’aggiornamento Epic.");
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
      await msg.reply("❌ Debug fallito (vedi log container).");
    }
  }
});

client.login(TOKEN);
