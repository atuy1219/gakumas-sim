import assert from "node:assert/strict";
import { XorShift32 } from "./web/engine.js";
import {
  TOWER_DEFAULT_DECK_BY_EXAM_EFFECT,
  TOWER_EXAM_EFFECT_LABELS,
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  isOnceOnlyMove,
  playTowerCard,
  resolveNativeInitialHand,
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

const initialCardById = new Map(cardById);
initialCardById.set("C", { ...initialCardById.get("C"), isInitial: true });
const initialState = createTowerTurnState(cards, 1, initialCardById);
assert.deepEqual(initialState.shuffledInitialDeck.map((card) => card.id), ["A", "B", "C", "ONCE"]);
assert.deepEqual(initialState.initialDeck.map((card) => card.id), ["C", "A", "B", "ONCE"]);
assert.equal(initialState.randomState, 2647435461);
const openingPreview = resolveNativeInitialHand(initialState.shuffledInitialDeck, 3);
assert.deepEqual(openingPreview.hand.map((card) => card.id), ["C", "A", "B"]);
drawTowerTurn(initialState, 3);
assert.deepEqual(initialState.hand.map((card) => card.id), ["C", "A", "B"]);
assert.equal(initialState.randomState, 2647435461, "SetInitialCard must not consume RNG");

// ResetHand preserves the relative Hand order for Grave and sends
// IsEndTurnLost cards to Lost instead of the recycle source.
const endTurnCardById = new Map([
  ["I", { id: "I", isInitial: true, playMovePositionType: "ProduceCardMovePositionType_Grave" }],
  ["A", { id: "A", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
  ["L", { id: "L", isEndTurnLost: true, playMovePositionType: "ProduceCardMovePositionType_Grave" }],
  ["B", { id: "B", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
]);
let endTurnState = createTowerTurnState(
  ["I", "A", "L", "B"].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 })),
  1,
  endTurnCardById,
);
drawTowerTurn(endTurnState, 3);
const openingHand = endTurnState.hand.map((card) => card.id);
finishTowerTurn(endTurnState, { type: "skip" });
assert.deepEqual(
  endTurnState.discard.map((card) => card.id),
  openingHand.filter((id) => id !== "L"),
);
assert.deepEqual(endTurnState.lost.map((card) => card.id), openingHand.filter((id) => id === "L"));

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

// Cards such as 冒険心 generate 眠気 into a random Deck position.
// The native CardCreateId path uses p_card-00-acc-0_002 and DeckRandom.
const sleepyId = "p_card-00-acc-0_002";
const generatedMasters = [
  {
    id: "ADVENTURE",
    isInitial: true,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [
      { produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_playable_value_add-0001" },
      { produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_card_draw-0001" },
      { produceExamTriggerId: "", produceExamEffectId: `e_effect-exam_card_create_id-${sleepyId}-0-deck_random-1_1` },
    ],
  },
  { id: "GX", playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
  { id: "GY", playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
  { id: "GZ", playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
  {
    id: sleepyId,
    name: "眠気",
    category: "ProduceCardCategory_Trouble",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  },
];
const generatedCardById = new Map(generatedMasters.map((card) => [card.id, card]));
const generatedVariants = new Map(generatedMasters.map((card) => [`${card.id}@@0`, card]));
const generatedCards = ["ADVENTURE", "GX", "GY", "GZ"].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 }));
state = createTowerTurnState(generatedCards, 1, generatedCardById, { cardVariantByKey: generatedVariants });
drawTowerTurn(state, 3);
const adventureIndex = state.hand.findIndex((card) => card.id === "ADVENTURE");
assert.ok(adventureIndex >= 0);
const randomStateBeforeCreate = state.randomState >>> 0;
const generatedPlay = playTowerCard(state, adventureIndex);
assert.equal(generatedPlay.drawn.length, 1, "draw resolves before the create effect");
assert.equal(generatedPlay.created.length, 1);
assert.equal(generatedPlay.created[0].card.id, sleepyId);
assert.equal(generatedPlay.created[0].movePosition, "deck_random");
assert.equal(generatedPlay.created[0].insertIndex, 0, "empty Deck resolves DeckRandom to index 0");
assert.deepEqual(state.deck.map((card) => card.id), [sleepyId]);
assert.equal(state.hand.some((card) => card.id === sleepyId), false, "generated after draw, so it is not drawn by the same effect");

const randomStep = new XorShift32(randomStateBeforeCreate);
randomStep.nextU32();
assert.equal(state.randomState, randomStep.state >>> 0, "DeckRandom consumes exactly one native RNG step even when Deck.Count is zero");

// ELF <AddCardImpl>b__0 @ 0x823BAD4 passes GetRandomInt(0, Deck.Count).
// GetRandomInt @ 0x8043AA0 maps to [minimum, maximum), so with two cards
// remaining the only insertion indices are 0 or 1 (never after the last card).
const positionedMasters = [
  {
    id: "POSITION",
    isInitial: true,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [
      { produceExamTriggerId: "", produceExamEffectId: `e_effect-exam_card_create_id-${sleepyId}-0-deck_random-1_1` },
    ],
  },
  ...["A", "B", "C", "D"].map((id) => ({ id, playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] })),
  generatedMasters.at(-1),
];
const positionedById = new Map(positionedMasters.map((card) => [card.id, card]));
const positionedVariants = new Map(positionedMasters.map((card) => [`${card.id}@@0`, card]));
state = createTowerTurnState(
  ["POSITION", "A", "B", "C", "D"].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 })),
  4,
  positionedById,
  { cardVariantByKey: positionedVariants },
);
drawTowerTurn(state, 3);
assert.deepEqual(state.hand.map((card) => card.id), ["POSITION", "A", "B"]);
assert.deepEqual(state.deck.map((card) => card.id), ["C", "D"]);
assert.equal(state.randomState >>> 0, 3341906444);
const positionedPlay = playTowerCard(state, state.hand.findIndex((card) => card.id === "POSITION"));
assert.equal(positionedPlay.created[0].insertIndex, 1);
assert.deepEqual(state.deck.map((card) => card.id), ["C", sleepyId, "D"]);
assert.equal(state.randomState >>> 0, 3344977972);

finishTowerTurn(state, { type: "end" });
const nextDraw = drawTowerTurn(state, 3);
assert.equal(nextDraw.drawn[0].id, sleepyId, "generated Sleepiness participates in subsequent deck/recycle flow");

// Effects that generate two cards call the native DeckRandom insertion twice.
// Each insertion consumes one RNG state, including deterministic-width cases.
const doubleGenerateMasters = [
  {
    id: "DOUBLE",
    isInitial: true,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [
      { produceExamTriggerId: "", produceExamEffectId: `e_effect-exam_card_create_id-${sleepyId}-0-deck_random-2_2` },
    ],
  },
  { id: "DX", playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
  { id: "DY", playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
  sleepyId === "unused" ? null : generatedMasters.at(-1),
].filter(Boolean);
const doubleCardById = new Map(doubleGenerateMasters.map((card) => [card.id, card]));
const doubleVariants = new Map(doubleGenerateMasters.map((card) => [`${card.id}@@0`, card]));
state = createTowerTurnState(
  ["DOUBLE", "DX", "DY"].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 })),
  7,
  doubleCardById,
  { cardVariantByKey: doubleVariants },
);
drawTowerTurn(state, 3);
const doubleIndex = state.hand.findIndex((card) => card.id === "DOUBLE");
assert.ok(doubleIndex >= 0);
const doubleStateBefore = state.randomState >>> 0;
const doublePlay = playTowerCard(state, doubleIndex);
assert.equal(doublePlay.created.length, 2);
assert.equal(state.deck.filter((card) => card.id === sleepyId).length, 2);
const twoSteps = new XorShift32(doubleStateBefore);
twoSteps.nextU32();
twoSteps.nextU32();
assert.equal(state.randomState, twoSteps.state >>> 0, "two DeckRandom insertions consume two RNG states");

console.log("tower runtime tests: ok");
