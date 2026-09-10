'use strict';

const UINT32_SPACE = 0x100000000;

function xorshift32(value) {
  let x = Number(value) >>> 0;
  x = (x ^ ((x << 13) >>> 0)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ ((x << 5) >>> 0)) >>> 0;
  return x >>> 0;
}

function matchesChoices(seed, choices) {
  let state = Number(seed) >>> 0;
  for (let i = 0; i < choices.length; i += 1) {
    const choice = choices[i];
    const mapped = Math.floor((state * choice.n) / UINT32_SPACE);
    if (mapped !== choice.j) return false;
    state = xorshift32(state);
  }
  return true;
}

function shuffleIds(inputIds, stateInput) {
  const deck = inputIds.slice();
  let state = Number(stateInput) >>> 0;
  for (let n = deck.length; n >= 2; n -= 1) {
    const j = Math.floor((state * n) / UINT32_SPACE);
    const tmp = deck[j];
    deck[j] = deck[n - 1];
    deck[n - 1] = tmp;
    state = xorshift32(state);
  }
  return { deck, state };
}

function matchesObservedDraws(seed, deckIds, observedIds, drawPerTurn) {
  if (!observedIds.length) return true;
  const initial = shuffleIds(deckIds, Number(seed) >>> 0);
  let deck = initial.deck.slice();
  let discard = [];
  let hand = [];
  let state = initial.state;

  for (let observedIndex = 0; observedIndex < observedIds.length; observedIndex += 1) {
    const expected = String(observedIds[observedIndex]);
    if (!deck.length) {
      if (!discard.length) return false;
      const recycled = shuffleIds(discard, state);
      deck = recycled.deck;
      discard = [];
      state = recycled.state;
    }
    if (String(deck[0]) !== expected) return false;
    hand.push(deck.shift());
    if (hand.length === drawPerTurn) {
      discard.push(...hand);
      hand = [];
    }
  }
  return true;
}

function sameMultiset(a, b) {
  if (a.length !== b.length) return false;
  const counts = new Map();
  for (const value of a) counts.set(String(value), (counts.get(String(value)) || 0) + 1);
  for (const value of b) {
    const key = String(value);
    const count = counts.get(key) || 0;
    if (!count) return false;
    if (count === 1) counts.delete(key);
    else counts.set(key, count - 1);
  }
  return counts.size === 0;
}

function sameDeckRangeAsBatch(deck, start, end, batch) {
  const length = end - start;
  if (length !== batch.length) return false;
  if (length <= 30) {
    let used = 0;
    for (let deckIndex = start; deckIndex < end; deckIndex += 1) {
      let found = -1;
      for (let batchIndex = 0; batchIndex < length; batchIndex += 1) {
        if (!(used & (1 << batchIndex)) && deck[deckIndex] === batch[batchIndex]) {
          found = batchIndex;
          break;
        }
      }
      if (found < 0) return false;
      used |= 1 << found;
    }
    return true;
  }
  return sameMultiset(deck.slice(start, end), batch);
}

function restoreSeedDeck(deck, swapBySize, lastSize) {
  for (let n = lastSize; n <= deck.length; n += 1) {
    const j = swapBySize[n];
    const tmp = deck[j];
    deck[j] = deck[n - 1];
    deck[n - 1] = tmp;
  }
}

function matchesBatchPrefix(seed, batchSearch) {
  const variants = batchSearch.prefixVariants;
  const length = batchSearch.prefixLength;
  let state = Number(seed) >>> 0;
  let code = 0;
  for (let index = 0; index < length; index += 1) {
    const n = variants[0][index].n;
    code = (code * batchSearch.prefixBase) + Math.floor((state * n) / UINT32_SPACE);
    state = xorshift32(state);
  }
  return batchSearch.prefixCodes.has(code);
}

function matchesObservedBatches(seed, batchSearch) {
  if (!matchesBatchPrefix(seed, batchSearch)) return false;
  const deck = batchSearch.workDeck;
  const shuffledBatches = batchSearch.shuffledBatches;
  const swapBySize = batchSearch.swapBySize;
  let state = Number(seed) >>> 0;
  let batchIndex = shuffledBatches.length - 1;
  let batchEnd = deck.length;
  let batchStart = batchEnd - (shuffledBatches[batchIndex]?.length || 0);
  let lastSize = deck.length + 1;

  // Fisher-Yates fixes the deck from the end. Validate each completed draw
  // batch immediately so nearly every wrong seed exits after a few swaps.
  for (let n = deck.length; n >= 2; n -= 1) {
    const j = Math.floor((state * n) / UINT32_SPACE);
    const tmp = deck[j];
    deck[j] = deck[n - 1];
    deck[n - 1] = tmp;
    swapBySize[n] = j;
    lastSize = n;
    state = xorshift32(state);
    if (n - 1 === batchStart) {
      if (!sameDeckRangeAsBatch(deck, batchStart, batchEnd, shuffledBatches[batchIndex])) {
        restoreSeedDeck(deck, swapBySize, lastSize);
        return false;
      }
      batchIndex -= 1;
      batchEnd = batchStart;
      batchStart = batchEnd - (shuffledBatches[batchIndex]?.length || 0);
    }
  }
  if (batchIndex === 0) {
    if (!sameDeckRangeAsBatch(deck, 0, batchEnd, shuffledBatches[0])) {
      restoreSeedDeck(deck, swapBySize, lastSize);
      return false;
    }
    batchIndex -= 1;
  }
  restoreSeedDeck(deck, swapBySize, lastSize);
  return batchIndex < 0;
}

function matches(seed, choices, deckIds, observedIds, drawPerTurn, batchSearch) {
  if (batchSearch) {
    return matchesObservedBatches(seed, batchSearch);
  }
  if (!matchesChoices(seed, choices)) return false;
  if (observedIds.length <= deckIds.length) return true;
  return matchesObservedDraws(seed, deckIds, observedIds, drawPerTurn);
}

self.onmessage = (event) => {
  const message = event.data ?? {};
  if (message.type !== 'scan') return;
  const choices = Array.isArray(message.choices) ? message.choices : [];
  const deckIds = Array.isArray(message.deckIds) ? message.deckIds.map(String) : [];
  const observedIds = Array.isArray(message.observedIds) ? message.observedIds.map(String) : [];
  const drawPerTurn = Math.max(1, Math.trunc(Number(message.drawPerTurn ?? 3)));
  const start = Math.max(0, Math.trunc(Number(message.start ?? 0)));
  const end = Math.min(UINT32_SPACE, Math.trunc(Number(message.end ?? UINT32_SPACE)));
  const maxMatches = Math.max(1, Math.trunc(Number(message.maxMatches ?? 32)));
  const batchSearch = message.batchSearch && Array.isArray(message.batchSearch.shuffledBatches)
    ? {
      shuffleIds: Array.isArray(message.batchSearch.shuffleIds) ? message.batchSearch.shuffleIds.map(String) : [],
      shuffledBatches: message.batchSearch.shuffledBatches.map((batch) => Array.isArray(batch) ? batch.map(String) : []),
      prefixVariants: Array.isArray(message.batchSearch.prefixVariants)
        ? message.batchSearch.prefixVariants.map((variant) => variant.map((choice) => ({ n: Number(choice.n), j: Number(choice.j) })))
        : [[]],
    }
    : null;
  if (batchSearch) {
    batchSearch.workDeck = batchSearch.shuffleIds.slice();
    batchSearch.swapBySize = new Array(batchSearch.shuffleIds.length + 1);
    batchSearch.prefixLength = batchSearch.prefixVariants[0]?.length || 0;
    batchSearch.prefixBase = batchSearch.shuffleIds.length + 1;
    batchSearch.prefixCodes = new Set(batchSearch.prefixVariants.map((variant) => {
      let code = 0;
      for (const choice of variant) code = (code * batchSearch.prefixBase) + choice.j;
      return code;
    }));
  }
  const found = [];
  for (let candidate = start; candidate < end; candidate += 1) {
    if (matches(candidate, choices, deckIds, observedIds, drawPerTurn, batchSearch)) {
      found.push(candidate >>> 0);
      if (found.length >= maxMatches) break;
    }
  }
  self.postMessage({ type: 'done', taskId: message.taskId, start, end, scanned: end - start, found });
};
