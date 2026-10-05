import assert from "node:assert/strict";
import fs from "node:fs";
import { parseProduceCardCatalogYaml } from "../web/engine.js";
import { createTowerTurnState, drawTowerTurn, finishTowerTurn, playTowerCard,
  restoreTowerTurnState, serializeTowerTurnState, useTowerDrink } from "../web/tower_runtime.js";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/engine-comparison-masters.json", import.meta.url)));
const triggerFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/exam-trigger-masters.json", import.meta.url)));
const entries = (rows) => new Map(rows.map((r) => [r.id, r]));
const catalogs = Object.fromEntries([
  ["examEffects", "examEffectById"], ["examTriggers", "examTriggerById"],
  ["examStatusEnchants", "examStatusEnchantById"], ["cardSearches", "cardSearchById"],
  ["cardStatusEnchants", "cardStatusEnchantById"], ["growEffects", "growEffectById"],
].map(([from, to]) => [to, entries(fixture[from])]));
const filler = Array.from({ length: 12 }, (_, n) => ({ id: "filler-" + n,
  category: "ProduceCardCategory_ActiveSkill", stamina: 0,
  playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] }));
const master = (id, upgrade = 0) => fixture.cards.find((c) => c.id === id && c.upgradeCount === upgrade);
function state(cards = [], options = {}) {
  const masters = [...cards, ...filler];
  const s = createTowerTurnState(masters.map(({ id, upgradeCount }) => ({ id, upgradeCount })), 123,
    entries(masters), { ...catalogs, cardVariantByKey: new Map(masters.map((r) => [r.id + "@@" + (r.upgradeCount ?? 0), r])),
      stamina: 100, turnLimit: 30, ...options });
  const desired = masters.map((r) => s.deck.find((c) => c.id === r.id));
  s.deck = desired;
  return s;
}
const effect = (type, value = 0, extra = {}) => ({ id: "test-" + type,
  effectType: "ProduceExamEffectType_" + type, effectValue1: value,
  effectCount: 1, effectTurn: 0, ...extra });
const apply = (s, ...effects) => useTowerDrink(s, { id: "test-drink", effects: effects.map((examEffect) => ({ examEffect })) });
function move(s, position, destination, extra = {}) {
  const id = "search-" + position;
  s.cardSearchById = new Map(s.cardSearchById).set(id, { id, cardPositionType: "ProduceCardPositionType_" + position, ...extra });
  return apply(s, effect("ExamCardMove", 0, { produceCardSearchId: id,
    pickRangeType: "ProducePickRangeType_All", movePositionType: "ProduceCardMovePositionType_" + destination }));
}
function phaseItem(id, phases, payload) {
  return { id, effects: [{ id: id + "-effect", effectCount: 0,
    effectType: "ProduceItemEffectType_ExamStatusEnchant", examStatusEnchant: {
      id: id + "-enchant", trigger: { id: id + "-trigger", phaseTypes: phases }, examEffects: payload,
    } }] };
}

// Both condition arrays survive parsing, including positional empty conditions.
{
  const [c] = parseProduceCardCatalogYaml(`- id: conditional-move\n  moveEffectTriggerType: ProduceCardMoveEffectTriggerType_Hand\n  moveProduceExamEffectIds:\n  - a\n  - b\n  moveProduceExamTriggerIds:\n  - ""\n  - condition\n`);
  assert.deepEqual(c.moveProduceExamTriggerIds, ["", "condition"]);
  assert.deepEqual(c.moveProduceExamEffectIds, ["a", "b"]);
}
assert.equal(fixture.cards.length, 8);
// A failed move condition leaves the once-per-turn allowance available.
{
  const trigger = { id: "requires-review", phaseTypes: ["ProduceExamPhaseType_None"],
    fieldStatusTypes: ["ProduceExamFieldStatusType_ReviewUp"], fieldStatusValues: [1],
    fieldStatusCheckTypes: ["ProduceExamTriggerCheckType_Unknown"] };
  const c = { ...filler[0], id: "conditional-move", moveEffectTriggerType: "ProduceCardMoveEffectTriggerType_Hand",
    moveProduceExamEffectIds: ["e_effect-exam_block-0005"], moveProduceExamTriggerIds: [trigger.id] };
  const s = state([c], { examTriggerById: entries([trigger]) }); drawTowerTurn(s, 1);
  assert.equal(s.exam.block, 0);
  s.exam.review = 1; move(s, "Hand", "Hold"); move(s, "Hold", "Hand");
  assert.equal(s.exam.block, 5);
  assert.deepEqual(s.unsupported, []);
}
// Actual move payloads execute independently of the card's use conditions.
for (const c of fixture.cards.filter((c) => /100_010|3_214/.test(c.id))) {
  const s = state([c]); drawTowerTurn(s, 1);
  const field = c.id.includes("100_010") ? "block" : "aggressive";
  const expected = field === "block" ? 5 : 3;
  assert.equal(s.exam[field], expected, c.name + ": initial draw");
  const token = s.hand[0].token;
  const saved = restoreTowerTurnState(serializeTowerTurnState(s), s);
  move(saved, "Hand", "Hold"); move(saved, "Hold", "Hand");
  assert.equal(saved.exam[field], expected, c.name + ": once per card per turn across restore");
  finishTowerTurn(saved);
  const index = saved.discard.findIndex((c) => c.token === token);
  saved.deck.unshift(saved.discard.splice(index, 1)[0]);
  drawTowerTurn(saved, 1);
  assert.equal(saved.exam[field], expected * 2, c.name + ": resets next turn");
  assert.deepEqual(saved.unsupported, []);
}
// Supernova draws once when it enters Hand, even when drawn automatically.
{
  const s = state([master("p_card-03-act-100_013")]);
  const opening = drawTowerTurn(s, 3);
  assert.equal(opening.drawn.length, 3);
  assert.equal(s.hand.length, 4);
  move(s, "Hand", "Hold"); move(s, "Hold", "Hand");
  assert.equal(s.hand.length, 2, "hold capacity is enforced and return does not redraw Supernova");
  assert.deepEqual(s.unsupported, []);
}
// Expert's Hand trigger can select Grand Finale. Its Hold trigger grows only
// the actual held pool, and Expert then grows/forces those cards on use.
{
  const expert = master("p_card-03-men-100_015"), finale = master("p_card-03-act-100_018");
  const s = state([expert, finale]);
  s.aiCardSelectionPlan = [[s.deck[1].token]];
  drawTowerTurn(s, 1);
  assert.deepEqual(s.hold.map((c) => c.id), [finale.id]);
  assert.equal(s.hold[0].runtimeGrowEffects.filter((g) => g.id === "g_effect-lesson_count_add-1").length, 1);
  assert.equal(s.deck.some((c) => c.runtimeGrowEffects?.some((g) => g.id === "g_effect-lesson_count_add-1")), false);
  s.exam.stanceChangeCount = 4;
  playTowerCard(s, 0);
  assert.equal(s.exam.parameter, 110, "two 55-point hits from the held card's two growth effects");
  assert.equal(s.hold.length, 0);
  assert.equal(s.lost.filter((c) => c.id === finale.id).length, 1);
  assert.equal(s.currentTurnPlays.length, 2);
  assert.deepEqual(s.unsupported, []);
}
// Hold limit evicts old cards, skips the excess incoming prefix, and resolves
// move effects after the complete batch, so Finale grows both retained cards.
{
  const finale = master("p_card-03-act-100_018");
  const s = state([finale]); drawTowerTurn(s, 3);
  move(s, "Hand", "Hold");
  assert.deepEqual(s.hold.map((c) => c.id), ["filler-0", "filler-1"]);
  assert.equal(s.discard[0].id, finale.id);
  assert.equal(s.hold.some((c) => c.runtimeGrowEffects?.length), false, "excess Finale never enters Hold");
  move(s, "Grave", "Hold");
  assert.deepEqual(s.hold.map((c) => c.id), ["filler-1", finale.id]);
  for (const c of s.hold) assert.equal(c.runtimeGrowEffects.filter((g) => g.id === "g_effect-lesson_count_add-1").length, 1);
  assert.equal(s.discard[0].id, "filler-0");
  assert.deepEqual(s.unsupported, []);
}
// ELF returns FIFO, at most two cards, and only on a Full Power turn start.
for (const handLimit of [4, 5]) {
  const s = state([], { handLimit }); drawTowerTurn(s, 2);
  const held = s.hand.map((c) => c.token); move(s, "Hand", "Hold");
  finishTowerTurn(s); drawTowerTurn(s, 3);
  assert.deepEqual(s.hold.map((c) => c.token), held, "ordinary turn leaves Hold intact");
  finishTowerTurn(s); s.exam.idolStatusType = 3; s.exam.idolStatusStep = 1;
  drawTowerTurn(s, 3);
  assert.deepEqual(s.hand.slice(3).map((c) => c.token), held.slice(0, handLimit - 3));
  assert.deepEqual(s.hold.map((c) => c.token), held.slice(handLimit - 3));
}
// Draw and hand-move trigger phases are per-card. Generating directly into
// Hand produces a hand-move event but not a draw; overflow produces neither.
{
  const s = state([], { pItems: [phaseItem("draw", ["ProduceExamPhaseType_ExamCardDraw"], [effect("ExamLessonFix", 1)]),
    phaseItem("hand", ["ProduceExamPhaseType_ExamCardMoveHand"], [effect("ExamLessonFix", 10)])] });
  drawTowerTurn(s, 3); assert.equal(s.exam.parameter, 33);
  apply(s, effect("ExamCardDraw", 1)); assert.equal(s.exam.parameter, 44);
  apply(s, effect("ExamCardCreateId", 0, { targetProduceCardId: filler[0].id,
    targetUpgradeCount: 0, movePositionType: "ProduceCardMovePositionType_Hand",
    pickRangeType: "ProducePickRangeType_All", pickCountMin: 1, pickCountMax: 1 }));
  assert.equal(s.exam.parameter, 54);
  apply(s, effect("ExamCardDraw", 1)); assert.equal(s.exam.parameter, 54, "full Hand cannot draw");
}
// Stance enum numbers are identities, not directions: leaving Strong for
// Full Power raises the enum value but must still fire FromConcentration.
{
  const s = state([], { pItems: [phaseItem("from-strong", ["ProduceExamPhaseType_ExamStanceChangeFromConcentration"], [effect("ExamLessonFix", 7)]),
    phaseItem("from-full", ["ProduceExamPhaseType_ExamStanceChangeFromFullPower"], [effect("ExamLessonFix", 11)])] });
  drawTowerTurn(s, 1); apply(s, effect("ExamConcentration", 1));
  assert.equal(s.exam.parameter, 0);
  apply(s, effect("ExamFullPower", 1)); assert.equal(s.exam.parameter, 7);
  playTowerCard(s, 0); assert.equal(s.exam.parameter, 18);
  assert.deepEqual(s.unsupported, []);
}
// A single card with separate reductions triggers 初声 twice. Nested chain
// commands report each child once, without re-reporting the enclosing delta.
for (const chained of [false, true]) {
  const item = triggerFixture.pItems.find((p) => p.id === "pitem_02-1-013-0");
  const damage = effect("ExamStaminaReduceFix", 1);
  const chain = effect("ExamEffectPerSearchCount", 0, { effectValue2: 1000,
    produceCardSearchId: "playing-self", chainProduceExamEffectId: damage.id });
  const c = { ...filler[0], id: "double-damage", playEffects: [
    { produceExamEffectId: chained ? chain.id : damage.id }, { produceExamEffectId: damage.id }] };
  const s = state([c], { pItems: [item], examEffectById: entries([damage, chain]),
    cardSearchById: new Map([['playing-self', { id: 'playing-self', cardPositionType: 'ProduceCardPositionType_Playing' }]]) });
  drawTowerTurn(s, 1); playTowerCard(s, 0);
  assert.equal(s.exam.stamina, 98, "chain=" + chained + ": " + JSON.stringify(s.currentTurnPlays[0].effects)); assert.equal(s.exam.review, 4);
  assert.deepEqual(s.unsupported, []);
}
// An enclosing forced-use effect must not report the nested card cost as
// direct damage. Only the nested card's own damage activates 初声.
{
  const reaction = triggerFixture.pItems.find((p) => p.id === "pitem_02-1-013-0");
  const force = effect("ExamForcePlayCardSearchWithCost", 0, { produceCardSearchId: "held",
    pickRangeType: "ProducePickRangeType_All" });
  const damage = effect("ExamStaminaReduceFix", 1);
  const caller = { ...filler[0], id: "force-caller", playEffects: [{ produceExamEffectId: force.id }] };
  const target = { ...filler[0], id: "force-target", stamina: 5, playEffects: [{ produceExamEffectId: damage.id }] };
  const s = state([caller, target], { pItems: [reaction], examEffectById: entries([force, damage]),
    cardSearchById: entries([{ id: "held", cardPositionType: "ProduceCardPositionType_Hold" }]) });
  drawTowerTurn(s, 1); s.hold.push(s.deck.shift());
  playTowerCard(s, 0);
  assert.equal(s.exam.stamina, 94); assert.equal(s.exam.review, 2);
  assert.deepEqual(s.unsupported, []);
}
// P-item and gimmick-owned damage cannot recursively activate a result item.
{
  const reaction = triggerFixture.pItems.find((p) => p.id === "pitem_02-1-013-0");
  const s = state([], { pItems: [reaction, phaseItem("damage-item", ["ProduceExamPhaseType_ExamCardPlay"], [effect("ExamStaminaReduceFix", 1)])] });
  drawTowerTurn(s, 1); playTowerCard(s, 0);
  assert.equal(s.exam.stamina, 99); assert.equal(s.exam.review, 0);
  const damage = effect("ExamStaminaReduceFix", 1);
  const g = state([], { pItems: [reaction], gimmicks: [{ id: "damage-gimmick", startTurn: 1, produceExamEffectId: damage.id }], examEffectById: entries([damage]) });
  drawTowerTurn(g, 1); assert.equal(g.exam.stamina, 99); assert.equal(g.exam.review, 0);
}
console.log("engine comparison regressions: 8 move variants, Hold, Full Power, result phases, nested deltas and source gating: ok");

// Forced playback retains costs, trigger events, counters and movement even
// when its main effects are blocked. Blocked playback must not spend repeat.
for (const forcedType of ["ExamForcePlayCardSearch", "ExamForcePlayCardSearchWithCost"]) {
  for (const restricted of [false, true]) {
    for (const review of [0, 1]) {
      const trigger = { id: "play-needs-review", phaseTypes: ["ProduceExamPhaseType_None"],
        fieldStatusTypes: ["ProduceExamFieldStatusType_ReviewUp"], fieldStatusValues: [1],
        fieldStatusCheckTypes: ["ProduceExamTriggerCheckType_Unknown"] };
      const payload = effect("ExamLessonFix", 7);
      const c = { ...filler[0], id: "forced-conditional", stamina: 3, isRestrict: restricted,
        playProduceExamTriggerId: trigger.id, playMovePositionType: "ProduceCardMovePositionType_Lost",
        playEffects: [{ produceExamEffectId: payload.id }] };
      const s = state([c], { examTriggerById: entries([trigger]), examEffectById: entries([payload]),
        pItems: [phaseItem("before", ["ProduceExamPhaseType_ExamCardPlay"], [effect("ExamLessonFix", 3)]),
          phaseItem("after", ["ProduceExamPhaseType_ExamCardPlayAfter"], [effect("ExamLessonFix", 5)])] });
      drawTowerTurn(s, 1); s.exam.review = review;
      s.cardEffectPlayCountBuff = { value: 1, count: 2, turn: -1 };
      const token = s.hand[0].token;
      s.cardSearchById.set("forced-target", { id: "forced-target", cardPositionType: "ProduceCardPositionType_Hand", produceCardIds: [c.id] });
      apply(s, effect(forcedType, 0, { produceCardSearchId: "forced-target", pickRangeType: "ProducePickRangeType_All" }));
      const eligible = !restricted && review > 0;
      assert.equal(s.exam.parameter, 8 + (eligible ? 14 : 0), forcedType + ": main effects versus trigger effects");
      assert.equal(s.exam.stamina, forcedType.endsWith("WithCost") ? 97 : 100);
      assert.equal(s.cardEffectPlayCountBuff.count, eligible ? 1 : 2, "blocked playback preserves repeat count");
      assert.equal(s.playsRemaining, 1, "forced playback does not consume an ordinary play");
      assert.equal(s.exam.cardPlayCount, 1); assert.equal(s.exam.turnCardPlayCount, 1);
      assert.equal(s.currentTurnPlays.length, 1); assert.equal(s.currentTurnPlays[0].forced, true);
      assert.equal(s.lost.filter(row => row.token === token).length, 1);
      assert.equal(s.lost.find(row => row.token === token).playCount, 1);
      assert.deepEqual(s.unsupported, []);
    }
  }
}
// Ordinary use rejects restrictions before paying costs or consuming a play.
{
  const c = { ...filler[0], id: "restricted", stamina: 3, isRestrict: true,
    playEffects: [{ produceExamEffectId: "e_effect-exam_block-0005" }] };
  const s = state([c]); drawTowerTurn(s, 1);
  assert.throws(() => playTowerCard(s, 0), /このカードは使用できません/);
  assert.equal(s.exam.stamina, 100); assert.equal(s.playsRemaining, 1);
  assert.equal(s.exam.cardPlayCount, 0); assert.equal(s.hand[0].id, c.id);
  assert.equal(s.exam.block, 0); assert.equal(s.currentTurnPlays.length, 0);
}
// Supernova's real play condition (Strength 2) still applies to forced use;
// its already-resolved Hand move effect remains independent of that gate.
for (const eligible of [false, true]) {
  const c = master("p_card-03-act-100_013");
  const s = state([c]); drawTowerTurn(s, 1);
  if (eligible) { s.exam.idolStatusType = 1; s.exam.idolStatusStep = 2; }
  s.cardSearchById.set("supernova-target", { id: "supernova-target", cardPositionType: "ProduceCardPositionType_Hand", produceCardIds: [c.id] });
  apply(s, effect("ExamForcePlayCardSearch", 0, { produceCardSearchId: "supernova-target", pickRangeType: "ProducePickRangeType_All" }));
  assert.equal(s.exam.parameter > 0, eligible, "real Supernova eligibility");
  assert.equal(s.lost.filter(row => row.id === c.id).length, 1);
  assert.equal(s.currentTurnPlays.length, 1); assert.equal(s.playsRemaining, 1);
  assert.deepEqual(s.unsupported, []);
}
console.log("Card playability gates: forced conditions, restrictions, costs, repeat preservation and real Supernova: ok");
// Paying a Review cost must not retrospectively invalidate the eligibility
// snapshot or suppress effects of an otherwise eligible card.
{
  const trigger = { id: "review-before-cost", phaseTypes: ["ProduceExamPhaseType_None"],
    fieldStatusTypes: ["ProduceExamFieldStatusType_ReviewUp"], fieldStatusValues: [1],
    fieldStatusCheckTypes: ["ProduceExamTriggerCheckType_Unknown"] };
  const payload = effect("ExamLessonFix", 7);
  const c = { ...filler[0], id: "review-cost", costType: "ExamCostType_ExamReview", costValue: 1,
    playProduceExamTriggerId: trigger.id, playEffects: [{ produceExamEffectId: payload.id }] };
  const s = state([c], { examTriggerById: entries([trigger]), examEffectById: entries([payload]) });
  drawTowerTurn(s, 1); s.exam.review = 1;
  playTowerCard(s, 0);
  assert.equal(s.exam.review, 0); assert.equal(s.exam.parameter, 7);
}
