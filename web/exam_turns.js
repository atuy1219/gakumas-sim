import { calculateTurnParameterTypesFromCounts } from "./turn_parameters.js";

export const EXAM_JUDGING_STYLE = Object.freeze({
  BALANCE: "balance",
  FOCUSED: "focused",
});

const PROFILE = (style, flow1, flow2, flow3, scenarios = ["nia", "hif"]) => Object.freeze({
  style,
  order: Object.freeze([flow1, flow2, flow3]),
  scenarios: Object.freeze([...scenarios]),
});

export const EXAM_CHARACTER_TURN_PROFILES = Object.freeze({
  hski: PROFILE(EXAM_JUDGING_STYLE.BALANCE, "Visual", "Dance", "Vocal"),
  ttmr: PROFILE(EXAM_JUDGING_STYLE.FOCUSED, "Vocal", "Dance", "Visual"),
  fktn: PROFILE(EXAM_JUDGING_STYLE.FOCUSED, "Dance", "Visual", "Vocal"),
  amao: PROFILE(EXAM_JUDGING_STYLE.FOCUSED, "Vocal", "Visual", "Dance"),
  kllj: PROFILE(EXAM_JUDGING_STYLE.BALANCE, "Visual", "Dance", "Vocal"),
  kcna: PROFILE(EXAM_JUDGING_STYLE.FOCUSED, "Dance", "Visual", "Vocal"),
  ssmk: PROFILE(EXAM_JUDGING_STYLE.FOCUSED, "Dance", "Visual", "Vocal"),
  hrnm: PROFILE(EXAM_JUDGING_STYLE.BALANCE, "Vocal", "Dance", "Visual"),
  jsna: PROFILE(EXAM_JUDGING_STYLE.BALANCE, "Visual", "Vocal", "Dance"),
  hmsz: PROFILE(EXAM_JUDGING_STYLE.FOCUSED, "Vocal", "Visual", "Dance"),
  hume: PROFILE(EXAM_JUDGING_STYLE.BALANCE, "Dance", "Vocal", "Visual"),
  shro: PROFILE(EXAM_JUDGING_STYLE.BALANCE, "Visual", "Dance", "Vocal"),
  // 雨夜燕はN.I.Aのみ実装済み。Gakumas Tools: skew / [Vo,Da,Vi]=[2,1,3].
  // => 流1=Da, 流2=Vo, 流3=Vi.
  atbm: PROFILE(EXAM_JUDGING_STYLE.FOCUSED, "Dance", "Vocal", "Visual", ["nia"]),
});

const STAGE = (id, label, scenario, balanceCounts, focusedCounts = balanceCounts) => Object.freeze({
  id,
  label,
  scenario,
  counts: Object.freeze({
    [EXAM_JUDGING_STYLE.BALANCE]: Object.freeze([...balanceCounts]),
    [EXAM_JUDGING_STYLE.FOCUSED]: Object.freeze([...focusedCounts]),
  }),
  turn: balanceCounts.reduce((sum, value) => sum + value, 0),
});

export const EXAM_TURN_STAGES = Object.freeze([
  STAGE("nia-first-standard", "N.I.A 1次（メロBang! / Music Order）", "nia", [4, 3, 2]),
  STAGE("nia-first-harmony", "N.I.A 1次（ハーモニーToNight）", "nia", [4, 3, 2], [5, 2, 2]),
  STAGE("nia-second", "N.I.A 2次オーディション", "nia", [5, 4, 3], [6, 3, 3]),
  STAGE("nia-final", "N.I.A 最終オーディション", "nia", [5, 4, 3], [6, 3, 3]),
  STAGE("hif-selection-1", "H.I.F 選抜試験1", "hif", [5, 3, 2]),
  STAGE("hif-selection-2", "H.I.F 選抜試験2", "hif", [5, 4, 3], [6, 3, 3]),
  STAGE("hif-selection-3", "H.I.F 選抜試験3", "hif", [5, 4, 3], [6, 3, 3]),
  STAGE("hif-final-round-1", "H.I.F 本戦 ラウンド1", "hif", [4, 3, 2]),
  STAGE("hif-final-round-2", "H.I.F 本戦 ラウンド2", "hif", [5, 4, 3], [6, 3, 3]),
]);

const STAGE_BY_ID = new Map(EXAM_TURN_STAGES.map((stage) => [stage.id, stage]));

export function getExamTurnProfile(characterIdInput) {
  return EXAM_CHARACTER_TURN_PROFILES[String(characterIdInput ?? "")] ?? null;
}

export function getExamTurnStage(stageIdInput) {
  return STAGE_BY_ID.get(String(stageIdInput ?? "")) ?? null;
}

export function examJudgingStyleLabel(styleInput) {
  return String(styleInput ?? "") === EXAM_JUDGING_STYLE.FOCUSED ? "突出" : "バランス";
}

export function isExamTurnStageSupported(characterIdInput, stageIdInput) {
  const profile = getExamTurnProfile(characterIdInput);
  const stage = getExamTurnStage(stageIdInput);
  if (!profile || !stage) return false;
  return profile.scenarios.includes(stage.scenario);
}

export function calculateExamTurnTypes(characterIdInput, stageIdInput, seedInput) {
  const characterId = String(characterIdInput ?? "");
  const profile = getExamTurnProfile(characterId);
  if (!profile) {
    throw new Error("このキャラクターの審査基準は自動計算データに未登録です。手動入力を使用してください。");
  }

  const stage = getExamTurnStage(stageIdInput);
  if (!stage) throw new Error("試験・オーディションを選択してください。");
  if (!isExamTurnStageSupported(characterId, stage.id)) {
    if (characterId === "atbm" && stage.scenario === "hif") {
      throw new Error("雨夜燕はH.I.F未実装です。N.I.Aを選択してください。");
    }
    throw new Error("このキャラクターは選択した試験・オーディションの自動生成に未対応です。");
  }
  const counts = stage.counts[profile.style];
  if (!counts) throw new Error("この審査基準のターン配分を計算できません。");

  return calculateTurnParameterTypesFromCounts(profile.order, counts, seedInput);
}

export function describeExamTurnConfig(characterIdInput, stageIdInput) {
  const profile = getExamTurnProfile(characterIdInput);
  const stage = getExamTurnStage(stageIdInput);
  if (!profile || !stage || !isExamTurnStageSupported(characterIdInput, stageIdInput)) return null;
  return {
    style: profile.style,
    order: [...profile.order],
    counts: [...stage.counts[profile.style]],
    turn: stage.turn,
    label: stage.label,
  };
}
