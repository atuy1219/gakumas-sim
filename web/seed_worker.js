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

function matchesObservedRounds(seed, deckIds, observedRounds) {
  if (!Array.isArray(observedRounds) || !observedRounds.length) return true;
  let deck = deckIds.slice();
  let state = Number(seed) >>> 0;
  for (let roundIndex = 0; roundIndex < observedRounds.length; roundIndex += 1) {
    const observed = observedRounds[roundIndex] ?? [];
    const shuffled = shuffleIds(deck, state);
    for (let index = 0; index < observed.length; index += 1) {
      if (String(shuffled.deck[index]) !== String(observed[index])) return false;
    }
    deck = shuffled.deck;
    state = shuffled.state;
  }
  return true;
}

function matches(seed, choices, deckIds, observedRounds) {
  return matchesChoices(seed, choices) && matchesObservedRounds(seed, deckIds, observedRounds);
}

self.onmessage = (event) => {
  const message = event.data ?? {};
  if (message.type !== 'scan') return;
  const choices = Array.isArray(message.choices) ? message.choices : [];
  const deckIds = Array.isArray(message.deckIds) ? message.deckIds.map(String) : [];
  const observedRounds = Array.isArray(message.observedRounds)
    ? message.observedRounds.map((round) => Array.isArray(round) ? round.map(String) : [])
    : [];
  const start = Math.max(0, Math.trunc(Number(message.start ?? 0)));
  const end = Math.min(UINT32_SPACE, Math.trunc(Number(message.end ?? UINT32_SPACE)));
  const maxMatches = Math.max(1, Math.trunc(Number(message.maxMatches ?? 32)));
  const found = [];
  for (let candidate = start; candidate < end; candidate += 1) {
    if (matches(candidate, choices, deckIds, observedRounds)) {
      found.push(candidate >>> 0);
      if (found.length >= maxMatches) break;
    }
  }
  self.postMessage({
    type: 'done',
    taskId: message.taskId,
    start,
    end,
    scanned: end - start,
    found,
  });
};
