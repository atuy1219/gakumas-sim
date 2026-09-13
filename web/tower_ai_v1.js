import {
  drawTowerTurn,
  finishTowerTurn,
  playTowerCard,
} from "./tower_runtime.js";
import {
  evaluateTowerSeedCandidates,
  replayTowerSeed,
} from "./seed_runtime_replay_v13.js";

export const TOWER_SEED_STATUS = Object.freeze({
  UNKNOWN: "unknown",
  CANDIDATES: "candidates",
  FUTURE_EQUIVALENT: "future-equivalent",
  KNOWN: "known",
});

export const DEFAULT_TOWER_AI_WEIGHTS = Object.freeze({
  parameter: 1,
  stamina: 0.05,
  block: 0.08,
  review: 0.18,
  aggressive: 0.18,
  lessonBuff: 0.22,
  parameterBuff: 0.22,
  extraPlay: 4,
  draw: 0.8,
  unsupported: -1000,
  earlyTurnStatusMultiplier: 0.08,
});

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, cloneValue(item)]));
  if (value instanceof Set) return new Set([...value].map(cloneValue));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

export function cloneTowerState(state) {
  return cloneValue(state);
}

function cardToken(card, index = 0) {
  if (card?.token) return String(card.token);
  return `${String(card?.id ?? "")}@@${Number(card?.upgradeCount ?? 0)}@@${index}`;
}

export function towerActionKey(action) {
  if (action?.type === "end") return "end";
  if (action?.type === "play") return `play:${String(action.token ?? "")}`;
  throw new Error(`unknown tower AI action: ${String(action?.type ?? "")}`);
}

function actionForState(state, actionKey) {
  if (actionKey === "end") return { type: "end" };
  if (!String(actionKey).startsWith("play:")) throw new Error(`invalid action key: ${actionKey}`);
  const token = String(actionKey).slice(5);
  const index = (state.hand ?? []).findIndex((card, i) => cardToken(card, i) === token);
  if (index < 0) return null;
  return { type: "play", index, token, card: state.hand[index] };
}

export function enumerateTowerActions(state, { includeEnd = true } = {}) {
  const actions = [];
  for (let index = 0; index < (state.hand ?? []).length; index += 1) {
    const test = cloneTowerState(state);
    try {
      playTowerCard(test, index);
      const card = state.hand[index];
      actions.push({ type: "play", index, token: cardToken(card, index), card });
    } catch {
      // Illegal cards are intentionally omitted. The runtime remains the source
      // of truth for costs and play conditions.
    }
  }
  if (includeEnd && ((state.hand?.length ?? 0) > 0 || (state.currentTurnPlays?.length ?? 0) > 0)) {
    actions.push({ type: "end" });
  }
  return actions;
}

function remainingTurns(state, totalTurns) {
  const effectiveTotal = Math.max(0, Number(totalTurns ?? state.turn ?? 0))
    + Math.max(0, Number(state.exam?.extraTurns ?? 0));
  return Math.max(0, effectiveTotal - Number(state.turn ?? 0));
}

function baseCardValue(card, table) {
  const id = String(card?.id ?? "");
  if (table instanceof Map) return Number(table.get(id) ?? 0) || 0;
  if (table && typeof table === "object") return Number(table[id] ?? 0) || 0;
  return 0;
}

export function scoreTowerCard(state, actionInput, options = {}) {
  const action = typeof actionInput === "string" ? actionForState(state, actionInput) : actionInput;
  if (!action || action.type !== "play") {
    return { legal: false, total: Number.NEGATIVE_INFINITY, terms: {} };
  }
  const weights = { ...DEFAULT_TOWER_AI_WEIGHTS, ...(options.weights ?? {}) };
  const before = cloneTowerState(state);
  const after = cloneTowerState(state);
  const unsupportedBefore = Number(after.unsupported?.length ?? 0);
  try {
    playTowerCard(after, action.index);
  } catch (error) {
    return { legal: false, total: Number.NEGATIVE_INFINITY, terms: {}, error: String(error?.message ?? error) };
  }

  const b = before.exam ?? {};
  const a = after.exam ?? {};
  const turns = remainingTurns(before, options.totalTurns);
  const statusScale = 1 + Math.max(0, turns - 1) * Number(weights.earlyTurnStatusMultiplier ?? 0);
  const terms = {
    base: baseCardValue(action.card, options.cardValues),
    parameter: (Number(a.parameter ?? 0) - Number(b.parameter ?? 0)) * Number(weights.parameter ?? 0),
    stamina: (Number(a.stamina ?? 0) - Number(b.stamina ?? 0)) * Number(weights.stamina ?? 0),
    block: (Number(a.block ?? 0) - Number(b.block ?? 0)) * Number(weights.block ?? 0) * statusScale,
    review: (Number(a.review ?? 0) - Number(b.review ?? 0)) * Number(weights.review ?? 0) * statusScale,
    aggressive: (Number(a.aggressive ?? 0) - Number(b.aggressive ?? 0)) * Number(weights.aggressive ?? 0) * statusScale,
    lessonBuff: (Number(a.lessonBuff ?? 0) - Number(b.lessonBuff ?? 0)) * Number(weights.lessonBuff ?? 0) * statusScale,
    parameterBuff: (Number(a.parameterBuff ?? 0) - Number(b.parameterBuff ?? 0)) * Number(weights.parameterBuff ?? 0) * statusScale,
    extraPlay: (Number(after.playsRemaining ?? 0) - Number(before.playsRemaining ?? 0) + 1) * Number(weights.extraPlay ?? 0),
    draw: (Number(after.hand?.length ?? 0) - Math.max(0, Number(before.hand?.length ?? 0) - 1)) * Number(weights.draw ?? 0),
    unsupported: Math.max(0, Number(after.unsupported?.length ?? 0) - unsupportedBefore) * Number(weights.unsupported ?? 0),
  };
  return { legal: true, total: Object.values(terms).reduce((sum, value) => sum + Number(value || 0), 0), terms, after };
}

export function applyTowerAiAction(state, actionInput, options = {}) {
  const next = cloneTowerState(state);
  const action = typeof actionInput === "string" ? actionForState(next, actionInput) : actionInput;
  if (!action) throw new Error(`action is not available in this state: ${actionInput}`);
  if (action.type === "play") {
    const index = (next.hand ?? []).findIndex((card, i) => cardToken(card, i) === action.token);
    if (index < 0) throw new Error(`play target disappeared: ${action.token}`);
    playTowerCard(next, index);
    return next;
  }
  if (action.type !== "end") throw new Error(`unknown action type: ${action.type}`);

  finishTowerTurn(next, { type: "end" });
  const effectiveTotal = Math.max(0, Number(options.totalTurns ?? next.turn))
    + Math.max(0, Number(next.exam?.extraTurns ?? 0));
  if (Number(next.turn ?? 0) < effectiveTotal) {
    drawTowerTurn(next, Number(options.drawPerTurn ?? 3));
  }
  return next;
}

export function isTowerAiTerminal(state, options = {}) {
  const effectiveTotal = Math.max(0, Number(options.totalTurns ?? state.turn ?? 0))
    + Math.max(0, Number(state.exam?.extraTurns ?? 0));
  return Number(state.turn ?? 0) >= effectiveTotal && (state.hand?.length ?? 0) === 0;
}

function towerStateKey(state) {
  const cardList = (cards) => (cards ?? []).map((card, index) => cardToken(card, index)).join(",");
  const exam = state.exam ?? {};
  return [
    Number(state.turn ?? 0), Number(state.playsRemaining ?? 0), Number(state.randomState ?? 0) >>> 0,
    Number(exam.parameter ?? 0), Number(exam.stamina ?? 0), Number(exam.block ?? 0),
    Number(exam.review ?? 0), Number(exam.aggressive ?? 0), Number(exam.lessonBuff ?? 0),
    Number(exam.parameterBuff ?? 0), Number(exam.extraTurns ?? 0),
    cardList(state.hand), cardList(state.deck), cardList(state.discard), cardList(state.lost),
  ].join("|");
}

function leafValue(state, options) {
  const weights = { ...DEFAULT_TOWER_AI_WEIGHTS, ...(options.weights ?? {}) };
  const exam = state.exam ?? {};
  let value = Number(exam.parameter ?? 0);
  if (isTowerAiTerminal(state, options)) return value;
  const turns = remainingTurns(state, options.totalTurns);
  const statusScale = 1 + Math.max(0, turns - 1) * Number(weights.earlyTurnStatusMultiplier ?? 0);
  value += Number(exam.block ?? 0) * Number(weights.block ?? 0) * statusScale;
  value += Number(exam.review ?? 0) * Number(weights.review ?? 0) * statusScale;
  value += Number(exam.aggressive ?? 0) * Number(weights.aggressive ?? 0) * statusScale;
  value += Number(exam.lessonBuff ?? 0) * Number(weights.lessonBuff ?? 0) * statusScale;
  value += Number(exam.parameterBuff ?? 0) * Number(weights.parameterBuff ?? 0) * statusScale;

  const immediate = enumerateTowerActions(state, { includeEnd: false })
    .map((action) => scoreTowerCard(state, action, options).total)
    .filter(Number.isFinite);
  if (immediate.length) value += Math.max(...immediate) * Number(options.leafHeuristicWeight ?? 1);
  return value;
}

export function evaluateTowerStateBeam(state, options = {}) {
  const depth = Math.max(0, Number(options.depth ?? 4) || 0);
  const beamWidth = Math.max(1, Number(options.beamWidth ?? 16) || 16);
  if (depth === 0 || isTowerAiTerminal(state, options)) return leafValue(state, options);
  let frontier = [cloneTowerState(state)];
  for (let step = 0; step < depth; step += 1) {
    const nextByKey = new Map();
    for (const node of frontier) {
      if (isTowerAiTerminal(node, options)) {
        nextByKey.set(towerStateKey(node), node);
        continue;
      }
      for (const action of enumerateTowerActions(node)) {
        let child;
        try {
          child = applyTowerAiAction(node, action, options);
        } catch {
          continue;
        }
        const key = towerStateKey(child);
        const previous = nextByKey.get(key);
        if (!previous || leafValue(child, options) > leafValue(previous, options)) nextByKey.set(key, child);
      }
    }
    if (!nextByKey.size) break;
    frontier = [...nextByKey.values()]
      .sort((left, right) => leafValue(right, options) - leafValue(left, options))
      .slice(0, beamWidth);
    if (frontier.every((node) => isTowerAiTerminal(node, options))) break;
  }
  return Math.max(...frontier.map((node) => leafValue(node, options)));
}

export function rankTowerActions(state, options = {}) {
  const actions = enumerateTowerActions(state);
  const ranked = [];
  for (const action of actions) {
    let child;
    try {
      child = applyTowerAiAction(state, action, options);
    } catch {
      continue;
    }
    const immediate = action.type === "play" ? scoreTowerCard(state, action, options).total : 0;
    const value = evaluateTowerStateBeam(child, { ...options, depth: Math.max(0, Number(options.depth ?? 4) - 1) });
    ranked.push({ action, actionKey: towerActionKey(action), value, immediate });
  }
  ranked.sort((left, right) => (right.value - left.value) || (right.immediate - left.immediate));
  return ranked;
}

function activeReplayResults(results) {
  return (results ?? []).filter((result) => ["ok", "match", "pending", "uncertain"].includes(result?.status));
}

function futureStateSignature(state) {
  const clone = cloneTowerState(state);
  delete clone.seed;
  delete clone.history;
  return towerStateKey(clone);
}

export function classifyTowerSeedBelief(results) {
  const active = activeReplayResults(results);
  if (!active.length) {
    return { status: TOWER_SEED_STATUS.UNKNOWN, seeds: [], candidateCount: 0, entropyBits: null, results: [] };
  }
  const seeds = active.map((result) => Number(result.seed) >>> 0);
  if (active.length === 1) {
    return { status: TOWER_SEED_STATUS.KNOWN, seed: seeds[0], seeds, candidateCount: 1, entropyBits: 0, results: active };
  }
  const signatures = active.map((result) => futureStateSignature(result.state));
  const equivalent = signatures.every((signature) => signature === signatures[0]);
  return {
    status: equivalent ? TOWER_SEED_STATUS.FUTURE_EQUIVALENT : TOWER_SEED_STATUS.CANDIDATES,
    seeds,
    candidateCount: seeds.length,
    entropyBits: Math.log2(seeds.length),
    futureSignature: equivalent ? signatures[0] : null,
    results: active,
  };
}

export function resolveTowerSeedBelief({
  knownSeed = null,
  candidateSeeds = [],
  cards = [],
  turnScript = [],
  observedAfterRecycle = [],
  options = {},
} = {}) {
  if (knownSeed !== null && knownSeed !== undefined && String(knownSeed) !== "") {
    const replay = replayTowerSeed(Number(knownSeed) >>> 0, cards, turnScript, options);
    return classifyTowerSeedBelief([{ ...replay, status: replay.status === "ok" ? "match" : replay.status }]);
  }
  if (!(candidateSeeds ?? []).length) return classifyTowerSeedBelief([]);
  const evaluated = evaluateTowerSeedCandidates(candidateSeeds, cards, turnScript, observedAfterRecycle, options);
  return { ...classifyTowerSeedBelief(evaluated.survivors), evaluation: evaluated };
}

export function rankTowerBeliefActions(belief, options = {}) {
  const scenarios = activeReplayResults(belief?.results);
  if (!scenarios.length) return [];
  const perScenarioKeys = scenarios.map((result) => new Set(enumerateTowerActions(result.state).map(towerActionKey)));
  const common = [...perScenarioKeys[0]].filter((key) => perScenarioKeys.every((set) => set.has(key)));
  const weight = 1 / scenarios.length;
  const ranked = [];
  for (const actionKey of common) {
    let expected = 0;
    const perSeedValue = {};
    let immediate = 0;
    for (const result of scenarios) {
      const action = actionForState(result.state, actionKey);
      if (!action) continue;
      const child = applyTowerAiAction(result.state, action, options);
      const value = evaluateTowerStateBeam(child, { ...options, depth: Math.max(0, Number(options.depth ?? 4) - 1) });
      expected += weight * value;
      if (action.type === "play") immediate += weight * scoreTowerCard(result.state, action, options).total;
      perSeedValue[`0x${(Number(result.seed) >>> 0).toString(16).padStart(8, "0")}`] = value;
    }
    ranked.push({ actionKey, value: expected, immediate, perSeedValue });
  }
  ranked.sort((left, right) => (right.value - left.value) || (right.immediate - left.immediate));
  return ranked;
}
