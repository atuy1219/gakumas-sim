export const EXAM_SUPPORT_CARD_COUNT = 6;
export const SUPPORT_CARD_HAND_SEARCH_ID = "p_card_search-hand";
export const SUPPORT_CARD_LIMIT_BREAKS = Object.freeze([0, 1, 2, 3, 4]);

const RARITIES = new Set(["R", "SR", "SSR"]);
const PARAMETER_TYPES = new Set([
  "ProduceParameterType_Vocal",
  "ProduceParameterType_Dance",
  "ProduceParameterType_Visual",
  "ProduceParameterType_Unknown",
]);

// The in-game percentage is a relative increase to the support-card master
// probability, not the probability itself. Values below are the maximum level
// reached at each limit-break stage.
const SUPPORT_RATE_BONUS_PERCENT = Object.freeze({
  R: Object.freeze([48.7, 61.5, 74.4, 87.2, 100.0]),
  SR: Object.freeze([59.2, 69.4, 79.6, 89.8, 100.0]),
  SSR: Object.freeze([66.1, 74.6, 83.1, 91.5, 100.0]),
});

export function defaultSupportUpgradePercent(rarityInput, parameterTypeInput) {
  const rarity = String(rarityInput ?? "").toUpperCase();
  const allParameters = String(parameterTypeInput ?? "").endsWith("_Unknown");
  if (rarity === "R") return 1.9;
  if (rarity === "SR") return allParameters ? 1.5 : 2.8;
  if (rarity === "SSR") return allParameters ? 2.0 : 3.7;
  return null;
}

export function supportCardRateBonusPercent(rarityInput, limitBreakInput) {
  const rarity = String(rarityInput ?? "").toUpperCase();
  const limitBreakText = String(limitBreakInput ?? "").trim();
  if (limitBreakText === "") return null;
  const limitBreak = Number(limitBreakText);
  if (!Number.isInteger(limitBreak) || limitBreak < 0 || limitBreak > 4) return null;
  return SUPPORT_RATE_BONUS_PERCENT[rarity]?.[limitBreak] ?? null;
}

export function effectiveSupportUpgradePermil(rarityInput, parameterTypeInput, limitBreakInput) {
  const basePercent = defaultSupportUpgradePercent(rarityInput, parameterTypeInput);
  const bonusPercent = supportCardRateBonusPercent(rarityInput, limitBreakInput);
  if (basePercent === null || bonusPercent === null) return null;
  const basePermil = Math.round(basePercent * 10);
  // Native support-card probability is stored in permille. Keep the final
  // threshold integral to match the existing GetRandomInt(0, 1000) path.
  return Math.trunc((basePermil * (100 + bonusPercent)) / 100);
}

export function inferSupportLimitBreak(rarityInput, parameterTypeInput, permilInput) {
  const permil = Number(permilInput);
  if (!Number.isFinite(permil)) return null;
  for (const limitBreak of SUPPORT_CARD_LIMIT_BREAKS) {
    if (effectiveSupportUpgradePermil(rarityInput, parameterTypeInput, limitBreak) === Math.trunc(permil)) {
      return limitBreak;
    }
  }
  return null;
}

export function normalizeManualSupportCards(rows, { requireAll = true } = {}) {
  const source = Array.isArray(rows) ? rows : [];
  const active = source.filter((row) => (
    String(row?.rarity ?? "").trim()
    || String(row?.filterParameterType ?? "").trim()
    || String(row?.limitBreak ?? "").trim()
  ));
  if (!active.length) return [];
  if (requireAll && active.length !== EXAM_SUPPORT_CARD_COUNT) {
    throw new Error(`サポートカードは${EXAM_SUPPORT_CARD_COUNT}枚すべて入力してください（現在${active.length}枚）。`);
  }

  return active.map((row, index) => {
    const slot = Number(row?.slot ?? index + 1);
    const rarity = String(row?.rarity ?? "").toUpperCase();
    if (!RARITIES.has(rarity)) throw new Error(`サポート${slot}: レアリティを選択してください。`);
    const filterParameterType = String(row?.filterParameterType ?? "");
    if (!PARAMETER_TYPES.has(filterParameterType)) {
      throw new Error(`サポート${slot}: 対象レッスン属性を選択してください。`);
    }
    const limitBreakText = String(row?.limitBreak ?? "").trim();
    if (limitBreakText === "") throw new Error(`サポート${slot}: 上限解放を選択してください。`);
    const limitBreak = Number(limitBreakText);
    if (!Number.isInteger(limitBreak) || limitBreak < 0 || limitBreak > 4) {
      throw new Error(`サポート${slot}: 上限解放は無凸～4凸で選択してください。`);
    }
    const bonusPercent = supportCardRateBonusPercent(rarity, limitBreak);
    const basePercent = defaultSupportUpgradePercent(rarity, filterParameterType);
    const produceCardUpgradePermil = effectiveSupportUpgradePermil(rarity, filterParameterType, limitBreak);
    if (bonusPercent === null || basePercent === null || produceCardUpgradePermil === null) {
      throw new Error(`サポート${slot}: スキルカード強化率を計算できません。`);
    }
    return {
      supportCardId: String(row?.supportCardId ?? `manual-support-${slot}`),
      rarity,
      filterParameterType,
      limitBreak,
      skillCardSupportRateBonusPercent: bonusPercent,
      baseProduceCardUpgradePermil: Math.round(basePercent * 10),
      cardSearchId: SUPPORT_CARD_HAND_SEARCH_ID,
      produceCardUpgradePermil,
    };
  });
}

export function parseExamTurnParameterTypes(input) {
  const values = Array.isArray(input)
    ? input
    : String(input ?? "").split(/[\s,、/／→>]+/);
  return values.map((value) => String(value ?? "").trim()).filter(Boolean).map((value, index) => {
    const normalized = value.toLowerCase();
    if (["vo", "vocal", "ボーカル"].includes(normalized)) return "Vocal";
    if (["da", "dance", "ダンス"].includes(normalized)) return "Dance";
    if (["vi", "visual", "ビジュアル"].includes(normalized)) return "Visual";
    throw new Error(`ターン${index + 1}の属性「${value}」を認識できません。Vo、Da、Viで入力してください。`);
  });
}

export function formatExamTurnParameterTypes(values) {
  const short = { Vocal: "Vo", Dance: "Da", Visual: "Vi" };
  return parseExamTurnParameterTypes(values).map((value) => short[value]).join(", ");
}
