import assert from "node:assert/strict";
import { createTowerTurnState, drawTowerTurn, playTowerCard } from "../web/tower_runtime.js";

// v3.4.1 ROM: card command trigger is checked on the existing play state.
// Native contest #4 (2026-10-12): start aggressive 0, CARD_PLAY item +8;
// "その本、おもしろい？" must produce 117, not 117+88.
const trigger = {
  id: "e_trigger-exam_card_play-card_play_aggressive_up-3",
  phaseTypes: ["ProduceExamPhaseType_ExamCardPlay"],
  fieldStatusTypes: ["ProduceExamFieldStatusType_CardPlayAggressiveUp"],
  fieldStatusValues: [3],
  fieldStatusCheckTypes: [],
};
const pitem = {
  id: "pitem-aggressive",
  effects: [{
    id: "item-aggressive", effectType: "ProduceItemEffectType_ExamStatusEnchant",
    effectTurn: -1, effectCount: 1,
    examStatusEnchant: {
      id: "enchant-aggressive",
      trigger: { id: "trigger-card-play", phaseTypes: ["ProduceExamPhaseType_ExamCardPlay"], phaseValues: [0] },
      examEffects: [{ id: "aggressive8", effectType: "ProduceExamEffectType_ExamCardPlayAggressive", effectValue1: 8 }],
    },
  }],
};
const deck = [
  { id: "conditional", upgradeCount: 0, category: "ProduceCardCategory_ActiveSkill" },
  { id: "other", upgradeCount: 0 },
  { id: "other2", upgradeCount: 0 },
];
const byId = new Map(deck.map(card => [card.id, {
  ...card,
  ...(card.id === "conditional"
    ? { playEffects: [{ produceExamTriggerId: trigger.id, produceExamEffectId: "block10" }] }
    : {}),
}]));
function play(startAggressive) {
  const state = createTowerTurnState(deck, 1, byId, {
    stamina: 40, turnLimit: 1, drawPerTurn: 3, initialRandomState: 1,
    pItems: [pitem], turnParameterTypes: ["visual"],
    examRuntimeSettings: {}, examScoreSettings: {},
    examEffectById: new Map([
      ["aggressive8", { id: "aggressive8", effectType: "ProduceExamEffectType_ExamCardPlayAggressive", effectValue1: 8 }],
      ["block10", { id: "block10", effectType: "ProduceExamEffectType_ExamBlock", effectValue1: 10 }],
    ]),
    examTriggerById: new Map([[trigger.id, trigger]]),
  });
  drawTowerTurn(state, 3);
  state.exam.aggressive = startAggressive;
  playTowerCard(state, state.hand.findIndex(card => card.id === "conditional"));
  return state;
}
const notYetEligible = play(0);
assert.equal(notYetEligible.exam.aggressive, 8, "CARD_PLAY P-item must still grant +8");
assert.equal(notYetEligible.exam.block, 0, "new +8 must not retroactively enable card's CardPlayAggressiveUp(3)");
assert.ok(notYetEligible.currentTurnPlays[0].effects.some(x => x.includes("条件不成立")));
assert.equal(notYetEligible.cardTriggerAggressiveAtPlayStart, undefined, "snapshot must not leak past card");
// The same condition already satisfied at card declaration should remain enabled.
const alreadyEligible = play(3);
assert.equal(alreadyEligible.exam.aggressive, 11);
assert.ok(alreadyEligible.exam.block > 0, "pre-existing +3 must still trigger the main effect");
console.log("Native CardPlayAggressiveUp condition boundary: OK");
