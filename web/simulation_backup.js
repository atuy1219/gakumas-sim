import { restoreTowerTurnState, serializeTowerTurnState } from "./tower_runtime.js";

const CATALOG_KEYS = ["cardById", "cardVariantByKey", "customizeById", "growEffectById", "examEffectById",
  "examStatusEnchantById", "examTriggerById", "cardSearchById", "cardRandomPoolById", "cardStatusEnchantById", "cardPoolById"];
export function createSimulationBackup(state, mode, now = new Date()) {
  if (!state || !["exam", "tower"].includes(mode)) throw new Error("保存するシミュレーションがありません。");
  const events = state.simulationLog?.events ?? [];
  return {
    format: "gakumas-sim-progress", version: 1, mode, createdAt: now.toISOString(), seed: state.seed,
    currentTurn: state.turn,
    turns: (state.simulationLog?.turns ?? []).map(turn => ({ ...turn,
      attribute: turn.scoreContext?.parameterType ?? "",
      multiplierPercent: turn.scoreContext?.battleBonusPermil == null ? null : turn.scoreContext.battleBonusPermil / 10,
      events: events.filter(event => event.turn === turn.turn),
    })),
    // A checkpoint also includes resolved catalogs so a later master update
    // cannot silently change the result after resuming this backup.
    checkpoint: serializeTowerTurnState(state),
    catalogs: Object.fromEntries(CATALOG_KEYS.map(key => [key, [...(state[key]?.entries?.() ?? [])]])),
  };
}
export function stringifySimulationBackup(backup) {
  return JSON.stringify(backup, (_, value) => typeof value === "number" && !Number.isFinite(value)
    ? { __gakumasSimNumber: String(value) } : value, 2) + "\n";
}
export function parseSimulationBackup(input) {
  let value;
  try {
    value = typeof input === "string" ? JSON.parse(input, (_, item) => {
      if (item?.__gakumasSimNumber === "Infinity") return Infinity;
      if (item?.__gakumasSimNumber === "-Infinity") return -Infinity;
      return item;
    }) : input;
  } catch { throw new Error("途中経過JSONを読み込めませんでした。"); }
  if (value?.format !== "gakumas-sim-progress" || value.version !== 1 || !["exam", "tower"].includes(value.mode)) {
    throw new Error("対応する途中経過バックアップではありません。");
  }
  const catalogs = {};
  for (const key of CATALOG_KEYS) {
    const rows = value.catalogs?.[key];
    if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string")) {
      throw new Error("バックアップの効果・カードデータが不正です。");
    }
    catalogs[key] = new Map(rows);
  }
  const state = restoreTowerTurnState(value.checkpoint, catalogs);
  if (!Number.isInteger(state.turn) || state.turn < 0 || !Number.isInteger(state.seed)
    || !state.exam || !Number.isFinite(state.exam.stamina) || !Number.isFinite(state.exam.parameter)
    || !Number.isFinite(state.playsRemaining) || !Array.isArray(state.history)
    || !["hand", "deck", "discard", "lost", "hold"].every(key => Array.isArray(state[key]))
    || !Array.isArray(state.effectScheduler?.registrations)
    || (state.simulationLog && (!Array.isArray(state.simulationLog.events) || !Array.isArray(state.simulationLog.turns)
      || state.simulationLog.turns.some(turn => !Array.isArray(turn.handAdded) || !Array.isArray(turn.usedCards))))) {
    throw new Error("バックアップのシミュレーション状態が不正です。");
  }
  return { mode: value.mode, state, createdAt: value.createdAt };
}
