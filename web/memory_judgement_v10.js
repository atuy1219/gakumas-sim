function scalar(raw) {
  const text = String(raw ?? "").trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  return text;
}

function records(text) {
  return String(text ?? "").split(/(?=^- id:\s)/m).filter((part) => /^- id:\s/m.test(part));
}

function field(record, name) {
  const match = record.match(new RegExp(`^  ${name}:\\s*(.*?)\\s*$`, "m"));
  return match ? scalar(match[1]) : undefined;
}

function listField(record, name) {
  const lines = record.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) return [];
  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^  -\s+(.*?)\s*$/);
    if (!match) break;
    values.push(String(scalar(match[1])));
  }
  return values;
}

export function parseCardMemoryRules(text) {
  const result = new Map();
  for (const record of records(text)) {
    const id = String(record.match(/^- id:\s*(.*?)\s*$/m)?.[1] ?? "");
    if (!id) continue;
    const upgradeCount = Number(field(record, "upgradeCount") ?? 0);
    const current = result.get(id) ?? { id, variants: new Map(), customizeIds: [], maxCustomizeCount: 0 };
    current.variants.set(upgradeCount, {
      evaluation: Number(field(record, "evaluation") ?? 0),
      rarity: String(field(record, "rarity") ?? ""),
      name: String(field(record, "name") ?? id),
    });
    const customizeIds = listField(record, "produceCardCustomizeIds");
    if (customizeIds.length) current.customizeIds = customizeIds;
    current.maxCustomizeCount = Math.max(current.maxCustomizeCount, Number(field(record, "maxCustomizeCount") ?? 0));
    result.set(id, current);
  }
  return result;
}

export function parseCustomizeCatalog(text) {
  const result = new Map();
  for (const record of records(text)) {
    const id = String(record.match(/^- id:\s*(.*?)\s*$/m)?.[1] ?? "");
    const customizeCount = Number(field(record, "customizeCount") ?? 0);
    if (!id || customizeCount < 1) continue;
    const current = result.get(id) ?? { id, levels: new Map() };
    current.levels.set(customizeCount, {
      id,
      customizeCount,
      description: String(field(record, "description") ?? ""),
      overwriteType: String(field(record, "overwriteProduceCardGrowEffectType") ?? ""),
      growEffectIds: listField(record, "produceCardGrowEffectIds"),
      producePoint: Number(field(record, "producePoint") ?? 0),
    });
    result.set(id, current);
  }
  return result;
}

export function parseGrowEffectCatalog(text) {
  const result = new Map();
  for (const record of records(text)) {
    const id = String(record.match(/^- id:\s*(.*?)\s*$/m)?.[1] ?? "");
    if (!id) continue;
    result.set(id, {
      id,
      effectType: String(field(record, "effectType") ?? ""),
      costType: String(field(record, "costType") ?? ""),
      value: Number(field(record, "value") ?? 0),
      playEffectId: String(field(record, "playProduceExamEffectId") ?? ""),
      statusEnchantId: String(field(record, "produceCardStatusEnchantId") ?? ""),
      movePositionType: String(field(record, "playMovePositionType") ?? ""),
    });
  }
  return result;
}

export function parseCustomizeRarityEvaluations(text) {
  const result = new Map();
  let rarity = null;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    let match = line.match(/^- rarity:\s*(.*?)\s*$/);
    if (match) rarity = String(scalar(match[1]));
    match = line.match(/^  evaluation:\s*(-?\d+)\s*$/);
    if (match && rarity) result.set(rarity, Number(match[1]));
  }
  return result;
}

const EFFECT_LABELS = Object.freeze({
  AggressiveAdd: "やる気", BlockAdd: "元気", CostReduce: "消費体力", CostPenetrateReduce: "固定体力消費",
  LessonAdd: "パラメータ", LessonBuffAdd: "集中", ReviewAdd: "好印象", ParameterBuffTurnAdd: "好調ターン",
  StaminaConsumptionDownTurnAdd: "消費体力減少ターン", LessonCountAdd: "効果回数", InitialAdd: "初期手札",
  EffectAdd: "効果追加", PlayMovePositionChange: "使用後の移動先", CardStatusEnchantChange: "カード状態効果",
});

export function describeGrowEffect(effect) {
  if (!effect) return "内容不明";
  const type = String(effect.effectType ?? "").replace(/^ProduceCardGrowEffectType_/, "");
  const label = EFFECT_LABELS[type] ?? (type.replace(/([a-z])([A-Z])/g, "$1 $2") || "効果");
  if (type === "InitialAdd") return "初期手札に追加";
  if (type === "EffectAdd") return effect.playEffectId ? `効果追加 (${effect.playEffectId})` : "効果追加";
  if (type === "PlayMovePositionChange") return `使用後: ${String(effect.movePositionType).replace(/^ProduceCardMovePositionType_/, "")}`;
  const value = Number(effect.value ?? 0);
  return value ? `${label} ${value > 0 ? "+" : ""}${value}` : label;
}

export function describeCustomize(customizeId, count, customizeById, growEffectById) {
  const route = customizeById.get(String(customizeId));
  const level = route?.levels.get(Number(count));
  if (!level) return { label: "未定義のカスタマイズ", producePoint: 0, valid: false };
  const effects = level.growEffectIds.map((id) => describeGrowEffect(growEffectById.get(id)));
  return {
    label: level.description || effects.join(" / ") || String(customizeId),
    producePoint: level.producePoint,
    valid: true,
    effects,
  };
}

export function normalizeCustomizes(customizes) {
  const counts = new Map();
  for (const item of customizes ?? []) {
    const id = String(item?.id ?? item ?? "").trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + Math.max(1, Number(item?.customizeCount ?? 1)));
  }
  return [...counts].map(([id, customizeCount]) => ({ id, customizeCount }));
}

export function judgeCardCustomization(card, rule, customizeById, growEffectById, rarityEvaluationById) {
  const customizes = normalizeCustomizes(card?.customizes);
  const reasons = [];
  const details = [];
  const upgradeCount = Number(card?.upgradeCount ?? 0);
  const variant = rule?.variants.get(upgradeCount) ?? rule?.variants.get(Math.min(1, upgradeCount));
  const baseEvaluation = Number(variant?.evaluation ?? 0);
  const rarity = String(variant?.rarity ?? "");
  const unitEvaluation = Number(rarityEvaluationById.get(rarity) ?? 0);
  const totalCount = customizes.reduce((sum, item) => sum + Number(item.customizeCount), 0);
  if (customizes.length && upgradeCount < 1) reasons.push("カスタマイズには強化済みカードが必要です");
  if (totalCount > Number(rule?.maxCustomizeCount ?? 0)) reasons.push(`カスタマイズ上限${Number(rule?.maxCustomizeCount ?? 0)}回を超えています`);
  for (const item of customizes) {
    if (!rule?.customizeIds.includes(item.id)) {
      reasons.push("このカードでは選べないカスタマイズです");
      continue;
    }
    const described = describeCustomize(item.id, item.customizeCount, customizeById, growEffectById);
    if (!described.valid) reasons.push(`${item.customizeCount}段階目の定義がありません`);
    details.push({ ...item, ...described });
  }
  const customizeEvaluation = totalCount * unitEvaluation;
  return {
    valid: reasons.length === 0,
    reasons,
    details,
    baseEvaluation,
    customizeEvaluation,
    totalEvaluation: baseEvaluation + customizeEvaluation,
    totalCount,
    maxCustomizeCount: Number(rule?.maxCustomizeCount ?? 0),
    rarity,
  };
}

export function scoreTargetJudgement(score, target) {
  const current = Math.max(0, Number(score ?? 0));
  const threshold = Math.max(0, Number(target ?? 0));
  return {
    score: current,
    target: threshold,
    remaining: Math.max(0, threshold - current),
    achieved: threshold > 0 && current >= threshold,
    ratio: threshold > 0 ? current / threshold : null,
  };
}
