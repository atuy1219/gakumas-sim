import assert from "node:assert/strict";
import {
  buildDiscardBeforeFirstRecycle,
  filterSeedsByFirstRecycle,
  firstRecycleRelevantHands,
  matchesFirstRecycleObservation,
  predictFirstRecycle,
} from "./web/seed_recycle_v11.js";
import {
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  playTowerCard,
} from "./web/tower_runtime.js";

function firstCycleFromState(state) {
  return state.initialDeck.map((card) => ({
    id: card.id,
    isInitial: Boolean(card.isInitial),
    onceOnly: Boolean(card.onceOnly),
    playMovePositionType: card.playMovePositionType,
  }));
}

// 7 cards: after the first card of turn 3 is drawn, the deck is empty and the
// discard pile from turns 1-2 is recycled before the other two cards are drawn.
// The card used on turn 1 is Lost and must not enter that recycle source.
{
  const cards = "ABCDEFG".split("").map((id) => ({ id, isInitial: id === "A" }));
  const cardById = new Map(cards.map((card) => [card.id, {
    id: card.id,
    isInitial: card.isInitial,
    playMovePositionType: "ProduceCardMovePositionType_Lost",
  }]));
  const seed = 0x12345678;
  const state = createTowerTurnState(cards, seed, cardById);
  const firstCycle = firstCycleFromState(state);
  assert.equal(firstCycle.filter((card) => card.isInitial).length, 1);
  assert.equal(firstRecycleRelevantHands(firstCycle, 3).length, 2);

  drawTowerTurn(state, 3);
  playTowerCard(state, 1);
  finishTowerTurn(state, { type: "end" });
  drawTowerTurn(state, 3);
  finishTowerTurn(state, { type: "skip" });

  const actions = [
    { type: "use", usedIndices: [1] },
    { type: "skip", usedIndices: [] },
  ];
  const discard = buildDiscardBeforeFirstRecycle(firstCycle, actions, 3);
  assert.equal(discard.lost.length, 1);
  assert.equal(discard.discard.length, 5);

  const prediction = predictFirstRecycle(seed, firstCycle, actions, { drawPerTurn: 3 });
  const draw = drawTowerTurn(state, 3);
  assert.equal(draw.recycleEvents.length, 1);
  assert.deepEqual(
    state.hand.slice(1).map((card) => card.id),
    prediction.recycledDeck.slice(0, 2).map((card) => card.id),
  );
  const observedSecond = state.hand.slice(1).map((card) => card.id);
  assert.equal(matchesFirstRecycleObservation(seed, firstCycle, actions, observedSecond, { drawPerTurn: 3 }), true);
  assert.ok(filterSeedsByFirstRecycle([seed], firstCycle, actions, observedSecond).includes(seed));
}

// Exact multiple of three: the next turn starts directly from the recycled
// discard pile, so the predicted prefix must equal the whole next hand.
{
  const cards = "ABCDEF".split("").map((id) => ({ id }));
  const cardById = new Map(cards.map((card) => [card.id, {
    id: card.id,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
  }]));
  const seed = 0x89abcdef;
  const state = createTowerTurnState(cards, seed, cardById);
  const firstCycle = firstCycleFromState(state);
  const actions = [
    { type: "use", usedIndices: [0] },
    { type: "skip", usedIndices: [] },
  ];

  drawTowerTurn(state, 3);
  playTowerCard(state, 0);
  finishTowerTurn(state, { type: "end" });
  drawTowerTurn(state, 3);
  finishTowerTurn(state, { type: "skip" });

  const prediction = predictFirstRecycle(seed, firstCycle, actions);
  const draw = drawTowerTurn(state, 3);
  assert.equal(draw.recycleEvents.length, 1);
  assert.deepEqual(
    state.hand.map((card) => card.id),
    prediction.recycledDeck.slice(0, 3).map((card) => card.id),
  );
}

assert.throws(
  () => buildDiscardBeforeFirstRecycle([{ id: "A" }, { id: "B" }, { id: "C" }], [], 3),
  /使用履歴/,
);

console.log("seed recycle v11 tests: ok");
