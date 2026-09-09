import assert from "node:assert/strict";
import {
  TOWER_DEFAULT_DECK_BY_EXAM_EFFECT,
  TOWER_EXAM_EFFECT_LABELS,
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  isOnceOnlyMove,
  playTowerCard,
  resolveTowerDefaultDeck,
} from "./web/tower_runtime.js";

const effectDeckCases = [
  ["ProduceExamEffectType_ExamParameterBuff", "initial_deck-parameter_buff", "センス / 好調"],
  ["ProduceExamEffectType_ExamLessonBuff", "initial_deck-lesson_buff", "センス / 集中"],
  ["ProduceExamEffectType_ExamCardPlayAggressive", "initial_deck-aggressive", "ロジック / やる気"],
  ["ProduceExamEffectType_ExamReview", "initial_deck-review", "ロジック / 好印象"],
  ["ProduceExamEffectType_ExamConcentration", "initial_deck-concentration", "アノマリー / 強気"],
  ["ProduceExamEffectType_ExamFullPower", "initial_deck-full_power", "アノマリー / 全力"],
];
const initialDeckById = new Map(effectDeckCases.map(([effectType, deckId], caseIndex) => [
  deckId,
  {
    id: deckId,
    cards: [
      { id: `BASE-${caseIndex + 1}-A`, upgradeCount: 0 },
      { id: `BASE-${caseIndex + 1}-B`, upgradeCount: 0 },
    ],
  },
]));
const idolCardById = new Map(effectDeckCases.map(([effectType], index) => [
  `idol-${index + 1}`,
  { id: `idol-${index + 1}`, examEffectType: effectType },
]));
for (const [effectType, deckId, label] of effectDeckCases) {
  assert.equal(TOWER_DEFAULT_DECK_BY_EXAM_EFFECT[effectType], deckId);
  assert.equal(TOWER_EXAM_EFFECT_LABELS[effectType], label);
}
const resolved = resolveTowerDefaultDeck("idol-5", idolCardById, initialDeckById);
assert.equal(resolved.deckId, "initial_deck-concentration");
assert.equal(resolved.label, "アノマリー / 強気");
assert.equal(resolved.cards.length, 2);

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


// Supported ProduceCard play effects mutate the live Exam state and can add plays.
const effectCardById = new Map([
  ["EFFECT", {
    id: "EFFECT",
    stamina: 2,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [
      { produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_lesson-0008-01" },
      { produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_block-0004" },
      { produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_playable_value_add-0001" },
    ],
  }],
  ["X", { id: "X", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
  ["Y", { id: "Y", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
]);
state = createTowerTurnState(
  ["EFFECT", "X", "Y"].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 })),
  1,
  effectCardById,
  { stamina: 20 },
);
drawTowerTurn(state, 3);
const effectIndex = state.hand.findIndex((card) => card.id === "EFFECT");
assert.ok(effectIndex >= 0);
const play = playTowerCard(state, effectIndex);
assert.equal(state.exam.stamina, 18);
assert.equal(state.exam.parameter, 8);
assert.equal(state.exam.block, 4);
assert.equal(state.playsRemaining, 1);
assert.match(play.effects.join(" / "), /パラメータ \+8/);
assert.equal(state.discard.some((card) => card.id === "EFFECT"), true);

console.log("tower runtime tests: ok");
