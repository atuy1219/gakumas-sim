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

export function deriveSeedChoiceVariants(cards, observedIds, maxVariants = 64) {
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
  const shuffleInstances = instances.filter((item) => !item.isInitial);
  const observedInitial = observed.slice(0, initialInstances.length);
  const observedShuffled = observed.slice(initialInstances.length);
  if (!sameMultiset(initialInstances.map((item) => item.id), observedInitial)) {
    throw new Error(`開始時手札の${initialInstances.length}枚を観測順の先頭に入力してください。`);
  }
  if (!sameMultiset(shuffleInstances.map((item) => item.id), observedShuffled)) {
    throw new Error("開始時手札を除いたカードの構成が現在のデッキと一致しません。");
  }

  const tokensById = new Map();
  for (const instance of shuffleInstances) {
    if (!tokensById.has(instance.id)) tokensById.set(instance.id, []);
    tokensById.get(instance.id).push(instance.token);
  }
  const used = new Set();
  const finalTokens = new Array(observedShuffled.length);
  const variantKeys = new Set();
  const variants = [];
  let truncated = false;

  function addChoices() {
    const choices = deriveFisherYatesChoices(shuffleInstances.map((item) => item.token), finalTokens);
    const key = choices.map((item) => `${item.n}:${item.j}`).join(",");
    if (!variantKeys.has(key)) {
      variantKeys.add(key);
      variants.push(choices);
    }
  }

  function visit(index) {
    if (variants.length >= maxVariants) {
      truncated = true;
      return;
    }
    if (index >= observedShuffled.length) {
      addChoices();
      return;
    }
    const candidates = tokensById.get(observedShuffled[index]) ?? [];
    for (const token of candidates) {
      if (used.has(token)) continue;
      used.add(token);
      finalTokens[index] = token;
      visit(index + 1);
      used.delete(token);
      if (variants.length >= maxVariants) break;
    }
  }
  visit(0);
  if (!variants.length) throw new Error("観測順からseed条件を作成できませんでした。");
  return { variants, truncated, instanceCount: instances.length, initialCount: initialInstances.length };
}

// Backward-compatible entry point for callers introduced with the former
// hand-batch UI. Batch boundaries are intentionally ignored: the flattened
// card sequence is matched exactly in the order it was observed.
export function prepareSeedBatchSearch(cards, observedBatches) {
  const observed = (observedBatches ?? [])
    .flatMap((batch) => Array.isArray(batch) ? batch : [batch])
    .map((id) => String(id).trim())
    .filter(Boolean);
  const { variants, truncated } = deriveSeedChoiceVariants(cards, observed, 64);
  if (truncated) {
    throw new Error("同一カードの重複によるseed条件が64通りを超えました。完全特定を保証できないため、重複カードを見分けられる情報を追加してください。");
  }
  return {
    batches: observed.map((id) => [id]),
    choices: variants,
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
  const initialInstances = instances.filter((item) => item.isInitial);
  const shuffleInstances = instances.filter((item) => !item.isInitial);
  const initial = shuffleIdsWithState(shuffleInstances.map((item) => item.id), state);
  const initialDeck = [...initialInstances.map((item) => item.id), ...initial.deck];
  let deck = initialDeck.slice();
  state = initial.state;
  let discard = [];
  let hand = [];
  const draws = [];
  const recycleEvents = [];
  for (let drawIndex = 0; drawIndex < count; drawIndex += 1) {
    if (!deck.length) {
      if (!discard.length) break;
      const source = discard.slice();
      const recycled = shuffleIdsWithState(discard, state);
      deck = recycled.deck.slice();
      discard = [];
      state = recycled.state;
      recycleEvents.push({ drawIndex, source, shuffled: deck.slice(), randomState: state });
    }

    const card = deck.shift();
    draws.push(card);
    hand.push(card);
    if (hand.length === perTurn) {
      discard.push(...hand);
      hand = [];
    }
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
  const perTurn = Number(drawPerTurn);
  const observed = (observedIds ?? []).map(String);
  const instances = makeCardInstances(cards);
  if (!instances.length || !observed.length) return false;

  const initialInstances = instances.filter((item) => item.isInitial);
  const shuffleInstances = instances.filter((item) => !item.isInitial);
  const initial = shuffleIdsWithState(shuffleInstances.map((item) => item.id), Number(seed) >>> 0);
  let deck = [...initialInstances.map((item) => item.id), ...initial.deck];
  let discard = [];
  let hand = [];
  let state = initial.state;

  for (const expected of observed) {
    if (!deck.length) {
      if (!discard.length) return false;
      const recycled = shuffleIdsWithState(discard, state);
      deck = recycled.deck;
      discard = [];
      state = recycled.state;
    }
    if (String(deck[0]) !== String(expected)) return false;
    hand.push(deck.shift());
    if (hand.length === perTurn) {
      // seed特定時は毎ターンスキップするため、使用カード分岐は存在しない。
      discard.push(...hand);
      hand = [];
    }
  }
  return true;
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