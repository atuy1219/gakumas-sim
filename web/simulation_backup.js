import { cardMatchesMasterSearch, restoreTowerTurnState, serializeTowerTurnState } from "./tower_runtime.js";

import { parseExamEffectId, parseExamEffectMaster } from "./exam_effects.js";

const CATALOG_KEYS = ["cardById", "cardVariantByKey", "customizeById", "growEffectById", "examEffectById",
  "examStatusEnchantById", "examTriggerById", "cardSearchById", "cardRandomPoolById", "cardStatusEnchantById", "cardPoolById"];
// Follow references from the actual checkpoint, including future generated
// cards, upgrades, random pools and chained effects. Keep catalog iteration
// order: generation can consume RNG once per candidate in that order.
function requiredCatalogs(state, checkpoint) {
  const wanted = Object.fromEntries(CATALOG_KEYS.map(key => [key, new Set()]));
  const references = new Map();
  const variants = new Map();
  for (const key of CATALOG_KEYS) for (const [id, row] of state[key] ?? []) {
    if (!references.has(id)) references.set(id, []);
    references.get(id).push({ key, id, row });
    if (key === "cardVariantByKey") {
      if (!variants.has(row.id)) variants.set(row.id, []);
      variants.get(row.id).push(id);
    }
  }
  const queue = [checkpoint];
  const seen = new Set();
  const add = (key, id, row) => {
    if (wanted[key].has(id)) return;
    wanted[key].add(id); queue.push(row);
  };
  const reference = id => {
    for (const item of references.get(id) ?? []) add(item.key, item.id, item.row);
    for (const variant of variants.get(id) ?? []) {
      add("cardVariantByKey", variant, state.cardVariantByKey.get(variant));
    }
    // Older effects may only encode their targets in the ID.
    if (id.startsWith("e_effect-") && !state.examEffectById?.has(id) && !seen.has(id)) {
      seen.add(id); queue.push(parseExamEffectId(id));
    }
  };
  while (queue.length) {
    const value = queue.pop();
    if (typeof value === "string") { reference(value); continue; }
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (value.effectType?.startsWith("ProduceExamEffectType_")) queue.push(parseExamEffectMaster(value));
    if (value.masterEffectType === "ProduceExamEffectType_ExamCardCreateSearch") {
      const search = state.cardSearchById?.get(value.searchId);
      if (search && !search.produceCardPoolId && !search.produceCardRandomPoolId) {
        for (const [id, card] of state.cardById ?? []) {
          if (cardMatchesMasterSearch(card, search)) reference(id);
        }
      }
    }
    queue.push(...Object.values(value));
  }
  return Object.fromEntries(CATALOG_KEYS.map(key => [key,
    [...(state[key] ?? [])].filter(([id]) => wanted[key].has(id))]));
}

export function createSimulationBackup(state, mode, now = new Date()) {
  if (!state || !["exam", "tower"].includes(mode)) throw new Error("保存するシミュレーションがありません。");
  const events = state.simulationLog?.events ?? [];
  const checkpoint = serializeTowerTurnState(state);
  // Detailed history is stored once in turns, then rebuilt on import.
  delete checkpoint.state.simulationLog;
  return {
    format: "gakumas-sim-progress", version: 2, mode, createdAt: now.toISOString(), seed: state.seed,
    currentTurn: state.turn,
    turns: (state.simulationLog?.turns ?? []).map(turn => ({ ...turn,
      attribute: turn.scoreContext?.parameterType ?? "",
      multiplierPercent: turn.scoreContext?.battleBonusPermil == null ? null : turn.scoreContext.battleBonusPermil / 10,
      events: events.filter(event => event.turn === turn.turn),
    })),
    // A checkpoint also includes resolved catalogs so a later master update
    // cannot silently change the result after resuming this backup.
    checkpoint,
    unassignedEvents: events.filter(event => !(state.simulationLog?.turns ?? []).some(turn => turn.turn === event.turn)),
    catalogs: requiredCatalogs(state, checkpoint),
  };
}
export function stringifySimulationBackup(backup) {
  return JSON.stringify(backup, (_, value) => typeof value === "number" && !Number.isFinite(value)
    ? { __gakumasSimNumber: String(value) } : value) + "\n";
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
  if (value?.format !== "gakumas-sim-progress" || ![1, 2].includes(value.version) || !["exam", "tower"].includes(value.mode)) {
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
  const checkpoint = value.version === 2 ? { ...value.checkpoint, state: { ...value.checkpoint?.state } } : value.checkpoint;
  if (value.version === 2) {
    if (!Array.isArray(value.turns) || !Array.isArray(value.unassignedEvents)
      || value.turns.some(turn => !Array.isArray(turn.events))) throw new Error("バックアップの履歴が不正です。");
    checkpoint.state.simulationLog = { version: 1,
      turns: value.turns.map(({ attribute, multiplierPercent, events, ...turn }) => turn),
      events: [...value.unassignedEvents, ...value.turns.flatMap(turn => turn.events)].sort((a, b) => a.sequence - b.sequence) };
  }
  const state = restoreTowerTurnState(checkpoint, catalogs);
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
