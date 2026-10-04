// Human-readable, ordered trace. Parent scopes flush before nested effects so
// a card's change and the P-item reacting to it never share an aggregate delta.
export const SIMULATION_FIELD_LABELS = Object.freeze({
  parameter: "スコア", stamina: "体力", maxStamina: "最大体力", block: "元気", review: "好印象",
  aggressive: "やる気", lessonBuff: "集中", parameterBuff: "好調", parameterBuffMultiplePerTurn: "絶好調",
  playsRemaining: "カード使用回数", fullPowerPoint: "全力値", enthusiastic: "熱意",
  idolStatusType: "指針", idolStatusStep: "指針段階", lessonParameterMultiple: "スコア上昇量増加",
  lessonParameterDown: "スコア上昇量減少", staminaConsumptionAddFix: "消費体力追加",
  staminaConsumptionDownFix: "消費体力減少", reviewAdditivePermil: "好印象効果増加",
  lessonBuffAdditivePermil: "集中効果増加", startTurnCardDrawDown: "手札減少",
  activeEffects: "継続効果", randomState: "乱数状態", turnLimit: "終了ターン",
  parameterVocal: "ボーカルの獲得スコア", parameterDance: "ダンスの獲得スコア", parameterVisual: "ビジュアルの獲得スコア",
  reviewMultiple: "好印象倍率", reviewCountAdd: "好印象の追加発動回数", aggressiveAdditivePermil: "やる気効果増加",
  aggressiveAdditiveFix: "やる気の固定増加", lessonBuffAdditiveFix: "集中の固定増加", lessonBuffMultiple: "集中倍率",
  parameterBuffAdditivePermil: "好調効果増加", lessonDebuff: "集中低下", parameterDebuff: "不調",
  enthusiasticAdditivePermil: "熱意効果増加", enthusiasticMultiple: "熱意倍率", antiDebuffCount: "低下状態無効",
  panic: "不安", slump: "スランプ", staminaConsumptionDown: "消費体力減少の残りターン", staminaConsumptionAdd: "消費体力増加の残りターン",
  blockRestriction: "元気増加不可", staminaRecoverRestriction: "体力回復不可", blockAddDown: "元気増加量減少",
  blockAddDownFix: "元気増加量減少", reviewTurnEndReduceLock: "好印象減少停止", parameterBuffTurnEndReduceLock: "好調減少停止",
  fullPowerPointAdditivePermil: "全力値効果増加", scoreTimedStatuses: "スコア効果の残りターン", genericTimedStatuses: "状態効果の残りターン",
  cardEffectPlayCountBuff: "スキルカード効果の追加発動", timers: "予約効果", searchPlayCardLimits: "カード使用制限",
});
const scopes = new WeakMap();
export function historyCard(card) {
  return { token: String(card?.token ?? ""), id: String(card?.id ?? ""),
    name: String(card?.name ?? card?.id ?? ""), upgradeCount: Number(card?.upgradeCount ?? 0) };
}
function jsonValue(value) {
  if (typeof value === "number" && !Number.isFinite(value)) return value === Infinity ? "infinity" : value === -Infinity ? "-infinity" : null;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  return value;
}
function snapshot(state) {
  const values = {};
  for (const [key, value] of Object.entries(state.exam ?? {})) {
    if (key.endsWith("Settings")) continue;
    values[key] = jsonValue(value);
  }
  Object.assign(values, { playsRemaining: state.playsRemaining, randomState: state.randomState, turnLimit: state.turnLimit,
    cardEffectPlayCountBuff: state.cardEffectPlayCountBuff, timers: state.timers, searchPlayCardLimits: state.searchPlayCardLimits });
  values.activeEffects = (state.effectScheduler?.registrations ?? []).filter(row => row.active).map(row => ({
    registrationId: row.registrationId, id: row.id, sourceType: row.sourceType, sourceId: row.sourceId,
    turns: row.remainingTurns, count: row.remainingCount,
  }));
  const pools = Object.fromEntries(["hand", "deck", "discard", "lost", "hold"].map(key => [key, (state[key] ?? []).map(historyCard)]));
  return { values: jsonValue(values), pools };
}
function log(state) {
  return state.simulationLog ??= { version: 1, events: [], turns: [] };
}
export function currentSimulationSource(state) { return scopes.get(state)?.at(-1)?.source ?? null; }
export function recordSimulationEvent(state, event) {
  if (state.historyTraceEnabled === false) return;
  const target = log(state);
  const row = jsonValue({ sequence: target.events.length + 1, turn: Number(state.traceTurn ?? state.turn ?? 0), ...event });
  target.events.push(row);
  if (row.kind === "handAdded") {
    const turn = target.turns.find(item => item.turn === row.turn);
    if (turn) turn.handAdded.push(...row.cards.map(card => ({ ...card, sequence: row.sequence })));
  }
  if (row.kind === "cardUse") {
    const turn = target.turns.find(item => item.turn === row.turn);
    if (turn) turn.usedCards.push({ ...row.card, sequence: row.sequence, forced: Boolean(row.forced) });
  }
  return row;
}
function flush(state, scope, final = false) {
  const after = snapshot(state), before = scope.before;
  const changes = [];
  for (const field of new Set([...Object.keys(before.values), ...Object.keys(after.values)])) {
    const first = before.values[field] ?? null, last = after.values[field] ?? null;
    if (JSON.stringify(first) === JSON.stringify(last)) continue;
    const change = { field, label: SIMULATION_FIELD_LABELS[field] ?? field, before: first, after: last };
    if (typeof first === "number" && typeof last === "number") change.delta = last - first;
    changes.push(change);
  }
  const moves = [];
  const position = pools => new Map(Object.entries(pools).flatMap(([pool, cards]) => cards.map(card => [card.token, { pool, card }])));
  const from = position(before.pools), to = position(after.pools);
  for (const token of new Set([...from.keys(), ...to.keys()])) {
    const old = from.get(token), next = to.get(token);
    if (old?.pool !== next?.pool) moves.push({ card: next?.card ?? old.card, from: old?.pool ?? "created", to: next?.pool ?? "playing" });
  }
  if (changes.length || moves.length || (final && scope.metadata.recordIfUnchanged && !scope.emitted && !scope.hadNested)) {
    const { recordIfUnchanged, ...metadata } = scope.metadata;
    recordSimulationEvent(state, { kind: "effect", source: scope.source, ...metadata, changes, moves });
    scope.emitted = true;
  }
  scope.before = after;
}
export function traceSimulation(state, source, execute, metadata = {}) {
  if (state.historyTraceEnabled === false) return execute();
  const stack = scopes.get(state) ?? [];
  const parent = stack.at(-1);
  if (parent) { flush(state, parent); parent.hadNested = true; }
  const scope = { source: source ?? parent?.source ?? { type: "system", id: "system", name: "システム" }, metadata: { ...parent?.metadata, ...metadata }, before: snapshot(state) };
  scopes.set(state, stack); stack.push(scope);
  try { return execute(); }
  finally {
    flush(state, scope, true); stack.pop();
    if (parent) parent.before = snapshot(state);
    if (!stack.length) scopes.delete(state);
  }
}
export function beginSimulationTurn(state, turn, scoreContext) {
  if (state.historyTraceEnabled === false) return;
  log(state).turns.push({ turn, scoreContext: jsonValue(scoreContext), handAdded: [], usedCards: [], complete: false });
}
export function endSimulationTurn(state) {
  if (state.historyTraceEnabled === false) return;
  const turn = log(state).turns.find(row => row.turn === state.turn);
  if (turn) { turn.complete = true; turn.valuesAfter = snapshot(state).values; }
}
