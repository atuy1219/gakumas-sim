import assert from "node:assert/strict";
import {
  collectGeneratedCardTargets,
  generatedObservationLabel,
  partitionSeedObservations,
  resolveSeedObservationLine,
} from "./web/seed_observation_v15.js";
import { prepareSeedBatchSearch } from "./web/sim_v3.js";

const sleepyId = "p_card-00-acc-0_002";
const masters = [
  {
    id: "ADVENTURE",
    name: "冒険心",
    upgradeCount: 0,
    playEffects: [
      { produceExamEffectId: "e_effect-exam_playable_value_add-0001" },
      { produceExamEffectId: "e_effect-exam_card_draw-0001" },
      { produceExamEffectId: `e_effect-exam_card_create_id-${sleepyId}-0-deck_random-1_1` },
    ],
  },
  { id: "A", name: "A", upgradeCount: 0, playEffects: [] },
  { id: "B", name: "B", upgradeCount: 0, playEffects: [] },
  { id: "C", name: "C", upgradeCount: 0, playEffects: [] },
  { id: sleepyId, name: "眠気", upgradeCount: 0, category: "ProduceCardCategory_Trouble", playEffects: [] },
];
const cardById = new Map(masters.map((card) => [card.id, card]));
const variants = new Map(masters.map((card) => [`${card.id}@@0`, card]));
const deck = ["ADVENTURE", "A", "B", "C"].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 }));

const targets = collectGeneratedCardTargets(deck, cardById, variants);
assert.equal(targets.size, 1);
assert.equal(targets.get(sleepyId).movePosition, "deck_random");
assert.equal(generatedObservationLabel(targets.get(sleepyId), cardById, variants), "眠気");
assert.equal(resolveSeedObservationLine("眠気", deck, targets, cardById, variants), sleepyId);
assert.equal(resolveSeedObservationLine(`眠気 — ${sleepyId} [生成]`, deck, targets, cardById, variants), sleepyId);

const observation = partitionSeedObservations(
  ["ADVENTURE", `眠気 — ${sleepyId} [生成]`, "A", "B", "C"],
  deck,
  cardById,
  variants,
);
assert.equal(observation.complete, true);
assert.deepEqual(observation.initialIds, ["ADVENTURE", "A", "B", "C"]);
assert.deepEqual(observation.generatedIds, [sleepyId]);
assert.deepEqual(observation.allIds, ["ADVENTURE", sleepyId, "A", "B", "C"]);
assert.deepEqual(observation.entries.map((entry) => entry.kind), ["initial", "generated", "initial", "initial", "initial"]);

// The Fisher-Yates inversion must see exactly the original deck multiset.
// Generated Sleepiness remains available to runtime replay but is not treated
// as a fifth card from the initial shuffle.
const prepared = prepareSeedBatchSearch(deck, [observation.initialIds]);
assert.equal(prepared.batches.flat().length, deck.length);
assert.throws(
  () => prepareSeedBatchSearch(deck, [observation.allIds]),
  /観測順はデッキ全4枚/,
);

const incomplete = partitionSeedObservations(
  ["ADVENTURE", sleepyId, "A"],
  deck,
  cardById,
  variants,
);
assert.equal(incomplete.complete, false);
assert.equal(incomplete.observedInitialCount, 2);
assert.equal(incomplete.missingCount, 2);
assert.equal(incomplete.generatedIds.length, 1);

// An explicit [生成] marker wins even if a future generated effect creates a
// card ID that also exists in the original deck.
const duplicateId = "p_card-test-a";
const duplicateTargetMasters = [
  {
    id: "CREATOR",
    name: "生成役",
    upgradeCount: 0,
    playEffects: [
      { produceExamEffectId: `e_effect-exam_card_create_id-${duplicateId}-0-deck_random-1_1` },
    ],
  },
  { id: duplicateId, name: "A", upgradeCount: 0, playEffects: [] },
];
const duplicateById = new Map(duplicateTargetMasters.map((card) => [card.id, card]));
const duplicateVariants = new Map(duplicateTargetMasters.map((card) => [`${card.id}@@0`, card]));
const duplicateDeck = ["CREATOR", duplicateId].map((id) => ({ id, upgradeCount: 0 }));
const duplicateObservation = partitionSeedObservations(
  ["CREATOR", `A — ${duplicateId} [生成]`, duplicateId],
  duplicateDeck,
  duplicateById,
  duplicateVariants,
);
assert.deepEqual(duplicateObservation.entries.map((entry) => entry.kind), ["initial", "generated", "initial"]);
assert.equal(duplicateObservation.complete, true);

console.log("seed observation v15 tests: ok");
