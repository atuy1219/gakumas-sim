import assert from "node:assert/strict";
import {
  NATIVE_IL2CPP_BUILD_ID,
  EXAM_PARAMETER_MODEL_FIELDS,
  EXAM_EFFECT_CALCULATE_CONTEXT_FIELDS,
  getExamParameterModel,
  getExamEffectCalculateContext,
  getExamStatusEffectCollection,
} from "../web/native_exam_context.js";
import {
  createTowerTurnState,
  drawTowerTurn,
  playTowerCard,
  finishTowerTurn,
} from "../web/tower_runtime.js";

const card = id => ({
  id, upgradeCount: 0, stamina: 0, costValue: 0,
  costType: "ExamCostType_Unknown",
  category: "ProduceCardCategory_ActiveSkill",
  playMovePositionType: "ProduceCardMovePositionType_Grave",
  playEffects: [],
});
const cards = [card("native-name-a"), card("native-name-b"), card("native-name-c")];
const state = createTowerTurnState(cards, 0xdeadbeef,
  new Map(cards.map(c => [c.id, c])), { stamina: 35, turnLimit: 3 });

const p = getExamParameterModel(state);
const ctx = getExamEffectCalculateContext(state);
const status = getExamStatusEffectCollection(state);
assert.equal(getExamParameterModel(state), p, "stable model identity");
assert.equal(getExamEffectCalculateContext(state), ctx, "stable context identity");
assert.equal(p.StatusEffectCollection, status, "live status collection");
assert.equal(ctx.ExamParameter, p);
assert.equal(NATIVE_IL2CPP_BUILD_ID.length, 40);
assert.equal(EXAM_PARAMETER_MODEL_FIELDS.Stamina.offset, 0x1cc);
assert.equal(EXAM_EFFECT_CALCULATE_CONTEXT_FIELDS.GraveList.offset, 0x30);

// Reads and writes must target the existing saved state, not a second copy.
assert.equal(p.Seed, 0xdeadbeef);
p.CurrentTurn = 1;
assert.equal(state.turn, 1);
state.turn = 0;
assert.equal(p.CurrentTurn, 0);
p.Stamina = 12;
assert.equal(state.exam.stamina, 12);
state.exam.stamina = 31;
assert.equal(p.Stamina, 31);
state.exam.parameter = 834;
assert.equal(p.JudgeParameter, 834);
state.exam.parameter = 0;
p.TurnCardPlayCount = 7;
assert.equal(state.exam.turnCardPlayCount, 7);
state.exam.turnCardPlayCount = 0;
p.ExamCardPlayCount = 9;
assert.equal(state.exam.cardPlayCount, 9);
state.exam.cardPlayCount = 0;
ctx.RemainCanPlayCardCount = 3;
assert.equal(state.playsRemaining, 3);
state.playsRemaining = 0;
assert.equal(ctx.RemainCanPlayCardCount, 0);

// Native collection method names mirror the actual IL2CPP methods.
state.exam.review = 11;
state.exam.aggressive = 4;
state.exam.fullPowerPoint = 5;
state.exam.lessonBuff = 6;
state.exam.parameterBuff = 7;
assert.equal(status.GetReview(), 11);
assert.equal(status.GetAggressive(), 4);
assert.equal(status.GetFullPowerPoint(), 5);
assert.equal(status.GetLessonBuff(), 6);
assert.equal(status.GetParameterBuffTurn(), 7);
Object.assign(state.exam, {
  review: 0, aggressive: 0, fullPowerPoint: 0, lessonBuff: 0, parameterBuff: 0,
});

assert.equal(ctx.HandList, state.hand);
assert.equal(ctx.DeckList, state.deck);
assert.equal(ctx.GraveList, state.discard);
assert.equal(ctx.LostList, state.lost);
assert.equal(ctx.HoldList, state.hold);
const alternateDeck = [...state.deck];
ctx.DeckList = alternateDeck;
assert.equal(state.deck, alternateDeck);
const savedContract = JSON.stringify({ exam: state.exam, hand: state.hand, deck: state.deck });
assert.equal(savedContract.includes("JudgeParameter"), false, "no native property leakage into save JSON");
assert.equal(Object.keys(state).includes("ExamParameter"), false);

assert.throws(() => getExamParameterModel({}), TypeError);
assert.throws(() => { p.JudgeParameter = 1; }, TypeError, "native read-only getter");

// Exercise the real turn/card lifecycle through the native-named views.
drawTowerTurn(state, 3);
assert.equal(p.CurrentTurn, 1);
assert.equal(p.TurnCardPlayCount, 0);
assert.equal(ctx.HandList.length, 3);
assert.equal(ctx.RemainCanPlayCardCount, 1);
const first = ctx.HandList[0];
playTowerCard(state, 0);
assert.equal(p.ExamCardPlayCount, 1);
assert.equal(p.TurnCardPlayCount, 1);
assert.equal(ctx.RemainCanPlayCardCount, 0);
assert.equal(ctx.GraveList.some(c => c.id === first.id), true);
finishTowerTurn(state, { type: "end" });
assert.equal(ctx.HandList.length, 0);
assert.equal(ctx.RemainCanPlayCardCount, 0);
assert.equal(ctx.ExamParameter.JudgeParameter, state.exam.parameter);
console.log("native IL2CPP naming bridge: OK");
