// state.js
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "data";
const STATE_PATH = process.env.STATE_PATH || path.join(DATA_DIR, "state.json");

function ensureDir() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
}

export function loadState() {
  try {
    ensureDir();
    const raw = fs.readFileSync(STATE_PATH, "utf-8");
    const s = JSON.parse(raw);
    return {
      lastHash: typeof s.lastHash === "string" ? s.lastHash : "",
      lastChangeAt: typeof s.lastChangeAt === "string" ? s.lastChangeAt : null,
      messageId: typeof s.messageId === "string" ? s.messageId : null,
    };
  } catch {
    return { lastHash: "", lastChangeAt: null, messageId: null };
  }
}

export function saveState(state) {
  ensureDir();
  const payload = {
    lastHash: state.lastHash || "",
    lastChangeAt: state.lastChangeAt || new Date().toISOString(),
    messageId: state.messageId || null,
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(payload, null, 2), "utf-8");
}
