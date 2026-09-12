import assert from "node:assert/strict";
import { createTowerTurnState } from "./web/tower_runtime.js";
import {
  evaluateTowerSeedCandidates,
  replayTowerSeed,
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

console.log("seed runtime replay v13 tests: ok");
