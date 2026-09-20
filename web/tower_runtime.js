import { XorShift32, normalizeProduceCard, parseSeed } from "./engine.js";
import {
  applyParsedExamEffect,
  checkCardEffectTrigger,
  createExamState,
  getExamRuntimeSetting,
  parseExamEffectId,
  parseExamEffectMaster,
  payCardCost,
  tickNativeScoreTimedStatuses,
} from "./exam_effects.js";
import { applyNativeReviewTurnEnd } from "./exam_score.js";
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

function runtimeInstances(cards, cardById, cardVariantByKey = new Map()) {
  const seen = new Map();
  return (cards ?? []).map((raw, index) => {
    const card = normalizeProduceCard(raw, { source: raw?.source });
    const id = String(card.id);
    const ordinal = (seen.get(id) ?? 0) + 1;
    seen.set(id, ordinal);
    const variantKey = `${id}@@${Number(card.upgradeCount ?? 0)}`;
    const master = cardVariantByKey?.get?.(variantKey) ?? cardById?.get?.(id) ?? {};
    const playMovePositionType = String(master.playMovePositionType ?? card.playMovePositionType ?? "");
    return {
      ...card,
      token: `${id}@@${ordinal}`,
      originalIndex: index,
      playMovePositionType,
      category: String(master.category ?? card.category ?? ""),
      rarity: String(master.rarity ?? card.rarity ?? ""),
      planType: String(master.planType ?? card.planType ?? ""),
      searchTag: String(master.searchTag ?? card.searchTag ?? ""),
      effectGroupIds: Array.isArray(master.effectGroupIds) ? [...master.effectGroupIds] : [],
      onceOnly: isOnceOnlyMove(playMovePositionType),
      stamina: Number(master.stamina ?? 0) || 0,
      forceStamina: Number(master.forceStamina ?? 0) || 0,
      costType: String(master.costType ?? "ExamCostType_Unknown"),
      costValue: Number(master.costValue ?? 0) || 0,
      playProduceExamTriggerId: String(master.playProduceExamTriggerId ?? ""),
      playEffects: Array.isArray(master.playEffects) ? master.playEffects.map((effect) => ({ ...effect })) : [],
      isInitial: Boolean(master.isInitial ?? card.isInitial),
      isRestrict: Boolean(master.isRestrict),
      isEndTurnLost: Boolean(master.isEndTurnLost),
    };
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
  const instances = runtimeInstances(cards, cardById, options.cardVariantByKey);
  if (!instances.length) throw new Error("デッキにカードがありません。");

  // Native ExamCardPoolModel.Shuffle does not filter IsInitial. The whole Deck
  // is shuffled first; SetInitialCard later extracts opening-hand cards.
  const shuffled = shuffleObjectsWithState(instances, seed);
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
    turnLimit: Number.isFinite(Number(options.turnLimit)) ? Math.max(0, Math.trunc(Number(options.turnLimit))) : null,
    ended: false,
    exam,
    effectScheduler: options.effectScheduler ?? createNativeEffectScheduler({
      traceEnabled: Boolean(options.effectSchedulerTrace),
    }),
    playsRemaining: 0,
    currentTurnPlays: [],
    unsupported: [],
    timers: [],
    pendingDraw: 0,
    pendingHandUpgradeAll: 0,
    cardEffectPlayCountBuff: null,
    cardById: cardById ?? new Map(),
    cardVariantByKey: options.cardVariantByKey ?? new Map(),
    generatedCardSerial: 0,
    pItems: Array.isArray(options.pItems) ? options.pItems.map((item) => ({ ...item })) : [],
    pItemEffectRemainingCounts: new Map(),
    gimmicks: Array.isArray(options.gimmicks) ? options.gimmicks.map((item) => ({ ...item })) : [],
    gimmickEffectRemainingCounts: new Map(),
    lessonType: String(options.lessonType ?? ""),
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

function nativeSchedulerHooks(state, runtimeEvent) {
  return {
    evaluateCondition(condition, context) {
      if (condition?.kind === "masterExamTrigger") {
        return matchesMasterExamTrigger(state, condition, context, runtimeEvent);
      }
      return undefined;
    },
    executeEffect(effect) {
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
  ProduceExamFieldStatusType_NoBlock: "block",
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
    case "noStance":
      return Number(state.exam.idolStatusType ?? 0) === 0 ? 1 : 0;
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
  if (search.isCustomized === true && Number(card.upgradeCount ?? 0) <= 0) return false;
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

  if (position.includes("Playing") || context.card) {
    return cardMatchesMasterSearch(context.card, search);
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
    case "block": return "ProduceExamEffectType_ExamBlock";
    case "review": return "ProduceExamEffectType_ExamReview";
    case "aggressive": return "ProduceExamEffectType_ExamCardPlayAggressive";
    case "lesson_buff": return "ProduceExamEffectType_ExamLessonBuff";
    case "parameter_buff": return "ProduceExamEffectType_ExamParameterBuff";
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

function triggerFieldStatusesMatch(state, trigger) {
  const types = trigger.fieldStatusTypes ?? [];
  const values = trigger.fieldStatusValues ?? [];
  const checks = trigger.fieldStatusCheckTypes ?? [];
  for (let index = 0; index < types.length; index += 1) {
    const type = String(types[index] ?? "");
    const current = masterFieldStatusValue(state, type);
    if (current === null) return false;
    const expected = Number(values[index] ?? 0);
    const check = String(checks[index] ?? "ProduceExamTriggerCheckType_Unknown");
    const reverse = type === "ProduceExamFieldStatusType_StaminaLessMultiple";
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
  if (condition.phaseType === "ProduceExamPhaseType_ExamTurnSkip" && String(context.action ?? "") !== "skip") return false;

  const phaseValues = (trigger.phaseValues ?? []).map(Number).filter(Number.isFinite);
  if (phaseValues.length && !phaseValues.includes(masterPhaseValue(state, condition.phaseType, context))) return false;
  if (!triggerFieldStatusesMatch(state, trigger)) return false;
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
        if (effect.effectType) rememberUnsupported(state, `pitem-effect-type:${effect.effectType}`);
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

      const sharedKey = `pItem::${pItemId}::${String(effect.id ?? enchant.id ?? "")}`;
      const activationKey = sharedKey;
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
  for (const gimmick of state.gimmicks ?? []) {
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

  if (trigger.field) {
    conditions.push({
      field: `exam.${trigger.field}`,
      op: "gte",
      value: Number(trigger.min ?? 0),
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
  runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.START_OF_TURN, phaseEvent);

  const extraDraw = Math.max(0, Number(state.pendingDraw ?? 0));
  state.pendingDraw = 0;
  const requested = count + extraDraw;
  const result = isOpeningTurn
    ? setNativeInitialCard(state, requested)
    : drawCardsIntoHand(state, requested);
  if (Number(state.pendingHandUpgradeAll ?? 0) > 0) {
    upgradeHandCards(state);
    state.pendingHandUpgradeAll = 0;
  }
  runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.AFTER_START_OF_TURN, phaseEvent);
  return {
    turn: state.turn,
    hand: state.hand.map((card) => ({ ...card })),
    drawn: result.drawn.map((card) => ({ ...card })),
    recycleEvents: result.recycleEvents,
    nativePhaseEffects: [...phaseEvent.effects],
  };
}

function upgradeHandCards(state) {
  state.hand = state.hand.map((card) => {
    const nextUpgrade = Number(card.upgradeCount ?? 0) + 1;
    const nextMaster = state.cardVariantByKey?.get?.(`${card.id}@@${nextUpgrade}`) ?? {};
    return { ...card, ...nextMaster, token: card.token, originalIndex: card.originalIndex, upgradeCount: nextUpgrade };
  });
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
        event.drawn.push(...draw.drawn.map((card) => ({ ...card })));
        event.recycleEvents.push(...draw.recycleEvents);
      }
      break;
    }
    case "card_create_id":
      addGeneratedCard(state, applied, event);
      break;
    case "card_move_search":
      moveSearchedCards(state, applied, event);
      break;
    case "playable_add":
      state.playsRemaining += Number(applied.value) || 0;
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

function applyCardEffectEntry(state, entry, event) {
  const trigger = checkCardEffectTrigger(entry?.produceExamTriggerId, state.exam);
  if (!trigger.supported) {
    rememberUnsupported(state, `trigger:${trigger.triggerId}`);
    event.effects.push(`未対応条件: ${trigger.triggerId}`);
    return;
  }
  if (!trigger.triggered) {
    event.effects.push(`条件不成立: ${entry?.produceExamTriggerId}`);
    return;
  }

  const parsed = parseExamEffectId(entry?.produceExamEffectId);
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
  const cardTrigger = checkCardEffectTrigger(card.playProduceExamTriggerId, state.exam);
  if (!cardTrigger.supported) {
    rememberUnsupported(state, `play-trigger:${card.playProduceExamTriggerId}`);
    event.effects.push(`カード使用条件は未対応: ${card.playProduceExamTriggerId}`);
  } else if (!cardTrigger.triggered) {
    throw new Error(`${card.id}: カード使用条件を満たしていません。`);
  }

  const beforeCostStatus = captureNativeStatusSnapshot(state.exam);
  event.cost.push(...payCardCost(state.exam, card));
  emitNativeStatusDiff(
    state,
    beforeCostStatus,
    event,
    { cause: "cardCost", card },
  );

  state.hand.splice(index, 1);
  state.playsRemaining -= 1;
  state.exam.cardPlayCount += 1;
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
    for (const entry of card.playEffects ?? []) applyCardEffectEntry(state, entry, event);
  }
  runNativeEffectPhase(state, NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY, event, { card });

  if (card.onceOnly) state.lost.push(card);
  else state.discard.push(card);
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
  for (const timer of expired) executeParsedTowerEffect(state, timer.child, event, { timed: true });
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
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    lostCount: state.lost.length,
    recycleCount: state.recycleCount,
    exam: { ...state.exam },
  };
  state.history.push(entry);
  state.currentTurnPlays = [];
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

  tickTimers(state, turnEndEvent);
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
  return entry;
}
