import { XorShift32 } from "./engine.js";

export const DEFAULT_DRAW_PER_TURN = 3;

function cardId(card) {
  return String(card?.id ?? card ?? "");
}

function isLostAfterUse(card) {
  return Boolean(card?.onceOnly) || String(card?.playMovePositionType ?? "") === "ProduceCardMovePositionType_Lost";
}

function normalizeDrawPerTurn(value) {
  const count = Number(value ?? DEFAULT_DRAW_PER_TURN);
  if (!Number.isInteger(count) || count < 1) throw new Error("1ターンのドロー枚数が不正です。");
  return count;
}

export function firstRecycleRelevantHands(firstCycleCards, drawPerTurn = DEFAULT_DRAW_PER_TURN) {
  const cards = Array.isArray(firstCycleCards) ? firstCycleCards : [];
  const perTurn = normalizeDrawPerTurn(drawPerTurn);
  if (!cards.length) return [];

  // If the whole initial deck is smaller than a hand, there is no discard pile
  // while drawing that first hand. The first recycle therefore happens on the
  // following turn, after this partial hand has been resolved.
  if (cards.length < perTurn) {
    return [{ turn: 1, startIndex: 0, cards: cards.slice() }];
  }

  // Otherwise the first recycle either starts at the next turn (exact multiple)
  // or while filling the final partial hand. In the latter case that partial
  // hand has not been resolved yet and must not be included in the recycle source.
  const fullTurnCount = Math.floor(cards.length / perTurn);
  return Array.from({ length: fullTurnCount }, (_, turnIndex) => ({
    turn: turnIndex + 1,
    startIndex: turnIndex * perTurn,
    cards: cards.slice(turnIndex * perTurn, (turnIndex + 1) * perTurn),
  }));
}

export function normalizeSeedUseAction(action, handSize) {
  if (action?.type === "skip") return { type: "skip", usedIndices: [] };
  const raw = Array.isArray(action?.usedIndices)
    ? action.usedIndices
    : Number.isInteger(action?.index)
      ? [action.index]
      : [];
  if (!raw.length) throw new Error("各ターンで使用したカード、またはSKIPを指定してください。");

  const seen = new Set();
  const usedIndices = [];
  for (const rawIndex of raw) {
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= handSize) {
      throw new Error("使用カードの位置が手札の範囲外です。");
    }
    if (seen.has(index)) throw new Error("同じカードを同一ターンで複数回使用することはできません。");
    seen.add(index);
    usedIndices.push(index);
  }
  return { type: "use", usedIndices };
}

export function buildDiscardBeforeFirstRecycle(firstCycleCards, useHistory, drawPerTurn = DEFAULT_DRAW_PER_TURN) {
  const cards = Array.isArray(firstCycleCards) ? firstCycleCards : [];
  if (!cards.length) throw new Error("1周目のカード順がありません。");
  const hands = firstRecycleRelevantHands(cards, drawPerTurn);
  const history = Array.isArray(useHistory) ? useHistory : [];
  if (history.length < hands.length) {
    throw new Error(`1周目の使用履歴が不足しています（${history.length}/${hands.length}ターン）。`);
  }

  const discard = [];
  const lost = [];
  const normalizedActions = [];
  for (let turnIndex = 0; turnIndex < hands.length; turnIndex += 1) {
    const hand = hands[turnIndex].cards;
    const action = normalizeSeedUseAction(history[turnIndex], hand.length);
    normalizedActions.push(action);

    const used = new Set(action.usedIndices);
    for (const index of action.usedIndices) {
      const card = hand[index];
      if (isLostAfterUse(card)) lost.push(card);
      else discard.push(card);
    }
    for (let index = 0; index < hand.length; index += 1) {
      if (!used.has(index)) discard.push(hand[index]);
    }
  }
  return { discard, lost, hands, actions: normalizedActions };
}

export function advanceSeedPastInitialShuffle(seedInput, shuffledCardCount) {
  const count = Number(shuffledCardCount);
  if (!Number.isInteger(count) || count < 0) throw new Error("初期シャッフル対象枚数が不正です。");
  const rng = new XorShift32(Number(seedInput) >>> 0);
  for (let n = count; n >= 2; n -= 1) rng.nextInt(0, n);
  return rng.state >>> 0;
}

export function shuffleSeedCardsWithState(cards, stateInput) {
  const deck = (cards ?? []).map((card) => ({ ...card }));
  const rng = new XorShift32(Number(stateInput) >>> 0);
  for (let n = deck.length; n >= 2; n -= 1) {
    const j = rng.nextInt(0, n);
    [deck[j], deck[n - 1]] = [deck[n - 1], deck[j]];
  }
  return { deck, randomState: rng.state >>> 0 };
}

export function predictFirstRecycle(seedInput, firstCycleCards, useHistory, options = {}) {
  const cards = Array.isArray(firstCycleCards) ? firstCycleCards : [];
  if (!cards.length) throw new Error("1周目のカード順がありません。");
  const perTurn = normalizeDrawPerTurn(options.drawPerTurn);
  const shuffledCardCount = options.shuffledCardCount === undefined
    ? cards.filter((card) => !card?.isInitial).length
    : Number(options.shuffledCardCount);
  if (!Number.isInteger(shuffledCardCount) || shuffledCardCount < 0 || shuffledCardCount > cards.length) {
    throw new Error("初期シャッフル対象枚数が不正です。");
  }

  const resolved = buildDiscardBeforeFirstRecycle(cards, useHistory, perTurn);
  if (!resolved.discard.length) {
    throw new Error("最初の再シャッフル対象になる捨て札がありません。");
  }
  const recycleState = advanceSeedPastInitialShuffle(seedInput, shuffledCardCount);
  const recycled = shuffleSeedCardsWithState(resolved.discard, recycleState);
  const partialHandCount = cards.length >= perTurn ? cards.length % perTurn : 0;
  return {
    seed: Number(seedInput) >>> 0,
    shuffleState: recycleState,
    randomState: recycled.randomState,
    recycleSource: resolved.discard,
    lost: resolved.lost,
    recycledDeck: recycled.deck,
    relevantHands: resolved.hands,
    actions: resolved.actions,
    partialHandCount,
  };
}

export function matchesFirstRecycleObservation(seedInput, firstCycleCards, useHistory, observedSecondCycleIds, options = {}) {
  const observed = (observedSecondCycleIds ?? []).map(String).filter(Boolean);
  if (!observed.length) return true;
  const prediction = predictFirstRecycle(seedInput, firstCycleCards, useHistory, options);
  if (observed.length > prediction.recycledDeck.length) return false;
  for (let index = 0; index < observed.length; index += 1) {
    if (cardId(prediction.recycledDeck[index]) !== observed[index]) return false;
  }
  return true;
}

export function filterSeedsByFirstRecycle(seeds, firstCycleCards, useHistory, observedSecondCycleIds, options = {}) {
  const unique = [...new Set((seeds ?? []).map((seed) => Number(seed) >>> 0))];
  return unique.filter((seed) => matchesFirstRecycleObservation(
    seed,
    firstCycleCards,
    useHistory,
    observedSecondCycleIds,
    options,
  ));
}
