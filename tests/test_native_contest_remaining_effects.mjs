import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { applyParsedExamEffect, createExamState } from "../web/exam_effects.js";
import { createTowerTurnState, drawTowerTurn, finishTowerTurn, playTowerCard } from "../web/tower_runtime.js";
import { prepareCustomizationOverrides } from "../tools/contest_customization_overrides.mjs";

const effect = (id, type, value1, value2 = 0) => ({ id,
  effectType: "ProduceExamEffectType_" + type, effectValue1: value1,
  effectValue2: value2, effectCount: 1, effectTurn: 0 });
const card = (id, playEffects = [], extra = {}) => ({ id, upgradeCount: 0,
  category: "ProduceCardCategory_ActiveSkill", costType: "ExamCostType_Unknown",
  stamina: 0, costValue: 0, playMovePositionType: "ProduceCardMovePositionType_Grave",
  playEffects: playEffects.map((id) => ({ produceExamEffectId: id })), ...extra });
function opening(cards, effects = [], triggers = []) {
  const all = [...cards];
  while (all.length < 3) all.push(card("filler-" + all.length));
  const s = createTowerTurnState(all, 1, new Map(all.map((c) => [c.id, c])), {
    stamina: 42, turnLimit: 3, captureActionTelemetry: true,
    examEffectById: new Map(effects.map((e) => [e.id, e])),
    examTriggerById: new Map(triggers.map((t) => [t.id, t])),
  });
  drawTowerTurn(s, 3);
  return s;
}
const play = (s, id) => playTowerCard(s, s.hand.findIndex((c) => c.id === id));

// ELF 0x8059ca0 reads completed uses; 0x80dcb20 increments after main
// effects. Natural Charm's recovery/stamina/count bases are 9/340/156.
{
  const s = opening([card("natural", ["recover", "stamina", "count"], {
    costType: "ExamCostType_ExamLessonBuff", costValue: 5,
  })], [effect("recover", "ExamStaminaRecoverMultiple", 200),
    effect("stamina", "ExamLessonDependStamina", 10000),
    effect("count", "ExamLessonDependPlayCardCountSum", 2, 14)]);
  Object.assign(s.exam, { stamina: 25, lessonBuff: 12, cardPlayCount: 11 });
  play(s, "natural");
  assert.equal(s.exam.stamina, 34);
  assert.equal(s.exam.parameter, 510, "347 stamina points + 163 completed-use points");
  assert.equal(s.exam.cardPlayCount, 12, "completion increments exactly once");
}

// Native 0x805cf84-0x805cfcc: separately ceil the extra and usual
// concentration. These fractional cases were the four contest-3 gaps.
for (const [concentration, multiple, expected] of [[23, 1.05, 104], [57, 1.10, 258], [28, 1.05, 125]]) {
  const exam = createExamState();
  Object.assign(exam, { lessonBuff: concentration, lessonBuffMultiple: Math.fround(multiple) });
  applyParsedExamEffect(exam, { kind: "lesson_multiple_lesson_buff", value: 6, permil: 3000, count: 1 });
  assert.equal(exam.parameter, expected);
}

// Wholehearted grants two stamina waivers. A FullPowerPoint cost must not
// spend either waiver or charge the stamina-growth number (0x80a7a44).
{
  const s = opening([card("buff", [], { costType: "ExamCostType_ExamFullPowerPoint", costValue: 3, stamina: 99 }),
    card("stamina-a", [], { stamina: 8 }), card("stamina-b", [], { stamina: 8 })]);
  Object.assign(s.exam, { fullPowerPoint: 3, block: 17 });
  s.cardSearchById.set("all", { id: "all", cardPositionType: "ProduceCardPositionType_DeckAll" });
  s.searchCardCostChanges.push({ searchId: "all", value: 0, count: 2, turn: -1 });
  s.playsRemaining = 3;
  play(s, "buff");
  assert.equal(s.exam.fullPowerPoint, 0);
  assert.equal(s.exam.block, 17);
  assert.equal(s.searchCardCostChanges[0].count, 2);
  play(s, "stamina-a"); play(s, "stamina-b");
  assert.equal(s.searchCardCostChanges[0].count, 0);
  assert.equal(s.exam.block, 17);
}

// Stardust's own Review+7 must not unlock Review>=10 midway through
// the same command list. FullPowerPoint conditions also precede costs.
for (const review of [7, 10]) {
  const s = opening([card("stardust", [], { playEffects: [
    { produceExamEffectId: "review" },
    { produceExamEffectId: "additive", produceExamTriggerId: "review-ten" },
  ] })], [effect("review", "ExamReview", 7), effect("additive", "ExamReviewAdditive", 500)],
  [{ id: "review-ten", fieldStatusTypes: ["ProduceExamFieldStatusType_ReviewUp"], fieldStatusValues: [10] }]);
  s.exam.review = review; play(s, "stardust");
  assert.equal(s.exam.review, review + 7);
  assert.equal(s.exam.reviewAdditivePermil, review === 7 ? 0 : 500);
}
{
  const s = opening([card("point-condition", [], { costType: "ExamCostType_ExamFullPowerPoint", costValue: 2,
    playEffects: [{ produceExamEffectId: "nine", produceExamTriggerId: "point-two" }] })],
    [effect("nine", "ExamLessonFix", 9)],
    [{ id: "point-two", fieldStatusTypes: ["ProduceExamFieldStatusType_FullPowerPointUp"], fieldStatusValues: [2] }]);
  s.exam.fullPowerPoint = 2; play(s, "point-condition");
  assert.equal(s.exam.fullPowerPoint, 0);
  assert.equal(s.exam.parameter, 9);
}

// FullPower survives both cards and is removed on the next turn. A zero
// threshold denotes stance presence (Trend Leader), not gauge >= 0.
{
  const cards = [card("tempo", ["ten"]), card("trend", [], {
    playEffects: [{ produceExamEffectId: "ten", produceExamTriggerId: "full" }],
  }), card("empty")];
  const s = opening(cards, [effect("ten", "ExamLesson", 10)],
    [{ id: "full", fieldStatusTypes: ["ProduceExamFieldStatusType_FullPowerUp"], fieldStatusValues: [0] }]);
  finishTowerTurn(s); s.exam.fullPowerPoint = 10; drawTowerTurn(s, 3);
  assert.equal(s.exam.idolStatusType, 3); assert.equal(s.exam.fullPowerPoint, 0);
  play(s, "tempo"); play(s, "trend");
  assert.equal(s.exam.parameter, 60); assert.equal(s.exam.idolStatusType, 3);
  finishTowerTurn(s); drawTowerTurn(s, 3);
  assert.equal(s.exam.idolStatusType, 0);
}

// Supplemental capture evidence cannot silently apply to another capture,
// overwrite a recorded [] or invent a customization level.
{
  const bytes = Buffer.from("capture-16");
  const master = new Map([["custom", { levels: [{ count: 1 }] }]]);
  const manifest = { schemaVersion: 1, source: "user confirmation",
    captureSha256: [createHash("sha256").update(bytes).digest("hex")],
    sessions: [{ sessionId: 3, cards: [{ id: "card", customizes: [{ id: "custom", customizeCount: 1 }] }] }] };
  const setup = (customizes) => ({ input: { initialDeck: [{ id: "card", ...(customizes === undefined ? {} : { customizes }) }], metadata: {} }, candidates: {} });
  const supplement = prepareCustomizationOverrides(manifest, bytes, master);
  const unknown = setup(); supplement.apply(3, unknown);
  assert.equal(unknown.input.initialDeck[0].customizes[0].customizeCount, 1);
  assert.equal(unknown.input.metadata.initialDeckCustomizationVerified, false);
  assert.equal(supplement.evidence.appliedBySession[0].appliedCardIds[0], "card");
  assert.throws(() => prepareCustomizationOverrides(manifest, Buffer.from("other capture"), master), /SHA-256/);
  assert.throws(() => supplement.apply(3, setup([])), /conflicts/);
  const invalid = structuredClone(manifest); invalid.sessions[0].cards[0].customizes[0].customizeCount = 2;
  assert.throws(() => prepareCustomizationOverrides(invalid, bytes, master), /level/);
}
console.log("Native contest effect boundaries, rounding, costs and capture-bound supplements: OK");
