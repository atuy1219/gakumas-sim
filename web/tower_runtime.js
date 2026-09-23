import { XorShift32, normalizeProduceCard, parseSeed } from "./engine.js";
import {
  addNativeGenericTimedStatus,
  applyParsedExamEffect,
  calculateNativeBlockAdd,
  calculateNativeStaminaDamage,
  checkCardEffectTrigger,
  createExamState,
  getExamRuntimeSetting,
  parseExamEffectId,
  parseExamEffectMaster,
  payCardCost,
  tickNativeScoreTimedStatuses,
  trySetExamStance,
} from "./exam_effects.js";
import {
  EXAM_IDOL_STATUS_TYPE,
  applyNativeReviewTurnEnd,
  calculateNativeDependentLessonBase,
} from "./exam_score.js";
import {
  applyCardCustomizations,
  applyCardGrowEffectsToParsedEffect,
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
      originalIndex: index,
      playMovePositionType,
      category: String(master.category ?? card.category ?? ""),
      rarity: String(master.rarity ?? card.rarity ?? ""),
      planType: String(master.planType ?? card.planType ?? ""),
      searchTag: String(master.searchTag ?? card.searchTag ?? ""),
      effectGroupIds: Array.isArray(master.effectGroupIds) ? [...master.effectGroupIds] : [],
      stamina: Number(master.stamina ?? 0) || 0,
      forceStamina: Number(master.forceStamina ?? 0) || 0,
      costType: String(master.costType ?? "ExamCostType_Unknown"),
      costValue: Number(master.costValue ?? 0) || 0,
      playProduceExamTriggerId: String(master.playProduceExamTriggerId ?? ""),
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
  let value = min;
  if (max > min) value = rng.nextInt(min, max);
  else rng.nextU32(); // Native GetRandomInt still advances XorShift when width == 0.
  state.randomState = rng.state >>> 0;
  return value;
}

function consumeNativeRandomSortKey(state) {
  // ExamParameterModel.GetRandomInt() @ 0x8043A80 returns the current
  // XorShift word with the sign bit flipped, then advances the state.
  // When that Int32 is sorted ascending, its order is exactly the unsigned
  // order of the pre-advance XorShift word.
  const key = Number(state.randomState) >>> 0;
  const rng = new XorShift32(key);
  rng.nextU32();
  state.randomState = rng.state >>> 0;
  return key;
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
    playEffects: Array.isArray(master.playEffects) ? master.playEffects.map((effect) => ({ ...effect })) : [],
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
    case "grave": return "捨て札";
    case "deck_grave": return "山札・捨て札";
    case "deck_first": return "山札の先頭";
    case "deck_last": return "山札の末尾";
    case "deck_random": return "山札のランダム位置";
    case "hand": return "手札";
    case "lost": return "除外";
    case "hold": return "保留";
    default: return String(positionInput ?? "");
  }
}

function runtimeEnchantName(state, enchantIdInput) {
  const enchantId = String(enchantIdInput ?? "");
  const cardId = [...(state.cardById?.keys?.() ?? [])]
    .sort((a, b) => String(b).length - String(a).length)
    .find((id) => enchantId.includes(String(id)));
  if (!cardId) return "継続効果";
  return `${runtimeCardName(state, cardId)}の継続効果`;
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

    switch (String(parsed.movePosition ?? "")) {
      case "deck_first":
        state.deck.unshift(card);
        created.insertIndex = 0;
        break;
      case "deck_last":
        created.insertIndex = state.deck.length;
        state.deck.push(card);
        break;
      case "deck_random": {
        // Native AddCardImpl (0x823A49C) calls GetRandomInt(0, Deck.Count)
        // through <AddCardImpl>b__0 (0x823BAD4). The upper bound is exclusive.
        // Count == 0 still consumes one XorShift state and resolves to index 0.
        const insertIndex = consumeNativeRandomInt(state, 0, state.deck.length);
        state.deck.splice(insertIndex, 0, card);
        created.insertIndex = insertIndex;
        created.randomStateAfter = state.randomState >>> 0;
        break;
      }
      case "grave":
        state.discard.push(card);
        break;
      case "lost":
        state.lost.push(card);
        break;
      case "hold":
        state.hold.push(card);
        break;
      case "hand":
        if (state.hand.length < normalizeHandLimit(state.handLimit)) state.hand.push(card);
        else state.deck.unshift(card);
        break;
      default:
        rememberUnsupported(state, `card-create-position:${parsed.movePosition}`);
        event.effects.push(`未対応の生成位置: ${parsed.movePosition}`);
        return;
    }
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

  // Native path:
  // ExamEffectUtility.PickCardPositionListImpl @ 0x7FE99E8
  //   1) GetPickCountMinMax
  //   2) GetRandomInt(min, max + 1) @ 0x7FEA0C8 -- ALWAYS consumes one
  //      XorShift word, even for a fixed 1_1 count.
  //   3) ProducePickRangeType_Random orders every candidate by a random Int32.
  //      <PickCardPositionListImpl>b__3 @ 0x7FFE17C calls
  //      ExamEffectCalculateContext.GetRandomInt() once PER candidate.
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
  const explicitInitialRandomState = Number(options.initialRandomState);
  let initialRandomState;
  let initialRandomStateSource;
  if (Number.isInteger(explicitInitialRandomState) && explicitInitialRandomState >= 0 && explicitInitialRandomState <= 0xffffffff) {
    initialRandomState = explicitInitialRandomState >>> 0;
    initialRandomStateSource = String(options.initialRandomStateSource ?? "exact");
  } else {
    const preShuffleRng = new XorShift32(seed);
    for (let index = 0; index < preShuffleAdvanceSteps; index += 1) preShuffleRng.nextU32();
    initialRandomState = preShuffleRng.state >>> 0;
    initialRandomStateSource = "derived";
  }

  // Native ExamCardPoolModel.Shuffle does not filter IsInitial. The whole Deck
  // is shuffled first; SetInitialCard later extracts opening-hand cards.
  const shuffled = shuffleObjectsWithState(instances, initialRandomState);
  const exam = {
    ...createExamState({ stamina: options.stamina }),
    targetScore: Math.max(0, Number(options.targetScore ?? 0)),
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
    lastRecycle: null,
    openingResolved: false,
    openingDrawCount,
    handLimit,
    holdLimit,
    turnParameterTypes: Array.isArray(options.turnParameterTypes)
      ? options.turnParameterTypes.map(String)
      : [],
    turnLimit: Number.isFinite(Number(options.turnLimit)) ? Math.max(0, Math.trunc(Number(options.turnLimit))) : null,
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
    cardEffectPlayCountBuff: null,
    cardById: cardById ?? new Map(),
    cardVariantByKey: options.cardVariantByKey ?? new Map(),
    examEffectById: options.examEffectById ?? new Map(),
    examStatusEnchantById: options.examStatusEnchantById ?? new Map(),
    examTriggerById: options.examTriggerById ?? new Map(),
    cardSearchById: options.cardSearchById ?? new Map(),
    cardRandomPoolById: options.cardRandomPoolById ?? new Map(),
    generatedCardSerial: 0,
    pItems: Array.isArray(options.pItems) ? options.pItems.map((item) => ({ ...item })) : [],
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
  const current = masterFieldStatusValue(state, fieldStatusType);
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

function nativeSchedulerHooks(state, runtimeEvent) {
  return {
    evaluateCondition(condition, context) {
      if (condition?.kind === "masterExamTrigger") {
        return matchesMasterExamTrigger(state, condition, context, runtimeEvent);
      }
      return undefined;
    },
    executeEffect(effect) {
      if (effect?.kind === "nativeGimmickRow") {
        if (!gimmickRowConditionMatches(state, effect.row)) return;
        executeParsedTowerEffect(state, schedulerParsedEffect(effect.effect), runtimeEvent);
        return;
      }
      executeParsedTowerEffect(state, schedulerParsedEffect(effect), runtimeEvent);
    },
    afterRegistration(registration) {
      const activationKey = String(registration.metadata?.activationKey ?? "");
      if (activationKey) {
        if (!runtimeEvent.__nativeEffectFired) runtimeEvent.__nativeEffectFired = new Set();
        runtimeEvent.__nativeEffectFired.add(activationKey);
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
  return parameterType ? `ProduceStepLessonType_${parameterType}Lesson` : "ProduceStepLessonType_Unknown";
}

function runNativeEffectPhase(state, phase, runtimeEvent, extra = {}) {
  return dispatchNativeEffectPhase(
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
  );
}

function emitNativeStatusDiff(state, before, runtimeEvent, extra = {}) {
  return dispatchNativeStatusDiff(
    state.effectScheduler,
    before,
    captureNativeStatusSnapshot(state.exam),
    {
      state,
      exam: state.exam,
      event: runtimeEvent,
      lessonType: currentNativeLessonType(state),
      ...extra,
    },
    nativeSchedulerHooks(state, runtimeEvent),
  );
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
  ProduceExamPhaseType_StartPlay: NATIVE_EFFECT_PHASE.BEFORE_START_OF_TURN,
  ProduceExamPhaseType_StartExamPlay: NATIVE_EFFECT_PHASE.BEFORE_START_OF_TURN,
  ProduceExamPhaseType_ExamStartExam: NATIVE_EFFECT_PHASE.BEFORE_START_OF_TURN,
  ProduceExamPhaseType_ExamStartTurn: NATIVE_EFFECT_PHASE.START_OF_TURN,
  ProduceExamPhaseType_ExamCardDraw: NATIVE_EFFECT_PHASE.AFTER_START_OF_TURN,
  ProduceExamPhaseType_ExamCardPlay: NATIVE_EFFECT_PHASE.CARD_PLAY,
  ProduceExamPhaseType_ExamCardPlayAfter: NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY,
  ProduceExamPhaseType_ExamEndTurn: NATIVE_EFFECT_PHASE.END_TURN,
  ProduceExamPhaseType_ExamTurnCheck: NATIVE_EFFECT_PHASE.BEFORE_START_OF_TURN,
  ProduceExamPhaseType_ExamTurnTimer: NATIVE_EFFECT_PHASE.START_OF_TURN,
  ProduceExamPhaseType_ExamTurnInterval: NATIVE_EFFECT_PHASE.START_OF_TURN,
  ProduceExamPhaseType_ExamPlayCountInterval: NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY,
  ProduceExamPhaseType_ExamPlayCountIntervalAfter: NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY,
  ProduceExamPhaseType_ExamTurnSkip: NATIVE_EFFECT_PHASE.END_TURN,
  ProduceExamPhaseType_ExamEndTurnInterval: NATIVE_EFFECT_PHASE.END_TURN,
  ProduceExamPhaseType_ExamPlayTurnCountInterval: NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY,
  ProduceExamPhaseType_ExamBuffConsume: NATIVE_EFFECT_PHASE.STATUS_DECREASED,
  ProduceExamPhaseType_ExamStaminaReduce: NATIVE_EFFECT_PHASE.STATUS_DECREASED,
  ProduceExamPhaseType_ExamStaminaReduceCard: NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY,
  ProduceExamPhaseType_ExamAggressiveUpInterval: NATIVE_EFFECT_PHASE.STATUS_INCREASED,
  ProduceExamPhaseType_ExamStanceChangeConcentration: NATIVE_EFFECT_PHASE.STATUS_INCREASED,
  ProduceExamPhaseType_ExamStanceChangeFullPower: NATIVE_EFFECT_PHASE.STATUS_INCREASED,
  ProduceExamPhaseType_ExamStanceChangeFromFullPower: NATIVE_EFFECT_PHASE.STATUS_DECREASED,
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
  ProduceExamFieldStatusType_CardSearchCountUp: "cardSearchCount",
  ProduceExamFieldStatusType_PlayCardLesson: "playCardLesson",
});

function masterFieldStatusValue(state, fieldStatusType) {
  switch (MASTER_FIELD_STATUS_TO_EXAM[String(fieldStatusType ?? "")]) {
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
      return Math.max(0, Number(state.turnLimit ?? state.turn ?? 0) - Number(state.turn ?? 0));
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
      return Array.isArray(state.currentTurnPlays) ? state.currentTurnPlays.length : 0;
    case undefined:
      return null;
    default:
      return Number(state.exam[MASTER_FIELD_STATUS_TO_EXAM[String(fieldStatusType ?? "")]] ?? 0);
  }
}

function cardMatchesMasterSearch(card, search) {
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
  if (tag && tag !== String(card.searchTag ?? "")) return false;
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
  const expectedCore = expected.replace(/^ProduceStepLessonType_/, "").replace(/Lesson$/, "");
  const actualCore = actual.replace(/^ProduceStepLessonType_/, "").replace(/Lesson$/, "");
  return expectedCore === actualCore;
}

function masterPhaseValue(state, phaseType, context) {
  switch (String(phaseType ?? "")) {
    case "ProduceExamPhaseType_ExamStartExam":
      return Number(state.turn ?? 0) === 0 ? 1 : 0;
    case "ProduceExamPhaseType_ExamTurnCheck":
      return Number(context.nextTurn ?? state.turn ?? 0) + (context.nextTurn === undefined ? 1 : 0);
    case "ProduceExamPhaseType_ExamPlayCountInterval":
    case "ProduceExamPhaseType_ExamPlayCountIntervalAfter":
      return Number(state.exam.cardPlayCount ?? 0);
    case "ProduceExamPhaseType_ExamCardDraw":
      return Number(context.event?.drawn?.length ?? 0);
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
    } else if (type === "ProduceExamFieldStatusType_PlayCardLesson") {
      current = String(context.effectType ?? "").includes("Lesson") ? 1 : 0;
    } else {
      current = masterFieldStatusValue(state, type);
    }
    if (current === null) return false;
    const expected = Number(values[index] ?? 1);
    const check = String(checks[index] ?? "ProduceExamTriggerCheckType_Unknown");
    const reverse = type === "ProduceExamFieldStatusType_StaminaLessMultiple"
      || type.endsWith("MultipleDown");
    const positiveMatch = reverse ? current <= expected : current >= expected;
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

function matchesMasterExamTrigger(state, condition, context, runtimeEvent) {
  const trigger = condition.trigger ?? {};
  const activationKey = String(condition.activationKey ?? "");
  if (activationKey && runtimeEvent.__nativeEffectFired?.has?.(activationKey)) return false;
  if (condition.phaseType === "ProduceExamPhaseType_ExamStartExam" && Number(state.turn ?? 0) !== 0) return false;
  if (condition.phaseType === "ProduceExamPhaseType_StartExamPlay" && Number(state.turn ?? 0) !== 0) return false;
  if (condition.phaseType === "ProduceExamPhaseType_ExamTurnSkip" && String(context.action ?? "") !== "skip") return false;

  const phaseValues = (trigger.phaseValues ?? []).map(Number).filter(Number.isFinite);
  if (phaseValues.length && !phaseValues.includes(masterPhaseValue(state, condition.phaseType, context))) return false;
  if (!triggerFieldStatusesMatch(state, trigger, context)) return false;
  if (!lessonTypeMatches(trigger.lessonType, context.lessonType)) return false;
  if (!triggerSearchMatches(state, trigger, context)) return false;

  const effectTypes = new Set((trigger.effectTypes ?? []).map(String).filter(Boolean));
  if (effectTypes.size) {
    const actualEffectType = String(
      context.effectType
      ?? parsedMasterEffectType(context.parsedEffect)
      ?? "",
    );
    if (!effectTypes.has(actualEffectType)) return false;
  }
  return true;
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
      condition: {
        field: "state.turn",
        op: "eq",
        value: startTurn,
      },
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

  const installedCardPlayCount = Number(state.exam.cardPlayCount ?? 0);
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
  };
}

function applyRuntimeUpgradeVariant(state, card, targetUpgradeCount) {
  const target = Math.max(0, Math.trunc(Number(targetUpgradeCount) || 0));
  const master = state.cardVariantByKey?.get?.(`${card.id}@@${target}`) ?? {};
  const identity = {
    token: card.token,
    originalIndex: card.originalIndex,
    generated: card.generated,
    growBlockAdd: card.growBlockAdd,
    growCostAdd: card.growCostAdd,
  };
  Object.assign(card, master, identity, { upgradeCount: target });
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

function applyPermanentCardUpgradeInPlace(state, card) {
  const supportCount = Math.max(0, Math.trunc(Number(card?._supportUpgradeCount ?? 0)));
  if (!card?._supportBaseSnapshot || supportCount <= 0) {
    return applyRuntimeUpgradeVariant(state, card, Number(card?.upgradeCount ?? 0) + 1);
  }

  const base = cloneRuntimeCardSnapshot(card._supportBaseSnapshot);
  const nextBaseCount = Math.max(0, Number(base.upgradeCount ?? 0)) + 1;
  const baseMaster = state.cardVariantByKey?.get?.(`${card.id}@@${nextBaseCount}`) ?? {};
  const nextBase = {
    ...base,
    ...baseMaster,
    token: base.token,
    originalIndex: base.originalIndex,
    generated: base.generated,
    growBlockAdd: base.growBlockAdd,
    growCostAdd: base.growCostAdd,
    upgradeCount: nextBaseCount,
  };
  card._supportBaseSnapshot = cloneRuntimeCardSnapshot(nextBase);

  Object.assign(card, cloneRuntimeCardSnapshot(nextBase));
  card._supportBaseSnapshot = cloneRuntimeCardSnapshot(nextBase);
  card._supportUpgradeCount = supportCount;
  return applyRuntimeUpgradeVariant(state, card, nextBaseCount + supportCount);
}

function clearSupportCardUpgrades(state) {
  const seen = new Set();
  for (const pool of [state.hand, state.deck, state.discard, state.lost, state.hold]) {
    for (const card of pool ?? []) {
      if (!card || seen.has(card)) continue;
      seen.add(card);
      if (!card._supportBaseSnapshot) continue;
      const base = cloneRuntimeCardSnapshot(card._supportBaseSnapshot);
      for (const key of Object.keys(card)) delete card[key];
      Object.assign(card, base);
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

function drawCardsIntoHand(state, count) {
  const recycleEvents = [];
  const drawn = [];
  const capacity = normalizeHandLimit(state.handLimit);
  for (let i = 0; i < count; i += 1) {
    if (state.hand.length >= capacity) break;
    if (!state.deck.length) {
      const event = recycleIfNeeded(state);
      if (event) recycleEvents.push(event);
    }
    if (!state.deck.length) break;
    const card = state.deck.shift();
    state.hand.push(card);
    drawn.push(card);
  }
  return { drawn, recycleEvents };
}

function setNativeInitialCard(state, drawCount) {
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
    ? drawCardsIntoHand(state, Math.min(remaining, Math.max(0, capacity - state.hand.length)))
    : { drawn: [], recycleEvents: [] };
  state.openingResolved = true;
  return {
    drawn: [...moved, ...ordinary.drawn],
    recycleEvents: ordinary.recycleEvents,
  };
}

export function drawTowerTurn(state, drawCount = 3) {
  const count = Number(drawCount);
  if (!Number.isInteger(count) || count < 1) throw new Error("1ターンのドロー枚数が不正です。");
  if (state.hand.length) throw new Error("現在の手札を処理してから次ターンへ進んでください。");

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

  state.ended = false;
  const phaseEvent = nativeRuntimeEvent();
  runNativeEffectPhase(
    state,
    NATIVE_EFFECT_PHASE.BEFORE_START_OF_TURN,
    phaseEvent,
    { nextTurn: Number(state.turn ?? 0) + 1 },
  );

  const isOpeningTurn = state.turn === 0 && !state.openingResolved;
  state.turn += 1;
  state.playsRemaining = 1;
  state.currentTurnPlays = [];
  state.currentTurnDrinks = [];
  state.turnUseSupportCardIds = new Set();

  // EffectTimer counts completed turn boundaries and fires when the delayed
  // turn actually starts. A 1-turn timer created on Turn 1 therefore resolves
  // here on Turn 2, before that turn's ordinary StartOfTurn effects and draw.
  tickTimers(state, phaseEvent);
  runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.START_OF_TURN, phaseEvent);

  const extraDraw = Math.max(0, Number(state.pendingDraw ?? 0));
  state.pendingDraw = 0;
  const requested = Math.max(0, count + extraDraw - Math.max(0, Number(state.exam.startTurnCardDrawDown ?? 0)));
  const result = isOpeningTurn
    ? setNativeInitialCard(state, requested)
    : drawCardsIntoHand(state, requested);
  applyExamSupportCardUpgrades(state, result.drawn, phaseEvent);
  state.turnStartSupportCardRolls = (phaseEvent.supportCardRolls ?? []).map((roll) => ({ ...roll }));
  if (Number(state.pendingHandUpgradeAll ?? 0) > 0) {
    upgradeHandCards(state);
    state.pendingHandUpgradeAll = 0;
  }
  runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.AFTER_START_OF_TURN, phaseEvent);
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
  for (const card of state.hand) applyPermanentCardUpgradeInPlace(state, card);
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
  let min = Math.max(0, Math.trunc(Number(parsed.pickCountMin ?? 0)));
  let max = Math.max(min, Math.trunc(Number(parsed.pickCountMax ?? min)));
  const range = String(parsed.pickRangeType ?? "");
  if (range.endsWith("_All") && min === 0 && max === 0) {
    return available;
  }
  max = Math.min(max, Math.max(0, Number(available) || 0));
  min = Math.min(min, max);
  if (range.endsWith("_Select")) return max;

  // Native ExamEffectUtility.PickCardPositionListImpl calls
  // GetRandomInt(min, max + 1) before the range-specific selection. This call
  // is present even for a fixed 1_1 Random pick, so width==1 must still advance
  // the shared Exam XorShift state.
  if (range.endsWith("_Random")) {
    return consumeNativeRandomInt(state, min, max + 1);
  }

  if (max === min) return min;
  return consumeNativeRandomInt(state, min, max + 1);
}

function randomPoolRowsForSearch(state, search) {
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

function pickedMasterCards(state, parsed, context = {}) {
  const search = resolvedMasterSearch(state, parsed.searchId);
  const candidates = cardsForMasterSearch(state, search, context)
    .filter((card) => cardMatchesMasterSearch(card, search));
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

function addRuntimeCardAt(state, card, movePositionType) {
  const move = String(movePositionType ?? "").replace(/^ProduceCardMovePositionType_/, "");
  switch (move) {
    case "Hand":
      if (state.hand.length < normalizeHandLimit(state.handLimit)) state.hand.push(card);
      else state.deck.unshift(card);
      return "hand";
    case "DeckFirst": state.deck.unshift(card); return "deck_first";
    case "DeckLast": state.deck.push(card); return "deck_last";
    case "DeckRandom": {
      const index = consumeNativeRandomInt(state, 0, state.deck.length + 1);
      state.deck.splice(index, 0, card);
      return "deck_random";
    }
    case "Grave": state.discard.push(card); return "grave";
    case "Lost": state.lost.push(card); return "lost";
    case "Hold": state.hold.push(card); return "hold";
    default: state.discard.push(card); return "grave";
  }
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
        turn: Number(parsed.turn) > 0 ? Number(parsed.turn) : null,
        count: Number(parsed.count) > 0 ? Number(parsed.count) : null,
        condition: {
          kind: "masterExamTrigger",
          phaseType: String(phaseType),
          trigger: enchant.trigger,
        },
        effects: enchant.examEffects,
        metadata: { enchantId: enchant.id, triggerId: enchant.trigger.id },
      });
    }
  }
  return specs.length
    ? registerNativeEnchantEffects(state.effectScheduler, enchant.id, specs)
    : null;
}

function executeMasterChain(state, parsed, event, repeat = 1) {
  const ids = [parsed.chainEffectId, ...(parsed.chainEffectIds ?? [])].filter(Boolean);
  for (let n = 0; n < Math.max(1, Math.trunc(Number(repeat) || 1)); n += 1) {
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

function scaledMasterValue(source, parsed, preferValue2 = false) {
  const permil = Number(preferValue2 && parsed.value2 ? parsed.value2 : parsed.value1) || 0;
  const result = calculateNativeDependentLessonBase(Math.max(0, Number(source) || 0), permil);
  const cap = preferValue2 ? Math.max(0, Number(parsed.value1) || 0) : 0;
  return cap > 0 ? Math.min(cap, result) : result;
}

function addScaledStatus(exam, field, value, additivePermilField = "", fixedField = "") {
  const additive = Math.max(0, Number(exam[additivePermilField] ?? 0));
  const fixed = Math.max(0, Number(exam[fixedField] ?? 0));
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

function applyStanceRuntimeRewards(state, stance, event) {
  const playable = Math.max(0, Math.trunc(Number(stance?.playableValueAdd) || 0));
  if (playable > 0) {
    state.playsRemaining += playable;
    event.effects.push(`カード使用回数 +${playable}`);
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

function resolveFullPowerAfterCard(state, event) {
  const exam = state.exam;
  // Native ExamLoopTaskAsync first removes the one-card Full Power stance,
  // then converts each complete 10-point gauge into the next Full Power.
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

function executeMasterEffect(state, parsed, event, { timed = false } = {}) {
  const type = String(parsed.masterEffectType ?? "").replace("ProduceExamEffectType_", "");
  const exam = state.exam;
  const v1 = Number(parsed.value1 ?? parsed.value ?? 0) || 0;
  const v2 = Number(parsed.value2 ?? 0) || 0;
  const turn = Number(parsed.turn ?? 0) || 0;
  const searchCount = () => masterSearchMatchCount(state, resolvedMasterSearch(state, parsed.searchId));
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

  switch (type) {
    case "ExamStatusEnchant":
    case "ExamStatusEnchantEncore":
      registerMasterStatusEnchant(state, parsed);
      event.effects.push(`継続効果を追加: ${parsed.enchantId}`);
      return;
    case "ExamEffectTimer": {
      const childId = parsed.chainEffectId || parsed.chainEffectIds?.[0];
      const master = state.examEffectById?.get?.(String(childId ?? ""));
      state.timers.push({
        turn: Math.max(1, turn), count: Math.max(1, Number(parsed.count) || 1),
        child: master ? parseExamEffectMaster(master) : parseExamEffectId(childId), id: parsed.id,
      });
      event.effects.push(`${Math.max(1, turn)}ターン後に効果発動`);
      return;
    }
    case "ExamLessonFix": {
      const added = Math.max(0, Math.trunc(v1)) * Math.max(1, Number(parsed.count) || 1);
      exam.parameter += added;
      event.effects.push(`固定パラメータ +${added}`);
      return;
    }
    case "ExamLessonValueMultipleDown": {
      const result = applyParsedExamEffect(exam, {
        kind: "lesson_value_multiple_down", id: parsed.id, permil: v1, turn: turn || -1,
      });
      event.effects.push(result.label); return;
    }
    case "ExamLessonDependBlock": applyMasterLesson(state, parsed, scaledMasterValue(exam.block, parsed, v2 > 0), event, "元気参照"); return;
    case "ExamLessonDependParameterBuff": applyMasterLesson(state, parsed, scaledMasterValue(exam.parameterBuff, parsed, v2 > 0), event, "好調参照"); return;
    case "ExamLessonDependStamina": applyMasterLesson(state, parsed, scaledMasterValue(exam.stamina, parsed), event, "体力参照"); return;
    case "ExamLessonDependBlockConsumptionSum": applyMasterLesson(state, parsed, scaledMasterValue(exam.blockConsumptionSum, parsed), event, "元気消費量参照"); return;
    case "ExamLessonDependStaminaConsumptionSum": applyMasterLesson(state, parsed, scaledMasterValue(exam.staminaConsumptionSum, parsed), event, "体力消費量参照"); return;
    case "ExamLessonDependPlayCardCountSum": applyMasterLesson(state, parsed, Math.min(v2 || Infinity, v1 * Number(exam.playCardCountSum ?? exam.cardPlayCount ?? 0)), event, "カード使用数参照"); return;
    case "ExamLessonFullPowerPoint": applyMasterLesson(state, parsed, scaledMasterValue(exam.fullPowerPoint, parsed), event, "全力値参照"); return;
    case "ExamLessonPerSearchCount": applyMasterLesson(state, parsed, v1 * searchCount(), event, "カード枚数参照"); return;
    case "ExamLessonDependBlockAndSearchCount": applyMasterLesson(state, parsed, scaledMasterValue(exam.block, parsed) * Math.max(1, searchCount()), event, "元気・カード枚数参照"); return;
    case "ExamLessonAddMultipleLessonBuff": applyMasterLesson(state, parsed, scaledMasterValue(exam.lessonBuff, parsed), event, "集中参照"); return;
    case "ExamMultipleEnthusiasticLesson": {
      const base = Math.max(0, v1 + scaledMasterValue(exam.enthusiastic, { ...parsed, value1: v2 || 1000 }));
      applyMasterLesson(state, parsed, base, event, "熱意参照"); return;
    }
    case "ExamBlockFix": status("block", v1, "元気"); return;
    case "ExamBlockAddMultipleAggressive": {
      const added = calculateNativeBlockAdd(exam, v1, v2 / 1000);
      exam.block += added; event.effects.push(`元気 +${added}`); return;
    }
    case "ExamBlockPerUseCardCount": status("block", v1 * Math.min(Number(exam.cardPlayCount ?? 0), v2 || Infinity), "元気"); return;
    case "ExamBlockDependExamReview": status("block", scaledMasterValue(exam.review, parsed), "元気"); return;
    case "ExamBlockDependBlockConsumptionSum": status("block", scaledMasterValue(exam.blockConsumptionSum, parsed), "元気"); return;
    case "ExamReviewDependExamBlock": status("review", scaledMasterValue(exam.block, parsed), "好印象", "reviewAdditivePermil"); return;
    case "ExamReviewDependExamCardPlayAggressive": status("review", scaledMasterValue(exam.aggressive, parsed), "好印象", "reviewAdditivePermil"); return;
    case "ExamReviewDependReviewConsumptionSum": status("review", scaledMasterValue(exam.reviewConsumptionSum, parsed), "好印象", "reviewAdditivePermil"); return;
    case "ExamReviewPerSearchCount": status("review", scaledMasterValue(searchCount(), { ...parsed, value1: v2 || v1 }), "好印象", "reviewAdditivePermil"); return;
    case "ExamLessonBuffDependParameterBuff": status("lessonBuff", scaledMasterValue(exam.parameterBuff, parsed), "集中", "lessonBuffAdditivePermil", "lessonBuffAdditiveFix"); return;
    case "ExamLessonBuffPerSearchCount": status("lessonBuff", scaledMasterValue(searchCount(), { ...parsed, value1: v2 || v1 }), "集中", "lessonBuffAdditivePermil", "lessonBuffAdditiveFix"); return;
    case "ExamParameterBuffDependLessonBuff": status("parameterBuff", scaledMasterValue(exam.lessonBuff, parsed), "好調", "parameterBuffAdditivePermil"); return;
    case "ExamStaminaRecoverMultiple": {
      if (exam.staminaRecoverRestriction) return;
      const amount = Math.ceil(Number(exam.maxStamina ?? 0) * v1 / 1000);
      const before = exam.stamina; exam.stamina = Math.min(exam.maxStamina || Infinity, exam.stamina + amount);
      event.effects.push(`体力 +${exam.stamina - before}`); return;
    }
    case "ExamStaminaDamage":
    case "ExamStaminaReduceFix":
    case "ExamStaminaReduce": {
      const amount = type === "ExamStaminaReduce" && v1 < 0
        ? Math.ceil(Number(exam.maxStamina ?? 0) * Math.abs(v1) / 1000)
        : Math.abs(v1);
      const resolved = calculateNativeStaminaDamage(exam, amount, { penetrate: type !== "ExamStaminaDamage" });
      exam.block = Math.max(0, exam.block - resolved.blockDamage);
      exam.stamina = Math.max(0, exam.stamina - resolved.staminaDamage);
      exam.blockConsumptionSum += resolved.blockDamage;
      exam.staminaConsumptionSum += resolved.staminaDamage;
      event.effects.push(`体力減少 ${resolved.damage}`); return;
    }
    case "ExamAggressiveReduce": reduce("aggressive", v1, "やる気"); return;
    case "ExamReviewReduce": exam.reviewConsumptionSum += Math.min(exam.review, v1); reduce("review", v1, "好印象"); return;
    case "ExamLessonBuffReduce": reduce("lessonBuff", v1, "集中"); return;
    case "ExamFullPowerPointReduce": reduce("fullPowerPoint", v1, "全力値"); return;
    case "ExamParameterBuffMultiplePerTurnReduce": reduce("parameterBuffMultiplePerTurn", v1, "絶好調"); return;
    case "ExamBlockDown": exam.block = Math.max(0, Math.floor(exam.block * Math.max(0, 1000 - v1) / 1000)); event.effects.push("元気減少"); return;
    case "ExamAggressiveValueMultiple": exam.aggressiveValueMultiple = 1 + v1 / 1000; event.effects.push("やる気倍率変更"); return;
    case "ExamReviewValueMultiple": exam.reviewValueMultiple = 1 + v1 / 1000; event.effects.push("好印象倍率変更"); return;
    case "ExamBlockValueMultiple": exam.blockValueMultiple = 1 + v1 / 1000; event.effects.push("元気倍率変更"); return;
    case "ExamAggressiveAdditive": timedAdd("aggressiveAdditivePermil", v1, "やる気効果増加"); return;
    case "ExamAggressiveAdditiveFix": timedAdd("aggressiveAdditiveFix", v1, "やる気固定増加"); return;
    case "ExamReviewAdditive": timedAdd("reviewAdditivePermil", v1, "好印象効果増加"); return;
    case "ExamLessonBuffAdditive": timedAdd("lessonBuffAdditivePermil", v1, "集中効果増加"); return;
    case "ExamLessonBuffAdditiveFix": timedAdd("lessonBuffAdditiveFix", v1, "集中固定増加"); return;
    case "ExamParameterBuffAdditive": timedAdd("parameterBuffAdditivePermil", v1, "好調効果増加"); return;
    case "ExamEnthusiasticAdditive": timedAdd("enthusiasticAdditivePermil", v1, "熱意効果増加"); return;
    case "ExamEnthusiasticMultiple": exam.enthusiasticMultiple = 1 + v1 / 1000; event.effects.push("熱意倍率変更"); return;
    case "ExamFullPowerPointAdditive": timedAdd("fullPowerPointAdditivePermil", v1, "全力値効果増加"); return;
    case "ExamConcentrationLessonMultipleAdditive": exam.concentrationLessonMultipleAdditive += v1 / 1000; event.effects.push("強気時スコア倍率増加"); return;
    case "ExamFullPowerLessonMultipleAdditive": exam.fullPowerLessonMultipleAdditive += v1 / 1000; event.effects.push("全力時スコア倍率増加"); return;
    case "ExamBlockRestriction": timedAdd("blockRestriction", 1, "元気増加不可", "flag"); return;
    case "ExamBlockAddDown": timedAdd("blockAddDown", 1, "元気増加量減少", "flag"); return;
    case "ExamStaminaRecoverRestriction": timedAdd("staminaRecoverRestriction", 1, "体力回復不可", "flag"); return;
    case "ExamPanic": timedAdd("panic", 1, "パニック", "flag"); return;
    case "ExamAntiDebuff": exam.antiDebuffCount += Math.max(1, Number(parsed.count) || 1); event.effects.push("低下状態無効"); return;
    case "ExamDebuffRecover": exam.parameterDebuff = 0; exam.lessonDebuff = 0; exam.slump = false; exam.panic = false; event.effects.push("低下状態を解除"); return;
    case "ExamGimmickLessonDebuff": if (exam.antiDebuffCount > 0) exam.antiDebuffCount -= 1; else exam.lessonDebuff += Math.max(1, v1); event.effects.push("集中低下"); return;
    case "ExamGimmickParameterDebuff": if (exam.antiDebuffCount > 0) exam.antiDebuffCount -= 1; else exam.parameterDebuff += Math.max(1, v1); event.effects.push("好調低下"); return;
    case "ExamGimmickSlump": if (exam.antiDebuffCount > 0) exam.antiDebuffCount -= 1; else exam.slump = true; event.effects.push("スランプ"); return;
    case "ExamGimmickSleepy": executeMasterChain(state, parsed, event); event.effects.push("眠気を生成"); return;
    case "ExamGimmickPlayCardLimit": exam.gimmickPlayCardLimit = v1; state.playsRemaining = Math.min(state.playsRemaining, v1); event.effects.push(`カード使用上限 ${v1}`); return;
    case "ExamGimmickStartTurnCardDrawDown": timedAdd("startTurnCardDrawDown", Math.max(1, v1), `ターン開始ドロー -${Math.max(1, v1)}`); return;
    case "ExamBuffConsumptionAdd": timedAdd("buffConsumptionAdd", Math.max(1, v1 || 1), "強化状態消費増加"); return;
    case "ExamItemFireLimitAdd": exam.itemFireLimitAdd += Math.max(1, v1 || 1); event.effects.push("Pアイテム発動回数増加"); return;
    case "ExamFullPowerPoint": {
      const added = addScaledStatus(exam, "fullPowerPoint", v1, "fullPowerPointAdditivePermil");
      exam.fullPowerPointGetSum += added; event.effects.push(`全力値 +${added}`); return;
    }
    case "ExamFullPower": {
      const stance = trySetExamStance(exam, EXAM_IDOL_STATUS_TYPE.FullPower, 1);
      applyStanceRuntimeRewards(state, stance, event);
      event.effects.push(stance.changed ? "全力に変更" : "指針変更なし");
      return;
    }
    case "ExamOverPreservation": {
      const stance = trySetExamStance(exam, EXAM_IDOL_STATUS_TYPE.OverPreservation, 1);
      applyStanceRuntimeRewards(state, stance, event);
      event.effects.push(stance.changed ? "超温存に変更" : "指針変更なし");
      return;
    }
    case "ExamStanceReset": {
      const stance = trySetExamStance(exam, EXAM_IDOL_STATUS_TYPE.Unknown, 0);
      applyStanceRuntimeRewards(state, stance, event);
      event.effects.push(stance.changed ? "指針解除" : "指針変更なし");
      return;
    }
    case "StanceLock": exam.stanceLock = turn || 1; event.effects.push(`指針固定 ${exam.stanceLock}ターン`); return;
    case "ExamCardMove": {
      for (const card of pickedMasterCards(state, parsed)) {
        const from = removeRuntimeCard(state, card); const to = addRuntimeCardAt(state, card, parsed.movePositionType);
        event.moved.push({ card: { ...card }, from, to });
        if (to === "lost") runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.CARD_MOVE_LOST, event, { card });
      }
      event.effects.push("対象カードを移動"); return;
    }
    case "ExamCardUpgrade": {
      for (const card of pickedMasterCards(state, parsed)) {
        applyPermanentCardUpgradeInPlace(state, card);
      }
      event.effects.push("対象カードを強化"); return;
    }
    case "ExamCardDuplicate": {
      for (const source of pickedMasterCards(state, parsed)) {
        const clone = { ...source, token: `generated:${++state.generatedCardSerial}:${source.id}`, generated: true };
        addRuntimeCardAt(state, clone, parsed.movePositionType); event.created.push({ card: { ...clone } });
      }
      event.effects.push("対象カードを複製"); return;
    }
    case "ExamCardCreateSearch": {
      const search = resolvedMasterSearch(state, parsed.searchId);
      if (!search) {
        rememberUnsupported(state, `card-create-search:${parsed.searchId}`);
        event.effects.push(`カード検索マスタを取得できません: ${parsed.searchId}`);
        return;
      }

      const randomPoolId = String(search.produceCardRandomPoolId ?? "");
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
          const to = addRuntimeCardAt(state, card, parsed.movePositionType);
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
            const to = addRuntimeCardAt(state, card, parsed.movePositionType);
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
        const to = addRuntimeCardAt(state, card, parsed.movePositionType);
        event.created.push({ card: { ...card }, to });
      }
      event.effects.push("検索条件からカード生成");
      return;
    }
    case "ExamSearchPlayCardStaminaConsumptionChange": {
      for (const card of cardsForMasterSearch(state, resolvedMasterSearch(state, parsed.searchId))) {
        card.stamina = Math.max(0, Number(card.stamina ?? 0) + v1);
      }
      event.effects.push("対象カードの体力消費を変更"); return;
    }
    case "ExamForcePlayCardSearch":
    case "ExamForcePlayCardSearchWithCost": {
      const card = pickedMasterCards(state, parsed)[0];
      if (card) {
        if (!state.hand.includes(card)) { removeRuntimeCard(state, card); state.hand.push(card); }
        if (state.playsRemaining <= 0) state.playsRemaining = 1;
        playTowerCard(state, state.hand.indexOf(card));
      }
      event.effects.push("対象カードを強制使用"); return;
    }
    case "ExamEffectPerSearchCount": executeMasterChain(state, parsed, event, searchCount()); return;
    default:
      rememberUnsupported(state, `effect-type:${parsed.masterEffectType || type || parsed.id}`);
      event.effects.push(`未対応効果: ${parsed.masterEffectType || parsed.id}`);
  }
}

function executeParsedTowerEffect(state, parsed, event, { timed = false } = {}) {
  const beforeStatus = captureNativeStatusSnapshot(state.exam);
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
        const draw = drawCardsIntoHand(state, Number(applied.value) || 0);
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
      state.playsRemaining += Number(applied.value) || 0;
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
      state.cardEffectPlayCountBuff = { value: parsed.value, count: parsed.count, turn: parsed.turn, searchId: parsed.searchId };
      break;
    case "hand_swap": {
      const count = state.hand.length;
      state.discard.push(...state.hand);
      state.hand = [];
      const draw = drawCardsIntoHand(state, count);
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
      applied.label = `${runtimeEnchantName(state, parsed.enchantId)}を追加`;
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
    beforeStatus,
    event,
    {
      cause: "effect",
      parsedEffect: parsed,
      effectType: parsedMasterEffectType(parsed),
    },
  );
}

function applyCardEffectEntry(state, entry, event, card = null) {
  const trigger = checkRuntimeCardTrigger(state, entry?.produceExamTriggerId, card, event);
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

export function playTowerCard(state, indexInput) {
  if (!state.hand.length) throw new Error("使用する手札がありません。");
  if (Number(state.playsRemaining ?? 0) <= 0) throw new Error("このターンのカード使用回数が残っていません。");
  const index = Number(indexInput);
  if (!Number.isInteger(index) || index < 0 || index >= state.hand.length) {
    throw new Error("使用するカード位置が不正です。");
  }
  const card = state.hand[index];
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
  };
  const cardTrigger = checkRuntimeCardTrigger(state, card.playProduceExamTriggerId, card, event);
  if (!cardTrigger.supported) {
    rememberUnsupported(state, `play-trigger:${card.playProduceExamTriggerId}`);
    event.effects.push(`カード使用条件は未対応: ${card.playProduceExamTriggerId}`);
  } else if (!cardTrigger.triggered) {
    throw new Error(`${card.id}: カード使用条件を満たしていません。`);
  }

  const beforeCostStatus = captureNativeStatusSnapshot(state.exam);
  const beforeCost = {
    block: Number(state.exam.block ?? 0),
    stamina: Number(state.exam.stamina ?? 0),
    review: Number(state.exam.review ?? 0),
  };
  event.cost.push(...payCardCost(state.exam, card));
  state.exam.blockConsumptionSum += Math.max(0, beforeCost.block - Number(state.exam.block ?? 0));
  state.exam.staminaConsumptionSum += Math.max(0, beforeCost.stamina - Number(state.exam.stamina ?? 0));
  state.exam.reviewConsumptionSum += Math.max(0, beforeCost.review - Number(state.exam.review ?? 0));
  emitNativeStatusDiff(
    state,
    beforeCostStatus,
    event,
    { cause: "cardCost", card },
  );

  state.hand.splice(index, 1);
  state.playsRemaining -= 1;
  state.exam.cardPlayCount += 1;
  state.exam.playCardCountSum += 1;
  state.playTurnCountSum += Math.max(1, Number(state.turn ?? 1));
  runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.CARD_PLAY, event, { card });
  const repeatBuff = state.cardEffectPlayCountBuff;
  const repeatMatches = Boolean(
    repeatBuff
    && Number(repeatBuff.count ?? 0) > 0
    && cardMatchesSearchId(card, repeatBuff.searchId),
  );
  const repeat = repeatMatches
    ? Math.max(0, Math.trunc(Number(repeatBuff.value ?? 0)))
    : 0;
  if (repeatMatches) {
    repeatBuff.count -= 1;
    if (repeatBuff.count <= 0) state.cardEffectPlayCountBuff = null;
  }
  for (let n = 0; n <= repeat; n += 1) {
    for (const entry of card.playEffects ?? []) applyCardEffectEntry(state, entry, event, card);
  }
  runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY, event, { card });
  resolveFullPowerAfterCard(state, event);

  if (card.onceOnly) {
    state.lost.push(card);
    runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.CARD_MOVE_LOST, event, { card });
  } else state.discard.push(card);
  state.currentTurnPlays.push(event);
  return event;
}

function tickTurnDurations(exam) {
  // Review's automatic score is resolved before status spending. Native lock
  // statuses are checked before their own duration is spent.
  const reviewLocked = Number(exam.reviewTurnEndReduceLock ?? 0) !== 0;
  const parameterBuffLocked = Number(exam.parameterBuffTurnEndReduceLock ?? 0) !== 0;

  if (!reviewLocked && Number(exam.review ?? 0) > 0) exam.review -= 1;
  if (!parameterBuffLocked && Number(exam.parameterBuff ?? 0) > 0) exam.parameterBuff -= 1;

  for (const field of ["parameterBuffMultiplePerTurn", "staminaConsumptionDown", "staminaConsumptionAdd"]) {
    if (Number(exam[field] ?? 0) > 0) exam[field] -= 1;
  }
  for (const field of [
    "stanceLock",
    "stanceLockConcentration",
    "stanceLockFullPower",
    "stanceLockPreservation",
  ]) {
    if (Number(exam[field] ?? 0) > 0) exam[field] -= 1;
  }

  // LessonParameterMultiple/Down, ReviewMultiple/CountAdd, Pride, and the
  // turn-end locks all inherit the common finite-turn status lifetime.
  tickNativeScoreTimedStatuses(exam);
}

function tickCardEffectPlayCountBuff(state) {
  const buff = state.cardEffectPlayCountBuff;
  if (!buff || Number(buff.turn) < 0) return;
  buff.turn = Math.max(0, Number(buff.turn ?? 0) - 1);
  if (buff.turn <= 0) state.cardEffectPlayCountBuff = null;
}

function tickTimers(state, event) {
  const expired = [];
  for (const timer of state.timers) {
    timer.turn -= 1;
    if (timer.turn <= 0) expired.push(timer);
  }
  state.timers = state.timers.filter((timer) => !expired.includes(timer));
  for (const timer of expired) {
    const count = Math.max(1, Math.trunc(Number(timer.count ?? 1) || 1));
    for (let index = 0; index < count; index += 1) {
      executeParsedTowerEffect(state, timer.child, event, { timed: true });
    }
  }
}

export function finishTowerTurn(state, action = { type: "skip" }) {
  const type = String(action?.type ?? "skip");
  let compatibilityUse = null;
  if (type === "use") compatibilityUse = playTowerCard(state, action?.index);
  else if (type !== "skip" && type !== "end") throw new Error(`未知のターン操作です: ${type}`);

  if (!state.hand.length && !state.currentTurnPlays.length) throw new Error("処理する手札がありません。");
  const recoverStaminaAtTurnEnd = Number(state.playsRemaining ?? 0) > 0;
  const remainingHand = state.hand.map((card) => ({ ...card }));
  // Native ResetHand (0x8237750) snapshots Hand and walks index 0 -> Count-1.
  // IsEndTurnLost cards are batched to Lost; all other remaining cards are
  // batched to Grave. Each destination preserves the original Hand order.
  for (const card of state.hand) {
    if (card.isEndTurnLost) state.lost.push(card);
    else state.discard.push(card);
  }
  state.hand = [];

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
  const onceOnly = Boolean(plays[0]?.onceOnly);
  const entry = {
    turn: state.turn,
    hand: remainingHand,
    action: plays.length ? "use" : "skip",
    used,
    onceOnly,
    plays,
    drinks,
    turnStartEffects: [...(state.turnStartEffects ?? [])],
    turnStartSupportCardRolls: (state.turnStartSupportCardRolls ?? []).map((roll) => ({ ...roll })),
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    lostCount: state.lost.length,
    recycleCount: state.recycleCount,
    exam: { ...state.exam },
  };
  state.history.push(entry);
  state.currentTurnPlays = [];
  state.currentTurnDrinks = [];
  state.turnStartSupportCardRolls = [];
  state.playsRemaining = 0;
  const turnEndEvent = { effects: [], drawn: [], recycleEvents: [] };

  if (recoverStaminaAtTurnEnd) {
    const recovery = Math.max(0, Math.trunc(getExamRuntimeSetting(state.exam, "examTurnEndRecoveryStamina")));
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
  const reviewScore = applyNativeReviewTurnEnd(state.exam, currentTowerScoreContext(state));
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
    { action: type, used },
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
  tickNativeEffectSchedulerTurn(state.effectScheduler, { turn: state.turn });
  entry.examAfterTurnEnd = { ...state.exam };

  // Support-card upgrades are temporary for the current turn. Revert every
  // affected runtime instance after all turn-end effects have resolved so a
  // recycled card starts the next turn at its permanent upgrade level.
  clearSupportCardUpgrades(state);
  return entry;
}
