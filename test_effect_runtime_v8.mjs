import assert from "node:assert/strict";
import {
  applyParsedExamEffect,
  checkCardEffectTrigger,
  createExamState,
  parseExamEffectId,
} from "./web/exam_effects_v7.js";
import {
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  playTowerCard,
} from "./web/tower_runtime.js";

const requestedEffects = [
  "e_effect-exam_lesson_add_multiple_parameter_buff-0010-1000-01",
  "e_effect-exam_effect_timer-0001-01-e_effect-exam_lesson-0040-01",
  "e_effect-exam_card_search_effect_play_count_buff-0001-01-inf-p_card_search-n-r-sr-ssr-playing-all-0_0",
  "e_effect-exam_effect_timer-0001-01-e_effect-exam_card_draw-0002",
  "e_effect-exam_effect_timer-0002-01-e_effect-exam_card_draw-0001",
  "e_effect-exam_lesson_depend_parameter_buff-1500-01",
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
assert.equal(exam.parameter, 26);
applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_parameter_buff_multiple_per_turn-04"));
assert.equal(exam.parameterBuffMultiplePerTurn, 4);

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
