export const EXAM_ITEM_URLS = Object.freeze({
  itemsPrimary: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceItem.yaml",
  itemsFallback: "https://raw.githubusercontent.com/zliu-aki/simple_gakuen_idolmaster/main/yaml/ProduceItem.yaml",
  itemEffectsPrimary: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceItemEffect.yaml",
  itemEffectsFallback: "https://raw.githubusercontent.com/zliu-aki/simple_gakuen_idolmaster/main/yaml/ProduceItemEffect.yaml",
});

function yamlScalar(raw) {
  const text = String(raw ?? "").trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    try {
      if (text.startsWith('"')) return JSON.parse(text);
    } catch {}
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

export function parseYamlRecordsWithLists(text, scalarFields = [], listFields = []) {
  const wantedScalars = new Set(["id", ...scalarFields]);
  const wantedLists = new Set(listFields);
  const records = [];
  let current = null;
  let activeList = null;
  const flush = () => {
    if (current?.id) records.push(current);
  };

  for (const line of String(text ?? "").split(/\r?\n/)) {
    let match = line.match(/^- id:\s*(.*?)\s*$/);
    if (match) {
      flush();
      current = { id: String(yamlScalar(match[1])) };
      activeList = null;
      continue;
    }
    if (!current) continue;

    match = line.match(/^  ([A-Za-z][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (match) {
      const [_, field, raw] = match;
      if (wantedLists.has(field)) {
        current[field] = raw === "[]" ? [] : [];
        activeList = field;
      } else {
        activeList = null;
        if (wantedScalars.has(field)) current[field] = yamlScalar(raw);
      }
      continue;
    }

    match = line.match(/^  -\s*(.*?)\s*$/);
    if (match && activeList) current[activeList].push(yamlScalar(match[1]));
  }
  flush();
  return records;
}

export function parseProduceItemCatalogForExam(text) {
  return parseYamlRecordsWithLists(
    text,
    ["name", "planType", "rarity", "assetId", "isUpgraded", "libraryHidden", "order"],
    ["produceItemEffectIds"],
  ).filter((item) => item.libraryHidden !== true);
}

export function parseProduceItemEffectCatalog(text) {
  return parseYamlRecordsWithLists(text, [
    "effectType",
    "effectTurn",
    "effectCount",
    "produceEffectId",
    "produceExamStatusEnchantId",
  ]);
}

async function fetchText(primary, fallback, fetchImpl) {
  try {
    const response = await fetchImpl(primary);
    if (response.ok) {
      const text = await response.text();
      if (text.trim()) return text;
    }
  } catch {}
  const response = await fetchImpl(fallback);
  if (!response.ok) throw new Error(`Pアイテム効果マスタを取得できません (${response.status})。`);
  const text = await response.text();
  if (!text.trim()) throw new Error("Pアイテム効果マスタが空です。");
  return text;
}

export async function loadExamItemCatalogs(fetchImpl = globalThis.fetch, urls = EXAM_ITEM_URLS) {
  if (typeof fetchImpl !== "function") throw new Error("Pアイテム効果マスタを取得する fetch がありません。");
  const [itemText, effectText] = await Promise.all([
    fetchText(urls.itemsPrimary, urls.itemsFallback, fetchImpl),
    fetchText(urls.itemEffectsPrimary, urls.itemEffectsFallback, fetchImpl),
  ]);
  const items = parseProduceItemCatalogForExam(itemText);
  const itemEffects = parseProduceItemEffectCatalog(effectText);
  return {
    items,
    itemById: new Map(items.map((item) => [String(item.id), item])),
    itemEffects,
    itemEffectById: new Map(itemEffects.map((effect) => [String(effect.id), effect])),
  };
}

export function resolveProduceItems(itemIds, itemById = new Map(), itemEffectById = new Map()) {
  const resolved = [];
  const unresolved = [];
  for (const rawId of itemIds ?? []) {
    const id = String(rawId);
    const item = itemById.get(id);
    if (!item) {
      unresolved.push(id);
      resolved.push({ id, name: id, effects: [], unresolved: true });
      continue;
    }
    const effects = (item.produceItemEffectIds ?? []).map((effectId) => {
      const effect = itemEffectById.get(String(effectId));
      return effect ? { ...effect } : { id: String(effectId), unresolved: true };
    });
    resolved.push({ ...item, id, effects });
  }
  return { items: resolved, unresolved };
}

function integer(value) {
  return Number.parseInt(String(value), 10);
}

export function parseExamEffectId(effectId) {
  const id = String(effectId ?? "").trim();
  if (!id) return { kind: "none", id };
  let match;
  if ((match = id.match(/^e_effect-exam_lesson-(\d+)-(\d+)$/))) {
    return { kind: "lesson", id, value: integer(match[1]), count: integer(match[2]) };
  }
  if ((match = id.match(/^e_effect-exam_lesson_add_multiple_parameter_buff-(\d+)-(\d+)-(\d+)$/))) {
    return {
      kind: "lesson_add_multiple_parameter_buff",
      id,
      value: integer(match[1]),
      permil: integer(match[2]),
      count: integer(match[3]),
    };
  }
  if ((match = id.match(/^e_effect-exam_lesson_depend_parameter_buff-(\d+)-(\d+)$/))) {
    return { kind: "lesson_depend_parameter_buff", id, permil: integer(match[1]), count: integer(match[2]) };
  }
  if ((match = id.match(/^e_effect-exam_effect_timer-(\d+)-(\d+)-(e_effect-.+)$/))) {
    return {
      kind: "effect_timer",
      id,
      turn: integer(match[1]),
      count: integer(match[2]),
      child: parseExamEffectId(match[3]),
    };
  }
  if ((match = id.match(/^e_effect-exam_card_search_effect_play_count_buff-(\d+)-(\d+)-(inf|\d+)-(.+)-all-0_0$/))) {
    return {
      kind: "card_search_effect_play_count_buff",
      id,
      value: integer(match[1]),
      count: integer(match[2]),
      turn: match[3] === "inf" ? -1 : integer(match[3]),
      searchId: match[4],
    };
  }
  if (id === "e_effect-exam_hand_grave_count_card_draw") {
    return { kind: "hand_grave_count_card_draw", id };
  }
  if (id === "e_effect-exam_card_upgrade-p_card_search-hand-all-0_0") {
    return { kind: "card_upgrade_hand_all", id };
  }
  if ((match = id.match(/^e_effect-exam_parameter_buff_multiple_per_turn-(\d+)$/))) {
    return { kind: "parameter_buff_multiple_per_turn", id, turn: integer(match[1]) };
  }
  if (id === "e_effect-exam_status_enchant-inf-enchant-p_card-01-men-3_035-enc01") {
    return {
      kind: "status_enchant",
      id,
      turn: -1,
      enchantId: "enchant-p_card-01-men-3_035-enc01",
      trigger: { phase: "end_turn", field: "lessonBuff", min: 3 },
      effects: [parseExamEffectId("e_effect-exam_lesson_buff-0002")],
    };
  }
  if (id === "e_effect-exam_status_enchant-inf-enchant-p_card-01-act-3_049-enc02") {
    return {
      kind: "status_enchant",
      id,
      turn: -1,
      enchantId: "enchant-p_card-01-act-3_049-enc02",
      trigger: { phase: "card_play", category: "ProduceCardCategory_ActiveSkill" },
      effects: [parseExamEffectId("e_effect-exam_lesson-0005-01")],
    };
  }
  if ((match = id.match(/^e_effect-exam_block-(\d+)$/))) {
    return { kind: "block", id, value: integer(match[1]) };
  }
  if ((match = id.match(/^e_effect-exam_review-(\d+)$/))) {
    return { kind: "review", id, value: integer(match[1]) };
  }
  if ((match = id.match(/^e_effect-exam_card_play_aggressive-(\d+)$/))) {
    return { kind: "aggressive", id, value: integer(match[1]) };
  }
  if ((match = id.match(/^e_effect-exam_lesson_buff-(\d+)$/))) {
    return { kind: "lesson_buff", id, value: integer(match[1]) };
  }
  if ((match = id.match(/^e_effect-exam_parameter_buff-(\d+)$/))) {
    return { kind: "parameter_buff", id, value: integer(match[1]) };
  }
  if ((match = id.match(/^e_effect-exam_stamina_recover_fix-(\d+)$/))) {
    return { kind: "stamina_recover", id, value: integer(match[1]) };
  }
  if ((match = id.match(/^e_effect-exam_card_draw-(\d+)$/))) {
    return { kind: "card_draw", id, value: integer(match[1]) };
  }
  if ((match = id.match(/^e_effect-exam_playable_value_add-(\d+)$/))) {
    return { kind: "playable_add", id, value: integer(match[1]) };
  }
  if (/^e_effect-exam_extra_turn(?:$|-)/.test(id)) {
    return { kind: "extra_turn", id, value: 1 };
  }
  if ((match = id.match(/^e_effect-exam_stamina_consumption_down-(\d+)$/))) {
    return { kind: "stamina_consumption_down", id, value: integer(match[1]) };
  }
  if ((match = id.match(/^e_effect-exam_stamina_consumption_add-(\d+)$/))) {
    return { kind: "stamina_consumption_add", id, value: integer(match[1]) };
  }
  if ((match = id.match(/^e_effect-exam_stamina_consumption_down_fix-(\d+)-inf$/))) {
    return { kind: "stamina_consumption_down_fix", id, value: integer(match[1]) };
  }
  return { kind: "unsupported", id };
}

export function checkCardEffectTrigger(triggerId, exam) {
  const id = String(triggerId ?? "").trim();
  if (!id) return { triggered: true, supported: true };
  const checks = [];
  let recognized = false;
  let match;
  for (const pattern of [
    /card_play_aggressive_up-(\d+)/g,
    /lesson_buff_up-(\d+)/g,
    /review_up-(\d+)/g,
    /stamina_up_multiple-(\d+)/g,
  ]) {
    pattern.lastIndex = 0;
    while ((match = pattern.exec(id))) {
      recognized = true;
      const threshold = integer(match[1]);
      if (pattern.source.startsWith("card_play_aggressive")) checks.push(Number(exam.aggressive ?? 0) >= threshold);
      else if (pattern.source.startsWith("lesson_buff")) checks.push(Number(exam.lessonBuff ?? 0) >= threshold);
      else if (pattern.source.startsWith("review")) checks.push(Number(exam.review ?? 0) >= threshold);
      else {
        const stamina = Number(exam.stamina ?? 0);
        const maxStamina = Number(exam.maxStamina ?? 0);
        checks.push(maxStamina > 0 && stamina * 1000 >= maxStamina * threshold);
      }
    }
  }
  if ((match = id.match(/parameter_buff_up-(\d+)/))) {
    recognized = true;
    checks.push(Number(exam.parameterBuff ?? 0) >= integer(match[1]));
  } else if (/parameter_buff(?:$|-)/.test(id)) {
    recognized = true;
    checks.push(Number(exam.parameterBuff ?? 0) > 0);
  }
  // Plain card-play triggers do not add a condition.
  if (/^e_trigger-exam_card_play$/.test(id)) recognized = true;
  if (!recognized) return { triggered: false, supported: false, triggerId: id };
  return { triggered: checks.every(Boolean), supported: true, triggerId: id };
}

export function createExamState({ stamina = 0 } = {}) {
  const maxStamina = Math.max(0, Number(stamina) || 0);
  return {
    parameter: 0,
    stamina: maxStamina,
    maxStamina,
    block: 0,
    review: 0,
    aggressive: 0,
    lessonBuff: 0,
    parameterBuff: 0,
    parameterBuffMultiplePerTurn: 0,
    staminaConsumptionDown: 0,
    staminaConsumptionAdd: 0,
    staminaConsumptionDownFix: 0,
    cardPlayCount: 0,
    extraTurns: 0,
  };
}

function consumeStatus(exam, field, value, label) {
  const amount = Math.max(0, Number(value) || 0);
  if (Number(exam[field] ?? 0) < amount) throw new Error(`${label}が${amount}必要です。`);
  exam[field] -= amount;
}

export function payCardCost(exam, card) {
  const events = [];
  const direct = Math.max(0, Number(card.forceStamina ?? 0) || 0);
  let normal = Math.max(0, Number(card.stamina ?? 0) || 0);
  const downFix = Math.max(0, Number(exam.staminaConsumptionDownFix ?? 0) || 0);
  normal = Math.max(0, normal - downFix);
  if (Number(exam.staminaConsumptionDown ?? 0) > 0) normal = Math.max(0, normal - 1);
  if (Number(exam.staminaConsumptionAdd ?? 0) > 0) normal += 1;

  if (normal > 0) {
    const blocked = Math.min(Number(exam.block ?? 0), normal);
    exam.block -= blocked;
    exam.stamina = Math.max(0, Number(exam.stamina ?? 0) - (normal - blocked));
    events.push(`体力消費 ${normal}${blocked ? `（元気で${blocked}軽減）` : ""}`);
  }
  if (direct > 0) {
    exam.stamina = Math.max(0, Number(exam.stamina ?? 0) - direct);
    events.push(`直接体力消費 ${direct}`);
  }

  const costValue = Math.max(0, Number(card.costValue ?? 0) || 0);
  switch (String(card.costType ?? "")) {
    case "ExamCostType_ExamReview":
      consumeStatus(exam, "review", costValue, "好印象");
      if (costValue) events.push(`好印象 -${costValue}`);
      break;
    case "ExamCostType_ExamCardPlayAggressive":
      consumeStatus(exam, "aggressive", costValue, "やる気");
      if (costValue) events.push(`やる気 -${costValue}`);
      break;
    case "ExamCostType_ExamLessonBuff":
      consumeStatus(exam, "lessonBuff", costValue, "集中");
      if (costValue) events.push(`集中 -${costValue}`);
      break;
    case "ExamCostType_ExamParameterBuff":
      consumeStatus(exam, "parameterBuff", costValue, "好調");
      if (costValue) events.push(`好調 -${costValue}`);
      break;
    case "ExamCostType_Unknown":
    case "":
      break;
    default:
      if (costValue) throw new Error(`未対応の追加コストです: ${card.costType}`);
  }
  return events;
}

export function applyParsedExamEffect(exam, parsed) {
  switch (parsed.kind) {
    case "none": return { applied: false, label: "" };
    case "lesson": {
      const amount = Number(parsed.value) * Math.max(1, Number(parsed.count) || 1);
      exam.parameter += amount;
      return { applied: true, label: `パラメータ +${amount}` };
    }
    case "lesson_add_multiple_parameter_buff": {
      const base = Number(parsed.value) * Math.max(1, Number(parsed.count) || 1);
      const bonus = Number(exam.parameterBuff ?? 0) > 0 ? Number(parsed.permil ?? 0) / 1000 : 0;
      const amount = Math.ceil(base * (1 + bonus));
      exam.parameter += amount;
      return { applied: true, label: `パラメータ +${amount}` };
    }
    case "lesson_depend_parameter_buff": {
      const amount = Math.ceil(Number(exam.parameterBuff ?? 0) * Number(parsed.permil ?? 0) / 1000)
        * Math.max(1, Number(parsed.count) || 1);
      exam.parameter += amount;
      return { applied: true, label: `好調に応じてパラメータ +${amount}` };
    }
    case "block": exam.block += parsed.value; return { applied: true, label: `元気 +${parsed.value}` };
    case "review": exam.review += parsed.value; return { applied: true, label: `好印象 +${parsed.value}` };
    case "aggressive": exam.aggressive += parsed.value; return { applied: true, label: `やる気 +${parsed.value}` };
    case "lesson_buff": exam.lessonBuff += parsed.value; return { applied: true, label: `集中 +${parsed.value}` };
    case "parameter_buff": exam.parameterBuff += parsed.value; return { applied: true, label: `好調 +${parsed.value}ターン` };
    case "stamina_recover": {
      const before = exam.stamina;
      exam.stamina = exam.maxStamina > 0 ? Math.min(exam.maxStamina, exam.stamina + parsed.value) : exam.stamina + parsed.value;
      return { applied: true, label: `体力 +${exam.stamina - before}` };
    }
    case "stamina_consumption_down": exam.staminaConsumptionDown += parsed.value; return { applied: true, label: `体力消費減少 +${parsed.value}ターン` };
    case "stamina_consumption_add": exam.staminaConsumptionAdd += parsed.value; return { applied: true, label: `体力消費増加 +${parsed.value}ターン` };
    case "stamina_consumption_down_fix": exam.staminaConsumptionDownFix += parsed.value; return { applied: true, label: `体力消費固定軽減 +${parsed.value}` };
    case "extra_turn": exam.extraTurns += 1; return { applied: true, label: "追加ターン +1" };
    case "card_draw": return { applied: true, command: "draw", value: parsed.value, label: `${parsed.value}枚ドロー` };
    case "playable_add": return { applied: true, command: "playable_add", value: parsed.value, label: `カード使用回数 +${parsed.value}` };
    case "effect_timer": return { applied: true, command: "timer", timer: parsed, label: `${parsed.turn}ターン後に効果発動` };
    case "card_search_effect_play_count_buff": return { applied: true, command: "effect_repeat", effect: parsed, label: `次のスキルカードの効果を追加で${parsed.value}回発動` };
    case "hand_grave_count_card_draw": return { applied: true, command: "hand_swap", label: "手札をすべて入れ替え" };
    case "card_upgrade_hand_all": return { applied: true, command: "upgrade_hand", label: "手札をすべて強化" };
    case "parameter_buff_multiple_per_turn":
      exam.parameterBuffMultiplePerTurn = Math.max(Number(exam.parameterBuffMultiplePerTurn ?? 0), Number(parsed.turn ?? 0));
      return { applied: true, label: `絶好調 ${parsed.turn}ターン` };
    case "status_enchant": return { applied: true, command: "status_enchant", enchant: parsed, label: `継続効果を追加: ${parsed.enchantId}` };
    default: return { applied: false, unsupported: true, label: `未対応: ${parsed.id}` };
  }
}

export function describeParsedEffect(parsed) {
  const clone = createExamState();
  const result = applyParsedExamEffect(clone, parsed);
  return result.label || parsed.id;
}

export function describeCardEffects(card) {
  const rows = [];
  const stamina = Number(card?.stamina ?? 0) || 0;
  const direct = Number(card?.forceStamina ?? 0) || 0;
  if (stamina) rows.push(`体力${stamina}`);
  if (direct) rows.push(`直接体力${direct}`);
  const costValue = Number(card?.costValue ?? 0) || 0;
  if (costValue) rows.push(`${String(card.costType ?? "追加コスト").replace("ExamCostType_Exam", "")} ${costValue}`);
  for (const entry of card?.playEffects ?? []) {
    const parsed = parseExamEffectId(entry?.produceExamEffectId);
    const label = describeParsedEffect(parsed);
    rows.push(entry?.produceExamTriggerId ? `${label} [条件]` : label);
  }
  return rows;
}

export function describeProduceItemEffect(effect) {
  if (!effect) return "未解決";
  if (effect.unresolved) return `未解決: ${effect.id}`;
  if (effect.effectType === "ProduceItemEffectType_ExamStatusEnchant") {
    const count = Number(effect.effectCount ?? 0);
    const turn = Number(effect.effectTurn ?? 0);
    const suffix = [count ? `${count}回` : "", turn > 0 ? `${turn}ターン` : ""].filter(Boolean).join(" / ");
    return `試験中継続効果: ${effect.produceExamStatusEnchantId || effect.id}${suffix ? ` (${suffix})` : ""}`;
  }
  if (effect.effectType === "ProduceItemEffectType_ProduceEffect") {
    return `プロデュース効果: ${effect.produceEffectId || effect.id}`;
  }
  return `${effect.effectType || "不明"}: ${effect.id}`;
}
