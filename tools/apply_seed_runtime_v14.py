from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"marker not found in {path}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"marker is not unique in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_between(path, start, end, replacement):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    a = text.find(start)
    if a < 0:
        raise SystemExit(f"start marker not found in {path}: {start!r}")
    b = text.find(end, a)
    if b < 0:
        raise SystemExit(f"end marker not found in {path}: {end!r}")
    p.write_text(text[:a] + replacement + text[b:], encoding="utf-8")


# engine.js: the native shuffle consumes RNG for the complete pool.  Cards with
# "lesson start hand" are moved after the shuffle while preserving relative
# order, so they must not be removed from Fisher-Yates beforehand.
replace_between(
    "web/engine.js",
    "export function simulateCards(cards, seedInput, drawCount = 5) {",
    "export function simulateDistribution(deckText, seedText, drawCount) {",
    '''export function applyInitialHandOrdering(inputCards) {
  const initial = [];
  const rest = [];
  for (const card of inputCards ?? []) {
    (card?.isInitial ? initial : rest).push(card);
  }
  return [...initial, ...rest];
}

export function simulateCards(cards, seedInput, drawCount = 5) {
  const seed = typeof seedInput === "number" ? seedInput >>> 0 : parseSeed(seedInput);
  const count = Number(drawCount);
  if (!Number.isInteger(count) || count < 0) throw new Error("ドロー枚数は0以上の整数で入力してください。");
  if (!Array.isArray(cards) || !cards.length) throw new Error("カードを1枚以上指定してください。");
  const result = shuffleDeck(cards.map((card) => normalizeProduceCard(card, { source: card.source })), seed);
  const initialDeck = applyInitialHandOrdering(result.cards);
  return {
    seed,
    initialDeck,
    draw: initialDeck.slice(0, count),
    remainingDeck: initialDeck.slice(count),
    randomState: result.randomState,
    fixedOrder: result.fixedOrder,
  };
}

''',
)

# sim_v3.js: reverse the stable-partition observation.  The observed order tells
# us the relative order inside initial/non-initial groups, but not how those two
# groups were interleaved immediately after Fisher-Yates.  Enumerate those legal
# interleavings (and duplicate-card token assignments) rather than pretending
# initial cards were absent from the shuffle.
replace_between(
    "web/sim_v3.js",
    "export function deriveSeedChoiceVariants(cards, observedIds, maxVariants = 64) {",
    "// Backward-compatible entry point for callers introduced with the former",
    '''function resolveObservedTokenOrders(instances, observedIds, limit, onOrder) {
  const tokensById = new Map();
  for (const instance of instances) {
    if (!tokensById.has(instance.id)) tokensById.set(instance.id, []);
    tokensById.get(instance.id).push(instance.token);
  }
  const used = new Set();
  const order = new Array(observedIds.length);
  let stopped = false;

  function visit(index) {
    if (stopped) return;
    if (index >= observedIds.length) {
      if (onOrder(order.slice()) === false) stopped = true;
      return;
    }
    for (const token of tokensById.get(observedIds[index]) ?? []) {
      if (used.has(token)) continue;
      used.add(token);
      order[index] = token;
      visit(index + 1);
      used.delete(token);
      if (stopped) return;
    }
  }
  visit(0);
  return !stopped;
}

function visitStablePartitionInterleavings(initialOrder, restOrder, limit, onOrder) {
  const raw = new Array(initialOrder.length + restOrder.length);
  let emitted = 0;
  let stopped = false;

  function visit(initialIndex, restIndex, outIndex) {
    if (stopped) return;
    if (outIndex >= raw.length) {
      emitted += 1;
      if (emitted > limit || onOrder(raw.slice()) === false) stopped = true;
      return;
    }
    if (initialIndex < initialOrder.length) {
      raw[outIndex] = initialOrder[initialIndex];
      visit(initialIndex + 1, restIndex, outIndex + 1);
    }
    if (restIndex < restOrder.length && !stopped) {
      raw[outIndex] = restOrder[restIndex];
      visit(initialIndex, restIndex + 1, outIndex + 1);
    }
  }
  visit(0, 0, 0);
  return { emitted, complete: !stopped };
}

export function deriveSeedChoiceVariants(cards, observedIds, maxVariants = 8192) {
  const instances = makeCardInstances(cards);
  const observed = observedIds.map((id) => String(id).trim()).filter(Boolean);
  if (observed.length !== instances.length) {
    throw new Error(`観測順はデッキ全${instances.length}枚を入力してください（現在${observed.length}枚）。`);
  }
  if (!sameMultiset(instances.map((item) => item.id), observed)) {
    throw new Error("観測順のカード構成が現在のデッキと一致しません。重複枚数も確認してください。");
  }

  const initialInstances = instances.filter((item) => item.isInitial);
  const restInstances = instances.filter((item) => !item.isInitial);
  const observedInitial = observed.slice(0, initialInstances.length);
  const observedRest = observed.slice(initialInstances.length);
  if (!sameMultiset(initialInstances.map((item) => item.id), observedInitial)) {
    throw new Error(`開始時手札の${initialInstances.length}枚は、実機の安定移動後は観測順の先頭に並びます。入力順を確認してください。`);
  }
  if (!sameMultiset(restInstances.map((item) => item.id), observedRest)) {
    throw new Error("開始時手札以外のカード構成が現在のデッキと一致しません。");
  }

  const originalTokens = instances.map((item) => item.token);
  const variants = [];
  const variantKeys = new Set();
  let truncated = false;

  const addRawOrder = (rawTokens) => {
    const choices = deriveFisherYatesChoices(originalTokens, rawTokens);
    const key = choices.map((item) => `${item.n}:${item.j}`).join(",");
    if (!variantKeys.has(key)) {
      variantKeys.add(key);
      variants.push(choices);
    }
    if (variants.length >= maxVariants) {
      truncated = true;
      return false;
    }
    return true;
  };

  resolveObservedTokenOrders(initialInstances, observedInitial, maxVariants, (initialOrder) => {
    let keepGoing = true;
    resolveObservedTokenOrders(restInstances, observedRest, maxVariants, (restOrder) => {
      const result = visitStablePartitionInterleavings(
        initialOrder,
        restOrder,
        Math.max(1, maxVariants - variants.length),
        addRawOrder,
      );
      if (!result.complete || variants.length >= maxVariants) {
        truncated = true;
        keepGoing = false;
        return false;
      }
      return true;
    });
    return keepGoing;
  });

  if (!variants.length) throw new Error("観測順からseed条件を作成できませんでした。");
  return {
    variants,
    truncated,
    instanceCount: instances.length,
    initialCount: initialInstances.length,
    model: "shuffle-all-then-stable-initial-v14",
  };
}

''',
)

replace_once(
    "web/sim_v3.js",
    "  const { variants, truncated } = deriveSeedChoiceVariants(cards, observed, 64);\n  if (truncated) {\n    throw new Error(\"同一カードの重複によるseed条件が64通りを超えました。完全特定を保証できないため、重複カードを見分けられる情報を追加してください。\");\n  }",
    "  const { variants, truncated } = deriveSeedChoiceVariants(cards, observed, 8192);\n  if (truncated) {\n    throw new Error(\"開始時手札のシャッフル位置または同一カードの重複によりseed条件が8,192通りを超えました。この入力だけでは完全探索が重すぎるため、開始時手札を減らすか実機ログを追加してください。\");\n  }",
)

# Add a token-aware helper for seed simulation.  IDs alone are insufficient
# when one duplicate is initial and another duplicate is not.
replace_once(
    "web/sim_v3.js",
    "  return { deck, state };\n}\n\nexport function simulateTurnRecycleDraws",
    '''  return { deck, state };
}

function initialDeckFromSeedInstances(instances, stateInput) {
  const byToken = new Map(instances.map((item) => [item.token, item]));
  const shuffled = shuffleIdsWithState(instances.map((item) => item.token), stateInput);
  const orderedTokens = [
    ...shuffled.deck.filter((token) => byToken.get(token)?.isInitial),
    ...shuffled.deck.filter((token) => !byToken.get(token)?.isInitial),
  ];
  return {
    deck: orderedTokens.map((token) => byToken.get(token)?.id ?? String(token)),
    tokens: orderedTokens,
    state: shuffled.state,
  };
}

function firstTurnDrawCount(instances, drawPerTurn) {
  const initialCount = instances.filter((item) => item.isInitial).length;
  return Math.min(Math.max(drawPerTurn, initialCount), 5);
}

export function simulateTurnRecycleDraws''',
)

replace_once(
    "web/sim_v3.js",
    '''  let state = Number(seed) >>> 0;
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
  for (let drawIndex = 0; drawIndex < count; drawIndex += 1) {''',
    '''  let state = Number(seed) >>> 0;
  const initial = initialDeckFromSeedInstances(instances, state);
  const initialDeck = initial.deck.slice();
  let deck = initialDeck.slice();
  state = initial.state;
  let discard = [];
  let hand = [];
  let turnDrawTarget = firstTurnDrawCount(instances, perTurn);
  const draws = [];
  const recycleEvents = [];
  for (let drawIndex = 0; drawIndex < count; drawIndex += 1) {''',
)
replace_once(
    "web/sim_v3.js",
    '''    hand.push(card);
    if (hand.length === perTurn) {
      discard.push(...hand);
      hand = [];
    }
  }

  return {''',
    '''    hand.push(card);
    if (hand.length === turnDrawTarget) {
      discard.push(...hand);
      hand = [];
      turnDrawTarget = perTurn;
    }
  }

  return {''',
)

replace_once(
    "web/sim_v3.js",
    '''  const initialInstances = instances.filter((item) => item.isInitial);
  const shuffleInstances = instances.filter((item) => !item.isInitial);
  const initial = shuffleIdsWithState(shuffleInstances.map((item) => item.id), Number(seed) >>> 0);
  let deck = [...initialInstances.map((item) => item.id), ...initial.deck];
  let discard = [];
  let hand = [];
  let state = initial.state;

  for (const expected of observed) {''',
    '''  const initial = initialDeckFromSeedInstances(instances, Number(seed) >>> 0);
  let deck = initial.deck.slice();
  let discard = [];
  let hand = [];
  let state = initial.state;
  let turnDrawTarget = firstTurnDrawCount(instances, perTurn);

  for (const expected of observed) {''',
)
replace_once(
    "web/sim_v3.js",
    '''    hand.push(deck.shift());
    if (hand.length === perTurn) {
      // seed特定時は毎ターンスキップするため、使用カード分岐は存在しない。
      discard.push(...hand);
      hand = [];
    }
  }
  return true;''',
    '''    hand.push(deck.shift());
    if (hand.length === turnDrawTarget) {
      // seed特定時は毎ターンスキップするため、使用カード分岐は存在しない。
      discard.push(...hand);
      hand = [];
      turnDrawTarget = perTurn;
    }
  }
  return true;''',
)

# tower_runtime.js: use the same native-shaped model for live replay.
replace_between(
    "web/tower_runtime.js",
    "function shuffleObjectsWithState(input, stateInput) {",
    "export function createTowerTurnState(cards, seedInput, cardById = new Map(), options = {}) {",
    '''function stableInitialPartition(cards) {
  const initial = [];
  const rest = [];
  for (const card of cards) (card?.isInitial ? initial : rest).push(card);
  return [...initial, ...rest];
}

function shuffleObjectsWithState(input, stateInput) {
  const deck = input.map((item) => ({ ...item }));
  const rng = new XorShift32(Number(stateInput) >>> 0);
  const fixedOrder = deck.some((card) => Number(card.fixedDeckOrder ?? 0) > 0);
  if (fixedOrder) {
    deck.sort((a, b) => Number(a.fixedDeckOrder ?? 0) - Number(b.fixedDeckOrder ?? 0));
    return { deck, randomState: rng.state >>> 0, fixedOrder: true };
  }
  for (let n = deck.length; n >= 2; n -= 1) {
    const j = rng.nextInt(0, n);
    [deck[j], deck[n - 1]] = [deck[n - 1], deck[j]];
  }
  return { deck, randomState: rng.state >>> 0, fixedOrder: false };
}

''',
)

replace_once(
    "web/tower_runtime.js",
    '''  const initialCards = instances.filter((card) => card.isInitial);
  const shuffled = shuffleObjectsWithState(instances.filter((card) => !card.isInitial), seed);
  const initial = { ...shuffled, deck: [...initialCards, ...shuffled.deck] };
  return {
    seed,
    randomState: initial.randomState,
    initialDeck: initial.deck.map((card) => ({ ...card })),
    deck: initial.deck.map((card) => ({ ...card })),''',
    '''  const shuffled = shuffleObjectsWithState(instances, seed);
  const initialDeck = stableInitialPartition(shuffled.deck);
  const initialCardCount = initialDeck.filter((card) => card.isInitial).length;
  const handLimit = Math.max(1, Number(options.handLimit ?? 5) || 5);
  const initialUnsupported = initialCardCount >= 8
    ? ["initial-hand>=8: 実機で2ターン目の開始時手札が2/3枚に分岐する条件は未確定"]
    : [];
  return {
    seed,
    seedModel: "shuffle-all-then-stable-initial-v14",
    randomState: shuffled.randomState,
    initialDeck: initialDeck.map((card) => ({ ...card })),
    deck: initialDeck.map((card) => ({ ...card })),''',
)
replace_once(
    "web/tower_runtime.js",
    '''    hand: [],
    turn: 0,
    recycleCount: 0,''',
    '''    hand: [],
    handLimit,
    initialCardCount,
    turn: 0,
    recycleCount: 0,''',
)
replace_once(
    "web/tower_runtime.js",
    '''    unsupported: [],
    timers: [],''',
    '''    unsupported: initialUnsupported,
    timers: [],''',
)

replace_between(
    "web/tower_runtime.js",
    "function drawCardsIntoHand(state, count) {",
    "export function drawTowerTurn(state, drawCount = 3) {",
    '''function drawCardsIntoHand(state, count) {
  const recycleEvents = [];
  const drawn = [];
  const overflow = [];
  for (let i = 0; i < count; i += 1) {
    if (!state.deck.length) {
      const event = recycleIfNeeded(state);
      if (event) recycleEvents.push(event);
    }
    if (!state.deck.length) break;
    const card = state.deck.shift();
    drawn.push(card);
    if (state.hand.length < Number(state.handLimit ?? 5)) state.hand.push(card);
    else {
      state.discard.push(card);
      overflow.push(card);
    }
  }
  return { drawn, overflow, recycleEvents };
}

''',
)
replace_once(
    "web/tower_runtime.js",
    '''  const extraDraw = Math.max(0, Number(state.pendingDraw ?? 0));
  state.pendingDraw = 0;
  const result = drawCardsIntoHand(state, count + extraDraw);''',
    '''  const extraDraw = Math.max(0, Number(state.pendingDraw ?? 0));
  state.pendingDraw = 0;
  const baseDraw = state.turn === 1
    ? Math.min(Math.max(count, Number(state.initialCardCount ?? 0)), Number(state.handLimit ?? 5))
    : count;
  const result = drawCardsIntoHand(state, baseDraw + extraDraw);''',
)
replace_once(
    "web/tower_runtime.js",
    '''  return { turn: state.turn, hand: state.hand.map((card) => ({ ...card })), recycleEvents: result.recycleEvents };''',
    '''  return {
    turn: state.turn,
    hand: state.hand.map((card) => ({ ...card })),
    drawn: result.drawn.map((card) => ({ ...card })),
    overflow: result.overflow.map((card) => ({ ...card })),
    recycleEvents: result.recycleEvents,
  };''',
)

# seed_worker.js: scan one seed interval once even when several raw interleavings
# share the same first Fisher-Yates choice.  A trie evaluates all variants with a
# single PRNG walk per candidate.
Path("web/seed_worker.js").write_text(r'''\'use strict\';

const UINT32_SPACE = 0x100000000;

function xorshift32(value) {
  let x = Number(value) >>> 0;
  x = (x ^ ((x << 13) >>> 0)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ ((x << 5) >>> 0)) >>> 0;
  return x >>> 0;
}

function buildChoiceTrie(choiceVariants) {
  const root = { n: null, children: new Map(), terminal: false };
  for (const choices of choiceVariants) {
    let node = root;
    for (const choice of choices ?? []) {
      if (node.n === null) node.n = Number(choice.n);
      if (node.n !== Number(choice.n)) throw new Error('choice variants have inconsistent depth');
      const j = Number(choice.j);
      if (!node.children.has(j)) node.children.set(j, { n: null, children: new Map(), terminal: false });
      node = node.children.get(j);
    }
    node.terminal = true;
  }
  return root;
}

function matchesChoiceTrie(seed, trie) {
  let state = Number(seed) >>> 0;
  let node = trie;
  while (node) {
    if (node.terminal) return true;
    if (node.n === null) return false;
    const mapped = Math.floor((state * node.n) / UINT32_SPACE);
    node = node.children.get(mapped);
    if (!node) return false;
    state = xorshift32(state);
  }
  return false;
}

self.onmessage = (event) => {
  const message = event.data ?? {};
  if (message.type !== 'scan') return;
  const variants = Array.isArray(message.choiceVariants) && message.choiceVariants.length
    ? message.choiceVariants
    : [Array.isArray(message.choices) ? message.choices : []];
  const trie = buildChoiceTrie(variants);
  const start = Math.max(0, Math.trunc(Number(message.start ?? 0)));
  const end = Math.min(UINT32_SPACE, Math.trunc(Number(message.end ?? UINT32_SPACE)));
  const maxMatches = Math.max(1, Math.trunc(Number(message.maxMatches ?? 32)));
  const found = [];
  let scanned = 0;
  for (let candidate = start; candidate < end; candidate += 1) {
    scanned += 1;
    if (matchesChoiceTrie(candidate, trie)) {
      found.push(candidate >>> 0);
      if (found.length >= maxMatches) break;
    }
  }
  self.postMessage({ type: 'done', taskId: message.taskId, start, end, scanned, found });
};
'''.replace("\\'use strict\\';", "'use strict';"), encoding="utf-8")

# app_v3.js: group overlapping first-choice intervals and send all variants to
# one worker task.  This removes duplicate scans introduced by stable partition
# ambiguity and by duplicate cards.
replace_once(
    "web/app_v3.js",
    '''    const tasks = [];
    let total = 0;
    prepared.choices.forEach((choices) => {
      const interval = seedIntervalFromChoices(choices);
      total += interval.size;
      for (let start = interval.start; start < interval.end; start += SEED_TASK_SIZE) {
        tasks.push({ choices, start, end: Math.min(interval.end, start + SEED_TASK_SIZE) });
      }
    });''',
    '''    const groups = new Map();
    for (const choices of prepared.choices) {
      const interval = seedIntervalFromChoices(choices);
      const key = `${interval.start}:${interval.end}`;
      if (!groups.has(key)) groups.set(key, { interval, choiceVariants: [] });
      groups.get(key).choiceVariants.push(choices);
    }
    const tasks = [];
    let total = 0;
    for (const group of groups.values()) {
      total += group.interval.size;
      for (let start = group.interval.start; start < group.interval.end; start += SEED_TASK_SIZE) {
        tasks.push({
          choiceVariants: group.choiceVariants,
          start,
          end: Math.min(group.interval.end, start + SEED_TASK_SIZE),
        });
      }
    }''',
)
replace_once(
    "web/app_v3.js",
    '''          choices: task.choices,
          batchSearch: { shuffleIds: prepared.shuffleIds, shuffledBatches: prepared.shuffledBatches, prefixVariants: prepared.prefixVariants },''',
    '''          choiceVariants: task.choiceVariants,
          batchSearch: { shuffleIds: prepared.shuffleIds, shuffledBatches: prepared.shuffledBatches, prefixVariants: prepared.prefixVariants },''',
)
replace_once(
    "web/app_v3.js",
    '''    renderSeedCandidates([], 0, total, false, `${observationSummary}を使用。各ドロー内は順不同。探索対象 ${total.toLocaleString()}状態。`);''',
    '''    renderSeedCandidates([], 0, total, false, `${observationSummary}を入力順どおり厳密照合。開始時手札も含む全カードのシャッフル状態を探索します。探索対象 ${total.toLocaleString()}状態。`);''',
)

# Regression tests: initial-hand cards still appear first after the stable move,
# but RNG state must be exactly the state after shuffling the complete deck.
replace_once(
    "test_v3.mjs",
    '''assert.equal(initialRun.initialDeck[0], "B");
const initialDerived = deriveSeedChoiceVariants(initialCards, initialRun.initialDeck);''',
    '''assert.equal(initialRun.initialDeck[0], "B");
const noInitialState = simulateTurnRecycleDraws(
  initialCards.map((card) => ({ ...card, isInitial: false })),
  seed,
  initialCards.length,
  3,
).randomState;
assert.equal(initialRun.randomState, noInitialState, "isInitial must not reduce Fisher-Yates RNG consumption");
const initialDerived = deriveSeedChoiceVariants(initialCards, initialRun.initialDeck);''',
)
replace_once(
    "test_v3.mjs",
    '''assert.ok(duplicateInitialDerived.variants.some((variant) => seedMatchesChoices(12345, variant)));

const monte = runOrderMonteCarlo''',
    '''assert.ok(duplicateInitialDerived.variants.some((variant) => seedMatchesChoices(12345, variant)));

const fourInitial = ["A", "B", "C", "D", "E", "F"].map((id, index) => ({ id, isInitial: index < 4 }));
const fourInitialRun = simulateTurnRecycleDraws(fourInitial, 98765, 4, 3);
assert.equal(fourInitialRun.initialDeck.slice(0, 4).every((id) => ["A", "B", "C", "D"].includes(id)), true);
assert.equal(fourInitialRun.hand.length, 0, "four initial cards form the complete first hand");
assert.equal(fourInitialRun.discard.length, 4);

const sixInitial = ["A", "B", "C", "D", "E", "F", "G"].map((id, index) => ({ id, isInitial: index < 6 }));
const sixInitialRun = simulateTurnRecycleDraws(sixInitial, 24680, 5, 3);
assert.equal(sixInitialRun.hand.length, 0, "first hand is capped at five cards");
assert.equal(sixInitialRun.discard.length, 5);

const monte = runOrderMonteCarlo''',
)

print("seed runtime v14 patch applied")
