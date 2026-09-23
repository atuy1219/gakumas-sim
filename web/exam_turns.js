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
  // 雨夜燕はN.I.Aのみ実装済み。
  atbm: PROFILE(EXAM_JUDGING_STYLE.FOCUSED, "Dance", "Vocal", "Visual", ["nia"]),
});

const STAGE = (id, label, scenario, balanceCounts, focusedCounts = balanceCounts, options = {}) => Object.freeze({
  id,
  label,
  scenario,
  counts: Object.freeze({
    [EXAM_JUDGING_STYLE.BALANCE]: Object.freeze([...balanceCounts]),
    [EXAM_JUDGING_STYLE.FOCUSED]: Object.freeze([...focusedCounts]),
  }),
  turn: balanceCounts.reduce((sum, value) => sum + value, 0),
  ...options,
});

const LESSON = (id, label, difficulty, turn) => Object.freeze({
  id,
  label,
  scenario: "hajime",
  difficulty,
  turn,
  lesson: true,
});

export const EXAM_TURN_STAGES = Object.freeze([
  // 初 / レギュラー
  LESSON("hajime-regular-normal-a", "初 レギュラー · 通常レッスンA", "regular", 5),
  LESSON("hajime-regular-normal-b", "初 レギュラー · 通常レッスンB", "regular", 5),
  LESSON("hajime-regular-normal-c", "初 レギュラー · 通常レッスンC", "regular", 6),
  LESSON("hajime-regular-normal-d", "初 レギュラー · 通常レッスンD", "regular", 6),
  LESSON("hajime-regular-sp-a", "初 レギュラー · SPレッスンA", "regular", 5),
  LESSON("hajime-regular-sp-b", "初 レギュラー · SPレッスンB", "regular", 6),
  LESSON("hajime-regular-sp-c", "初 レギュラー · SPレッスンC", "regular", 6),
  LESSON("hajime-regular-hard-1", "初 レギュラー · 追い込みレッスン（中間前）", "regular", 9),
  LESSON("hajime-regular-hard-2", "初 レギュラー · 追い込みレッスン（最終前）", "regular", 10),
  STAGE("hajime-regular-mid", "初 レギュラー · 中間試験", "hajime", [4, 3, 2], [4, 3, 2], { difficulty: "regular" }),
  STAGE("hajime-regular-final", "初 レギュラー · 最終試験", "hajime", [5, 4, 3], [6, 3, 3], { difficulty: "regular" }),

  // 初 / プロ
  LESSON("hajime-pro-normal-a", "初 プロ · 通常レッスンA", "pro", 5),
  LESSON("hajime-pro-normal-b", "初 プロ · 通常レッスンB", "pro", 5),
  LESSON("hajime-pro-normal-c", "初 プロ · 通常レッスンC", "pro", 6),
  LESSON("hajime-pro-normal-d", "初 プロ · 通常レッスンD", "pro", 6),
  LESSON("hajime-pro-normal-e", "初 プロ · 通常レッスンE", "pro", 6),
  LESSON("hajime-pro-sp-a", "初 プロ · SPレッスンA", "pro", 5),
  LESSON("hajime-pro-sp-b", "初 プロ · SPレッスンB", "pro", 6),
  LESSON("hajime-pro-sp-c", "初 プロ · SPレッスンC", "pro", 6),
  LESSON("hajime-pro-sp-d", "初 プロ · SPレッスンD", "pro", 6),
  LESSON("hajime-pro-hard-1", "初 プロ · 追い込みレッスン（中間前）", "pro", 9),
  LESSON("hajime-pro-hard-2", "初 プロ · 追い込みレッスン（最終前）", "pro", 12),
  STAGE("hajime-pro-mid", "初 プロ · 中間試験", "hajime", [4, 3, 2], [4, 3, 2], { difficulty: "pro" }),
  STAGE("hajime-pro-final", "初 プロ · 最終試験", "hajime", [5, 4, 3], [6, 3, 3], { difficulty: "pro" }),

  // 初 / マスター。レッスンレベルはPro系マスタと共通で、出現週が異なる。
  LESSON("hajime-master-normal-a", "初 マスター · 通常レッスンA", "master", 5),
  LESSON("hajime-master-normal-c", "初 マスター · 通常レッスンC", "master", 6),
  LESSON("hajime-master-normal-d", "初 マスター · 通常レッスンD", "master", 6),
  LESSON("hajime-master-normal-e", "初 マスター · 通常レッスンE", "master", 6),
  LESSON("hajime-master-sp-a", "初 マスター · SPレッスンA", "master", 5),
  LESSON("hajime-master-sp-b", "初 マスター · SPレッスンB", "master", 6),
  LESSON("hajime-master-sp-c", "初 マスター · SPレッスンC", "master", 6),
  LESSON("hajime-master-sp-d", "初 マスター · SPレッスンD", "master", 6),
  LESSON("hajime-master-hard-1", "初 マスター · 追い込みレッスン（中間前）", "master", 9),
  LESSON("hajime-master-hard-2", "初 マスター · 追い込みレッスン（最終前）", "master", 12),
  STAGE("hajime-master-mid", "初 マスター · 中間試験", "hajime", [4, 3, 2], [4, 3, 2], { difficulty: "master" }),
  STAGE("hajime-master-final", "初 マスター · 最終試験", "hajime", [5, 4, 3], [6, 3, 3], { difficulty: "master" }),

  // 初 / レジェンド。ProduceExamBattleConfigのproduce_006_mid/finalに合わせる。
  STAGE("hajime-legend-mid", "初 レジェンド · 中間試験", "hajime", [5, 3, 2], [5, 3, 2], { difficulty: "legend" }),
  STAGE("hajime-legend-final", "初 レジェンド · 最終試験", "hajime", [5, 4, 3], [6, 3, 3], { difficulty: "legend" }),

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

// Real-device H.I.F Final Round 1 trace:
// Seed 171624539 -> initial shuffle state 809254905 after 24 XorShift words.
// Native CalcTurnParameterType(9) consumes 6 (= turn - 3) words, leaving an
// 18-word setup prefix. This replaces the invalid old 2*turn heuristic.
export function nativeExamPreShuffleAdvanceSteps(turnCountInput) {
  const turnCount = Math.max(0, Math.trunc(Number(turnCountInput) || 0));
  return 18 + Math.max(0, turnCount - 3);
}

export function examJudgingStyleLabel(styleInput) {
  if (String(styleInput ?? "") === "lesson") return "単属性レッスン";
  return String(styleInput ?? "") === EXAM_JUDGING_STYLE.FOCUSED ? "突出" : "バランス";
}

export function isExamTurnStageSupported(characterIdInput, stageIdInput) {
  const profile = getExamTurnProfile(characterIdInput);
  const stage = getExamTurnStage(stageIdInput);
  if (!stage) return false;
  if (stage.scenario === "hajime") return Boolean(profile);
  if (!profile) return false;
  return profile.scenarios.includes(stage.scenario);
}

export function calculateExamTurnTypes(characterIdInput, stageIdInput, seedInput, lessonParameterTypeInput = "") {
  const characterId = String(characterIdInput ?? "");
  const stage = getExamTurnStage(stageIdInput);
  if (!stage) throw new Error("試験・レッスンを選択してください。");

  if (stage.lesson) {
    const lessonParameterType = String(lessonParameterTypeInput ?? "");
    if (!["Vocal", "Dance", "Visual"].includes(lessonParameterType)) {
      throw new Error("レッスン属性（Vo / Da / Vi）を選択してください。");
    }
    return Array.from({ length: stage.turn }, () => lessonParameterType);
  }

  const profile = getExamTurnProfile(characterId);
  if (!profile) throw new Error("このキャラクターの審査基準は自動計算データに未登録です。");
  if (stage.scenario !== "hajime" && !profile.scenarios.includes(stage.scenario)) {
    if (characterId === "atbm" && stage.scenario === "hif") {
      throw new Error("雨夜燕はH.I.F未実装です。N.I.Aを選択してください。");
    }
    throw new Error("このキャラクターは選択した試験・オーディションの自動生成に未対応です。");
  }
  const counts = stage.counts[profile.style];
  if (!counts) throw new Error("この審査基準のターン配分を計算できません。");
  return calculateTurnParameterTypesFromCounts(profile.order, counts, seedInput);
}

export function describeExamTurnConfig(characterIdInput, stageIdInput, lessonParameterTypeInput = "") {
  const stage = getExamTurnStage(stageIdInput);
  if (!stage) return null;

  if (stage.lesson) {
    const lessonParameterType = String(lessonParameterTypeInput ?? "");
    return {
      style: "lesson",
      order: lessonParameterType ? [lessonParameterType] : [],
      counts: lessonParameterType ? [stage.turn] : [],
      turn: stage.turn,
      label: stage.label,
      lesson: true,
      difficulty: stage.difficulty,
    };
  }

  const profile = getExamTurnProfile(characterIdInput);
  if (!profile || !isExamTurnStageSupported(characterIdInput, stageIdInput)) return null;
  return {
    style: profile.style,
    order: [...profile.order],
    counts: [...stage.counts[profile.style]],
    turn: stage.turn,
    label: stage.label,
    difficulty: stage.difficulty ?? "",
  };
}
