import { XorShift32, normalizeProduceCard, parseSeed } from "./engine.js";
import {
  applyParsedExamEffect,
  checkCardEffectTrigger,
  createExamState,
  parseExamEffectId,
  payCardCost,
} from "./exam_effects_v7.js";

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
  const openingDrawCount = Math.max(1, Math.trunc(Number(options.drawPerTurn ?? options.openingDrawCount ?? 3)));
  const handLimit = normalizeHandLimit(options.handLimit);
  const openingPreview = resolveNativeInitialHand(shuffled.deck, openingDrawCount, handLimit);

  return {
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
    exam: { ...createExamState({ stamina: options.stamina }), targetScore: Math.max(0, Number(options.targetScore ?? 0)) },
    playsRemaining: 0,
    currentTurnPlays: [],
    unsupported: [],
    timers: [],
    enchants: [],
    pendingDraw: 0,
    pendingHandUpgradeAll: 0,
    cardEffectPlayCountBuff: null,
    cardById: cardById ?? new Map(),
    cardVariantByKey: options.cardVariantByKey ?? new Map(),
    generatedCardSerial: 0,
    pItems: Array.isArray(options.pItems) ? options.pItems.map((item) => ({ ...item })) : [],
  };
}

function rememberUnsupported(state, value) {
  const text = String(value ?? "").trim();
  if (text && !state.unsupported.includes(text)) state.unsupported.push(text);
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
  for (let i = 0; i < count; i += 1) {
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
  const isOpeningTurn = state.turn === 0 && !state.openingResolved;
  state.turn += 1;
  state.playsRemaining = 1;
  state.currentTurnPlays = [];
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
  return {
    turn: state.turn,
    hand: state.hand.map((card) => ({ ...card })),
    drawn: result.drawn.map((card) => ({ ...card })),
    recycleEvents: result.recycleEvents,
  };
}

function upgradeHandCards(state) {
  state.hand = state.hand.map((card) => {
    const nextUpgrade = Number(card.upgradeCount ?? 0) + 1;
    const nextMaster = state.cardVariantByKey?.get?.(`${card.id}@@${nextUpgrade}`) ?? {};
    return { ...card, ...nextMaster, token: card.token, originalIndex: card.originalIndex, upgradeCount: nextUpgrade };
  });
}

function executeParsedTowerEffect(state, parsed, event, { timed = false } = {}) {
  const applied = applyParsedExamEffect(state.exam, parsed);
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
    case "playable_add":
      state.playsRemaining += Number(applied.value) || 0;
      break;
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
      state.enchants.push({ ...parsed, effects: parsed.effects.map((effect) => ({ ...effect })) });
      break;
  }
  if (applied.label) event.effects.push(applied.label);
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

function runEnchantPhase(state, phase, event, card = null, source = state.enchants) {
  for (const enchant of [...source]) {
    const trigger = enchant.trigger ?? {};
    if (trigger.phase !== phase) continue;
    if (trigger.field && Number(state.exam[trigger.field] ?? 0) < Number(trigger.min ?? 0)) continue;
    if (trigger.category && String(card?.category ?? "") !== trigger.category) continue;
    for (const effect of enchant.effects ?? []) executeParsedTowerEffect(state, effect, event);
  }
}

export function playTowerCard(state, indexInput) {
  if (!state.hand.length) throw new Error("使用する手札がありません。");
  if (Number(state.playsRemaining ?? 0) <= 0) throw new Error("このターンのカード使用回数が残っていません。");
  const index = Number(indexInput);
  if (!Number.isInteger(index) || index < 0 || index >= state.hand.length) {
    throw new Error("使用するカード位置が不正です。");
  }
  const card = state.hand[index];
  const cardPlayEnchants = [...state.enchants];
  if (!isSupportedSimpleMove(card.playMovePositionType)) {
    throw new Error(`${card.id}: 使用後移動先 ${card.playMovePositionType} は未対応です。`);
  }

  const event = {
    card: { ...card },
    cost: [],
    effects: [],
    drawn: [],
    created: [],
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

  event.cost.push(...payCardCost(state.exam, card));
  state.hand.splice(index, 1);
  state.playsRemaining -= 1;
  state.exam.cardPlayCount += 1;
  const repeat = state.cardEffectPlayCountBuff && Number(state.cardEffectPlayCountBuff.count ?? 0) > 0
    ? Math.max(0, Number(state.cardEffectPlayCountBuff.value ?? 0))
    : 0;
  if (repeat) {
    state.cardEffectPlayCountBuff.count -= 1;
    if (state.cardEffectPlayCountBuff.count <= 0) state.cardEffectPlayCountBuff = null;
  }
  for (let n = 0; n <= repeat; n += 1) {
    for (const entry of card.playEffects ?? []) applyCardEffectEntry(state, entry, event);
  }
  runEnchantPhase(state, "card_play", event, card, cardPlayEnchants);

  if (card.onceOnly) state.lost.push(card);
  else state.discard.push(card);
  state.currentTurnPlays.push(event);
  return event;
}

function tickTurnDurations(exam) {
  for (const field of ["parameterBuff", "parameterBuffMultiplePerTurn", "staminaConsumptionDown", "staminaConsumptionAdd"]) {
    if (Number(exam[field] ?? 0) > 0) exam[field] -= 1;
  }
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
  tickTimers(state, turnEndEvent);
  runEnchantPhase(state, "end_turn", turnEndEvent);
  if (turnEndEvent.effects.length) entry.turnEndEffects = turnEndEvent.effects;
  tickTurnDurations(state.exam);
  return entry;
}
