import assert from "node:assert/strict";
import fs from "node:fs";
import { createTowerTurnState, drawTowerTurn, playTowerCard, finishTowerTurn } from "../web/tower_runtime.js";
import { createSimulationBackup, parseSimulationBackup, stringifySimulationBackup } from "../web/simulation_backup.js";

// Actual master identities for わたしだけの思い出+. Capture 16/18/19,
// Build ID 77fda4e2..., verifies replay after draw on the install-relative
// two-turn interval, with HP >= 80% and two successful activations total.
const memoryId = "p_card-01-ido-3_202";
const effect = (id, type, rest = {}) => ({ id, effectType: `ProduceExamEffectType_${type}`, ...rest });
const replayId = "memory-replay";
const enchantId = "enchant-p_card-01-ido-3_202-enc02";
const triggerId = "e_trigger-exam_turn_interval-2-stamina_up_multiple-800";
const effects = [
  effect("memory-draw", "ExamCardDraw", { effectValue1: 1 }),
  effect("memory-install", "ExamStatusEnchantEncore", {
    effectValue1: 1, effectCount: 2, effectTurn: -1, produceExamStatusEnchantId: enchantId,
  }),
  effect(replayId, "ExamForcePlayCardSearch", {
    produceCardSearchId: "self", pickRangeType: "ProducePickRangeType_All", pickCountMin: 1, pickCountMax: 1,
  }),
];
const memory = { id: memoryId, name: "わたしだけの思い出+", stamina: 0, forceStamina: 3,
  isInitial: true, playMovePositionType: "ProduceCardMovePositionType_Lost",
  playEffects: [{ produceExamEffectId: "memory-draw" },
    { produceExamEffectId: "memory-install", isOncePlayEffect: true }],
};
const fillers = Array.from({ length: 40 }, (_, i) => ({ id: `filler-${i}`, stamina: 0, playEffects: [] }));
const byId = rows => new Map(rows.map(row => [row.id, row]));
function create(cards, extra = {}) {
  return createTowerTurnState(cards, 1, byId(cards), {
    stamina: 39, turnLimit: 9, handLimit: 5,
    examRuntimeSettings: { examTurnEndRecoveryStamina: 2 }, ...extra,
  });
}
function memoryState() {
  return create([memory, ...fillers], {
    examEffectById: byId(effects),
    examStatusEnchantById: byId([{ id: enchantId, produceExamTriggerId: triggerId, produceExamEffectIds: [replayId] }]),
    examTriggerById: byId([{ id: triggerId, phaseTypes: ["ProduceExamPhaseType_ExamTurnInterval"],
      phaseValues: [2], fieldStatusTypes: ["ProduceExamFieldStatusType_StaminaUpMultiple"], fieldStatusValues: [800] }]),
    cardSearchById: byId([{ id: "self", cardPositionType: "ProduceCardPositionType_DeckAll", isSelf: true }]),
  });
}
for (const installTurn of [1, 2]) {
  const original = memoryState();
  drawTowerTurn(original);
  if (installTurn === 2) {
    finishTowerTurn(original, { type: "end" });
    const index = original.discard.findIndex(card => card.id === memoryId);
    original.deck.unshift(...original.discard.splice(index, 1));
    drawTowerTurn(original);
  }
  playTowerCard(original, original.hand.findIndex(card => card.id === memoryId));
  const backup = createSimulationBackup(original, "tower");
  const restored = parseSimulationBackup(stringifySimulationBackup(backup)).state;
  for (const registration of backup.checkpoint.state.effectScheduler.registrations) delete registration.installedTurn;
  const legacy = parseSimulationBackup(stringifySimulationBackup(backup)).state;
  for (const state of [original, restored, legacy]) {
    const replayTurns = [];
    for (let turn = installTurn + 1; turn <= installTurn + 7; turn++) {
      finishTowerTurn(state, { type: "end" });
      // Reject the first eligible replay at 31/39; a failed condition must
      // not spend a use. 32/39 is sufficient at later interval boundaries.
      state.exam.stamina = turn === installTurn + 2 ? 31 : 32;
      const draw = drawTowerTurn(state);
      const replay = state.currentTurnPlays.filter(play => play.forced && play.card.id === memoryId);
      if (replay.length) {
        replayTurns.push(turn);
        assert.deepEqual(replay[0].cost, [], "replay bypasses the direct stamina cost");
        assert.equal(state.exam.stamina, 32);
        assert.equal(draw.hand.length, 4, "replay draws one after the ordinary three");
      } else assert.equal(draw.hand.length, 3);
      assert.equal(state.statusEnchantSerial, 1, "replay cannot reinstall its initial-only effect");
    }
    assert.deepEqual(replayTurns, [installTurn + 4, installTurn + 6]);
    assert.equal(state.statusEnchantRemainingCounts.get("statusEnchant:1"), 0);
  }
}

// Normal draw -> two reserved draws -> full-Hand move is rejected.
// Another reservation on the following turn can return the same Lost card.
{
  const rows = [effect("draw-one", "ExamCardDraw", { effectValue1: 1 }),
    effect("return", "ExamCardMove", { produceCardSearchId: "lost-reserver", movePositionType: "ProduceCardMovePositionType_Hand", pickRangeType: "ProducePickRangeType_All" }),
    ...["draw-a", "draw-b", "return-full", "return-next"].map((id, i) => effect(id, "ExamEffectTimer", {
      effectValue1: i === 3 ? 2 : 1, effectCount: 1, chainProduceExamEffectId: i < 2 ? "draw-one" : "return",
    }))];
  const reserver = { id: "reserver", isInitial: true, stamina: 0, playMovePositionType: "ProduceCardMovePositionType_Lost",
    playEffects: rows.slice(2).map(row => ({ produceExamEffectId: row.id })) };
  const state = create([reserver, ...fillers], {
    examEffectById: byId(rows),
    cardSearchById: byId([{ id: "lost-reserver", cardPositionType: "ProduceCardPositionType_Lost", produceCardIds: [reserver.id] }]),
  });
  drawTowerTurn(state);
  playTowerCard(state, state.hand.findIndex(card => card.id === reserver.id));
  finishTowerTurn(state, { type: "end" });
  const expected = state.deck.slice(0, 5).map(card => card.id);
  assert.deepEqual(drawTowerTurn(state).hand.map(card => card.id), expected);
  assert.equal(state.lost[0]?.id, reserver.id);
  finishTowerTurn(state, { type: "end" });
  const next = state.deck.slice(0, 3).map(card => card.id);
  assert.deepEqual(drawTowerTurn(state).hand.map(card => card.id), [...next, reserver.id]);
  assert.equal(state.lost.length, 0);
}

// Fixed HP reduction bypasses Block and every ordinary cost discount.
// Ending a turn with extra plays must not invent a skip decision/heal.
{
  const reduce = effect("fixed-reduce", "ExamStaminaReduceFix", { effectValue1: 2 });
  const card = { id: "reduce", isInitial: true, stamina: 0, playEffects: [{ produceExamEffectId: reduce.id }] };
  const state = create([card, ...fillers], { examEffectById: byId([reduce]) });
  drawTowerTurn(state);
  Object.assign(state.exam, { stamina: 30, block: 99, staminaConsumptionDown: 4, staminaConsumptionDownFix: 9 });
  state.playsRemaining = 2;
  playTowerCard(state, state.hand.findIndex(c => c.id === card.id));
  assert.equal(state.exam.stamina, 28);
  assert.equal(state.exam.block, 99);
  finishTowerTurn(state, { type: "end" });
  assert.equal(state.exam.stamina, 28, "end is not skip even when an extra play remains");
  drawTowerTurn(state);
  finishTowerTurn(state, { type: "skip" });
  assert.equal(state.exam.stamina, 30, "an explicit unused play still allows skip recovery");
}
// Captured deck/grave candidates and native RNG endpoints, not values derived
// from the simulator. The interleaved Grave/Deck/Grave selection in (17)#1
// additionally verifies that movement groups by source rather than flattening
// the final random order unchanged.
const movements = JSON.parse(fs.readFileSync(new URL("./fixtures/native-tenpu-move-rng-v1534-v1538.json", import.meta.url)));
for (const sample of movements) {
  const move = effect("tenpu-move", "ExamCardMove", { produceCardSearchId: "tenpu-search",
    movePositionType: "ProduceCardMovePositionType_DeckFirst", pickRangeType: "ProducePickRangeType_All" });
  const source = [...sample.deck, ...sample.grave].map(id => ({ id, stamina: 0, rarity: "ProduceCardRarity_Ssr" }));
  const trigger = { id: "move-trigger", isInitial: true, stamina: 0, playEffects: [{ produceExamEffectId: move.id }] };
  const state = create([trigger, ...source, ...fillers], {
    examEffectById: byId([move]),
    cardSearchById: byId([{ id: "tenpu-search", cardPositionType: "ProduceCardPositionType_DeckGrave",
      cardRarities: ["ProduceCardRarity_Ssr"], orderType: "ProduceCardOrderType_Random", limitCount: 3 }]),
  });
  drawTowerTurn(state);
  const cards = new Map([...state.hand, ...state.deck, ...state.discard].map(card => [card.id, card]));
  state.hand = [cards.get(trigger.id)];
  state.deck = sample.deck.map(id => cards.get(id));
  state.discard = sample.grave.map(id => cards.get(id));
  state.randomState = sample.before;
  playTowerCard(state, 0);
  assert.equal(state.randomState >>> 0, sample.after, `native RNG (${sample.capture})#${sample.session}`);
  assert.deepEqual(state.deck.slice(0, sample.moved.length).map(card => card.id), sample.moved,
    `native movement (${sample.capture})#${sample.session}`);
}
console.log("Encore/HP/backup, reserved draws, fixed reduction, and 8 native move/RNG goldens: ok");
