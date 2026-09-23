export const EXAM_SUPPORT_CARD_COUNT = 6;
export const SUPPORT_CARD_HAND_SEARCH_ID = "p_card_search-hand";

const RARITIES = new Set(["R", "SR", "SSR"]);
const PARAMETER_TYPES = new Set([
  "ProduceParameterType_Vocal",
  "ProduceParameterType_Dance",
  "ProduceParameterType_Visual",
  "ProduceParameterType_Unknown",
]);

export function defaultSupportUpgradePercent(rarityInput, parameterTypeInput) {
  const rarity = String(rarityInput ?? "").toUpperCase();
  const allParameters = String(parameterTypeInput ?? "").endsWith("_Unknown");
  if (rarity === "R") return 1.9;
  if (rarity === "SR") return allParameters ? 1.5 : 2.8;
  if (rarity === "SSR") return allParameters ? 2.0 : 3.7;
  return null;
}

export function normalizeManualSupportCards(rows, { requireAll = true } = {}) {
  const source = Array.isArray(rows) ? rows : [];
  const active = source.filter((row) => (
    String(row?.rarity ?? "").trim()
    || String(row?.filterParameterType ?? "").trim()
    || String(row?.upgradePercent ?? "").trim()
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
    if (String(row?.upgradePercent ?? "").trim() === "") {
      throw new Error(`サポート${slot}: 強化確率を入力してください。`);
    }
    const percent = Number(row.upgradePercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error(`サポート${slot}: 強化確率は0～100%で入力してください。`);
    }
    return {
      supportCardId: String(row?.supportCardId ?? `manual-support-${slot}`),
      rarity,
      filterParameterType,
      cardSearchId: SUPPORT_CARD_HAND_SEARCH_ID,
      produceCardUpgradePermil: Math.round(percent * 10),
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
