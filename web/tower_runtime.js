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
      isInitial: Boolean(master.isInitial),
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

export function createTowerTurnState(cards, seedInput, cardById = new Map(), options = {}) {
  const seed = typeof seedInput === "number" ? seedInput >>> 0 : parseSeed(seedInput);
  const instances = runtimeInstances(cards, cardById, options.cardVariantByKey);
  if (!instances.length) throw new Error("デッキにカードがありません。");
  const initial = shuffleObjectsWithState(instances, seed);
  return {
    seed,
    randomState: initial.randomState,
    initialDeck: initial.deck.map((card) => ({ ...card })),
    deck: initial.deck.map((card) => ({ ...card })),
    discard: [],
    lost: [],
    hand: [],
    turn: 0,
    recycleCount: 0,
    history: [],
    lastRecycle: null,
    exam: createExamState({ stamina: options.stamina }),
    playsRemaining: 0,
    currentTurnPlays: [],
    unsupported: [],
    timers: [],
    enchants: [],
    pendingDraw: 0,
    pendingHandUpgradeAll: 0,
    cardEffectPlayCountBuff: null,
    cardVariantByKey: options.cardVariantByKey ?? new Map(),
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

export function drawTowerTurn(state, drawCount = 3) {
  const count = Number(drawCount);
  if (!Number.isInteger(count) || count < 1) throw new Error("1ターンのドロー枚数が不正です。");
  if (state.hand.length) throw new Error("現在の手札を処理してから次ターンへ進んでください。");
  state.turn += 1;
  state.playsRemaining = 1;
  state.currentTurnPlays = [];
  const extraDraw = Math.max(0, Number(state.pendingDraw ?? 0));
  state.pendingDraw = 0;
  const result = drawCardsIntoHand(state, count + extraDraw);
  if (Number(state.pendingHandUpgradeAll ?? 0) > 0) {
    upgradeHandCards(state);
    state.pendingHandUpgradeAll = 0;
  }
  return { turn: state.turn, hand: state.hand.map((card) => ({ ...card })), recycleEvents: result.recycleEvents };
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
  state.discard.push(...state.hand);
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
