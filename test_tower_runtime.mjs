import assert from "node:assert/strict";
import {
  TOWER_DEFAULT_DECK_BY_EXAM_EFFECT,
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  isOnceOnlyMove,
  resolveTowerDefaultDeck,
} from "./web/tower_runtime.js";

const initialDeckById = new Map([
  ["initial_deck-produce_default-concentration", {
    id: "initial_deck-produce_default-concentration",
    cards: Array.from({ length: 8 }, (_, i) => ({ id: `B${i + 1}`, upgradeCount: 0 })),
  }],
]);
const idolCardById = new Map([["idol-1", {
  id: "idol-1",
  examEffectType: "ProduceExamEffectType_ExamConcentration",
}]]);
const resolved = resolveTowerDefaultDeck("idol-1", idolCardById, initialDeckById);
assert.equal(TOWER_DEFAULT_DECK_BY_EXAM_EFFECT.ProduceExamEffectType_ExamConcentration, "initial_deck-produce_default-concentration");
assert.equal(resolved.deckId, "initial_deck-produce_default-concentration");
assert.equal(resolved.cards.length, 8);

assert.equal(isOnceOnlyMove("ProduceCardMovePositionType_Lost"), true);
assert.equal(isOnceOnlyMove("ProduceCardMovePositionType_Grave"), false);

const cardById = new Map([
  ["ONCE", { id: "ONCE", playMovePositionType: "ProduceCardMovePositionType_Lost" }],
  ["A", { id: "A", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
  ["B", { id: "B", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
  ["C", { id: "C", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
]);
const cards = ["ONCE", "A", "B", "C"].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 }));

// When a once-only card is used, it leaves the recycle pool.
let state = createTowerTurnState(cards, 1, cardById);
drawTowerTurn(state, 3);
const onceIndex = state.hand.findIndex((card) => card.id === "ONCE");
if (onceIndex >= 0) {
  finishTowerTurn(state, { type: "use", index: onceIndex });
  assert.equal(state.lost.some((card) => card.id === "ONCE"), true);
  assert.equal(state.discard.some((card) => card.id === "ONCE"), false);
} else {
  finishTowerTurn(state, { type: "skip" });
  drawTowerTurn(state, 3);
  const nextOnce = state.hand.findIndex((card) => card.id === "ONCE");
  assert.ok(nextOnce >= 0);
  finishTowerTurn(state, { type: "use", index: nextOnce });
  assert.equal(state.lost.some((card) => card.id === "ONCE"), true);
}

// If the same once-only card is skipped, it goes to discard and can recycle.
state = createTowerTurnState(cards, 1, cardById);
let sawOnce = false;
for (let turn = 0; turn < 10 && !sawOnce; turn += 1) {
  drawTowerTurn(state, 3);
  if (state.hand.some((card) => card.id === "ONCE")) sawOnce = true;
  finishTowerTurn(state, { type: "skip" });
}
assert.equal(sawOnce, true);
assert.equal(state.lost.length, 0);
assert.equal(state.discard.some((card) => card.id === "ONCE") || state.deck.some((card) => card.id === "ONCE"), true);

console.log("tower runtime tests: ok");
