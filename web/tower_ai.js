import {
  TowerCardSelectionRequired,
  drawTowerTurn,
  finishTowerTurn,
  playTowerCard,
} from "./tower_runtime.js";

export const TOWER_AI_FEATURE_NAMES = Object.freeze([
  "turnsRemaining", "parameter", "stamina", "maxStamina", "block", "review",
  "aggressive", "lessonBuff", "parameterBuff", "fullPowerPoint", "playsRemaining",
  "handCount", "deckCount", "discardCount", "lostCount", "timerCount",
  "scheduledEffectCount", "unsupportedCount",
]);

const SHARED_STATE_KEYS = new Set([
  "cardById", "cardVariantByKey", "examEffectById", "examStatusEnchantById",
  "examTriggerById", "cardSearchById", "examScoreSettings", "towerProfile",
  "pItems", "gimmicks", "parameterBonus", "turnParameterTypes", "stageConfig",
  "effectiveParameters",
]);

const OMIT_FROM_STATE_KEY = new Set([
  ...SHARED_STATE_KEYS,
  "history", "initialDeck", "shuffledInitialDeck", "turnStartEffects",
]);

function cloneValue(value, seen = new Map()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    for (const item of value) result.push(cloneValue(item, seen));
    return result;
  }
  if (value instanceof Map) {
    const result = new Map();
    seen.set(value, result);
    for (const [key, item] of value) result.set(key, cloneValue(item, seen));
    return result;
  }
  if (value instanceof Set) {
    const result = new Set();
    seen.set(value, result);
    for (const item of value) result.add(cloneValue(item, seen));
    return result;
  }
  const result = {};
  seen.set(value, result);
  for (const [key, item] of Object.entries(value)) result[key] = cloneValue(item, seen);
  return result;
}

export function cloneTowerStateForAi(state) {
  const clone = {};
  for (const [key, value] of Object.entries(state ?? {})) {
    if (key === "history") clone[key] = [...(value ?? [])];
    else clone[key] = SHARED_STATE_KEYS.has(key) ? value : cloneValue(value);
  }
  return clone;
}

function cardIdentity(card, index = 0) {
  return String(card?.token ?? `${card?.id ?? ""}@@${card?.upgradeCount ?? 0}@@${index}`);
}

export function towerAiActionKey(action) {
  if (action?.type === "end") return "end";
  if (action?.type === "play") {
    const selections = action.selectionPlan?.length ? `:${JSON.stringify(action.selectionPlan)}` : "";
    return `play:${String(action.token ?? "")}${selections}`;
  }
  throw new Error(`未知のドル道AI操作です: ${String(action?.type ?? "")}`);
}

function resolveAction(state, actionInput) {
  if (typeof actionInput !== "string") return actionInput;
  if (actionInput === "end") return { type: "end" };
  if (!actionInput.startsWith("play:")) return null;
  const body = actionInput.slice(5);
  const selectionStart = body.indexOf(":[");
  const token = selectionStart < 0 ? body : body.slice(0, selectionStart);
  const selectionPlan = selectionStart < 0 ? [] : JSON.parse(body.slice(selectionStart + 1));
  const index = (state.hand ?? []).findIndex((card, cardIndex) => cardIdentity(card, cardIndex) === token);
  return index < 0 ? null : { type: "play", index, token, card: state.hand[index], selectionPlan };
}

function combinations(values, count, start = 0, prefix = [], output = []) {
  if (prefix.length === count) {
    output.push([...prefix]);
    return output;
  }
  for (let index = start; index <= values.length - (count - prefix.length); index += 1) {
    prefix.push(values[index]);
    combinations(values, count, index + 1, prefix, output);
    prefix.pop();
  }
  return output;
}

function enumeratePlaySelectionPlans(state, index, plan = [], output = []) {
  const trial = cloneTowerStateForAi(state);
  trial.requireCardSelections = true;
  trial.aiCardSelectionPlan = plan.map((selection) => [...selection]);
  trial.aiCardSelectionCursor = 0;
  try {
    playTowerCard(trial, index);
    output.push(plan.map((selection) => [...selection]));
    return output;
  } catch (error) {
    if (!(error instanceof TowerCardSelectionRequired) && error?.code !== "TOWER_CARD_SELECTION_REQUIRED") {
      return output;
    }
    const identities = error.candidates.map((candidate) => candidate.identity);
    for (let count = error.min; count <= error.max; count += 1) {
      for (const selection of combinations(identities, count)) {
        enumeratePlaySelectionPlans(state, index, [...plan, selection], output);
      }
    }
    return output;
  }
}

export function enumerateTowerAiActions(state, { includeEnd = true } = {}) {
  if (state?.ended) return [];
  const actions = [];
  if (Number(state?.playsRemaining ?? 0) > 0) {
    for (let index = 0; index < (state.hand ?? []).length; index += 1) {
      const card = state.hand[index];
      for (const selectionPlan of enumeratePlaySelectionPlans(state, index)) {
        actions.push({
          type: "play",
          index,
          token: cardIdentity(card, index),
          card,
          selectionPlan,
        });
      }
    }
  }
  if (includeEnd && ((state.hand?.length ?? 0) || (state.currentTurnPlays?.length ?? 0))) {
    actions.push({ type: "end" });
  }
  return actions;
}

export function applyTowerAiAction(state, actionInput, { drawPerTurn = 3 } = {}) {
  const next = cloneTowerStateForAi(state);
  const action = resolveAction(next, actionInput);
  if (!action) throw new Error(`現在の状態では選べない操作です: ${String(actionInput)}`);
  if (action.type === "play") {
    const index = (next.hand ?? []).findIndex((card, cardIndex) => (
      cardIdentity(card, cardIndex) === String(action.token ?? cardIdentity(action.card, action.index))
    ));
    if (index < 0) throw new Error(`使用対象カードが手札にありません: ${action.token}`);
    next.requireCardSelections = true;
    next.aiCardSelectionPlan = (action.selectionPlan ?? []).map((selection) => [...selection]);
    next.aiCardSelectionCursor = 0;
    playTowerCard(next, index);
    next.requireCardSelections = false;
    next.aiCardSelectionPlan = null;
    next.aiCardSelectionCursor = 0;
    return next;
  }
  if (action.type !== "end") throw new Error(`未知のドル道AI操作です: ${action.type}`);
  finishTowerTurn(next, { type: "end" });
  drawTowerTurn(next, Number(drawPerTurn));
  return next;
}

export function isTowerAiTerminal(state) {
  return Boolean(state?.ended)
    || (Number.isFinite(Number(state?.turnLimit))
      && Number(state?.turn ?? 0) >= Number(state.turnLimit)
      && !(state?.hand?.length));
}

function canonical(value, seen = new Set()) {
  if (value === undefined) return ["undefined"];
  if (typeof value === "number" && !Number.isFinite(value)) return [String(value)];
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new Error("AI状態に循環参照があります。");
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = value.map((item) => canonical(item, seen));
  else if (value instanceof Map) {
    result = [...value.entries()]
      .map(([key, item]) => [String(key), canonical(item, seen)])
      .sort(([left], [right]) => left.localeCompare(right));
  } else if (value instanceof Set) {
    result = [...value].map((item) => canonical(item, seen)).sort();
  } else {
    result = {};
    for (const key of Object.keys(value).sort()) {
      if (!OMIT_FROM_STATE_KEY.has(key)) result[key] = canonical(value[key], seen);
    }
  }
  seen.delete(value);
  return result;
}

export function towerAiStateKey(state) {
  const snapshot = {};
  for (const [key, value] of Object.entries(state ?? {})) {
    if (!OMIT_FROM_STATE_KEY.has(key)) snapshot[key] = value;
  }
  if (snapshot.effectScheduler) {
    snapshot.effectScheduler = { ...snapshot.effectScheduler };
    delete snapshot.effectScheduler.trace;
    delete snapshot.effectScheduler.lastEvent;
  }
  return JSON.stringify(canonical(snapshot));
}

export function towerAiFeatureVector(state) {
  const exam = state?.exam ?? {};
  return [
    Math.max(0, Number(state?.turnLimit ?? 0) - Number(state?.turn ?? 0)),
    Number(exam.parameter ?? 0), Number(exam.stamina ?? 0), Number(exam.maxStamina ?? 0),
    Number(exam.block ?? 0), Number(exam.review ?? 0), Number(exam.aggressive ?? 0),
    Number(exam.lessonBuff ?? 0), Number(exam.parameterBuff ?? 0),
    Number(exam.fullPowerPoint ?? 0), Number(state?.playsRemaining ?? 0),
    Number(state?.hand?.length ?? 0), Number(state?.deck?.length ?? 0),
    Number(state?.discard?.length ?? 0), Number(state?.lost?.length ?? 0),
    Number(state?.timers?.length ?? 0),
    Number(state?.effectScheduler?.registrations?.filter((row) => row.active)?.length ?? 0),
    Number(state?.unsupported?.length ?? 0),
  ];
}

export function defaultTowerAiValue(state) {
  const exam = state?.exam ?? {};
  const remaining = Math.max(0, Number(state?.turnLimit ?? 0) - Number(state?.turn ?? 0));
  const futureScale = 1 + remaining * 0.08;
  return Number(exam.parameter ?? 0)
    + Number(exam.review ?? 0) * 0.2 * futureScale
    + Number(exam.aggressive ?? 0) * 0.2 * futureScale
    + Number(exam.lessonBuff ?? 0) * 0.24 * futureScale
    + Number(exam.parameterBuff ?? 0) * 0.24 * futureScale
    + Number(exam.block ?? 0) * 0.05
    + Number(exam.stamina ?? 0) * 0.02
    - Number(state?.unsupported?.length ?? 0) * 1_000_000;
}

function valueOf(state, options) {
  const evaluator = options.stateEvaluator ?? defaultTowerAiValue;
  const value = Number(evaluator(state, {
    features: towerAiFeatureVector(state),
    featureNames: TOWER_AI_FEATURE_NAMES,
    terminal: isTowerAiTerminal(state),
  }));
  if (!Number.isFinite(value)) throw new Error("stateEvaluatorは有限数を返す必要があります。");
  return value;
}

export function evaluateTowerAiBeam(initialState, options = {}) {
  const depth = Math.max(0, Math.trunc(Number(options.depth ?? 4)));
  const beamWidth = Math.max(1, Math.trunc(Number(options.beamWidth ?? 32)));
  let frontier = [cloneTowerStateForAi(initialState)];
  for (let step = 0; step < depth; step += 1) {
    const nextByKey = new Map();
    for (const state of frontier) {
      if (isTowerAiTerminal(state)) {
        nextByKey.set(towerAiStateKey(state), state);
        continue;
      }
      for (const action of enumerateTowerAiActions(state)) {
        let child;
        try { child = applyTowerAiAction(state, action, options); } catch { continue; }
        const key = towerAiStateKey(child);
        const previous = nextByKey.get(key);
        if (!previous || valueOf(child, options) > valueOf(previous, options)) nextByKey.set(key, child);
      }
    }
    if (!nextByKey.size) break;
    frontier = [...nextByKey.values()]
      .sort((left, right) => valueOf(right, options) - valueOf(left, options))
      .slice(0, beamWidth);
    if (frontier.every(isTowerAiTerminal)) break;
  }
  return Math.max(...frontier.map((state) => valueOf(state, options)));
}

export function rankTowerAiActions(state, options = {}) {
  const depth = Math.max(1, Math.trunc(Number(options.depth ?? 4)));
  return enumerateTowerAiActions(state).map((action, order) => {
    const child = applyTowerAiAction(state, action, options);
    return {
      action,
      actionKey: towerAiActionKey(action),
      value: evaluateTowerAiBeam(child, { ...options, depth: depth - 1 }),
      order,
    };
  }).sort((left, right) => (right.value - left.value) || (left.order - right.order));
}

export function runTowerAiEpisode(initialState, options = {}) {
  let state = cloneTowerStateForAi(initialState);
  const decisions = [];
  const maxDecisions = Math.max(1, Math.trunc(Number(options.maxDecisions ?? 512)));
  while (!isTowerAiTerminal(state)) {
    if (decisions.length >= maxDecisions) throw new Error("AI実行が最大操作数を超えました。");
    const ranking = rankTowerAiActions(state, options);
    if (!ranking.length) throw new Error(`合法手がありません（${state.turn}ターン目）。`);
    const selected = ranking[0];
    decisions.push({
      turn: state.turn,
      actionKey: selected.actionKey,
      value: selected.value,
      candidates: ranking.map((entry) => ({ actionKey: entry.actionKey, value: entry.value })),
    });
    state = applyTowerAiAction(state, selected.action, options);
  }
  return {
    state,
    decisions,
    score: Number(state.exam?.parameter ?? 0),
    unsupported: [...(state.unsupported ?? [])],
  };
}
