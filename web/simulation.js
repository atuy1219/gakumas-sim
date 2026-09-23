import { XorShift32, normalizeProduceCard, simulateCards } from "./engine.js";

export const UINT32_SPACE = 0x100000000;

export function makeSimulationSeeds(count, seedBase = 0x6d2b79f5) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 1000000) {
    throw new Error("シミュレーション回数は1〜1,000,000の整数で指定してください。");
  }
  const rng = new XorShift32(Number(seedBase) >>> 0);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(rng.state >>> 0);
    rng.nextU32();
  }
  return out;
}

export function runOrderMonteCarlo(cards, count, seedBase, drawCount = 3) {
  const normalized = cards.map((card) => normalizeProduceCard(card, { source: card.source }));
  if (!normalized.length) throw new Error("デッキにカードがありません。");
  const seeds = makeSimulationSeeds(count, seedBase);
  const firstCardCounts = new Map();
  const firstHandCounts = new Map();
  const samples = [];

  for (const seed of seeds) {
    const result = simulateCards(normalized, seed, drawCount);
    const first = result.draw[0]?.id ?? "(none)";
    firstCardCounts.set(first, (firstCardCounts.get(first) ?? 0) + 1);
    const handKey = result.draw.map((card) => card.id).join(" | ");
    firstHandCounts.set(handKey, (firstHandCounts.get(handKey) ?? 0) + 1);
    if (samples.length < 20) {
      samples.push({
        seed,
        draw: result.draw.map((card) => card.id),
        order: result.initialDeck.map((card) => card.id),
        randomState: result.randomState,
      });
    }
  }

  const sortCounts = (map) => [...map.entries()]
    .map(([key, value]) => ({ key, count: value, ratio: value / seeds.length }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return {
    count: seeds.length,
    seedBase: Number(seedBase) >>> 0,
    deckCount: normalized.length,
    drawCount: Number(drawCount),
    firstCard: sortCounts(firstCardCounts),
    firstHand: sortCounts(firstHandCounts),
    samples,
    scoreSupported: false,
  };
}

export function makeCardInstances(cards) {
  const seen = new Map();
  return cards.map((card, index) => {
    const id = String(card.id);
    const ordinal = (seen.get(id) ?? 0) + 1;
    seen.set(id, ordinal);
    return {
      id,
      ordinal,
      token: `${id}@@${ordinal}`,
      index,
      isInitial: Boolean(card?.isInitial),
      card,
    };
  });
}

export function deriveFisherYatesChoices(initialTokens, finalTokens) {
  if (!Array.isArray(initialTokens) || !Array.isArray(finalTokens) || initialTokens.length !== finalTokens.length) {
    throw new Error("初期デッキと観測順の枚数が一致しません。");
  }
  const initialSet = new Set(initialTokens);
  const finalSet = new Set(finalTokens);
  if (initialSet.size !== initialTokens.length || finalSet.size !== finalTokens.length) {
    throw new Error("内部トークンが一意ではありません。");
  }
  if (initialSet.size !== finalSet.size || [...initialSet].some((token) => !finalSet.has(token))) {
    throw new Error("観測順が初期デッキと同じカード集合ではありません。");
  }

  const work = initialTokens.slice();
  const choices = [];
  for (let n = work.length; n >= 2; n -= 1) {
    const target = finalTokens[n - 1];
    let j = -1;
    for (let i = 0; i < n; i += 1) {
      if (work[i] === target) {
        j = i;
        break;
      }
    }
    if (j < 0) throw new Error("観測順からシャッフル交換列を復元できません。");
    choices.push({ n, j });
    [work[j], work[n - 1]] = [work[n - 1], work[j]];
  }
  if (work.some((token, index) => token !== finalTokens[index])) {
    throw new Error("観測順がFisher–Yatesの置換として復元できません。");
  }
  return choices;
}

function multisetCounts(values) {
  const counts = new Map();
  for (const value of values) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
  return counts;
}

function sameMultiset(a, b) {
  const aa = multisetCounts(a);
  const bb = multisetCounts(b);
  if (aa.size !== bb.size) return false;
  for (const [key, value] of aa) if (bb.get(key) !== value) return false;
  return true;
}

export function applyNativeInitialHandOrder(shuffledCards, drawPerTurn = 3, handLimit = Number.POSITIVE_INFINITY) {
  const drawCount = Number(drawPerTurn);
  if (!Number.isInteger(drawCount) || drawCount < 1) throw new Error("1ターンのドロー枚数が不正です。");
  const capacity = Number.isFinite(Number(handLimit))
    ? Math.max(0, Math.trunc(Number(handLimit)))
    : Number.POSITIVE_INFINITY;
  const deck = (shuffledCards ?? []).slice();
  const hand = [];

  // Native ExamCardMoveController.SetInitialCard (0x8239520):
  // scan Deck from Count-1 down to 0, move every IsInitial card to Hand,
  // then DrawCard only for the remaining opening-hand slots.
  for (let index = deck.length - 1; index >= 0; index -= 1) {
    if (!deck[index]?.isInitial || hand.length >= capacity) continue;
    hand.push(deck.splice(index, 1)[0]);
  }

  const ordinaryDrawCount = Math.min(
    Math.max(0, drawCount - hand.length),
    deck.length,
    Math.max(0, capacity - hand.length),
  );
  if (ordinaryDrawCount) hand.push(...deck.splice(0, ordinaryDrawCount));

  return {
    hand,
    remainingDeck: deck,
    visibleOrder: [...hand, ...deck],
  };
}

function enumerateObservedTokenOrders(instances, observedIds, visit, shouldStop) {
  const byId = new Map();
  for (const instance of instances) {
    if (!byId.has(instance.id)) byId.set(instance.id, []);
    byId.get(instance.id).push(instance);
  }

  const used = new Set();
  const current = [];
  function recurse(index) {
    if (shouldStop()) return;
    if (index >= observedIds.length) {
      visit(current.slice());
      return;
    }
    for (const instance of byId.get(observedIds[index]) ?? []) {
      if (used.has(instance.token)) continue;
      used.add(instance.token);
      current.push(instance);
      recurse(index + 1);
      current.pop();
      used.delete(instance.token);
      if (shouldStop()) return;
    }
  }
  recurse(0);
}

function enumerateInterleavings(left, right, visit, shouldStop) {
  const current = [];
  function recurse(i, j) {
    if (shouldStop()) return;
    if (i >= left.length && j >= right.length) {
      visit(current.slice());
      return;
    }
    if (i < left.length) {
      current.push(left[i]);
      recurse(i + 1, j);
      current.pop();
    }
    if (j < right.length) {
      current.push(right[j]);
      recurse(i, j + 1);
      current.pop();
    }
  }
  recurse(0, 0);
}

export function deriveSeedChoiceVariants(cards, observedIds, maxVariants = 8192) {
  const instances = makeCardInstances(cards);
  const observed = observedIds.map((id) => String(id).trim()).filter(Boolean);
  if (observed.length !== instances.length) {
    throw new Error(`観測順はデッキ全${instances.length}枚を入力してください（現在${observed.length}枚）。`);
  }
  const initialIds = instances.map((item) => item.id);
  if (!sameMultiset(initialIds, observed)) {
    throw new Error("観測順のカード構成が現在のデッキと一致しません。重複枚数も確認してください。");
  }

  const initialInstances = instances.filter((item) => item.isInitial);
  const ordinaryInstances = instances.filter((item) => !item.isInitial);
  const observedInitial = observed.slice(0, initialInstances.length);
  const observedOrdinary = observed.slice(initialInstances.length);
  if (!sameMultiset(initialInstances.map((item) => item.id), observedInitial)) {
    throw new Error(`開始時手札のIsInitialカード${initialInstances.length}枚を観測順の先頭に入力してください。`);
  }
  if (!sameMultiset(ordinaryInstances.map((item) => item.id), observedOrdinary)) {
    throw new Error("IsInitialカードを除いたカード構成が現在のデッキと一致しません。");
  }

  const originalTokens = instances.map((item) => item.token);
  const variantKeys = new Set();
  const variants = [];
  let truncated = false;
  const shouldStop = () => truncated;

  const addRawShuffleOrder = (rawOrder) => {
    if (variants.length >= maxVariants) {
      truncated = true;
      return;
    }
    const choices = deriveFisherYatesChoices(originalTokens, rawOrder.map((item) => item.token));
    const key = choices.map((item) => `${item.n}:${item.j}`).join(",");
    if (!variantKeys.has(key)) {
      variantKeys.add(key);
      variants.push(choices);
    }
  };

  // SetInitialCard hides the original positions of IsInitial cards.
  // If the observed opening is I0,I1,..., the shuffled Deck contained those
  // initial cards in the reverse relative order because the native loop scans
  // Deck from the last index down and appends each match to Hand.
  enumerateObservedTokenOrders(initialInstances, observedInitial, (visibleInitialOrder) => {
    const rawInitialOrder = visibleInitialOrder.slice().reverse();
    enumerateObservedTokenOrders(ordinaryInstances, observedOrdinary, (rawOrdinaryOrder) => {
      enumerateInterleavings(rawInitialOrder, rawOrdinaryOrder, addRawShuffleOrder, shouldStop);
    }, shouldStop);
  }, shouldStop);

  if (!variants.length) throw new Error("観測順からseed条件を作成できませんでした。");
  return {
    variants,
    truncated,
    instanceCount: instances.length,
    initialCount: initialInstances.length,
  };
}

// Backward-compatible entry point for callers introduced with the former
// hand-batch UI. Batch boundaries are intentionally ignored: the flattened
// card sequence is matched exactly in the order it was observed.
export function prepareSeedBatchSearch(cards, observedBatches) {
  const observed = (observedBatches ?? [])
    .flatMap((batch) => Array.isArray(batch) ? batch : [batch])
    .map((id) => String(id).trim())
    .filter(Boolean);
  const { variants, truncated } = deriveSeedChoiceVariants(cards, observed, 8192);
  if (truncated) {
    throw new Error("IsInitial位置や重複カードによるseed条件が8192通りを超えました。完全特定を保証できないため、編成または観測情報を確認してください。");
  }

  // Many raw shuffled orders differ only in the hidden position of IsInitial
  // cards and therefore share the same first Fisher-Yates interval. Group them
  // so the worker scans each seed interval once and ORs the full variants.
  const grouped = new Map();
  for (const choices of variants) {
    const first = choices[0];
    const key = first ? `${first.n}:${first.j}` : "all";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(choices);
  }
  const choiceGroups = [...grouped.values()].map((groupVariants) => ({
    variants: groupVariants,
    interval: seedIntervalFromChoices(groupVariants[0]),
  }));

  return {
    batches: observed.map((id) => [id]),
    choices: variants,
    choiceGroups,
    shuffleIds: null,
    shuffledBatches: null,
    prefixVariants: null,
  };
}

export function observationCardLabel(name, upgradeCount = 0) {
  const raw = String(name ?? "").trim();
  const base = raw.replace(/\s*\++\s*$/, "").trim() || raw;
  return `${base}${Number(upgradeCount ?? 0) > 0 ? "+" : ""}`;
}

export function splitObservedTurns(observedIds, drawPerTurn = 3) {
  const count = Number(drawPerTurn);
  if (!Number.isInteger(count) || count < 1) throw new Error("1ターンのドロー枚数が不正です。");
  const ids = (observedIds ?? []).map((id) => String(id).trim()).filter(Boolean);
  const turns = [];
  for (let offset = 0; offset < ids.length; offset += count) {
    turns.push(ids.slice(offset, offset + count));
  }
  return turns;
}

export function validateObservedDraws(cards, observedIds, drawPerTurn = 3) {
  const deckIds = makeCardInstances(cards).map((item) => item.id);
  if (!deckIds.length) throw new Error("デッキにカードがありません。");
  const observed = (observedIds ?? []).map((id) => String(id).trim()).filter(Boolean);
  if (observed.length < deckIds.length) {
    throw new Error(`seed探索には最初の${deckIds.length}ドローを入力してください（現在${observed.length}枚）。`);
  }

  const firstDeck = observed.slice(0, deckIds.length);
  if (!sameMultiset(deckIds, firstDeck)) {
    throw new Error("最初のデッキ1巡分のカード構成が現在のデッキと一致しません。重複枚数も確認してください。");
  }

  const allowed = multisetCounts(deckIds);
  for (const [turnIndex, turn] of splitObservedTurns(observed, drawPerTurn).entries()) {
    const counts = multisetCounts(turn);
    for (const [id, count] of counts) {
      if (!allowed.has(id)) {
        throw new Error(`${turnIndex + 1}ターン目に現在のデッキにないカード ${id} があります。`);
      }
      if (count > allowed.get(id)) {
        throw new Error(`${turnIndex + 1}ターン目でカード ${id} の枚数がデッキ内枚数を超えています。`);
      }
    }
  }
  return observed;
}

export function shuffleIdsWithState(inputIds, stateInput) {
  const deck = (inputIds ?? []).map(String);
  let state = Number(stateInput) >>> 0;
  for (let n = deck.length; n >= 2; n -= 1) {
    const j = Math.floor((state * n) / UINT32_SPACE);
    [deck[j], deck[n - 1]] = [deck[n - 1], deck[j]];
    state = xorshift32(state);
  }
  return { deck, state };
}

export function simulateTurnRecycleDraws(cards, seed, drawCount, drawPerTurn = 3) {
  const count = Number(drawCount);
  const perTurn = Number(drawPerTurn);
  if (!Number.isInteger(count) || count < 0) throw new Error("ドロー枚数は0以上の整数で指定してください。");
  if (!Number.isInteger(perTurn) || perTurn < 1) throw new Error("1ターンのドロー枚数が不正です。");
  const instances = makeCardInstances(cards);
  if (!instances.length) throw new Error("デッキにカードがありません。");

  let state = Number(seed) >>> 0;
  const byToken = new Map(instances.map((item) => [item.token, item]));
  const shuffled = shuffleIdsWithState(instances.map((item) => item.token), state);
  const shuffledInstances = shuffled.deck.map((token) => byToken.get(token));
  const opening = applyNativeInitialHandOrder(shuffledInstances, perTurn);
  const initialDeck = opening.visibleOrder.map((item) => item.id);
  let deck = opening.remainingDeck.map((item) => item.id);
  state = shuffled.state;
  let discard = [];
  let hand = opening.hand.map((item) => item.id);
  const draws = [];
  const recycleEvents = [];

  const appendVisible = (values) => {
    for (const value of values) {
      if (draws.length >= count) break;
      draws.push(value);
    }
  };

  appendVisible(hand);
  if (draws.length >= count) {
    return { seed: Number(seed) >>> 0, initialDeck, draws, remainingDeck: deck, discard, hand, recycleEvents, randomState: state };
  }

  // Seed identification observes the first pass while skipping. Once the
  // opening hand has been fully observed, ResetHand moves it to Grave.
  discard.push(...hand);
  hand = [];

  while (draws.length < count) {
    let completedTurn = true;
    for (let slot = 0; slot < perTurn && draws.length < count; slot += 1) {
      if (!deck.length) {
        if (!discard.length) {
          completedTurn = false;
          break;
        }
        const source = discard.slice();
        const recycled = shuffleIdsWithState(discard, state);
        deck = recycled.deck.slice();
        discard = [];
        state = recycled.state;
        recycleEvents.push({ drawIndex: draws.length, source, shuffled: deck.slice(), randomState: state });
      }
      if (!deck.length) {
        completedTurn = false;
        break;
      }
      const card = deck.shift();
      draws.push(card);
      hand.push(card);
    }
    if (draws.length >= count) break;
    if (!completedTurn && !deck.length && !discard.length) break;
    discard.push(...hand);
    hand = [];
  }

  return {
    seed: Number(seed) >>> 0,
    initialDeck,
    draws,
    remainingDeck: deck,
    discard,
    hand,
    recycleEvents,
    randomState: state,
  };
}

export function seedMatchesObservedDraws(seed, cards, observedIds, drawPerTurn = 3) {
  const observed = (observedIds ?? []).map(String);
  if (!cards?.length || !observed.length) return false;
  const simulated = simulateTurnRecycleDraws(cards, seed, observed.length, drawPerTurn);
  if (simulated.draws.length < observed.length) return false;
  return observed.every((expected, index) => String(simulated.draws[index]) === String(expected));
}

export function seedIntervalFromChoices(choices) {
  if (!choices?.length) return { start: 0, end: UINT32_SPACE, size: UINT32_SPACE };
  const { n, j } = choices[0];
  const start = Math.ceil((j * UINT32_SPACE) / n);
  const end = Math.ceil(((j + 1) * UINT32_SPACE) / n);
  return { start, end, size: end - start };
}

export function xorshift32(value) {
  let x = Number(value) >>> 0;
  x = (x ^ ((x << 13) >>> 0)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ ((x << 5) >>> 0)) >>> 0;
  return x >>> 0;
}

export function advanceXorshift32(value, stepsInput = 1) {
  const steps = Math.max(0, Math.trunc(Number(stepsInput) || 0));
  let state = Number(value) >>> 0;
  for (let index = 0; index < steps; index += 1) state = xorshift32(state);
  return state >>> 0;
}

function undoXorShiftLeft(value, shift) {
  const source = Number(value) >>> 0;
  let result = source;
  for (let amount = shift; amount < 32; amount += shift) {
    result = (result ^ ((source << amount) >>> 0)) >>> 0;
  }
  return result >>> 0;
}

function undoXorShiftRight(value, shift) {
  const source = Number(value) >>> 0;
  let result = source;
  for (let amount = shift; amount < 32; amount += shift) {
    result = (result ^ (source >>> amount)) >>> 0;
  }
  return result >>> 0;
}

export function rewindXorshift32(value, stepsInput = 1) {
  const steps = Math.max(0, Math.trunc(Number(stepsInput) || 0));
  let state = Number(value) >>> 0;
  for (let index = 0; index < steps; index += 1) {
    state = undoXorShiftLeft(state, 5);
    state = undoXorShiftRight(state, 17);
    state = undoXorShiftLeft(state, 13);
  }
  return state >>> 0;
}

export function seedMatchesChoices(seed, choices) {
  let state = Number(seed) >>> 0;
  for (const { n, j } of choices) {
    const mapped = Math.floor((state * n) / UINT32_SPACE);
    if (mapped !== j) return false;
    state = xorshift32(state);
  }
  return true;
}

export function scanSeedRange(choices, start, end, maxMatches = 128) {
  const out = [];
  const lo = Math.max(0, Math.trunc(Number(start)));
  const hi = Math.min(UINT32_SPACE, Math.trunc(Number(end)));
  for (let candidate = lo; candidate < hi; candidate += 1) {
    if (seedMatchesChoices(candidate, choices)) {
      out.push(candidate >>> 0);
      if (out.length >= maxMatches) break;
    }
  }
  return out;
}

export function mergeIntervals(intervals) {
  const sorted = intervals
    .map((item) => ({ start: Number(item.start), end: Number(item.end) }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else out.push({ ...item });
  }
  return out.map((item) => ({ ...item, size: item.end - item.start }));
}