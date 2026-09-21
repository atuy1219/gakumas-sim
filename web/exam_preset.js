import { EXAM_CARD_POOL_MODE } from "./exam_setup.js";

export const EXAM_PRESET_FORMAT = "gakumas-sim-exam-preset";
export const EXAM_PRESET_VERSION = 4;

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}がありません。`);
  return text;
}

function normalizePoolMode(value) {
  const mode = String(value ?? "");
  return Object.values(EXAM_CARD_POOL_MODE).includes(mode)
    ? mode
    : EXAM_CARD_POOL_MODE.NORMAL;
}

function normalizeCards(cards) {
  const grouped = new Map();
  for (const source of cards ?? []) {
    const id = requiredText(source?.id, "カードID");
    const count = Math.trunc(Number(source?.count ?? 0));
    if (!Number.isInteger(count) || count < 1) throw new Error(`${id}: カード枚数が不正です。`);
    grouped.set(id, (grouped.get(id) ?? 0) + count);
  }
  if (!grouped.size) throw new Error("カードが1枚もありません。");
  return [...grouped].map(([id, count]) => ({ id, count }));
}

function normalizeCustomizes(customizes) {
  const counts = new Map();
  for (const item of customizes ?? []) {
    const id = String(item?.id ?? item ?? "").trim();
    if (!id) continue;
    const count = Math.max(1, Math.trunc(Number(item?.customizeCount ?? 1) || 1));
    counts.set(id, (counts.get(id) ?? 0) + count);
  }
  return [...counts].map(([id, customizeCount]) => ({ id, customizeCount }));
}

function normalizeManualCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error(`manualCards[${index}] がカードオブジェクトではありません。`);
    }
    return {
      id: requiredText(source.id ?? source.produceCardId, "manualCardsのカードID"),
      upgradeCount: Number(source.upgradeCount ?? 0) > 0 ? 1 : 0,
      customizes: normalizeCustomizes(source.customizes),
    };
  });
}

function normalizeProgressCards(cards) {
  if (!Array.isArray(cards) || !cards.length) return [];
  return cards.map((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error(`progressCards[${index}] がカードオブジェクトではありません。`);
    }
    const id = requiredText(source.produceCardId ?? source.ProduceCardId ?? source.id ?? source.Id, "progressCardsのカードID");
    const number = Number(source.number ?? source.Number);
    if (!Number.isFinite(number)) throw new Error(`${id}: progressCardsのNumberが不正です。`);
    return { ...source };
  });
}

export function createExamPreset({
  characterId,
  planType,
  idolCardId,
  cardPoolMode = EXAM_CARD_POOL_MODE.NORMAL,
  cards,
  manualCards = [],
  progressCards = [],
  stamina = 0,
  targetScore = 0,
}) {
  return {
    format: EXAM_PRESET_FORMAT,
    version: EXAM_PRESET_VERSION,
    exportedAt: new Date().toISOString(),
    characterId: requiredText(characterId, "キャラクター"),
    planType: requiredText(planType, "プラン"),
    idolCardId: requiredText(idolCardId, "Pアイドル"),
    cardPoolMode: normalizePoolMode(cardPoolMode),
    cards: normalizeCards(cards),
    manualCards: normalizeManualCards(manualCards),
    progressCards: normalizeProgressCards(progressCards),
    stamina: Math.max(0, Math.trunc(Number(stamina) || 0)),
    targetScore: Math.max(0, Math.trunc(Number(targetScore) || 0)),
  };
}

export function parseExamPreset(input) {
  let source;
  try {
    source = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new Error("試験・オーディション編成JSONを読み込めませんでした。");
  }
  if (!source || source.format !== EXAM_PRESET_FORMAT) throw new Error("試験・オーディション編成ファイルではありません。");
  const version = Number(source.version);
  if (![1, 2, 3, EXAM_PRESET_VERSION].includes(version)) throw new Error(`未対応の編成バージョンです: ${source.version}`);
  return createExamPreset({
    ...source,
    cardPoolMode: version === 1 ? EXAM_CARD_POOL_MODE.NORMAL : source.cardPoolMode,
    manualCards: version >= 4 ? source.manualCards : [],
    progressCards: version >= 3 ? source.progressCards : [],
  });
}
