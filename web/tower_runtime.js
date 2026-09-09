import { XorShift32, normalizeProduceCard, parseSeed } from "./engine.js";

export const TOWER_DEFAULT_DECK_BY_EXAM_EFFECT = Object.freeze({
  ProduceExamEffectType_ExamParameterBuff: "initial_deck-produce_default-parameter_buff",
  ProduceExamEffectType_ExamConcentration: "initial_deck-produce_default-concentration",
  ProduceExamEffectType_ExamLessonBuff: "initial_deck-produce_default-lesson_buff",
  ProduceExamEffectType_ExamReview: "initial_deck-produce_default-review",
  ProduceExamEffectType_ExamCardPlayAggressive: "initial_deck-produce_default-aggressive",
  ProduceExamEffectType_ExamFullPower: "initial_deck-produce_default-full_power",
});

export const TOWER_EXAM_EFFECT_LABELS = Object.freeze({
  ProduceExamEffectType_ExamParameterBuff: "センス / 好調",
  ProduceExamEffectType_ExamConcentration: "センス / 集中",
  ProduceExamEffectType_ExamLessonBuff: "ロジック / やる気",
  ProduceExamEffectType_ExamReview: "ロジック / 好印象",
  ProduceExamEffectType_ExamCardPlayAggressive: "アノマリー / 強気",
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

function runtimeInstances(cards, cardById) {
  const seen = new Map();
  return (cards ?? []).map((raw, index) => {
    const card = normalizeProduceCard(raw, { source: raw?.source });
    const id = String(card.id);
    const ordinal = (seen.get(id) ?? 0) + 1;
    seen.set(id, ordinal);
    const master = cardById?.get?.(id) ?? {};
    const playMovePositionType = String(master.playMovePositionType ?? card.playMovePositionType ?? "");
    return {
      ...card,
      token: `${id}@@${ordinal}`,
      originalIndex: index,
      playMovePositionType,
      onceOnly: isOnceOnlyMove(playMovePositionType),
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

export function createTowerTurnState(cards, seedInput, cardById = new Map()) {
  const seed = typeof seedInput === "number" ? seedInput >>> 0 : parseSeed(seedInput);
  const instances = runtimeInstances(cards, cardById);
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
  };
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

export function drawTowerTurn(state, drawCount = 3) {
  const count = Number(drawCount);
  if (!Number.isInteger(count) || count < 1) throw new Error("1ターンのドロー枚数が不正です。");
  if (state.hand.length) throw new Error("現在の手札を処理してから次ターンへ進んでください。");
  state.turn += 1;
  const recycleEvents = [];
  for (let i = 0; i < count; i += 1) {
    if (!state.deck.length) {
      const event = recycleIfNeeded(state);
      if (event) recycleEvents.push(event);
    }
    if (!state.deck.length) break;
    state.hand.push(state.deck.shift());
  }
  return { turn: state.turn, hand: state.hand.map((card) => ({ ...card })), recycleEvents };
}

export function finishTowerTurn(state, action = { type: "skip" }) {
  if (!state.hand.length) throw new Error("処理する手札がありません。");
  const hand = state.hand.map((card) => ({ ...card }));
  const type = String(action?.type ?? "skip");
  let used = null;
  let onceOnly = false;

  if (type === "skip") {
    // Seed identification uses this exact rule: ResetHand sends the hand to
    // Grave in draw/hand order, with no played card branch.
    state.discard.push(...state.hand);
  } else if (type === "use") {
    const index = Number(action?.index);
    if (!Number.isInteger(index) || index < 0 || index >= state.hand.length) {
      throw new Error("使用するカード位置が不正です。");
    }
    const card = state.hand[index];
    if (!isSupportedSimpleMove(card.playMovePositionType)) {
      throw new Error(`${card.id}: 使用後移動先 ${card.playMovePositionType} は簡易カード循環シミュレーション未対応です。`);
    }
    used = { ...card };
    onceOnly = Boolean(card.onceOnly);
    if (onceOnly) state.lost.push(card);
    else state.discard.push(card);
    state.discard.push(...state.hand.filter((_, cardIndex) => cardIndex !== index));
  } else {
    throw new Error(`未知のターン操作です: ${type}`);
  }

  state.history.push({
    turn: state.turn,
    hand,
    action: type,
    used,
    onceOnly,
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    lostCount: state.lost.length,
    recycleCount: state.recycleCount,
  });
  state.hand = [];
  return state.history[state.history.length - 1];
}
