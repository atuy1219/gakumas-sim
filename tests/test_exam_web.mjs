// Consolidated web exam/effect regression tests.

// test_card_master_effects.mjs
{
const { default: assert } = await import("node:assert/strict");
const { parseProduceCardCatalogYaml } = await import("../web/engine.js");

const yaml = `
- id: p_card-test
  upgradeCount: 0
  name: テストカード
  planType: ProducePlanType_Plan1
  stamina: 3
  forceStamina: 1
  costType: ExamCostType_ExamReview
  costValue: 2
  playProduceExamTriggerId: ""
  playEffects:
  - produceExamTriggerId: ""
    produceExamEffectId: e_effect-exam_lesson-0010-01
  - produceExamTriggerId: e_trigger-exam_card_play-review_up-3
    produceExamEffectId: e_effect-exam_block-0005
  playMovePositionType: ProduceCardMovePositionType_Lost
  isInitial: false
  isRestrict: true
  noDeckDuplication: true
  originCharacterId: char-a
  originIdolCardId: idol-a
  originPrimaStellaIdolCardId: prima-a
  originSupportCardId: support-a
  libraryHidden: true
  isReward: true
  unlockProducerLevel: 55
  isCharacterAsset: true
  moveProduceExamEffectIds:
  - e_effect-exam_card_draw-0001
`;

const [card] = parseProduceCardCatalogYaml(yaml);
assert.equal(card.id, "p_card-test");
assert.equal(card.stamina, 3);
assert.equal(card.forceStamina, 1);
assert.equal(card.costType, "ExamCostType_ExamReview");
assert.equal(card.costValue, 2);
assert.equal(card.playEffects.length, 2);
assert.equal(card.playEffects[0].produceExamEffectId, "e_effect-exam_lesson-0010-01");
assert.equal(card.playEffects[1].produceExamTriggerId, "e_trigger-exam_card_play-review_up-3");
assert.equal(card.playMovePositionType, "ProduceCardMovePositionType_Lost");
assert.equal(card.isRestrict, true);
assert.equal(card.noDeckDuplication, true);
assert.equal(card.originCharacterId, "char-a");
assert.equal(card.originIdolCardId, "idol-a");
assert.equal(card.originPrimaStellaIdolCardId, "prima-a");
assert.equal(card.originSupportCardId, "support-a");
assert.equal(card.libraryHidden, true);
assert.equal(card.isReward, true);
assert.equal(card.unlockProducerLevel, 55);
assert.equal(card.isCharacterAsset, true);
assert.deepEqual(card.moveProduceExamEffectIds, ["e_effect-exam_card_draw-0001"]);

console.log("card master effect parser tests: ok");
}

// test_native_exam_score.mjs
{
const { default: assert } = await import("node:assert/strict");
const {
  EXAM_IDOL_STATUS_TYPE,
  NATIVE_LESSON_MODIFIER_KIND,
  addNativeLessonParameter,
  applyNativeBattleBonus,
  applyNativeLessonHits,
  applyNativeModifiedLessonRepeat,
  calculateNativeAddingParameter,
  calculateNativeDependentLessonBase,
} = await import("../web/exam_score.js");
const { createExamState } = await import("../web/exam_effects.js");

let exam = createExamState();
assert.equal(calculateNativeAddingParameter(exam, 8), 8, "plain Lesson");

exam = createExamState();
exam.parameterBuff = 4;
assert.equal(calculateNativeAddingParameter(exam, 10), 15, "好調 uses native 1500 permil");

exam.parameterBuffMultiplePerTurn = 4;
assert.equal(
  calculateNativeAddingParameter(exam, 10),
  19,
  "絶好調 adds 100 permil per remaining 好調 turn",
);

exam = createExamState();
exam.lessonBuff = 5;
assert.equal(calculateNativeAddingParameter(exam, 8), 13, "集中 is added before multipliers");

exam = createExamState();
exam.review = 20;
exam.aggressive = 7;
exam.lessonValueDependReviewAggressive = true;
assert.equal(
  calculateNativeAddingParameter(exam, 10),
  14,
  "好印象/やる気 dependent multiplier is capped after native float32 math",
);

exam = createExamState();
exam.idolStatusType = EXAM_IDOL_STATUS_TYPE.FullPower;
assert.equal(calculateNativeAddingParameter(exam, 10), 30, "FullPower stance uses 3000 permil");

exam = createExamState();
exam.idolStatusType = EXAM_IDOL_STATUS_TYPE.Preservation;
exam.idolStatusStep = 1;
assert.equal(calculateNativeAddingParameter(exam, 10), 5, "Preservation step 1 uses 500 permil");

assert.equal(calculateNativeDependentLessonBase(4, 1500), 6);
assert.equal(applyNativeBattleBonus(15, 1234), 19);
assert.equal(applyNativeBattleBonus(10, 1500), 15, "negative epsilon must not round exact integers up");

exam = createExamState();
const repeated = applyNativeLessonHits(exam, 1, 2, {
  isBattle: true,
  battleBonusPermil: 1500,
  parameterType: "Vocal",
});
assert.equal(repeated.added, 4, "repeated Lesson effects round per hit, not after aggregation");
assert.equal(exam.parameter, 4);
assert.equal(exam.parameterVocal, 4);

exam = createExamState();
const direct = addNativeLessonParameter(exam, 10, {
  isBattle: true,
  battleBonusPermil: 1234,
  parameterType: "Dance",
});
assert.equal(direct.calculated, 10);
assert.equal(direct.added, 13);
assert.equal(exam.parameterDance, 13);

exam = createExamState();
exam.idolStatusType = EXAM_IDOL_STATUS_TYPE.Concentration;
exam.idolStatusStep = 1;
let special = applyNativeModifiedLessonRepeat(
  exam,
  10,
  500,
  2,
  NATIVE_LESSON_MODIFIER_KIND.Concentration,
);
assert.equal(special.calculated, 25);
assert.equal(special.added, 50);

exam = createExamState();
exam.enthusiastic = 10;
special = applyNativeModifiedLessonRepeat(
  exam,
  10,
  500,
  2,
  NATIVE_LESSON_MODIFIER_KIND.Enthusiastic,
);
assert.equal(special.calculated, 25);
assert.equal(special.added, 50);

exam = createExamState();
exam.idolStatusType = EXAM_IDOL_STATUS_TYPE.FullPower;
special = applyNativeModifiedLessonRepeat(
  exam,
  10,
  500,
  2,
  NATIVE_LESSON_MODIFIER_KIND.FullPower,
  { isBattle: true, battleBonusPermil: 1500, parameterType: "Visual" },
);
assert.equal(special.calculated, 40);
assert.equal(special.added, 120);
assert.equal(exam.parameterVisual, 120);

console.log("native exam score tests: ok");
}

// test_effect_runtime.mjs
{
const { default: assert } = await import("node:assert/strict");
const {
  applyParsedExamEffect,
  checkCardEffectTrigger,
  createExamState,
  parseExamEffectId,
} = await import("../web/exam_effects.js");
const {
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  playTowerCard,
} = await import("../web/tower_runtime.js");

const requestedEffects = [
  "e_effect-exam_lesson_add_multiple_parameter_buff-0010-1000-01",
  "e_effect-exam_effect_timer-0001-01-e_effect-exam_lesson-0040-01",
  "e_effect-exam_card_search_effect_play_count_buff-0001-01-inf-p_card_search-n-r-sr-ssr-playing-all-0_0",
  "e_effect-exam_effect_timer-0001-01-e_effect-exam_card_draw-0002",
  "e_effect-exam_effect_timer-0002-01-e_effect-exam_card_draw-0001",
  "e_effect-exam_lesson_depend_parameter_buff-1500-01",
  "e_effect-exam_lesson_depend_exam_card_play_aggressive-1100-01",
  "e_effect-exam_lesson_value_multiple-0100-05",
  "e_effect-exam_lesson_value_multiple_down-0200-05",
  "e_effect-exam_review_multiple-0500-05",
  "e_effect-exam_review_count_add-01-05",
  "e_effect-exam_lesson_value_multiple_depend_review_or_aggressive-02",
  "e_effect-exam_review_turn_end_reduce_lock-02",
  "e_effect-exam_parameter_buff_turn_end_reduce_lock-02",
  "e_effect-exam_hand_grave_count_card_draw",
  "e_effect-exam_status_enchant-inf-enchant-p_card-01-men-3_035-enc01",
  "e_effect-exam_effect_timer-0001-01-e_effect-exam_card_upgrade-p_card_search-hand-all-0_0",
  "e_effect-exam_parameter_buff_multiple_per_turn-04",
  "e_effect-exam_effect_timer-0001-01-e_effect-exam_lesson-0047-01",
  "e_effect-exam_effect_timer-0002-01-e_effect-exam_lesson_add_multiple_parameter_buff-0021-1000-01",
  "e_effect-exam_effect_timer-0001-01-e_effect-exam_card_draw-0001",
  "e_effect-exam_status_enchant-inf-enchant-p_card-01-act-3_049-enc02",
];

for (const id of requestedEffects) {
  assert.notEqual(parseExamEffectId(id).kind, "unsupported", id);
}

assert.deepEqual(
  checkCardEffectTrigger("e_trigger-none-parameter_buff_up-2", { parameterBuff: 2 }),
  { triggered: true, supported: true, triggerId: "e_trigger-none-parameter_buff_up-2" },
);
assert.equal(checkCardEffectTrigger("e_trigger-none-parameter_buff_up-2", { parameterBuff: 1 }).triggered, false);

const exam = createExamState();
exam.parameterBuff = 4;
applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_lesson_add_multiple_parameter_buff-0010-1000-01"));
assert.equal(exam.parameter, 20);
applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_lesson_depend_parameter_buff-1500-01"));
assert.equal(exam.parameter, 29);
applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_parameter_buff_multiple_per_turn-04"));
assert.equal(exam.parameterBuffMultiplePerTurn, 4);

const multiplierExam = createExamState();
applyParsedExamEffect(multiplierExam, parseExamEffectId("e_effect-exam_lesson_value_multiple-0100-05"));
applyParsedExamEffect(multiplierExam, parseExamEffectId("e_effect-exam_lesson_value_multiple-0100-05"));
assert.ok(Math.abs(multiplierExam.lessonParameterMultiple - 1.2) < 1e-6);
applyParsedExamEffect(multiplierExam, parseExamEffectId("e_effect-exam_lesson_value_multiple_down-0200-05"));
applyParsedExamEffect(multiplierExam, parseExamEffectId("e_effect-exam_lesson-0010-01"));
assert.equal(multiplierExam.parameter, 10, "1.2 × (1 - 0.2) × 10 rounds to 10");

const prideExam = createExamState();
prideExam.review = 20;
applyParsedExamEffect(
  prideExam,
  parseExamEffectId("e_effect-exam_lesson_value_multiple_depend_review_or_aggressive-02"),
);
assert.equal(prideExam.lessonValueDependReviewAggressive, true);
applyParsedExamEffect(prideExam, parseExamEffectId("e_effect-exam_lesson-0010-01"));
assert.equal(prideExam.parameter, 14, "Pride adds max(Review,Aggressive) × 2%, capped at 50%");

const aggressiveExam = createExamState();
aggressiveExam.aggressive = 10;
applyParsedExamEffect(
  aggressiveExam,
  parseExamEffectId("e_effect-exam_lesson_depend_exam_card_play_aggressive-1100-01"),
);
assert.equal(aggressiveExam.parameter, 11);

function masterCard(id, effectIds = [], extra = {}) {
  return {
    id,
    category: "ProduceCardCategory_MentalSkill",
    rarity: "ProduceCardRarity_R",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: effectIds.map((produceExamEffectId) => ({ produceExamEffectId, produceExamTriggerId: "" })),
    ...extra,
  };
}

function createState(cards, masters) {
  const byId = new Map(masters.map((card) => [card.id, card]));
  return createTowerTurnState(cards.map((id) => ({ id })), 1, byId, { stamina: 20 });
}

// Native turn end converts Review into a Lesson score before Review spends one turn.
const reviewState = createState(["review-filler"], [masterCard("review-filler")]);
reviewState.turnParameterTypes = ["Vocal"];
reviewState.parameterBonus = {
  vocal: { bonusPermil: 1500 },
  dance: { bonusPermil: 1000 },
  visual: { bonusPermil: 1000 },
};
reviewState.exam.review = 5;
drawTowerTurn(reviewState, 1);
finishTowerTurn(reviewState, { type: "skip" });
assert.equal(reviewState.exam.parameter, 8);
assert.equal(reviewState.exam.parameterVocal, 8);
assert.equal(reviewState.exam.review, 4);
assert.match(reviewState.history[0].turnEndEffects.join(" / "), /好印象ターン終了スコア \+8/);

// ReviewMultiple and ReviewCountAdd are finite native statuses. They affect the
// same turn's automatic Review score, then spend one status turn.
const reviewBoostState = createState(["review-boost-filler"], [masterCard("review-boost-filler")]);
reviewBoostState.exam.review = 5;
applyParsedExamEffect(
  reviewBoostState.exam,
  parseExamEffectId("e_effect-exam_review_multiple-0500-05"),
);
applyParsedExamEffect(
  reviewBoostState.exam,
  parseExamEffectId("e_effect-exam_review_count_add-01-05"),
);
drawTowerTurn(reviewBoostState, 1);
finishTowerTurn(reviewBoostState, { type: "skip" });
assert.equal(reviewBoostState.exam.parameter, 16, "ceil(5 × 1.5) fires twice");
assert.equal(reviewBoostState.exam.review, 4);
assert.ok(Math.abs(reviewBoostState.exam.reviewMultiple - 1.5) < 1e-6);
assert.equal(reviewBoostState.exam.reviewCountAdd, 1);
assert.deepEqual(
  reviewBoostState.exam.scoreTimedStatuses.map((status) => [status.kind, status.turn]),
  [["reviewMultiple", 4], ["reviewCountAdd", 4]],
);

// Turn-end locks prevent Review/ParameterBuff spending while their finite
// status is active; the lock itself still spends a turn.
const lockState = createState(["lock-filler"], [masterCard("lock-filler")]);
lockState.exam.review = 3;
lockState.exam.parameterBuff = 3;
applyParsedExamEffect(lockState.exam, parseExamEffectId("e_effect-exam_review_turn_end_reduce_lock-02"));
applyParsedExamEffect(lockState.exam, parseExamEffectId("e_effect-exam_parameter_buff_turn_end_reduce_lock-02"));
for (let turn = 0; turn < 2; turn += 1) {
  drawTowerTurn(lockState, 1);
  finishTowerTurn(lockState, { type: "skip" });
  assert.equal(lockState.exam.review, 3);
  assert.equal(lockState.exam.parameterBuff, 3);
}
assert.equal(lockState.exam.reviewTurnEndReduceLock, 0);
assert.equal(lockState.exam.parameterBuffTurnEndReduceLock, 0);
drawTowerTurn(lockState, 1);
finishTowerTurn(lockState, { type: "skip" });
assert.equal(lockState.exam.review, 2);
assert.equal(lockState.exam.parameterBuff, 2);

const timerCard = masterCard("timer", ["e_effect-exam_effect_timer-0001-01-e_effect-exam_lesson-0040-01"]);
const timerState = createState(["timer"], [timerCard]);
drawTowerTurn(timerState, 1);
playTowerCard(timerState, 0);
finishTowerTurn(timerState);
assert.equal(timerState.exam.parameter, 40);
assert.equal(timerState.timers.length, 0);

const drawTimerCard = masterCard("draw-timer", ["e_effect-exam_effect_timer-0001-01-e_effect-exam_card_draw-0002"]);
const fillerCards = ["a", "b", "c", "d"].map((id) => masterCard(id));
const drawTimerState = createState(["draw-timer", "a", "b", "c", "d"], [drawTimerCard, ...fillerCards]);
drawTowerTurn(drawTimerState, 1);
const timerIndex = drawTimerState.hand.findIndex((card) => card.id === "draw-timer");
if (timerIndex < 0) {
  drawTimerState.deck.unshift(...drawTimerState.hand);
  drawTimerState.hand = [drawTimerState.deck.splice(drawTimerState.deck.findIndex((card) => card.id === "draw-timer"), 1)[0]];
}
playTowerCard(drawTimerState, 0);
finishTowerTurn(drawTimerState);
assert.equal(drawTimerState.pendingDraw, 2);
assert.equal(drawTowerTurn(drawTimerState, 1).hand.length, 3);

const swapCard = masterCard("swap", ["e_effect-exam_hand_grave_count_card_draw"]);
const swapState = createState(["swap", "a", "b", "c", "d"], [swapCard, ...fillerCards]);
swapState.hand = [
  swapState.deck.splice(swapState.deck.findIndex((card) => card.id === "swap"), 1)[0],
  ...swapState.deck.splice(0, 2),
];
swapState.playsRemaining = 1;
const beforeSwap = swapState.hand.length;
const swapEvent = playTowerCard(swapState, 0);
assert.equal(swapState.hand.length, beforeSwap - 1);
assert.equal(swapEvent.drawn.length, beforeSwap - 1);

const buff = masterCard("buff", ["e_effect-exam_card_search_effect_play_count_buff-0001-01-inf-p_card_search-n-r-sr-ssr-playing-all-0_0"]);
const score = masterCard("score", ["e_effect-exam_lesson-0010-01"]);
const repeatState = createState(["buff", "score"], [buff, score]);
repeatState.hand = [repeatState.deck.splice(repeatState.deck.findIndex((card) => card.id === "buff"), 1)[0]];
repeatState.playsRemaining = 1;
playTowerCard(repeatState, 0);
finishTowerTurn(repeatState);
repeatState.hand = [repeatState.deck.splice(repeatState.deck.findIndex((card) => card.id === "score"), 1)[0]];
repeatState.playsRemaining = 1;
playTowerCard(repeatState, 0);
assert.equal(repeatState.exam.parameter, 20);

const enchant = masterCard("enchant", ["e_effect-exam_status_enchant-inf-enchant-p_card-01-act-3_049-enc02"]);
const active = masterCard("active", [], { category: "ProduceCardCategory_ActiveSkill" });
const enchantState = createState(["enchant", "active"], [enchant, active]);
enchantState.hand = [enchantState.deck.splice(enchantState.deck.findIndex((card) => card.id === "enchant"), 1)[0]];
enchantState.playsRemaining = 1;
playTowerCard(enchantState, 0);
finishTowerTurn(enchantState);
enchantState.hand = [enchantState.deck.splice(enchantState.deck.findIndex((card) => card.id === "active"), 1)[0]];
enchantState.playsRemaining = 1;
playTowerCard(enchantState, 0);
assert.equal(enchantState.exam.parameter, 5);

const reviewThirtyEnchant = masterCard(
  "review-thirty-enchant",
  ["e_effect-exam_status_enchant-inf-enchant-p_card-02-act-3_050-enc01"],
);
const reviewThirtySkill = masterCard("review-thirty-skill", [], {
  category: "ProduceCardCategory_MentalSkill",
});
const reviewThirtyState = createState(
  ["review-thirty-enchant", "review-thirty-skill"],
  [reviewThirtyEnchant, reviewThirtySkill],
);
reviewThirtyState.exam.review = 10;
reviewThirtyState.hand = [
  reviewThirtyState.deck.splice(
    reviewThirtyState.deck.findIndex((card) => card.id === "review-thirty-enchant"),
    1,
  )[0],
];
reviewThirtyState.playsRemaining = 1;
playTowerCard(reviewThirtyState, 0);
assert.equal(
  reviewThirtyState.exam.parameter,
  0,
  "newly installed 30% enchant must not trigger on its own card",
);
finishTowerTurn(reviewThirtyState);
reviewThirtyState.hand = [
  reviewThirtyState.deck.splice(
    reviewThirtyState.deck.findIndex((card) => card.id === "review-thirty-skill"),
    1,
  )[0],
];
reviewThirtyState.playsRemaining = 1;
const reviewThirtyParameterBefore = reviewThirtyState.exam.parameter;
playTowerCard(reviewThirtyState, 0);
assert.equal(
  reviewThirtyState.exam.parameter - reviewThirtyParameterBefore,
  3,
  "30% of the post-turn Review value (9) rounds up to 3",
);
assert.equal(
  reviewThirtyState.effectScheduler.registrations.some(
    (entry) => entry.sourceId === "enchant-p_card-02-act-3_050-enc01",
  ),
  true,
);

const endEnchant = masterCard("end-enchant", ["e_effect-exam_status_enchant-inf-enchant-p_card-01-men-3_035-enc01"]);
const endEnchantState = createState(["end-enchant"], [endEnchant]);
endEnchantState.exam.lessonBuff = 3;
drawTowerTurn(endEnchantState, 1);
playTowerCard(endEnchantState, 0);
finishTowerTurn(endEnchantState);
assert.equal(endEnchantState.exam.lessonBuff, 5);

const upgradeTimer = masterCard("upgrade-timer", ["e_effect-exam_effect_timer-0001-01-e_effect-exam_card_upgrade-p_card_search-hand-all-0_0"]);
const upgradeState = createState(["upgrade-timer", "a", "b", "c"], [upgradeTimer, ...fillerCards]);
upgradeState.hand = [upgradeState.deck.splice(upgradeState.deck.findIndex((card) => card.id === "upgrade-timer"), 1)[0]];
upgradeState.playsRemaining = 1;
playTowerCard(upgradeState, 0);
finishTowerTurn(upgradeState);
assert.equal(upgradeState.pendingHandUpgradeAll, 1);
const upgradedHand = drawTowerTurn(upgradeState, 2).hand;
assert.equal(upgradedHand.length, 2);
assert.ok(upgradedHand.every((card) => card.upgradeCount === 1));

const timerTwo = masterCard("timer-two", ["e_effect-exam_effect_timer-0002-01-e_effect-exam_card_draw-0001"]);
const timerTwoState = createState(["timer-two", "a", "b"], [timerTwo, ...fillerCards]);
timerTwoState.hand = [timerTwoState.deck.splice(timerTwoState.deck.findIndex((card) => card.id === "timer-two"), 1)[0]];
timerTwoState.playsRemaining = 1;
playTowerCard(timerTwoState, 0);
finishTowerTurn(timerTwoState);
assert.equal(timerTwoState.pendingDraw, 0);
drawTowerTurn(timerTwoState, 1);
finishTowerTurn(timerTwoState);
assert.equal(timerTwoState.pendingDraw, 1);

console.log("effect runtime v8 tests: ok");
}

// test_exam_effects.mjs
{
const { default: assert } = await import("node:assert/strict");
const {
  applyParsedExamEffect,
  checkCardEffectTrigger,
  createExamState,
  describeProduceItemEffect,
  parseExamEffectId,
  parseProduceItemCatalogForExam,
  parseProduceItemEffectCatalog,
  payCardCost,
  resolveProduceItems,
} = await import("../web/exam_effects.js");

assert.deepEqual(parseExamEffectId("e_effect-exam_lesson-0012-02"), {
  kind: "lesson", id: "e_effect-exam_lesson-0012-02", value: 12, count: 2,
});
assert.equal(parseExamEffectId("e_effect-exam_block-0007").kind, "block");
assert.equal(parseExamEffectId("e_effect-exam_card_draw-0002").kind, "card_draw");
const sleepyCreate = parseExamEffectId("e_effect-exam_card_create_id-p_card-00-acc-0_002-0-deck_random-1_1");
assert.deepEqual(sleepyCreate, {
  kind: "card_create_id",
  id: "e_effect-exam_card_create_id-p_card-00-acc-0_002-0-deck_random-1_1",
  cardId: "p_card-00-acc-0_002",
  upgradeCount: 0,
  movePosition: "deck_random",
  pickCountMin: 1,
  pickCountMax: 1,
});
assert.equal(applyParsedExamEffect(createExamState(), sleepyCreate).command, "card_create_id");

const sleepyMove = parseExamEffectId(
  "e_effect-exam_card_move-p_card_search-deck_grave-p_card-00-acc-0_002-lost-random-1_1",
);
assert.deepEqual(sleepyMove, {
  kind: "card_move_search",
  id: "e_effect-exam_card_move-p_card_search-deck_grave-p_card-00-acc-0_002-lost-random-1_1",
  searchPosition: "deck_grave",
  cardId: "p_card-00-acc-0_002",
  movePosition: "lost",
  pickRange: "random",
  pickCountMin: 1,
  pickCountMax: 1,
});
assert.equal(applyParsedExamEffect(createExamState(), sleepyMove).command, "card_move_search");

const reviewDepend = parseExamEffectId("e_effect-exam_lesson_depend_exam_review-0900-01");
assert.deepEqual(reviewDepend, {
  kind: "lesson_depend_exam_review",
  id: "e_effect-exam_lesson_depend_exam_review-0900-01",
  permil: 900,
  count: 1,
});
const aggressiveDepend = parseExamEffectId("e_effect-exam_lesson_depend_exam_card_play_aggressive-1100-01");
assert.deepEqual(aggressiveDepend, {
  kind: "lesson_depend_exam_aggressive",
  id: "e_effect-exam_lesson_depend_exam_card_play_aggressive-1100-01",
  permil: 1100,
  count: 1,
});
assert.equal(parseExamEffectId("e_effect-exam_lesson_depend_exam_aggressive-1100-01").kind, "unsupported");

assert.deepEqual(parseExamEffectId("e_effect-exam_lesson_value_multiple-0100-05"), {
  kind: "lesson_value_multiple",
  id: "e_effect-exam_lesson_value_multiple-0100-05",
  permil: 100,
  turn: 5,
});
assert.deepEqual(parseExamEffectId("e_effect-exam_review_multiple-0500-05"), {
  kind: "review_multiple",
  id: "e_effect-exam_review_multiple-0500-05",
  permil: 500,
  turn: 5,
});
assert.deepEqual(parseExamEffectId("e_effect-exam_lesson_value_multiple_depend_review_or_aggressive-02"), {
  kind: "lesson_value_multiple_depend_review_or_aggressive",
  id: "e_effect-exam_lesson_value_multiple_depend_review_or_aggressive-02",
  turn: 2,
});
const reviewExam = createExamState();
reviewExam.review = 7;
applyParsedExamEffect(reviewExam, reviewDepend);
assert.equal(reviewExam.parameter, 7, "90% of 7 rounds up to 7");

const summerEnchant = parseExamEffectId(
  "e_effect-exam_status_enchant-inf-enchant-p_card-00-sup-3_152-enc01",
);
assert.equal(summerEnchant.kind, "status_enchant");
assert.equal(summerEnchant.trigger.phase, "card_play");
assert.equal(summerEnchant.trigger.playCountInterval, 5);
assert.equal(summerEnchant.effects[0].kind, "lesson");

const shiningEnchant = parseExamEffectId(
  "e_effect-exam_status_enchant-inf-enchant-p_card-02-act-3_050-enc02",
);
assert.equal(shiningEnchant.kind, "status_enchant");
assert.equal(shiningEnchant.trigger.skillCard, true);
assert.equal(shiningEnchant.effects[0].kind, "lesson_depend_exam_review");
assert.equal(shiningEnchant.effects[0].permil, 500);

assert.equal(parseExamEffectId("e_effect-not-yet-supported").kind, "unsupported");

const exam = createExamState({ stamina: 20 });
applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_block-0005"));
applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_review-0003"));
applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_lesson_buff-0004"));
applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_parameter_buff-0002"));
applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_lesson-0010-02"));
assert.equal(exam.block, 5);
assert.equal(exam.review, 3);
assert.equal(exam.lessonBuff, 4);
assert.equal(exam.parameterBuff, 2);
// Native calculation applies 集中 (+4) and 好調 (x1.5) to each of the two
// Lesson hits independently: ceil((10 + 4) * 1.5) * 2 = 42.
assert.equal(exam.parameter, 42);

assert.equal(checkCardEffectTrigger("", exam).triggered, true);
assert.equal(checkCardEffectTrigger("e_trigger-exam_card_play-review_up-3", exam).triggered, true);
assert.equal(checkCardEffectTrigger("e_trigger-exam_card_play-review_up-5", exam).triggered, false);
assert.equal(checkCardEffectTrigger("e_trigger-something-unknown", exam).supported, false);

payCardCost(exam, { stamina: 7, forceStamina: 2, costType: "ExamCostType_ExamReview", costValue: 2 });
assert.equal(exam.block, 0);
assert.equal(exam.stamina, 16);
assert.equal(exam.review, 1);

const itemYaml = `
- id: pitem_test
  name: テストPアイテム
  planType: ProducePlanType_Plan1
  produceItemEffectIds:
  - p_item_effect_test_a
  - p_item_effect_test_b
  order: 10
`;
const effectYaml = `
- id: p_item_effect_test_a
  effectType: ProduceItemEffectType_ExamStatusEnchant
  effectTurn: -1
  effectCount: 2
  produceEffectId: ""
  produceExamStatusEnchantId: enchant-test-a
- id: p_item_effect_test_b
  effectType: ProduceItemEffectType_ProduceEffect
  effectTurn: 0
  effectCount: 0
  produceEffectId: p_effect-test-b
  produceExamStatusEnchantId: ""
`;
const items = parseProduceItemCatalogForExam(itemYaml);
const itemEffects = parseProduceItemEffectCatalog(effectYaml);
assert.deepEqual(items[0].produceItemEffectIds, ["p_item_effect_test_a", "p_item_effect_test_b"]);
const resolved = resolveProduceItems(
  ["pitem_test"],
  new Map(items.map((item) => [item.id, item])),
  new Map(itemEffects.map((effect) => [effect.id, effect])),
);
assert.equal(resolved.items[0].name, "テストPアイテム");
assert.equal(resolved.items[0].effects.length, 2);
assert.match(describeProduceItemEffect(resolved.items[0].effects[0]), /enchant-test-a/);
assert.match(describeProduceItemEffect(resolved.items[0].effects[1]), /p_effect-test-b/);

console.log("exam effect v7 tests: ok");
}

// test_exam_setup.mjs
{
const { default: assert } = await import("node:assert/strict");
const { applyExamDeckOrder, buildExamDeck, changeExamCardCount, examDeckOrderEntries, filterExamCards, filterExamIdols, moveExamDeckOrder } = await import("../web/exam_setup.js");

const idols = [
  { id: "idol-a", characterId: "char-a", planType: "ProducePlanType_Plan1", name: "A" },
  { id: "idol-b", characterId: "char-a", planType: "ProducePlanType_Plan2", name: "B" },
  { id: "idol-c", characterId: "char-b", planType: "ProducePlanType_Plan1", name: "C" },
];
assert.deepEqual(filterExamIdols(idols, "char-a", "ProducePlanType_Plan1").map((idol) => idol.id), ["idol-a"]);
assert.deepEqual(filterExamIdols(idols, "", "ProducePlanType_Plan1"), []);

const cards = [
  { id: "sense", name: "好調", baseName: "好調", planType: "ProducePlanType_Plan1", isInitial: true },
  { id: "logic", name: "好印象", baseName: "好印象", planType: "ProducePlanType_Plan2" },
  { id: "common", name: "アピール", baseName: "アピール", planType: "ProducePlanType_Common" },
  { id: "unique", name: "一度だけ", baseName: "一度だけ", planType: "ProducePlanType_Plan1", noDeckDuplication: true },
];
assert.deepEqual(filterExamCards(cards, "ProducePlanType_Plan1").map((card) => card.id), ["sense", "common", "unique"]);
assert.deepEqual(filterExamCards(cards, "ProducePlanType_Plan1", "アピール").map((card) => card.id), ["common"]);

const idolById = new Map(idols.map((idol) => [idol.id, idol]));
const originCards = [
  { id: "sense-base", name: "Sense", planType: "ProducePlanType_Plan1", rarity: "ProduceCardRarity_R" },
  { id: "logic-base", name: "Logic", planType: "ProducePlanType_Plan2", rarity: "ProduceCardRarity_R" },
  { id: "common-base", name: "Common", planType: "ProducePlanType_Common", rarity: "ProduceCardRarity_R" },
  { id: "own-idol", name: "Own idol", planType: "ProducePlanType_Plan1", rarity: "ProduceCardRarity_Sr", originIdolCardId: "idol-a" },
  { id: "same-char-other-idol", name: "Same char other idol", planType: "ProducePlanType_Plan1", rarity: "ProduceCardRarity_Ssr", originIdolCardId: "idol-b" },
  { id: "foreign-idol-ssr", name: "Foreign SSR", planType: "ProducePlanType_Plan1", rarity: "ProduceCardRarity_Ssr", originIdolCardId: "idol-c" },
  { id: "foreign-idol-sr", name: "Foreign SR", planType: "ProducePlanType_Plan1", rarity: "ProduceCardRarity_Sr", originIdolCardId: "idol-c" },
  { id: "own-character", name: "Own character", planType: "ProducePlanType_Plan1", rarity: "ProduceCardRarity_R", originCharacterId: "char-a" },
  { id: "foreign-character-ssr", name: "Foreign character SSR", planType: "ProducePlanType_Plan1", rarity: "ProduceCardRarity_Ssr", originCharacterId: "char-b" },
  { id: "foreign-character-r", name: "Foreign character R", planType: "ProducePlanType_Plan1", rarity: "ProduceCardRarity_R", originCharacterId: "char-b" },
];

const identityFilter = {
  planType: "ProducePlanType_Plan1",
  characterId: "char-a",
  idolCardId: "idol-a",
  idolById,
};
assert.deepEqual(
  filterExamCards(originCards, { ...identityFilter, poolMode: "normal" }).map((card) => card.id),
  ["sense-base", "common-base", "own-idol", "own-character"],
  "normal pool must not expose another idol/character's unique card",
);
assert.deepEqual(
  filterExamCards(originCards, { ...identityFilter, poolMode: "research" }).map((card) => card.id),
  ["sense-base", "logic-base", "common-base", "own-idol", "own-character"],
  "research mode unlocks other plans but keeps identity-specific cards restricted",
);
assert.deepEqual(
  filterExamCards(originCards, { ...identityFilter, poolMode: "highScore" }).map((card) => card.id),
  [
    "sense-base",
    "common-base",
    "own-idol",
    "same-char-other-idol",
    "foreign-idol-ssr",
    "own-character",
    "foreign-character-ssr",
  ],
  "high-score mode adds SSR unique cards while keeping SR/R foreign uniques out",
);

let counts = new Map();
counts = changeExamCardCount(counts, cards[0], 1);
counts = changeExamCardCount(counts, cards[0], 1);
counts = changeExamCardCount(counts, cards[3], 1);
counts = changeExamCardCount(counts, cards[3], 1);
assert.equal(counts.get("sense"), 2);
assert.equal(counts.get("unique"), 1);
const deck = buildExamDeck(cards, counts);
assert.equal(deck.length, 3);
assert.deepEqual(deck.map((card) => card.id), ["sense", "sense", "unique"]);
assert.equal(deck[0].isInitial, true);
assert.equal(deck[2].isInitial, false);
const reorderedCounts = new Map([["unique", 1], ["sense", 2]]);
assert.deepEqual(buildExamDeck(cards, reorderedCounts), deck);

const orderEntries = examDeckOrderEntries(deck);
assert.deepEqual(orderEntries.map((entry) => entry.key), [
  "sense@@0@@1",
  "sense@@0@@2",
  "unique@@0@@1",
]);
const manualOrder = [
  orderEntries[2].key,
  orderEntries[0].key,
  orderEntries[1].key,
];
assert.deepEqual(
  applyExamDeckOrder(deck, manualOrder).map((card) => card.id),
  ["unique", "sense", "sense"],
  "manual pre-shuffle order must override catalog order without losing duplicate instances",
);
assert.deepEqual(
  moveExamDeckOrder(manualOrder, 2, 0),
  [orderEntries[1].key, orderEntries[2].key, orderEntries[0].key],
);
assert.throws(
  () => applyExamDeckOrder(deck, manualOrder.slice(0, 2)),
  /Shuffle前順序の枚数/,
);

console.log("exam setup v10 tests: ok");
}



// Native Web runtime: Genki and stamina-cost calculations must use ExamSetting
// multipliers rather than the old +/-1 approximations.
{
const { default: assert } = await import("node:assert/strict");
const {
  applyParsedExamEffect,
  calculateNativeBlockAdd,
  calculateNativeStaminaDamage,
  createExamState,
  parseExamEffectId,
  payCardCost,
} = await import("../web/exam_effects.js");

let exam = createExamState({ stamina: 20 });
exam.aggressive = 3;
assert.equal(calculateNativeBlockAdd(exam, 5), 8, "元気 receives やる気 before native reductions");
const blockResult = applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_block-0005"));
assert.equal(blockResult.label, "元気 +8");
assert.equal(exam.block, 8);

exam = createExamState({ stamina: 20 });
exam.blockRestriction = true;
assert.equal(calculateNativeBlockAdd(exam, 5), 0, "元気増加無効 suppresses Block");

exam = createExamState({ stamina: 20 });
exam.staminaConsumptionDown = 1;
let damage = calculateNativeStaminaDamage(exam, 5);
assert.deepEqual(damage, { damage: 3, staminaDamage: 3, blockDamage: 0 });
payCardCost(exam, { stamina: 5, forceStamina: 0, costType: "", costValue: 0 });
assert.equal(exam.stamina, 17, "消費体力減少 is native 500 permil, not -1");

exam = createExamState({ stamina: 20 });
exam.staminaConsumptionAdd = 1;
payCardCost(exam, { stamina: 5, forceStamina: 0, costType: "", costValue: 0 });
assert.equal(exam.stamina, 10, "消費体力増加 is native +1000 permil, i.e. x2");

exam = createExamState({ stamina: 20 });
exam.staminaConsumptionDown = 1;
exam.block = 2;
payCardCost(exam, { stamina: 5, forceStamina: 0, costType: "", costValue: 0 });
assert.equal(exam.block, 0);
assert.equal(exam.stamina, 19, "post-multiplier damage is absorbed by Genki first");

exam = createExamState({ stamina: 20 });
exam.staminaConsumptionDownFix = 2;
payCardCost(exam, { stamina: 5, forceStamina: 0, costType: "", costValue: 0 });
assert.equal(exam.stamina, 17, "fixed stamina reduction is applied after multiplicative modifiers");

assert.equal(
  parseExamEffectId("e_effect-exam_stamina_consumption_add_fix-0002-inf").kind,
  "stamina_consumption_add_fix",
);

console.log("native stamina/genki runtime tests: ok");
}
