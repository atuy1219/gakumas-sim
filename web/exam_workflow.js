import { normalizeCustomizes } from "./memory_judgement.js";

export const EXAM_WORKFLOW_STORAGE_KEY = "gakumas-sim-exam-workflow-v1";
export const EXAM_WORKFLOW_VERSION = 1;
export const EXAM_CARD_PAGE_SIZE = 10;

export const EXAM_PRE_SHUFFLE_MODE = Object.freeze({
  IMPORT: "import",
  MANUAL: "manual",
});

export function normalizeExamPreShuffleMode(value) {
  return String(value ?? "") === EXAM_PRE_SHUFFLE_MODE.IMPORT
    ? EXAM_PRE_SHUFFLE_MODE.IMPORT
    : EXAM_PRE_SHUFFLE_MODE.MANUAL;
}

function normalizedCard(card = {}) {
  return {
    id: String(card?.id ?? card?.produceCardId ?? "").trim(),
    upgradeCount: Math.max(0, Math.trunc(Number(card?.upgradeCount ?? 0) || 0)),
    customizes: normalizeCustomizes(card?.customizes),
  };
}

function customizeSignature(customizes) {
  return normalizeCustomizes(customizes)
    .map((item) => `${String(item.id)}@${Number(item.customizeCount ?? 1)}`)
    .sort()
    .join("|");
}

function exactSignature(card) {
  const normalized = normalizedCard(card);
  return `${normalized.id}@@${normalized.upgradeCount}@@${customizeSignature(normalized.customizes)}`;
}

export function serializeExamPreShuffleOrder(deck = []) {
  return (deck ?? []).map((card) => normalizedCard(card));
}

export function applyExamPreShuffleOrder(baseDeck = [], desiredOrder = []) {
  const base = (baseDeck ?? []).map((card) => ({ ...card, customizes: normalizeCustomizes(card?.customizes) }));
  const desired = (desiredOrder ?? []).map((card) => normalizedCard(card));
  if (!base.length) throw new Error("編成カードがありません。");
  if (desired.length !== base.length) {
    throw new Error(`シャッフル前順の枚数が編成と一致しません（編成${base.length}枚 / 順番${desired.length}枚）。`);
  }

  const byExact = new Map();
  const byId = new Map();
  base.forEach((card, index) => {
    const exact = exactSignature(card);
    if (!byExact.has(exact)) byExact.set(exact, []);
    byExact.get(exact).push(index);
    const id = String(card.id);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(index);
  });

  const used = new Set();
  const take = (queue = []) => {
    while (queue.length && used.has(queue[0])) queue.shift();
    return queue.shift();
  };

  const ordered = [];
  for (const target of desired) {
    if (!target.id) throw new Error("シャッフル前順にカードIDがない項目があります。");
    let index = take(byExact.get(exactSignature(target)));
    if (index === undefined) index = take(byId.get(target.id));
    if (index === undefined) {
      throw new Error(`シャッフル前順の ${target.id} が編成内の枚数を超えています。`);
    }
    used.add(index);
    ordered.push({ ...base[index], customizes: normalizeCustomizes(base[index]?.customizes) });
  }

  if (used.size !== base.length) throw new Error("シャッフル前順に含まれていない編成カードがあります。");
  return ordered;
}

export function applyProgressNumberOrder(baseDeck = [], progressCards = []) {
  const orderedProgress = [...(progressCards ?? [])]
    .filter((card) => !card?.deleted)
    .sort((a, b) => Number(a?.number ?? 0) - Number(b?.number ?? 0)
      || Number(a?.progressSourceIndex ?? 0) - Number(b?.progressSourceIndex ?? 0));
  if (!orderedProgress.length) throw new Error("Number付きの有効なproduceCardsがありません。");
  return applyExamPreShuffleOrder(baseDeck, orderedProgress);
}

export function createExamWorkflowSnapshot(input = {}) {
  const counts = Array.isArray(input.counts)
    ? input.counts.map(([id, count]) => [String(id), Math.max(0, Math.trunc(Number(count) || 0))]).filter(([, count]) => count > 0)
    : [];
  const manualCards = Array.isArray(input.manualCards)
    ? input.manualCards.map((card) => normalizedCard(card))
    : [];
  const supportDrafts = Array.isArray(input.supportDrafts)
    ? input.supportDrafts.map((row, index) => ({
        slot: Number(row?.slot ?? index + 1),
        supportCardId: String(row?.supportCardId ?? `manual-support-${index + 1}`),
        rarity: String(row?.rarity ?? ""),
        filterParameterType: String(row?.filterParameterType ?? ""),
        limitBreak: String(row?.limitBreak ?? ""),
      }))
    : [];
  const observedBatches = Array.isArray(input.observedBatches)
    ? input.observedBatches.map((batch) => Array.isArray(batch) ? batch.map(String) : [])
    : [[]];

  return {
    version: EXAM_WORKFLOW_VERSION,
    savedAt: new Date().toISOString(),
    stage: ["setup", "order", "seed", "simulation"].includes(String(input.stage)) ? String(input.stage) : "setup",
    characterId: String(input.characterId ?? ""),
    planType: String(input.planType ?? ""),
    idolCardId: String(input.idolCardId ?? ""),
    cardPoolMode: String(input.cardPoolMode ?? "normal"),
    turnStageId: String(input.turnStageId ?? ""),
    lessonParameterType: String(input.lessonParameterType ?? ""),
    stamina: Math.max(0, Math.trunc(Number(input.stamina) || 0)),
    targetScore: Math.max(0, Math.trunc(Number(input.targetScore) || 0)),
    counts,
    manualCards,
    supportDrafts,
    preShuffleMode: normalizeExamPreShuffleMode(input.preShuffleMode),
    preShuffleOrder: serializeExamPreShuffleOrder(input.preShuffleOrder),
    progressCards: Array.isArray(input.progressCards) ? input.progressCards.map((card) => ({ ...card })) : [],
    progressPath: String(input.progressPath ?? ""),
    observedBatches,
    seed: String(input.seed ?? ""),
  };
}

export function parseExamWorkflowSnapshot(input) {
  let source;
  try {
    source = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new Error("保存済みの試験進行状況を読み込めませんでした。");
  }
  if (!source || Number(source.version) !== EXAM_WORKFLOW_VERSION) {
    throw new Error("保存済みの試験進行状況のバージョンが不明です。");
  }
  return createExamWorkflowSnapshot(source);
}
