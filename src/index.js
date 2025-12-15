import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { fetchEpicGames } from "./epic.js";
import { currentText, upcomingText } from "./format.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const CHECK_MIN = Number(process.env.CHECK_EVERY_MIN || 60);

if (!TOKEN || !CHANNEL_ID) {
  throw new Error("DISCORD_TOKEN o DISCORD_CHANNEL_ID mancanti");
}

let lastHash = "";

function hashGames(c, u) {
  return JSON.stringify(
    [...c.map(g => g.title), ...u.map(g => g.title)]
  );
}

async function postEpic(client, force = false) {
  const channel = await client.channels.fetch(CHANNEL_ID);
  const { current, upcoming } = await fetchEpicGames();

  const hash = hashGames(current, upcoming);
  if (!force && hash === lastHash) return;
  lastHash = hash;

  const embed = new EmbedBuilder()
    .setTitle("🎁 Epic Games – Giochi Gratis")
    .addFields(
      { name: "✅ Disponibili ora", value: currentText(current), inline: false },
      { name: "⏭️ Prossimi", value: upcomingText(upcoming), inline: false }
    )
    .setFooter({ text: "Aggiornamento automatico Epic Games Store" });

  await channel.send({ embeds: [embed] });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", async () => {
  console.log(`🤖 Loggato come ${client.user.tag}`);
  await postEpic(client, true);

  setInterval(() => {
    postEpic(client).catch(console.error);
  }, CHECK_MIN * 60_000);
});

client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  if (msg.content.trim() !== "!epic") return;

  await postEpic(client, true);
  await msg.reply("✅ Aggiornamento Epic inviato!");
});

client.login(TOKEN);
