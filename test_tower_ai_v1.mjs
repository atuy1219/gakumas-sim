import assert from "node:assert/strict";
import {
  createTowerTurnState,
  drawTowerTurn,
} from "./web/tower_runtime.js";
import {
  TOWER_SEED_STATUS,
  classifyTowerSeedBelief,
  rankTowerActions,
  resolveTowerSeedBelief,
  scoreTowerCard,
} from "./web/tower_ai_v1.js";

function master(id, extra = {}) {
  return {
    id,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
    ...extra,
  };
}

const masters = [
  master("CASH", {
    isInitial: true,
    playMovePositionType: "ProduceCardMovePositionType_Lost",
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_lesson-0005-01" }],
  }),
  master("SETUP", {
    isInitial: true,
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_parameter_buff-0010" }],
  }),
  master("FILLER", { isInitial: true }),
  master("FINALE", {
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_lesson_depend_parameter_buff-1000-01" }],
  }),
];
const cardById = new Map(masters.map((card) => [card.id, card]));
const variants = new Map(masters.map((card) => [`${card.id}@@0`, card]));
const cards = masters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 }));
const state = createTowerTurnState(cards, 1, cardById, { cardVariantByKey: variants, stamina: 100 });
drawTowerTurn(state, 3);
assert.deepEqual(state.hand.map((card) => card.id), ["CASH", "SETUP", "FILLER"]);

const cashIndex = state.hand.findIndex((card) => card.id === "CASH");
const cashAction = { type: "play", index: cashIndex, token: state.hand[cashIndex].token, card: state.hand[cashIndex] };
assert.equal(scoreTowerCard(state, cashAction, { totalTurns: 2 }).legal, true);

const ranking = rankTowerActions(state, {
  totalTurns: 2,
  depth: 4,
  beamWidth: 16,
  leafHeuristicWeight: 0,
});
assert.equal(ranking[0].action.card.id, "SETUP");
assert.ok(ranking[0].value > ranking.find((entry) => entry.action?.card?.id === "CASH").value);

const known = resolveTowerSeedBelief({
  knownSeed: 1,
  cards,
  turnScript: [],
  options: { cardById, cardVariantByKey: variants, stamina: 100 },
});
assert.equal(known.status, TOWER_SEED_STATUS.KNOWN);
assert.equal(known.seed, 1);

const replay = known.results[0];
const equivalent = classifyTowerSeedBelief([
  replay,
  { ...replay, seed: 999 },
]);
assert.equal(equivalent.status, TOWER_SEED_STATUS.FUTURE_EQUIVALENT);

console.log("tower ai v1 tests: ok");
