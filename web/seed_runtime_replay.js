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

function rememberReplayUncertainty(state, value) {
  const text = String(value ?? "").trim();
  if (!text) return;
  if (!Array.isArray(state.unsupported)) state.unsupported = [];
  if (!state.unsupported.includes(text)) state.unsupported.push(text);
}

function forceObservedPlay(state, handIndex, error) {
  const card = state.hand?.[handIndex];
  if (!card) throw error;

  const reason = String(error?.message ?? error ?? "ランタイム状態を再現できませんでした");
  state.hand.splice(handIndex, 1);
  state.playsRemaining = Math.max(0, Number(state.playsRemaining ?? 0) - 1);
  if (state.exam) state.exam.cardPlayCount = Number(state.exam.cardPlayCount ?? 0) + 1;

  const onceOnly = Boolean(card.onceOnly)
    || String(card.playMovePositionType ?? "") === "ProduceCardMovePositionType_Lost";
  if (onceOnly) state.lost.push(card);
  else state.discard.push(card);

  rememberReplayUncertainty(state, `observed-play:${card.id}:${reason}`);
  const event = {
    card: { ...card },
    cost: [],
    effects: [`実機操作を優先してカードを使用済みにしました（判定保留: ${reason}）`],
    drawn: [],
    recycleEvents: [],
    onceOnly,
    observedFallback: true,
  };
  if (!Array.isArray(state.currentTurnPlays)) state.currentTurnPlays = [];
  state.currentTurnPlays.push(event);
  return event;
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
    drawPerTurn: Number(options.drawPerTurn ?? 3),
    handLimit: options.handLimit,
    stamina: Number(options.stamina ?? 9999),
    targetScore: Number(options.targetScore ?? 0),
    pItems: options.pItems ?? [],
    examEffectById: options.examEffectById ?? new Map(),
    examStatusEnchantById: options.examStatusEnchantById ?? new Map(),
    examTriggerById: options.examTriggerById ?? new Map(),
    cardSearchById: options.cardSearchById ?? new Map(),
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
      error: "1周目の観測順と初期手札/山札順が一致しません。",
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
        let play;
        try {
          play = playTowerCard(state, handIndex);
        } catch (error) {
          // This UI records an operation already observed on the real client.
          // If the simulator cannot reproduce the prerequisite status/cost/play
          // count because an earlier effect is unsupported, leaving the card in
          // hand makes the replay impossible to continue. Consume the observed
          // card physically and keep the candidate as uncertain instead of
          // pretending the real play never happened.
          play = forceObservedPlay(state, handIndex, error);
        }
        eventDrawsAfterRecycle(play, tracker, `turn-${state.turn}-play`, play?.drawn ?? [], deckBeforePlay);
        trace.push({
          type: "play",
          turn: state.turn,
          selector,
          card: { ...play.card },
          hand: cloneHand(state.hand),
          drawn: cloneHand(play.drawn),
          created: (play.created ?? []).map((entry) => ({
            ...entry,
            card: { ...entry.card },
          })),
          moved: (play.moved ?? []).map((entry) => ({
            ...entry,
            card: { ...entry.card },
          })),
          effects: [...(play.effects ?? [])],
          recycleEvents: play.recycleEvents ?? [],
          observedFallback: Boolean(play.observedFallback),
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

function visibleDrawPrefixStatus(result, observedIds) {
  const observed = (observedIds ?? []).map(String).filter(Boolean);
  if (!observed.length) return { status: "match", index: -1, expected: "", actual: "" };

  const predicted = [];
  for (const entry of result.trace ?? []) {
    if (entry?.type !== "draw" && entry?.type !== "play") continue;
    for (const card of entry.drawn ?? []) predicted.push(cardId(card));
  }

  const comparable = Math.min(observed.length, predicted.length);
  for (let index = 0; index < comparable; index += 1) {
    if (observed[index] !== predicted[index]) {
      return {
        status: "mismatch",
        index,
        expected: observed[index],
        actual: predicted[index],
      };
    }
  }
  return {
    status: predicted.length >= observed.length ? "match" : "pending",
    index: comparable,
    expected: observed[comparable] ?? "",
    actual: predicted[comparable] ?? "",
  };
}

function observedPrefixStatus(result, observedIds) {
  const observed = (observedIds ?? []).map(String).filter(Boolean);
  if (!observed.length) return { status: "match", index: -1, expected: "", actual: "" };
  if (!result.recycleSeen) return { status: "pending", index: 0, expected: observed[0] ?? "", actual: "" };

  const predicted = result.postRecycleDraws.map(cardId);
  const comparable = Math.min(observed.length, predicted.length);
  for (let index = 0; index < comparable; index += 1) {
    if (observed[index] !== predicted[index]) {
      return {
        status: "mismatch",
        index,
        expected: observed[index],
        actual: predicted[index],
      };
    }
  }
  return {
    status: predicted.length >= observed.length ? "match" : "pending",
    index: comparable,
    expected: observed[comparable] ?? "",
    actual: predicted[comparable] ?? "",
  };
}

/**
 * Evaluates all first-pass seed candidates conservatively.
 * Unsupported runtime behavior is never used to discard a seed; it is kept in
 * `uncertain` so the UI cannot collapse valid candidates to zero simply because
 * the simulator does not understand an effect yet.
 */
export function evaluateTowerSeedCandidates(seeds, cards, turnScript = [], observedAfterRecycle = [], options = {}) {
  const uniqueSeeds = [...new Set((seeds ?? []).map((seed) => Number(seed) >>> 0))];
  let results = [];

  for (const seed of uniqueSeeds) {
    const replay = replayTowerSeed(seed, cards, turnScript, options);
    let status = replay.status;
    let rejectionReason = replay.error || null;
    if (status === "ok") {
      const visiblePrefix = visibleDrawPrefixStatus(replay, options.observedDrawOrder);
      const recyclePrefix = observedPrefixStatus(replay, observedAfterRecycle);
      if (visiblePrefix.status === "mismatch") {
        status = "mismatch";
        rejectionReason = `1周目の観測 ${visiblePrefix.index + 1}枚目が不一致（実機: ${visiblePrefix.expected} / 再現: ${visiblePrefix.actual}）`;
      } else if (recyclePrefix.status === "mismatch") {
        status = "mismatch";
        rejectionReason = `再シャッフル後の観測 ${recyclePrefix.index + 1}枚目が不一致（実機: ${recyclePrefix.expected} / 再現: ${recyclePrefix.actual}）`;
      } else if (visiblePrefix.status === "pending" || recyclePrefix.status === "pending") {
        status = "pending";
        rejectionReason = null;
      } else {
        status = "match";
        rejectionReason = null;
      }
    } else if (status === "uncertain") {
      status = "uncertain";
      rejectionReason = null;
    }
    results.push({ ...replay, status, rejectionReason });
  }

  let survivors = results.filter((result) => ["match", "pending", "uncertain"].includes(result.status));
  const rejectedBeforeFallback = results.filter((result) => !survivors.includes(result));
  let conservativeFallback = false;

  // A real-device operation is stronger evidence than an incomplete replay
  // model. If every first-pass candidate disappears only because the runtime
  // replay disagrees with the observed operation/draw history, do not report a
  // mathematically false "0 candidates". Keep the candidates as uncertain and
  // surface the conflict so the user can continue observing or correct input.
  const recoverableStatuses = new Set(["mismatch", "action-mismatch"]);
  if (!survivors.length
      && results.length
      && results.every((result) => recoverableStatuses.has(result.status))) {
    conservativeFallback = true;
    results = results.map((result) => {
      const reason = result.rejectionReason || result.error || result.status;
      const conflict = `replay-conflict:${reason}`;
      return {
        ...result,
        originalStatus: result.status,
        status: "uncertain",
        unsupported: [...new Set([...(result.unsupported ?? []), conflict])],
      };
    });
    survivors = [...results];
  }

  const certain = survivors.filter((result) => result.status !== "uncertain");
  const uncertain = survivors.filter((result) => result.status === "uncertain");
  const rejected = results.filter((result) => !survivors.includes(result));

  return {
    results,
    survivors,
    certain,
    uncertain,
    rejected,
    rejectedBeforeFallback,
    conservativeFallback,
    seeds: survivors.map((result) => result.seed),
  };
}


export function replayUncertaintyLabel(reasonInput) {
  const reason = String(reasonInput ?? "").trim();
  if (!reason) return "原因不明";

  let match = reason.match(/^replay-conflict:(.*)$/s);
  if (match) return `実機操作と再現モデルが矛盾: ${match[1]}`;

  match = reason.match(/^observed-play:([^:]+):(.*)$/s);
  if (match) return `実機操作を優先: ${match[1]} — ${match[2]}`;

  match = reason.match(/^effect:(.+)$/s);
  if (match) return `未対応効果: ${match[1]}`;

  match = reason.match(/^play-trigger:(.+)$/s);
  if (match) return `未対応カード使用条件: ${match[1]}`;

  match = reason.match(/^trigger:(.+)$/s);
  if (match) return `未対応条件: ${match[1]}`;

  match = reason.match(/^card-create-count:(.+)$/s);
  if (match) return `生成枚数が可変: ${match[1]}`;

  match = reason.match(/^card-create-master:(.+)$/s);
  if (match) return `生成カード情報不足: ${match[1]}`;

  match = reason.match(/^card-create-position:(.+)$/s);
  if (match) return `未対応の生成位置: ${match[1]}`;

  match = reason.match(/^runtime:(.+)$/s);
  if (match) return `ランタイム判定保留: ${match[1]}`;

  return `未対応: ${reason}`;
}

export function summarizeReplayUncertainty(results) {
  const byReason = new Map();

  for (const result of results ?? []) {
    const rawReasons = Array.isArray(result?.unsupported)
      ? result.unsupported.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    if (!rawReasons.length && result?.error) rawReasons.push(`runtime:${String(result.error)}`);

    for (const reason of [...new Set(rawReasons)]) {
      const entry = byReason.get(reason) ?? {
        reason,
        label: replayUncertaintyLabel(reason),
        count: 0,
        seeds: [],
      };
      entry.count += 1;
      entry.seeds.push(Number(result?.seed) >>> 0);
      byReason.set(reason, entry);
    }
  }

  return [...byReason.values()].sort((a, b) =>
    b.count - a.count || a.label.localeCompare(b.label, "ja"));
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
