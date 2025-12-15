import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { fetchEpicFreePromos } from "./epic.js";
import { currentText, upcomingText } from "./format.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const CHECK_MIN = Number(process.env.CHECK_EVERY_MIN || 60);

if (!TOKEN || !CHANNEL_ID) throw new Error("DISCORD_TOKEN o DISCORD_CHANNEL_ID mancanti");

let lastHash = "";

function hashGames(current, upcoming) {
  const c = current.map(g => `${g.title}|${g.end.toISOString()}`).join(";");
  const u = upcoming.map(g => `${g.title}|${g.start.toISOString()}`).join(";");
  return `${c}||${u}`;
}

async function postEpic(client, force = false) {
  const channel = await client.channels.fetch(CHANNEL_ID);
  const { current, upcoming } = await fetchEpicFreePromos({ debug: false });

  const hash = hashGames(current, upcoming);
  if (!force && hash === lastHash) return;
  lastHash = hash;

  const embed = new EmbedBuilder()
    .setTitle("🎁 Epic Games – Giochi Gratis")
    .addFields(
      { name: "✅ Disponibili ora", value: currentText(current), inline: false },
      { name: "⏭️ Prossimi", value: upcomingText(upcoming), inline: false }
    )
    .setFooter({ text: "Promo FREE (free-claim) via feed Epic" });

  await channel.send({ embeds: [embed] });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("clientReady", async () => {
  console.log(`🤖 Loggato come ${client.user.tag}`);

  try {
    await postEpic(client, true);
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
