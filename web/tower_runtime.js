import { beginSimulationTurn, currentSimulationSource, endSimulationTurn, historyCard, recordSimulationEvent, traceSimulation } from "./simulation_history.js";
import { getExamParameterModel, getExamEffectCalculateContext } from "./native_exam_context.js";
import { XorShift32, normalizeProduceCard, parseSeed } from "./engine.js";
import {
  addNativeGenericTimedStatus,
  addNativeScalarTimedStatus,
  markNativeStatusTurnStart,
  NATIVE_SCALAR_TURN_STATUSES,
  nextNativeStatusUid,
  applyParsedExamEffect,
  calculateNativeBlockAdd,
  calculateNativeStaminaDamage,
  checkCardEffectTrigger,
  createExamState,
  getExamRuntimeSetting,
  parseExamEffectId,
  parseExamEffectMaster,
  payCardCost,
  syncNativeGenericTimedStatuses,
  syncNativeScoreTimedStatuses,
  tickNativeScoreTimedStatuses,
  trySetExamStance,
} from "./exam_effects.js";
import {
  EXAM_IDOL_STATUS_TYPE,
  applyNativeReviewTurnEnd,
  calculateNativeDependentLessonBase,
  nativeCeilWithEpsilon,
  addNativeLessonParameter,
  applyNativeLessonHits,
  applyNativeModifiedLessonRepeat,
  NATIVE_LESSON_MODIFIER_KIND,
} from "./exam_score.js";
import {
  applyCardCustomizations,
  restoreLegacySpecificCostGrow,
  applyCardGrowEffectsToParsedEffect,
  applyRuntimeCardGrowEffects,
} from "./card_customization.js";
import {
  NATIVE_EFFECT_PHASE,
  captureNativeStatusSnapshot,
  createNativeEffectScheduler,
  dispatchNativeEffectPhase,
  dispatchNativeStatusDiff,
  registerNativeEnchantEffects,
  registerNativeGimmickEffects,
  registerNativePItemEffects,
  tickNativeEffectSchedulerTurn,
} from "./native_effect_scheduler.js";

export const TOWER_DEFAULT_DECK_BY_EXAM_EFFECT = Object.freeze({
  ProduceExamEffectType_ExamParameterBuff: "initial_deck-parameter_buff",
  ProduceExamEffectType_ExamConcentration: "initial_deck-concentration",
  ProduceExamEffectType_ExamLessonBuff: "initial_deck-lesson_buff",
  ProduceExamEffectType_ExamReview: "initial_deck-review",
  ProduceExamEffectType_ExamCardPlayAggressive: "initial_deck-aggressive",
  ProduceExamEffectType_ExamFullPower: "initial_deck-full_power",
});

export const TOWER_EXAM_EFFECT_LABELS = Object.freeze({
  ProduceExamEffectType_ExamParameterBuff: "センス / 好調",
  ProduceExamEffectType_ExamConcentration: "アノマリー / 強気",
  ProduceExamEffectType_ExamLessonBuff: "センス / 集中",
  ProduceExamEffectType_ExamReview: "ロジック / 好印象",
  ProduceExamEffectType_ExamCardPlayAggressive: "ロジック / やる気",
  ProduceExamEffectType_ExamFullPower: "アノマリー / 全力",
});

export function resolveTowerDefaultDeck(idolCardId, idolCardById, initialDeckById) {
  const id = String(idolCardId ?? "").trim();
  if (!id) return null;
  const idol = idolCardById?.get?.(id);
  if (!idol) return null;
  const examEffectType = String(idol.examEffectType ?? "");
  const deckId = TOWER_DEFAULT_DECK_BY_EXAM_EFFECT[examEffectType];
  if (!deckId) return null;
  const deck = initialDeckById?.get?.(deckId);
  if (!deck) return null;
  return {
    idolCardId: id,
    examEffectType,
    label: TOWER_EXAM_EFFECT_LABELS[examEffectType] ?? examEffectType,
    deckId,
    cards: (deck.cards ?? []).map((card) => ({ ...card })),
  };
}

export function isOnceOnlyMove(value) {
  return String(value ?? "") === "ProduceCardMovePositionType_Lost";
}

export function isSupportedSimpleMove(value) {
  const move = String(value ?? "");
  return !move || move === "ProduceCardMovePositionType_Unknown" || move === "ProduceCardMovePositionType_Grave" || move === "ProduceCardMovePositionType_Lost";
}

export class TowerCardSelectionRequired extends Error {
  constructor({ selectionIndex, effectId, candidates, min, max }) {
    super(`${effectId}: カード選択が必要です。`);
    this.name = "TowerCardSelectionRequired";
    this.code = "TOWER_CARD_SELECTION_REQUIRED";
    this.selectionIndex = selectionIndex;
    this.effectId = effectId;
    this.candidates = candidates;
    this.min = min;
    this.max = max;
  }
}

const TOWER_STATE_SHARED_KEYS = new Set([
  "cardById",
  "cardVariantByKey",
  "customizeById",
  "growEffectById",
  "examEffectById",
  "examStatusEnchantById",
  "examTriggerById",
  "cardSearchById",
  "cardRandomPoolById",
  "cardStatusEnchantById",
  "cardPoolById",
]);

function cloneTowerStateValue(value, seen = new Map()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    for (const item of value) result.push(cloneTowerStateValue(item, seen));
    return result;
  }
  if (value instanceof Map) {
    const result = new Map();
    seen.set(value, result);
    for (const [key, item] of value) result.set(key, cloneTowerStateValue(item, seen));
    return result;
  }
  if (value instanceof Set) {
    const result = new Set();
    seen.set(value, result);
    for (const item of value) result.add(cloneTowerStateValue(item, seen));
    return result;
  }
  const result = {};
  seen.set(value, result);
  for (const [key, item] of Object.entries(value)) result[key] = cloneTowerStateValue(item, seen);
  return result;
}

export function cloneTowerTurnState(state) {
  const clone = {};
  for (const [key, value] of Object.entries(state ?? {})) {
    clone[key] = TOWER_STATE_SHARED_KEYS.has(key)
      ? value
      : cloneTowerStateValue(value);
  }
  return clone;
}

export const TOWER_TURN_STATE_SNAPSHOT_VERSION = 1;
const TOWER_STATE_SNAPSHOT_KIND = "__gakumasSimRuntimeKind";

function encodeTowerStateValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(encodeTowerStateValue);
  if (value instanceof Map) {
    return {
      [TOWER_STATE_SNAPSHOT_KIND]: "Map",
      entries: [...value.entries()].map(([key, item]) => [encodeTowerStateValue(key), encodeTowerStateValue(item)]),
    };
  }
  if (value instanceof Set) {
    return {
      [TOWER_STATE_SNAPSHOT_KIND]: "Set",
      values: [...value.values()].map(encodeTowerStateValue),
    };
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = encodeTowerStateValue(item);
  return result;
}

function decodeTowerStateValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decodeTowerStateValue);
  if (value[TOWER_STATE_SNAPSHOT_KIND] === "Map") {
    return new Map((value.entries ?? []).map(([key, item]) => [
      decodeTowerStateValue(key),
      decodeTowerStateValue(item),
    ]));
  }
  if (value[TOWER_STATE_SNAPSHOT_KIND] === "Set") {
    return new Set((value.values ?? []).map(decodeTowerStateValue));
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = decodeTowerStateValue(item);
  return result;
}

export function serializeTowerTurnState(state) {
  if (!state || typeof state !== "object") throw new Error("保存する試験状態がありません。");
  const snapshot = {};
  for (const [key, value] of Object.entries(state)) {
    if (TOWER_STATE_SHARED_KEYS.has(key)) continue;
    snapshot[key] = encodeTowerStateValue(value);
  }
  return {
    version: TOWER_TURN_STATE_SNAPSHOT_VERSION,
    state: snapshot,
  };
}

export function restoreTowerTurnState(input, shared = {}) {
  let source;
  try {
    source = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new Error("保存済みの試験状態を読み込めませんでした。");
  }
  if (!source || Number(source.version) !== TOWER_TURN_STATE_SNAPSHOT_VERSION || !source.state) {
    throw new Error("保存済みの試験状態のバージョンが不明です。");
  }
  const state = decodeTowerStateValue(source.state);
  for (const key of TOWER_STATE_SHARED_KEYS) {
    state[key] = shared?.[key] ?? new Map();
  }
  state.exam.turnLifetimeEnabled = true;
  state.exam.passingTurnStartFields ??= {};
  state.exam.scalarTimedStatuses ??= [];
  const turnCardUses = (state.simulationLog?.events ?? []).filter(event => event.turn === state.turn && event.kind === "cardUse");
  state.normalPlayUsed ??= turnCardUses.length
    ? turnCardUses.some(event => !event.forced)
    : (state.currentTurnPlays ?? []).some(play => !play.forced);
  for (const card of [...(state.initialDeck ?? []), ...(state.shuffledInitialDeck ?? [])]) restoreLegacySpecificCostGrow(card);
  state.pendingTimedCardUpgradeEffects ??= [];
  state.searchPlayCardLimits ??= [];
  state.searchCardCostChanges ??= [];
  state.cardEnchantRegistrations ??= new Map();
  state.statusEnchantRemainingCounts ??= new Map();
  state.statusEnchantSerial ??= 0;
  state.exam.turnCardPlayCount ??= state.currentTurnPlays?.length ?? 0;
  state.turnOpen ??= Number(state.turn) > 0 && !state.ended && Number(state.history?.at(-1)?.turn ?? 0) < Number(state.turn);
  // Older checkpoints lack installedTurn. Initial-only Encore belongs to
  // the owner's first normal use, which is recoverable from recorded plays.
  const pastTurns = [...(state.history ?? []), ...(state.turnOpen ? [{ turn: state.turn, plays: state.currentTurnPlays ?? [] }] : [])];
  for (const registration of state.effectScheduler?.registrations ?? []) {
    if (registration.installedTurn != null || !registration.metadata?.originCardToken) continue;
    const parsed = schedulerParsedEffect(state.examEffectById.get(registration.id) ?? registration.id);
    if (parsed.masterEffectType !== "ProduceExamEffectType_ExamStatusEnchantEncore") continue;
    const first = pastTurns.find(turn => (turn.plays ?? []).some(play =>
      !play.forced && play.card?.token === registration.metadata.originCardToken));
    if (first) registration.installedTurn = Number(first.turn);
  }
  // Older checkpoints did not store per-card play counts. Recover them from
  // recorded plays so resuming an Encore cannot reinstall its initial effect.
  const playedCounts = new Map();
  for (const play of [...(state.history ?? []).flatMap(turn => turn.plays ?? []), ...(state.turnOpen ? state.currentTurnPlays ?? [] : [])]) {
    const token = play.card?.token;
    if (token) playedCounts.set(token, (playedCounts.get(token) ?? 0) + 1);
  }
  for (const pool of [state.deck, state.discard, state.lost, state.hold, state.hand]) {
    for (const card of pool ?? []) {
      restoreLegacySpecificCostGrow(card);
      card.playCount ??= playedCounts.get(card.token) ?? 0;
      if (card._supportBaseSnapshot) card._supportBaseSnapshot.playCount = card.playCount;
    }
  }
  return state;
}

function runtimeInstances(
  cards,
  cardById,
  cardVariantByKey = new Map(),
  customizeById = new Map(),
  growEffectById = new Map(),
) {
  const seen = new Map();
  return (cards ?? []).map((raw, index) => {
    const card = normalizeProduceCard(raw, { source: raw?.source });
    const id = String(card.id);
    const ordinal = (seen.get(id) ?? 0) + 1;
    seen.set(id, ordinal);
    const variantKey = `${id}@@${Number(card.upgradeCount ?? 0)}`;
    const master = cardVariantByKey?.get?.(variantKey) ?? cardById?.get?.(id) ?? {};
    const playMovePositionType = String(master.playMovePositionType ?? card.playMovePositionType ?? "");
    const runtime = applyCardCustomizations({
      ...card,
      token: `${id}@@${ordinal}`,
      playCount: 0,
      originalIndex: index,
      name: String(master.name ?? card.name ?? id),
      playMovePositionType,
      category: String(master.category ?? card.category ?? ""),
      rarity: String(master.rarity ?? card.rarity ?? ""),
      planType: String(master.planType ?? card.planType ?? ""),
      searchTag: String(master.searchTag ?? card.searchTag ?? ""),
      originIdolCardId: String(master.originIdolCardId ?? card.originIdolCardId ?? ""),
      effectGroupIds: Array.isArray(master.effectGroupIds) ? [...master.effectGroupIds] : [],
      stamina: Number(master.stamina ?? 0) || 0,
      forceStamina: Number(master.forceStamina ?? 0) || 0,
      costType: String(master.costType ?? "ExamCostType_Unknown"),
      costValue: Number(master.costValue ?? 0) || 0,
      playProduceExamTriggerId: String(master.playProduceExamTriggerId ?? ""),
      moveEffectTriggerType: String(master.moveEffectTriggerType ?? ""),
      moveProduceExamEffectIds: [...(master.moveProduceExamEffectIds ?? [])],
      moveProduceExamTriggerIds: [...(master.moveProduceExamTriggerIds ?? [])],
      produceDescriptionParts: master.produceDescriptionParts ?? [],
      playEffects: Array.isArray(master.playEffects) ? master.playEffects.map((effect) => ({ ...effect })) : [],
      produceCardStatusEnchantId: String(master.produceCardStatusEnchantId ?? ""),
      isInitial: Boolean(master.isInitial ?? card.isInitial),
      isRestrict: Boolean(master.isRestrict),
      isEndTurnLost: Boolean(master.isEndTurnLost),
    }, customizeById, growEffectById);
    runtime.onceOnly = isOnceOnlyMove(runtime.playMovePositionType);
    return runtime;
  });
}

function shuffleObjectsWithState(input, stateInput) {
  const deck = input.map((item) => ({ ...item }));
  const rng = new XorShift32(Number(stateInput) >>> 0);
  for (let n = deck.length; n >= 2; n -= 1) {
    const j = rng.nextInt(0, n);
    [deck[j], deck[n - 1]] = [deck[n - 1], deck[j]];
  }
  return { deck, randomState: rng.state >>> 0 };
}

function consumeNativeRandomInt(state, minimum, maximum) {
  const min = Number(minimum);
  const max = Number(maximum);
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new Error("乱数範囲が不正です。");
  }
  const rng = new XorShift32(Number(state.randomState) >>> 0);
  const value = rng.nextInt(min, max);
  state.randomState = rng.state >>> 0;
  return value;
}

function consumeNativeRandomSortKey(state) {
  // ExamParameterModel.GetRandomInt() @ 0x808A340 returns the current
  // state XOR 0x80000000 as signed Int32, *then* advances XorShift32.
  // Sorting these signed keys is equivalent to sorting the unsigned
  // pre-advance words, so preserve the existing stable comparator.
  const rng = new XorShift32(Number(state.randomState) >>> 0);
  const signedKey = rng.getRandomInt();
  state.randomState = rng.state >>> 0;
  return (signedKey ^ 0x80000000) >>> 0;
}

function generatedRuntimeCard(state, cardIdInput, upgradeCountInput = 0) {
  const id = String(cardIdInput ?? "");
  const upgradeCount = Number(upgradeCountInput ?? 0);
  const master = state.cardVariantByKey?.get?.(`${id}@@${upgradeCount}`)
    ?? state.cardById?.get?.(id);
  if (!master) return null;

  state.generatedCardSerial = Number(state.generatedCardSerial ?? 0) + 1;
  const card = normalizeProduceCard({
    id,
    upgradeCount,
    fixedDeckOrder: 0,
    source: "generated",
  }, { source: "generated" });
  const playMovePositionType = String(master.playMovePositionType ?? card.playMovePositionType ?? "");
  return {
    ...card,
    token: `generated:${state.generatedCardSerial}:${id}`,
    playCount: 0,
    name: String(master.name ?? id),
    originalIndex: -1,
    generated: true,
    playMovePositionType,
    category: String(master.category ?? ""),
    rarity: String(master.rarity ?? ""),
    planType: String(master.planType ?? ""),
    searchTag: String(master.searchTag ?? ""),
    effectGroupIds: Array.isArray(master.effectGroupIds) ? [...master.effectGroupIds] : [],
    onceOnly: isOnceOnlyMove(playMovePositionType),
    stamina: Number(master.stamina ?? 0) || 0,
    forceStamina: Number(master.forceStamina ?? 0) || 0,
    costType: String(master.costType ?? "ExamCostType_Unknown"),
    costValue: Number(master.costValue ?? 0) || 0,
    playProduceExamTriggerId: String(master.playProduceExamTriggerId ?? ""),
    moveEffectTriggerType: String(master.moveEffectTriggerType ?? ""),
    moveProduceExamEffectIds: [...(master.moveProduceExamEffectIds ?? [])],
    moveProduceExamTriggerIds: [...(master.moveProduceExamTriggerIds ?? [])],
    produceDescriptionParts: master.produceDescriptionParts ?? [],
    playEffects: Array.isArray(master.playEffects) ? master.playEffects.map((effect) => ({ ...effect })) : [],
    produceCardStatusEnchantId: String(master.produceCardStatusEnchantId ?? ""),
    isInitial: Boolean(master.isInitial),
    isRestrict: Boolean(master.isRestrict),
    isEndTurnLost: Boolean(master.isEndTurnLost),
  };
}

function runtimeCardName(state, cardIdInput, upgradeCountInput = null) {
  const id = String(cardIdInput ?? "");
  const upgrade = upgradeCountInput === null || upgradeCountInput === undefined
    ? null
    : Number(upgradeCountInput);
  const master = (upgrade === null
    ? null
    : state.cardVariantByKey?.get?.(`${id}@@${upgrade}`))
    ?? state.cardById?.get?.(id)
    ?? null;
  return String(master?.name ?? id);
}

function runtimeCardPositionName(positionInput) {
  switch (String(positionInput ?? "")) {
    case "deck": return "山札";
    case "grave": return "捨札";
    case "deck_grave": return "山札・捨札";
    case "deck_first": return "山札の先頭";
    case "deck_last": return "山札の末尾";
    case "deck_random": return "山札のランダム位置";
    case "hand": return "手札";
    case "lost": return "除外";
    case "hold": return "保留";
    default: return String(positionInput ?? "");
  }
}

function runtimeEnchantName(state, enchantIdInput, metadata = {}) {
  const enchantId = String(enchantIdInput ?? "");
  const origin = metadata.originCard ?? findRuntimeCard(state, metadata.originCardToken);
  if (origin?.id && enchantId.includes(origin.id)) return `${origin.name ?? origin.id}の継続効果`;
  const cardId = [...(state.cardById?.keys?.() ?? [])]
    .sort((a, b) => String(b).length - String(a).length)
    .find((id) => enchantId.includes(String(id)));
  if (!cardId) return "継続効果";
  return `${runtimeCardName(state, cardId, 0)}の継続効果`;
}

function addGeneratedCard(state, parsed, event) {
  if (!Array.isArray(event.created)) event.created = [];
  const min = Math.max(0, Number(parsed.pickCountMin ?? 0) || 0);
  const max = Math.max(0, Number(parsed.pickCountMax ?? min) || 0);
  if (min !== max) {
    rememberUnsupported(state, `card-create-count:${parsed.id}`);
    event.effects.push(`生成枚数が可変のため判定保留: ${parsed.id}`);
    return;
  }

  for (let index = 0; index < min; index += 1) {
    const card = generatedRuntimeCard(state, parsed.cardId, parsed.upgradeCount);
    if (!card) {
      rememberUnsupported(state, `card-create-master:${parsed.cardId}@@${parsed.upgradeCount}`);
      event.effects.push(`生成カード情報を取得できません: ${parsed.cardId}`);
      return;
    }

    const created = {
      card: { ...card },
      movePosition: parsed.movePosition,
      insertIndex: null,
      randomStateBefore: state.randomState >>> 0,
      randomStateAfter: state.randomState >>> 0,
    };

    const destinations = { deck_first: "DeckFirst", deck_last: "DeckLast", deck_random: "DeckRandom",
      grave: "Grave", lost: "Lost", hold: "Hold", hand: "Hand" };
    const destination = destinations[String(parsed.movePosition ?? "")];
    if (!destination) {
      rememberUnsupported(state, `card-create-position:${parsed.movePosition}`);
      event.effects.push(`未対応の生成位置: ${parsed.movePosition}`);
      return;
    }
    created.movePosition = addRuntimeCardAt(state, card, destination, event);
    if (created.movePosition.startsWith("deck")) created.insertIndex = state.deck.indexOf(card);
    created.randomStateAfter = state.randomState >>> 0;
    event.created.push(created);
  }
}

function cardMoveSearchPools(state, searchPosition) {
  switch (String(searchPosition ?? "")) {
    case "deck":
      return [{ name: "deck", cards: state.deck }];
    case "grave":
      return [{ name: "grave", cards: state.discard }];
    case "deck_grave":
      return [
        { name: "deck", cards: state.deck },
        { name: "grave", cards: state.discard },
      ];
    default:
      return [];
  }
}

function moveSearchedCards(state, parsed, event) {
  if (!Array.isArray(event.moved)) event.moved = [];
  const min = Math.max(0, Number(parsed.pickCountMin ?? 0) || 0);
  const max = Math.max(0, Number(parsed.pickCountMax ?? min) || 0);
  if (max < min) {
    rememberUnsupported(state, `card-move-count:${parsed.id}`);
    event.effects.push(`移動枚数の範囲が不正なため判定保留: ${parsed.id}`);
    return;
  }
  if (String(parsed.pickRange ?? "") !== "random") {
    rememberUnsupported(state, `card-move-range:${parsed.pickRange}`);
    event.effects.push(`未対応のカード選択方法: ${parsed.pickRange}`);
    return;
  }
  if (String(parsed.movePosition ?? "") !== "lost") {
    rememberUnsupported(state, `card-move-position:${parsed.movePosition}`);
    event.effects.push(`未対応のカード移動先: ${parsed.movePosition}`);
    return;
  }

  const pools = cardMoveSearchPools(state, parsed.searchPosition);
  if (!pools.length) {
    rememberUnsupported(state, `card-move-search-position:${parsed.searchPosition}`);
    event.effects.push(`未対応のカード検索範囲: ${parsed.searchPosition}`);
    return;
  }

  const matches = [];
  for (const pool of pools) {
    for (let index = 0; index < pool.cards.length; index += 1) {
      if (String(pool.cards[index]?.id ?? "") !== String(parsed.cardId ?? "")) continue;
      matches.push({ pool, index, card: pool.cards[index], sourceOrder: matches.length });
    }
  }

  // ELF (build 77fda4e2): ExamEffectUtility.PickCardPositionListImpl
  // at RVA 0x80302A8; the older 0x7FE99E8 was a branch-table address.
  // In its Random branch (RVA 0x8030954), GetPickCountMinMax is followed
  // by GetRandomInt(min, max + 1) at RVA 0x8030988. Even a fixed count
  // consumes one XorShift word. The All branch returns the complete list
  // without this count roll. Candidate-order RNG is a separate concern.
  //
  // The old replay consumed only one RNG word for selecting an index. For
  // 夏夜に咲く思い出 with exactly one 眠気, native consumes two words:
  // fixed pick-count + the candidate's random sort key.
  const randomStateBefore = state.randomState >>> 0;
  const pickCount = consumeNativeRandomInt(state, min, max + 1);
  const randomized = matches.map((entry) => ({
    ...entry,
    randomKey: consumeNativeRandomSortKey(state),
  }));
  randomized.sort((a, b) => a.randomKey - b.randomKey || a.sourceOrder - b.sourceOrder);

  const selected = randomized.slice(0, Math.min(pickCount, randomized.length));
  const randomStateAfterSelection = state.randomState >>> 0;
  for (const entry of selected) {
    const currentIndex = entry.pool.cards.indexOf(entry.card);
    if (currentIndex < 0) continue;
    const [card] = entry.pool.cards.splice(currentIndex, 1);
    state.lost.push(card);
    event.moved.push({
      card: { ...card },
      from: entry.pool.name,
      to: "lost",
      randomStateBefore,
      randomStateAfter: randomStateAfterSelection,
    });
    runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.CARD_MOVE_LOST, event, { card });
  }
}

function normalizeHandLimit(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : Number.POSITIVE_INFINITY;
}

export function resolveNativeInitialHand(shuffledCards, drawCount = 3, handLimit = Number.POSITIVE_INFINITY) {
  const count = Number(drawCount);
  if (!Number.isInteger(count) || count < 1) throw new Error("1ターンのドロー枚数が不正です。");
  const capacity = normalizeHandLimit(handLimit);
  const deck = (shuffledCards ?? []).map((card) => ({ ...card }));
  const hand = [];

  // ExamCardMoveController.SetInitialCard @ 0x8239520:
  // scan Deck backwards, remove IsInitial cards into Hand, then ordinary DrawCard
  // only fills the remaining opening slots. The routine itself consumes no RNG.
  for (let index = deck.length - 1; index >= 0; index -= 1) {
    if (!deck[index]?.isInitial || hand.length >= capacity) continue;
    hand.push(deck.splice(index, 1)[0]);
  }
  const ordinaryCount = Math.min(
    Math.max(0, count - hand.length),
    deck.length,
    Math.max(0, capacity - hand.length),
  );
  if (ordinaryCount) hand.push(...deck.splice(0, ordinaryCount));
  return { hand, deck, visibleOrder: [...hand, ...deck] };
}

export function createTowerTurnState(cards, seedInput, cardById = new Map(), options = {}) {
  const seed = typeof seedInput === "number" ? seedInput >>> 0 : parseSeed(seedInput);
  const instances = runtimeInstances(
    cards,
    cardById,
    options.cardVariantByKey,
    options.customizeById,
    options.growEffectById,
  );
  if (!instances.length) throw new Error("デッキにカードがありません。");

  // Exam modes can consume the shared XorShift stream during native setup
  // before ExamCardPoolModel.Shuffle. Keep the public seed as the true
  // ExamParameterModel.Seed and advance only the internal shuffle state.
  const preShuffleAdvanceSteps = Math.max(0, Math.trunc(Number(options.preShuffleAdvanceSteps ?? 0) || 0));
  // Do not coerce an absent state to zero: Number(null) === 0. A null/undefined/
  // empty initialRandomState means "derive it from Seed + preShuffleAdvanceSteps".
  const rawInitialRandomState = options.initialRandomState;
  const hasExplicitInitialRandomState = rawInitialRandomState !== null
    && rawInitialRandomState !== undefined
    && String(rawInitialRandomState).trim() !== "";
  const explicitInitialRandomState = hasExplicitInitialRandomState
    ? Number(rawInitialRandomState)
    : Number.NaN;
  let initialRandomState;
  let initialRandomStateSource;
  if (Number.isInteger(explicitInitialRandomState) && explicitInitialRandomState >= 0 && explicitInitialRandomState <= 0xffffffff) {
    initialRandomState = explicitInitialRandomState >>> 0;
    initialRandomStateSource = String(options.initialRandomStateSource ?? "exact");
  } else {
    const preShuffleRng = new XorShift32(seed);
    for (let index = 0; index < preShuffleAdvanceSteps; index += 1) preShuffleRng.nextU32();
    initialRandomState = preShuffleRng.state >>> 0;
    initialRandomStateSource = String(options.initialRandomStateSource ?? "derived");
  }

  // Native ExamCardPoolModel.Shuffle does not filter IsInitial. The whole Deck
  // is shuffled first; SetInitialCard later extracts opening-hand cards.
  const shuffled = shuffleObjectsWithState(instances, initialRandomState);
  const exam = {
    ...createExamState({ stamina: options.stamina, runtimeSettings: options.examRuntimeSettings ?? options.examSetting, scoreSettings: options.examScoreSettings ?? options.examSetting }),
    targetScore: Math.max(0, Number(options.targetScore ?? 0)),
    turnLifetimeEnabled: true,
    passingTurnStartFields: {},
  };
  const openingDrawCount = Math.max(1, Math.trunc(Number(options.drawPerTurn ?? options.openingDrawCount ?? 3)));
  const handLimit = normalizeHandLimit(options.handLimit ?? getExamRuntimeSetting(exam, "handLimit"));
  const holdLimit = normalizeHandLimit(options.holdLimit ?? getExamRuntimeSetting(exam, "holdLimit"));
  const openingPreview = resolveNativeInitialHand(shuffled.deck, openingDrawCount, handLimit);

  const state = {
    seed,
    preShuffleAdvanceSteps,
    initialRandomState,
    initialRandomStateSource,
    randomState: shuffled.randomState,
    shuffledInitialDeck: shuffled.deck.map((card) => ({ ...card })),
    initialDeck: openingPreview.visibleOrder.map((card) => ({ ...card })),
    deck: shuffled.deck.map((card) => ({ ...card })),
    discard: [],
    lost: [],
    hold: [],
    hand: [],
    turn: 0,
    recycleCount: 0,
    history: [],
    historyTraceEnabled: options.historyTraceEnabled !== false,
    simulationLog: { version: 1, events: [], turns: [] },
    lastRecycle: null,
    openingResolved: false,
    openingDrawCount,
    handLimit,
    holdLimit,
    turnParameterTypes: Array.isArray(options.turnParameterTypes)
      ? options.turnParameterTypes.map(String)
      : [],
    parameterBonus: options.parameterBonus ?? null,
    examScoreSettings: options.examScoreSettings ?? options.examSetting ?? null,
    turnLimit: options.turnLimit != null && Number.isFinite(Number(options.turnLimit)) ? Math.max(0, Math.trunc(Number(options.turnLimit))) : null,
    ended: false,
    exam,
    effectScheduler: options.effectScheduler ?? createNativeEffectScheduler({
      traceEnabled: Boolean(options.effectSchedulerTrace),
    }),
    playsRemaining: 0,
    currentTurnPlays: [],
    currentTurnDrinks: [],
    drinkHistory: [],
    turnStartEffects: [],
    turnStartSupportCardRolls: [],
    unsupported: [],
    timers: [],
    pendingDraw: 0,
    pendingHandUpgradeAll: 0,
    pendingTimedCardUpgradeEffects: [],
    cardEffectPlayCountBuff: null,
    cardById: cardById ?? new Map(),
    cardVariantByKey: options.cardVariantByKey ?? new Map(),
    customizeById: options.customizeById ?? new Map(),
    growEffectById: options.growEffectById ?? new Map(),
    examEffectById: options.examEffectById ?? new Map(),
    examStatusEnchantById: options.examStatusEnchantById ?? new Map(),
    examTriggerById: options.examTriggerById ?? new Map(),
    cardSearchById: options.cardSearchById ?? new Map(),
    cardRandomPoolById: options.cardRandomPoolById ?? new Map(),
    cardStatusEnchantById: options.cardStatusEnchantById ?? new Map(),
    descriptionLabelById: options.descriptionLabelById ?? new Map(),
    cardPoolById: options.cardPoolById ?? new Map(),
    searchPlayCardLimits: [],
    searchCardCostChanges: [],
    cardEnchantRegistrations: new Map(),
    statusEnchantRemainingCounts: new Map(),
    statusEnchantSerial: 0,
    turnOpen: false,
    generatedCardSerial: 0,
    pItems: Array.isArray(options.pItems) ? options.pItems.map((item) => ({ ...item })) : [],
    captureActionTelemetry: options.captureActionTelemetry === true,
    pItemEffectRemainingCounts: new Map(),
    supportCards: Array.isArray(options.supportCards)
      ? options.supportCards.map((item) => ({ ...item }))
      : [],
    turnUseSupportCardIds: new Set(),
    supportCardRollHistory: [],
    gimmicks: Array.isArray(options.gimmicks) ? options.gimmicks.map((item) => ({ ...item })) : [],
    gimmickEffectRemainingCounts: new Map(),
    lessonType: String(options.lessonType ?? ""),
    playTurnCountSum: 0,
    aiCardSelectionPlan: null,
    aiCardSelectionCursor: 0,
    requireCardSelections: false,
  };
  registerResolvedPItems(state);
  registerResolvedGimmicks(state);
  return state;
}

function rememberUnsupported(state, value) {
  const text = String(value ?? "").trim();
  if (text && !state.unsupported.includes(text)) state.unsupported.push(text);
}

function nativeRuntimeEvent() {
  return {
    effects: [],
    drawn: [],
    created: [],
    moved: [],
    grown: [],
    supportCardRolls: [],
    recycleEvents: [],
  };
}

function schedulerParsedEffect(effect) {
  if (effect && typeof effect === "object" && effect.kind) return effect;
  if (effect && typeof effect === "object" && (effect.effectType || effect.id)) {
    const parsed = parseExamEffectMaster(effect);
    return {
      ...parsed,
      masterEffectType: String(effect.effectType ?? parsed.masterEffectType ?? ""),
    };
  }
  if (effect && typeof effect === "object" && effect.produceExamEffectId) {
    return parseExamEffectId(effect.produceExamEffectId);
  }
  return parseExamEffectId(effect);
}

function gimmickRowConditionMatches(state, row = {}) {
  const fieldStatusType = String(row.fieldStatusType ?? "");
  if (!fieldStatusType || fieldStatusType.endsWith("_Unknown")) return true;
  if (fieldStatusType === "ProduceExamFieldStatusType_PlayCardSkill"
    || fieldStatusType === "ProduceExamFieldStatusType_PlayCardLesson") {
    const matches = masterFieldStatusValue(state, fieldStatusType) === 1;
    return row.fieldStatusCheckType === "ProduceExamTriggerCheckType_Not" ? !matches : matches;
  }
  const current = fieldStatusType === "ProduceExamFieldStatusType_CardSearchCountUp"
    ? masterSearchMatchCount(state, resolvedMasterSearch(state, row.fieldStatusProduceCardSearchId))
    : masterFieldStatusValue(state, fieldStatusType);
  if (current === null) {
    rememberUnsupported(state, `gimmick-field-status:${fieldStatusType}`);
    return false;
  }

  const expected = Number(row.fieldStatusValue ?? 1);
  const check = String(row.fieldStatusCheckType ?? "ProduceExamTriggerCheckType_Unknown");
  const reverseThreshold = fieldStatusType.endsWith("MultipleDown")
    || fieldStatusType.includes("LessMultiple");
  const positiveMatch = reverseThreshold ? current <= expected : current >= expected;
  return check === "ProduceExamTriggerCheckType_Not" ? !positiveMatch : positiveMatch;
}

function withNativeEffectSource(state, source, execute) {
  const previous = state.effectSource;
  state.effectSource = source;
  try { return execute(); }
  finally {
    if (previous === undefined) delete state.effectSource;
    else state.effectSource = previous;
  }
}

function nativeSchedulerHooks(state, runtimeEvent) {
  return {
    evaluateCondition(condition, context, registration) {
      if (registration.metadata?.statusEnchantKey && state.statusEnchantRemainingCounts.get(registration.metadata.statusEnchantKey) === 0) return false;
      if (condition?.kind === "nativeGimmickSchedule") {
        const row = condition.row, turn = Number(state.turn), limit = Number(state.turnLimit);
        return (!Number(row.startTurn) || Number(row.startTurn) === turn)
          && (!Number(row.remainingTurn) || (state.turnLimit != null && Number(row.remainingTurn) === limit - turn + 1))
          && (!Number(row.remainingTurnPermil) || (limit > 0 && Math.fround(row.remainingTurnPermil / 1000) <= Math.fround(turn / limit)));
      }
      if (condition?.kind === "masterExamTrigger") {
        return matchesMasterExamTrigger(state, condition, { ...context, registration }, runtimeEvent);
      }
      return undefined;
    },
    executeEffect(effect, context, registration) {
      const source = { type: registration.sourceType, id: registration.sourceId,
        name: registration.sourceType === "pItem" ? state.pItems.find(item => item.id === registration.sourceId)?.name ?? registration.sourceId
          : registration.sourceType === "enchant" ? runtimeEnchantName(state, registration.sourceId, registration.metadata) : registration.sourceId };
      return traceSimulation(state, source, () => withNativeEffectSource(state, registration.sourceType, () => {
        if (effect?.kind === "cardEnchantGrow") {
          const card = findRuntimeCard(state, effect.token);
          if (!card) return;
          const grows = effect.growEffectIds.map((id) => state.growEffectById.get(id)).filter(Boolean);
          for (const id of effect.growEffectIds) if (!state.growEffectById.has(id)) rememberUnsupported(state, "grow-effect:" + id);
          // A self-enchant triggered by a direct stance-change effect grows
          // the card for its *next* use.  In native contest #9 turn 7 the
          // +2 lesson / +1 Block grow must not modify the same play's later
          // lesson and Block effects (score +152, Block +1 otherwise).
          // Another card affected by the same trigger can grow immediately.
          if (card === state.playingCard) {
            state._deferredPlayingCardGrows ??= [];
            state._deferredPlayingCardGrows.push({
              card,
              grows: grows.map(grow => ({ ...grow })),
            });
          } else {
            applyPersistentRuntimeCardGrowEffects(card, grows);
          }
          runtimeEvent.grown ??= [];
          runtimeEvent.grown.push({ token: card.token, growEffectIds: [...effect.growEffectIds], matched: 1,
            deferredUntilAfterPlay: card === state.playingCard });
          runtimeEvent.effects.push((card.name ?? card.id) + (card === state.playingCard ? "を次回使用に向けて成長" : "を成長"));
          return;
        }
        if (effect?.kind === "nativeGimmickRow") {
          if (!gimmickRowConditionMatches(state, effect.row)) return;
          executeParsedTowerEffect(state, schedulerParsedEffect(effect.effect), runtimeEvent);
          return;
        }
        const previousOwner = state.effectOwnerCard;
        state.effectOwnerCard = findRuntimeCard(state, registration.metadata?.originCardToken) ?? null;
        try { executeParsedTowerEffect(state, schedulerParsedEffect(effect), runtimeEvent); }
        finally { state.effectOwnerCard = previousOwner; }
      }), { phase: registration.phase, registrationId: registration.registrationId, recordIfUnchanged: true });
    },
    beforeRegistration(registration) {
      if (registration.metadata?.statusEnchantKey && state.statusEnchantRemainingCounts.get(registration.metadata.statusEnchantKey) === 0) return false;
      const activationKey = String(registration.metadata?.activationKey ?? "");
      if (activationKey) {
        if (runtimeEvent.__nativeEffectFired?.has(activationKey)) return false;
        if (!runtimeEvent.__nativeEffectFired) runtimeEvent.__nativeEffectFired = new Set();
        runtimeEvent.__nativeEffectFired.add(activationKey);
      }
    },
    afterRegistration(registration) {
      const cardEnchantKey = registration.metadata?.cardEnchantKey;
      const cardEnchant = state.cardEnchantRegistrations.get(cardEnchantKey);
      if (cardEnchant?.remainingCount != null) {
        cardEnchant.remainingCount = Math.max(0, cardEnchant.remainingCount - 1);
        if (!cardEnchant.remainingCount) for (const entry of state.effectScheduler.registrations) {
          if (entry.metadata.cardEnchantKey === cardEnchantKey) entry.active = false;
        }
      }
      const statusEnchantKey = registration.metadata?.statusEnchantKey;
      const statusEnchantCount = state.statusEnchantRemainingCounts.get(statusEnchantKey);
      if (statusEnchantCount != null) {
        const next = Math.max(0, statusEnchantCount - 1);
        state.statusEnchantRemainingCounts.set(statusEnchantKey, next);
        if (!next) for (const entry of state.effectScheduler.registrations) {
          if (entry.metadata.statusEnchantKey === statusEnchantKey) entry.active = false;
        }
      }
      let remainingMap = null;
      if (registration.sourceType === "pItem") remainingMap = state.pItemEffectRemainingCounts;
      else if (registration.sourceType === "gimmick") remainingMap = state.gimmickEffectRemainingCounts;
      if (!remainingMap) return;

      const sharedKey = String(
        registration.metadata?.sharedCountKey
        ?? registration.metadata?.sharedPItemCountKey
        ?? "",
      );
      if (!sharedKey || !remainingMap.has(sharedKey)) return;
      const remaining = remainingMap.get(sharedKey);
      if (remaining === null) return;
      const next = Math.max(0, Number(remaining) - 1);
      remainingMap.set(sharedKey, next);
      if (next > 0) return;
      for (const entry of state.effectScheduler.registrations) {
        const entrySharedKey = String(
          entry.metadata?.sharedCountKey
          ?? entry.metadata?.sharedPItemCountKey
          ?? "",
        );
        if (entrySharedKey === sharedKey) entry.active = false;
      }
    },
  };
}

function currentNativeLessonType(state) {
  if (String(state?.lessonType ?? "")) return String(state.lessonType);
  const parameterType = String(currentTowerScoreContext(state).parameterType ?? "");
  return parameterType ? `ProduceStepLessonType_Lesson${parameterType[0].toUpperCase()}${parameterType.slice(1).toLowerCase()}` : "ProduceStepLessonType_Unknown";
}

function withNativeTransition(runtimeEvent, dispatch) {
  const previous = runtimeEvent.__nativeEffectFired;
  runtimeEvent.__nativeEffectFired = new Set();
  try { return dispatch(); }
  finally {
    if (previous === undefined) delete runtimeEvent.__nativeEffectFired;
    else runtimeEvent.__nativeEffectFired = previous;
  }
}

function runNativeEffectPhase(state, phase, runtimeEvent, extra = {}) {
  registerRuntimeCardEnchants(state);
  if (phase === NATIVE_EFFECT_PHASE.CARD_PLAY) {
    incrementMasterCardPhaseCounts(state, phase, runtimeEvent, extra);
  }
  return withNativeTransition(runtimeEvent, () => dispatchNativeEffectPhase(
    state.effectScheduler,
    phase,
    {
      state,
      exam: state.exam,
      event: runtimeEvent,
      lessonType: currentNativeLessonType(state),
      ...extra,
    },
    nativeSchedulerHooks(state, runtimeEvent),
  ));
}

function nativeResultTriggersAllowed(state) {
  // ExamEffectCalculateContext.IsEnchantTriggerActive @ 0x7FE4EDC:
  // Item/gimmick and ordinary enchant commands cannot trigger result
  // enchants. Forced card playback creates a fresh direct card context.
  return !["pItem", "gimmick", "enchant"].includes(state.effectSource);
}

function emitNativeStatusDiff(state, before, runtimeEvent, extra = {}) {
  for (const field of NATIVE_SCALAR_TURN_STATUSES) {
    if (Number(before[field] ?? 0) <= 0 && Number(state.exam[field] ?? 0) > 0) {
      state.exam.passingTurnStartFields ??= {};
      state.exam.passingTurnStartFields[field] = false;
    }
  }
  if (!nativeResultTriggersAllowed(state)) return [];
  // Card-cost consumption is observed by the native card-use completion hook
  // before the P-item recovery is applied. Capture the consumption now, but
  // resolve ExamBuffConsume after the card's main effects (same card action).
  if (extra.cause === "cardCost") {
    const afterCost = captureNativeStatusSnapshot(state.exam);
    const consumptionFields = ["review", "aggressive", "parameterBuff", "lessonBuff", "parameterBuffMultiplePerTurn"];
    for (const field of consumptionFields) {
      const beforeValue = Number(before[field] ?? 0);
      const afterValue = Number(afterCost[field] ?? 0);
      if (afterValue < beforeValue) {
        runtimeEvent.__deferredBuffConsumes ??= [];
        runtimeEvent.__deferredBuffConsumes.push({
          field, before: beforeValue, after: afterValue, delta: afterValue - beforeValue,
        });
      }
    }
  }
  registerRuntimeCardEnchants(state);
  return withNativeTransition(runtimeEvent, () => dispatchNativeStatusDiff(
    state.effectScheduler,
    before,
    captureNativeStatusSnapshot(state.exam),
    {
      state,
      exam: state.exam,
      event: runtimeEvent,
      lessonType: currentNativeLessonType(state),
      card: state.effectOwnerCard ?? state.playingCard ?? null,
      ...extra,
    },
    nativeSchedulerHooks(state, runtimeEvent),
  ));
}

function schedulerPhaseForLegacyEnchant(trigger = {}) {
  switch (String(trigger.phase ?? "")) {
    case "card_play":
      // Legacy hard-coded enchants ran after the card's own effects.
      return NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY;
    case "end_turn":
      return NATIVE_EFFECT_PHASE.END_TURN;
    default:
      return null;
  }
}


const MASTER_EXAM_PHASE_TO_NATIVE = Object.freeze({
  ProduceExamPhaseType_StartPlay: NATIVE_EFFECT_PHASE.AFTER_START_OF_TURN,
  ProduceExamPhaseType_StartExamPlay: NATIVE_EFFECT_PHASE.BEFORE_START_OF_TURN,
  ProduceExamPhaseType_ExamStartExam: NATIVE_EFFECT_PHASE.BEFORE_START_OF_TURN,
  ProduceExamPhaseType_ExamStartTurn: NATIVE_EFFECT_PHASE.START_OF_TURN,
  ProduceExamPhaseType_ExamCardDraw: NATIVE_EFFECT_PHASE.CARD_DRAW,
  ProduceExamPhaseType_ExamCardPlay: NATIVE_EFFECT_PHASE.CARD_PLAY,
  ProduceExamPhaseType_ExamCardPlayAfter: NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY,
  ProduceExamPhaseType_ExamEndTurn: NATIVE_EFFECT_PHASE.END_TURN,
  ProduceExamPhaseType_ExamTurnCheck: NATIVE_EFFECT_PHASE.BEFORE_START_OF_TURN,
  ProduceExamPhaseType_ExamTurnTimer: NATIVE_EFFECT_PHASE.TURN_START_AFTER_DRAW,
  ProduceExamPhaseType_ExamTurnInterval: NATIVE_EFFECT_PHASE.TURN_START_AFTER_DRAW,
  ProduceExamPhaseType_ExamPlayCountInterval: NATIVE_EFFECT_PHASE.CARD_PLAY,
  ProduceExamPhaseType_ExamPlayCountIntervalAfter: NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY,
  ProduceExamPhaseType_ExamTurnSkip: NATIVE_EFFECT_PHASE.END_TURN,
  ProduceExamPhaseType_ExamEndTurnInterval: NATIVE_EFFECT_PHASE.END_TURN,
  ProduceExamPhaseType_ExamPlayTurnCountInterval: NATIVE_EFFECT_PHASE.CARD_PLAY,
  ProduceExamPhaseType_ExamBuffConsume: NATIVE_EFFECT_PHASE.STATUS_DECREASED,
  ProduceExamPhaseType_ExamStaminaReduce: NATIVE_EFFECT_PHASE.STATUS_DECREASED,
  ProduceExamPhaseType_ExamStaminaReduceCard: NATIVE_EFFECT_PHASE.STATUS_DECREASED,
  ProduceExamPhaseType_ExamAggressiveUpInterval: NATIVE_EFFECT_PHASE.STATUS_INCREASED,
  ProduceExamPhaseType_ExamStanceChangeConcentration: NATIVE_EFFECT_PHASE.STATUS_INCREASED,
  ProduceExamPhaseType_ExamStanceChangePreservation: NATIVE_EFFECT_PHASE.STATUS_INCREASED,
  ProduceExamPhaseType_ExamStanceChangeCountInterval: NATIVE_EFFECT_PHASE.STATUS_INCREASED,
  ProduceExamPhaseType_ExamStanceChangeFullPower: NATIVE_EFFECT_PHASE.STATUS_INCREASED,
  ProduceExamPhaseType_ExamStanceChangeFromConcentration: "statusChange",
  ProduceExamPhaseType_ExamStanceChangeFromFullPower: "statusChange",
  ProduceExamPhaseType_ExamCardMoveHand: NATIVE_EFFECT_PHASE.CARD_MOVE_HAND,
  ProduceExamPhaseType_ExamCardMoveGrave: NATIVE_EFFECT_PHASE.CARD_MOVE_GRAVE,
  ProduceExamPhaseType_ExamCardMoveLost: NATIVE_EFFECT_PHASE.CARD_MOVE_LOST,
  ProduceExamPhaseType_ExamStatusChange: "statusChange",
});

const MASTER_FIELD_STATUS_TO_EXAM = Object.freeze({
  ProduceExamFieldStatusType_ParameterBuff: "parameterBuff",
  ProduceExamFieldStatusType_StaminaUpMultiple: "staminaRatioPermil",
  ProduceExamFieldStatusType_StaminaLessMultiple: "staminaRatioPermil",
  ProduceExamFieldStatusType_StaminaConsumptionDown: "staminaConsumptionDown",
  ProduceExamFieldStatusType_StaminaConsumptionAdd: "staminaConsumptionAdd",
  ProduceExamFieldStatusType_StaminaConsumptionDownFix: "staminaConsumptionDownFix",
  ProduceExamFieldStatusType_StaminaConsumptionAddFix: "staminaConsumptionAddFix",
  ProduceExamFieldStatusType_ConcentrationUp: "idolStatusConcentration",
  ProduceExamFieldStatusType_PreservationUp: "idolStatusPreservation",
  ProduceExamFieldStatusType_FullPowerUp: "idolStatusFullPower",
  ProduceExamFieldStatusType_NoBlock: "noBlock",
  ProduceExamFieldStatusType_LessonBuffUp: "lessonBuff",
  ProduceExamFieldStatusType_BlockUp: "block",
  ProduceExamFieldStatusType_ReviewUp: "review",
  ProduceExamFieldStatusType_ParameterBuffUp: "parameterBuff",
  ProduceExamFieldStatusType_ParameterDebuff: "parameterDebuff",
  ProduceExamFieldStatusType_LessonDebuff: "lessonDebuff",
  ProduceExamFieldStatusType_Enthusiastic: "enthusiastic",
  ProduceExamFieldStatusType_RemainingTurn: "remainingTurn",
  ProduceExamFieldStatusType_CardPlayAggressiveUp: "aggressive",
  ProduceExamFieldStatusType_FullPowerPointUp: "fullPowerPoint",
  ProduceExamFieldStatusType_NoStance: "noStance",
  ProduceExamFieldStatusType_TurnPlayCardCountUp: "turnPlayCardCount",
  ProduceExamFieldStatusType_ParameterBuffMultiplePerTurnUp: "parameterBuffMultiplePerTurn",
  ProduceExamFieldStatusType_FullPowerPointGetSumUp: "fullPowerPointGetSum",
  ProduceExamFieldStatusType_ConcentrationChangeCountUp: "concentrationChangeCount",
  ProduceExamFieldStatusType_PreservationChangeCountUp: "preservationChangeCount",
  ProduceExamFieldStatusType_FullPowerChangeCountUp: "fullPowerChangeCount",
  ProduceExamFieldStatusType_StanceChangeCountUp: "stanceChangeCount",
  ProduceExamFieldStatusType_TurnProgressUp: "turnProgress",
  ProduceExamFieldStatusType_ConditionThresholdMultipleDown: "conditionThresholdMultipleDown",
  ProduceExamFieldStatusType_ConditionThresholdMultiple: "conditionThresholdMultipleDown",
  ProduceExamFieldStatusType_DebuffCountUp: "debuffCount",
  ProduceExamFieldStatusType_PlayCardSkill: "lastMentalCard",
  ProduceExamFieldStatusType_CardSearchCountUp: "cardSearchCount",
  ProduceExamFieldStatusType_PlayCardLesson: "playCardLesson",
});

function masterFieldStatusValue(state, fieldStatusType) {
  // v3.4.1 contest: a card\u0027s CardPlayAggressiveUp condition is evaluated
  // against the status at card declaration, not after CARD_PLAY P-item effects.
  // The real #4 turn 1: 0 -> P-item +8 must not unlock the card\u0027s +88 effect.
  if (String(fieldStatusType ?? "") === "ProduceExamFieldStatusType_CardPlayAggressiveUp"
      && state.cardTriggerAggressiveAtPlayStart != null) {
    return Number(state.cardTriggerAggressiveAtPlayStart);
  }
  switch (MASTER_FIELD_STATUS_TO_EXAM[String(fieldStatusType ?? "")]) {
    case "lastMentalCard": return state.lastPlayedCard?.category === "ProduceCardCategory_MentalSkill" ? 1 : 0;
    case "playCardLesson": return state.lastPlayedCard?.category === "ProduceCardCategory_ActiveSkill" ? 1 : 0;
    case "debuffCount": return nativeDebuffEntries(state).length;
    case "staminaRatioPermil": {
      const max = Number(state.exam.maxStamina ?? 0);
      return max > 0 ? Math.trunc(Number(state.exam.stamina ?? 0) * 1000 / max) : 0;
    }
    case "idolStatusConcentration":
      return Number(state.exam.idolStatusType ?? 0) === 1 ? Number(state.exam.idolStatusStep ?? 1) : 0;
    case "idolStatusPreservation":
      return Number(state.exam.idolStatusType ?? 0) === 2 ? Number(state.exam.idolStatusStep ?? 1) : 0;
    case "idolStatusFullPower":
      return Number(state.exam.idolStatusType ?? 0) === 3 ? Number(state.exam.idolStatusStep ?? 1) : 0;
    case "remainingTurn":
      return state.turnLimit == null ? Infinity
        : Math.max(0, Number(state.turnLimit) - Number(state.turn ?? 0) + (state.turnOpen ? 1 : 0));
    case "turnProgress":
      return Number(state.turn ?? 0);
    case "conditionThresholdMultipleDown": {
      const target = Math.max(0, Number(state.exam.targetScore ?? 0));
      return target > 0 ? Math.trunc(Number(state.exam.parameter ?? 0) * 1000 / target) : 0;
    }
    case "noStance":
      return Number(state.exam.idolStatusType ?? 0) === 0 ? 1 : 0;
    case "noBlock":
      return Number(state.exam.block ?? 0) === 0 ? 1 : 0;
    case "turnPlayCardCount":
      return Number(state.exam.turnCardPlayCount ?? state.currentTurnPlays?.length ?? 0);
    case undefined:
      return null;
    default:
      return Number(state.exam[MASTER_FIELD_STATUS_TO_EXAM[String(fieldStatusType ?? "")]] ?? 0);
  }
}

export function cardMatchesMasterSearch(card, search) {
  if (!search) return true;
  if (!card) return false;
  const ids = new Set((search.produceCardIds ?? []).map(String));
  if (ids.size && !ids.has(String(card.id ?? ""))) return false;
  const categories = new Set((search.cardCategories ?? []).map(String));
  if (categories.size && !categories.has(String(card.category ?? ""))) return false;
  const rarities = new Set((search.cardRarities ?? []).map(String));
  if (rarities.size && !rarities.has(String(card.rarity ?? ""))) return false;
  const upgrades = new Set((search.upgradeCounts ?? []).map(Number));
  if (upgrades.size && !upgrades.has(Number(card.upgradeCount ?? 0))) return false;
  const planType = String(search.planType ?? "");
  if (planType && planType !== "ProducePlanType_Unknown" && planType !== String(card.planType ?? "")) return false;
  const tag = String(search.cardSearchTag ?? "");
  if (tag) {
    // Idol-unique is derived from the card's official originIdolCardId;
    // ProduceCard masters do not provide a literal searchTag for this class.
    const idolUnique = tag === "idol-unique" && Boolean(String(card.originIdolCardId ?? ""));
    if (!idolUnique && tag !== String(card.searchTag ?? "")) return false;
  }
  const costType = String(search.costType ?? "");
  if (costType && costType !== "ExamCostType_Unknown" && costType !== String(card.costType ?? "")) return false;
  const groups = new Set((search.effectGroupIds ?? []).map(String));
  if (groups.size) {
    const cardGroups = new Set((card.effectGroupIds ?? []).map(String));
    for (const group of groups) if (!cardGroups.has(group)) return false;
  }
  if (search.isCustomized === true) {
    const customized = (Array.isArray(card.customizes) && card.customizes.length > 0)
      || (Array.isArray(card.customGrowEffects) && card.customGrowEffects.length > 0);
    if (!customized) return false;
  }
  if (search.staminaMinMaxType === "ConditionMinMaxType_MinMax") {
    const value = Number(card.stamina ?? 0);
    if (value < Number(search.staminaMin ?? 0) || value > Number(search.staminaMax ?? 0)) return false;
  }
  return true;
}

function cardsForMasterSearch(state, search, context = {}) {
  const position = String(search?.cardPositionType ?? "");
  const all = [
    ...(state.hand ?? []),
    ...(state.deck ?? []),
    ...(state.discard ?? []),
    ...(state.lost ?? []),
    ...(state.hold ?? []),
  ];

  // DeckAll enumerates card-pool slots; a currently playing card has already
  // left Hand and is not in the Deck/Grave/Hold/Lost pools. In particular,
  // this prevents DeckAll grow effects from upgrading their own in-flight card.
  if (position === "ProduceCardPositionType_DeckAll") return all;
  if (position === "ProduceCardPositionType_NotLost") return all.filter((card) => !state.lost.includes(card));
  if (position === "ProduceCardPositionType_Target") return context.card ? [context.card] : [];
  if (!position || position.endsWith("_Unknown")) {
    return context.card ? [context.card] : all;
  }
  if (position.includes("Playing")) return context.card ? [context.card] : [];
  if (position.includes("Hand")) return state.hand ?? [];
  if (position.includes("Deck") && position.includes("Grave")) {
    return [...(state.deck ?? []), ...(state.discard ?? [])];
  }
  if (position.includes("Deck")) return state.deck ?? [];
  if (position.includes("Grave")) return state.discard ?? [];
  if (position.includes("Lost")) return state.lost ?? [];
  if (position.includes("Hold")) return state.hold ?? [];
  if (position.includes("All")) return all;
  return context.card ? [context.card] : all;
}

function masterSearchMatchCount(state, search, context = {}) {
  return cardsForMasterSearch(state, search, context)
    .filter((card) => cardMatchesMasterSearch(card, search))
    .length;
}

function triggerSearchMatches(state, trigger, context) {
  const search = trigger.cardSearch;
  if (!search) return true;
  const position = String(search.cardPositionType ?? "");
  const lower = Math.max(0, Number(trigger.lowerSearchCount ?? 0) || 0);
  const upper = Math.max(0, Number(trigger.upperSearchCount ?? 0) || 0);
  const count = masterSearchMatchCount(state, search, context);

  if (lower > 0 && count < lower) return false;
  if (upper > 0 && count > upper) return false;
  if (lower > 0 || upper > 0) return true;

  if (position.includes("Playing")) {
    return cardMatchesMasterSearch(context.card, search);
  }
  if (!position || position.endsWith("_Unknown")) {
    return context.card ? cardMatchesMasterSearch(context.card, search) : count > 0;
  }
  return count > 0;
}

function parsedMasterEffectType(parsed) {
  const explicit = String(parsed?.masterEffectType ?? "");
  if (explicit) return explicit;
  switch (String(parsed?.kind ?? "")) {
    case "lesson":
    case "lesson_add_multiple_parameter_buff":
    case "lesson_depend_parameter_buff":
    case "lesson_depend_exam_review":
    case "lesson_depend_exam_aggressive":
      return "ProduceExamEffectType_ExamLesson";
    case "lesson_multiple_lesson_buff": return "ProduceExamEffectType_ExamMultipleLessonBuffLesson";
    case "block": return "ProduceExamEffectType_ExamBlock";
    case "review": return "ProduceExamEffectType_ExamReview";
    case "aggressive": return "ProduceExamEffectType_ExamCardPlayAggressive";
    case "lesson_buff": return "ProduceExamEffectType_ExamLessonBuff";
    case "parameter_buff": return "ProduceExamEffectType_ExamParameterBuff";
    case "parameter_buff_reduce": return "ProduceExamEffectType_ExamParameterBuffReduce";
    case "concentration": return "ProduceExamEffectType_ExamConcentration";
    case "preservation": return "ProduceExamEffectType_ExamPreservation";
    case "add_grow_effect": return "ProduceExamEffectType_ExamAddGrowEffect";
    case "stamina_recover": return "ProduceExamEffectType_ExamStaminaRecoverFix";
    case "card_draw": return "ProduceExamEffectType_ExamCardDraw";
    case "playable_add": return "ProduceExamEffectType_ExamPlayableValueAdd";
    case "extra_turn": return "ProduceExamEffectType_ExamExtraTurn";
    case "stamina_consumption_down": return "ProduceExamEffectType_ExamStaminaConsumptionDown";
    case "stamina_consumption_add": return "ProduceExamEffectType_ExamStaminaConsumptionAdd";
    case "stamina_consumption_down_fix": return "ProduceExamEffectType_ExamStaminaConsumptionDownFix";
    case "stamina_consumption_add_fix": return "ProduceExamEffectType_ExamStaminaConsumptionAddFix";
    default: return "";
  }
}

function lessonTypeMatches(expectedInput, actualInput) {
  const expected = String(expectedInput ?? "");
  if (!expected || expected.endsWith("_Unknown")) return true;
  const actual = String(actualInput ?? "");
  if (expected === actual) return true;
  const expectedCore = expected.replace(/^ProduceStepLessonType_/, "").replace(/^Lesson|Lesson$/g, "");
  const actualCore = actual.replace(/^ProduceStepLessonType_/, "").replace(/^Lesson|Lesson$/g, "");
  return expectedCore === actualCore;
}

function masterPhaseValue(state, phaseType, context) {
  switch (String(phaseType ?? "")) {
    case "ProduceExamPhaseType_StartPlay":
    case "ProduceExamPhaseType_ExamCardPlay":
    case "ProduceExamPhaseType_ExamCardPlayAfter":
      return 0; // These phase values are zero; they are not turn numbers.
    case "ProduceExamPhaseType_ExamStartExam":
      return Number(state.turn ?? 0) === 0 ? 1 : 0;
    case "ProduceExamPhaseType_ExamTurnCheck":
      return Number(context.nextTurn ?? state.turn ?? 0) + (context.nextTurn === undefined ? 1 : 0);
    case "ProduceExamPhaseType_ExamTurnInterval":
    case "ProduceExamPhaseType_ExamEndTurnInterval":
    case "ProduceExamPhaseType_ExamTurnTimer":
      // Card-installed TriggerEffectStatusEffect.TurnCount (+0x88):
      // GetTurnIntervalEffectList.b__0 @0x807ff14 -> IsTurnIntervalTrigger
      // @0x803fc34. Keep the existing setup P-item clock; it is independently
      // verified by all four contest #4 recordings. Card installs carry
      // their own origin, which must also survive checkpoint restoration.
      return context.registration?.installedTurn == null
        ? Number(state.turn ?? 0)
        : Math.max(0, Number(state.turn ?? 0)
          - Math.max(1, Number(context.registration.installedTurn)));
    case "ProduceExamPhaseType_ExamPlayCountInterval":
    case "ProduceExamPhaseType_ExamPlayCountIntervalAfter":
    case "ProduceExamPhaseType_ExamPlayTurnCountInterval":
      return Number(context.registration?.metadata.cardPhaseCount ?? 0);
    case "ProduceExamPhaseType_ExamAggressiveUpInterval":
      return Number(state.exam.aggressive ?? 0);
    case "ProduceExamPhaseType_ExamStanceChangeCountInterval":
      return Number(state.exam.stanceChangeCount ?? 0);
    case "ProduceExamPhaseType_ExamCardDraw":
      return 1; // IsDrawCardTrigger evaluates each individual draw result.
    default:
      return Number(state.turn ?? 0);
  }
}

function triggerFieldStatusesMatch(state, trigger, context = {}) {
  const types = trigger.fieldStatusTypes ?? [];
  const values = trigger.fieldStatusValues ?? [];
  const checks = trigger.fieldStatusCheckTypes ?? [];
  for (let index = 0; index < types.length; index += 1) {
    const type = String(types[index] ?? "");
    let current;
    if (type === "ProduceExamFieldStatusType_CardSearchCountUp") {
      current = masterSearchMatchCount(state, trigger.fieldStatusCardSearches?.[index], context);
    } else if (
      (type === "ProduceExamFieldStatusType_StaminaUpMultiple"
        || type === "ProduceExamFieldStatusType_StaminaLessMultiple")
      && context?.card && Number.isFinite(context.beforeCardStaminaRatioPermil)
    ) {
      // Card-play P-items test the stamina threshold at play declaration,
      // before this card pays its cost. The actual effect still executes
      // in CARD_PLAY, before the card's own playEffects.
      current = context.beforeCardStaminaRatioPermil;
    } else {
      current = masterFieldStatusValue(state, type);
    }
    if (current === null) return false;
    const rawExpected = Number(values[index] ?? 1);
    // FullPowerUp=0 is an existence test. It must never match no stance.
    const expected = type === "ProduceExamFieldStatusType_FullPowerUp" && rawExpected === 0
      ? 1 : rawExpected;
    const check = String(checks[index] ?? "ProduceExamTriggerCheckType_Unknown");
    const reverse = type === "ProduceExamFieldStatusType_StaminaLessMultiple"
      || type === "ProduceExamFieldStatusType_RemainingTurn"
      || type.endsWith("MultipleDown");
    const categoryCondition = type === "ProduceExamFieldStatusType_PlayCardSkill"
      || type === "ProduceExamFieldStatusType_PlayCardLesson";
    const positiveMatch = categoryCondition ? current === 1 : reverse ? current <= expected : current >= expected;
    if (check === "ProduceExamTriggerCheckType_Not" ? positiveMatch : !positiveMatch) return false;
  }
  return true;
}

function masterTriggerSupportIssue(trigger, phaseType) {
  if (!MASTER_EXAM_PHASE_TO_NATIVE[String(phaseType ?? "")]) return `phase:${String(phaseType ?? "")}`;
  for (const type of trigger.fieldStatusTypes ?? []) {
    if (!MASTER_FIELD_STATUS_TO_EXAM[String(type ?? "")]) return `fieldStatus:${String(type ?? "")}`;
  }
  return "";
}

// Native IsCardPlayValidTrigger reads an enchant's phase count, filtered by
// its field conditions and card search. Increment all counters before firing
// any effect so an earlier effect cannot change which plays are counted.
// After-play counters also advance here: an enchant installed by the card's
// own effects must not count that installing card.
function incrementMasterCardPhaseCounts(state, phase, runtimeEvent, extra) {
  const context = { state, exam: state.exam, event: runtimeEvent,
    lessonType: currentNativeLessonType(state), ...extra };
  for (const registration of state.effectScheduler.registrations) {
    const condition = registration.condition;
    if (!registration.active || ![phase, NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY].includes(registration.phase)
      || condition?.kind !== "masterExamTrigger"
      || !["ProduceExamPhaseType_ExamPlayCountInterval", "ProduceExamPhaseType_ExamPlayCountIntervalAfter",
        "ProduceExamPhaseType_ExamPlayTurnCountInterval"].includes(condition.phaseType)) continue;
    const metadata = registration.metadata;
    const serial = Number(context.cardPlayCount);
    if (metadata.lastCountedCardPlay === serial) continue;
    metadata.lastCountedCardPlay = serial;
    if (condition.phaseType === "ProduceExamPhaseType_ExamPlayTurnCountInterval"
      && metadata.cardPhaseCountTurn !== state.turn) {
      metadata.cardPhaseCount = 0;
      metadata.cardPhaseCountTurn = state.turn;
    }
    const trigger = condition.trigger ?? {};
    if (!triggerFieldStatusesMatch(state, trigger, context)
      || !lessonTypeMatches(trigger.lessonType, context.lessonType)
      || !triggerSearchMatches(state, trigger, context)) continue;
    metadata.cardPhaseCount = Number(metadata.cardPhaseCount ?? 0) + 1;
  }
}

function matchesMasterExamTrigger(state, condition, context, runtimeEvent) {
  const trigger = condition.trigger ?? {};
  const activationKey = String(condition.activationKey ?? "");
  if (activationKey && runtimeEvent.__nativeEffectFired?.has?.(activationKey)) return false;
  if (condition.phaseType === "ProduceExamPhaseType_ExamStartExam" && Number(state.turn ?? 0) !== 0) return false;
  if (condition.phaseType === "ProduceExamPhaseType_StartExamPlay" && Number(state.turn ?? 0) !== 0) return false;
  if (condition.phaseType === "ProduceExamPhaseType_ExamTurnSkip" && String(context.action ?? "") !== "skip") return false;

  const statusField = context.statusChange?.field;
  // A delayed consumption event must not retrigger unrelated status-decrease
  // enchantments that already saw the immediate card-cost transition.
  if (context.deferredBuffConsume && condition.phaseType !== "ProduceExamPhaseType_ExamBuffConsume") return false;
  // ExamBuffConsume is a consumption trigger, not a general STATUS_DECREASED.
  // In particular Block (元気) being spent to pay card cost must not fire it.
  // Only the recognized consumable buff-status fields qualify. This is a
  // conservative filter pending additional native status-class coverage.
  if (condition.phaseType === "ProduceExamPhaseType_ExamBuffConsume") {
    // SpendTurn reduces finite-turn buff counters but is not a buff *cost*.
    // The native ExamBuffConsume phase fires when paying a buff cost (or an
    // explicit consume effect), not when a status duration naturally ticks.
    if (context.cause !== "cardCostDeferred"
      && !(context.cause === "effect" && /Consume|Reduce/.test(String(context.effectType ?? "")))) return false;
    const consumableBuffs = new Set([
      "review", "aggressive", "parameterBuff", "lessonBuff",
      "staminaConsumptionDown", "parameterBuffMultiplePerTurn",
    ]);
    if (!consumableBuffs.has(statusField) || !(Number(context.statusChange?.delta) < 0)) return false;
  }
  const requiredField = {
    ProduceExamPhaseType_ExamStanceChangeConcentration: "concentrationChangeCount",
    ProduceExamPhaseType_ExamStanceChangePreservation: "preservationChangeCount",
    ProduceExamPhaseType_ExamStanceChangeFullPower: "fullPowerChangeCount",
    ProduceExamPhaseType_ExamStanceChangeCountInterval: "stanceChangeCount",
    ProduceExamPhaseType_ExamStaminaReduce: "stamina",
    ProduceExamPhaseType_ExamStaminaReduceCard: "stamina",
    ProduceExamPhaseType_ExamAggressiveUpInterval: "aggressive",
  }[condition.phaseType];
  if (requiredField && requiredField !== statusField) return false;
  if (condition.phaseType === "ProduceExamPhaseType_ExamStaminaReduce"
    && context.cause !== "effect") return false;
  if (condition.phaseType === "ProduceExamPhaseType_ExamStaminaReduceCard"
    && context.cause !== "cardCost") return false;
  if (condition.phaseType === "ProduceExamPhaseType_ExamStanceChangeFromConcentration"
    && (statusField !== "idolStatusType" || context.statusChange?.before !== 1)) return false;
  if (condition.phaseType === "ProduceExamPhaseType_ExamStanceChangeFromFullPower"
    && (statusField !== "idolStatusType" || context.statusChange?.before !== 3)) return false;
  if (condition.ownerToken) {
    const owner = findRuntimeCard(state, condition.ownerToken);
    if (!owner || owner.produceCardStatusEnchantId !== condition.enchantId) return false;
    if (state.cardEnchantRegistrations.get(activationKey)?.remainingCount === 0) return false;
    if (trigger.cardSearch?.isSelf && owner.token !== context.card?.token) return false;
  }
  const phaseValues = (trigger.phaseValues ?? []).map(Number).filter(Number.isFinite);
  if (phaseValues.length) {
    const value = masterPhaseValue(state, condition.phaseType, context);
    const interval = /Interval(?:After)?$/.test(condition.phaseType);
    const zeroInterval = condition.phaseType === "ProduceExamPhaseType_ExamEndTurnInterval";
    if (!(interval ? phaseValues.some((n) => n > 0 && (value > 0 || zeroInterval && value === 0) && value % n === 0) : phaseValues.includes(value))) return false;
  }
  if (!triggerFieldStatusesMatch(state, trigger, context)) return false;
  if (!lessonTypeMatches(trigger.lessonType, context.lessonType)) return false;
  if (!triggerSearchMatches(state, trigger, context)) return false;

  const effectTypes = new Set((trigger.effectTypes ?? []).map(String).filter(Boolean));
  if (effectTypes.size) {
    // Native status differences describe the resulting Review increase,
    // including dependent Review effects (0x801A100), rather than its formula.
    const actualEffectType = statusField === "review" && Number(context.statusChange?.delta) > 0
      ? "ProduceExamEffectType_ExamReview" : String(
      context.effectType
      ?? parsedMasterEffectType(context.parsedEffect)
      ?? "",
    );
    if (!effectTypes.has(actualEffectType)) return false;
  }
  return true;
}

function nativeDebuffEntries(state) {
  const exam = state.exam;
  const fields = new Set(["parameterDebuff", "lessonDebuff", "slump", "panic", "blockAddDownFix", "blockRestriction", "blockAddDown", "staminaRecoverRestriction", "startTurnCardDrawDown", "buffConsumptionAdd"]);
  return [
    ...(exam.genericTimedStatuses ?? []).filter((row) => fields.has(row.field)).map((row) => ({ row, pool: exam.genericTimedStatuses })),
    ...(exam.scoreTimedStatuses ?? []).filter((row) => row.kind === "lessonParameterDown").map((row) => ({ row, pool: exam.scoreTimedStatuses })),
    ...(state.searchPlayCardLimits ?? []).map((row) => ({ row, pool: state.searchPlayCardLimits })),
    ...["staminaConsumptionAdd", "staminaConsumptionAddFix"].filter((field) => Number(exam[field]) > 0).map((field) => ({ field })),
  ];
}
function recoverNativeDebuffs(state, limit) {
  // DebuffRecoverEffectExecutor orders by descending status Uid (newest first).
  const entries = nativeDebuffEntries(state).sort((a, b) =>
    Number(b.row?.uid ?? state.exam.debuffFieldUids?.[b.field] ?? 0)
    - Number(a.row?.uid ?? state.exam.debuffFieldUids?.[a.field] ?? 0));
  for (const entry of limit > 0 ? entries.slice(0, Math.trunc(limit)) : entries) {
    if (entry.field) state.exam[entry.field] = 0;
    else entry.pool.splice(entry.pool.indexOf(entry.row), 1);
  }
  syncNativeGenericTimedStatuses(state.exam);
  syncNativeScoreTimedStatuses(state.exam);
}
function findRuntimeCard(state, token) {
  return [state.playingCard, ...state.hand, ...state.deck, ...state.discard, ...state.lost, ...state.hold].find((card) => card?.token === token);
}
function registerRuntimeCardEnchants(state) {
  for (const card of [state.playingCard, ...state.hand, ...state.deck, ...state.discard, ...state.lost, ...state.hold].filter(Boolean)) {
    const id = String(card.produceCardStatusEnchantId ?? "");
    if (!id) continue;
    const key = card.token + "::" + id;
    if (state.cardEnchantRegistrations.has(key)) continue;
    const enchant = state.cardStatusEnchantById.get(id);
    if (!enchant) { rememberUnsupported(state, "card-enchant:" + id); continue; }
    const trigger = resolvedRuntimeMasterTrigger(state, enchant.produceExamTriggerId);
    if (!trigger) { rememberUnsupported(state, "card-enchant-trigger:" + enchant.produceExamTriggerId); continue; }
    const specs = [];
    for (const phaseType of trigger.phaseTypes ?? []) {
      const issue = masterTriggerSupportIssue(trigger, phaseType);
      if (issue) { rememberUnsupported(state, "card-enchant-trigger:" + trigger.id + ":" + issue); continue; }
      const mapped = MASTER_EXAM_PHASE_TO_NATIVE[phaseType];
      for (const phase of mapped === "statusChange" ? [NATIVE_EFFECT_PHASE.STATUS_INCREASED, NATIVE_EFFECT_PHASE.STATUS_DECREASED] : [mapped]) {
        specs.push({ id, phase, installedTurn: state.turn,
          condition: { kind: "masterExamTrigger", phaseType, trigger, ownerToken: card.token, enchantId: id, activationKey: key },
          effects: [{ kind: "cardEnchantGrow", token: card.token, growEffectIds: enchant.produceCardGrowEffectIds ?? [] }],
          metadata: { activationKey: key, cardEnchantKey: key } });
      }
    }
    state.cardEnchantRegistrations.set(key, { registrationIds: registerNativeEnchantEffects(state.effectScheduler, id, specs).map((r) => r.registrationId),
      remainingCount: Number(enchant.triggerCount) > 0 ? Number(enchant.triggerCount) : null });
  }
}

function registerResolvedPItems(state) {
  state.pItemEffectRemainingCounts = new Map();
  for (const item of state.pItems ?? []) {
    const pItemId = String(item.id ?? "");
    if (item.unresolved) {
      rememberUnsupported(state, `pitem:${pItemId}`);
      continue;
    }
    for (const effect of item.effects ?? []) {
      if (effect.unresolved) {
        rememberUnsupported(state, `pitem-effect:${String(effect.id ?? "")}`);
        continue;
      }
      if (effect.effectType !== "ProduceItemEffectType_ExamStatusEnchant") {
        // ProduceEffect rows are resolved by the out-of-exam produce flow.
        // They intentionally have no action inside an exam and are not an
        // unsupported battle effect.
        if (effect.effectType !== "ProduceItemEffectType_ProduceEffect" && effect.effectType) {
          rememberUnsupported(state, `pitem-effect-type:${effect.effectType}`);
        }
        continue;
      }
      const enchant = effect.examStatusEnchant;
      const trigger = enchant?.trigger;
      if (!enchant || !trigger) {
        rememberUnsupported(state, `pitem-enchant:${String(effect.produceExamStatusEnchantId ?? "")}`);
        continue;
      }

      const effectRows = (enchant.examEffects ?? []).filter((row) => !row.unresolved);
      if (!effectRows.length) {
        rememberUnsupported(state, `pitem-enchant-effects:${String(enchant.id ?? "")}`);
        continue;
      }
      for (const row of enchant.examEffects ?? []) {
        if (row.unresolved) rememberUnsupported(state, `pitem-exam-effect:${String(row.id ?? "")}`);
      }

      const sharedKey = `${pItemId}::${String(effect.id ?? enchant.id ?? "")}`;
      // Native dispatch deduplicates the same ProduceItem identity at one
      // timing even if the item owns multiple enchant rows.
      const activationKey = `pItem::${pItemId}`;
      const rawCount = Number(effect.effectCount ?? 0);
      state.pItemEffectRemainingCounts.set(sharedKey, rawCount > 0 ? Math.trunc(rawCount) : null);
      const rawTurn = Number(effect.effectTurn ?? -1);
      const turn = rawTurn > 0 ? Math.trunc(rawTurn) : null;
      const specs = [];
      for (const phaseType of trigger.phaseTypes ?? []) {
        const supportIssue = masterTriggerSupportIssue(trigger, phaseType);
        if (supportIssue) {
          rememberUnsupported(state, `pitem-trigger:${String(trigger.id ?? "")}:${supportIssue}`);
          continue;
        }
        const mapped = MASTER_EXAM_PHASE_TO_NATIVE[String(phaseType)];
        const nativePhases = mapped === "statusChange"
          ? [NATIVE_EFFECT_PHASE.STATUS_INCREASED, NATIVE_EFFECT_PHASE.STATUS_DECREASED]
          : [mapped];
        for (const phase of nativePhases) {
          specs.push({
            id: String(effect.id ?? enchant.id ?? pItemId),
            phase,
            // Native ExamStartTurn precedes ExamTurnInterval within START_OF_TURN.
            priority: phaseType === "ProduceExamPhaseType_ExamStartTurn" ? -1 : 0,
            turn,
            condition: {
              kind: "masterExamTrigger",
              pItemId,
              activationKey,
              phaseType: String(phaseType),
              trigger: { ...trigger },
            },
            effects: effectRows.map((row) => ({ ...row })),
            metadata: {
              sharedCountKey: sharedKey,
              sharedPItemCountKey: sharedKey,
              activationKey,
              enchantId: String(enchant.id ?? ""),
              triggerId: String(trigger.id ?? ""),
              masterPhaseType: String(phaseType),
            },
          });
        }
      }
      if (specs.length) registerNativePItemEffects(state.effectScheduler, pItemId, specs);
    }
  }
}

function registerResolvedGimmicks(state) {
  state.gimmickEffectRemainingCounts = new Map();
  const gimmicks = [...(state.gimmicks ?? [])];

  // Native master rows are scheduled once at startTurn. They are resolved in
  // ascending priority order, and a failed field-status condition is final:
  // later status changes in the same turn must not make that row fire.
  const nativeRows = gimmicks
    .filter((row) => row && row.produceExamEffectId !== undefined && row.startTurn !== undefined)
    .sort((a, b) => (
      Number(a.startTurn ?? 0) - Number(b.startTurn ?? 0)
      || Number(a.priority ?? 0) - Number(b.priority ?? 0)
    ));
  for (const row of nativeRows) {
    const gimmickId = String(row.id ?? "");
    const effectId = String(row.produceExamEffectId ?? "");
    const startTurn = Math.max(0, Math.trunc(Number(row.startTurn ?? 0)));
    const priority = Math.trunc(Number(row.priority ?? 0));
    const sharedKey = `gimmick::${gimmickId}::${priority}::${startTurn}`;
    state.gimmickEffectRemainingCounts.set(sharedKey, 1);

    const masterEffect = state.examEffectById?.get?.(effectId) ?? effectId;
    registerNativeGimmickEffects(state.effectScheduler, gimmickId, [{
      id: sharedKey,
      phase: NATIVE_EFFECT_PHASE.START_OF_TURN,
      // Gimmicks execute before ordinary StartTurn enchants/P-items. Preserve
      // the master's own ascending priority inside that source tier.
      priority: -1_000_000 + priority,
      count: 1,
      condition: { kind: "nativeGimmickSchedule", row: { ...row } },
      effects: [{
        kind: "nativeGimmickRow",
        row: { ...row },
        effect: masterEffect && typeof masterEffect === "object"
          ? { ...masterEffect }
          : masterEffect,
      }],
      metadata: {
        sharedCountKey: sharedKey,
        activationKey: sharedKey,
        nativeGimmickRow: true,
        startTurn,
        priority,
      },
    }]);
  }

  // Normalized trigger/enchant-shaped gimmicks use the same scheduler path as
  // P-items. This adapter remains useful for decoded runtime data and tests.
  for (const gimmick of gimmicks.filter((row) => !nativeRows.includes(row))) {
    const gimmickId = String(gimmick.id ?? "");
    if (gimmick.unresolved) {
      rememberUnsupported(state, `gimmick:${gimmickId}`);
      continue;
    }

    for (const effect of gimmick.effects ?? []) {
      const enchant = effect.examStatusEnchant ?? effect.enchant ?? null;
      const trigger = enchant?.trigger ?? effect.trigger ?? null;
      const effectRows = (enchant?.examEffects ?? effect.examEffects ?? effect.effects ?? [])
        .filter((row) => !row?.unresolved);
      if (!trigger || !effectRows.length) {
        rememberUnsupported(state, `gimmick-effect:${String(effect.id ?? gimmickId)}`);
        continue;
      }

      const sharedKey = `gimmick::${gimmickId}::${String(effect.id ?? enchant?.id ?? "")}`;
      const activationKey = sharedKey;
      const rawCount = Number(effect.effectCount ?? 0);
      state.gimmickEffectRemainingCounts.set(sharedKey, rawCount > 0 ? Math.trunc(rawCount) : null);
      const rawTurn = Number(effect.effectTurn ?? -1);
      const turn = rawTurn > 0 ? Math.trunc(rawTurn) : null;
      const specs = [];

      for (const phaseType of trigger.phaseTypes ?? []) {
        const supportIssue = masterTriggerSupportIssue(trigger, phaseType);
        if (supportIssue) {
          rememberUnsupported(state, `gimmick-trigger:${String(trigger.id ?? "")}:${supportIssue}`);
          continue;
        }
        const mapped = MASTER_EXAM_PHASE_TO_NATIVE[String(phaseType)];
        const nativePhases = mapped === "statusChange"
          ? [NATIVE_EFFECT_PHASE.STATUS_INCREASED, NATIVE_EFFECT_PHASE.STATUS_DECREASED]
          : [mapped];
        for (const phase of nativePhases) {
          specs.push({
            id: String(effect.id ?? enchant?.id ?? gimmickId),
            phase,
            turn,
            condition: {
              kind: "masterExamTrigger",
              activationKey,
              phaseType: String(phaseType),
              trigger: { ...trigger },
            },
            effects: effectRows.map((row) => ({ ...row })),
            metadata: {
              sharedCountKey: sharedKey,
              activationKey,
              enchantId: String(enchant?.id ?? ""),
              triggerId: String(trigger.id ?? ""),
              masterPhaseType: String(phaseType),
            },
          });
        }
      }
      if (specs.length) registerNativeGimmickEffects(state.effectScheduler, gimmickId, specs);
    }
  }
}

function registerParsedStatusEnchant(state, parsed) {
  const trigger = parsed?.trigger ?? {};
  const phase = schedulerPhaseForLegacyEnchant(trigger);
  if (!phase) {
    rememberUnsupported(state, `enchant-trigger:${String(trigger.phase ?? "")}`);
    return null;
  }

  // Activation starts after the installing card's after-check. During main
  // effects the completed-use counter does not yet contain that card.
  const installedCardPlayCount = Number(state.exam.cardPlayCount ?? 0) + (state.playingCard ? 1 : 0);
  const conditions = [];

  if (trigger.field && trigger.min !== undefined && trigger.min !== null) {
    conditions.push({
      field: `exam.${trigger.field}`,
      op: "gte",
      value: Number(trigger.min),
    });
  }
  if (trigger.field && trigger.max !== undefined && trigger.max !== null) {
    conditions.push({
      field: `exam.${trigger.field}`,
      op: "lte",
      value: Number(trigger.max),
    });
  }
  if (trigger.idolStatusType !== undefined && trigger.idolStatusType !== null) {
    conditions.push({
      field: "exam.idolStatusType",
      op: "eq",
      value: Number(trigger.idolStatusType),
    });
  }
  if (trigger.idolStatusStepMin !== undefined && trigger.idolStatusStepMin !== null) {
    conditions.push({
      field: "exam.idolStatusStep",
      op: "gte",
      value: Number(trigger.idolStatusStepMin),
    });
  }
  if (trigger.category) {
    conditions.push({ cardCategory: String(trigger.category) });
  }
  if (trigger.skillCard) {
    conditions.push({
      field: "card.category",
      op: "in",
      value: [
        "ProduceCardCategory_ActiveSkill",
        "ProduceCardCategory_MentalSkill",
      ],
    });
  }
  if (phase === NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY) {
    // A status enchant installed by the currently playing card must not
    // trigger on that same card.
    conditions.push({
      field: "exam.cardPlayCount",
      op: "gt",
      value: installedCardPlayCount,
    });
  }
  if (Number(trigger.playCountInterval ?? 0) > 0) {
    conditions.push({
      playCountSinceInstallInterval: Number(trigger.playCountInterval),
    });
  }

  const [registration] = registerNativeEnchantEffects(
    state.effectScheduler,
    parsed.enchantId,
    [{
      id: parsed.id,
      phase,
      turn: parsed.turn,
      count: parsed.count,
      condition: conditions.length ? { all: conditions } : null,
      effects: (parsed.effects ?? []).map((effect) => ({ ...effect })),
      metadata: {
        installedCardPlayCount,
        legacyTrigger: { ...trigger },
        originCard: historyCard(state.effectOwnerCard ?? state.playingCard),
      },
    }],
  );
  return registration;
}

function recycleIfNeeded(state) {
  if (state.deck.length || !state.discard.length) return null;
  const source = state.discard.map((card) => ({ ...card }));
  const shuffled = shuffleObjectsWithState(state.discard, state.randomState);
  state.deck = shuffled.deck;
  state.discard = [];
  state.randomState = shuffled.randomState;
  state.recycleCount += 1;
  const event = {
    recycleCount: state.recycleCount,
    source,
    shuffled: state.deck.map((card) => ({ ...card })),
    randomState: state.randomState,
  };
  state.lastRecycle = event;
  return event;
}

function supportCardParameterMatches(state, supportCard) {
  const filter = String(
    supportCard?.filterParameterType
    ?? supportCard?.FilterParameterType
    ?? "",
  );
  if (!filter || filter.endsWith("_Unknown") || filter === "Unknown") return true;
  const current = String(currentTowerScoreContext(state).parameterType ?? "");
  if (!current) return false;
  const normalizedFilter = filter
    .replace(/^ProduceExamParameterType_/, "")
    .replace(/^ProduceParameterType_/, "")
    .toLowerCase();
  return normalizedFilter === current.toLowerCase();
}

function cloneRuntimeCardSnapshot(card) {
  const {
    _supportBaseSnapshot,
    _supportUpgradeCount,
    ...source
  } = card ?? {};
  return {
    ...source,
    effectGroupIds: Array.isArray(source.effectGroupIds) ? [...source.effectGroupIds] : source.effectGroupIds,
    playEffects: Array.isArray(source.playEffects) ? source.playEffects.map((effect) => ({ ...effect })) : source.playEffects,
    customizes: Array.isArray(source.customizes) ? source.customizes.map((item) => ({ ...item })) : source.customizes,
    customGrowEffects: source.customGrowEffects?.map((effect) => ({ ...effect })),
    runtimeGrowEffects: source.runtimeGrowEffects?.map((effect) => ({ ...effect })),
  };
}

function applyPersistentRuntimeCardGrowEffects(card, effects) {
  applyRuntimeCardGrowEffects(card, effects);
  // Support upgrades are temporary, but growth earned during the turn is not.
  // Keep the permanent snapshot current so rollback and permanent upgrades
  // retain the same growth without applying it twice to the active variant.
  if (card._supportBaseSnapshot) applyRuntimeCardGrowEffects(card._supportBaseSnapshot, effects);
}

function applyRuntimeUpgradeVariant(state, card, targetUpgradeCount) {
  const target = Math.max(0, Math.trunc(Number(targetUpgradeCount) || 0));
  const master = state.cardVariantByKey?.get?.(`${card.id}@@${target}`);
  if (!master) {
    rememberUnsupported(state, `card-upgrade-master:${card.id}@@${target}`);
    card.upgradeCount = target;
    return target;
  }

  // Rebuild from the exact master variant, then reapply the card's customization
  // route. A support-card upgrade must change not only the displayed + count but
  // also cost/playEffects, while preserving custom grow effects.
  const rebuilt = applyCardCustomizations({
    ...card,
    ...master,
    token: card.token,
    originalIndex: card.originalIndex,
    generated: card.generated,
    growBlockAdd: card.growBlockAdd,
    growCostAdd: card.growCostAdd,
    customizes: Array.isArray(card.customizes) ? card.customizes.map((item) => ({ ...item })) : [],
    upgradeCount: target,
    playEffects: Array.isArray(master.playEffects)
      ? master.playEffects.map((effect) => ({ ...effect }))
      : [],
  }, state.customizeById, state.growEffectById);
  const grows = [...(card.runtimeGrowEffects ?? [])];
  rebuilt.runtimeGrowEffects = [];
  // Each upgrade variant has its own master/customization cost baseline.
  // Recompute all in-exam cost growth on that baseline, never the preceding
  // upgrade's already-modified stamina.
  delete rebuilt._runtimeGrowStaminaBase;
  applyRuntimeCardGrowEffects(rebuilt, grows);
  Object.assign(card, rebuilt);
  card.onceOnly = isOnceOnlyMove(card.playMovePositionType);
  return target;
}

function applySupportCardUpgradeInPlace(state, card) {
  if (!card._supportBaseSnapshot) {
    card._supportBaseSnapshot = cloneRuntimeCardSnapshot(card);
    card._supportUpgradeCount = 0;
  }
  card._supportUpgradeCount = Math.max(0, Number(card._supportUpgradeCount ?? 0)) + 1;
  return applyRuntimeUpgradeVariant(state, card, Number(card.upgradeCount ?? 0) + 1);
}

// ExamCardUpgrade writes ExamCardData._tmpUpgradeCount, separately from the
// initial _baseUpgradeCount. Native pool captures preserve this count across
// turn boundaries and card moves: the upgrade lasts for the exam, not just the
// current turn. Support-card-triggered upgrades have their own rollback scope.
// IsUpgradableRaw restricts the skill effect to a base-unupgraded card.
function applyTemporarySkillUpgradeInPlace(state, card) {
  const base = card?._supportBaseSnapshot ?? card;
  if (Number(base?.upgradeCount ?? 0) !== 0
    || Number(card?._skillUpgradeCount ?? 0) > 0
    || !state.cardVariantByKey?.has(`${card.id}@@1`)) return Number(card?.upgradeCount ?? 0);
  card._skillUpgradeCount = 1;
  // A support upgrade may already have raised the effective stage. Load the
  // matching ++/+++ master rather than only changing the visible counter.
  // Do not save this as a turn-limited support snapshot.
  return applyRuntimeUpgradeVariant(state, card, Number(card.upgradeCount ?? 0) + 1);
}


function clearSupportCardUpgrades(state) {
  const seen = new Set();
  for (const pool of [state.hand, state.deck, state.discard, state.lost, state.hold]) {
    for (const card of pool ?? []) {
      if (!card || seen.has(card)) continue;
      seen.add(card);
      if (!card._supportBaseSnapshot) continue;
      const base = cloneRuntimeCardSnapshot(card._supportBaseSnapshot);
      // If ExamCardUpgrade was applied after a support upgrade, the support
      // snapshot predates it. Carry that skill upgrade forward at turn end.
      const skillAddedAfterSnapshot = Math.max(0,
        Number(card._skillUpgradeCount ?? 0) - Number(base._skillUpgradeCount ?? 0));
      for (const key of Object.keys(card)) delete card[key];
      Object.assign(card, base);
      if (skillAddedAfterSnapshot) {
        card._skillUpgradeCount = Number(base._skillUpgradeCount ?? 0) + skillAddedAfterSnapshot;
        applyRuntimeUpgradeVariant(state, card,
          Number(card.upgradeCount ?? 0) + skillAddedAfterSnapshot);
      }
    }
  }
}

function applyExamSupportCardUpgrades(state, drawnCards, runtimeEvent = null) {
  const cards = Array.isArray(drawnCards) ? drawnCards : [];
  const supportCards = Array.isArray(state.supportCards) ? state.supportCards : [];
  if (!cards.length || !supportCards.length) return [];

  const rolls = [];
  for (const card of cards) {
    for (const supportCard of supportCards) {
      const supportCardId = String(
        supportCard?.supportCardId
        ?? supportCard?.SupportCardId
        ?? supportCard?.id
        ?? "",
      );
      if (!supportCardId || state.turnUseSupportCardIds.has(supportCardId)) continue;
      if (!supportCardParameterMatches(state, supportCard)) continue;

      const searchId = String(
        supportCard?.cardSearchId
        ?? supportCard?.CardSearchId
        ?? supportCard?.produceCardSearchId
        ?? "",
      );
      // Every current SupportCard master row uses p_card_search-hand. The card
      // being processed has already entered Hand, so this common search needs
      // no catalog lookup and imposes no further card-property restriction.
      const handSearch = searchId === "p_card_search-hand";
      const search = handSearch ? null : resolvedMasterSearch(state, searchId);
      if (searchId && !handSearch && !search) {
        rememberUnsupported(state, `support-card-search:${searchId}`);
        continue;
      }
      if (search && !cardMatchesMasterSearch(card, search)) continue;

      // ExamSequence.GetInsertEffectResultTriggerCommand always rolls
      // GetRandomInt(0, 1000) after the support-card/card-search checks.  This
      // also advances XorShift for 0% and 100% upgrade probabilities.
      const randomStateBefore = state.randomState >>> 0;
      const result = consumeNativeRandomInt(state, 0, 1000);
      const permil = Math.max(0, Math.trunc(Number(
        supportCard?.produceCardUpgradePermil
        ?? supportCard?.ProduceCardUpgradePermil
        ?? supportCard?.upgradePermil
        ?? 0,
      ) || 0));
      const succeeded = result < permil;
      const roll = {
        supportCardId,
        cardId: String(card?.id ?? ""),
        cardToken: String(card?.token ?? ""),
        permil,
        result,
        succeeded,
        randomStateBefore,
        randomStateAfter: state.randomState >>> 0,
        upgradeCountBefore: Number(card?.upgradeCount ?? 0),
        upgradeCountAfter: Number(card?.upgradeCount ?? 0),
      };
      if (succeeded) {
        state.turnUseSupportCardIds.add(supportCardId);
        roll.upgradeCountAfter = applySupportCardUpgradeInPlace(state, card);
      }
      rolls.push(roll);
    }
  }
  state.supportCardRollHistory.push(...rolls);
  if (runtimeEvent) {
    if (!Array.isArray(runtimeEvent.supportCardRolls)) runtimeEvent.supportCardRolls = [];
    runtimeEvent.supportCardRolls.push(...rolls);
    for (const roll of rolls) {
      if (!roll.succeeded) continue;
      runtimeEvent.effects.push(
        `サポートカード ${roll.supportCardId}: ${runtimeCardName(state, roll.cardId, roll.upgradeCountAfter)}を強化`,
      );
    }
  }
  return rolls;
}

function drawCardsIntoHand(state, count, runtimeEvent = nativeRuntimeEvent(), notify = true) {
  const context = getExamEffectCalculateContext(state);
  const recycleEvents = [];
  const drawn = [];
  const capacity = normalizeHandLimit(state.handLimit);
  for (let i = 0; i < count; i += 1) {
    if (context.HandList.length >= capacity) break;
    if (!context.DeckList.length) {
      const event = recycleIfNeeded(state);
      if (event) recycleEvents.push(event);
    }
    if (!context.DeckList.length) break;
    const card = context.DeckList.shift();
    context.HandList.push(card);
    drawn.push(card);
  }
  if (notify) for (const card of drawn) notifyRuntimeCardMove(state, card, "deck", "hand", runtimeEvent, { drawn: true });
  return { drawn, recycleEvents };
}

function setNativeInitialCard(state, drawCount, runtimeEvent) {
  const capacity = normalizeHandLimit(state.handLimit);
  const moved = [];
  for (let index = state.deck.length - 1; index >= 0; index -= 1) {
    if (!state.deck[index]?.isInitial || state.hand.length >= capacity) continue;
    const [card] = state.deck.splice(index, 1);
    state.hand.push(card);
    moved.push(card);
  }

  const remaining = Math.max(0, Number(drawCount) - state.hand.length);
  const ordinary = remaining > 0
    ? drawCardsIntoHand(state, Math.min(remaining, Math.max(0, capacity - state.hand.length)), runtimeEvent, false)
    : { drawn: [], recycleEvents: [] };
  state.openingResolved = true;
  for (const card of moved) notifyRuntimeCardMove(state, card, "deck", "hand", runtimeEvent);
  for (const card of ordinary.drawn) notifyRuntimeCardMove(state, card, "deck", "hand", runtimeEvent, { drawn: true });
  return {
    drawn: [...moved, ...ordinary.drawn],
    recycleEvents: ordinary.recycleEvents,
  };
}

export function drawTowerTurn(state, drawCount = 3) {
  state.traceTurn = Number(state.turn) + 1;
  try {
    return traceSimulation(state, { type: "system", id: "turnStart", name: "ターン開始" }, () => drawTowerTurnImpl(state, drawCount));
  } finally { delete state.traceTurn; }
}
function drawTowerTurnImpl(state, drawCount = 3) {
  const examParameter = getExamParameterModel(state);
  const context = getExamEffectCalculateContext(state);
  const count = Number(drawCount);
  if (!Number.isInteger(count) || count < 1) throw new Error("1ターンのドロー枚数が不正です。");
  if (context.HandList.length) throw new Error("現在の手札を処理してから次ターンへ進んでください。");
  if (state.turnOpen) throw new Error("現在のターンを終了してから次ターンへ進んでください。");

  const hasTurnLimit = state.turnLimit !== null
    && state.turnLimit !== undefined
    && Number.isFinite(Number(state.turnLimit));
  const turnLimit = hasTurnLimit ? Number(state.turnLimit) : Number.POSITIVE_INFINITY;
  if (hasTurnLimit && Number(state.turn ?? 0) >= turnLimit) {
    state.playsRemaining = 0;
    state.ended = true;
    return {
      turn: state.turn,
      hand: [],
      drawn: [],
      recycleEvents: [],
      ended: true,
    };
  }

  beginSimulationTurn(state, state.turn + 1, currentTowerScoreContext({ ...state, turn: state.turn + 1 }));
  const phaseEvent = nativeRuntimeEvent();
  // Native v3.4.1 ReviewStatusEffect.SpendTurn (0x08082A18) spends a
  // previously-marked review at the NEXT turn boundary, before its actions.
  // StartPlay P-item review is marked during its granting turn; a card grant
  // stays unmarked until the next turn's StartPlay phase.
  if (Number(state.turn ?? 0) > 0) {
    const beforeReviewSpend = captureNativeStatusSnapshot(state.exam);
    const exam = state.exam;
    if (Number(exam.reviewTurnEndReduceLock ?? 0) === 0
        && exam.passingTurnStartFields?.review !== false
        && Number(exam.review ?? 0) > 0) {
      exam.review -= 1;
      exam.reviewConsumptionSum = Number(exam.reviewConsumptionSum ?? 0) + 1;
    }
    emitNativeStatusDiff(state, beforeReviewSpend, phaseEvent,
      { cause: "turnStartReviewSpend" });
  }
  state.ended = false;
  state.turnStartParameter = Number(examParameter.JudgeParameter ?? 0);
  runNativeEffectPhase(
    state,
    NATIVE_EFFECT_PHASE.BEFORE_START_OF_TURN,
    phaseEvent,
    { nextTurn: Number(state.turn ?? 0) + 1 },
  );

  const isOpeningTurn = state.turn === 0 && !state.openingResolved;
  examParameter.CurrentTurn += 1;
  state.turnOpen = true;
  context.RemainCanPlayCardCount = 1 + Number(state.playableAddStatus?.count ?? 0);
  state.normalPlayUsed = false;
  state.currentTurnPlays = [];
  examParameter.TurnCardPlayCount = 0;
  state.currentTurnDrinks = [];
  state.turnUseSupportCardIds = new Set();

  // ExamLoopTaskAsync @ 0x80b8260 clears the prior turn, then unsets
  // FullPower and consumes ten points before the next turn's card phases.
  resolveFullPowerAtTurnStart(state, phaseEvent);

  // Expire the timers now, but execute their commands after ordinary draw.
  // Phase-4 replay/timer commands can then add cards beyond the normal draw.
  const expiredTimers = takeExpiredTimers(state);
  runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.START_OF_TURN, phaseEvent);

  const extraDraw = Math.max(0, Number(state.pendingDraw ?? 0));
  state.pendingDraw = 0;
  // Before-draw setup/gimmicks can populate Hand. Interval replays and timer
  // effects run below, so their additional cards do not consume this quota.
  const targetHandSize = Math.max(0, count + extraDraw - Math.max(0, Number(state.exam.startTurnCardDrawDown ?? 0)));
  const requested = Math.max(0, targetHandSize - state.hand.length);
  const result = isOpeningTurn
    ? setNativeInitialCard(state, requested, phaseEvent)
    : drawCardsIntoHand(state, requested, phaseEvent);
  if (!isOpeningTurn && result.drawn.length && state.exam.panic) {
    const candidates = state.exam.runtimeSettings.produceExamPanicStaminaCandidates;
    if (!Array.isArray(candidates) || !candidates.length) rememberUnsupported(state, "panic-stamina-candidates");
    else for (const card of state.hand) card.temporaryStaminaConsumptionFix = Number(candidates[consumeNativeRandomInt(state, 0, candidates.length)]);
    phaseEvent.effects.push("パニック: 手札の体力消費を変更");
  }
  // Native support-card checks run card-major over every newly drawn card.
  // A support card is skipped for the rest of the turn only after it succeeds.
  // In the verified H.I.F opening (Vi turn), two Vi supports therefore produce
  // 4 rolls across the three opening cards: 531,20(success),826,786.
  applyExamSupportCardUpgrades(state, result.drawn, phaseEvent);
  // Native phase 4 runs timer commands after ordinary draw. Resolve each
  // reserved draw immediately; pendingDraw would postpone it another turn.
  for (const timer of expiredTimers) {
    for (let index = 0; index < Math.max(1, Math.trunc(Number(timer.count ?? 1) || 1)); index += 1) {
      executeParsedTowerEffect(state, timer.child, phaseEvent);
    }
  }
  runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.TURN_START_AFTER_DRAW, phaseEvent);
  state.turnStartSupportCardRolls = (phaseEvent.supportCardRolls ?? []).map((roll) => ({ ...roll }));
  if (Number(state.pendingHandUpgradeAll ?? 0) > 0) {
    upgradeHandCards(state);
    state.pendingHandUpgradeAll = 0;
  }
  // Deferred master effects retain their actual card-search predicates.
  // Resolve against the newly populated Hand, before the first card is used.
  const timedUpgrades = state.pendingTimedCardUpgradeEffects.splice(0);
  for (const effect of timedUpgrades) executeMasterEffect(state, effect, phaseEvent);
  if (Number(state.exam.idolStatusType) === EXAM_IDOL_STATUS_TYPE.FullPower) {
    const returned = state.hold.splice(0, Math.max(0, Math.min(2, normalizeHandLimit(state.handLimit) - state.hand.length)));
    state.hand.push(...returned);
    for (const card of returned) {
      phaseEvent.moved.push({ card: { ...card }, from: "hold", to: "hand" });
      notifyRuntimeCardMove(state, card, "hold", "hand", phaseEvent);
    }
  }
  // ExamLoopTaskAsync 0x8070394 marks statuses after draw/StartOfTurn
  // and before StartPlay. Additions during card play have not passed it.
  // Scheduler/playable count flags must retain their original pre-StartPlay
  // timing; only scalar status lifetime flags are marked after StartPlay.
  for (const registration of state.effectScheduler.registrations) registration.metadata.isPassingTurnStart = true;
  if (state.cardEffectPlayCountBuff) state.cardEffectPlayCountBuff.isPassingTurnStart = true;
  if (state.playableAddStatus) state.playableAddStatus.isPassingTurnStart = true;
  runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.AFTER_START_OF_TURN, phaseEvent);
  markNativeStatusTurnStart(state.exam);
  state.turnStartEffects = [...phaseEvent.effects];
  return {
    turn: state.turn,
    hand: state.hand.map((card) => ({ ...card })),
    drawn: result.drawn.map((card) => ({ ...card })),
    recycleEvents: result.recycleEvents,
    nativePhaseEffects: [...phaseEvent.effects],
  };
}

function upgradeHandCards(state) {
  for (const card of state.hand) applyTemporarySkillUpgradeInPlace(state, card);
}

export function currentTowerScoreContext(state) {
  const turnIndex = Math.max(0, Number(state?.turn ?? 0) - 1);
  const turnTypes = Array.isArray(state?.turnParameterTypes) ? state.turnParameterTypes : [];
  // Native GetCurrentParameterType clamps extra turns to the final normal
  // turn's attribute instead of indexing past the generated turn list.
  const typeIndex = turnTypes.length
    ? Math.min(turnIndex, turnTypes.length - 1)
    : -1;
  const parameterType = typeIndex >= 0 ? String(turnTypes[typeIndex] ?? "") : "";
  const bonus = parameterType
    ? state?.parameterBonus?.[parameterType.toLowerCase()]?.bonusPermil
    : null;
  const hasBattleBonus = bonus !== null
    && bonus !== undefined
    && Number.isFinite(Number(bonus));
  const battleBonusPermil = hasBattleBonus ? Number(bonus) : null;
  return {
    isBattle: hasBattleBonus,
    battleBonusPermil,
    parameterType,
    settings: state?.examScoreSettings ?? null,
  };
}

function resolvedMasterSearch(state, searchId) {
  return state.cardSearchById?.get?.(String(searchId ?? "")) ?? null;
}

function resolvedRuntimeMasterTrigger(state, triggerId) {
  const trigger = state.examTriggerById?.get?.(String(triggerId ?? ""));
  if (!trigger) return null;
  return {
    ...trigger,
    cardSearch: resolvedMasterSearch(state, trigger.produceCardSearchId),
    fieldStatusCardSearches: (trigger.fieldStatusProduceCardSearchIds ?? []).map(
      (id) => resolvedMasterSearch(state, id),
    ),
  };
}

function checkRuntimeCardTrigger(state, triggerId, card = null, event = null) {
  const id = String(triggerId ?? "");
  if (!id) return { supported: true, triggered: true, triggerId: id };
  const trigger = resolvedRuntimeMasterTrigger(state, id);
  if (!trigger) return checkCardEffectTrigger(id, state.exam);
  const context = {
    state,
    exam: state.exam,
    card,
    event,
    lessonType: currentNativeLessonType(state),
  };
  return {
    supported: true,
    triggered: triggerFieldStatusesMatch(state, trigger, context)
      && lessonTypeMatches(trigger.lessonType, context.lessonType)
      && triggerSearchMatches(state, trigger, context),
    triggerId: id,
  };
}

function masterPickCount(state, parsed, available) {
  // Native does not request a random pick count for an empty candidate pool.
  // The empty-眠気 search of p_card-00-sup-3_152 on native contest #6
  // leaves the RNG unchanged; the old 0..1 call advanced it by one.
  if (!(Number(available) > 0)) return 0;
  let min = Math.max(0, Math.trunc(Number(parsed.pickCountMin ?? 0)));
  let max = Math.max(min, Math.trunc(Number(parsed.pickCountMax ?? min)));
  const range = String(parsed.pickRangeType ?? "");
  if (range.endsWith("_All") && min === 0 && max === 0) {
    return available;
  }
  max = Math.min(max, Math.max(0, Number(available) || 0));
  min = Math.min(min, max);
  if (range.endsWith("_Select")) return max;

  // ELF PickCardPositionListImpl (RVA 0x80302A8) performs a count
  // GetRandomInt only for the Random branch. Its All branch returns without
  // that roll; a fixed 1_1 Random count still advances XorShift once.
  if (range.endsWith("_Random")) {
    return consumeNativeRandomInt(state, min, max + 1);
  }

  if (max === min) return min;
  return consumeNativeRandomInt(state, min, max + 1);
}

function randomPoolRowsForSearch(state, search) {
  if (search?.produceCardPoolId) return state.cardPoolById?.get(search.produceCardPoolId) ?? [];
  const poolId = String(search?.produceCardRandomPoolId ?? "");
  if (!poolId) return [];
  return state.cardRandomPoolById?.get?.(poolId) ?? [];
}

function consumeWeightedRandomPoolRow(state, rowsInput) {
  const rows = (rowsInput ?? []).filter((row) => (
    String(row?.produceCardId ?? "")
    && Math.max(0, Math.trunc(Number(row?.ratio ?? 0) || 0)) > 0
  ));
  const totalWeight = rows.reduce(
    (sum, row) => sum + Math.max(0, Math.trunc(Number(row.ratio ?? 0) || 0)),
    0,
  );
  if (!rows.length || totalWeight <= 0) return null;

  // ProduceCardRandomPool is a weighted pool. Native-style selection uses one
  // ranged Exam RNG draw per generated card, then resolves the cumulative ratio
  // bucket. A one-entry / weight-1 pool still consumes one RNG word.
  const roll = consumeNativeRandomInt(state, 0, totalWeight);
  let cursor = 0;
  for (const row of rows) {
    cursor += Math.max(0, Math.trunc(Number(row.ratio ?? 0) || 0));
    if (roll < cursor) return row;
  }
  return rows.at(-1) ?? null;
}

function masterSelectionIdentity(card, index = 0) {
  return String(card?.token ?? `${card?.id ?? ""}@@${card?.upgradeCount ?? 0}@@${index}`);
}

function selectedMasterCandidates(state, parsed, candidates) {
  const range = String(parsed.pickRangeType ?? "");
  if (!range.endsWith("_Select")) return null;
  let min = Math.max(0, Math.trunc(Number(parsed.pickCountMin ?? 0)));
  let max = Math.max(min, Math.trunc(Number(parsed.pickCountMax ?? min)));
  if (range.endsWith("_All") && min === 0 && max === 0) min = max = candidates.length;
  max = Math.min(max, candidates.length);
  min = Math.min(min, max);
  const selectionIndex = Math.max(0, Math.trunc(Number(state.aiCardSelectionCursor ?? 0)));
  const planned = state.aiCardSelectionPlan?.[selectionIndex];
  if (!Array.isArray(planned)) {
    if (state.requireCardSelections) {
      throw new TowerCardSelectionRequired({
        selectionIndex,
        effectId: String(parsed.id ?? parsed.masterEffectType ?? "card-selection"),
        candidates: candidates.map((card, index) => ({
          identity: masterSelectionIdentity(card, index),
          id: String(card?.id ?? ""),
          upgradeCount: Number(card?.upgradeCount ?? 0),
        })),
        min,
        max,
      });
    }
    return candidates.slice(0, max);
  }
  if (planned.length < min || planned.length > max) {
    throw new Error(`${parsed.id}: カード選択枚数が不正です。`);
  }
  const remaining = candidates.map((card, index) => ({
    card,
    identity: masterSelectionIdentity(card, index),
  }));
  const selected = [];
  for (const identity of planned) {
    const index = remaining.findIndex((entry) => entry.identity === String(identity));
    if (index < 0) throw new Error(`${parsed.id}: 選択対象カードが見つかりません: ${identity}`);
    selected.push(remaining.splice(index, 1)[0].card);
  }
  state.aiCardSelectionCursor = selectionIndex + 1;
  return selected;
}

function masterSearchCandidates(state, search, context) {
  let candidates = cardsForMasterSearch(state, search, context).filter((card) => cardMatchesMasterSearch(card, search));
  if (search?.isSelf) candidates = candidates.filter((card) => card.token === context.card?.token);
  if (search?.orderType === "ProduceCardOrderType_Random") candidates = candidates.map((card, order) => ({ card, order, key: consumeNativeRandomSortKey(state) })).sort((a,b) => a.key - b.key || a.order - b.order).map((row) => row.card);
  return Number(search?.limitCount) > 0 ? candidates.slice(0, Number(search.limitCount)) : candidates;
}

function pickedMasterCards(state, parsed, context = {}) {
  context = { card: state.effectOwnerCard ?? state.playingCard, ...context };
  const search = resolvedMasterSearch(state, parsed.searchId);
  if (search?.produceCardPoolId || search?.produceCardRandomPoolId) {
    const rows = randomPoolRowsForSearch(state, search);
    return Array.from({ length: masterPickCount(state, parsed, Number(search.limitCount) || rows.length) }, () => {
      const row = consumeWeightedRandomPoolRow(state, rows);
      return row ? generatedRuntimeCard(state, row.produceCardId, row.upgradeCount) : null;
    }).filter(Boolean);
  }
  const candidates = masterSearchCandidates(state, search, context);
  const selected = selectedMasterCandidates(state, parsed, candidates);
  if (selected) return selected;
  const count = masterPickCount(state, parsed, candidates.length);
  const range = String(parsed.pickRangeType ?? "");
  if (range.endsWith("_Random")) {
    return candidates
      .map((card, order) => ({ card, order, key: consumeNativeRandomSortKey(state) }))
      .sort((a, b) => a.key - b.key || a.order - b.order)
      .slice(0, count)
      .map((row) => row.card);
  }
  return candidates.slice(0, count);
}

function removeRuntimeCard(state, card) {
  for (const [name, pool] of [
    ["hand", state.hand], ["deck", state.deck], ["grave", state.discard],
    ["lost", state.lost], ["hold", state.hold],
  ]) {
    const index = pool.indexOf(card);
    if (index >= 0) {
      pool.splice(index, 1);
      return name;
    }
  }
  return "";
}

function notifyRuntimeCardMove(state, card, from, to, event, { drawn = false } = {}) {
  if (to === "hand") recordSimulationEvent(state, { kind: "handAdded", cards: [historyCard(card)], from, drawn });
  if (drawn && nativeResultTriggersAllowed(state)) runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.CARD_DRAW, event, { card });
  const phase = { hand: NATIVE_EFFECT_PHASE.CARD_MOVE_HAND,
    grave: NATIVE_EFFECT_PHASE.CARD_MOVE_GRAVE, lost: NATIVE_EFFECT_PHASE.CARD_MOVE_LOST }[to];
  if (phase && nativeResultTriggersAllowed(state)) runNativeEffectPhase(state, phase, event, { card, from, to });

  const triggerType = String(card.moveEffectTriggerType ?? "").replace(/^ProduceCardMoveEffectTriggerType_/, "");
  const matches = { Hand: to === "hand", Hold: to === "hold", Grave: to === "grave", Lost: to === "lost",
    }[triggerType];
  if (!matches || card.moveEffectUsedTurn === state.turn) return;
  const entries = (card.moveProduceExamEffectIds ?? []).map((id, index) => ({
    produceExamEffectId: id, produceExamTriggerId: card.moveProduceExamTriggerIds?.[index] ?? "",
  })).filter((entry) => {
    const result = checkRuntimeCardTrigger(state, entry.produceExamTriggerId, card, event);
    if (!result.supported) rememberUnsupported(state, `move-trigger:${entry.produceExamTriggerId}`);
    return result.supported && result.triggered;
  });
  if (!entries.length) return;
  // InsertMoveEffect marks the card when it queues the eligible effects,
  // before any of those effects execute (including a nested draw/move).
  card.moveEffectUsedTurn = state.turn;
  const previousOwner = state.effectOwnerCard;
  state.effectOwnerCard = card;
  try {
    withNativeEffectSource(state, "card", () => {
      for (const entry of entries) applyCardEffectEntry(state, { ...entry, produceExamTriggerId: "" }, event, card);
    });
  } finally { state.effectOwnerCard = previousOwner; }
}

function addRuntimeCardAt(state, card, movePositionType, event = nativeRuntimeEvent(), from = "", notifications = null) {
  const move = String(movePositionType ?? "").replace(/^ProduceCardMovePositionType_/, "");
  let to;
  switch (move) {
    case "Hand":
      if (state.hand.length < normalizeHandLimit(state.handLimit)) { state.hand.push(card); to = "hand"; }
      else { state.deck.unshift(card); to = "deck_first"; }
      break;
    case "DeckFirst": state.deck.unshift(card); to = "deck_first"; break;
    case "DeckLast": state.deck.push(card); to = "deck_last"; break;
    case "DeckRandom": {
      const index = consumeNativeRandomInt(state, 0, state.deck.length);
      state.deck.splice(index, 0, card); to = "deck_random"; break;
    }
    case "Grave": state.discard.push(card); to = "grave"; break;
    case "Lost": state.lost.push(card); to = "lost"; break;
    case "Hold": {
      const limit = normalizeHandLimit(state.holdLimit);
      if (!limit) { state.discard.push(card); to = "grave"; break; }
      while (state.hold.length >= limit) {
        const evicted = state.hold.shift();
        state.discard.push(evicted);
        event.moved ??= [];
        event.moved.push({ card: { ...evicted }, from: "hold", to: "grave" });
        if (notifications) notifications.push({ card: evicted, from: "hold", to: "grave" });
        else notifyRuntimeCardMove(state, evicted, "hold", "grave", event);
      }
      state.hold.push(card); to = "hold"; break;
    }
    default: state.discard.push(card); to = "grave";
  }
  if (notifications) notifications.push({ card, from, to });
  else notifyRuntimeCardMove(state, card, from, to, event);
  return to;
}

function resolveRuntimeMasterEnchant(state, enchantIdInput) {
  const enchantId = String(enchantIdInput ?? "");
  const enchant = state.examStatusEnchantById?.get?.(enchantId);
  if (!enchant) return null;
  const trigger = state.examTriggerById?.get?.(String(enchant.produceExamTriggerId ?? ""));
  if (!trigger) return null;
  const cardSearch = resolvedMasterSearch(state, trigger.produceCardSearchId);
  const fieldStatusCardSearches = (trigger.fieldStatusProduceCardSearchIds ?? []).map(
    (id) => resolvedMasterSearch(state, id),
  );
  const effects = (enchant.produceExamEffectIds ?? []).map(
    (id) => state.examEffectById?.get?.(String(id)),
  ).filter(Boolean);
  return {
    ...enchant,
    trigger: { ...trigger, cardSearch, fieldStatusCardSearches },
    examEffects: effects,
  };
}

function registerMasterStatusEnchant(state, parsed) {
  const enchant = resolveRuntimeMasterEnchant(state, parsed.enchantId);
  if (!enchant) {
    rememberUnsupported(state, `enchant:${parsed.enchantId}`);
    return null;
  }
  const specs = [];
  const statusEnchantKey = "statusEnchant:" + (++state.statusEnchantSerial);
  const rawCount = Number(parsed.limitCount ?? parsed.count);
  state.statusEnchantRemainingCounts.set(statusEnchantKey, rawCount > 0 ? rawCount : null);
  const originCardToken = nativeResultTriggersAllowed(state)
    ? state.effectOwnerCard?.token ?? state.playingCard?.token ?? ""
    : "";
  for (const phaseType of enchant.trigger.phaseTypes ?? []) {
    const issue = masterTriggerSupportIssue(enchant.trigger, phaseType);
    if (issue) {
      rememberUnsupported(state, `enchant-trigger:${enchant.trigger.id}:${issue}`);
      continue;
    }
    const mapped = MASTER_EXAM_PHASE_TO_NATIVE[String(phaseType)];
    const phases = mapped === "statusChange"
      ? [NATIVE_EFFECT_PHASE.STATUS_INCREASED, NATIVE_EFFECT_PHASE.STATUS_DECREASED]
      : [mapped];
    for (const phase of phases) {
      specs.push({
        id: parsed.id,
        phase,
        installedTurn: state.turn,
        turn: Number(parsed.turn) > 0 ? Number(parsed.turn) : null,
        condition: {
          kind: "masterExamTrigger",
          phaseType: String(phaseType),
          trigger: enchant.trigger,
          activationKey: statusEnchantKey,
        },
        effects: enchant.examEffects,
        metadata: { enchantId: enchant.id, triggerId: enchant.trigger.id, statusEnchantKey, originCardToken,
          originCard: historyCard(state.effectOwnerCard ?? state.playingCard), activationKey: statusEnchantKey },
      });
    }
  }
  return specs.length
    ? registerNativeEnchantEffects(state.effectScheduler, enchant.id, specs)
    : null;
}

function executeMasterChain(state, parsed, event, repeat = 1) {
  const ids = [parsed.chainEffectId, ...(parsed.chainEffectIds ?? [])].filter(Boolean);
  for (let n = 0; n < Math.max(0, Math.trunc(Number(repeat) || 0)); n += 1) {
    for (const id of ids) {
      const master = state.examEffectById?.get?.(String(id));
      executeParsedTowerEffect(
        state,
        master ? parseExamEffectMaster(master) : parseExamEffectId(id),
        event,
      );
    }
  }
}

// FloatFromPermil + single-precision count multiplication + positive infinity
// rounding; Exam*PerSearchCount variants share these native instructions.
function nativeSearchCountBonus(permil, count) {
  return Math.max(0, Math.ceil(Math.fround(
    Math.fround(Math.fround(permil) / Math.fround(1000)) * Math.fround(count),
  )));
}
// Native LessonDepend*AndSearchCount forms (Value1/1000 + Value2/1000 * n)
// before multiplying the status value, then epsilon-ceils.
function nativeSearchStatusLessonBase(value1, value2, searchCount, statusValue) {
  const permil = Math.fround(
    Math.fround(Math.fround(value1) / Math.fround(1000))
    + Math.fround(Math.fround(Math.fround(value2) / Math.fround(1000)) * Math.fround(searchCount)),
  );
  return Math.max(0, nativeCeilWithEpsilon(
    Math.fround(permil * Math.fround(statusValue)),
  ));
}

function scaledMasterValue(source, parsed, preferValue2 = false) {
  const permil = Number(preferValue2 && parsed.value2 ? parsed.value2 : parsed.value1) || 0;
  const result = calculateNativeDependentLessonBase(Math.max(0, Number(source) || 0), permil);
  const cap = preferValue2 ? Math.max(0, Number(parsed.value1) || 0) : 0;
  return cap > 0 ? Math.min(cap, result) : result;
}

function addScaledStatus(exam, field, value, additivePermilField = "", fixedField = "") {
  const additive = Math.max(0, Number(exam[additivePermilField] ?? 0));
  const resolvedFix = fixedField || ({ review: "reviewAdditiveFix", parameterBuff: "parameterBuffAdditiveFix", fullPowerPoint: "fullPowerPointAdditiveFix" }[field] ?? "");
  const fixed = Math.max(0, Number(exam[resolvedFix] ?? 0));
  const added = Math.max(0, Math.ceil((Number(value) || 0) * (1000 + additive) / 1000) + fixed);
  exam[field] = Math.max(0, Number(exam[field] ?? 0) + added);
  return added;
}

function applyMasterLesson(state, parsed, source, event, label) {
  const base = Math.max(0, Math.trunc(Number(source) || 0));
  const result = applyParsedExamEffect(
    state.exam,
    { kind: "lesson", id: parsed.id, value: base, count: Math.max(1, Number(parsed.count) || 1) },
    currentTowerScoreContext(state),
  );
  event.effects.push(`${label}: ${result.label}`);
}

function addPlayableStatus(state, value) {
  const count = Math.max(0, Math.trunc(value));
  if (!count) return;

  // Native AddPlayableValueAdd (0x7ff195c) first adds the status count. When
  // the ordinary play has already ended the turn (our playsRemaining === 0),
  // it reopens card play and immediately consumes one added count via
  // UsePlayableValueAddCount. The reopened play itself is represented by
  // playsRemaining, so only the still-unallocated extra count stays here.
  const wasCardPlayEnded = Number(state.playsRemaining ?? 0) <= 0;
  state.playableAddStatus ??= { count: 0, isPassingTurnStart: false };
  state.playableAddStatus.count += count;
  state.playsRemaining += count;
  if (wasCardPlayEnded) {
    state.playableAddStatus.count -= 1;
    if (state.playableAddStatus.count <= 0) state.playableAddStatus = null;
  }
}

function applyStanceRuntimeRewards(state, stance, event) {
  // Native TryInternalSetStance runs AddBlockFix and TryAddEnthusiasticStatus
  // when leaving Preservation/OverPreservation; they are separate from any
  // block/effect on the destination Concentration card or P-item.
  if (Number(stance?.releasedBlockAdd ?? 0) > 0) {
    event.effects.push(`温存解除・固定元気 +${stance.releasedBlockAdd}`);
  }
  if (Number(stance?.releasedEnthusiasticAdd ?? 0) > 0) {
    event.effects.push(`温存解除・熱意 +${stance.releasedEnthusiasticAdd}`);
  }
  const playable = Math.max(0, Math.trunc(Number(stance?.playableValueAdd) || 0));
  if (playable > 0) {
    addPlayableStatus(state, playable);
    event.effects.push(`スキルカード使用数追加 +${playable}`);
  }
  const lessonAdd = Math.max(0, Math.trunc(Number(stance?.growLessonAdd) || 0));
  if (lessonAdd <= 0) return;

  const seen = new Set();
  let matched = 0;
  for (const pool of [state.deck, state.hand, state.discard, state.hold, state.lost]) {
    for (const card of pool ?? []) {
      const identity = String(card?.token ?? `${card?.id ?? ""}@@${card?.originalIndex ?? ""}`);
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (!Array.isArray(card.customGrowEffects)) card.customGrowEffects = [];
      card.customGrowEffects.push({
        id: `stance-over-preservation-lesson-add-${lessonAdd}`,
        effectType: "ProduceCardGrowEffectType_LessonAdd",
        value: lessonAdd,
      });
      matched += 1;
    }
  }
  event.effects.push(`全カード ${matched}枚のパラメータ上昇量 +${lessonAdd}`);
}

function resolveFullPowerAtTurnStart(state, event) {
  const exam = state.exam;
  // ExamLoopTaskAsync @ 0x80b82b4 removes the prior turn's FullPower,
  // then @ 0x80b8310 consumes ten points for the upcoming turn.
  if (Number(exam.idolStatusType ?? 0) === EXAM_IDOL_STATUS_TYPE.FullPower) {
    const beforeUnset = captureNativeStatusSnapshot(exam);
    exam.idolStatusType = EXAM_IDOL_STATUS_TYPE.Unknown;
    exam.idolStatusStep = 0;
    event.effects.push("全力を解除");
    emitNativeStatusDiff(state, beforeUnset, event, { cause: "fullPowerUnset" });
  }
  if (Number(exam.fullPowerPoint ?? 0) < 10) return;
  const beforeConsume = captureNativeStatusSnapshot(exam);
  const stance = trySetExamStance(exam, EXAM_IDOL_STATUS_TYPE.FullPower, 1, {
    consumeFullPowerPoint: true,
  });
  applyStanceRuntimeRewards(state, stance, event);
  if (stance.changed) {
    event.effects.push("全力値10を消費して全力に変更");
    emitNativeStatusDiff(state, beforeConsume, event, { cause: "fullPowerPointConsume" });
  }
}

// All 161 IL2CPP concrete executor types have independent class definitions.
// 80 master effect handlers retain the exact pre-refactor implementation.
// Unimplemented classes explicitly preserve the prior unsupported effect outcome.
class AddGrowEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class AggressiveAdditiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP AggressiveAdditiveEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("aggressiveAdditivePermil", v1, "やる気効果増加"); return;
  }
}

class AggressiveAdditiveFixEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP AggressiveAdditiveFixEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("aggressiveAdditiveFix", v1, "やる気固定増加"); return;
  }
}

class AggressiveDependReviewEffectExecutor {
  static ExecuteEffect({ exam, v1, status }) {
    // GetReview -> FloatFromPermil(Value1) -> epsilon ceil -> TryAddAggressiveStatus.
    status("aggressive", calculateNativeDependentLessonBase(exam.review, v1), "やる気");
  }
}

class AggressiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class AggressivePerSearchCountEffectExecutor {
  static ExecuteEffect({ exam, v1, v2, searchCount, status }) {
    // GetSearchCardList.Count -> ceil(Value2/1000 * count) + Value1.
    status("aggressive", v1 + nativeSearchCountBonus(v2, searchCount()), "やる気");
  }
}

class AggressiveReduceCancellableEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class AggressiveReduceEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP AggressiveReduceEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    reduce("aggressive", v1, "やる気"); return;
  }
}

class AggressiveValueMultipleEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP AggressiveValueMultipleEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          const field = type === "ExamBlockValueMultiple" ? "block" : type === "ExamReviewValueMultiple" ? "review" : "aggressive";
          const before = Number(exam[field] ?? 0);
          const extra = field === "block"
            ? Math.ceil(Math.fround(Math.fround(Math.fround(1 + Math.fround(v1 / 1000)) * Math.fround(before)) - Math.fround(before)))
            : Math.ceil(Math.fround(Math.fround(v1 / 1000) * Math.fround(before)));
          exam[field] = before + Math.max(0, extra);
          event.effects.push(field + " +" + Math.max(0, extra)); return;
        }
  }
}

class AntiDebuffEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP AntiDebuffEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    exam.antiDebuffCount += Math.max(1, Number(parsed.count) || 1); event.effects.push("低下状態無効"); return;
  }
}

class BlockAddDownEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP BlockAddDownEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    if (exam.blockAddDownRestriction) {
      event.effects.push("元気増加量減少を無効化");
      return;
    }
    timedAdd("blockAddDown", 1, "元気増加量減少", "flag"); return;
  }
}

class BlockAddDownRestrictionEffectExecutor {
  static ExecuteEffect({ exam, v1, event }) {
    // ELF 0x8047E84: TryAddBlockAddDownRestrictionStatus(Value1).
    // The native status guards TryAddBlockAddDownStatus, not BlockAdd itself.
    const turns = Math.trunc(v1);
    if (!addNativeGenericTimedStatus(exam, 'blockAddDownRestriction', 1, turns, 'duration')) return;
    event.effects.push(`元気増加量減少無効（${turns}T）`);
  }
}

class BlockAddMultipleAggressiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP BlockAddMultipleAggressiveEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          // Native ExamBlockAddMultipleAggressive: Value2 adds to 100%.
          const added = calculateNativeBlockAdd(exam, v1, 1 + v2 / 1000);
          exam.block += added; event.effects.push(`元気 +${added}`); return;
        }
  }
}

class BlockDependBlockConsumptionSumEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP BlockDependBlockConsumptionSumEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    status("block", scaledMasterValue(exam.blockConsumptionSum, parsed), "元気"); return;
  }
}

class BlockDependReviewEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP BlockDependReviewEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    status("block", scaledMasterValue(exam.review, parsed), "元気"); return;
  }
}

class BlockDownEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP BlockDownEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    exam.block = Math.max(0, Math.floor(exam.block * Math.max(0, 1000 - v1) / 1000)); event.effects.push("元気減少"); return;
  }
}

class BlockEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class BlockFixEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP BlockFixEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    status("block", v1, "元気"); return;
  }
}

class BlockPerSearchCountEffectExecutor {
  static ExecuteEffect({ exam, v1, v2, searchCount, event }) {
    // Native CalculateAddBlock -> AddBlockFix, not a raw block increase.
    const amount = calculateNativeBlockAdd(exam, v1 + nativeSearchCountBonus(v2, searchCount()));
    exam.block += amount;
    event.effects.push(`元気 +${amount}`);
  }
}

class BlockPerUserCardCountEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP BlockPerUserCardCountEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    status("block", v1 * Math.min(Number(exam.cardPlayCount ?? 0), v2 || Infinity), "元気"); return;
  }
}

class BlockRestrictionEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP BlockRestrictionEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("blockRestriction", 1, "元気増加不可", "flag"); return;
  }
}

class BlockValueMultiplicationEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP BlockValueMultiplicationEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          const field = type === "ExamBlockValueMultiple" ? "block" : type === "ExamReviewValueMultiple" ? "review" : "aggressive";
          const before = Number(exam[field] ?? 0);
          const extra = field === "block"
            ? Math.ceil(Math.fround(Math.fround(Math.fround(1 + Math.fround(v1 / 1000)) * Math.fround(before)) - Math.fround(before)))
            : Math.ceil(Math.fround(Math.fround(v1 / 1000) * Math.fround(before)));
          exam[field] = before + Math.max(0, extra);
          event.effects.push(field + " +" + Math.max(0, extra)); return;
        }
  }
}

class BuffConsumptionAddEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP BuffConsumptionAddEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("buffConsumptionAdd", 1, "強化状態消費増加", "duration"); return;
  }
}

class BuffConsumptionDownEffectExecutor {
  static ExecuteEffect({ exam, v1, event }) {
    // ELF 0x804a050: TryAdd*Status(Value1=duration).
    if (addNativeGenericTimedStatus(exam, "buffConsumptionDown", 1, v1, "duration")) {
      event.effects.push(`強化消費減少（${v1}T）`);
    }
  }
}

class CardCreateIdEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class CardCreateSearchEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP CardCreateSearchEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          const search = resolvedMasterSearch(state, parsed.searchId);
          if (!search) {
            rememberUnsupported(state, `card-create-search:${parsed.searchId}`);
            event.effects.push(`カード検索マスタを取得できません: ${parsed.searchId}`);
            return;
          }
    
          const randomPoolId = String(search.produceCardPoolId || search.produceCardRandomPoolId || "");
          if (randomPoolId) {
            const poolRows = randomPoolRowsForSearch(state, search);
            if (!poolRows.length) {
              rememberUnsupported(state, `card-random-pool:${randomPoolId}`);
              event.effects.push(`ランダムカードプールを取得できません: ${randomPoolId}`);
              return;
            }
    
            // RandomPool draws are with replacement, so pick-count is not capped by
            // the number of distinct pool rows. The count roll happens first, then
            // each generated card consumes one weighted ranged RNG draw.
            const requestedMax = Math.max(
              0,
              Math.trunc(Number(parsed.pickCountMin ?? 0) || 0),
              Math.trunc(Number(parsed.pickCountMax ?? 0) || 0),
            );
            const amount = masterPickCount(state, parsed, Math.max(poolRows.length, requestedMax));
            for (let i = 0; i < amount; i += 1) {
              const row = consumeWeightedRandomPoolRow(state, poolRows);
              if (!row) {
                rememberUnsupported(state, `card-random-pool-empty:${randomPoolId}`);
                break;
              }
              const card = generatedRuntimeCard(
                state,
                String(row.produceCardId ?? ""),
                Number(row.upgradeCount ?? 0),
              );
              if (!card) {
                rememberUnsupported(
                  state,
                  `card-create-master:${String(row.produceCardId ?? "")}@@${Number(row.upgradeCount ?? 0)}`,
                );
                continue;
              }
              const to = addRuntimeCardAt(state, card, parsed.movePositionType, event);
              event.created.push({
                card: { ...card },
                to,
                randomPoolId,
                ratio: Number(row.ratio ?? 0),
              });
            }
            event.effects.push("ランダムプールからカード生成");
            return;
          }
    
          if (String(search.produceCardPoolId ?? "")) {
            rememberUnsupported(state, `card-pool:${String(search.produceCardPoolId)}`);
            event.effects.push(`カードプール未対応: ${String(search.produceCardPoolId)}`);
            return;
          }
    
          const candidates = [...(state.cardById?.values?.() ?? [])]
            .filter((card) => cardMatchesMasterSearch(card, search));
          const selected = selectedMasterCandidates(state, parsed, candidates);
          if (selected) {
            for (const master of selected) {
              const card = generatedRuntimeCard(state, master.id, Number(master.upgradeCount ?? 0));
              if (card) {
                const to = addRuntimeCardAt(state, card, parsed.movePositionType, event);
                event.created.push({ card: { ...card }, to });
              }
            }
            event.effects.push("検索条件からカード生成");
            return;
          }
    
          const amount = masterPickCount(state, parsed, candidates.length);
          const range = String(parsed.pickRangeType ?? "");
          const picked = range.endsWith("_Random")
            ? candidates
              .map((master, order) => ({ master, order, key: consumeNativeRandomSortKey(state) }))
              .sort((a, b) => a.key - b.key || a.order - b.order)
              .slice(0, amount)
              .map((row) => row.master)
            : candidates.slice(0, amount);
    
          for (const master of picked) {
            const card = generatedRuntimeCard(state, master.id, Number(master.upgradeCount ?? 0));
            if (!card) continue;
            const to = addRuntimeCardAt(state, card, parsed.movePositionType, event);
            event.created.push({ card: { ...card }, to });
          }
          event.effects.push("検索条件からカード生成");
          return;
        }
  }
}

class CardDuplicateEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP CardDuplicateEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          for (const source of pickedMasterCards(state, parsed)) {
            const clone = { ...source, token: `generated:${++state.generatedCardSerial}:${source.id}`, generated: true };
            addRuntimeCardAt(state, clone, parsed.movePositionType, event); event.created.push({ card: { ...clone } });
          }
          event.effects.push("対象カードを複製"); return;
        }
  }
}

class CardMoveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP CardMoveEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          const destination = String(parsed.movePositionType ?? "").replace(/^ProduceCardMovePositionType_/, "");
          // GetEffectWarning @ 0x803166c..0x803173c returns warning 9 for
          // Hand moves when current Hand count equals HandLimit. The command's
          // IsUsableWarningType gate rejects it before calling MoveCard.
          if (destination === "Hand" && state.hand.length === normalizeHandLimit(state.handLimit)) return;
          const selectedCards = pickedMasterCards(state, parsed);
          // MoveCard groups positions before moving them. Stable groups preserve
          // their first appearance; Playing is processed before other sources.
          const groups = new Map();
          for (const card of selectedCards) {
            const source = state.deck.includes(card) ? "deck" : state.discard.includes(card) ? "grave" : state.hand.includes(card) ? "hand" : state.lost.includes(card) ? "lost" : state.hold.includes(card) ? "hold" : "playing";
            if (!groups.has(source)) groups.set(source, []);
            groups.get(source).push(card);
          }
          const cards = [...(groups.get("playing") ?? []), ...[...groups].filter(([source]) => source !== "playing").flatMap(([, cards]) => cards)];
          // ELF MoveCard RVA 0x8277C3C..0x8277CB4: excess Hand moves
          // are redirected to DeckFirst (move position 2), not left in the source.
          const moves = cards.map((card) => ({ card, from: removeRuntimeCard(state, card) || "playing" }));
          const notifications = [];
          if (destination === "Hold") {
            // MoveCard @ 0x8231510: evict the oldest existing held cards first.
            // If the incoming batch itself exceeds HoldLimit, its prefix goes
            // straight to Grave; only the suffix actually enters Hold.
            const limit = normalizeHandLimit(state.holdLimit);
            const evicted = state.hold.splice(0, Math.max(0, state.hold.length + moves.length - limit));
            state.discard.push(...evicted);
            for (const card of evicted) {
              event.moved.push({ card: { ...card }, from: "hold", to: "grave" });
              notifications.push({ card, from: "hold", to: "grave" });
            }
            const excess = Math.max(0, moves.length - limit);
            for (const [index, move] of moves.entries()) {
              move.to = index < excess ? "grave" : "hold";
              (move.to === "grave" ? state.discard : state.hold).push(move.card);
              notifications.push(move);
            }
          } else if (destination === "Hand") {
            const capacity = Math.max(0, normalizeHandLimit(state.handLimit) - state.hand.length);
            const accepted = moves.slice(0, capacity), overflow = moves.slice(capacity);
            state.hand.push(...accepted.map(({ card }) => card));
            state.deck.unshift(...overflow.map(({ card }) => card));
            for (const move of accepted) { move.to = "hand"; notifications.push(move); }
            for (const move of overflow) { move.to = "deck_first"; notifications.push(move); }
          } else if (destination === "DeckFirst") {
            // Native ExamCardMoveController.MoveCard inserts a selected batch at
            // deck top in selection order. Repeated unshift() reversed the batch:
            // observed in native contest sessions 1 and 3 at the first draw mismatch.
            state.deck.unshift(...moves.map(({ card }) => card));
            for (const move of moves) {
              move.to = "deck_first";
              notifications.push(move);
            }
          } else {
            for (const move of moves) move.to = addRuntimeCardAt(state, move.card, parsed.movePositionType, event, move.from, notifications);
          }
          for (const move of moves) event.moved.push({ card: { ...move.card }, from: move.from, to: move.to });
          for (const move of notifications) notifyRuntimeCardMove(state, move.card, move.from, move.to, event);
          event.effects.push("対象カードを移動"); return;
        }
  }
}

class CardShuffleDeckGraveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class CardShuffleDeckLostEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ChainEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ChainEffectPerPassedTurnEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ChainEffectPerRemainTurnEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ClearDebuffEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ConcentrationEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ConcentrationLessonMultipleAdditiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ConcentrationLessonMultipleAdditiveEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("concentrationLessonMultipleAdditive", v1, "強気時スコア倍率増加", "multiple"); return;
  }
}

class DebuffRecoverEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP DebuffRecoverEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    recoverNativeDebuffs(state, v1); event.effects.push("低下状態を解除"); return;
  }
}

class DrawEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class EffectPerSearchCountEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP EffectPerSearchCountEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          // Native @ 0x8006CA4: ceil(value2 / 1000 * matchingCardCount).
          // A zero result skips the child effect entirely.
          const repeats = Math.ceil(Math.fround(Math.fround(v2 / 1000) * Math.fround(searchCount())));
          executeMasterChain(state, parsed, event, repeats);
          return;
        }
  }
}

class EffectTimerEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP EffectTimerEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          // Native EffectTimerEffectExecutor..ctor (v3.4.1 RVA 0x0804D768)
          // reads IExamEffect.get_EffectValue1 (virtual slot 2) as the delay.
          // EffectTurn is unrelated to the wait and is often zero in the masters.
          const delay = Math.max(1, Math.trunc(Number(parsed.value1) || 1));
          const childId = parsed.chainEffectId || parsed.chainEffectIds?.[0];
          const master = state.examEffectById?.get?.(String(childId ?? ""));
          state.timers.push({
            turn: delay, count: Math.max(1, Number(parsed.count) || 1),
            child: master ? parseExamEffectMaster(master) : parseExamEffectId(childId), id: parsed.id,
          });
          event.effects.push(`${delay}ターン後に効果発動`);
          return;
        }
  }
}

class EffectTimerEndTurnEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class EnthusiasticAdditiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP EnthusiasticAdditiveEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("enthusiasticAdditivePermil", v1, "熱意効果増加"); return;
  }
}

class EnthusiasticMultipleEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP EnthusiasticMultipleEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("enthusiasticMultiple", v1, "熱意倍率変更", "multiple"); return;
  }
}

class EnthusiasticTurnAdditiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP EnthusiasticTurnAdditiveEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("enthusiasticTurnAdditive", v1, "熱意持続ターン増加"); return;
  }
}

class ExamLessonAddMultipleLessonBuffEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ExamLessonAddMultipleLessonBuffEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    applyMasterLesson(state, parsed, scaledMasterValue(exam.lessonBuff, parsed), event, "集中参照"); return;
  }
}

class LessonPerSearchCountEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonPerSearchCountEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          // Native executor @ 0x8008B88 rounds the search contribution before
          // adding value1, then calculates the lesson independently for each hit.
          const extra = Math.ceil(Math.fround(Math.fround(v2 / 1000) * Math.fround(searchCount())));
          applyMasterLesson(state, parsed, v1 + extra, event, "カード枚数参照");
          return;
        }
  }
}

class ExamPlayCardLimitPlayableValueAddEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ExtraTurnEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ForcePlayCardSearchWithCostEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ForcePlayCardSearchWithCostEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    for (const card of pickedMasterCards(state, parsed)) {
            if (!state.hand.includes(card)) { removeRuntimeCard(state, card); state.hand.push(card); }
            playTowerCard(state, state.hand.indexOf(card), { forced: true, ignoreCost: type === "ExamForcePlayCardSearch" });
          }
          event.effects.push("対象カードを強制使用"); return;
  }
}

class ForcePlaySearchEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ForcePlaySearchEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    for (const card of pickedMasterCards(state, parsed)) {
            if (!state.hand.includes(card)) { removeRuntimeCard(state, card); state.hand.push(card); }
            playTowerCard(state, state.hand.indexOf(card), { forced: true, ignoreCost: type === "ExamForcePlayCardSearch" });
          }
          event.effects.push("対象カードを強制使用"); return;
  }
}

class FullPowerEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP FullPowerEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          const stance = trySetExamStance(exam, EXAM_IDOL_STATUS_TYPE.FullPower, 1);
          applyStanceRuntimeRewards(state, stance, event);
          event.effects.push(stance.changed ? "全力に変更" : "指針変更なし");
          return;
        }
  }
}

class FullPowerLessonMultipleAdditiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP FullPowerLessonMultipleAdditiveEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("fullPowerLessonMultipleAdditive", v1, "全力時スコア倍率増加", "multiple"); return;
  }
}

class FullPowerPointAdditiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP FullPowerPointAdditiveEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("fullPowerPointAdditivePermil", v1, "全力値効果増加"); return;
  }
}

class FullPowerPointAdditiveFixEffectExecutor {
  static ExecuteEffect({ exam, v1, v2, event }) {
    // ELF 0x8051df0: GetFullPowerPointAdditiveFix -> TryAddFullPowerPointAdditiveFixStatus(Value1, Value2).
    if (addNativeGenericTimedStatus(exam, "fullPowerPointAdditiveFix", v1, v2, "add")) {
      event.effects.push(`全力値固定加算 +${v1}（${v2}T）`);
    }
  }
}

class FullPowerPointDependFullPowerPointGetSumEffectExecutor {
  static ExecuteEffect({ exam, v1, event }) {
    // get_FullPowerPointGetSumCount -> FloatFromPermil(Value1) -> ceil.
    const value = calculateNativeDependentLessonBase(exam.fullPowerPointGetSum, v1);
    if (value < 1) return;
    const added = addScaledStatus(exam, "fullPowerPoint", value, "fullPowerPointAdditivePermil");
    exam.fullPowerPointGetSum += added;
    event.effects.push(`全力値 +${added}`);
  }
}

class FullPowerPointEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP FullPowerPointEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          const added = addScaledStatus(exam, "fullPowerPoint", v1, "fullPowerPointAdditivePermil");
          exam.fullPowerPointGetSum += added; event.effects.push(`全力値 +${added}`); return;
        }
  }
}

class FullPowerPointPerSearchCountEffectExecutor {
  static ExecuteEffect({ exam, v1, v2, searchCount, event }) {
    const value = v1 + nativeSearchCountBonus(v2, searchCount());
    const added = addScaledStatus(exam, "fullPowerPoint", value, "fullPowerPointAdditivePermil");
    exam.fullPowerPointGetSum += added;
    event.effects.push(`全力値 +${added}`);
  }
}

class FullPowerPointReduceCancellableEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class FullPowerPointReduceEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP FullPowerPointReduceEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    reduce("fullPowerPoint", v1, "全力値"); return;
  }
}

class GetCardUpgradeEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class GimmickEnthusiasticEffectExecutor {
  static ExecuteEffect({ exam, v1, v2, event }) {
    // ELF 0x80534c8: TryAddEnthusiasticStatus(Value1, Value2).
    // The scalar-timed model stacks values and expires on native turn ticks.
    if (addNativeScalarTimedStatus(exam, "enthusiastic", v1, v2)) {
      event.effects.push(`熱意 +${v1}（${v2}T）`);
    }
  }
}

class GimmickLessonDebuffEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP GimmickLessonDebuffEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("lessonDebuff", v1, "集中低下"); return;
  }
}

class GimmickParameterDebuffEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP GimmickParameterDebuffEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("parameterDebuff", 1, "不調", "duration"); return;
  }
}

class GimmickPlayCardLimitEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP GimmickPlayCardLimitEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          const prior = state.searchPlayCardLimits.find((row) => row.searchId === parsed.searchId);
          if (prior) prior.turn = prior.turn < 0 || turn < 0 ? -1 : prior.turn + turn;
          else state.searchPlayCardLimits.push({ searchId: parsed.searchId, turn, uid: nextNativeStatusUid(exam) });
          event.effects.push("対象カード使用不可"); return;
        }
  }
}

class GimmickSleepyEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP GimmickSleepyEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    addNativeGenericTimedStatus(exam, "blockAddDownFix", v1, -1, "replace");
          event.effects.push("元気増加量 -" + v1); return;
  }
}

class GimmickSlumpEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP GimmickSlumpEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("slump", 1, "スランプ", "duration"); return;
  }
}

class GimmickStartTurnCardDrawDownEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP GimmickStartTurnCardDrawDownEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("startTurnCardDrawDown", Math.max(1, v1), `ターン開始ドロー -${Math.max(1, v1)}`); return;
  }
}

class GrowEffectLessonAddAdditiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class HandGraveCountCardDrawEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class HandHoldEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ItemFireLimitAddEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ItemFireLimitAddEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    for (const [key, count] of state.pItemEffectRemainingCounts) if (count != null && count > 0) state.pItemEffectRemainingCounts.set(key, count + Math.max(0, Math.trunc(v1)));
          event.effects.push("Pアイテム発動回数増加"); return;
  }
}

class LessonAddBlockEffectExecutor {
  static ExecuteEffect({ state, exam, v1, event }) {
    // ELF: CalculateAddingParameter -> AddParameter -> conditional
    // CalculateAddBlock (calculated >= 1) -> AddBlockFix.
    const result = addNativeLessonParameter(exam, v1, currentTowerScoreContext(state));
    let block = 0;
    if (result.calculated >= 1) {
      block = calculateNativeBlockAdd(exam, result.calculated);
      exam.block += block;
    }
    event.effects.push(`パラメータ +${result.added}・元気 +${block}`);
  }
}

class LessonAddMultipleParameterBuffEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class LessonBuffAdditiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonBuffAdditiveEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("lessonBuffAdditivePermil", v1, "集中効果増加"); return;
  }
}

class LessonBuffAdditiveFixEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonBuffAdditiveFixEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("lessonBuffAdditiveFix", v1, "集中固定増加"); return;
  }
}

class LessonBuffDependParameterBuffEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonBuffDependParameterBuffEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    status("lessonBuff", scaledMasterValue(exam.parameterBuff, parsed), "集中", "lessonBuffAdditivePermil", "lessonBuffAdditiveFix"); return;
  }
}

class LessonBuffEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class LessonBuffMultipleEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class LessonBuffPerSearchCountEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonBuffPerSearchCountEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    status("lessonBuff", scaledMasterValue(searchCount(), { ...parsed, value1: v2 || v1 }), "集中", "lessonBuffAdditivePermil", "lessonBuffAdditiveFix"); return;
  }
}

class LessonBuffReduceCancellableEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class LessonBuffReduceEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonBuffReduceEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    reduce("lessonBuff", v1, "集中"); return;
  }
}

class LessonChangeSpecifyLessThanEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class LessonChangeSpecifyMoreThanEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class LessonDependAggressiveAndSearchCountEffectExecutor {
  static ExecuteEffect({ state, parsed, exam, v1, v2, searchCount, event }) {
    // Native GetAggressive -> CalculateAddingParameter -> AddParameter x Count.
    const base = nativeSearchStatusLessonBase(v1, v2, searchCount(), exam.aggressive);
    const result = applyNativeLessonHits(exam, base, parsed.count, currentTowerScoreContext(state));
    event.effects.push(`やる気・検索枚数参照: パラメータ +${result.added}`);
  }
}

class LessonDependBlockAndSearchCountEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonDependBlockAndSearchCountEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          // LessonDependBlockAndSearchCountEffectExecutor @ 0x8011ABC:
          // ceil((value1 + value2 * matchingCardCount) / 1000 * block).
          // The native code keeps this as float32 until the final epsilon ceil;
          // in particular, zero matching cards must not be coerced to one.
          const permil = Math.fround(
            Math.fround(v1 / 1000)
            + Math.fround(Math.fround(v2 / 1000) * Math.fround(searchCount())),
          );
          const base = calculateNativeDependentLessonBase(exam.block, Math.fround(permil * 1000));
          applyMasterLesson(state, parsed, base, event, "元気・カード枚数参照");
          return;
        }
  }
}

class LessonDependBlockConsumptionSumEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonDependBlockConsumptionSumEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    applyMasterLesson(state, parsed, scaledMasterValue(exam.blockConsumptionSum, parsed), event, "元気消費量参照"); return;
  }
}

class LessonDependBlockEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonDependBlockEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    applyMasterLesson(state, parsed, scaledMasterValue(exam.block, parsed, v2 > 0), event, "元気参照"); return;
  }
}

class LessonDependEnthusiasticGetSumEffectExecutor {
  static ExecuteEffect({ state, exam, parsed, v1, v2, event }) {
    // ELF @ 0x8058d88: ExamParameterModel.EnthusiasticGetSumCount
    // (offset 0x3d0), FloatFromPermil(Value2), float32 multiply,
    // ceiling, add Value1, then CalculateAddingParameter/AddParameter x Count.
    const sum = Math.trunc(Number(exam.enthusiasticGetSumCount ?? 0));
    const bonus = Math.ceil(Math.fround(
      Math.fround(Math.fround(v2) / Math.fround(1000)) * Math.fround(sum),
    ));
    const result = applyNativeLessonHits(exam, v1 + bonus,
      Math.max(0, Math.trunc(Number(parsed.count) || 0)), currentTowerScoreContext(state));
    event.effects.push(`累積熱意参照: パラメータ +${result.added}`);
  }
}

class LessonDependExamAggressiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class LessonDependExamReviewEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class LessonDependParameterBuffEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonDependParameterBuffEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    applyMasterLesson(state, parsed, scaledMasterValue(exam.parameterBuff, parsed, v2 > 0), event, "好調参照"); return;
  }
}

class LessonDependPlayCardCountSumEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonDependPlayCardCountSumEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    // LessonDependPlayCardCountSumEffectExecutor @ 0x8059ca0 reads the
          // completed-card count, before this card's UseCardAfterCheck increment.
          applyMasterLesson(state, parsed, v1 + v2 * Number(exam.cardPlayCount ?? 0), event, "カード使用数参照");
          return;
  }
}

class LessonDependReviewAndSearchCountEffectExecutor {
  static ExecuteEffect({ state, parsed, exam, v1, v2, searchCount, event }) {
    const base = nativeSearchStatusLessonBase(v1, v2, searchCount(), exam.review);
    const result = applyNativeLessonHits(exam, base, parsed.count, currentTowerScoreContext(state));
    event.effects.push(`好印象・検索枚数参照: パラメータ +${result.added}`);
  }
}

class LessonDependReviewOrAggressiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class LessonDependStaminaConsumptionSumEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonDependStaminaConsumptionSumEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    applyMasterLesson(state, parsed, scaledMasterValue(exam.staminaConsumptionSum, parsed), event, "体力消費量参照"); return;
  }
}

class LessonDependStaminaEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonDependStaminaEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    applyMasterLesson(state, parsed, scaledMasterValue(exam.stamina, parsed), event, "体力参照"); return;
  }
}

class LessonEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class LessonFixEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonFixEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          const added = Math.max(0, Math.trunc(v1)) * Math.max(1, Number(parsed.count) || 1);
          exam.parameter += added;
          event.effects.push(`固定パラメータ +${added}`);
          return;
        }
  }
}

class LessonFullPowerPointEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonFullPowerPointEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          // Native @ 0x8014618 reads FullPowerPointGetSumCount, and floors the
          // scaled contribution before adding the fixed value (once per hit).
          const gained = Math.max(0, Number(exam.fullPowerPointGetSum ?? 0));
          const extra = Math.floor(Math.fround(Math.fround(v2 / 1000) * Math.fround(gained)));
          applyMasterLesson(state, parsed, v1 + extra, event, "全力値獲得累計参照");
          return;
        }
  }
}

class LessonMultipleConcentrationEffectExecutor {
  static ExecuteEffect({ state, parsed, event, exam, v1, v2 }) {
    // ELF LessonMultipleConcentrationEffectExecutor.ExecuteEffect uses Value1, Value2 and Count;
    // its per-effect modifier is 1 + FloatFromPermil(Value2).
    // One CalculateAddingParameter is followed by Count AddParameter calls.
    const result = applyNativeModifiedLessonRepeat(
      exam, v1, v2, Math.max(0, Math.trunc(Number(parsed.count) || 0)),
      NATIVE_LESSON_MODIFIER_KIND.Concentration, currentTowerScoreContext(state),
    );
    event.effects.push(`強気時スコア倍率: パラメータ +${result.added}`);
  }
}

class LessonMultipleEnthusiasticEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonMultipleEnthusiasticEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          const base = Math.max(0, v1 + scaledMasterValue(exam.enthusiastic, { ...parsed, value1: v2 || 1000 }));
          applyMasterLesson(state, parsed, base, event, "熱意参照"); return;
        }
  }
}

class LessonMultipleFullPowerEffectExecutor {
  static ExecuteEffect({ state, parsed, event, exam, v1, v2 }) {
    // ELF LessonMultipleFullPowerEffectExecutor.ExecuteEffect uses Value1, Value2 and Count;
    // its per-effect modifier is 1 + FloatFromPermil(Value2).
    // One CalculateAddingParameter is followed by Count AddParameter calls.
    const result = applyNativeModifiedLessonRepeat(
      exam, v1, v2, Math.max(0, Math.trunc(Number(parsed.count) || 0)),
      NATIVE_LESSON_MODIFIER_KIND.FullPower, currentTowerScoreContext(state),
    );
    event.effects.push(`全力時スコア倍率: パラメータ +${result.added}`);
  }
}

class LessonValueMultipleDownEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP LessonValueMultipleDownEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          const result = applyParsedExamEffect(exam, {
            kind: "lesson_value_multiple_down", id: parsed.id, permil: v1, turn: turn || -1,
          });
          event.effects.push(result.label); return;
        }
  }
}

class LessonValueMultipleEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class MoveGrowEffectEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class MultipleLessonBuffLessonEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class OverPreservationEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP OverPreservationEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          const stance = trySetExamStance(exam, EXAM_IDOL_STATUS_TYPE.OverPreservation, 1);
          applyStanceRuntimeRewards(state, stance, event);
          event.effects.push(stance.changed ? "超温存に変更" : "指針変更なし");
          return;
        }
  }
}

class PanicEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP PanicEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("panic", 1, "パニック", "flag"); return;
  }
}

class ParameterBuffAdditiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ParameterBuffAdditiveEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("parameterBuffAdditivePermil", v1, "好調効果増加"); return;
  }
}

class ParameterBuffAdditiveFixEffectExecutor {
  static ExecuteEffect({ exam, v1, v2, event }) {
    // ELF 0x805d7b8: GetParameterBuffAdditiveFix -> TryAddParameterBuffAdditiveFixStatus(Value1, Value2).
    if (addNativeGenericTimedStatus(exam, "parameterBuffAdditiveFix", v1, v2, "add")) {
      event.effects.push(`好調固定加算 +${v1}（${v2}T）`);
    }
  }
}

class ParameterBuffDependLessonBuffEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ParameterBuffDependLessonBuffEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    status("parameterBuff", scaledMasterValue(exam.lessonBuff, parsed), "好調", "parameterBuffAdditivePermil"); return;
  }
}

class ParameterBuffEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ParameterBuffMultiplePerTurnEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ParameterBuffMultiplePerTurnReduceEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ParameterBuffMultiplePerTurnReduceEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    reduce("parameterBuffMultiplePerTurn", v1, "絶好調"); return;
  }
}

class ParameterBuffPerSearchCountEffectExecutor {
  static ExecuteEffect({ v1, v2, searchCount, status }) {
    // ELF 0x805e688: GetSearchCardList.Count * FloatFromPermil(Value2),
    // round toward positive infinity, then add Value1 and TryAddParameterBuffStatus.
    status("parameterBuff", v1 + nativeSearchCountBonus(v2, searchCount()),
      "好調", "parameterBuffAdditivePermil", "parameterBuffAdditiveFix");
  }
}

class ParameterBuffReduceCancellableEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ParameterBuffReduceEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ParameterBuffTurnEndReduceLockEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class PlayableValueAddEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class PreservationEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ReviewAdditiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ReviewAdditiveEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("reviewAdditivePermil", v1, "好印象効果増加"); return;
  }
}

class ReviewAdditiveFixEffectExecutor {
  static ExecuteEffect({ exam, v1, v2, event }) {
    // ELF 0x805f874: GetReviewAdditiveFix -> TryAddReviewAdditiveFixStatus(Value1, Value2).
    if (addNativeGenericTimedStatus(exam, "reviewAdditiveFix", v1, v2, "add")) {
      event.effects.push(`好印象固定加算 +${v1}（${v2}T）`);
    }
  }
}

class ReviewCountAddEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ReviewDependAggressiveEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ReviewDependAggressiveEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    status("review", scaledMasterValue(exam.aggressive, parsed), "好印象", "reviewAdditivePermil"); return;
  }
}

class ReviewDependBlockEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ReviewDependBlockEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    status("review", scaledMasterValue(exam.block, parsed), "好印象", "reviewAdditivePermil"); return;
  }
}

class ReviewDependReviewConsumptionSumEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ReviewDependReviewConsumptionSumEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    status("review", scaledMasterValue(exam.reviewConsumptionSum, parsed), "好印象", "reviewAdditivePermil"); return;
  }
}

class ReviewEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ReviewMultipleEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ReviewPerSearchCountEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ReviewPerSearchCountEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    status("review", scaledMasterValue(searchCount(), { ...parsed, value1: v2 || v1 }), "好印象", "reviewAdditivePermil"); return;
  }
}

class ReviewReduceCancellableEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ReviewReduceEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ReviewReduceEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    exam.reviewConsumptionSum += Math.min(exam.review, v1); reduce("review", v1, "好印象"); return;
  }
}

class ReviewTurnEndReduceLockEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class ReviewValueMultipleEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP ReviewValueMultipleEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          const field = type === "ExamBlockValueMultiple" ? "block" : type === "ExamReviewValueMultiple" ? "review" : "aggressive";
          const before = Number(exam[field] ?? 0);
          const extra = field === "block"
            ? Math.ceil(Math.fround(Math.fround(Math.fround(1 + Math.fround(v1 / 1000)) * Math.fround(before)) - Math.fround(before)))
            : Math.ceil(Math.fround(Math.fround(v1 / 1000) * Math.fround(before)));
          exam[field] = before + Math.max(0, extra);
          event.effects.push(field + " +" + Math.max(0, extra)); return;
        }
  }
}

class SearchEffectPlayCountBuffEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class SearchPlayCardBuffConsumptionChangeEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class SearchPlayCardStaminaConsumptionChangeEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP SearchPlayCardStaminaConsumptionChangeEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    state.searchCardCostChanges.push({ searchId: parsed.searchId, value: v1, count: parsed.count, turn });
          event.effects.push("対象カードの体力消費を" + v1 + "に変更"); return;
  }
}

class StaminaConsumptionAddDownEffectExecutor {
  static ExecuteEffect({ exam, v1, event }) {
    // ELF 0x80629d4: TryAdd*Status(Value1=duration).
    if (addNativeGenericTimedStatus(exam, "staminaConsumptionAddDown", 1, v1, "duration")) {
      event.effects.push(`体力消費増加を抑制（${v1}T）`);
    }
  }
}

class StaminaConsumptionAddEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class StaminaConsumptionAddFixEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class StaminaConsumptionDownAddEffectExecutor {
  static ExecuteEffect({ exam, v1, event }) {
    // ELF 0x8063188: TryAdd*Status(Value1=duration).
    if (addNativeGenericTimedStatus(exam, "staminaConsumptionDownAdd", 1, v1, "duration")) {
      event.effects.push(`体力消費軽減効果を増加（${v1}T）`);
    }
  }
}

class StaminaConsumptionDownEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class StaminaConsumptionDownFixEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class StaminaDamageEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP StaminaDamageEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          // StaminaReduceEffectExecutor.ExecuteEffect (IL2CPP RVA 0x80643D4):
          // a positive effectValue is a permille ratio of max stamina, not a
          // fixed amount. Keep StaminaReduceFix as a distinct absolute reduction.
          // The native path converts to float32, adds 0.0001f, then truncates.
          const amount = type === "ExamStaminaReduce"
            ? (v1 <= 0 ? 0 : Math.trunc(Math.fround(
                Math.fround(Math.fround(v1 / 1000) + Math.fround(0.0001))
                * Math.fround(Number(exam.maxStamina ?? 0)))))
            : Math.abs(v1);
          // StaminaReduceFixEffectExecutor -> ReduceStaminaFix @0x80355fc:
          // direct subtraction @0x8035698 bypasses all card-cost multipliers.
          if (type === "ExamStaminaReduceFix") {
            exam.stamina = Math.max(0, exam.stamina - amount);
            event.effects.push(`体力減少 ${amount}`);
            return;
          }
          const resolved = calculateNativeStaminaDamage(exam, amount, {
            penetrate: type !== "ExamStaminaDamage",
            applyFixed: true,
          });
          exam.block = Math.max(0, exam.block - resolved.blockDamage);
          exam.stamina = Math.max(0, exam.stamina - resolved.staminaDamage);
          exam.blockConsumptionSum += resolved.blockDamage;
          exam.staminaConsumptionSum += resolved.staminaDamage;
          event.effects.push(`体力減少 ${resolved.damage}`); return;
        }
  }
}

class StaminaRecoverAddEffectExecutor {
  static ExecuteEffect({ exam, v1, event }) {
    // ELF 0x8063A08: GetStaminaRecoverAdd; TryAddStaminaRecoverAddStatus(Value1, -1).
    if (!addNativeGenericTimedStatus(exam, 'staminaRecoverAdd', v1, -1, 'add')) return;
    event.effects.push(`体力回復量増加 +${Math.trunc(v1)}`);
  }
}

class StaminaRecoverFixEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class StaminaRecoverMultipleEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP StaminaRecoverMultipleEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          if (exam.staminaRecoverRestriction) return;
          const amount = Math.ceil(Number(exam.maxStamina ?? 0) * v1 / 1000)
            + Math.max(0, Math.trunc(Number(exam.staminaRecoverAdd ?? 0)));
          const before = exam.stamina; exam.stamina = Math.min(exam.maxStamina || Infinity, exam.stamina + amount);
          event.effects.push(`体力 +${exam.stamina - before}`); return;
        }
  }
}

class StaminaRecoverRestrictionEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP StaminaRecoverRestrictionEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    timedAdd("staminaRecoverRestriction", 1, "体力回復不可", "flag"); return;
  }
}

class StaminaReduceChangeEffectExecutor {
  static ExecuteEffect({ exam, v1, v2, event }) {
    // ELF @0x8064178 loads Value1/Turn from fields +0x10/+0x14,
    // TryAddStaminaReduceChangeStatus @0x806df6c.
    if (addNativeGenericTimedStatus(exam, "staminaReduceChange", v1, v2, "add")) {
      event.effects.push(`体力減少変更 +${v1}（${v2}T）`);
    }
  }
}

class StaminaReduceEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP StaminaReduceEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          // StaminaReduceEffectExecutor.ExecuteEffect (IL2CPP RVA 0x80643D4):
          // a positive effectValue is a permille ratio of max stamina, not a
          // fixed amount. Keep StaminaReduceFix as a distinct absolute reduction.
          // The native path converts to float32, adds 0.0001f, then truncates.
          const amount = type === "ExamStaminaReduce"
            ? (v1 <= 0 ? 0 : Math.trunc(Math.fround(
                Math.fround(Math.fround(v1 / 1000) + Math.fround(0.0001))
                * Math.fround(Number(exam.maxStamina ?? 0)))))
            : Math.abs(v1);
          // StaminaReduceFixEffectExecutor -> ReduceStaminaFix @0x80355fc:
          // direct subtraction @0x8035698 bypasses all card-cost multipliers.
          if (type === "ExamStaminaReduceFix") {
            exam.stamina = Math.max(0, exam.stamina - amount);
            event.effects.push(`体力減少 ${amount}`);
            return;
          }
          const resolved = calculateNativeStaminaDamage(exam, amount, {
            penetrate: type !== "ExamStaminaDamage",
            applyFixed: true,
          });
          exam.block = Math.max(0, exam.block - resolved.blockDamage);
          exam.stamina = Math.max(0, exam.stamina - resolved.staminaDamage);
          exam.blockConsumptionSum += resolved.blockDamage;
          exam.staminaConsumptionSum += resolved.staminaDamage;
          event.effects.push(`体力減少 ${resolved.damage}`); return;
        }
  }
}

class StaminaReduceFixEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP StaminaReduceFixEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          // StaminaReduceEffectExecutor.ExecuteEffect (IL2CPP RVA 0x80643D4):
          // a positive effectValue is a permille ratio of max stamina, not a
          // fixed amount. Keep StaminaReduceFix as a distinct absolute reduction.
          // The native path converts to float32, adds 0.0001f, then truncates.
          const amount = type === "ExamStaminaReduce"
            ? (v1 <= 0 ? 0 : Math.trunc(Math.fround(
                Math.fround(Math.fround(v1 / 1000) + Math.fround(0.0001))
                * Math.fround(Number(exam.maxStamina ?? 0)))))
            : Math.abs(v1);
          // StaminaReduceFixEffectExecutor -> ReduceStaminaFix @0x80355fc:
          // direct subtraction @0x8035698 bypasses all card-cost multipliers.
          if (type === "ExamStaminaReduceFix") {
            exam.stamina = Math.max(0, exam.stamina - amount);
            event.effects.push(`体力減少 ${amount}`);
            return;
          }
          const resolved = calculateNativeStaminaDamage(exam, amount, {
            penetrate: type !== "ExamStaminaDamage",
            applyFixed: true,
          });
          exam.block = Math.max(0, exam.block - resolved.blockDamage);
          exam.stamina = Math.max(0, exam.stamina - resolved.staminaDamage);
          exam.blockConsumptionSum += resolved.blockDamage;
          exam.staminaConsumptionSum += resolved.staminaDamage;
          event.effects.push(`体力減少 ${resolved.damage}`); return;
        }
  }
}

class StanceLockConcentrationEffectExecutor {
  static ExecuteEffect({ exam, v1, event }) {
    // ELF 0x8064b08: GetStanceLock*Turn -> TryAddStanceLock*Effect(Value1).
    // TryAdd at 0x807d278 increments an existing status turn counter,
    // or constructs a new timed status; existing turn lifecycle spends it.
    const added = Math.max(0, Math.trunc(v1));
    if (added === 0) return;
    exam.stanceLockConcentration = Math.max(0, Math.trunc(Number(exam.stanceLockConcentration ?? 0))) + added;
    event.effects.push(`強気移行禁止 +${added}T`);
  }
}

class StanceLockEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP StanceLockEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    exam.stanceLock = turn || 1; event.effects.push(`指針固定 ${exam.stanceLock}ターン`); return;
  }
}

class StanceLockFullPowerEffectExecutor {
  static ExecuteEffect({ exam, v1, event }) {
    // ELF 0x8064fc0: GetStanceLock*Turn -> TryAddStanceLock*Effect(Value1).
    // TryAdd at 0x807d278 increments an existing status turn counter,
    // or constructs a new timed status; existing turn lifecycle spends it.
    const added = Math.max(0, Math.trunc(v1));
    if (added === 0) return;
    exam.stanceLockFullPower = Math.max(0, Math.trunc(Number(exam.stanceLockFullPower ?? 0))) + added;
    event.effects.push(`全力移行禁止 +${added}T`);
  }
}

class StanceLockPreservationEffectExecutor {
  static ExecuteEffect({ exam, v1, event }) {
    // ELF 0x806521c: GetStanceLock*Turn -> TryAddStanceLock*Effect(Value1).
    // TryAdd at 0x807d278 increments an existing status turn counter,
    // or constructs a new timed status; existing turn lifecycle spends it.
    const added = Math.max(0, Math.trunc(v1));
    if (added === 0) return;
    exam.stanceLockPreservation = Math.max(0, Math.trunc(Number(exam.stanceLockPreservation ?? 0))) + added;
    event.effects.push(`温存移行禁止 +${added}T`);
  }
}

class StanceResetEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP StanceResetEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          const stance = trySetExamStance(exam, EXAM_IDOL_STATUS_TYPE.Unknown, 0);
          applyStanceRuntimeRewards(state, stance, event);
          event.effects.push(stance.changed ? "指針解除" : "指針変更なし");
          return;
        }
  }
}

class StatusEnchantCountAddEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class StatusEnchantEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP StatusEnchantEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    registerMasterStatusEnchant(state, parsed);
          event.effects.push(`継続効果を追加: ${parsed.enchantId}`);
          return;
  }
}

class StatusEnchantEncoreEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP StatusEnchantEncoreEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    registerMasterStatusEnchant(state, parsed);
          event.effects.push(`継続効果を追加: ${parsed.enchantId}`);
          return;
  }
}

class StatusEnchantTurnAddEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

class UpgradeEffectExecutor {
  static ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd }) {
    // IL2CPP UpgradeEffectExecutor.ExecuteEffect; extracted from the legacy Master Effect switch.
    {
          // A timer with a Hand search is resolved at the next turn's draw
          // boundary. Searching here would see an empty hand, silently losing
          // アイドル魂+'s delayed upgrade (native contest #8 turn 2).
          const search = resolvedMasterSearch(state, parsed.searchId);
          if (timed && String(search?.cardPositionType ?? "").includes("Hand")) {
            state.pendingTimedCardUpgradeEffects.push(parsed);
          } else {
            for (const card of pickedMasterCards(state, parsed)) {
              applyTemporarySkillUpgradeInPlace(state, card);
            }
          }
          event.effects.push("対象カードを強化"); return;
        }
  }
}

class UpliftingEffectExecutor {
  static ExecuteEffect({ state, parsed, event, type }) {
    // No native-equivalent calculation implemented: preserve prior unsupported behavior.
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

// Public constructor lookup for all 161 IL2CPP executor classes (including
// explicit unsupported implementations). For supported master effects see
// NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES; parsed effects live in exam_effects.js.
export const NATIVE_EFFECT_EXECUTOR_CLASSES = Object.freeze({
  AddGrowEffectExecutor,
  AggressiveAdditiveEffectExecutor,
  AggressiveAdditiveFixEffectExecutor,
  AggressiveDependReviewEffectExecutor,
  AggressiveEffectExecutor,
  AggressivePerSearchCountEffectExecutor,
  AggressiveReduceCancellableEffectExecutor,
  AggressiveReduceEffectExecutor,
  AggressiveValueMultipleEffectExecutor,
  AntiDebuffEffectExecutor,
  BlockAddDownEffectExecutor,
  BlockAddDownRestrictionEffectExecutor,
  BlockAddMultipleAggressiveEffectExecutor,
  BlockDependBlockConsumptionSumEffectExecutor,
  BlockDependReviewEffectExecutor,
  BlockDownEffectExecutor,
  BlockEffectExecutor,
  BlockFixEffectExecutor,
  BlockPerSearchCountEffectExecutor,
  BlockPerUserCardCountEffectExecutor,
  BlockRestrictionEffectExecutor,
  BlockValueMultiplicationEffectExecutor,
  BuffConsumptionAddEffectExecutor,
  BuffConsumptionDownEffectExecutor,
  CardCreateIdEffectExecutor,
  CardCreateSearchEffectExecutor,
  CardDuplicateEffectExecutor,
  CardMoveEffectExecutor,
  CardShuffleDeckGraveEffectExecutor,
  CardShuffleDeckLostEffectExecutor,
  ChainEffectExecutor,
  ChainEffectPerPassedTurnEffectExecutor,
  ChainEffectPerRemainTurnEffectExecutor,
  ClearDebuffEffectExecutor,
  ConcentrationEffectExecutor,
  ConcentrationLessonMultipleAdditiveEffectExecutor,
  DebuffRecoverEffectExecutor,
  DrawEffectExecutor,
  EffectPerSearchCountEffectExecutor,
  EffectTimerEffectExecutor,
  EffectTimerEndTurnEffectExecutor,
  EnthusiasticAdditiveEffectExecutor,
  EnthusiasticMultipleEffectExecutor,
  EnthusiasticTurnAdditiveEffectExecutor,
  ExamLessonAddMultipleLessonBuffEffectExecutor,
  LessonPerSearchCountEffectExecutor,
  ExamPlayCardLimitPlayableValueAddEffectExecutor,
  ExtraTurnEffectExecutor,
  ForcePlayCardSearchWithCostEffectExecutor,
  ForcePlaySearchEffectExecutor,
  FullPowerEffectExecutor,
  FullPowerLessonMultipleAdditiveEffectExecutor,
  FullPowerPointAdditiveEffectExecutor,
  FullPowerPointAdditiveFixEffectExecutor,
  FullPowerPointDependFullPowerPointGetSumEffectExecutor,
  FullPowerPointEffectExecutor,
  FullPowerPointPerSearchCountEffectExecutor,
  FullPowerPointReduceCancellableEffectExecutor,
  FullPowerPointReduceEffectExecutor,
  GetCardUpgradeEffectExecutor,
  GimmickEnthusiasticEffectExecutor,
  GimmickLessonDebuffEffectExecutor,
  GimmickParameterDebuffEffectExecutor,
  GimmickPlayCardLimitEffectExecutor,
  GimmickSleepyEffectExecutor,
  GimmickSlumpEffectExecutor,
  GimmickStartTurnCardDrawDownEffectExecutor,
  GrowEffectLessonAddAdditiveEffectExecutor,
  HandGraveCountCardDrawEffectExecutor,
  HandHoldEffectExecutor,
  ItemFireLimitAddEffectExecutor,
  LessonAddBlockEffectExecutor,
  LessonAddMultipleParameterBuffEffectExecutor,
  LessonBuffAdditiveEffectExecutor,
  LessonBuffAdditiveFixEffectExecutor,
  LessonBuffDependParameterBuffEffectExecutor,
  LessonBuffEffectExecutor,
  LessonBuffMultipleEffectExecutor,
  LessonBuffPerSearchCountEffectExecutor,
  LessonBuffReduceCancellableEffectExecutor,
  LessonBuffReduceEffectExecutor,
  LessonChangeSpecifyLessThanEffectExecutor,
  LessonChangeSpecifyMoreThanEffectExecutor,
  LessonDependAggressiveAndSearchCountEffectExecutor,
  LessonDependBlockAndSearchCountEffectExecutor,
  LessonDependBlockConsumptionSumEffectExecutor,
  LessonDependBlockEffectExecutor,
  LessonDependEnthusiasticGetSumEffectExecutor,
  LessonDependExamAggressiveEffectExecutor,
  LessonDependExamReviewEffectExecutor,
  LessonDependParameterBuffEffectExecutor,
  LessonDependPlayCardCountSumEffectExecutor,
  LessonDependReviewAndSearchCountEffectExecutor,
  LessonDependReviewOrAggressiveEffectExecutor,
  LessonDependStaminaConsumptionSumEffectExecutor,
  LessonDependStaminaEffectExecutor,
  LessonEffectExecutor,
  LessonFixEffectExecutor,
  LessonFullPowerPointEffectExecutor,
  LessonMultipleConcentrationEffectExecutor,
  LessonMultipleEnthusiasticEffectExecutor,
  LessonMultipleFullPowerEffectExecutor,
  LessonValueMultipleDownEffectExecutor,
  LessonValueMultipleEffectExecutor,
  MoveGrowEffectEffectExecutor,
  MultipleLessonBuffLessonEffectExecutor,
  OverPreservationEffectExecutor,
  PanicEffectExecutor,
  ParameterBuffAdditiveEffectExecutor,
  ParameterBuffAdditiveFixEffectExecutor,
  ParameterBuffDependLessonBuffEffectExecutor,
  ParameterBuffEffectExecutor,
  ParameterBuffMultiplePerTurnEffectExecutor,
  ParameterBuffMultiplePerTurnReduceEffectExecutor,
  ParameterBuffPerSearchCountEffectExecutor,
  ParameterBuffReduceCancellableEffectExecutor,
  ParameterBuffReduceEffectExecutor,
  ParameterBuffTurnEndReduceLockEffectExecutor,
  PlayableValueAddEffectExecutor,
  PreservationEffectExecutor,
  ReviewAdditiveEffectExecutor,
  ReviewAdditiveFixEffectExecutor,
  ReviewCountAddEffectExecutor,
  ReviewDependAggressiveEffectExecutor,
  ReviewDependBlockEffectExecutor,
  ReviewDependReviewConsumptionSumEffectExecutor,
  ReviewEffectExecutor,
  ReviewMultipleEffectExecutor,
  ReviewPerSearchCountEffectExecutor,
  ReviewReduceCancellableEffectExecutor,
  ReviewReduceEffectExecutor,
  ReviewTurnEndReduceLockEffectExecutor,
  ReviewValueMultipleEffectExecutor,
  SearchEffectPlayCountBuffEffectExecutor,
  SearchPlayCardBuffConsumptionChangeEffectExecutor,
  SearchPlayCardStaminaConsumptionChangeEffectExecutor,
  StaminaConsumptionAddDownEffectExecutor,
  StaminaConsumptionAddEffectExecutor,
  StaminaConsumptionAddFixEffectExecutor,
  StaminaConsumptionDownAddEffectExecutor,
  StaminaConsumptionDownEffectExecutor,
  StaminaConsumptionDownFixEffectExecutor,
  StaminaDamageEffectExecutor,
  StaminaRecoverAddEffectExecutor,
  StaminaRecoverFixEffectExecutor,
  StaminaRecoverMultipleEffectExecutor,
  StaminaRecoverRestrictionEffectExecutor,
  StaminaReduceChangeEffectExecutor,
  StaminaReduceEffectExecutor,
  StaminaReduceFixEffectExecutor,
  StanceLockConcentrationEffectExecutor,
  StanceLockEffectExecutor,
  StanceLockFullPowerEffectExecutor,
  StanceLockPreservationEffectExecutor,
  StanceResetEffectExecutor,
  StatusEnchantCountAddEffectExecutor,
  StatusEnchantEffectExecutor,
  StatusEnchantEncoreEffectExecutor,
  StatusEnchantTurnAddEffectExecutor,
  UpgradeEffectExecutor,
  UpliftingEffectExecutor,
});

export const NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES = Object.freeze({
  "ExamStatusEnchant": StatusEnchantEffectExecutor,
  "ExamStatusEnchantEncore": StatusEnchantEncoreEffectExecutor,
  "ExamEffectTimer": EffectTimerEffectExecutor,
  "ExamLessonFix": LessonFixEffectExecutor,
  "ExamLessonValueMultipleDown": LessonValueMultipleDownEffectExecutor,
  "ExamLessonDependBlock": LessonDependBlockEffectExecutor,
  "ExamLessonDependParameterBuff": LessonDependParameterBuffEffectExecutor,
  "ExamLessonDependStamina": LessonDependStaminaEffectExecutor,
  "ExamLessonDependBlockConsumptionSum": LessonDependBlockConsumptionSumEffectExecutor,
  "ExamLessonDependStaminaConsumptionSum": LessonDependStaminaConsumptionSumEffectExecutor,
  "ExamLessonDependPlayCardCountSum": LessonDependPlayCardCountSumEffectExecutor,
  "ExamLessonFullPowerPoint": LessonFullPowerPointEffectExecutor,
  "ExamLessonPerSearchCount": LessonPerSearchCountEffectExecutor,
  "ExamLessonDependBlockAndSearchCount": LessonDependBlockAndSearchCountEffectExecutor,
  "ExamLessonAddMultipleLessonBuff": ExamLessonAddMultipleLessonBuffEffectExecutor,
  "ExamMultipleEnthusiasticLesson": LessonMultipleEnthusiasticEffectExecutor,
  "ExamMultipleFullPowerLesson": LessonMultipleFullPowerEffectExecutor,
  "ExamMultipleConcentrationLesson": LessonMultipleConcentrationEffectExecutor,
  "ExamBlockFix": BlockFixEffectExecutor,
  "ExamBlockAddMultipleAggressive": BlockAddMultipleAggressiveEffectExecutor,
  "ExamBlockPerUseCardCount": BlockPerUserCardCountEffectExecutor,
  "ExamBlockDependExamReview": BlockDependReviewEffectExecutor,
  "ExamBlockDependBlockConsumptionSum": BlockDependBlockConsumptionSumEffectExecutor,
  "ExamReviewDependExamBlock": ReviewDependBlockEffectExecutor,
  "ExamReviewDependExamCardPlayAggressive": ReviewDependAggressiveEffectExecutor,
  "ExamReviewDependReviewConsumptionSum": ReviewDependReviewConsumptionSumEffectExecutor,
  "ExamReviewPerSearchCount": ReviewPerSearchCountEffectExecutor,
  "ExamLessonBuffDependParameterBuff": LessonBuffDependParameterBuffEffectExecutor,
  "ExamLessonBuffPerSearchCount": LessonBuffPerSearchCountEffectExecutor,
  "ExamParameterBuffDependLessonBuff": ParameterBuffDependLessonBuffEffectExecutor,
  "ExamStaminaRecoverMultiple": StaminaRecoverMultipleEffectExecutor,
  "ExamStaminaDamage": StaminaDamageEffectExecutor,
  "ExamStaminaReduceFix": StaminaReduceFixEffectExecutor,
  "ExamStaminaReduce": StaminaReduceEffectExecutor,
  "ExamAggressiveReduce": AggressiveReduceEffectExecutor,
  "ExamReviewReduce": ReviewReduceEffectExecutor,
  "ExamLessonBuffReduce": LessonBuffReduceEffectExecutor,
  "ExamFullPowerPointReduce": FullPowerPointReduceEffectExecutor,
  "ExamParameterBuffMultiplePerTurnReduce": ParameterBuffMultiplePerTurnReduceEffectExecutor,
  "ExamBlockDown": BlockDownEffectExecutor,
  "ExamAggressiveValueMultiple": AggressiveValueMultipleEffectExecutor,
  "ExamReviewValueMultiple": ReviewValueMultipleEffectExecutor,
  "ExamBlockValueMultiple": BlockValueMultiplicationEffectExecutor,
  "ExamAggressiveAdditive": AggressiveAdditiveEffectExecutor,
  "ExamAggressiveAdditiveFix": AggressiveAdditiveFixEffectExecutor,
  "ExamReviewAdditive": ReviewAdditiveEffectExecutor,
  "ExamLessonBuffAdditive": LessonBuffAdditiveEffectExecutor,
  "ExamLessonBuffAdditiveFix": LessonBuffAdditiveFixEffectExecutor,
  "ExamParameterBuffAdditive": ParameterBuffAdditiveEffectExecutor,
  "ExamEnthusiasticAdditive": EnthusiasticAdditiveEffectExecutor,
  "ExamEnthusiasticMultiple": EnthusiasticMultipleEffectExecutor,
  "ExamEnthusiasticTurnAdditive": EnthusiasticTurnAdditiveEffectExecutor,
  "ExamFullPowerPointAdditive": FullPowerPointAdditiveEffectExecutor,
  "ExamConcentrationLessonMultipleAdditive": ConcentrationLessonMultipleAdditiveEffectExecutor,
  "ExamFullPowerLessonMultipleAdditive": FullPowerLessonMultipleAdditiveEffectExecutor,
  "ExamBlockRestriction": BlockRestrictionEffectExecutor,
  "ExamBlockAddDown": BlockAddDownEffectExecutor,
  "ExamStaminaRecoverRestriction": StaminaRecoverRestrictionEffectExecutor,
  "ExamPanic": PanicEffectExecutor,
  "ExamAntiDebuff": AntiDebuffEffectExecutor,
  "ExamDebuffRecover": DebuffRecoverEffectExecutor,
  "ExamGimmickLessonDebuff": GimmickLessonDebuffEffectExecutor,
  "ExamGimmickParameterDebuff": GimmickParameterDebuffEffectExecutor,
  "ExamGimmickSlump": GimmickSlumpEffectExecutor,
  "ExamGimmickSleepy": GimmickSleepyEffectExecutor,
  "ExamGimmickPlayCardLimit": GimmickPlayCardLimitEffectExecutor,
  "ExamGimmickStartTurnCardDrawDown": GimmickStartTurnCardDrawDownEffectExecutor,
  "ExamBuffConsumptionAdd": BuffConsumptionAddEffectExecutor,
  "ExamItemFireLimitAdd": ItemFireLimitAddEffectExecutor,
  "ExamFullPowerPoint": FullPowerPointEffectExecutor,
  "ExamFullPower": FullPowerEffectExecutor,
  "ExamOverPreservation": OverPreservationEffectExecutor,
  "ExamStanceReset": StanceResetEffectExecutor,
  "StanceLock": StanceLockEffectExecutor,
  "ExamCardMove": CardMoveEffectExecutor,
  "ExamCardUpgrade": UpgradeEffectExecutor,
  "ExamCardDuplicate": CardDuplicateEffectExecutor,
  "ExamCardCreateSearch": CardCreateSearchEffectExecutor,
  "ExamSearchPlayCardStaminaConsumptionChange": SearchPlayCardStaminaConsumptionChangeEffectExecutor,
  "ExamForcePlayCardSearch": ForcePlaySearchEffectExecutor,
  "ExamForcePlayCardSearchWithCost": ForcePlayCardSearchWithCostEffectExecutor,
  "ExamEffectPerSearchCount": EffectPerSearchCountEffectExecutor,
  "ExamAggressiveDependReview": AggressiveDependReviewEffectExecutor,
  "ExamAggressivePerSearchCount": AggressivePerSearchCountEffectExecutor,
  "ExamBlockPerSearchCount": BlockPerSearchCountEffectExecutor,
  "ExamFullPowerPointDependFullPowerPointGetSum": FullPowerPointDependFullPowerPointGetSumEffectExecutor,
  "ExamFullPowerPointPerSearchCount": FullPowerPointPerSearchCountEffectExecutor,
  "ExamLessonDependAggressiveAndSearchCount": LessonDependAggressiveAndSearchCountEffectExecutor,
  "ExamLessonDependReviewAndSearchCount": LessonDependReviewAndSearchCountEffectExecutor,
  "ExamLessonAddBlock": LessonAddBlockEffectExecutor,
  "ExamStanceLockConcentration": StanceLockConcentrationEffectExecutor,
  "ExamStanceLockFullPower": StanceLockFullPowerEffectExecutor,
  "ExamStanceLockPreservation": StanceLockPreservationEffectExecutor,
  "ExamBuffConsumptionDown": BuffConsumptionDownEffectExecutor,
  "ExamStaminaConsumptionAddDown": StaminaConsumptionAddDownEffectExecutor,
  "ExamStaminaConsumptionDownAdd": StaminaConsumptionDownAddEffectExecutor,
  "ExamGimmickEnthusiastic": GimmickEnthusiasticEffectExecutor,
  "ExamReviewAdditiveFix": ReviewAdditiveFixEffectExecutor,
  "ExamParameterBuffAdditiveFix": ParameterBuffAdditiveFixEffectExecutor,
  "ExamFullPowerPointAdditiveFix": FullPowerPointAdditiveFixEffectExecutor,
  "ExamParameterBuffPerSearchCount": ParameterBuffPerSearchCountEffectExecutor,
  "ExamLessonDependEnthusiasticGetSum": LessonDependEnthusiasticGetSumEffectExecutor,
  "ExamStaminaReduceChange": StaminaReduceChangeEffectExecutor,
  "ExamBlockAddDownRestriction": BlockAddDownRestrictionEffectExecutor,
  "ExamStaminaRecoverAdd": StaminaRecoverAddEffectExecutor,
});

export const NATIVE_MASTER_EXECUTOR_COVERAGE = Object.freeze({
  registered: 161,
  implementedMasterTypes: Object.freeze(["ExamBlockAddDownRestriction","ExamStaminaRecoverAdd","ExamStaminaReduceChange","ExamLessonDependEnthusiasticGetSum","ExamParameterBuffPerSearchCount","ExamFullPowerPointAdditiveFix","ExamParameterBuffAdditiveFix","ExamReviewAdditiveFix","ExamGimmickEnthusiastic","ExamStaminaConsumptionDownAdd","ExamStaminaConsumptionAddDown","ExamBuffConsumptionDown","ExamStanceLockPreservation","ExamStanceLockFullPower","ExamStanceLockConcentration","ExamAggressiveDependReview","ExamAggressivePerSearchCount","ExamBlockPerSearchCount","ExamFullPowerPointDependFullPowerPointGetSum","ExamFullPowerPointPerSearchCount","ExamLessonDependAggressiveAndSearchCount","ExamLessonDependReviewAndSearchCount","ExamLessonAddBlock","ExamStatusEnchant","ExamStatusEnchantEncore","ExamEffectTimer","ExamLessonFix","ExamLessonValueMultipleDown","ExamLessonDependBlock","ExamLessonDependParameterBuff","ExamLessonDependStamina","ExamLessonDependBlockConsumptionSum","ExamLessonDependStaminaConsumptionSum","ExamLessonDependPlayCardCountSum","ExamLessonFullPowerPoint","ExamLessonPerSearchCount","ExamLessonDependBlockAndSearchCount","ExamLessonAddMultipleLessonBuff","ExamMultipleEnthusiasticLesson","ExamMultipleFullPowerLesson","ExamMultipleConcentrationLesson","ExamBlockFix","ExamBlockAddMultipleAggressive","ExamBlockPerUseCardCount","ExamBlockDependExamReview","ExamBlockDependBlockConsumptionSum","ExamReviewDependExamBlock","ExamReviewDependExamCardPlayAggressive","ExamReviewDependReviewConsumptionSum","ExamReviewPerSearchCount","ExamLessonBuffDependParameterBuff","ExamLessonBuffPerSearchCount","ExamParameterBuffDependLessonBuff","ExamStaminaRecoverMultiple","ExamStaminaDamage","ExamStaminaReduceFix","ExamStaminaReduce","ExamAggressiveReduce","ExamReviewReduce","ExamLessonBuffReduce","ExamFullPowerPointReduce","ExamParameterBuffMultiplePerTurnReduce","ExamBlockDown","ExamAggressiveValueMultiple","ExamReviewValueMultiple","ExamBlockValueMultiple","ExamAggressiveAdditive","ExamAggressiveAdditiveFix","ExamReviewAdditive","ExamLessonBuffAdditive","ExamLessonBuffAdditiveFix","ExamParameterBuffAdditive","ExamEnthusiasticAdditive","ExamEnthusiasticMultiple","ExamEnthusiasticTurnAdditive","ExamFullPowerPointAdditive","ExamConcentrationLessonMultipleAdditive","ExamFullPowerLessonMultipleAdditive","ExamBlockRestriction","ExamBlockAddDown","ExamStaminaRecoverRestriction","ExamPanic","ExamAntiDebuff","ExamDebuffRecover","ExamGimmickLessonDebuff","ExamGimmickParameterDebuff","ExamGimmickSlump","ExamGimmickSleepy","ExamGimmickPlayCardLimit","ExamGimmickStartTurnCardDrawDown","ExamBuffConsumptionAdd","ExamItemFireLimitAdd","ExamFullPowerPoint","ExamFullPower","ExamOverPreservation","ExamStanceReset","StanceLock","ExamCardMove","ExamCardUpgrade","ExamCardDuplicate","ExamCardCreateSearch","ExamSearchPlayCardStaminaConsumptionChange","ExamForcePlayCardSearch","ExamForcePlayCardSearchWithCost","ExamEffectPerSearchCount"]),
  unsupportedClassNames: Object.freeze(["AddGrowEffectExecutor","AggressiveEffectExecutor","AggressiveReduceCancellableEffectExecutor","BlockEffectExecutor","CardCreateIdEffectExecutor","CardShuffleDeckGraveEffectExecutor","CardShuffleDeckLostEffectExecutor","ChainEffectExecutor","ChainEffectPerPassedTurnEffectExecutor","ChainEffectPerRemainTurnEffectExecutor","ClearDebuffEffectExecutor","ConcentrationEffectExecutor","DrawEffectExecutor","EffectTimerEndTurnEffectExecutor","ExamPlayCardLimitPlayableValueAddEffectExecutor","ExtraTurnEffectExecutor","FullPowerPointReduceCancellableEffectExecutor","GetCardUpgradeEffectExecutor","GrowEffectLessonAddAdditiveEffectExecutor","HandGraveCountCardDrawEffectExecutor","HandHoldEffectExecutor","LessonAddMultipleParameterBuffEffectExecutor","LessonBuffEffectExecutor","LessonBuffMultipleEffectExecutor","LessonBuffReduceCancellableEffectExecutor","LessonChangeSpecifyLessThanEffectExecutor","LessonChangeSpecifyMoreThanEffectExecutor","LessonDependExamAggressiveEffectExecutor","LessonDependExamReviewEffectExecutor","LessonDependReviewOrAggressiveEffectExecutor","LessonEffectExecutor","LessonValueMultipleEffectExecutor","MoveGrowEffectEffectExecutor","MultipleLessonBuffLessonEffectExecutor","ParameterBuffEffectExecutor","ParameterBuffMultiplePerTurnEffectExecutor","ParameterBuffReduceCancellableEffectExecutor","ParameterBuffReduceEffectExecutor","ParameterBuffTurnEndReduceLockEffectExecutor","PlayableValueAddEffectExecutor","PreservationEffectExecutor","ReviewCountAddEffectExecutor","ReviewEffectExecutor","ReviewMultipleEffectExecutor","ReviewReduceCancellableEffectExecutor","ReviewTurnEndReduceLockEffectExecutor","SearchEffectPlayCountBuffEffectExecutor","SearchPlayCardBuffConsumptionChangeEffectExecutor","StaminaConsumptionAddEffectExecutor","StaminaConsumptionAddFixEffectExecutor","StaminaConsumptionDownEffectExecutor","StaminaConsumptionDownFixEffectExecutor","StaminaRecoverFixEffectExecutor","StatusEnchantCountAddEffectExecutor","StatusEnchantTurnAddEffectExecutor","UpliftingEffectExecutor"]),
});

function executeMasterEffect(state, parsed, event, { timed = false } = {}) {
  const type = String(parsed.masterEffectType ?? "").replace("ProduceExamEffectType_", "");
  const exam = state.exam;
  const v1 = Number(parsed.value1 ?? parsed.value ?? 0) || 0;
  const v2 = Number(parsed.value2 ?? 0) || 0;
  const turn = Number(parsed.turn ?? 0) || 0;
  const searchCount = () => masterSearchMatchCount(state, resolvedMasterSearch(state, parsed.searchId),
    { card: state.effectOwnerCard ?? state.playingCard });
  const status = (field, value, label, additive = "", fixed = "") => {
    const added = addScaledStatus(exam, field, value, additive, fixed);
    event.effects.push(`${label} +${added}`);
  };
  const reduce = (field, value, label) => {
    const before = Math.max(0, Number(exam[field] ?? 0));
    exam[field] = Math.max(0, before - Math.max(0, Number(value) || 0));
    event.effects.push(`${label} -${before - exam[field]}`);
  };
  const timedAdd = (field, value, label, mode = "add") => {
    addNativeGenericTimedStatus(exam, field, value, turn || -1, mode);
    event.effects.push(`${label}（${turn < 0 ? "∞" : turn}T）`);
  };
  const executor = NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES[type];
  if (!executor) {
    rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
    event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
    return;
  }
  return executor.ExecuteEffect({ state, parsed, event, timed, type, exam, v1, v2, turn, searchCount, status, reduce, timedAdd });
}

const nativeEffectFrames = new WeakMap();

function withNativeEffectFrame(state, execute) {
  let frames = nativeEffectFrames.get(state);
  if (!frames) { frames = []; nativeEffectFrames.set(state, frames); }
  const initial = captureNativeStatusSnapshot(state.exam);
  const frame = { before: { ...initial } };
  frames.push(frame);
  try { return execute(frame); }
  finally {
    frames.pop();
    const parent = frames.at(-1);
    if (parent) {
      const after = captureNativeStatusSnapshot(state.exam);
      for (const field of Object.keys(after)) {
        parent.before[field] = Number(parent.before[field] ?? 0) + after[field] - Number(initial[field] ?? 0);
      }
    }
    if (!frames.length) nativeEffectFrames.delete(state);
  }
}

function executeParsedTowerEffect(state, parsed, event, options = {}) {
  return traceSimulation(state, currentSimulationSource(state),
    () => withNativeEffectFrame(state, (frame) => {
      // ExecuteCommandImplAsync @0x80dbc18 prepares the card-move search
      // before CardMoveEffectExecutor @0x804bce4 searches again. Random
      // order generates one key per source candidate in each pass; this
      // preparation must not select cards or consume a ranged pick roll.
      if (parsed.masterEffectType === "ProduceExamEffectType_ExamCardMove") {
        const search = resolvedMasterSearch(state, parsed.searchId);
        const fullHand = String(parsed.movePositionType).endsWith("_Hand")
          && state.hand.length === normalizeHandLimit(state.handLimit);
        if (!fullHand && search?.orderType === "ProduceCardOrderType_Random"
          && !search.produceCardPoolId && !search.produceCardRandomPoolId) {
          masterSearchCandidates(state, search, { card: state.effectOwnerCard ?? state.playingCard });
        }
      }
      return executeParsedTowerEffectImpl(state, parsed, event, options, frame);
    }),
    { effectId: parsed.id, recordIfUnchanged: true });
}

function executeParsedTowerEffectImpl(state, parsed, event, { timed = false } = {}, frame) {
  const beforeStatus = frame.before;
  const debuffKinds = ["lesson_value_multiple_down", "stamina_consumption_add", "stamina_consumption_add_fix"];
  const debuffTypes = ["ExamBlockRestriction", "ExamBlockAddDown", "ExamStaminaRecoverRestriction", "ExamPanic", "ExamBuffConsumptionAdd", "ExamGimmickLessonDebuff", "ExamGimmickParameterDebuff", "ExamGimmickSlump", "ExamGimmickSleepy", "ExamGimmickPlayCardLimit", "ExamGimmickStartTurnCardDrawDown"];
  if (state.exam.antiDebuffCount > 0 && (debuffKinds.includes(parsed.kind) || debuffTypes.includes(String(parsed.masterEffectType).replace("ProduceExamEffectType_", "")))) {
    state.exam.antiDebuffCount -= 1; event.effects.push("低下状態を無効化"); return;
  }
  const applied = applyParsedExamEffect(state.exam, parsed, currentTowerScoreContext(state));
  if (applied.unsupported) {
    rememberUnsupported(state, `effect:${parsed.id}`);
    event.effects.push(applied.label);
    return;
  }

  switch (applied.command) {
    case "draw": {
      if (timed) {
        state.pendingDraw += Number(applied.value) || 0;
      } else {
        const draw = drawCardsIntoHand(state, Number(applied.value) || 0, event);
        applyExamSupportCardUpgrades(state, draw.drawn, event);
        event.drawn.push(...draw.drawn.map((card) => ({ ...card })));
        event.recycleEvents.push(...draw.recycleEvents);
      }
      break;
    }
    case "card_create_id":
      addGeneratedCard(state, applied, event);
      applied.label = `カード生成: ${runtimeCardName(state, applied.cardId, applied.upgradeCount)} ×${applied.pickCountMin}`;
      break;
    case "card_move_search":
      moveSearchedCards(state, applied, event);
      applied.label = `${runtimeCardPositionName(applied.searchPosition)}の${runtimeCardName(state, applied.cardId)}を${runtimeCardPositionName(applied.movePosition)}へ移動`;
      break;
    case "add_grow_effect": {
      const matched = addGrowEffectsToDeckAll(state, applied.effect ?? parsed, event);
      event.effects.push(`対象メンタルスキルカード ${matched}枚を成長`);
      break;
    }
    case "playable_add":
      addPlayableStatus(state, Number(applied.value) || 0);
      break;
    case "stance_change":
      applyStanceRuntimeRewards(state, applied.stance, event);
      break;
    case "extra_turn": {
      const value = Math.max(1, Math.trunc(Number(applied.value) || 1));
      if (
        state.turnLimit !== null
        && state.turnLimit !== undefined
        && Number.isFinite(Number(state.turnLimit))
      ) state.turnLimit += value;
      break;
    }
    case "timer":
      state.timers.push({ turn: parsed.turn, count: parsed.count, child: parsed.child, id: parsed.id });
      break;
    case "effect_repeat":
      state.cardEffectPlayCountBuff = { value: parsed.value, count: parsed.count, turn: parsed.turn, searchId: parsed.searchId, isPassingTurnStart: false };
      break;
    case "hand_swap": {
      const count = state.hand.length;
      const discarded = state.hand.splice(0);
      state.discard.push(...discarded);
      for (const card of discarded) notifyRuntimeCardMove(state, card, "hand", "grave", event);
      const draw = drawCardsIntoHand(state, count, event);
      applyExamSupportCardUpgrades(state, draw.drawn, event);
      event.drawn.push(...draw.drawn.map((card) => ({ ...card })));
      event.recycleEvents.push(...draw.recycleEvents);
      break;
    }
    case "upgrade_hand":
      if (timed) state.pendingHandUpgradeAll += 1;
      else upgradeHandCards(state);
      break;
    case "status_enchant":
      registerParsedStatusEnchant(state, parsed);
      applied.label = `${runtimeEnchantName(state, parsed.enchantId,
        { originCard: historyCard(state.effectOwnerCard ?? state.playingCard) })}を追加`;
      break;
    case "master_effect":
      executeMasterEffect(state, applied.effect ?? parsed, event, { timed });
      // executeMasterEffect writes the concrete user-facing event itself.
      applied.label = "";
      break;
  }
  if (applied.label) event.effects.push(applied.label);
  emitNativeStatusDiff(
    state,
    { ...beforeStatus },
    event,
    {
      cause: "effect",
      parsedEffect: parsed,
      effectType: parsedMasterEffectType(parsed),
    },
  );
}

function applyCardEffectEntry(state, entry, event, card = null, preparedTrigger = null) {
  const trigger = preparedTrigger ?? checkRuntimeCardTrigger(state, entry?.produceExamTriggerId, card, event);
  if (!trigger.supported) {
    rememberUnsupported(state, `trigger:${trigger.triggerId}`);
    event.effects.push(`未対応条件: ${trigger.triggerId}`);
    return;
  }
  if (!trigger.triggered) {
    event.effects.push(`条件不成立: ${entry?.produceExamTriggerId}`);
    return;
  }

  const effectId = String(entry?.produceExamEffectId ?? "");
  const masterEffect = state.examEffectById?.get?.(effectId);
  let parsed = applyCardGrowEffectsToParsedEffect(
    masterEffect ? parseExamEffectMaster(masterEffect) : parseExamEffectId(effectId),
    card,
  );
  const growBlockAdd = Math.max(0, Number(card?.growBlockAdd ?? 0));
  if (parsed.kind === "block" && growBlockAdd > 0) {
    parsed = {
      ...parsed,
      value: Number(parsed.value ?? 0) + growBlockAdd,
      growBlockAdd,
    };
  }
  executeParsedTowerEffect(state, parsed, event);
}

function cardMatchesSearchId(card, searchIdInput) {
  const searchId = String(searchIdInput ?? "");
  if (!searchId.startsWith("p_card_search-")) return true;

  const tokens = searchId.slice("p_card_search-".length).split("-");
  const category = String(card?.category ?? "");
  if (tokens.includes("active_skill") && category !== "ProduceCardCategory_ActiveSkill") return false;
  if (tokens.includes("mental_skill") && category !== "ProduceCardCategory_MentalSkill") return false;

  const rarityTokens = new Set(["n", "r", "sr", "ssr", "l", "t"]);
  const allowedRarities = tokens.filter((token) => rarityTokens.has(token));
  if (allowedRarities.length) {
    const rarity = String(card?.rarity ?? "")
      .replace(/^ProduceCardRarity_/i, "")
      .toLowerCase();
    if (!allowedRarities.includes(rarity)) return false;
  }

  // Position selectors such as "playing" and "deck_all" describe where the
  // native card search is evaluated. At card-use time the candidate here is
  // precisely the playing card; category/rarity are the predicates that
  // determine whether this play consumes the repeat status.
  return true;
}

function addGrowEffectsToDeckAll(state, parsed, event) {
  const grows = (parsed.growEffectIds ?? []).map((id) => state.growEffectById.get(id)).filter(Boolean);
  if (grows.length) {
    const candidates = parsed.pickRangeType ? pickedMasterCards(state, parsed) : [...state.deck, ...state.hand, ...state.discard, ...state.hold].filter((card) => cardMatchesSearchId(card, parsed.searchId));
    for (const card of candidates) applyPersistentRuntimeCardGrowEffects(card, grows);
    // DeckAll growth targets the card currently being used as well, but
    // native AddGrowEffect takes effect only after this play's lesson result.
    // Store it on the original card object, for its next play. Do not mutate
    // the in-flight score or replay an observed score from the capture.
    const search = resolvedMasterSearch(state, parsed.searchId);
    const playingCard = state.playingCard;
    const targetsPlayingCard = playingCard && search?.cardPositionType === "ProduceCardPositionType_DeckAll"
      && cardMatchesMasterSearch(playingCard, search);
    if (targetsPlayingCard) {
      state._deferredPlayingCardGrows ??= [];
      state._deferredPlayingCardGrows.push({ card: playingCard, grows: grows.map(grow => ({ ...grow })) });
    }
    event.grown ??= [];
    const matched = candidates.length + Number(Boolean(targetsPlayingCard));
    event.grown.push({ searchId: parsed.searchId, growEffectIds: [...parsed.growEffectIds], matched });
    event.effects.push("対象カードを成長");
    return matched;
  }
  const pools = [state.deck, state.hand, state.discard, state.hold];
  const seen = new Set();
  let matched = 0;
  const blockAdd = Math.max(0, Math.trunc(Number(parsed.blockAdd) || 0));
  const costAdd = Math.max(0, Math.trunc(Number(parsed.costAdd) || 0));

  for (const pool of pools) {
    for (const card of pool ?? []) {
      const identity = String(card?.token ?? `${card?.id ?? ""}@@${card?.originalIndex ?? ""}`);
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (!cardMatchesSearchId(card, parsed.searchId)) continue;

      if (blockAdd) card.growBlockAdd = Math.max(0, Number(card.growBlockAdd ?? 0)) + blockAdd;
      if (costAdd) {
        card.growCostAdd = Math.max(0, Number(card.growCostAdd ?? 0)) + costAdd;
        // ProduceCardGrowEffectType_CostAdd is the generic stamina-cost grow
        // effect. Specialized status costs have their own Cost*Add types.
        card.stamina = Math.max(0, Number(card.stamina ?? 0)) + costAdd;
      }
      matched += 1;
    }
  }

  if (!Array.isArray(event.grown)) event.grown = [];
  event.grown.push({
    searchId: parsed.searchId,
    growEffectIds: [...(parsed.growEffectIds ?? [])],
    blockAdd,
    costAdd,
    matched,
  });
  return matched;
}

export function useTowerDrink(state, drinkInput) {
  return traceSimulation(state, { type: "drink", id: drinkInput?.id ?? "", name: drinkInput?.name ?? drinkInput?.id ?? "" }, () => useTowerDrinkImpl(state, drinkInput));
}
function useTowerDrinkImpl(state, drinkInput) {
  if (!state || state.ended) throw new Error("試験が終了しています。");
  if (Number(state.turn ?? 0) <= 0) throw new Error("ターン開始後にドリンクを使用してください。");

  const drink = drinkInput && typeof drinkInput === "object" ? drinkInput : null;
  if (!drink || !String(drink.id ?? "")) throw new Error("使用するドリンクを選択してください。");
  if (drink.unresolved) throw new Error(`ドリンク ${drink.id} のマスタを解決できません。`);

  const event = nativeRuntimeEvent();
  event.drink = {
    id: String(drink.id),
    name: String(drink.name ?? drink.id),
  };
  event.randomStateBefore = state.randomState >>> 0;

  for (const effect of drink.effects ?? []) {
    if (effect?.unresolved) {
      rememberUnsupported(state, `drink-effect:${String(effect?.id ?? "")}`);
      event.effects.push(`未解決ドリンク効果: ${String(effect?.id ?? "")}`);
      continue;
    }
    if (effect?.examEffect) {
      executeParsedTowerEffect(state, parseExamEffectMaster(effect.examEffect), event);
      continue;
    }
    if (effect?.produceExamEffectId) {
      const master = state.examEffectById?.get?.(String(effect.produceExamEffectId));
      if (master) {
        executeParsedTowerEffect(state, parseExamEffectMaster(master), event);
        continue;
      }
      rememberUnsupported(state, `drink-exam-effect:${String(effect.produceExamEffectId)}`);
      event.effects.push(`未解決試験効果: ${String(effect.produceExamEffectId)}`);
    }
  }

  event.randomStateAfter = state.randomState >>> 0;
  const record = {
    ...event,
    effects: [...event.effects],
    drawn: event.drawn.map((card) => ({ ...card })),
    created: event.created.map((entry) => ({ ...entry, card: entry.card ? { ...entry.card } : entry.card })),
    moved: event.moved.map((entry) => ({ ...entry, card: entry.card ? { ...entry.card } : entry.card })),
    supportCardRolls: event.supportCardRolls.map((roll) => ({ ...roll })),
    recycleEvents: event.recycleEvents.map((entry) => ({ ...entry })),
  };
  state.currentTurnDrinks.push(record);
  state.drinkHistory.push({ turn: state.turn, ...record });
  return record;
}

export function playTowerCard(state, indexInput, options = {}) {
  const card = state.hand[Number(indexInput)];
  return traceSimulation(state, { type: "card", id: card?.id ?? "", name: card?.name ?? card?.id ?? "", card: historyCard(card) },
    () => withNativeEffectFrame(state, () => playTowerCardImpl(state, indexInput, options)));
}

function playTowerCardImpl(state, indexInput, { ignoreCost = false, forced = false } = {}) {
  const context = getExamEffectCalculateContext(state);
  const examParameter = context.ExamParameter;
  if (!context.HandList.length) throw new Error("使用する手札がありません。");
  if (!forced && Number(context.RemainCanPlayCardCount ?? 0) <= 0) throw new Error("このターンのカード使用回数が残っていません。");
  const index = Number(indexInput);
  if (!Number.isInteger(index) || index < 0 || index >= context.HandList.length) {
    throw new Error("使用するカード位置が不正です。");
  }
  const card = context.HandList[index];
  if (!forced && card.isRestrict) throw new Error(`${card.id}: このカードは使用できません。`);
  if (!forced && state.searchPlayCardLimits.some((row) => row.turn !== 0 && cardMatchesMasterSearch(card, resolvedMasterSearch(state, row.searchId)))) throw new Error(card.id + ": ギミックによりカードを使用できません。");
  if (!isSupportedSimpleMove(card.playMovePositionType)) {
    throw new Error(`${card.id}: 使用後移動先 ${card.playMovePositionType} は未対応です。`);
  }

  const event = {
    card: { ...card },
    cost: [],
    effects: [],
    drawn: [],
    created: [],
    moved: [],
    recycleEvents: [],
    onceOnly: Boolean(card.onceOnly),
    forced,
  };
  // Optional independent replay telemetry. Captures *simulated* values,
  // never copies observed native outcomes into the state machine.
  let priorStep = null;
  let priorEffectCount = 0;
  const recordCardPhase = (phase) => {
    if (!state.captureActionTelemetry) return;
    const exam = state.exam;
    const current = {
      score: Number(examParameter.JudgeParameter ?? 0),
      stamina: Number(examParameter.Stamina ?? 0),
      block: Number(examParameter.Block ?? 0),
      review: examParameter.StatusEffectCollection.GetReview(),
      aggressive: examParameter.StatusEffectCollection.GetAggressive(),
      staminaConsumptionDown: Number(exam.staminaConsumptionDown ?? 0),
      staminaConsumptionDownFix: Number(exam.staminaConsumptionDownFix ?? 0),
      playable: Number(context.RemainCanPlayCardCount ?? 0),
      lessonBuff: Number(exam.lessonBuff ?? 0),
      parameterBuff: Number(exam.parameterBuff ?? 0),
      parameterBuffMultiplePerTurn: Number(exam.parameterBuffMultiplePerTurn ?? 0),
      fullPowerPoint: Number(exam.fullPowerPoint ?? 0),
      enthusiastic: Number(exam.enthusiastic ?? 0),
      antiDebuffCount: Number(exam.antiDebuffCount ?? 0),
      reviewAdditivePermil: Number(exam.reviewAdditivePermil ?? 0),
      aggressiveAdditivePermil: Number(exam.aggressiveAdditivePermil ?? 0),
      lessonBuffAdditiveFix: Number(exam.lessonBuffAdditiveFix ?? 0),
      aggressiveAdditiveFix: Number(exam.aggressiveAdditiveFix ?? 0),
      lessonBuffMultiplePermil: Math.round((Number(exam.lessonBuffMultiple ?? 1) - 1) * 1000),
      reviewMultiplePermil: Math.round((Number(exam.reviewMultiple ?? 1) - 1) * 1000),
      searchCostCount: (state.searchCardCostChanges ?? []).reduce((sum, row) => sum + Math.max(0, Number(row.count ?? 0)), 0),
    };
    const changes = priorStep ? Object.fromEntries(
      Object.keys(current).map(key => [key, current[key] - priorStep[key]]),
    ) : null;
    event.actionTelemetry ??= [];
    event.actionTelemetry.push({
      phase, ...current, delta: changes,
      effects: (event.effects ?? []).slice(priorEffectCount),
    });
    priorStep = current;
    priorEffectCount = (event.effects ?? []).length;
  };
  recordCardPhase("before-card");
  // ExecuteCardCommandImpl @ 0x80a6520 prepares all effect conditions before
  // it executes any cost, play-trigger or main-effect commands.
  const plannedEffects = (card.playEffects ?? []).map((entry) => ({
    entry,
    trigger: checkRuntimeCardTrigger(state, entry.produceExamTriggerId, card, event),
  }));
  const cardTriggerAggressiveAtPlayStart = Number(state.exam.aggressive ?? 0);
  const cardTrigger = checkRuntimeCardTrigger(state, card.playProduceExamTriggerId, card, event);
  if (!cardTrigger.supported) {
    rememberUnsupported(state, `play-trigger:${card.playProduceExamTriggerId}`);
    event.effects.push(`カード使用条件は未対応: ${card.playProduceExamTriggerId}`);
  } else if (!forced && !cardTrigger.triggered) {
    throw new Error(`${card.id}: カード使用条件を満たしていません。`);
  }

  const beforeCostStatus = captureNativeStatusSnapshot(state.exam);
  const maxBeforeCost = Number(state.exam.maxStamina ?? 0);
  const beforeCardStaminaRatioPermil = maxBeforeCost > 0
    ? Math.trunc(Number(examParameter.Stamina ?? 0) * 1000 / maxBeforeCost) : 0;
  const beforeCost = {
    block: Number(examParameter.Block ?? 0),
    stamina: Number(examParameter.Stamina ?? 0),
    review: Number(state.exam.review ?? 0),
  };
  const costChange = (!card.costType || card.costType === "ExamCostType_Unknown")
    ? state.searchCardCostChanges.find((row) => row.count > 0 && cardMatchesMasterSearch(card, resolvedMasterSearch(state, row.searchId)))
    : null;
  if (!ignoreCost) event.cost.push(...payCardCost(state.exam, costChange ? { ...card, temporaryStaminaConsumptionFix: costChange.value } : card));
  if (!ignoreCost && costChange) costChange.count -= 1;
  recordCardPhase("after-cost");
  const previousPlayingCard = state.playingCard ?? null;
  const previousEffectOwnerCard = state.effectOwnerCard;
  const previousEffectSource = state.effectSource;
  const previousCardTriggerAggressiveAtPlayStart = state.cardTriggerAggressiveAtPlayStart;
  state.cardTriggerAggressiveAtPlayStart = cardTriggerAggressiveAtPlayStart;
  state.effectSource = "card";
  state.effectOwnerCard = null;
  state.playingCard = card;
  try {
    state.exam.blockConsumptionSum += Math.max(0, beforeCost.block - Number(examParameter.Block ?? 0));
    state.exam.staminaConsumptionSum += Math.max(0, beforeCost.stamina - Number(examParameter.Stamina ?? 0));
    state.exam.reviewConsumptionSum += Math.max(0, beforeCost.review - Number(state.exam.review ?? 0));
    emitNativeStatusDiff(
      state,
      beforeCostStatus,
      event,
      { cause: "cardCost", card },
    );

    recordSimulationEvent(state, { kind: "cardUse", card: historyCard(card), forced });
    context.HandList.splice(index, 1);
    if (!forced) {
      context.RemainCanPlayCardCount -= 1;
      // Native CardPlayCountAdd (0x7ff0638) consumes PlayableValueAdd first.
      // Only when no additional-play status exists does the card use end the
      // ordinary play. This timing matters for skip/turn-end carry-over.
      if (state.playableAddStatus) {
        state.playableAddStatus.count -= 1;
        if (state.playableAddStatus.count <= 0) state.playableAddStatus = null;
      }
      state.normalPlayUsed = true;
    }
    const cardPlayCount = Number(examParameter.ExamCardPlayCount ?? 0) + 1;
    const previouslyPlayed = Number(card.playCount ?? 0) > 0;
    card.playCount = Number(card.playCount ?? 0) + 1;
    if (card._supportBaseSnapshot) card._supportBaseSnapshot.playCount = card.playCount;
    // A forced use still records playback and moves the card, but an
    // unplayable card does not execute its main effects or spend repeat buffs.
    // Reuse the eligibility snapshot taken before costs and play triggers.
    const canExecuteCardEffects = !card.isRestrict && cardTrigger.supported && cardTrigger.triggered;
    runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.CARD_PLAY, event, { card, cardPlayCount, beforeCardStaminaRatioPermil });
    recordCardPhase("before-main-card-effects-after-card-play-triggers");
    const repeatBuff = state.cardEffectPlayCountBuff;
    const repeatMatches = Boolean(
      canExecuteCardEffects
      && repeatBuff
      && Number(repeatBuff.count ?? 0) > 0
      && (resolvedMasterSearch(state, repeatBuff.searchId)
        ? cardMatchesMasterSearch(card, resolvedMasterSearch(state, repeatBuff.searchId))
        : cardMatchesSearchId(card, repeatBuff.searchId)),
    );
    const repeat = repeatMatches
      ? Math.max(0, Math.trunc(Number(repeatBuff.value ?? 0)))
      : 0;
    if (repeatMatches) {
      repeatBuff.count -= 1;
      if (repeatBuff.count <= 0) state.cardEffectPlayCountBuff = null;
    }
    for (let n = 0; canExecuteCardEffects && n <= repeat; n += 1) {
      for (const { entry, trigger } of plannedEffects) {
        // ExecuteCardCommandImpl tests the card's prior play count for the
        // first execution; repeat-buff executions keep native effect behavior.
        if (n === 0 && previouslyPlayed && entry.isOncePlayEffect) continue;
        applyCardEffectEntry(state, entry, event, card, trigger);
        recordCardPhase("card-effect-"+n+"-"+String(entry.produceExamEffectId ?? entry.id ?? "unknown"));
      }
    }
    // Passive native card-use completion is observed before the deferred
    // after-card phase commands run. Preserve this boundary separately;
    // those commands still run normally and affect subsequent native actions.
    recordCardPhase("after-main-card-effects-before-after-card-play-triggers");
    // PlayCardCountIncrement @ 0x8092358 runs from UseCardAfterCheck
    // (@ 0x80dcb20), after the main effects, including forced uses.
    examParameter.ExamCardPlayCount += 1;
    examParameter.TurnCardPlayCount = Number(examParameter.TurnCardPlayCount ?? state.currentTurnPlays.length) + 1;
    state.exam.playCardCountSum += 1;
    state.playTurnCountSum += Math.max(1, Number(state.turn ?? 1));
    // Native ExamBuffConsume recovery is an after-completion consequence of
    // spending a buff for card cost. It does not affect the card's own score
    // or the passive card-use-complete snapshot.
    const deferredBuffConsumes = event.__deferredBuffConsumes ?? [];
    delete event.__deferredBuffConsumes;
    for (const statusChange of deferredBuffConsumes) {
      withNativeTransition(event, () => dispatchNativeEffectPhase(
        state.effectScheduler,
        NATIVE_EFFECT_PHASE.STATUS_DECREASED,
        { state, exam: state.exam, event, card,
          lessonType: currentNativeLessonType(state),
          statusChange, cause: "cardCostDeferred", deferredBuffConsume: true },
        nativeSchedulerHooks(state, event),
      ));
    }
    runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY, event, { card, cardPlayCount });
    recordCardPhase("after-card-play-triggers");
    recordCardPhase("after-card-resolution");

    // Flush only this playing card's deferred growth. A nested/forced play
    // may have its own in-flight card, so never consume that card's queue.
    const deferred = state._deferredPlayingCardGrows ?? [];
    state._deferredPlayingCardGrows = deferred.filter(entry => entry.card !== card);
    for (const entry of deferred) {
      if (entry.card === card) applyPersistentRuntimeCardGrowEffects(entry.card, entry.grows);
    }

    if (![context.HandList, context.DeckList, context.GraveList, context.LostList, context.HoldList].some((pool) => pool.includes(card))) {
      addRuntimeCardAt(state, card, card.onceOnly ? "Lost" : "Grave", event, "playing");
    }
    state.currentTurnPlays.push(event);
    state.lastPlayedCard = { id: card.id, token: card.token, category: card.category };
    return event;
  } finally {
    // A failed card action must not leak deferred effects into a later play.
    if (state._deferredPlayingCardGrows?.length) {
      state._deferredPlayingCardGrows = state._deferredPlayingCardGrows.filter(entry => entry.card !== card);
    }
    state.playingCard = previousPlayingCard;
    state.cardTriggerAggressiveAtPlayStart = previousCardTriggerAggressiveAtPlayStart;
    state.effectOwnerCard = previousEffectOwnerCard;
    if (previousEffectSource === undefined) delete state.effectSource;
    else state.effectSource = previousEffectSource;
  }
}

function tickTurnDurations(exam) {
  // Review spending occurs at the next turn start, after its previous
  // StartPlay flag is set. Only the other timed statuses spend here.
  const parameterBuffLocked = Number(exam.parameterBuffTurnEndReduceLock ?? 0) !== 0;

  const passed = field => exam.passingTurnStartFields?.[field] !== false;
  if (!parameterBuffLocked && passed("parameterBuff") && Number(exam.parameterBuff ?? 0) > 0) exam.parameterBuff -= 1;

  for (const field of ["parameterBuffMultiplePerTurn", "staminaConsumptionDown", "staminaConsumptionAdd"]) {
    if (passed(field) && Number(exam[field] ?? 0) > 0) exam[field] -= 1;
  }
  for (const field of [
    "stanceLock",
    "stanceLockConcentration",
    "stanceLockFullPower",
    "stanceLockPreservation",
  ]) {
    if (passed(field) && Number(exam[field] ?? 0) > 0) exam[field] -= 1;
  }

  // LessonParameterMultiple/Down, ReviewMultiple/CountAdd, Pride, and the
  // turn-end locks all inherit the common finite-turn status lifetime.
  tickNativeScoreTimedStatuses(exam);
}

function tickCardEffectPlayCountBuff(state) {
  const buff = state.cardEffectPlayCountBuff;
  if (!buff || Number(buff.turn) < 0 || buff.isPassingTurnStart === false) return;
  buff.turn = Math.max(0, Number(buff.turn ?? 0) - 1);
  if (buff.turn <= 0) state.cardEffectPlayCountBuff = null;
}

function takeExpiredTimers(state) {
  const expired = [];
  for (const timer of state.timers) {
    timer.turn -= 1;
    if (timer.turn <= 0) expired.push(timer);
  }
  state.timers = state.timers.filter((timer) => !expired.includes(timer));
  return expired;
}

export function finishTowerTurn(state, action = { type: "skip" }) {
  const result = traceSimulation(state, { type: "system", id: "turnEnd", name: "ターン終了" }, () => finishTowerTurnImpl(state, action));
  endSimulationTurn(state);
  return result;
}
function finishTowerTurnImpl(state, action = { type: "skip" }) {
  const context = getExamEffectCalculateContext(state);
  const examParameter = context.ExamParameter;
  const type = String(action?.type ?? "skip");
  let compatibilityUse = null;
  if (type === "use") compatibilityUse = playTowerCard(state, action?.index);
  else if (type !== "skip" && type !== "end") throw new Error(`未知のターン操作です: ${type}`);

  if (!state.turnOpen && !context.HandList.length && !state.currentTurnPlays.length) throw new Error("終了するターンがありません。");
  const recoverStaminaAtTurnEnd = type === "skip" && Number(context.RemainCanPlayCardCount ?? 0) > 0;
  const remainingHand = context.HandList.map((card) => ({ ...card }));
  // Native ResetHand (0x8237750) snapshots Hand and walks index 0 -> Count-1.
  // IsEndTurnLost cards are batched to Lost; all other remaining cards are
  // batched to Grave. Each destination preserves the original Hand order.
  const resetCards = context.HandList.splice(0);
  const resetEvent = nativeRuntimeEvent();
  for (const card of resetCards) {
    if (card.isEndTurnLost) context.LostList.push(card);
    else context.GraveList.push(card);
  }
  for (const card of resetCards) notifyRuntimeCardMove(state, card, "hand", card.isEndTurnLost ? "lost" : "grave", resetEvent);

  const drinks = (state.currentTurnDrinks ?? []).map((drink) => ({
    ...drink,
    drink: { ...(drink.drink ?? {}) },
    effects: [...(drink.effects ?? [])],
    drawn: (drink.drawn ?? []).map((card) => ({ ...card })),
    supportCardRolls: (drink.supportCardRolls ?? []).map((roll) => ({ ...roll })),
  }));
  const plays = state.currentTurnPlays.map((play) => ({
    ...play,
    card: { ...play.card },
    drawn: play.drawn.map((card) => ({ ...card })),
    created: (play.created ?? []).map((entry) => ({
      ...entry,
      card: { ...entry.card },
    })),
    moved: (play.moved ?? []).map((entry) => ({
      ...entry,
      card: { ...entry.card },
    })),
  }));
  const used = plays[0]?.card ?? compatibilityUse?.card ?? null;
  if (!plays.length) state.lastPlayedCard = null;
  const onceOnly = Boolean(plays[0]?.onceOnly);
  const entry = {
    turn: state.turn,
    scoreContext: currentTowerScoreContext(state),
    parameterBefore: Number(state.turnStartParameter ?? 0),
    hand: remainingHand,
    action: plays.length ? "use" : "skip",
    used,
    onceOnly,
    plays,
    drinks,
    turnStartEffects: [...(state.turnStartEffects ?? [])],
    turnStartSupportCardRolls: (state.turnStartSupportCardRolls ?? []).map((roll) => ({ ...roll })),
    deckCount: context.DeckList.length,
    discardCount: context.GraveList.length,
    lostCount: context.LostList.length,
    recycleCount: state.recycleCount,
    exam: cloneTowerStateValue(state.exam),
  };
  state.history.push(entry);
  const turnEndEvent = resetEvent;

  if (recoverStaminaAtTurnEnd && !state.exam.staminaRecoverRestriction) {
    const recovery = Math.max(0, Math.trunc(getExamRuntimeSetting(state.exam, "examTurnEndRecoveryStamina")))
      + Math.max(0, Math.trunc(Number(state.exam.staminaRecoverAdd ?? 0)));
    const before = Number(state.exam.stamina ?? 0);
    const maxStamina = Math.max(0, Number(state.exam.maxStamina ?? 0));
    state.exam.stamina = maxStamina > 0
      ? Math.min(maxStamina, before + recovery)
      : before + recovery;
    const recovered = state.exam.stamina - before;
    if (recovered > 0) turnEndEvent.effects.push(`ターンスキップ: 体力 +${recovered}`);
  }

  // ExamSequence turn-end path (native state machine around 0x8096850)
  // materializes Review as a Lesson effect before Review spends one turn.
  const reviewScore = traceSimulation(state, { type: "enchant", id: "review", name: "好印象" }, () => applyNativeReviewTurnEnd(state.exam, currentTowerScoreContext(state)));
  if (reviewScore.added > 0) {
    turnEndEvent.effects.push(
      `好印象ターン終了スコア +${reviewScore.added}`
      + (reviewScore.count > 1 ? `（${reviewScore.count}回）` : ""),
    );
  }

  runNativeEffectPhase(
    state,
    NATIVE_EFFECT_PHASE.END_TURN,
    turnEndEvent,
    { action: recoverStaminaAtTurnEnd ? "skip" : "end", used },
  );
  if (turnEndEvent.effects.length) entry.turnEndEffects = turnEndEvent.effects;

  const beforeTurnSpendStatus = captureNativeStatusSnapshot(state.exam);
  tickTurnDurations(state.exam);
  emitNativeStatusDiff(
    state,
    beforeTurnSpendStatus,
    turnEndEvent,
    { cause: "turnEndSpend", action: type, used },
  );
  tickCardEffectPlayCountBuff(state);
  if (state.playableAddStatus?.isPassingTurnStart) state.playableAddStatus = null;
  state.searchPlayCardLimits = state.searchPlayCardLimits.map((row) => ({ ...row, turn: row.turn < 0 ? -1 : row.turn - 1 })).filter((row) => row.turn !== 0);
  state.searchCardCostChanges = state.searchCardCostChanges.map((row) => ({ ...row, turn: row.turn < 0 ? -1 : row.turn - 1 })).filter((row) => row.turn !== 0 && row.count > 0);
  tickNativeEffectSchedulerTurn(state.effectScheduler, { turn: state.turn, respectTurnStart: true });
  entry.examAfterTurnEnd = cloneTowerStateValue(state.exam);
  entry.parameterAfter = Number(examParameter.JudgeParameter);
  entry.parameterDelta = entry.parameterAfter - entry.parameterBefore;
  state.currentTurnPlays = [];
  state.currentTurnDrinks = [];
  state.turnStartSupportCardRolls = [];
  context.RemainCanPlayCardCount = 0;
  state.turnOpen = false;

  // Only turn-scoped support bonuses are reverted here. ExamCardUpgrade
  // persists in ExamCardData._tmpUpgradeCount through the current exam.
  clearSupportCardUpgrades(state);
  for (const card of [...context.DeckList, ...context.HandList, ...context.GraveList, ...context.LostList, ...context.HoldList]) delete card.temporaryStaminaConsumptionFix;
  return entry;
}
