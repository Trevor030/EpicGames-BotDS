// history.js
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "data";
const HISTORY_PATH = process.env.HISTORY_PATH || path.join(DATA_DIR, "history.jsonl");

function ensureDir() {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
}

export function appendHistory(entry) {
  ensureDir();
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  fs.appendFileSync(HISTORY_PATH, line + "\n", "utf-8");
}
