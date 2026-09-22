import { calculateTowerTurnTypes } from "./tower_stage.js";
import { createTowerTurnState, drawTowerTurn } from "./tower_runtime.js";

export const JUOU_SENA_TOWER26 = Object.freeze({
  characterId: "jsna",
  towerId: "tower_001-jsna",
  floor: 26,
  turnLimit: 16,
  maxSubMemoryCount: 3,
  battleConfigId: "p_exam_battle_config-tower_001-2096_1715_2541-2589_2118_3139-turn_16",
  supportedExamEffectTypes: Object.freeze([
    "ProduceExamEffectType_ExamParameterBuff",
    "ProduceExamEffectType_ExamLessonBuff",
    "ProduceExamEffectType_ExamReview",
    "ProduceExamEffectType_ExamCardPlayAggressive",
    "ProduceExamEffectType_ExamConcentration",
    "ProduceExamEffectType_ExamFullPower",
  ]),
  unsupportedExamEffectTypes: Object.freeze([
    "ProduceExamEffectType_ExamPreservation",
  ]),
});

export const JUOU_SENA_TOWER26_BATTLE_CONFIG = Object.freeze({
  id: JUOU_SENA_TOWER26.battleConfigId,
  turn: 16,
  vocal: 2096,
  dance: 1715,
  visual: 2541,
  vocalExcellent: 2589,
  danceExcellent: 2118,
  visualExcellent: 3139,
});

export function resolveJuouSenaTower26Layer(catalog, examEffectType) {
  const effectType = String(examEffectType ?? "");
  if (!JUOU_SENA_TOWER26.supportedExamEffectTypes.includes(effectType)) {
    throw new Error(`十王星南 ドル道26階では選択できない育成タイプです: ${effectType || "(未指定)"}`);
  }
  const layer = (catalog?.layerExams ?? []).find((row) => (
    row.towerId === JUOU_SENA_TOWER26.towerId
    && Number(row.number) === JUOU_SENA_TOWER26.floor
    && row.examEffectType === effectType
  ));
  if (!layer) throw new Error(`十王星南 ドル道26階の階層データがありません: ${effectType}`);
  if (layer.produceExamBattleConfigId !== JUOU_SENA_TOWER26.battleConfigId) {
    throw new Error(`26階の試験設定が想定外です: ${layer.produceExamBattleConfigId}`);
  }
  return layer;
}

export function createJuouSenaTower26State({
  cards,
  seed,
  examEffectType,
  cardById = new Map(),
  battleConfig = JUOU_SENA_TOWER26_BATTLE_CONFIG,
  parameterBonus = null,
  examScoreSettings = null,
  options = {},
} = {}) {
  if (!JUOU_SENA_TOWER26.supportedExamEffectTypes.includes(String(examEffectType ?? ""))) {
    throw new Error(`十王星南 ドル道26階では選択できない育成タイプです: ${examEffectType || "(未指定)"}`);
  }
  if (String(battleConfig?.id ?? "") !== JUOU_SENA_TOWER26.battleConfigId) {
    throw new Error(`十王星南 ドル道26階以外の試験設定です: ${battleConfig?.id ?? "(未指定)"}`);
  }
  if (Number(battleConfig.turn) !== JUOU_SENA_TOWER26.turnLimit) {
    throw new Error(`26階のターン数が不正です: ${battleConfig.turn}`);
  }
  const state = createTowerTurnState(cards, seed, cardById, {
    ...options,
    turnLimit: JUOU_SENA_TOWER26.turnLimit,
  });
  state.towerProfile = { ...JUOU_SENA_TOWER26 };
  state.examEffectType = String(examEffectType);
  state.battleConfigId = battleConfig.id;
  state.turnParameterTypes = calculateTowerTurnTypes(battleConfig, seed);
  state.parameterBonus = parameterBonus;
  state.examScoreSettings = examScoreSettings;
  drawTowerTurn(state, Number(options.drawPerTurn ?? 3));
  return state;
}
