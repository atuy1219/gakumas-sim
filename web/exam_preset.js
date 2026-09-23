import { EXAM_CARD_POOL_MODE } from "./exam_setup.js";
import { parseExamTurnParameterTypes } from "./exam_support_cards.js";
import { normalizeExamPreShuffleMode, serializeExamPreShuffleOrder } from "./exam_workflow.js";

export const EXAM_PRESET_FORMAT = "gakumas-sim-exam-preset";
export const EXAM_PRESET_VERSION = 11;

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

function normalizeCards(cards, { allowEmpty = false } = {}) {
  const grouped = new Map();
  for (const source of cards ?? []) {
    const id = requiredText(source?.id ?? source?.produceCardId, "カードID");
    const count = Math.trunc(Number(source?.count ?? 1));
    if (!Number.isInteger(count) || count < 1) throw new Error(`${id}: カード枚数が不正です。`);
    grouped.set(id, (grouped.get(id) ?? 0) + count);
  }
  if (!grouped.size && !allowEmpty) throw new Error("カードが1枚もありません。");
  return [...grouped].map(([id, count]) => ({ id, count }));
}

function cardsFromInstances(cards) {
  return normalizeCards((cards ?? []).map((source) => ({
    id: source?.id ?? source?.produceCardId ?? source?.ProduceCardId,
    count: 1,
  })), { allowEmpty: true });
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

function normalizeSupportCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map((source, index) => {
    const supportCardId = requiredText(source?.supportCardId ?? source?.id, `supportCards[${index}]のID`);
    const produceCardUpgradePermil = Math.max(0, Math.trunc(Number(source?.produceCardUpgradePermil ?? 0) || 0));
    const limitBreakText = String(source?.limitBreak ?? "").trim();
    const rawLimitBreak = limitBreakText === "" ? NaN : Number(limitBreakText);
    const limitBreak = Number.isInteger(rawLimitBreak) && rawLimitBreak >= 0 && rawLimitBreak <= 4
      ? rawLimitBreak
      : null;
    return {
      supportCardId,
      rarity: String(source?.rarity ?? "").toUpperCase(),
      filterParameterType: String(source?.filterParameterType ?? ""),
      cardSearchId: String(source?.cardSearchId ?? source?.produceCardSearchId ?? "p_card_search-hand"),
      produceCardUpgradePermil,
      ...(limitBreak === null ? {} : { limitBreak }),
    };
  });
}

export function createExamPreset({
  source = "web",
  exportedAt = "",
  capturedAtUnixMs = 0,
  packageName = "",
  libil2cppBuildId = "",
  characterId,
  planType,
  idolCardId,
  cardPoolMode = EXAM_CARD_POOL_MODE.NORMAL,
  cards,
  manualCards = [],
  progressCards = [],
  supportCards = [],
  preShuffleMode = "manual",
  preShuffleOrder = [],
  turnStageId = "",
  lessonParameterType = "",
  turnParameterTypes = [],
  stamina = 0,
  targetScore = 0,
  seed = "",
}, { allowPartial = false } = {}) {
  const normalizedManualCards = normalizeManualCards(manualCards);
  const normalizedProgressCards = normalizeProgressCards(progressCards);
  const normalizedCards = normalizeCards(
    Array.isArray(cards)
      ? cards
      : cardsFromInstances(normalizedManualCards.length ? normalizedManualCards : normalizedProgressCards),
    { allowEmpty: allowPartial },
  );
  const textOrRequired = (value, label) => allowPartial
    ? String(value ?? "").trim()
    : requiredText(value, label);
  return {
    format: EXAM_PRESET_FORMAT,
    version: EXAM_PRESET_VERSION,
    source: String(source ?? "web"),
    exportedAt: String(exportedAt || new Date().toISOString()),
    capturedAtUnixMs: Math.max(0, Math.trunc(Number(capturedAtUnixMs) || 0)),
    packageName: String(packageName ?? ""),
    libil2cppBuildId: String(libil2cppBuildId ?? ""),
    characterId: textOrRequired(characterId, "キャラクター"),
    planType: textOrRequired(planType, "プラン"),
    idolCardId: textOrRequired(idolCardId, "Pアイドル"),
    cardPoolMode: normalizePoolMode(cardPoolMode),
    cards: normalizedCards,
    manualCards: normalizedManualCards,
    progressCards: normalizedProgressCards,
    supportCards: normalizeSupportCards(supportCards),
    preShuffleMode: normalizeExamPreShuffleMode(preShuffleMode),
    preShuffleOrder: serializeExamPreShuffleOrder(preShuffleOrder),
    turnStageId: String(turnStageId ?? "").trim(),
    lessonParameterType: ["Vocal", "Dance", "Visual"].includes(String(lessonParameterType ?? ""))
      ? String(lessonParameterType)
      : "",
    // Retained only so older files remain readable. New UI derives this from
    // the selected exam/lesson and Seed.
    turnParameterTypes: parseExamTurnParameterTypes(turnParameterTypes),
    stamina: Math.max(0, Math.trunc(Number(stamina) || 0)),
    targetScore: Math.max(0, Math.trunc(Number(targetScore) || 0)),
    seed: String(seed ?? "").trim(),
  };
}

export function parseExamPreset(input) {
  let source;
  try {
    source = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new Error("試験・オーディション編成JSONを読み込めませんでした。");
  }

  // Legacy LSPosed capture files are upgraded in-memory to the unified preset
  // schema so old exports remain directly importable.
  if (source?.format === "gakumas-sim-progress-capture") {
    const progressCards = Array.isArray(source.produceCards) ? source.produceCards : [];
    const manualCards = progressCards
      .filter((card) => !card?.deleted)
      .sort((a, b) => Number(a?.number ?? 0) - Number(b?.number ?? 0))
      .map((card) => ({
        id: card?.produceCardId ?? card?.id,
        upgradeCount: card?.upgradeCount ?? 0,
        customizes: card?.customizes ?? [],
      }));
    return createExamPreset({
      source: "lsposed-legacy",
      capturedAtUnixMs: source.capturedAtUnixMs,
      packageName: source.packageName,
      libil2cppBuildId: source.libil2cppBuildId,
      cards: cardsFromInstances(manualCards),
      manualCards,
      progressCards,
      preShuffleMode: "manual",
      preShuffleOrder: manualCards,
      seed: source.seed ?? "",
    }, { allowPartial: true });
  }

  if (!source || source.format !== EXAM_PRESET_FORMAT) throw new Error("試験・オーディション編成ファイルではありません。");
  const version = Number(source.version);
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, EXAM_PRESET_VERSION].includes(version)) {
    throw new Error(`未対応の編成バージョンです: ${source.version}`);
  }
  const allowPartial = version >= 11 && String(source.source ?? "").startsWith("lsposed");
  return createExamPreset({
    ...source,
    source: version >= 11 ? source.source : "web-legacy",
    cardPoolMode: version === 1 ? EXAM_CARD_POOL_MODE.NORMAL : source.cardPoolMode,
    manualCards: version >= 4 ? source.manualCards : [],
    progressCards: version >= 3 ? source.progressCards : [],
    supportCards: version >= 5 ? source.supportCards : [],
    preShuffleMode: version >= 10 ? source.preShuffleMode : "manual",
    preShuffleOrder: version >= 10 ? source.preShuffleOrder : [],
    turnStageId: version >= 8 ? source.turnStageId : "",
    lessonParameterType: version >= 9 ? source.lessonParameterType : "",
    turnParameterTypes: version >= 6 ? source.turnParameterTypes : [],
    seed: version >= 11 ? source.seed : "",
  }, { allowPartial });
}
