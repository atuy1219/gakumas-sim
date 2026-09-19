import assert from "node:assert/strict";
import { createTowerTurnState } from "./web/tower_runtime.js";
import {
  evaluateTowerSeedCandidates,
  replayTowerSeed,
  replayUncertaintyLabel,
  summarizeReplayUncertainty,
} from "./web/seed_runtime_replay_v13.js";

function master(id, extra = {}) {
  return {
    id,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
    ...extra,
  };
}

const simpleMasters = ["A", "B", "C", "D"].map((id) => master(id));
const cardById = new Map(simpleMasters.map((card) => [card.id, card]));
const cardVariantByKey = new Map(simpleMasters.map((card) => [`${card.id}@@0`, card]));
const cards = simpleMasters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 }));
const skipFirstTurn = [{ plays: [], ended: true }];

// Find two real 32-bit seeds that produce the same first-cycle permutation but
// different cards immediately after the first recycle. This mirrors the actual
// multi-candidate situation that motivated the runtime replay.
const seen = new Map();
let pair = null;
for (let seed = 1; seed < 20000 && !pair; seed += 1) {
  const initialState = createTowerTurnState(cards, seed, cardById, { cardVariantByKey });
  const initialKey = initialState.initialDeck.map((card) => card.id).join(",");
  const replay = replayTowerSeed(seed, cards, skipFirstTurn, { cardById, cardVariantByKey });
  assert.equal(replay.recycleSeen, true);
  assert.ok(replay.postRecycleDraws.length >= 1);
  const firstRecycleId = replay.postRecycleDraws[0].id;
  const previous = seen.get(initialKey);
  if (previous && previous.firstRecycleId !== firstRecycleId) {
    pair = { a: previous, b: { seed, initialState, replay, firstRecycleId } };
    break;
  }
  if (!previous) seen.set(initialKey, { seed, initialState, replay, firstRecycleId });
}
assert.ok(pair, "same initial order / different recycle seeds should exist");

const expectedInitialOrder = pair.a.initialState.initialDeck.map((card) => ({ id: card.id, upgradeCount: 0 }));
const filtered = evaluateTowerSeedCandidates(
  [pair.a.seed, pair.b.seed],
  cards,
  skipFirstTurn,
  [pair.a.firstRecycleId],
  { cardById, cardVariantByKey, expectedInitialOrder },
);
assert.deepEqual(filtered.seeds, [pair.a.seed]);

// Card effects are replayed by tower_runtime rather than approximating the
// discard pile from 3-card batches. DRAW is an initial-hand card here so the
// test is deterministic; playing it immediately draws the remaining deck card.
const drawMasters = [
  master("DRAW", {
    isInitial: true,
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_card_draw-0001" }],
  }),
  master("X"), master("Y"), master("Z"),
];
const drawCardById = new Map(drawMasters.map((card) => [card.id, card]));
const drawVariants = new Map(drawMasters.map((card) => [`${card.id}@@0`, card]));
const drawCards = drawMasters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 }));
const effectReplay = replayTowerSeed(
  1,
  drawCards,
  [{ plays: [{ id: "DRAW", upgradeCount: 0, occurrence: 0 }], ended: false }],
  { cardById: drawCardById, cardVariantByKey: drawVariants },
);
assert.equal(effectReplay.status, "ok");
const lastPlay = [...effectReplay.trace].reverse().find((entry) => entry.type === "play");
assert.equal(lastPlay.card.id, "DRAW");
assert.equal(lastPlay.drawn.length, 1);
assert.equal(effectReplay.currentHand.length, 3);

// The replay UI records an action that already happened on the real client.
// If an unsupported/missing status effect means the simulator cannot satisfy a
// cost (for example an ExamReview cost), the observed card must still leave the
// hand. Keeping it there makes the same card appear forever in the replay UI.
const observedMasters = [
  master("FINISH", {
    isInitial: true,
    costType: "ExamCostType_ExamReview",
    costValue: 4,
  }),
  master("Q"),
  master("R"),
];
const observedCardById = new Map(observedMasters.map((card) => [card.id, card]));
const observedVariants = new Map(observedMasters.map((card) => [`${card.id}@@0`, card]));
const observedCards = observedMasters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 }));
const observedReplay = replayTowerSeed(
  1,
  observedCards,
  [{ plays: [{ id: "FINISH", upgradeCount: 0, occurrence: 0 }], ended: false }],
  { cardById: observedCardById, cardVariantByKey: observedVariants },
);
assert.equal(observedReplay.status, "uncertain");
assert.equal(observedReplay.currentHand.some((card) => card.id === "FINISH"), false);
const observedPlay = [...observedReplay.trace].reverse().find((entry) => entry.type === "play");
assert.equal(observedPlay.card.id, "FINISH");
assert.equal(observedPlay.observedFallback, true);
assert.ok(observedReplay.unsupported.some((value) => value.startsWith("observed-play:FINISH:")));

const observedUncertainty = summarizeReplayUncertainty([
  observedReplay,
  {
    ...observedReplay,
    seed: 2,
    unsupported: [
      ...observedReplay.unsupported,
      "effect:e_effect-exam-unsupported-demo",
      "trigger:t_exam_trigger-unsupported-demo",
    ],
  },
]);
const observedFallbackCause = observedUncertainty.find((entry) =>
  entry.reason.startsWith("observed-play:FINISH:"));
assert.ok(observedFallbackCause);
assert.equal(observedFallbackCause.count, 2);
assert.deepEqual(observedFallbackCause.seeds, [1, 2]);
assert.match(observedFallbackCause.label, /^実機操作を優先: FINISH/);

const effectCause = observedUncertainty.find((entry) =>
  entry.reason === "effect:e_effect-exam-unsupported-demo");
assert.equal(effectCause.count, 1);
assert.equal(
  replayUncertaintyLabel("trigger:t_exam_trigger-unsupported-demo"),
  "未対応条件: t_exam_trigger-unsupported-demo",
);

// A real-device operation must not collapse every candidate to a misleading
// zero just because the replay model cannot place the observed card in Hand.
const allActionConflict = evaluateTowerSeedCandidates(
  [1, 2],
  cards,
  [{ plays: [{ id: "NOT_IN_HAND", upgradeCount: 0, occurrence: 0 }], ended: false }],
  [],
  { cardById, cardVariantByKey },
);
assert.equal(allActionConflict.conservativeFallback, true);
assert.deepEqual(allActionConflict.seeds, [1, 2]);
assert.equal(allActionConflict.uncertain.length, 2);
assert.ok(allActionConflict.uncertain.every((result) =>
  result.unsupported.some((reason) => reason.startsWith("replay-conflict:"))));
assert.match(
  replayUncertaintyLabel(allActionConflict.uncertain[0].unsupported.find((reason) => reason.startsWith("replay-conflict:"))),
  /^実機操作と再現モデルが矛盾:/,
);

// The same safeguard applies when every candidate disagrees only with the
// chronological observed-draw trace. This is especially important after an
// effect becomes newly supported and starts consuming RNG.
const allDrawConflict = evaluateTowerSeedCandidates(
  [1, 2],
  cards,
  [],
  [],
  { cardById, cardVariantByKey, observedDrawOrder: ["IMPOSSIBLE"] },
);
assert.equal(allDrawConflict.conservativeFallback, true);
assert.deepEqual(allDrawConflict.seeds, [1, 2]);
assert.ok(allDrawConflict.rejectedBeforeFallback.every((result) => result.status === "mismatch"));

// Dynamically generated cards must be part of the same seed replay state.
// This models effects such as 冒険心 generating 眠気 into DeckRandom.
const sleepyId = "p_card-00-acc-0_002";
const generatedMasters = [
  master("ADVENTURE", {
    isInitial: true,
    playEffects: [
      { produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_card_draw-0001" },
      { produceExamTriggerId: "", produceExamEffectId: `e_effect-exam_card_create_id-${sleepyId}-0-deck_random-1_1` },
    ],
  }),
  master("GA"),
  master("GB"),
  master("GC"),
  master(sleepyId, { category: "ProduceCardCategory_Trouble", name: "眠気" }),
];
const generatedCardById = new Map(generatedMasters.map((card) => [card.id, card]));
const generatedVariants = new Map(generatedMasters.map((card) => [`${card.id}@@0`, card]));
const generatedDeck = ["ADVENTURE", "GA", "GB", "GC"].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 }));
const generatedReplay = replayTowerSeed(
  1,
  generatedDeck,
  [{ plays: [{ id: "ADVENTURE", upgradeCount: 0, occurrence: 0 }], ended: true }],
  { cardById: generatedCardById, cardVariantByKey: generatedVariants },
);
assert.equal(generatedReplay.status, "ok");
const generatedTrace = generatedReplay.trace.find((entry) => entry.type === "play" && entry.card?.id === "ADVENTURE");
assert.ok(generatedTrace);
assert.equal(generatedTrace.created.length, 1);
assert.equal(generatedTrace.created[0].card.id, sleepyId);
assert.equal(generatedReplay.state.discard.some((card) => card.id === sleepyId)
  || generatedReplay.state.hand.some((card) => card.id === sleepyId)
  || generatedReplay.state.deck.some((card) => card.id === sleepyId), true);

// Seeds with the same initial permutation can diverge when DeckRandom consumes
// the next RNG value. A generated-card observation from the first cycle must
// therefore narrow candidates once the user replays the generating action.
const generatedLongDeck = [
  master("ADVENTURE2", {
    isInitial: true,
    playEffects: [
      { produceExamTriggerId: "", produceExamEffectId: `e_effect-exam_card_create_id-${sleepyId}-0-deck_random-1_1` },
    ],
  }),
  master("LA"),
  master("LB"),
  master("LC"),
  master("LD"),
  master(sleepyId, { category: "ProduceCardCategory_Trouble", name: "眠気" }),
];
const generatedLongById = new Map(generatedLongDeck.map((card) => [card.id, card]));
const generatedLongVariants = new Map(generatedLongDeck.map((card) => [`${card.id}@@0`, card]));
const generatedLongCards = ["ADVENTURE2", "LA", "LB", "LC", "LD"].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 }));
const generatedScript = [{ plays: [{ id: "ADVENTURE2", upgradeCount: 0, occurrence: 0 }], ended: true }];

function visibleDrawIds(result) {
  return (result.trace ?? []).flatMap((entry) =>
    ["draw", "play"].includes(entry.type)
      ? (entry.drawn ?? []).map((card) => String(card.id))
      : []);
}

const generatedSeen = new Map();
let generatedPair = null;
for (let seed = 1; seed < 50000 && !generatedPair; seed += 1) {
  const initial = createTowerTurnState(generatedLongCards, seed, generatedLongById, { cardVariantByKey: generatedLongVariants });
  const initialKey = initial.initialDeck.map((card) => card.id).join(",");
  const replay = replayTowerSeed(seed, generatedLongCards, generatedScript, {
    cardById: generatedLongById,
    cardVariantByKey: generatedLongVariants,
  });
  if (replay.status !== "ok") continue;
  const draws = visibleDrawIds(replay);
  const previous = generatedSeen.get(initialKey);
  if (previous && previous.draws.join(",") !== draws.join(",")) {
    generatedPair = { a: previous, b: { seed, initial, replay, draws } };
    break;
  }
  if (!previous) generatedSeen.set(initialKey, { seed, initial, replay, draws });
}
assert.ok(generatedPair, "same initial order / different generated-card insertion seeds should exist");

const generatedExpectedInitial = generatedPair.a.initial.initialDeck.map((card) => ({
  id: card.id,
  upgradeCount: Number(card.upgradeCount ?? 0),
}));
const generatedFiltered = evaluateTowerSeedCandidates(
  [generatedPair.a.seed, generatedPair.b.seed],
  generatedLongCards,
  generatedScript,
  [],
  {
    cardById: generatedLongById,
    cardVariantByKey: generatedLongVariants,
    expectedInitialOrder: generatedExpectedInitial,
    observedDrawOrder: generatedPair.a.draws,
  },
);
assert.deepEqual(generatedFiltered.seeds, [generatedPair.a.seed]);
assert.equal(generatedFiltered.conservativeFallback, false, "normal narrowing must still reject only the mismatching candidate");

console.log("seed runtime replay v13 tests: ok");
