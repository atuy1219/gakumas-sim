import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import {
  JUOU_SENA_TOWER26,
  JUOU_SENA_TOWER26_BATTLE_CONFIG,
  createJuouSenaTower26State,
} from "../web/juou_sena_tower26.js";
import { parseTowerLiveLayerMap } from "../web/tower_stage.js";
import {
  applyTowerAiAction,
  cloneTowerStateForAi,
  enumerateTowerAiActions,
  rankTowerAiActions,
  runTowerAiEpisode,
  towerAiActionKey,
  towerAiStateKey,
} from "../web/tower_ai.js";
import { createTowerTurnState, drawTowerTurn } from "../web/tower_runtime.js";

const livePayload = JSON.parse(gunzipSync(readFileSync(new URL("../web/data/tower_layer_config.json.gz", import.meta.url))));
const layers = parseTowerLiveLayerMap(livePayload).filter((row) => (
  row.towerId === JUOU_SENA_TOWER26.towerId && row.number === JUOU_SENA_TOWER26.floor
));
assert.equal(layers.length, 6);
assert.ok(layers.every((row) => row.maxSubMemoryCount === 3));
assert.ok(layers.every((row) => row.produceExamBattleConfigId === JUOU_SENA_TOWER26.battleConfigId));

const masters = [
  {
    id: "SCORE",
    isInitial: true,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_lesson-0005-01" }],
  },
  {
    id: "EXTRA",
    isInitial: true,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: "e_effect-exam_playable_value_add-0001" }],
  },
  { id: "A", isInitial: true, playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
  { id: "B", playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
  { id: "C", playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
  { id: "D", playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
];
const cardById = new Map(masters.map((card) => [card.id, card]));
const cardVariantByKey = new Map(masters.map((card) => [`${card.id}@@0`, card]));
const cards = masters.map((card) => ({ id: card.id, upgradeCount: 0 }));
const initial = createJuouSenaTower26State({
  cards,
  seed: 1,
  examEffectType: "ProduceExamEffectType_ExamParameterBuff",
  cardById,
  battleConfig: JUOU_SENA_TOWER26_BATTLE_CONFIG,
  options: { cardVariantByKey, stamina: 100 },
});
assert.equal(initial.turn, 1);
assert.equal(initial.turnLimit, 16);
assert.equal(initial.turnParameterTypes.length, 16);

const clone = cloneTowerStateForAi(initial);
clone.exam.parameter = 999;
clone.effectScheduler.registrations.push({ id: "clone-only" });
clone.pItemEffectRemainingCounts.set("x", 0);
assert.notEqual(initial.exam.parameter, 999);
assert.equal(initial.effectScheduler.registrations.some((row) => row.id === "clone-only"), false);
assert.equal(initial.pItemEffectRemainingCounts.has("x"), false);
assert.equal(clone.cardById, initial.cardById, "immutable master maps should be shared");

const firstKey = towerAiStateKey(initial);
const changedTimer = cloneTowerStateForAi(initial);
changedTimer.timers.push({ turn: 2, count: 1, child: { kind: "lesson", value: 1 } });
assert.notEqual(towerAiStateKey(changedTimer), firstKey);
const changedCounter = cloneTowerStateForAi(initial);
changedCounter.pItemEffectRemainingCounts.set("p", 1);
assert.notEqual(towerAiStateKey(changedCounter), firstKey);

const actions = enumerateTowerAiActions(initial);
assert.ok(actions.some((action) => action.type === "play"));
assert.ok(actions.some((action) => action.type === "end"));
const rankA = rankTowerAiActions(initial, { depth: 2, beamWidth: 8 });
const rankB = rankTowerAiActions(initial, { depth: 2, beamWidth: 8 });
assert.deepEqual(rankA.map((row) => row.actionKey), rankB.map((row) => row.actionKey));

const endState = applyTowerAiAction(initial, "end");
assert.equal(endState.turn, 2);
assert.equal(initial.turn, 1);

const episode = runTowerAiEpisode(initial, { depth: 1, beamWidth: 8 });
assert.equal(episode.state.ended, true);
assert.equal(episode.state.turn, 16);
assert.equal(episode.state.history.length, 16);
assert.deepEqual(episode.unsupported, []);
assert.ok(episode.decisions.length >= 16);

// Select effects must become distinct AI actions instead of silently choosing
// the first candidate. Replaying an action applies its exact selection plan.
const selectionMasters = [
  {
    id: "SELECT",
    isInitial: true,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [{ produceExamTriggerId: "", produceExamEffectId: "select-effect" }],
  },
  { id: "ONE", isInitial: true, playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
  { id: "TWO", isInitial: true, playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] },
];
const selectionCardById = new Map(selectionMasters.map((card) => [card.id, card]));
const selectionState = createTowerTurnState(
  selectionMasters.map((card) => ({ id: card.id, upgradeCount: 0 })),
  7,
  selectionCardById,
  {
    examEffectById: new Map([["select-effect", {
      id: "select-effect",
      effectType: "ProduceExamEffectType_ExamCardMove",
      produceCardSearchId: "all-hand",
      pickRangeType: "ProducePickRangeType_Select",
      pickCountMin: 1,
      pickCountMax: 1,
      movePositionType: "ProduceCardMovePositionType_Lost",
    }]]),
    cardSearchById: new Map([["all-hand", {
      id: "all-hand",
      cardPositionType: "ProduceCardPositionType_Hand",
      produceCardIds: ["ONE", "TWO"],
    }]]),
    stamina: 100,
  },
);
drawTowerTurn(selectionState, 3);
const selectIndex = selectionState.hand.findIndex((card) => card.id === "SELECT");
const selectActions = enumerateTowerAiActions(selectionState).filter((action) => (
  action.type === "play" && action.index === selectIndex
));
assert.equal(selectActions.length, 2);
assert.notEqual(towerAiActionKey(selectActions[0]), towerAiActionKey(selectActions[1]));
const selectedState = applyTowerAiAction(selectionState, selectActions[1]);
assert.equal(selectedState.lost.length, 1);
assert.equal(selectedState.lost[0].token, selectActions[1].selectionPlan[0][0]);

assert.throws(() => createJuouSenaTower26State({
  cards,
  seed: 1,
  examEffectType: "ProduceExamEffectType_ExamPreservation",
  cardById,
  battleConfig: JUOU_SENA_TOWER26_BATTLE_CONFIG,
}), /選択できない育成タイプ/);

console.log("tower AI / Juou Sena floor 26 tests: ok");
