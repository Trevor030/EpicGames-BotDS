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
      pendingHash: typeof s.pendingHash === "string" ? s.pendingHash : null,
      pendingCount: typeof s.pendingCount === "number" ? s.pendingCount : 0,
    };
  } catch {
    return { lastHash: "", lastChangeAt: null, messageId: null, pendingHash: null, pendingCount: 0 };
  }
}

export function saveState(state) {
  ensureDir();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}
