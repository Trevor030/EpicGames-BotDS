import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { fetchEpicFreePromos } from "./epic.js";
import { fetchSteamFreeGames } from "./steam.js";
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
  ].join("|");
}

function hashAll({ epicCurrent, epicUpcoming, steamCurrent }) {
  const eC = [...epicCurrent].map(stableKey).sort().join(";");
  const eU = [...epicUpcoming].map(stableKey).sort().join(";");
  const sC = [...steamCurrent].map(stableKey).sort().join(";");
  return `EPIC:${eC}||EPIC_UP:${eU}||STEAM:${sC}`;
}

function safeField(text, fallback = "—") {
  if (!text || !text.trim()) return fallback;
  return text.length > 1024 ? text.slice(0, 1021) + "…" : text;
}

function steamText(games) {
  if (!games?.length) return "—";
  const lines = games.slice(0, 10).map(g => {
    const end = g.end
      ? `\n⏳ Fine: <t:${Math.floor(g.end.getTime() / 1000)}:R>`
      : "";
    return `• ${g.title}\n${g.url}${end}`;
  });
  const extra = games.length > 10 ? `\n\n(+${games.length - 10} altri)` : "";
  return safeField(lines.join("\n\n") + extra);
}

async function buildEmbed() {
  const [{ current: epicCurrent, upcoming: epicUpcoming }, steamCurrent] =
    await Promise.all([
      fetchEpicFreePromos({ debug: false }),
      fetchSteamFreeGames(),
    ]);

  const embed = new EmbedBuilder()
    .setTitle("🎁 Giochi Gratis – Epic + Steam")
    .addFields(
      { name: "✅ Epic – Disponibili ora", value: safeField(currentText(epicCurrent)), inline: false },
      { name: "⏭️ Epic – Prossimi", value: safeField(upcomingText(epicUpcoming)), inline: false },
      { name: "🎮 Steam – Temporaneamente gratuiti", value: steamText(steamCurrent), inline: false }
    )
    .setFooter({ text: "Notifico solo quando cambia qualcosa (zero spam)" });

  return { embed, epicCurrent, epicUpcoming, steamCurrent };
}

/**
 * Posta l'embed:
 * - force=false: solo se cambia rispetto all'ultimo hash salvato
 * - force=true: posta sempre (comando manuale o boot forzato)
 */
async function postFreebies(client, force = false, where = "channel") {
  const channel = await client.channels.fetch(CHANNEL_ID);
  const { embed, epicCurrent, epicUpcoming, steamCurrent } = await buildEmbed();

  const hash = hashAll({ epicCurrent, epicUpcoming, steamCurrent });

  if (!force && hash === lastHash) return;

  lastHash = hash;
  saveState({ lastHash, lastChangeAt: new Date().toISOString() });

  // Storico SOLO quando inviamo davvero un post (automatico o forzato)
  appendHistory({
    forced: !!force,
    epic: {
      current: epicCurrent.map(g => ({ title: g.title, url: g.url, start: g.start?.toISOString(), end: g.end?.toISOString() })),
      upcoming: epicUpcoming.map(g => ({ title: g.title, url: g.url, start: g.start?.toISOString(), end: g.end?.toISOString() })),
    },
    steam: {
      current: steamCurrent.map(g => ({ title: g.title, url: g.url, end: g.end?.toISOString?.() ?? null })),
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

  // Se vuoi che al boot posti comunque (anche senza cambiamento):
  // FORCE_ON_BOOT=true
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

  // ✅ COMANDO UNICO:
  // mostra "quello che uscirebbe automatico", forzando il post (stesso embed)
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

  // Il tuo debug Epic rimane disponibile
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
