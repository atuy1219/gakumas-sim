import assert from "node:assert/strict";
import { XorShift32 } from "../web/engine.js";
import { createTowerTurnState, drawTowerTurn, playTowerCard, finishTowerTurn, useTowerDrink } from "../web/tower_runtime.js";
import { createSimulationBackup, parseSimulationBackup, stringifySimulationBackup } from "../web/simulation_backup.js";

// IsUpgradableRaw permits a skill effect to upgrade only 0 -> 1. Higher
// master variants are for support upgrades; merely having them is insufficient.
// The false ++ changes effect-group membership and can generate extra cards.
const blockGroup = "effect_group-visible-exam_block-000";
const installId = "p_card-02-ido-3_169", generatedId = "p_card-02-ido-3_190";
const enchantId = `enchant-${installId}-enc01`;
const card = (id, name, upgradeCount, groups = [], effects = []) => ({ id, name, upgradeCount,
  category: "ProduceCardCategory_MentalSkill", stamina: 0,
  playMovePositionType: "ProduceCardMovePositionType_Grave", effectGroupIds: groups,
  playEffects: effects.map(produceExamEffectId => ({ produceExamEffectId })) });
const install = { id: "install", effectType: "ProduceExamEffectType_ExamStatusEnchant",
  effectTurn: -1, produceExamStatusEnchantId: enchantId };
const create = { id: "create", effectType: "ProduceExamEffectType_ExamCardCreateId",
  targetProduceCardId: generatedId, targetUpgradeCount: 0, pickCountMin: 1, pickCountMax: 1,
  movePositionType: "ProduceCardMovePositionType_DeckFirst" };
const upgrade = { id: "upgrade", effectType: "ProduceExamEffectType_ExamCardUpgrade",
  produceCardSearchId: "hand", pickRangeType: "ProducePickRangeType_All" };
const variants = [card(installId, "私を超えて", 0, [], [install.id]),
  card(installId, "私を超えて+", 1, [], [install.id]), card(installId, "私を超えて+++", 3),
  card("star", "私がスター", 0), card("star", "私がスター+", 1), card("star", "私がスター++", 2, [blockGroup]),
  card("base", "未強化カード", 0, [blockGroup]), card("base", "未強化カード+", 1, [blockGroup]),
  card("next", "元気カード", 0, [blockGroup]), card("next", "元気カード+", 1, [blockGroup]),
  card("trouble", "強化不可", 0), card(generatedId, "私を超えて（翔）", 0)];
const cardById = new Map(variants.map(c => [c.id, c])); // deliberately ends at +++/++
const trigger = { id: "interval", phaseTypes: ["ProduceExamPhaseType_ExamPlayCountInterval"],
  phaseValues: [2], produceCardSearchId: "block-target" };
const options = { stamina: 20, handLimit: 10, turnLimit: 10,
  cardVariantByKey: new Map(variants.map(c => [`${c.id}@@${c.upgradeCount}`, c])),
  examEffectById: new Map([install, create, upgrade].map(e => [e.id, e])),
  examTriggerById: new Map([[trigger.id, trigger]]),
  examStatusEnchantById: new Map([[enchantId, { id: enchantId,
    produceExamTriggerId: trigger.id, produceExamEffectIds: [create.id] }]]),
  cardSearchById: new Map([["hand", { id: "hand", cardPositionType: "ProduceCardPositionType_Hand" }],
    ["block-target", { id: "block-target", cardPositionType: "ProduceCardPositionType_Target", effectGroupIds: [blockGroup] }]]) };
const s = createTowerTurnState([{ id: installId, upgradeCount: 1 }, { id: "star", upgradeCount: 1 },
  { id: "base" }, { id: "next" }, { id: "trouble" }], 3437998083, cardById, options);
drawTowerTurn(s, 5); s.playsRemaining = 5;
const play = (state, id) => playTowerCard(state, state.hand.findIndex(c => c.id === id));
play(s, installId);
const rngBefore = s.randomState;
for (let i = 0; i < 2; i++) useTowerDrink(s, { id: "upgrade-drink", effects: [{ examEffect: upgrade }] });
assert.deepEqual(s.hand.map(c => [c.id, c.upgradeCount]).sort(),
  [["base", 1], ["next", 1], ["star", 1], ["trouble", 0]]);
assert.equal(s.hand.find(c => c.id === "star").name, "私がスター+");
assert.deepEqual(s.unsupported, [], "already upgraded / unupgradable cards are ordinary no-ops");
const resumed = parseSimulationBackup(stringifySimulationBackup(createSimulationBackup(s, "tower"))).state;
// Older checkpoints have originCardToken but no captured origin card name.
delete resumed.effectScheduler.registrations.find(r => r.sourceId === enchantId).metadata.originCard;
for (const state of [s, resumed]) {
  assert.equal(play(state, "star").created.length, 0, "+ must retain its original non-block effects");
  assert.equal(play(state, "base").created.length, 0, "first actual block card is not the second eligible play");
  assert.equal(play(state, "next").created.length, 1, "second actual block card generates exactly one 翔");
  assert.equal(state.randomState, rngBefore, "DeckFirst generation and All upgrade consume no RNG");
  assert.deepEqual(state.deck.map(c => c.id), [generatedId]);
  const activation = state.simulationLog.events.find(e => e.source?.id === enchantId && e.effectId === create.id);
  assert.equal(activation.source.name, "私を超えて+の継続効果");
  finishTowerTurn(state, { type: "end" });
  const draw = drawTowerTurn(state, 3);
  assert.equal(draw.drawn[0].id, generatedId);
  assert.equal(draw.recycleEvents.length, 1);
  assert.equal(state.lastRecycle.source.length, 5);
  const expected = new XorShift32(rngBefore);
  for (let i = 0; i < 4; i++) expected.nextU32();
  assert.equal(state.randomState, expected.state, "recycle advances exactly source count - 1 words");
}
assert.deepEqual(resumed.hand.map(c => c.token), s.hand.map(c => c.token));
console.log("Skill upgrade cap, enchant origin names, generated-card counters and recycle RNG: ok");
