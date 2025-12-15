import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { fetchFreeGames } from "./epic.js";
import { linesCurrent, linesUpcoming, makeFingerprint } from "./format.js";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const CHECK_EVERY_MIN = Number(process.env.CHECK_EVERY_MIN || 60);
const STATE_PATH = process.env.STATE_PATH || "/data/state.json";
const UPCOMING_LIMIT = Number(process.env.UPCOMING_LIMIT || 5);

if (!DISCORD_TOKEN) throw new Error("Missing DISCORD_TOKEN");
if (!CHANNEL_ID) throw new Error("Missing DISCORD_CHANNEL_ID");

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return { lastFingerprint: "" };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

async function postUpdate(client, force = false) {
  const channel = await client.channels.fetch(CHANNEL_ID);

  const { current, upcoming } = await fetchFreeGames();
  const fp = makeFingerprint(current, upcoming);

  const state = loadState();
  if (!force && state.lastFingerprint === fp) return;

  const emb = new EmbedBuilder()
    .setTitle("🎁 Epic Games – Giochi gratis")
    .setDescription("Aggiornamento automatico delle promo gratuite (orario Europe/Rome).")
    .addFields(
      { name: "✅ Disponibili ora", value: linesCurrent(current), inline: false },
      { name: "⏭️ Prossimi (se disponibili)", value: linesUpcoming(upcoming.slice(0, UPCOMING_LIMIT)), inline: false }
    )
    .setFooter({ text: "Fonte: Epic Games Store promotions feed" });

  await channel.send({ embeds: [emb] });

  state.lastFingerprint = fp;
  saveState(state);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  // post iniziale solo se cambia qualcosa
  await postUpdate(client, false);

  setInterval(async () => {
    try {
      await postUpdate(client, false);
    } catch (e) {
      console.error("Update failed:", e);
    }
  }, CHECK_EVERY_MIN * 60_000);
});

client.on("interactionCreate", async (interaction) => {
  // se in futuro vuoi slash command: /epic
});

client.login(DISCORD_TOKEN);
