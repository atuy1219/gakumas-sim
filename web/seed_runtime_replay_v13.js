import {
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  playTowerCard,
} from "./tower_runtime.js";

function cardId(card) {
  return String(card?.id ?? "");
}

function upgradeCount(card) {
  return Number(card?.upgradeCount ?? 0);
}

export function replayCardKey(card) {
  return `${cardId(card)}@@${upgradeCount(card)}`;
}

export function normalizeReplaySelector(selector) {
  if (typeof selector === "string") return { id: selector, upgradeCount: null, occurrence: 0 };
  const id = String(selector?.id ?? "").trim();
  if (!id) throw new Error("使用カードIDがありません。");
  const upgrade = selector?.upgradeCount === undefined || selector?.upgradeCount === null
    ? null
    : Number(selector.upgradeCount);
  const occurrence = Math.max(0, Number(selector?.occurrence ?? 0) || 0);
  return { id, upgradeCount: upgrade, occurrence };
}

export function findReplayHandIndex(hand, selectorInput) {
  const selector = normalizeReplaySelector(selectorInput);
  let occurrence = 0;
  for (let index = 0; index < (hand ?? []).length; index += 1) {
    const card = hand[index];
    if (cardId(card) !== selector.id) continue;
    if (selector.upgradeCount !== null && upgradeCount(card) !== selector.upgradeCount) continue;
    if (occurrence === selector.occurrence) return index;
    occurrence += 1;
  }
  return -1;
}

function sameVisibleOrder(actual, expected) {
  if (!Array.isArray(expected) || !expected.length) return true;
  if ((actual ?? []).length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (cardId(actual[index]) !== cardId(expected[index])) return false;
    const expectedUpgrade = expected[index]?.upgradeCount;
    if (expectedUpgrade !== undefined && expectedUpgrade !== null
        && upgradeCount(actual[index]) !== Number(expectedUpgrade)) return false;
  }
  return true;
}

function eventDrawsAfterRecycle(result, tracker, source, fallbackDrawn = [], fallbackOffset = 0) {
  const drawn = Array.isArray(result?.drawn)
    ? result.drawn
    : Array.isArray(fallbackDrawn)
      ? fallbackDrawn
      : [];
  const recycles = Array.isArray(result?.recycleEvents) ? result.recycleEvents : [];

  if (tracker.seen) {
    tracker.draws.push(...drawn.map((card) => ({ ...card, replaySource: source })));
    return;
  }
  if (!recycles.length) return;

  const first = recycles[0];
  const rawOffset = first?.drawOffset === undefined ? fallbackOffset : first.drawOffset;
  const offset = Math.max(0, Math.min(drawn.length, Number(rawOffset ?? 0) || 0));
  tracker.seen = true;
  tracker.event = first;
  tracker.draws.push(...drawn.slice(offset).map((card) => ({ ...card, replaySource: source })));
}

function resultHasUnsupported(state) {
  return Array.isArray(state?.unsupported) && state.unsupported.length > 0;
}

function isUnsupportedError(error) {
  const message = String(error?.message ?? error ?? "");
  return /未対応|unsupported/i.test(message);
}

function cloneHand(hand) {
  return (hand ?? []).map((card) => ({ ...card }));
}

/**
 * Replays user operations with the same runtime used by the tower simulator.
 *
 * turnScript is an array of:
 *   { plays: [{id, upgradeCount?, occurrence?}], ended: boolean }
 *
 * A turn is drawn before its plays are applied. When every supplied turn is
 * ended, the following turn is drawn automatically so the UI can display the
 * next live hand.
 */
export function replayTowerSeed(seedInput, cards, turnScript = [], options = {}) {
  const seed = Number(seedInput) >>> 0;
  const state = createTowerTurnState(cards, seed, options.cardById ?? new Map(), {
    cardVariantByKey: options.cardVariantByKey ?? new Map(),
    stamina: Number(options.stamina ?? 9999),
    targetScore: Number(options.targetScore ?? 0),
    pItems: options.pItems ?? [],
  });

  if (!sameVisibleOrder(state.initialDeck, options.expectedInitialOrder)) {
    return {
      seed,
      status: "initial-mismatch",
      state,
      currentHand: [],
      currentTurn: 0,
      recycleSeen: false,
      postRecycleDraws: [],
      trace: [],
      unsupported: [],
      error: null,
    };
  }

  const tracker = { seen: false, event: null, draws: [] };
  const trace = [];
  let openTurn = false;

  try {
    const script = Array.isArray(turnScript) ? turnScript : [];
    for (let turnIndex = 0; turnIndex < script.length; turnIndex += 1) {
      const step = script[turnIndex] ?? {};
      const deckBeforeDraw = state.deck.length;
      const draw = drawTowerTurn(state, Number(options.drawPerTurn ?? 3));
      const drawCards = Array.isArray(draw?.drawn) ? draw.drawn : draw?.hand ?? state.hand;
      eventDrawsAfterRecycle(draw, tracker, `turn-${state.turn}-draw`, drawCards, deckBeforeDraw);
      trace.push({
        type: "draw",
        turn: state.turn,
        hand: cloneHand(state.hand),
        drawn: cloneHand(drawCards),
        recycleEvents: draw?.recycleEvents ?? [],
      });

      for (const selectorInput of step.plays ?? []) {
        const selector = normalizeReplaySelector(selectorInput);
        const handIndex = findReplayHandIndex(state.hand, selector);
        if (handIndex < 0) {
          return {
            seed,
            status: "action-mismatch",
            state,
            currentHand: cloneHand(state.hand),
            currentTurn: state.turn,
            recycleSeen: tracker.seen,
            postRecycleDraws: cloneHand(tracker.draws),
            trace,
            unsupported: [...(state.unsupported ?? [])],
            error: `TURN ${state.turn}: ${selector.id} が手札にありません。`,
          };
        }
        const deckBeforePlay = state.deck.length;
        const play = playTowerCard(state, handIndex);
        eventDrawsAfterRecycle(play, tracker, `turn-${state.turn}-play`, play?.drawn ?? [], deckBeforePlay);
        trace.push({
          type: "play",
          turn: state.turn,
          selector,
          card: { ...play.card },
          hand: cloneHand(state.hand),
          drawn: cloneHand(play.drawn),
          effects: [...(play.effects ?? [])],
          recycleEvents: play.recycleEvents ?? [],
        });
      }

      if (step.ended) {
        const end = finishTowerTurn(state, { type: "end" });
        trace.push({ type: "end", turn: state.turn, entry: end, hand: [] });
        openTurn = false;
      } else {
        openTurn = true;
        break;
      }
    }

    if (!openTurn) {
      const deckBeforeDraw = state.deck.length;
      const draw = drawTowerTurn(state, Number(options.drawPerTurn ?? 3));
      const drawCards = Array.isArray(draw?.drawn) ? draw.drawn : draw?.hand ?? state.hand;
      eventDrawsAfterRecycle(draw, tracker, `turn-${state.turn}-draw`, drawCards, deckBeforeDraw);
      trace.push({
        type: "draw",
        turn: state.turn,
        hand: cloneHand(state.hand),
        drawn: cloneHand(drawCards),
        recycleEvents: draw?.recycleEvents ?? [],
      });
      openTurn = true;
    }

    return {
      seed,
      status: resultHasUnsupported(state) ? "uncertain" : "ok",
      state,
      currentHand: cloneHand(state.hand),
      currentTurn: state.turn,
      playsRemaining: Number(state.playsRemaining ?? 0),
      recycleSeen: tracker.seen,
      recycleEvent: tracker.event,
      postRecycleDraws: cloneHand(tracker.draws),
      trace,
      unsupported: [...(state.unsupported ?? [])],
      error: null,
    };
  } catch (error) {
    return {
      seed,
      status: isUnsupportedError(error) || resultHasUnsupported(state) ? "uncertain" : "runtime-error",
      state,
      currentHand: cloneHand(state.hand),
      currentTurn: state.turn,
      playsRemaining: Number(state.playsRemaining ?? 0),
      recycleSeen: tracker.seen,
      recycleEvent: tracker.event,
      postRecycleDraws: cloneHand(tracker.draws),
      trace,
      unsupported: [...(state.unsupported ?? [])],
      error: String(error?.message ?? error),
    };
  }
}

function observedPrefixStatus(result, observedIds) {
  const observed = (observedIds ?? []).map(String).filter(Boolean);
  if (!observed.length) return "match";
  if (!result.recycleSeen) return "pending";

  const predicted = result.postRecycleDraws.map(cardId);
  const comparable = Math.min(observed.length, predicted.length);
  for (let index = 0; index < comparable; index += 1) {
    if (observed[index] !== predicted[index]) return "mismatch";
  }
  return predicted.length >= observed.length ? "match" : "pending";
}

/**
 * Evaluates all first-pass seed candidates conservatively.
 * Unsupported runtime behavior is never used to discard a seed; it is kept in
 * `uncertain` so the UI cannot collapse valid candidates to zero simply because
 * the simulator does not understand an effect yet.
 */
export function evaluateTowerSeedCandidates(seeds, cards, turnScript = [], observedAfterRecycle = [], options = {}) {
  const uniqueSeeds = [...new Set((seeds ?? []).map((seed) => Number(seed) >>> 0))];
  const results = [];

  for (const seed of uniqueSeeds) {
    const replay = replayTowerSeed(seed, cards, turnScript, options);
    let status = replay.status;
    if (status === "ok") {
      const prefix = observedPrefixStatus(replay, observedAfterRecycle);
      if (prefix === "mismatch") status = "mismatch";
      else if (prefix === "pending") status = "pending";
      else status = "match";
    } else if (status === "uncertain") {
      status = "uncertain";
    }
    results.push({ ...replay, status });
  }

  const survivors = results.filter((result) => ["match", "pending", "uncertain"].includes(result.status));
  const certain = survivors.filter((result) => result.status !== "uncertain");
  const uncertain = survivors.filter((result) => result.status === "uncertain");
  const rejected = results.filter((result) => !survivors.includes(result));

  return {
    results,
    survivors,
    certain,
    uncertain,
    rejected,
    seeds: survivors.map((result) => result.seed),
  };
}

export function replayHandUnion(results) {
  const active = (results ?? []).filter((result) => ["match", "pending", "uncertain", "ok"].includes(result.status));
  const byKey = new Map();

  for (const result of active) {
    const counts = new Map();
    for (const card of result.currentHand ?? []) {
      const key = replayCardKey(card);
      const occurrence = counts.get(key) ?? 0;
      counts.set(key, occurrence + 1);
      const unionKey = `${key}@@${occurrence}`;
      const entry = byKey.get(unionKey) ?? {
        id: cardId(card),
        upgradeCount: upgradeCount(card),
        occurrence,
        sample: { ...card },
        seeds: new Set(),
      };
      entry.seeds.add(result.seed);
      byKey.set(unionKey, entry);
    }
  }

  return [...byKey.values()].map((entry) => ({
    ...entry,
    candidateCount: entry.seeds.size,
    seeds: [...entry.seeds],
  }));
}
