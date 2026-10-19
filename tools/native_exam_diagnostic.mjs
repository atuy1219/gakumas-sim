import { createHash } from "node:crypto";
import { createTowerTurnState, drawTowerTurn, finishTowerTurn, playTowerCard } from "../web/tower_runtime.js";

/**
 * Native-trace diagnostic. Device evidence is immutable input. Never replace it
 * with simulator values, and never claim full parity from a partial capture.
 */
export function parseNativeTrace(text) {
  const events = [];
  const warnings = [];
  for (const [index, raw] of String(text ?? "").split(/\r?\n/).entries()) {
    if (!raw.trim()) continue;
    try {
      const event = JSON.parse(raw);
      if (event && typeof event === "object" && typeof event.event === "string") {
        events.push(event);
      } else {
        warnings.push({ line: index + 1, reason: "invalid-event-schema" });
      }
    } catch (error) {
      warnings.push({ line: index + 1, reason: "invalid-json", message: String(error.message) });
    }
  }
  return { events, warnings };
}

export function stepXorShift32(value) {
  let x = Number(value) >>> 0;
  x = (x ^ ((x << 13) >>> 0)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ ((x << 5) >>> 0)) >>> 0;
  return x >>> 0;
}

export function verifyNativeRandom(events) {
  const simulated = [];
  const differences = [];
  for (const event of events) {
    if (event.event !== "GetRandomInt") continue;
    if (!Number.isInteger(event.before) || !Number.isInteger(event.after)) {
      differences.push({ seq: event.seq ?? null, field: "rng", kind: "unverifiable", reason: "missing-state" });
      continue;
    }
    const before = event.before >>> 0;
    const after = stepXorShift32(before);
    // The native range overload maps the old PRNG state using high 32 bits,
    // then advances the generator. The no-argument overload's return
    // convention is intentionally not inferred.
    let predictedResult = null;
    if (event.overload === "range" && Number.isInteger(event.minimum)
      && Number.isInteger(event.maximum) && event.maximum > event.minimum) {
      const width = BigInt(event.maximum - event.minimum);
      predictedResult = event.minimum + Number((BigInt(before) * width) >> 32n);
    }
    simulated.push({
      seq: event.seq ?? null, turn: event.turn ?? null, event: "GetRandomInt",
      before, after, result: predictedResult, callerRva: event.callerRva ?? null,
    });
    if ((event.after >>> 0) !== after) {
      differences.push({
        seq: event.seq ?? null, turn: event.turn ?? null,
        field: "randomState", actual: event.after >>> 0, simulated: after, kind: "mismatch",
      });
    }
    if (predictedResult !== null && event.result !== predictedResult) {
      differences.push({
        seq: event.seq ?? null, turn: event.turn ?? null,
        field: "randomResult", actual: event.result, simulated: predictedResult, kind: "mismatch",
      });
    }
  }
  return { simulated, differences };
}

function summarizeCards(cards) {
  return (cards ?? []).map((card) => ({
    id: String(card?.id ?? card?.produceCardId ?? ""),
    upgradeCount: Number(card?.upgradeCount ?? 0),
  }));
}
function poolOf(state, name) {
  if (name === "grave") return summarizeCards(state.discard);
  return summarizeCards(state[name]);
}
function sameCards(actual, simulated) {
  if (!Array.isArray(actual) || actual.length !== simulated.length) return false;
  return actual.every((card, i) =>
    String(card?.id ?? "") === simulated[i].id
    && Number(card?.upgradeCount ?? 0) === simulated[i].upgradeCount);
}
function snapshot(state) {
  return {
    turn: state.turn ?? null,
    randomState: state.randomState == null ? null : (state.randomState >>> 0),
    hand: poolOf(state, "hand"), deck: poolOf(state, "deck"),
    grave: poolOf(state, "grave"), lost: poolOf(state, "lost"), hold: poolOf(state, "hold"),
    exam: state.exam ? {
      parameter: state.exam.parameter ?? null,
      stamina: state.exam.stamina ?? null,
      review: state.exam.review ?? null,
      block: state.exam.block ?? null,
    } : null,
    unsupported: [...(state.unsupported ?? [])],
  };
}
function mapping(values) {
  return new Map((values ?? []).map((entry) => [String(entry.id), entry]));
}
function resolveDeck(cardsPayload, profile) {
  const fromCapture = cardsPayload?.produceCards;
  const deck = Array.isArray(profile?.initialDeck) ? profile.initialDeck : fromCapture;
  if (!Array.isArray(deck) || deck.length === 0) throw new Error("初期デッキがありません");
  return deck.filter((card) => !card.deleted).map((card) => ({
    id: String(card.id ?? card.produceCardId ?? ""),
    upgradeCount: Number(card.upgradeCount ?? 0),
    customizes: card.customizes ?? [],
  }));
}
function compareCheckpoint(real, predicted, { compareRandom = false } = {}) {
  const differences = [];
  for (const field of ["hand", "deck", "grave", "lost", "hold"]) {
    if (!Array.isArray(real[field])) continue;
    if (!sameCards(real[field], predicted[field])) {
      differences.push({ field, kind: "mismatch",
        actual: summarizeCards(real[field]), simulated: predicted[field] });
    }
  }
  if (compareRandom && Number.isInteger(real.randomState)
    && (real.randomState >>> 0) !== predicted.randomState) {
    differences.push({ field: "randomState", kind: "mismatch",
      actual: real.randomState >>> 0, simulated: predicted.randomState });
  }
  for (const field of ["parameter", "stamina", "review", "block"]) {
    if (!Number.isFinite(real.status?.[field]) || !Number.isFinite(predicted.exam?.[field])) continue;
    if (real.status[field] !== predicted.exam[field]) {
      differences.push({ field: "exam." + field, kind: "mismatch",
        actual: real.status[field], simulated: predicted.exam[field] });
    }
  }
  return differences;
}

/**
 * Explicit profile is required: the native trace alone has neither a complete
 * master catalog nor an independently confirmed stage/config. Partial or
 * missing input must NEVER produce a fabricated game-score comparison.
 */
export function replayNativeActions(nativeEvents, cardsPayload, profile) {
  const warnings = [];
  if (!profile || !Array.isArray(profile.cardMasters) || !profile.cardMasters.length) {
    return { status: "unavailable", warnings: ["missing-verified-card-masters"],
      checkpoints: [], differences: [], finalState: null };
  }
  if (!Number.isInteger(profile.seed) || !Number.isFinite(profile.stamina)) {
    return { status: "unavailable", warnings: ["missing-verified-seed-or-stamina"],
      checkpoints: [], differences: [], finalState: null };
  }
  const options = {
    stamina: profile.stamina,
    turnLimit: profile.turnLimit,
    pItems: profile.pItems ?? [],
    parameterBonus: profile.parameterBonus ?? null,
    ...profile.runtimeOptions,
    cardVariantByKey: new Map((profile.cardVariants ?? []).map((c) => [String(c.id) + "@@" + Number(c.upgradeCount ?? 0), c])),
    examEffectById: mapping(profile.examEffects),
    examStatusEnchantById: mapping(profile.examStatusEnchants),
    examTriggerById: mapping(profile.examTriggers),
    cardSearchById: mapping(profile.cardSearches),
  };
  const deck = resolveDeck(cardsPayload, profile);
  const state = createTowerTurnState(deck, profile.seed, mapping(profile.cardMasters), options);
  const checkpoints = [], differences = [];
  let turnOpen = false;
  for (const native of nativeEvents) {
    let shouldCompare = false;
    try {
      if (native.event === "DrawCard.after" && !turnOpen) {
        drawTowerTurn(state, Number(profile.drawPerTurn ?? 3));
        turnOpen = true;
        shouldCompare = true;
      } else if (native.event === "MovePlayCard.after" && turnOpen) {
        // The hook captures card movement, not a guaranteed user action.
        // Only replay if the card can be identified unambiguously.
        const id = String(native.playCard?.id ?? "");
        const upgrade = Number(native.playCard?.upgradeCount ?? 0);
        const matches = state.hand.map((card, i) =>
          String(card.id) === id && Number(card.upgradeCount ?? 0) === upgrade ? i : -1)
          .filter((i) => i >= 0);
        if (matches.length !== 1) {
          warnings.push({ seq: native.seq, reason: "ambiguous-or-missing-play", cardId: id });
          break;
        }
        playTowerCard(state, matches[0]);
        shouldCompare = true;
      } else if (native.event === "ResetHand.after" && turnOpen) {
        finishTowerTurn(state, { type: "end" });
        turnOpen = false;
        shouldCompare = true;
      }
    } catch (error) {
      warnings.push({ seq: native.seq, reason: "replay-error", message: String(error?.message ?? error) });
      break;
    }
    if (!shouldCompare) continue;
    const predicted = snapshot(state);
    const discrepancies = compareCheckpoint(native, predicted, {
      compareRandom: profile.verifiedRandomAlignment === true,
    });
    const point = { seq: native.seq, turn: native.turn ?? null, event: native.event,
      actual: native, simulated: predicted, differences: discrepancies };
    checkpoints.push(point);
    for (const issue of discrepancies) differences.push({
      seq: native.seq, event: native.event, turn: native.turn ?? null, ...issue,
    });
    if (state.unsupported?.length) {
      warnings.push({ seq: native.seq, reason: "unsupported-exam-effect",
        details: [...state.unsupported] });
      break;
    }
  }
  if (!checkpoints.length) warnings.push("no-replayable-checkpoints");
  // Even a no-diff replay is partial because card movements do not prove all
  // choices, timings or score effects were captured by the current hooks.
  return { status: warnings.length ? "partial" : "partial", warnings,
    checkpoints, differences, finalState: snapshot(state) };
}

export function createDiagnosticReport({ traceText, cardsText = "", profile = null, origin = "device" }) {
  const capture = parseNativeTrace(traceText);
  let cardsPayload = null;
  const warnings = [...capture.warnings];
  if (cardsText.trim()) {
    try { cardsPayload = JSON.parse(cardsText); }
    catch (error) { warnings.push({ reason: "invalid-cards-json", message: String(error.message) }); }
  }
  if (!capture.events.length) warnings.push("no-native-events");
  if (!capture.events.some((entry) => entry.event === "trace-start" && entry.hooksInstalled === true)) {
    warnings.push("trace-hooks-not-confirmed");
  }
  const rng = verifyNativeRandom(capture.events);
  let replay;
  try {
    replay = replayNativeActions(capture.events, cardsPayload, profile);
  } catch (error) {
    replay = { status: "unavailable", checkpoints: [], differences: [], finalState: null,
      warnings: [{ reason: "replay-initialization-failed", message: String(error.message) }] };
  }
  warnings.push(...replay.warnings);
  const differences = [
    ...rng.differences.filter((item) => item.kind === "mismatch"),
    ...replay.differences,
  ];
  const firstDivergence = differences.slice().sort((a, b) =>
    Number(a.seq ?? Infinity) - Number(b.seq ?? Infinity))[0] ?? null;
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    environment: {
      origin,
      nativeBuildId: capture.events.find((e) => e.event === "trace-start")?.libil2cppBuildId ?? null,
      nativeSessionStarted: capture.events.find((e) => e.event === "trace-start")?.capturedAtUnixMs ?? null,
      profileProvided: Boolean(profile),
      profileId: profile?.id ?? null,
      captureSha256: createHash("sha256").update(traceText).digest("hex"),
    },
    input: { profile, capturedCards: cardsPayload, observedActions: capture.events
      .filter((e) => e.event === "MovePlayCard.after" || e.event === "ResetHand.after")
      .map((e) => ({ seq: e.seq, turn: e.turn, event: e.event,
        card: e.playCard ?? null })) },
    realDevice: { events: capture.events, finalCheckpoint:
      [...capture.events].reverse().find((e) => Array.isArray(e.hand)) ?? null },
    simulation: {
      mode: replay.status === "unavailable" ? "rng-only" : "tower-replay-partial",
      randomEvents: rng.simulated, checkpoints: replay.checkpoints, finalState: replay.finalState,
    },
    comparison: {
      status: differences.length ? "mismatch" : "unverified",
      complete: false, firstDivergence, differences, warnings,
      comparedRandomCalls: rng.simulated.length,
      comparedGameCheckpoints: replay.checkpoints.length,
    },
  };
  return report;
}
