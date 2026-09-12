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

function matches(seed, choices, deckIds, observedIds, drawPerTurn) {
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
  const found = [];
  for (let candidate = start; candidate < end; candidate += 1) {
    if (matches(candidate, choices, deckIds, observedIds, drawPerTurn)) {
      found.push(candidate >>> 0);
      if (found.length >= maxMatches) break;
    }
  }
  self.postMessage({ type: 'done', taskId: message.taskId, start, end, scanned: end - start, found });
};
