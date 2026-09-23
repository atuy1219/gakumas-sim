import assert from "node:assert/strict";
import { XorShift32 } from "../web/engine.js";
import {
  TOWER_DEFAULT_DECK_BY_EXAM_EFFECT,
  TOWER_EXAM_EFFECT_LABELS,
  createTowerTurnState,
  currentTowerScoreContext,
  drawTowerTurn,
  finishTowerTurn,
  isOnceOnlyMove,
  playTowerCard,
  resolveNativeInitialHand,
  resolveTowerDefaultDeck,
  useTowerDrink,
} from "../web/tower_runtime.js";

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

// Real-device exam regression: the public Seed is not the initial-shuffle
// RandomState. A 12-turn exam advances 24 XorShift words before shuffling.
{
const realDeckIds = [
  "p_card-03-ido-3_234", "p_card-03-men-2_078", "p_card-00-sup-3_152",
  "p_card-01-men-2_037", "p_card-03-men-2_112", "p_card-01-men-3_006",
  "p_card-03-act-2_102", "p_card-00-men-2_012", "p_card-03-men-2_076",
  "p_card-03-men-2_080", "p_card-03-men-3_058", "p_card-03-act-3_065",
  "p_card-01-men-2_011", "p_card-03-men-2_074", "p_card-01-act-3_049",
  "p_card-03-sup-3_162", "p_card-01-act-2_001", "p_card-01-men-3_036",
  "p_card-01-act-3_185", "p_card-03-act-2_081", "p_card-01-men-1_034",
  "p_card-01-act-3_184",
];
const realExpectedShuffle = [
  "p_card-01-men-2_037", "p_card-00-sup-3_152", "p_card-03-sup-3_162",
  "p_card-01-men-3_006", "p_card-00-men-2_012", "p_card-01-act-3_184",
  "p_card-03-act-2_081", "p_card-01-act-3_185", "p_card-01-act-2_001",
  "p_card-03-men-3_058", "p_card-03-men-2_074", "p_card-01-act-3_049",
  "p_card-03-men-2_080", "p_card-01-men-2_011", "p_card-03-ido-3_234",
  "p_card-03-men-2_076", "p_card-03-men-2_078", "p_card-03-act-3_065",
  "p_card-01-men-1_034", "p_card-01-men-3_036", "p_card-03-act-2_102",
  "p_card-03-men-2_112",
];
const realState = createTowerTurnState(
  realDeckIds.map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 })),
  171624539,
  new Map(),
  { preShuffleAdvanceSteps: 24 },
);
assert.equal(realState.seed, 171624539);
assert.equal(realState.preShuffleAdvanceSteps, 24);
assert.equal(realState.initialRandomState, 809254905);
assert.deepEqual(realState.shuffledInitialDeck.map((card) => card.id), realExpectedShuffle);
assert.equal(realState.randomState, 2281153048);

// Exact observed shuffle state must override a wrong stage-derived step count.
const exactState = createTowerTurnState(
  realDeckIds.map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 })),
  171624539,
  new Map(),
  {
    preShuffleAdvanceSteps: 8,
    initialRandomState: 809254905,
    initialRandomStateSource: "observed-order",
  },
);
assert.equal(exactState.initialRandomState, 809254905);
assert.equal(exactState.initialRandomStateSource, "observed-order");
assert.deepEqual(exactState.shuffledInitialDeck.map((card) => card.id), realExpectedShuffle);
assert.equal(exactState.randomState, 2281153048);
}

// Native ExamSequence.GetInsertEffectResultTriggerCommand evaluates support
// card upgrades for newly drawn cards. Every eligible check consumes
// GetRandomInt(0, 1000), including 0% and 100% probabilities, and a support
// card stops checking after its first success in the current turn.
{
const supportMasters = new Map([
  ["S-A", { id: "S-A", name: "A", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
  ["S-B", { id: "S-B", name: "B", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
  ["S-C", { id: "S-C", name: "C", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
]);
const supportVariants = new Map([
  ["S-A@@1", { id: "S-A", name: "A+", playMovePositionType: "ProduceCardMovePositionType_Grave" }],
]);
const supportState = createTowerTurnState(
  ["S-A", "S-B", "S-C"].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 })),
  1,
  supportMasters,
  {
    cardVariantByKey: supportVariants,
    supportCards: [
      { supportCardId: "always", cardSearchId: "all", produceCardUpgradePermil: 1000 },
      { supportCardId: "never", cardSearchId: "all", produceCardUpgradePermil: 0 },
    ],
    cardSearchById: new Map([["all", { id: "all" }]]),
  },
);
supportState.deck = ["S-A", "S-B", "S-C"].map((id, index) => ({
  ...supportState.shuffledInitialDeck.find((card) => card.id === id),
  originalIndex: index,
}));
supportState.randomState = 0x12345678;
const expectedSupportRandom = new XorShift32(0x12345678);
for (let index = 0; index < 4; index += 1) expectedSupportRandom.nextU32();
drawTowerTurn(supportState, 3);
assert.equal(supportState.supportCardRollHistory.length, 4);
assert.equal(supportState.randomState >>> 0, expectedSupportRandom.state >>> 0);
assert.equal(supportState.hand[0].upgradeCount, 1, "the guaranteed support upgrades the first eligible drawn card");
assert.equal(supportState.hand[0].name, "A+");
assert.deepEqual([...supportState.turnUseSupportCardIds], ["always"]);
assert.equal(supportState.supportCardRollHistory.filter((roll) => roll.supportCardId === "never").length, 3);
const supportTurnEntry = finishTowerTurn(supportState, { type: "skip" });
assert.equal(supportTurnEntry.turnStartSupportCardRolls.length, 4);
assert.deepEqual(
  supportTurnEntry.turnStartSupportCardRolls.map((roll) => roll.supportCardId),
  ["always", "never", "never", "never"],
);
const revertedSupportCard = supportState.discard.find((card) => card.id === "S-A");
assert.equal(revertedSupportCard.upgradeCount, 0, "support-card upgrade is temporary for the current turn");
assert.notEqual(revertedSupportCard.name, "A+", "temporary support-card variant data is removed at turn end");

const handSearchState = createTowerTurnState(
  [{ id: "S-A", upgradeCount: 0, fixedDeckOrder: 0 }],
  2,
  supportMasters,
  {
    supportCards: [{
      supportCardId: "manual-support-1",
      cardSearchId: "p_card_search-hand",
      produceCardUpgradePermil: 0,
    }],
  },
);
drawTowerTurn(handSearchState, 1);
assert.equal(handSearchState.supportCardRollHistory.length, 1, "the common Hand search does not require a catalog row");
assert.deepEqual(handSearchState.unsupported, []);

const parameterFilteredState = createTowerTurnState(
  [{ id: "S-A", upgradeCount: 0, fixedDeckOrder: 0 }],
  3,
  supportMasters,
  {
    turnParameterTypes: ["Dance"],
    supportCards: [
      { supportCardId: "dance", filterParameterType: "ProduceParameterType_Dance", produceCardUpgradePermil: 0 },
      { supportCardId: "visual", filterParameterType: "ProduceParameterType_Visual", produceCardUpgradePermil: 1000 },
    ],
  },
);
drawTowerTurn(parameterFilteredState, 1);
assert.deepEqual(parameterFilteredState.supportCardRollHistory.map((roll) => roll.supportCardId), ["dance"]);
}

// In-exam drinks execute the same exam-effect runtime. Hand replacement moves
// the current hand to Grave, draws the same count, recycles Grave when needed,
// and support-card checks on the replacement draw consume the shared RNG.
{
const drinkMasters = new Map(
  ["D-A", "D-B", "D-C", "D-D"].map((id) => [
    id,
    { id, name: id, playMovePositionType: "ProduceCardMovePositionType_Grave" },
  ]),
);
const drinkState = createTowerTurnState(
  ["D-A", "D-B", "D-C", "D-D"].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 })),
  123,
  drinkMasters,
);
drawTowerTurn(drinkState, 3);
const handBeforeDrink = drinkState.hand.map((card) => card.id);
assert.equal(drinkState.deck.length, 1);
drinkState.supportCards = [{
  supportCardId: "drink-never",
  cardSearchId: "p_card_search-hand",
  produceCardUpgradePermil: 0,
}];
drinkState.randomState = 0x12345678;
const expectedDrinkRandom = new XorShift32(0x12345678);
// 3-card Grave recycle = 2 Fisher-Yates draws, replacement hand = 3 support rolls.
for (let index = 0; index < 5; index += 1) expectedDrinkRandom.nextU32();

const drinkEvent = useTowerDrink(drinkState, {
  id: "pdrink-test-swap",
  name: "テストスムージー",
  effects: [{
    id: "p_drink_effect-e_effect-exam_hand_grave_count_card_draw",
    produceExamEffectId: "e_effect-exam_hand_grave_count_card_draw",
    examEffect: {
      id: "e_effect-exam_hand_grave_count_card_draw",
      effectType: "ProduceExamEffectType_ExamHandGraveCountCardDraw",
    },
  }],
});
assert.equal(drinkEvent.drink.name, "テストスムージー");
assert.match(drinkEvent.effects.join(" / "), /手札をすべて入れ替え/);
assert.equal(drinkState.hand.length, 3);
assert.equal(drinkState.recycleCount, 1);
assert.equal(drinkState.supportCardRollHistory.length, 3);
assert.deepEqual(
  drinkState.supportCardRollHistory.map((roll) => roll.supportCardId),
  ["drink-never", "drink-never", "drink-never"],
);
assert.equal(drinkState.randomState >>> 0, expectedDrinkRandom.state >>> 0);
assert.equal(drinkState.drinkHistory.length, 1);
assert.equal(drinkState.currentTurnDrinks.length, 1);
assert.ok(
  handBeforeDrink.some((id) => drinkState.discard.some((card) => card.id === id))
  || handBeforeDrink.some((id) => drinkState.hand.some((card) => card.id === id)),
  "the old hand participates in the Grave/recycle path",
);
}

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
assert.match(generatedPlay.effects.join(" / "), /カード生成: 眠気 ×1/);
assert.doesNotMatch(generatedPlay.effects.join(" / "), /p_card-00-acc-0_002/);
assert.deepEqual(state.deck.map((card) => card.id), [sleepyId]);
assert.equal(state.hand.some((card) => card.id === sleepyId), false, "generated after draw, so it is not drawn by the same effect");

const randomStep = new XorShift32(randomStateBeforeCreate);
randomStep.nextU32();
assert.equal(state.randomState, randomStep.state >>> 0, "DeckRandom consumes exactly one native RNG step even when Deck.Count is zero");

finishTowerTurn(state, { type: "end" });
const nextDraw = drawTowerTurn(state, 3);
assert.equal(nextDraw.drawn[0].id, sleepyId, "generated Sleepiness participates in subsequent deck/recycle flow");

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


// 夏夜に咲く思い出 removes one random 眠気 from Deck/Grave into Lost.
// Random selection uses the same XorShift stream even when only one target exists.
const summerMasters = [
  {
    id: "SUMMER",
    isInitial: true,
    category: "ProduceCardCategory_ActiveSkill",
    playMovePositionType: "ProduceCardMovePositionType_Lost",
    playEffects: [
      {
        produceExamTriggerId: "",
        produceExamEffectId: `e_effect-exam_card_move-p_card_search-deck_grave-${sleepyId}-lost-random-1_1`,
      },
      { produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_playable_value_add-01" },
      {
        produceExamTriggerId: "",
        produceExamEffectId: "e_effect-exam_status_enchant-inf-enchant-p_card-00-sup-3_152-enc01",
      },
    ],
  },
  ...["SA", "SB"].map((id) => ({
    id,
    category: "ProduceCardCategory_ActiveSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  })),
  {
    id: sleepyId,
    name: "眠気",
    category: "ProduceCardCategory_Trouble",
    playMovePositionType: "ProduceCardMovePositionType_Lost",
    playEffects: [],
  },
];
const summerById = new Map(summerMasters.map((card) => [card.id, card]));
const summerVariants = new Map(summerMasters.map((card) => [`${card.id}@@0`, card]));
state = createTowerTurnState(
  ["SUMMER", "SA", "SB", sleepyId].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 })),
  11,
  summerById,
  { cardVariantByKey: summerVariants },
);
drawTowerTurn(state, 3);
let sleepyHandIndex = state.hand.findIndex((card) => card.id === sleepyId);
if (sleepyHandIndex >= 0) state.discard.push(state.hand.splice(sleepyHandIndex, 1)[0]);
assert.equal(
  state.deck.some((card) => card.id === sleepyId) || state.discard.some((card) => card.id === sleepyId),
  true,
);
const summerIndex = state.hand.findIndex((card) => card.id === "SUMMER");
assert.ok(summerIndex >= 0);
const summerRandomBefore = state.randomState >>> 0;
const summerPlay = playTowerCard(state, summerIndex);
assert.equal(summerPlay.moved.length, 1);
assert.equal(summerPlay.moved[0].card.id, sleepyId);
assert.equal(["deck", "grave"].includes(summerPlay.moved[0].from), true);
assert.equal(summerPlay.moved[0].to, "lost");
assert.equal(state.deck.some((card) => card.id === sleepyId), false);
assert.equal(state.discard.some((card) => card.id === sleepyId), false);
assert.equal(state.lost.some((card) => card.id === sleepyId), true);
assert.match(summerPlay.effects.join(" / "), /山札・捨て札の眠気を除外へ移動/);
assert.doesNotMatch(summerPlay.effects.join(" / "), /p_card-00-acc-0_002/);
const summerRandomStep = new XorShift32(summerRandomBefore);
// Native PickCardPositionListImpl consumes one RNG word for the fixed 1_1
// pick count, then one random sort key for the single matching 眠気.
summerRandomStep.nextU32();
summerRandomStep.nextU32();
assert.equal(state.randomState, summerRandomStep.state >>> 0);
assert.equal(state.unsupported.length, 0);
const summerEnchantState = state.effectScheduler.registrations.find(
  (entry) => entry.sourceId === "enchant-p_card-00-sup-3_152-enc01",
);
assert.ok(summerEnchantState);
assert.equal(summerEnchantState.sourceType, "enchant");
assert.equal(summerEnchantState.phase, "afterCardPlay");
assert.equal(summerEnchantState.metadata.installedCardPlayCount, 1);

// The Summer Night enchant fires after every 5 skill-card plays *since installation*.
state.exam.cardPlayCount = 5;
const summerFollowupIndex = state.hand.findIndex((card) => card.category === "ProduceCardCategory_ActiveSkill");
assert.ok(summerFollowupIndex >= 0);
const parameterBeforeSummerEnchant = state.exam.parameter;
playTowerCard(state, summerFollowupIndex);
assert.equal(state.exam.parameter - parameterBeforeSummerEnchant, 4);

// Real-device regression: seed 1866421646 / 0x6F3F558E produced the
// same initial 13-card order in both normal-play and all-skip runs. In the
// normal-play run, 冒険心 consumed one DeckRandom RNG word and 夏夜に咲く思い出
// then removed one 眠気. The first two cards after the first recycle were the
// original visible-order cards #2 and #13. With only one RNG word for Summer,
// the replay incorrectly predicted #13 first.
const observedSummerMaster = {
  id: "SUMMER-OBSERVED",
  isInitial: true,
  category: "ProduceCardCategory_ActiveSkill",
  playMovePositionType: "ProduceCardMovePositionType_Lost",
  playEffects: [{
    produceExamTriggerId: "",
    produceExamEffectId: `e_effect-exam_card_move-p_card_search-deck_grave-${sleepyId}-lost-random-1_1`,
  }],
};
const observedSummerMasters = [
  observedSummerMaster,
  ...["F1", "F2"].map((id) => ({
    id,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  })),
  generatedMasters.at(-1),
];
const observedSummerById = new Map(observedSummerMasters.map((card) => [card.id, card]));
const observedSummerVariants = new Map(observedSummerMasters.map((card) => [`${card.id}@@0`, card]));
state = createTowerTurnState(
  ["SUMMER-OBSERVED", "F1", "F2"].map((id) => ({ id, upgradeCount: 0, fixedDeckOrder: 0 })),
  1,
  observedSummerById,
  { cardVariantByKey: observedSummerVariants },
);
drawTowerTurn(state, 3);
const observedSummerCard = state.hand.find((card) => card.id === "SUMMER-OBSERVED");
assert.ok(observedSummerCard);
state.hand = [observedSummerCard];
state.playsRemaining = 1;
// 0x1B90C26C is the RNG state immediately after the known 13-card initial
// shuffle. 冒険心's DeckRandom advances it once to 0x787533C2.
state.randomState = 0x787533c2;
state.deck = [];
state.discard = [
  { id: "OBS_02" },
  { id: "OBS_03" },
  { id: "OBS_04" },
  { id: "OBS_06" },
  { id: "OBS_05" },
  { id: "OBS_09" },
  { id: "OBS_12" },
  { id: "OBS_13" },
  { id: sleepyId },
];
const observedSummerPlay = playTowerCard(state, 0);
assert.equal(observedSummerPlay.moved.length, 1);
assert.equal(observedSummerPlay.moved[0].card.id, sleepyId);
assert.equal(state.randomState >>> 0, 0x2bea1937, "Summer must consume count + candidate-key RNG words");
finishTowerTurn(state, { type: "end" });
const observedRecycle = drawTowerTurn(state, 3);
assert.deepEqual(
  observedRecycle.drawn.slice(0, 2).map((card) => card.id),
  ["OBS_02", "OBS_13"],
  "known real-device seed must reproduce the first two post-recycle cards",
);

// 輝くキミへ+ adds a persistent "50% of 好印象" lesson effect
// on subsequent skill-card plays.
const shiningMasters = [
  {
    id: "SHINE",
    isInitial: true,
    category: "ProduceCardCategory_ActiveSkill",
    playMovePositionType: "ProduceCardMovePositionType_Lost",
    playEffects: [
      { produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_playable_value_add-01" },
      {
        produceExamTriggerId: "",
        produceExamEffectId: "e_effect-exam_status_enchant-inf-enchant-p_card-02-act-3_050-enc02",
      },
    ],
  },
  {
    id: "SNEXT",
    category: "ProduceCardCategory_MentalSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  },
  {
    id: "SX",
    category: "ProduceCardCategory_ActiveSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  },
];
const shiningById = new Map(shiningMasters.map((card) => [card.id, card]));
const shiningVariants = new Map(shiningMasters.map((card) => [`${card.id}@@0`, card]));
state = createTowerTurnState(
  shiningMasters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
  13,
  shiningById,
  { cardVariantByKey: shiningVariants },
);
drawTowerTurn(state, 3);
state.exam.review = 10;
const shineIndex = state.hand.findIndex((card) => card.id === "SHINE");
assert.ok(shineIndex >= 0);
playTowerCard(state, shineIndex);
assert.equal(state.unsupported.length, 0);
assert.equal(state.exam.parameter, 0, "the new enchant does not trigger on its own installing card");
const nextSkillIndex = state.hand.findIndex((card) => card.id === "SNEXT");
assert.ok(nextSkillIndex >= 0);
playTowerCard(state, nextSkillIndex);
assert.equal(state.exam.parameter, 5);

console.log("tower runtime tests: ok");


{
  const {
    buildTowerStageChoices,
    calculateTowerMemoryParameters,
    calculateTowerParameterBonus,
    calculateTowerTurnTypes,
    parseTowerBattleConfigs,
    parseTowerCatalog,
    parseTowerLayerExams,
    parseTowerLiveLayerMap,
    parseTowerScoreConfigs,
  } = await import("../web/tower_stage.js");

  const stageConfigs = parseTowerBattleConfigs(`
- id: p_exam_battle_config-other
  turn: 12
  vocal: 1
  dance: 1
  visual: 1
- id: p_exam_battle_config-tower_001-test
  turn: 12
  vocal: 40
  dance: 27
  visual: 33
  produceExamBattleScoreConfigId: p_exam_battle_score_config-tower_001-test
`);
  assert.equal(stageConfigs.length, 1);
  assert.deepEqual(
    calculateTowerTurnTypes(stageConfigs[0], 0x12345678),
    ["Vocal", "Visual", "Vocal", "Vocal", "Visual", "Visual", "Vocal", "Dance", "Dance", "Dance", "Visual", "Vocal"],
  );

  assert.deepEqual(
    calculateTowerMemoryParameters([
      { vocal: 1000, dance: 800, visual: 600 },
      { vocal: 500, dance: 400, visual: 300 },
      { raw: { vocal: 250, dance: 200, visual: 150 } },
    ]),
    { vocal: 1150, dance: 920, visual: 690 },
  );

  const scoreRows = parseTowerScoreConfigs(`
- id: p_exam_battle_score_config-tower_001-test
  parameter: 0
  vocalPermil: 0
  dancePermil: 0
  visualPermil: 0
- id: p_exam_battle_score_config-tower_001-test
  parameter: 100
  vocalPermil: 1000
  dancePermil: 1000
  visualPermil: 1000
`);
  const bonus = calculateTowerParameterBonus(
    { ...stageConfigs[0], vocal: 100, dance: 100, visual: 100 },
    scoreRows,
    { vocal: 100, dance: 50, visual: 0 },
  );
  assert.equal(bonus.totalPenaltyPermil, 425);
  assert.equal(bonus.vocal.percent, 158);
  assert.equal(bonus.dance.percent, 129);
  assert.equal(bonus.visual.percent, 100);

  const towers = parseTowerCatalog(`
- id: tower_001-hski
  characterId: hski
  title: 花海咲季のアイドルへの道
  order: 1
`);
  const layers = parseTowerLayerExams(`
- towerId: tower_001-hski
  number: 12
  examEffectType: ProduceExamEffectType_ExamParameterBuff
  produceExamBattleConfigId: p_exam_battle_config-tower_001-test
`);
  const liveLayers = parseTowerLiveLayerMap({
    effects: [
      "ProduceExamEffectType_ExamParameterBuff",
      "ProduceExamEffectType_ExamConcentration",
    ],
    configs: [
      "p_exam_battle_config-tower_001-test",
      "p_exam_battle_config-tower_001-focus",
    ],
    towers: {
      "tower_001-hski": [[12, 3, [0, 1]]],
      "tower_001-amao": [[12, 4, [0, 1]]],
    },
  });
  assert.equal(liveLayers.length, 4);
  assert.equal(liveLayers.find((row) => row.towerId === "tower_001-hski")?.maxSubMemoryCount, 3);
  assert.equal(
    liveLayers.find((row) => row.examEffectType === "ProduceExamEffectType_ExamConcentration")?.produceExamBattleConfigId,
    "p_exam_battle_config-tower_001-focus",
  );
  const stageCatalog = {
    configs: stageConfigs,
    configById: new Map(stageConfigs.map((config) => [config.id, config])),
    towers,
    towerById: new Map(towers.map((item) => [item.id, item])),
    layerExams: layers,
  };
  const choices = buildTowerStageChoices(stageCatalog, "hski", "ProduceExamEffectType_ExamParameterBuff");
  assert.equal(choices.length, 1);
  assert.equal(choices[0].number, 12);
  assert.match(choices[0].label, /12階/);

  const effectAwareCatalog = {
    ...stageCatalog,
    configById: new Map([
      ...stageCatalog.configById,
      ["p_exam_battle_config-tower_001-focus", { ...stageConfigs[0], id: "p_exam_battle_config-tower_001-focus", turn: 14 }],
    ]),
    layerExams: liveLayers,
    towerById: new Map(),
  };
  const focusChoices = buildTowerStageChoices(
    effectAwareCatalog,
    "hski",
    "ProduceExamEffectType_ExamConcentration",
  );
  assert.equal(focusChoices.length, 1);
  assert.equal(focusChoices[0].towerId, "tower_001-hski");
  assert.equal(focusChoices[0].configId, "p_exam_battle_config-tower_001-focus");
  assert.equal(focusChoices[0].maxSubMemoryCount, 3);
  assert.equal(
    focusChoices.some((choice) => choice.towerId === "tower_001-amao"),
    false,
    "characterId must automatically filter out other idols' towers",
  );
}


// Native runtime regressions: turn skip recovery, extra turns, default hand
// limit, and CardSearchEffectPlayCountBuff targeting/lifetime.
{
  const simpleMaster = (id, extra = {}) => ({
    id,
    category: "ProduceCardCategory_MentalSkill",
    rarity: "ProduceCardRarity_R",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
    ...extra,
  });

  // ExamSetting.examTurnEndRecoveryStamina = 2 when the player ends a turn
  // with a playable card use remaining.
  let masters = ["SKIP-A", "SKIP-B", "SKIP-C"].map((id) => simpleMaster(id));
  let byId = new Map(masters.map((card) => [card.id, card]));
  let runtime = createTowerTurnState(
    masters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
    1,
    byId,
    { stamina: 10, turnLimit: 1 },
  );
  drawTowerTurn(runtime, 3);
  runtime.exam.stamina = 5;
  const skipped = finishTowerTurn(runtime, { type: "skip" });
  assert.equal(runtime.exam.stamina, 7);
  assert.match((skipped.turnEndEffects ?? []).join(" / "), /ターンスキップ: 体力 \+2/);
  const endedDraw = drawTowerTurn(runtime, 3);
  assert.equal(endedDraw.ended, true);
  assert.equal(runtime.turn, 1);

  // HandLimit defaults to ExamSetting.handLimit = 5.
  masters = ["H1", "H2", "H3", "H4", "H5", "H6"].map((id) => simpleMaster(id));
  byId = new Map(masters.map((card) => [card.id, card]));
  runtime = createTowerTurnState(
    masters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
    2,
    byId,
  );
  const handLimited = drawTowerTurn(runtime, 6);
  assert.equal(handLimited.hand.length, 5);
  assert.equal(runtime.deck.length, 1);

  // ExtraTurn extends the stage turn limit. Extra turns reuse the final
  // normal turn attribute (native GetCurrentParameterType clamp).
  masters = [
    simpleMaster("EXTRA", {
      isInitial: true,
      playEffects: [{ produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_extra_turn" }],
    }),
    simpleMaster("EXTRA-B"),
    simpleMaster("EXTRA-C"),
  ];
  byId = new Map(masters.map((card) => [card.id, card]));
  runtime = createTowerTurnState(
    masters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
    3,
    byId,
    { stamina: 10, turnLimit: 1 },
  );
  runtime.turnParameterTypes = ["Vocal"];
  runtime.parameterBonus = {
    vocal: { bonusPermil: 1500 },
    dance: { bonusPermil: 1000 },
    visual: { bonusPermil: 1000 },
  };
  drawTowerTurn(runtime, 3);
  const extraIndex = runtime.hand.findIndex((card) => card.id === "EXTRA");
  assert.ok(extraIndex >= 0);
  playTowerCard(runtime, extraIndex);
  assert.equal(runtime.exam.extraTurns, 1);
  assert.equal(runtime.turnLimit, 2);
  finishTowerTurn(runtime, { type: "end" });
  const extraDraw = drawTowerTurn(runtime, 3);
  assert.equal(extraDraw.ended, undefined);
  assert.equal(runtime.turn, 2);
  assert.equal(currentTowerScoreContext(runtime).parameterType, "Vocal");

  // Search-targeted repeat status: a Mental card must neither consume nor
  // receive an Active-only repeat. The next matching Active card does both.
  masters = [
    simpleMaster("MENTAL", {
      category: "ProduceCardCategory_MentalSkill",
      playEffects: [{ produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_lesson-0003-01" }],
    }),
    simpleMaster("ACTIVE", {
      category: "ProduceCardCategory_ActiveSkill",
      playEffects: [{ produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_lesson-0003-01" }],
    }),
    simpleMaster("REPEAT-FILL"),
  ];
  byId = new Map(masters.map((card) => [card.id, card]));
  runtime = createTowerTurnState(
    masters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
    4,
    byId,
    { stamina: 10 },
  );
  drawTowerTurn(runtime, 3);
  runtime.playsRemaining = 2;
  runtime.cardEffectPlayCountBuff = {
    value: 1,
    count: 1,
    turn: 1,
    searchId: "p_card_search-active_skill-n-r-sr-ssr-playing",
  };
  const mentalIndex = runtime.hand.findIndex((card) => card.id === "MENTAL");
  assert.ok(mentalIndex >= 0);
  playTowerCard(runtime, mentalIndex);
  assert.equal(runtime.exam.parameter, 3);
  assert.equal(runtime.cardEffectPlayCountBuff.count, 1, "nonmatching card must not consume repeat status");

  const activeIndex = runtime.hand.findIndex((card) => card.id === "ACTIVE");
  assert.ok(activeIndex >= 0);
  playTowerCard(runtime, activeIndex);
  assert.equal(runtime.exam.parameter, 9, "matching card effect is executed once extra");
  assert.equal(runtime.cardEffectPlayCountBuff, null);

  // A finite unused repeat status expires at turn end.
  masters = ["TTL-A", "TTL-B", "TTL-C"].map((id) => simpleMaster(id));
  byId = new Map(masters.map((card) => [card.id, card]));
  runtime = createTowerTurnState(
    masters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
    5,
    byId,
    { stamina: 10 },
  );
  drawTowerTurn(runtime, 3);
  runtime.cardEffectPlayCountBuff = {
    value: 1,
    count: 1,
    turn: 1,
    searchId: "p_card_search-active_skill-playing",
  };
  finishTowerTurn(runtime, { type: "skip" });
  assert.equal(runtime.cardEffectPlayCountBuff, null);
}

console.log("native tower flow regression tests: ok");


// Current-card effects: grow effect, interval enchant, concentration, and 3-use stance enchant.
{
const GROW_ID = "e_effect-exam_add_grow_effect-p_card_search-mental_skill-deck_all-all-0_0-g_effect-block_add-6-g_effect-cost_add-1";
const INTERVAL_ENCHANT_ID = "e_effect-exam_status_enchant-inf-enchant-p_card-01-act-3_185-enc02";
const CONCENTRATION_ID = "e_effect-exam_concentration-0001";
const STANCE_ENCHANT_ID = "e_effect-exam_status_enchant-03-inf-enchant-p_card-03-ido-3_234-enc01";

const masters = [
  {
    id: "GROW",
    isInitial: true,
    category: "ProduceCardCategory_ActiveSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: GROW_ID }],
  },
  {
    id: "MENTAL-A",
    isInitial: true,
    category: "ProduceCardCategory_MentalSkill",
    stamina: 1,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_block-0002" }],
  },
  {
    id: "MENTAL-B",
    isInitial: true,
    category: "ProduceCardCategory_MentalSkill",
    stamina: 2,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  },
];
const growById = new Map(masters.map((card) => [card.id, card]));
let growState = createTowerTurnState(
  masters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
  1,
  growById,
  { stamina: 20 },
);
drawTowerTurn(growState, 3);
playTowerCard(growState, growState.hand.findIndex((card) => card.id === "GROW"));
const grownA = growState.hand.find((card) => card.id === "MENTAL-A");
const grownB = growState.hand.find((card) => card.id === "MENTAL-B");
assert.equal(grownA.growBlockAdd, 6);
assert.equal(grownA.stamina, 2);
assert.equal(grownB.growBlockAdd, 6);
assert.equal(grownB.stamina, 3);
growState.playsRemaining = 1;
playTowerCard(growState, growState.hand.findIndex((card) => card.id === "MENTAL-A"));
assert.equal(growState.exam.block, 8, "元気2のカードへGrow BlockAdd +6を適用する");

const intervalMasters = [
  {
    id: "INSTALL-185",
    isInitial: true,
    category: "ProduceCardCategory_ActiveSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: INTERVAL_ENCHANT_ID }],
  },
  {
    id: "SKILL-1",
    isInitial: true,
    category: "ProduceCardCategory_ActiveSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  },
  {
    id: "SKILL-2",
    isInitial: true,
    category: "ProduceCardCategory_MentalSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  },
];
const intervalById = new Map(intervalMasters.map((card) => [card.id, card]));
let intervalState = createTowerTurnState(
  intervalMasters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
  1,
  intervalById,
);
drawTowerTurn(intervalState, 3);
intervalState.exam.parameterBuff = 20;
intervalState.exam.lessonBuff = 2;
playTowerCard(intervalState, intervalState.hand.findIndex((card) => card.id === "INSTALL-185"));
intervalState.playsRemaining = 1;
playTowerCard(intervalState, intervalState.hand.findIndex((card) => card.id === "SKILL-1"));
assert.equal(intervalState.exam.parameterBuff, 20, "インストール後1回目では発火しない");
intervalState.playsRemaining = 1;
playTowerCard(intervalState, intervalState.hand.findIndex((card) => card.id === "SKILL-2"));
assert.equal(intervalState.exam.parameterBuff, 17, "2回目で好調-3");
assert.ok(intervalState.exam.parameter > 0, "2回目で集中4倍適用のパラメータ効果が発火する");

const stanceMasters = [
  {
    id: "SET-CONCENTRATION",
    isInitial: true,
    category: "ProduceCardCategory_ActiveSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: CONCENTRATION_ID }],
  },
  {
    id: "INSTALL-234",
    isInitial: true,
    category: "ProduceCardCategory_ActiveSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: STANCE_ENCHANT_ID }],
  },
  {
    id: "ACTIVE-1",
    isInitial: true,
    category: "ProduceCardCategory_ActiveSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  },
];
const stanceById = new Map(stanceMasters.map((card) => [card.id, card]));
let stanceState = createTowerTurnState(
  stanceMasters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
  1,
  stanceById,
);
drawTowerTurn(stanceState, 3);
playTowerCard(stanceState, stanceState.hand.findIndex((card) => card.id === "SET-CONCENTRATION"));
assert.equal(stanceState.exam.idolStatusType, 1);
assert.equal(stanceState.exam.idolStatusStep, 1);

stanceState.playsRemaining = 1;
playTowerCard(stanceState, stanceState.hand.findIndex((card) => card.id === "INSTALL-234"));
const stanceRegistration = stanceState.effectScheduler.registrations.find(
  (entry) => entry.sourceId === "enchant-p_card-03-ido-3_234-enc01",
);
assert.ok(stanceRegistration);
assert.equal(stanceRegistration.remainingCount, 3);

stanceState.exam.idolStatusType = 1;
stanceState.exam.idolStatusStep = 2;
stanceState.playsRemaining = 1;
playTowerCard(stanceState, stanceState.hand.findIndex((card) => card.id === "ACTIVE-1"));
assert.equal(stanceState.exam.idolStatusType, 2);
assert.equal(stanceState.exam.idolStatusStep, 2);
assert.equal(stanceRegistration.remainingCount, 2, "03 status enchant consumes one of three activations");

console.log("current card grow/enchant runtime regressions: ok");
}


{
const { describeParsedEffect, parseExamEffectId } = await import("../web/exam_effects.js");

const timerEffectId = "e_effect-exam_effect_timer-0001-01-e_effect-exam_preservation-0001";
const parsedTimer = parseExamEffectId(timerEffectId);
assert.equal(parsedTimer.kind, "effect_timer");
assert.equal(
  describeParsedEffect(parsedTimer),
  "1ターン後: 温存1段階目に変更",
  "timer log must expose the delayed child effect",
);

const timerMasters = [
  {
    id: "TIMER",
    name: "インフルエンサー+",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: timerEffectId }],
  },
  { id: "A", playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
  { id: "B", playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
];
const timerById = new Map(timerMasters.map((card) => [card.id, card]));
const timerState = createTowerTurnState(
  timerMasters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
  1,
  timerById,
);
drawTowerTurn(timerState, 3);
const timerIndex = timerState.hand.findIndex((card) => card.id === "TIMER");
assert.notEqual(timerIndex, -1);
const timerPlay = playTowerCard(timerState, timerIndex);
assert.match(timerPlay.effects.join(" / "), /1ターン後: 温存1段階目に変更/);
finishTowerTurn(timerState, { type: "end" });
assert.equal(
  timerState.exam.idolStatusType,
  0,
  "a 1-turn timer must not fire at the end of the turn where it was registered",
);

const timerTurn2 = drawTowerTurn(timerState, 3);
assert.equal(timerState.turn, 2);
assert.equal(timerState.exam.idolStatusType, 2, "the delayed effect must switch to Preservation on the next turn");
assert.equal(timerState.exam.idolStatusStep, 1);
assert.match(timerTurn2.nativePhaseEffects.join(" / "), /温存1段階目に変更/);
finishTowerTurn(timerState, { type: "skip" });
assert.match(
  (timerState.history[1]?.turnStartEffects ?? []).join(" / "),
  /温存1段階目に変更/,
  "the delayed effect must be attached to Turn 2 start history",
);

console.log("effect timer next-turn semantics tests: ok");
}

{
const pointEffect = {
  id: "POINT-10",
  effectType: "ProduceExamEffectType_ExamFullPowerPoint",
  effectValue1: 10,
};
const fullPowerEffect = {
  id: "DIRECT-FULL-POWER",
  effectType: "ProduceExamEffectType_ExamFullPower",
};
const anomalyCards = [
  {
    id: "GAIN-POINT",
    category: "ProduceCardCategory_MentalSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: pointEffect.id }],
  },
  {
    id: "DIRECT-FULL",
    category: "ProduceCardCategory_MentalSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: fullPowerEffect.id }],
  },
  {
    id: "NEXT",
    category: "ProduceCardCategory_ActiveSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  },
];
const anomalyCardById = new Map(anomalyCards.map((card) => [card.id, card]));
const anomalyEffectById = new Map([
  [pointEffect.id, pointEffect],
  [fullPowerEffect.id, fullPowerEffect],
]);

let anomalyState = createTowerTurnState(
  anomalyCards.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
  1,
  anomalyCardById,
  { examEffectById: anomalyEffectById },
);
drawTowerTurn(anomalyState, 3);
playTowerCard(anomalyState, anomalyState.hand.findIndex((card) => card.id === "GAIN-POINT"));
assert.equal(anomalyState.exam.fullPowerPoint, 0, "10 points are consumed by automatic Full Power");
assert.equal(anomalyState.exam.idolStatusType, 3);
assert.equal(anomalyState.playsRemaining, 1, "automatic Full Power adds one card play");
playTowerCard(anomalyState, anomalyState.hand.findIndex((card) => card.id === "NEXT"));
assert.equal(anomalyState.exam.idolStatusType, 0, "Full Power ends after one card");

anomalyState = createTowerTurnState(
  anomalyCards.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
  1,
  anomalyCardById,
  { examEffectById: anomalyEffectById },
);
drawTowerTurn(anomalyState, 3);
anomalyState.exam.idolStatusType = 4;
anomalyState.exam.idolStatusStep = 1;
playTowerCard(anomalyState, anomalyState.hand.findIndex((card) => card.id === "DIRECT-FULL"));
assert.equal(anomalyState.exam.block, 5);
assert.equal(anomalyState.exam.enthusiastic, 10);
assert.equal(anomalyState.playsRemaining, 2, "release and direct Full Power both add a play");
assert.ok(
  anomalyState.hand.find((card) => card.id === "NEXT").customGrowEffects
    .some((effect) => effect.effectType === "ProduceCardGrowEffectType_LessonAdd" && effect.value === 10),
  "Over Preservation release into Full Power grows every card by LessonAdd 10",
);

console.log("native Full Power lifecycle tests: ok");
}


{
const createEffect = {
  id: "TEST-CREATE-SEARCH",
  effectType: "ProduceExamEffectType_ExamCardCreateSearch",
  produceCardSearchId: "test-search",
  movePositionType: "ProduceCardMovePositionType_Hand",
  pickRangeType: "ProducePickRangeType_Random",
  pickCountMin: 1,
  pickCountMax: 1,
};
const masters = [
  {
    id: "TRIGGER",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: createEffect.id }],
  },
  { id: "GEN-A", name: "A", playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
  { id: "GEN-B", name: "B", playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
];
const byId = new Map(masters.map((card) => [card.id, card]));
const effectById = new Map([[createEffect.id, createEffect]]);
const searchById = new Map([["test-search", {
  id: "test-search",
  produceCardIds: ["GEN-A", "GEN-B"],
  cardPositionType: "ProduceCardPositionType_Unknown",
}]]);

const fixedState = createTowerTurnState(
  [{ id: "TRIGGER", upgradeCount: 0, fixedDeckOrder: 0 }],
  1,
  byId,
  { examEffectById: effectById, cardSearchById: searchById },
);
drawTowerTurn(fixedState, 1);
fixedState.randomState = 0x12345678;
const fixedExpected = new XorShift32(0x12345678);
// Fixed Random 1_1 still consumes count RNG, then one random-sort key per candidate.
for (let i = 0; i < 3; i += 1) fixedExpected.nextU32();
const fixedPlay = playTowerCard(fixedState, 0);
assert.equal(fixedPlay.created.length, 1);
assert.equal(fixedState.randomState >>> 0, fixedExpected.state >>> 0);
assert.equal(
  fixedState.hand.some((card) => card.id === fixedPlay.created[0].card.id),
  true,
);

const poolSearchById = new Map([["pool-search", {
  id: "pool-search",
  produceCardRandomPoolId: "POOL",
  cardPositionType: "ProduceCardPositionType_Unknown",
}]]);
const poolEffect = {
  ...createEffect,
  id: "TEST-CREATE-RANDOM-POOL",
  produceCardSearchId: "pool-search",
};
const poolState = createTowerTurnState(
  [{ id: "TRIGGER", upgradeCount: 0, fixedDeckOrder: 0 }],
  1,
  byId,
  {
    examEffectById: new Map([[poolEffect.id, poolEffect]]),
    cardSearchById: poolSearchById,
    cardRandomPoolById: new Map([["POOL", [
      { id: "POOL", produceCardId: "GEN-A", upgradeCount: 0, ratio: 1 },
      { id: "POOL", produceCardId: "GEN-B", upgradeCount: 0, ratio: 3 },
    ]]]),
  },
);
// Point the trigger to the pool effect for this isolated state.
poolState.deck[0].playEffects = [{ produceExamTriggerId: "", produceExamEffectId: poolEffect.id }];
drawTowerTurn(poolState, 1);
poolState.randomState = 0x12345678;
const poolExpected = new XorShift32(0x12345678);
// 1x fixed count roll + 1x weighted pool roll.
poolExpected.nextU32();
poolExpected.nextU32();
const poolPlay = playTowerCard(poolState, 0);
assert.equal(poolPlay.created.length, 1);
assert.equal(poolPlay.created[0].card.id, "GEN-B", "weighted roll 2/4 lands in GEN-B's ratio-3 bucket");
assert.equal(poolPlay.created[0].randomPoolId, "POOL");
assert.equal(poolState.randomState >>> 0, poolExpected.state >>> 0);
assert.deepEqual(poolState.unsupported, []);

console.log("native random selection regressions: ok");
}
