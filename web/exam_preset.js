export const EXAM_PRESET_FORMAT = "gakumas-sim-exam-preset";
export const EXAM_PRESET_VERSION = 1;

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}がありません。`);
  return text;
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

export function createExamPreset({ characterId, planType, idolCardId, cards }) {
  return {
    format: EXAM_PRESET_FORMAT,
    version: EXAM_PRESET_VERSION,
    exportedAt: new Date().toISOString(),
    characterId: requiredText(characterId, "キャラクター"),
    planType: requiredText(planType, "プラン"),
    idolCardId: requiredText(idolCardId, "Pアイドル"),
    cards: normalizeCards(cards),
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
  if (Number(source.version) !== EXAM_PRESET_VERSION) throw new Error(`未対応の編成バージョンです: ${source.version}`);
  return createExamPreset(source);
}
