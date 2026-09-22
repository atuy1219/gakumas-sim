import {
  EXAM_IDOL_STATUS_TYPE,
  NATIVE_LESSON_MODIFIER_KIND,
  applyNativeLessonHits,
  applyNativeModifiedLessonRepeat,
  calculateNativeDependentLessonBase,
} from "./exam_score.js";

export const EXAM_ITEM_URLS = Object.freeze({
  itemsPrimary: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceItem.yaml",
  itemsFallback: "https://raw.githubusercontent.com/zliu-aki/simple_gakuen_idolmaster/main/yaml/ProduceItem.yaml",
  itemEffectsPrimary: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceItemEffect.yaml",
  itemEffectsFallback: "https://raw.githubusercontent.com/zliu-aki/simple_gakuen_idolmaster/main/yaml/ProduceItemEffect.yaml",
  examStatusEnchantsPrimary: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceExamStatusEnchant.yaml",
  examStatusEnchantsFallback: "https://raw.githubusercontent.com/zliu-aki/simple_gakuen_idolmaster/main/yaml/ProduceExamStatusEnchant.yaml",
  examTriggersPrimary: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceExamTrigger.yaml",
  examTriggersFallback: "https://raw.githubusercontent.com/zliu-aki/simple_gakuen_idolmaster/main/yaml/ProduceExamTrigger.yaml",
  examEffectsPrimary: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceExamEffect.yaml",
  examEffectsFallback: "https://raw.githubusercontent.com/zliu-aki/simple_gakuen_idolmaster/main/yaml/ProduceExamEffect.yaml",
  cardSearchesPrimary: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceCardSearch.yaml",
  cardSearchesFallback: "https://raw.githubusercontent.com/zliu-aki/simple_gakuen_idolmaster/main/yaml/ProduceCardSearch.yaml",
});

export const EXAM_RUNTIME_DEFAULT_SETTING = Object.freeze({
  // ExamSetting p_exam_setting-1. Keep these separate from score-only settings:
  // they govern stamina/block resolution and turn/card-pool limits.
  examStaminaConsumptionDownPermil: 500,
  examStaminaConsumptionAddPermil: 1000,
  examBlockAddDownPermil: 667,
  examStaminaConsumptionDownAddPermil: 600,
  examStaminaConsumptionAddDownPermil: 1250,
  examStaminaReduceChange: 1,
  examConcentrationStaminaMultiplePermil1: 2000,
  examConcentrationStaminaMultiplePermil2: 2000,
  examPreservationStaminaMultiplePermil1: 500,
  examPreservationStaminaMultiplePermil2: 250,
  examOverPreservationStaminaMultiplePermil: 0,
  fullPowerPlayableValueAdd: 1,
  preservationReleasePlayableValueAdd1: 1,
  preservationReleasePlayableValueAdd2: 1,
  preservationReleaseBlockAdd1: 0,
  preservationReleaseBlockAdd2: 5,
  preservationReleaseEnthusiastic1: 5,
  preservationReleaseEnthusiastic2: 8,
  overPreservationReleasePlayableValueAdd: 1,
  overPreservationReleaseBlockAdd: 5,
  overPreservationReleaseEnthusiastic: 10,
  overPreservationReleaseToFullPowerGrowEffectLessonAdd: 10,
  examTurnEndRecoveryStamina: 2,
  handLimit: 5,
  holdLimit: 2,
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

export function parseProduceExamStatusEnchantCatalog(text) {
  return parseYamlRecordsWithLists(
    text,
    ["assetId", "produceExamTriggerId"],
    ["produceExamEffectIds"],
  );
}

export function parseProduceExamTriggerCatalog(text) {
  return parseYamlRecordsWithLists(
    text,
    [
      "produceCardSearchId",
      "upperSearchCount",
      "lowerSearchCount",
      "cardMovePositionType",
      "lessonType",
    ],
    [
      "phaseTypes",
      "phaseValues",
      "fieldStatusCheckTypes",
      "fieldStatusTypes",
      "fieldStatusValues",
      "fieldStatusProduceCardSearchIds",
      "effectTypes",
    ],
  );
}

export function parseProduceExamEffectCatalog(text) {
  return parseYamlRecordsWithLists(
    text,
    [
      "effectType",
      "effectValue1",
      "effectValue2",
      "effectCount",
      "effectTurn",
      "targetProduceCardId",
      "targetUpgradeCount",
      "targetExamEffectType",
      "produceCardSearchId",
      "movePositionType",
      "pickRangeType",
      "pickCountReferenceProduceCardSearchId",
      "pickCountType",
      "pickCountMin",
      "pickCountMax",
      "produceCardSearchId2",
      "pickRangeType2",
      "pickCountReferenceProduceCardSearchId2",
      "pickCountType2",
      "pickCountMin2",
      "pickCountMax2",
      "chainProduceExamEffectId",
      "produceExamStatusEnchantId",
      "produceCardStatusEnchantId",
    ],
    ["chainProduceExamEffectIds", "produceCardGrowEffectIds", "effectGroupIds"],
  );
}

export function parseProduceCardSearchCatalog(text) {
  return parseYamlRecordsWithLists(
    text,
    [
      "planType",
      "cardStatusType",
      "orderType",
      "cardPositionType",
      "cardSearchTag",
      "produceCardRandomPoolId",
      "limitCount",
      "staminaMinMaxType",
      "staminaMin",
      "staminaMax",
      "examEffectType",
      "isSelf",
      "produceCardPoolId",
      "costType",
      "isCustomized",
    ],
    ["cardRarities", "produceCardIds", "upgradeCounts", "cardCategories", "effectGroupIds"],
  );
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
  const [
    itemText,
    effectText,
    enchantText,
    triggerText,
    examEffectText,
    cardSearchText,
  ] = await Promise.all([
    fetchText(urls.itemsPrimary, urls.itemsFallback, fetchImpl),
    fetchText(urls.itemEffectsPrimary, urls.itemEffectsFallback, fetchImpl),
    fetchText(urls.examStatusEnchantsPrimary, urls.examStatusEnchantsFallback, fetchImpl),
    fetchText(urls.examTriggersPrimary, urls.examTriggersFallback, fetchImpl),
    fetchText(urls.examEffectsPrimary, urls.examEffectsFallback, fetchImpl),
    fetchText(urls.cardSearchesPrimary, urls.cardSearchesFallback, fetchImpl),
  ]);
  const items = parseProduceItemCatalogForExam(itemText);
  const itemEffects = parseProduceItemEffectCatalog(effectText);
  const examStatusEnchants = parseProduceExamStatusEnchantCatalog(enchantText);
  const examTriggers = parseProduceExamTriggerCatalog(triggerText);
  const examEffects = parseProduceExamEffectCatalog(examEffectText);
  const cardSearches = parseProduceCardSearchCatalog(cardSearchText);
  return {
    items,
    itemById: new Map(items.map((item) => [String(item.id), item])),
    itemEffects,
    itemEffectById: new Map(itemEffects.map((effect) => [String(effect.id), effect])),
    examStatusEnchants,
    examStatusEnchantById: new Map(examStatusEnchants.map((enchant) => [String(enchant.id), enchant])),
    examTriggers,
    examTriggerById: new Map(examTriggers.map((trigger) => [String(trigger.id), trigger])),
    examEffects,
    examEffectById: new Map(examEffects.map((effect) => [String(effect.id), effect])),
    cardSearches,
    cardSearchById: new Map(cardSearches.map((search) => [String(search.id), search])),
  };
}

function resolveProduceExamStatusEnchant(enchantIdInput, catalogs = {}) {
  const enchantId = String(enchantIdInput ?? "");
  if (!enchantId) return null;
  const enchant = catalogs.examStatusEnchantById?.get?.(enchantId);
  if (!enchant) return null;
  const triggerId = String(enchant.produceExamTriggerId ?? "");
  const trigger = triggerId ? catalogs.examTriggerById?.get?.(triggerId) ?? null : null;
  const cardSearchId = String(trigger?.produceCardSearchId ?? "");
  const cardSearch = cardSearchId ? catalogs.cardSearchById?.get?.(cardSearchId) ?? null : null;
  const fieldStatusCardSearches = (trigger?.fieldStatusProduceCardSearchIds ?? []).map((id) => (
    catalogs.cardSearchById?.get?.(String(id)) ?? null
  ));
  const examEffects = (enchant.produceExamEffectIds ?? []).map((effectId) => (
    catalogs.examEffectById?.get?.(String(effectId))
      ?? { id: String(effectId), unresolved: true }
  ));
  return {
    ...enchant,
    trigger: trigger ? {
      ...trigger,
      cardSearch: cardSearch ? { ...cardSearch } : null,
      fieldStatusCardSearches: fieldStatusCardSearches.map((row) => (row ? { ...row } : null)),
    } : null,
    examEffects: examEffects.map((effect) => ({ ...effect })),
  };
}

export function resolveProduceItems(
  itemIds,
  itemById = new Map(),
  itemEffectById = new Map(),
  catalogs = {},
) {
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
      if (!effect) return { id: String(effectId), unresolved: true };
      const resolvedEffect = { ...effect };
      if (resolvedEffect.effectType === "ProduceItemEffectType_ExamStatusEnchant") {
        resolvedEffect.examStatusEnchant = resolveProduceExamStatusEnchant(
          resolvedEffect.produceExamStatusEnchantId,
          catalogs,
        );
      }
      return resolvedEffect;
    });
    resolved.push({ ...item, id, effects });
  }
  return { items: resolved, unresolved };
}

function integer(value) {
  return Number.parseInt(String(value), 10);
}

export function parseExamEffectMaster(effectInput) {
  if (!effectInput || typeof effectInput !== "object") return parseExamEffectId(effectInput);
  const id = String(effectInput.id ?? effectInput.produceExamEffectId ?? "");
  const byId = parseExamEffectId(id);
  if (byId.kind !== "unsupported" && byId.kind !== "none") return byId;

  const value1 = Number(effectInput.effectValue1 ?? 0) || 0;
  const value2 = Number(effectInput.effectValue2 ?? 0) || 0;
  const count = Math.max(1, Number(effectInput.effectCount ?? 0) || 1);
  const turn = Number(effectInput.effectTurn ?? 0) || 0;
  const master = (kind, extra = {}) => ({
    kind,
    id,
    value: value1,
    value1,
    value2,
    count,
    turn,
    masterEffectType: String(effectInput.effectType ?? ""),
    targetProduceCardId: String(effectInput.targetProduceCardId ?? ""),
    targetUpgradeCount: Number(effectInput.targetUpgradeCount ?? 0) || 0,
    targetExamEffectType: String(effectInput.targetExamEffectType ?? ""),
    searchId: String(effectInput.produceCardSearchId ?? ""),
    searchId2: String(effectInput.produceCardSearchId2 ?? ""),
    movePositionType: String(effectInput.movePositionType ?? ""),
    pickRangeType: String(effectInput.pickRangeType ?? ""),
    pickCountType: String(effectInput.pickCountType ?? ""),
    pickCountMin: Number(effectInput.pickCountMin ?? 0) || 0,
    pickCountMax: Number(effectInput.pickCountMax ?? 0) || 0,
    pickRangeType2: String(effectInput.pickRangeType2 ?? ""),
    pickCountType2: String(effectInput.pickCountType2 ?? ""),
    pickCountMin2: Number(effectInput.pickCountMin2 ?? 0) || 0,
    pickCountMax2: Number(effectInput.pickCountMax2 ?? 0) || 0,
    chainEffectId: String(effectInput.chainProduceExamEffectId ?? ""),
    chainEffectIds: Array.isArray(effectInput.chainProduceExamEffectIds)
      ? effectInput.chainProduceExamEffectIds.map(String)
      : [],
    enchantId: String(effectInput.produceExamStatusEnchantId ?? ""),
    cardEnchantId: String(effectInput.produceCardStatusEnchantId ?? ""),
    growEffectIds: Array.isArray(effectInput.produceCardGrowEffectIds)
      ? effectInput.produceCardGrowEffectIds.map(String)
      : [],
    ...extra,
  });
  switch (String(effectInput.effectType ?? "")) {
    case "ProduceExamEffectType_ExamLesson":
      return { kind: "lesson", id, value: value1, count };
    case "ProduceExamEffectType_ExamBlock":
      return { kind: "block", id, value: value1 };
    case "ProduceExamEffectType_ExamReview":
      return { kind: "review", id, value: value1 };
    case "ProduceExamEffectType_ExamCardPlayAggressive":
      return { kind: "aggressive", id, value: value1 };
    case "ProduceExamEffectType_ExamLessonBuff":
      return { kind: "lesson_buff", id, value: value1 };
    case "ProduceExamEffectType_ExamParameterBuff":
      return { kind: "parameter_buff", id, value: value1 };
    case "ProduceExamEffectType_ExamParameterBuffReduce":
      return { kind: "parameter_buff_reduce", id, value: value1 };
    case "ProduceExamEffectType_ExamLessonAddMultipleParameterBuff":
      return { kind: "lesson_add_multiple_parameter_buff", id, value: value1, permil: value2, count };
    case "ProduceExamEffectType_ExamLessonDependExamReview":
      return { kind: "lesson_depend_exam_review", id, permil: value1, count };
    case "ProduceExamEffectType_ExamLessonDependExamCardPlayAggressive":
      return { kind: "lesson_depend_exam_aggressive", id, permil: value1, count };
    case "ProduceExamEffectType_ExamLessonValueMultiple":
      return { kind: "lesson_value_multiple", id, permil: value1, turn };
    case "ProduceExamEffectType_ExamLessonBuffMultiple":
      return { kind: "lesson_buff_multiple", id, permil: value1, turn };
    case "ProduceExamEffectType_ExamReviewMultiple":
      return { kind: "review_multiple", id, permil: value1, turn };
    case "ProduceExamEffectType_ExamReviewCountAdd":
      return { kind: "review_count_add", id, value: value1, turn };
    case "ProduceExamEffectType_ExamLessonValueMultipleDependReviewOrAggressive":
      return { kind: "lesson_value_multiple_depend_review_or_aggressive", id, turn };
    case "ProduceExamEffectType_ExamCardSearchEffectPlayCountBuff":
      return master("card_search_effect_play_count_buff");
    case "ProduceExamEffectType_ExamHandGraveCountCardDraw":
      return { kind: "hand_grave_count_card_draw", id };
    case "ProduceExamEffectType_ExamParameterBuffMultiplePerTurn":
      return { kind: "parameter_buff_multiple_per_turn", id, turn: value1 };
    case "ProduceExamEffectType_ExamCardCreateId":
      return {
        kind: "card_create_id",
        id,
        cardId: String(effectInput.targetProduceCardId ?? ""),
        upgradeCount: Number(effectInput.targetUpgradeCount ?? 0) || 0,
        movePosition: String(effectInput.movePositionType ?? ""),
        pickCountMin: Math.max(1, Number(effectInput.pickCountMin ?? 0) || 1),
        pickCountMax: Math.max(1, Number(effectInput.pickCountMax ?? 0) || 1),
      };
    case "ProduceExamEffectType_ExamConcentration":
      return { kind: "concentration", id, step: Math.max(1, value1 || 1) };
    case "ProduceExamEffectType_ExamPreservation":
      return { kind: "preservation", id, step: Math.max(1, value1 || 1) };
    case "ProduceExamEffectType_ExamMultipleLessonBuffLesson":
      return {
        kind: "lesson_multiple_lesson_buff",
        id,
        value: value1,
        permil: Number(effectInput.effectValue2 ?? 0) || 0,
        count,
      };
    case "ProduceExamEffectType_ExamAddGrowEffect": {
      const growEffectIds = Array.isArray(effectInput.produceCardGrowEffectIds)
        ? effectInput.produceCardGrowEffectIds.map(String)
        : [];
      const blockAdd = growEffectIds
        .map((growId) => growId.match(/^g_effect-block_add-(\d+)$/))
        .find(Boolean);
      const costAdd = growEffectIds
        .map((growId) => growId.match(/^g_effect-cost_add-(\d+)$/))
        .find(Boolean);
      return {
        kind: "add_grow_effect",
        id,
        searchId: String(effectInput.produceCardSearchId ?? ""),
        growEffectIds,
        blockAdd: blockAdd ? integer(blockAdd[1]) : 0,
        costAdd: costAdd ? integer(costAdd[1]) : 0,
      };
    }
    case "ProduceExamEffectType_ExamStaminaRecoverFix":
      return { kind: "stamina_recover", id, value: value1 };
    case "ProduceExamEffectType_ExamCardDraw":
      return { kind: "card_draw", id, value: value1 };
    case "ProduceExamEffectType_ExamPlayableValueAdd":
      return { kind: "playable_add", id, value: value1 };
    case "ProduceExamEffectType_ExamExtraTurn":
      return { kind: "extra_turn", id, value: Math.max(1, value1 || 1) };
    case "ProduceExamEffectType_ExamStaminaConsumptionDown":
      return { kind: "stamina_consumption_down", id, value: value1 };
    case "ProduceExamEffectType_ExamStaminaConsumptionAdd":
      return { kind: "stamina_consumption_add", id, value: value1 };
    case "ProduceExamEffectType_ExamStaminaConsumptionDownFix":
      return { kind: "stamina_consumption_down_fix", id, value: value1 };
    case "ProduceExamEffectType_ExamStaminaConsumptionAddFix":
      return { kind: "stamina_consumption_add_fix", id, value: value1 };
    default:
      // The master-data path intentionally preserves every current native
      // ProduceExamEffectType.  Effects which need deck/search/counter state
      // are executed by tower_runtime rather than being guessed from an ID.
      if (String(effectInput.effectType ?? "").startsWith("ProduceExamEffectType_")) {
        return master("master_effect");
      }
      return { kind: "unsupported", id, masterEffectType: String(effectInput.effectType ?? "") };
  }
}

export function parseExamEffectId(effectId) {
  const id = String(effectId ?? "").trim();
  if (!id) return { kind: "none", id };
  let match;
  if ((match = id.match(/^e_effect-exam_lesson-(\d+)-(\d+)$/))) {
    return { kind: "lesson", id, value: integer(match[1]), count: integer(match[2]) };
  }
  if ((match = id.match(/^e_effect-exam_multiple_lesson_buff_lesson-(\d+)-(\d+)-(\d+)$/))) {
    return {
      kind: "lesson_multiple_lesson_buff",
      id,
      value: integer(match[1]),
      permil: integer(match[2]),
      count: integer(match[3]),
    };
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
  if ((match = id.match(/^e_effect-exam_lesson_depend_exam_review-(\d+)-(\d+)$/))) {
    return { kind: "lesson_depend_exam_review", id, permil: integer(match[1]), count: integer(match[2]) };
  }
  if ((match = id.match(/^e_effect-exam_lesson_depend_exam_card_play_aggressive-(\d+)-(\d+)$/))) {
    return { kind: "lesson_depend_exam_aggressive", id, permil: integer(match[1]), count: integer(match[2]) };
  }
  if ((match = id.match(/^e_effect-exam_lesson_value_multiple-(\d+)-(inf|\d+)$/))) {
    return { kind: "lesson_value_multiple", id, permil: integer(match[1]), turn: match[2] === "inf" ? -1 : integer(match[2]) };
  }
  if ((match = id.match(/^e_effect-exam_lesson_value_multiple_down-(\d+)-(inf|\d+)$/))) {
    return { kind: "lesson_value_multiple_down", id, permil: integer(match[1]), turn: match[2] === "inf" ? -1 : integer(match[2]) };
  }
  if ((match = id.match(/^e_effect-exam_lesson_buff_multiple-(\d+)-(inf|\d+)$/))) {
    return { kind: "lesson_buff_multiple", id, permil: integer(match[1]), turn: match[2] === "inf" ? -1 : integer(match[2]) };
  }
  if ((match = id.match(/^e_effect-exam_review_multiple-(\d+)-(inf|\d+)$/))) {
    return { kind: "review_multiple", id, permil: integer(match[1]), turn: match[2] === "inf" ? -1 : integer(match[2]) };
  }
  if ((match = id.match(/^e_effect-exam_review_count_add-(\d+)-(inf|\d+)$/))) {
    return { kind: "review_count_add", id, value: integer(match[1]), turn: match[2] === "inf" ? -1 : integer(match[2]) };
  }
  if ((match = id.match(/^e_effect-exam_lesson_value_multiple_depend_review_or_aggressive-(inf|\d+)$/))) {
    return { kind: "lesson_value_multiple_depend_review_or_aggressive", id, turn: match[1] === "inf" ? -1 : integer(match[1]) };
  }
  if ((match = id.match(/^e_effect-exam_review_turn_end_reduce_lock-(inf|\d+)$/))) {
    return { kind: "review_turn_end_reduce_lock", id, turn: match[1] === "inf" ? -1 : integer(match[1]) };
  }
  if ((match = id.match(/^e_effect-exam_parameter_buff_turn_end_reduce_lock-(inf|\d+)$/))) {
    return { kind: "parameter_buff_turn_end_reduce_lock", id, turn: match[1] === "inf" ? -1 : integer(match[1]) };
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
  if ((match = id.match(/^e_effect-exam_add_grow_effect-(p_card_search-.+)-all-0_0-g_effect-block_add-(\d+)-g_effect-cost_add-(\d+)$/))) {
    return {
      kind: "add_grow_effect",
      id,
      searchId: match[1],
      growEffectIds: [`g_effect-block_add-${match[2]}`, `g_effect-cost_add-${match[3]}`],
      blockAdd: integer(match[2]),
      costAdd: integer(match[3]),
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
  if (id === "e_effect-exam_status_enchant-inf-enchant-p_card-01-act-3_185-enc02") {
    return {
      kind: "status_enchant",
      id,
      turn: -1,
      count: null,
      enchantId: "enchant-p_card-01-act-3_185-enc02",
      trigger: {
        phase: "card_play",
        skillCard: true,
        field: "parameterBuff",
        max: 20,
        playCountInterval: 2,
      },
      effects: [
        parseExamEffectId("e_effect-exam_multiple_lesson_buff_lesson-0006-3000-01"),
        parseExamEffectId("e_effect-exam_parameter_buff_reduce-0003"),
      ],
    };
  }
  if (id === "e_effect-exam_status_enchant-03-inf-enchant-p_card-03-ido-3_234-enc01") {
    return {
      kind: "status_enchant",
      id,
      turn: -1,
      count: 3,
      enchantId: "enchant-p_card-03-ido-3_234-enc01",
      trigger: {
        phase: "card_play",
        category: "ProduceCardCategory_ActiveSkill",
        idolStatusType: EXAM_IDOL_STATUS_TYPE.Concentration,
        idolStatusStepMin: 2,
      },
      effects: [parseExamEffectId("e_effect-exam_preservation-0002")],
    };
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
  if (id === "e_effect-exam_status_enchant-inf-enchant-p_card-00-sup-3_152-enc01") {
    return {
      kind: "status_enchant",
      id,
      turn: -1,
      enchantId: "enchant-p_card-00-sup-3_152-enc01",
      trigger: { phase: "card_play", playCountInterval: 5 },
      effects: [parseExamEffectId("e_effect-exam_lesson-0004-01")],
    };
  }
  if (id === "e_effect-exam_status_enchant-inf-enchant-p_card-02-act-3_050-enc01") {
    return {
      kind: "status_enchant",
      id,
      turn: -1,
      enchantId: "enchant-p_card-02-act-3_050-enc01",
      trigger: { phase: "card_play", skillCard: true },
      effects: [parseExamEffectId("e_effect-exam_lesson_depend_exam_review-0300-01")],
    };
  }
  if (id === "e_effect-exam_status_enchant-inf-enchant-p_card-02-act-3_050-enc02") {
    return {
      kind: "status_enchant",
      id,
      turn: -1,
      enchantId: "enchant-p_card-02-act-3_050-enc02",
      trigger: { phase: "card_play", skillCard: true },
      effects: [parseExamEffectId("e_effect-exam_lesson_depend_exam_review-0500-01")],
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
  if ((match = id.match(/^e_effect-exam_parameter_buff_reduce-(\d+)$/))) {
    return { kind: "parameter_buff_reduce", id, value: integer(match[1]) };
  }
  if ((match = id.match(/^e_effect-exam_concentration-(\d+)$/))) {
    return { kind: "concentration", id, step: Math.max(1, integer(match[1])) };
  }
  if ((match = id.match(/^e_effect-exam_preservation-(\d+)$/))) {
    return { kind: "preservation", id, step: Math.max(1, integer(match[1])) };
  }
  if ((match = id.match(/^e_effect-exam_stamina_recover_fix-(\d+)$/))) {
    return { kind: "stamina_recover", id, value: integer(match[1]) };
  }
  if ((match = id.match(/^e_effect-exam_card_draw-(\d+)$/))) {
    return { kind: "card_draw", id, value: integer(match[1]) };
  }
  if ((match = id.match(/^e_effect-exam_card_create_id-(p_card-.+)-(\d+)-(hand|deck_first|deck_last|deck_random|grave|lost|hold)-(\d+)_(\d+)$/))) {
    return {
      kind: "card_create_id",
      id,
      cardId: match[1],
      upgradeCount: integer(match[2]),
      movePosition: match[3],
      pickCountMin: integer(match[4]),
      pickCountMax: integer(match[5]),
    };
  }
  if ((match = id.match(/^e_effect-exam_card_move-p_card_search-(deck_grave|deck|grave)-(p_card-.+)-(hand|deck_first|deck_last|deck_random|grave|lost|hold)-random-(\d+)_(\d+)$/))) {
    return {
      kind: "card_move_search",
      id,
      searchPosition: match[1],
      cardId: match[2],
      movePosition: match[3],
      pickRange: "random",
      pickCountMin: integer(match[4]),
      pickCountMax: integer(match[5]),
    };
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
  if ((match = id.match(/^e_effect-exam_stamina_consumption_add_fix-(\d+)-inf$/))) {
    return { kind: "stamina_consumption_add_fix", id, value: integer(match[1]) };
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
    // Native JudgeParameter and its battle-attribute subtotals.
    parameter: 0,
    parameterVocal: 0,
    parameterDance: 0,
    parameterVisual: 0,

    stamina: maxStamina,
    maxStamina,
    block: 0,

    // Common score-affecting statuses.
    review: 0,
    reviewMultiple: 1,
    reviewCountAdd: 0,
    reviewAdditivePermil: 0,
    reviewTurnEndReduceLock: 0,
    parameterBuffTurnEndReduceLock: 0,
    aggressive: 0,
    aggressiveAdditivePermil: 0,
    aggressiveAdditiveFix: 0,
    lessonBuff: 0,
    lessonBuffAdditivePermil: 0,
    lessonBuffAdditiveFix: 0,
    lessonDebuff: 0,
    lessonBuffMultiple: 1,
    parameterBuff: 0,
    parameterBuffAdditivePermil: 0,
    parameterBuffMultiplePerTurn: 0,
    parameterDebuff: 0,
    enthusiastic: 0,
    enthusiasticAdditivePermil: 0,
    enthusiasticMultiple: 1,
    lessonParameterMultiple: 1,
    lessonParameterDown: 0,
    lessonValueDependReviewAggressive: false,
    slump: false,
    panic: false,
    antiDebuffCount: 0,

    // Anomaly stance state used by CalculateAddingParameter.
    idolStatusType: 0,
    idolStatusStep: 0,
    concentrationLessonMultipleAdditive: 1,
    fullPowerLessonMultipleAdditive: 1,
    fullPowerPoint: 0,
    fullPowerPointAdditivePermil: 0,
    fullPowerPointGetSum: 0,
    stanceLock: 0,
    stanceLockConcentration: 0,
    stanceLockFullPower: 0,
    stanceLockPreservation: 0,
    lessonChangeSpecifyMoreThan: null,
    lessonChangeSpecifyLessThan: null,

    staminaConsumptionDown: 0,
    staminaConsumptionAdd: 0,
    staminaConsumptionDownFix: 0,
    staminaConsumptionAddFix: 0,
    staminaConsumptionDownAdd: false,
    staminaConsumptionAddDown: false,
    staminaReduceChange: 0,
    blockRestriction: false,
    blockAddDown: false,
    blockAddDownFix: 0,
    blockValueMultiple: 1,
    aggressiveValueMultiple: 1,
    reviewValueMultiple: 1,
    staminaRecoverRestriction: false,
    buffConsumptionAdd: 0,
    itemFireLimitAdd: 0,
    gimmickPlayCardLimit: null,
    startTurnCardDrawDown: 0,
    cardPlayCount: 0,
    playCardCountSum: 0,
    blockConsumptionSum: 0,
    staminaConsumptionSum: 0,
    reviewConsumptionSum: 0,
    concentrationChangeCount: 0,
    preservationChangeCount: 0,
    fullPowerChangeCount: 0,
    stanceChangeCount: 0,
    extraTurns: 0,
    runtimeSettings: { ...EXAM_RUNTIME_DEFAULT_SETTING },

    // Native timed score-related status effects. Value statuses with the same
    // remaining turn are merged, matching TryAdd*Status predicates.
    scoreTimedStatuses: [],
    genericTimedStatuses: [],
  };
}

function isPreservationStance(type) {
  return type === EXAM_IDOL_STATUS_TYPE.Preservation || type === EXAM_IDOL_STATUS_TYPE.OverPreservation;
}

/**
 * Applies the native TryInternalSetStance transition rules used by the
 * Concentration/Preservation/FullPower/OverPreservation/Reset executors.
 * Runtime-only rewards (play count and deck-wide growth) are returned to the
 * caller because ExamState intentionally does not own the card zones.
 */
export function trySetExamStance(exam, typeInput, stepInput = 1, options = {}) {
  const type = Math.trunc(Number(typeInput) || 0);
  const oldType = Math.trunc(Number(exam?.idolStatusType) || 0);
  const oldStep = Math.trunc(Number(exam?.idolStatusStep) || 0);
  const requestedStep = Math.max(0, Math.trunc(Number(stepInput) || 0));
  const result = {
    changed: false,
    blocked: false,
    oldType,
    oldStep,
    type: oldType,
    step: oldStep,
    playableValueAdd: 0,
    growLessonAdd: 0,
    releasedPreservation: false,
  };

  // Effect executors deliberately do not replace Full Power. It is removed by
  // the native post-card Full Power cleanup path instead.
  if (oldType === EXAM_IDOL_STATUS_TYPE.FullPower && type !== oldType) {
    result.blocked = true;
    result.reason = "full_power";
    return result;
  }

  const maxStep = type === EXAM_IDOL_STATUS_TYPE.Concentration
    || type === EXAM_IDOL_STATUS_TYPE.Preservation ? 2 : 1;
  if (oldType === type && oldStep >= maxStep) {
    result.blocked = true;
    result.reason = "step_max";
    return result;
  }
  if (type === EXAM_IDOL_STATUS_TYPE.Preservation
    && oldType === EXAM_IDOL_STATUS_TYPE.OverPreservation) {
    result.blocked = true;
    result.reason = "over_preservation";
    return result;
  }
  if (Number(exam?.stanceLock ?? 0) > 0) {
    result.blocked = true;
    result.reason = "stance_lock";
    return result;
  }
  const specificLock = type === EXAM_IDOL_STATUS_TYPE.Concentration
    ? "stanceLockConcentration"
    : type === EXAM_IDOL_STATUS_TYPE.FullPower
      ? "stanceLockFullPower"
      : isPreservationStance(type) ? "stanceLockPreservation" : "";
  if (specificLock && Number(exam?.[specificLock] ?? 0) > 0) {
    result.blocked = true;
    result.reason = specificLock;
    return result;
  }

  if (type === EXAM_IDOL_STATUS_TYPE.FullPower && options.consumeFullPowerPoint === true) {
    exam.fullPowerPoint = Math.max(0, Number(exam.fullPowerPoint ?? 0) - 10);
  }

  if (isPreservationStance(oldType) && !isPreservationStance(type)) {
    const over = oldType === EXAM_IDOL_STATUS_TYPE.OverPreservation;
    const suffix = over ? "" : String(oldStep === 1 ? 1 : 2);
    const playableKey = over
      ? "overPreservationReleasePlayableValueAdd"
      : `preservationReleasePlayableValueAdd${suffix}`;
    const blockKey = over
      ? "overPreservationReleaseBlockAdd"
      : `preservationReleaseBlockAdd${suffix}`;
    const enthusiasticKey = over
      ? "overPreservationReleaseEnthusiastic"
      : `preservationReleaseEnthusiastic${suffix}`;
    result.playableValueAdd += getExamRuntimeSetting(exam, playableKey);
    const blockBase = getExamRuntimeSetting(exam, blockKey);
    // The release path calls AddBlockFix, which writes the raw positive delta
    // and therefore bypasses ordinary block multipliers/restrictions.
    if (blockBase > 0) exam.block += blockBase;
    const enthusiasticBase = getExamRuntimeSetting(exam, enthusiasticKey);
    if (enthusiasticBase > 0) {
      const additive = Number(exam.enthusiasticAdditivePermil ?? 0);
      const multiple = Number(exam.enthusiasticMultiple ?? 1);
      exam.enthusiastic += Math.max(0, Math.ceil((enthusiasticBase + additive) * multiple));
    }
    if (over && type === EXAM_IDOL_STATUS_TYPE.FullPower) {
      result.growLessonAdd = getExamRuntimeSetting(
        exam,
        "overPreservationReleaseToFullPowerGrowEffectLessonAdd",
      );
    }
    result.releasedPreservation = true;
  }

  let nextStep = 0;
  if (type === EXAM_IDOL_STATUS_TYPE.Concentration || type === EXAM_IDOL_STATUS_TYPE.Preservation) {
    nextStep = Math.min(2, (oldType === type ? 1 : 0) + Math.max(1, requestedStep));
  } else if (type !== EXAM_IDOL_STATUS_TYPE.Unknown) {
    nextStep = 1;
  }

  if (oldType !== type) {
    if (!(isPreservationStance(oldType) && isPreservationStance(type))) {
      exam.stanceChangeCount = Number(exam.stanceChangeCount ?? 0) + 1;
    }
    if (type === EXAM_IDOL_STATUS_TYPE.Concentration) {
      exam.concentrationChangeCount = Number(exam.concentrationChangeCount ?? 0) + 1;
    } else if (isPreservationStance(type) && !isPreservationStance(oldType)) {
      exam.preservationChangeCount = Number(exam.preservationChangeCount ?? 0) + 1;
    } else if (type === EXAM_IDOL_STATUS_TYPE.FullPower) {
      exam.fullPowerChangeCount = Number(exam.fullPowerChangeCount ?? 0) + 1;
    }
  }

  exam.idolStatusType = type;
  exam.idolStatusStep = nextStep;
  if (type === EXAM_IDOL_STATUS_TYPE.FullPower) {
    result.playableValueAdd += getExamRuntimeSetting(exam, "fullPowerPlayableValueAdd");
  }
  result.changed = oldType !== type || oldStep !== nextStep;
  result.type = type;
  result.step = nextStep;
  return result;
}

export function addNativeGenericTimedStatus(exam, fieldInput, valueInput, turnInput, mode = "add") {
  const field = String(fieldInput ?? "");
  const turn = Math.trunc(Number(turnInput));
  if (!field || !Number.isFinite(turn) || turn === 0) return false;
  if (!Array.isArray(exam.genericTimedStatuses)) exam.genericTimedStatuses = [];
  exam.genericTimedStatuses.push({ field, value: Number(valueInput) || 0, turn, mode });
  syncNativeGenericTimedStatuses(exam);
  return true;
}

export function syncNativeGenericTimedStatuses(exam) {
  const additive = new Map();
  const flags = new Set();
  for (const status of exam?.genericTimedStatuses ?? []) {
    if (status.mode === "flag") flags.add(status.field);
    else additive.set(status.field, Number(additive.get(status.field) ?? 0) + Number(status.value ?? 0));
  }
  const additiveFields = [
    "reviewAdditivePermil", "aggressiveAdditivePermil", "aggressiveAdditiveFix",
    "lessonBuffAdditivePermil", "lessonBuffAdditiveFix", "parameterBuffAdditivePermil",
    "enthusiasticAdditivePermil", "fullPowerPointAdditivePermil", "buffConsumptionAdd",
    "blockAddDownFix", "startTurnCardDrawDown",
  ];
  for (const field of additiveFields) exam[field] = Number(additive.get(field) ?? 0);
  for (const field of ["blockRestriction", "blockAddDown", "staminaRecoverRestriction", "panic"]) {
    exam[field] = flags.has(field);
  }
  return exam;
}

const VALUE_SCORE_STATUS_KINDS = new Set([
  "lessonParameterMultiple",
  "lessonParameterDown",
  "lessonBuffMultiple",
  "reviewMultiple",
  "reviewCountAdd",
]);

const SINGLE_TURN_SCORE_STATUS_KINDS = new Set([
  "lessonValueDependReviewAggressive",
  "reviewTurnEndReduceLock",
  "parameterBuffTurnEndReduceLock",
]);

function f32AddPermil(base, value) {
  return Math.fround(
    Math.fround(base)
    + Math.fround(Math.fround(Number(value) || 0) / Math.fround(1000)),
  );
}

export function syncNativeScoreTimedStatuses(exam) {
  const statuses = Array.isArray(exam?.scoreTimedStatuses) ? exam.scoreTimedStatuses : [];
  let lessonParameterMultiple = Math.fround(1);
  let lessonParameterDown = Math.fround(0);
  let lessonBuffMultiple = Math.fround(1);
  let reviewMultiple = Math.fround(1);
  let reviewCountAdd = 0;

  for (const status of statuses) {
    switch (status.kind) {
      case "lessonParameterMultiple":
        lessonParameterMultiple = f32AddPermil(lessonParameterMultiple, status.value);
        break;
      case "lessonParameterDown":
        lessonParameterDown = f32AddPermil(lessonParameterDown, status.value);
        break;
      case "lessonBuffMultiple":
        lessonBuffMultiple = f32AddPermil(lessonBuffMultiple, status.value);
        break;
      case "reviewMultiple":
        reviewMultiple = f32AddPermil(reviewMultiple, status.value);
        break;
      case "reviewCountAdd":
        reviewCountAdd += Math.trunc(Number(status.value) || 0);
        break;
    }
  }

  exam.lessonParameterMultiple = lessonParameterMultiple;
  exam.lessonParameterDown = lessonParameterDown;
  exam.lessonBuffMultiple = lessonBuffMultiple;
  exam.reviewMultiple = reviewMultiple;
  exam.reviewCountAdd = Math.max(0, reviewCountAdd);

  const pride = statuses.find((status) => status.kind === "lessonValueDependReviewAggressive");
  const reviewLock = statuses.find((status) => status.kind === "reviewTurnEndReduceLock");
  const parameterBuffLock = statuses.find((status) => status.kind === "parameterBuffTurnEndReduceLock");
  exam.lessonValueDependReviewAggressive = Boolean(pride);
  exam.reviewTurnEndReduceLock = reviewLock ? Number(reviewLock.turn) : 0;
  exam.parameterBuffTurnEndReduceLock = parameterBuffLock ? Number(parameterBuffLock.turn) : 0;
  return exam;
}

export function addNativeScoreTimedStatus(exam, kindInput, valueInput, turnInput) {
  const kind = String(kindInput ?? "");
  const turn = Math.trunc(Number(turnInput));
  if (!Number.isFinite(turn) || turn === 0) return false;
  if (!Array.isArray(exam.scoreTimedStatuses)) exam.scoreTimedStatuses = [];

  const statuses = exam.scoreTimedStatuses.map((status) => ({ ...status }));
  if (VALUE_SCORE_STATUS_KINDS.has(kind)) {
    const value = Math.trunc(Number(valueInput) || 0);
    const index = statuses.findIndex((status) => status.kind === kind && Number(status.turn) === turn);
    if (index >= 0) statuses[index] = { ...statuses[index], value: Number(statuses[index].value || 0) + value };
    else statuses.push({ kind, value, turn });
  } else if (SINGLE_TURN_SCORE_STATUS_KINDS.has(kind)) {
    const index = statuses.findIndex((status) => status.kind === kind);
    if (index >= 0) {
      const previous = Number(statuses[index].turn);
      // Native single-status TryAdd implementations extend an active finite
      // status by the new duration.
      statuses[index] = {
        ...statuses[index],
        turn: previous < 0 || turn < 0 ? -1 : previous + turn,
      };
    } else {
      statuses.push({ kind, value: 0, turn });
    }
  } else {
    return false;
  }

  exam.scoreTimedStatuses = statuses;
  syncNativeScoreTimedStatuses(exam);
  return true;
}

export function tickNativeScoreTimedStatuses(exam) {
  if (!Array.isArray(exam?.scoreTimedStatuses) || !exam.scoreTimedStatuses.length) return exam;
  exam.scoreTimedStatuses = exam.scoreTimedStatuses
    .map((status) => ({
      ...status,
      turn: Number(status.turn) < 0 ? -1 : Number(status.turn) - 1,
    }))
    .filter((status) => Number(status.turn) !== 0);
  syncNativeScoreTimedStatuses(exam);
  if (Array.isArray(exam?.genericTimedStatuses)) {
    exam.genericTimedStatuses = exam.genericTimedStatuses
      .map((status) => ({
        ...status,
        turn: Number(status.turn) < 0 ? -1 : Number(status.turn) - 1,
      }))
      .filter((status) => Number(status.turn) !== 0);
    syncNativeGenericTimedStatuses(exam);
  }
  return exam;
}

function consumeStatus(exam, field, value, label) {
  const amount = Math.max(0, Number(value) || 0);
  if (Number(exam[field] ?? 0) < amount) throw new Error(`${label}が${amount}必要です。`);
  exam[field] -= amount;
}

function runtimeF32(value) {
  return Math.fround(Number(value) || 0);
}

function runtimeFromPermil(value) {
  return runtimeF32(runtimeF32(value) / runtimeF32(1000));
}

export function getExamRuntimeSetting(exam, key) {
  const value = exam?.runtimeSettings?.[key];
  if (value !== undefined && value !== null && Number.isFinite(Number(value))) return Number(value);
  return Number(EXAM_RUNTIME_DEFAULT_SETTING[key] ?? 0);
}

export function calculateNativeBlockAdd(exam, valueInput, aggressiveMultiple = 1) {
  // Port of ExamEffectUtility.CalculateAddBlock.
  let value = Math.trunc(Number(valueInput) || 0);
  if (value < 1 || exam?.blockRestriction) return 0;

  const aggressive = Math.max(0, Math.trunc(Number(exam?.aggressive) || 0));
  const aggressiveScale = runtimeF32(
    runtimeF32(aggressiveMultiple)
    * runtimeF32(Number(exam?.aggressiveValueMultiple ?? 1) || 1),
  );
  value += Math.ceil(runtimeF32(runtimeF32(aggressive) * aggressiveScale));
  value = Math.ceil(runtimeF32(value * runtimeF32(Number(exam?.blockValueMultiple ?? 1) || 1)));
  if (value < 1) return Math.max(0, value);

  if (exam?.blockAddDown) {
    const keepPermil = 1000 - getExamRuntimeSetting(exam, "examBlockAddDownPermil");
    const ratio = runtimeF32(runtimeFromPermil(keepPermil) * runtimeF32(value));
    // Native GetRatioEffectIntValue(..., ceilMode=false) floors with -0.0001.
    const kept = Math.floor(runtimeF32(ratio + runtimeF32(-0.0001)));
    value -= kept;
  }

  const fix = Math.max(0, Math.trunc(Number(exam?.blockAddDownFix) || 0));
  if (fix >= 1) value -= fix;
  return Math.max(0, Math.trunc(value));
}

export function calculateNativeStaminaDamage(exam, valueInput, options = {}) {
  // Port of ExamEffectUtility.CalculateDamage. Return order mirrors the
  // native stamina/block split while also exposing total post-modifier damage.
  const penetrate = Boolean(options.penetrate);
  const applyFixed = options.applyFixed !== false;
  const block = penetrate ? 0 : Math.max(0, Math.trunc(Number(exam?.block) || 0));
  let value = runtimeF32(Math.trunc(Number(valueInput) || 0));

  const idolStatusType = Math.trunc(Number(exam?.idolStatusType) || 0);
  const idolStatusStep = Math.trunc(Number(exam?.idolStatusStep) || 0);
  if (idolStatusType === 1) {
    value = runtimeF32(value * runtimeFromPermil(
      getExamRuntimeSetting(exam, idolStatusStep === 1
        ? "examConcentrationStaminaMultiplePermil1"
        : "examConcentrationStaminaMultiplePermil2"),
    ));
  } else if (idolStatusType === 2) {
    value = runtimeF32(value * runtimeFromPermil(
      getExamRuntimeSetting(exam, idolStatusStep === 1
        ? "examPreservationStaminaMultiplePermil1"
        : "examPreservationStaminaMultiplePermil2"),
    ));
  } else if (idolStatusType === 4) {
    value = runtimeF32(value * runtimeFromPermil(
      getExamRuntimeSetting(exam, "examOverPreservationStaminaMultiplePermil"),
    ));
  }

  if (Number(exam?.staminaConsumptionDown ?? 0) > 0) {
    const setting = getExamRuntimeSetting(
      exam,
      exam?.staminaConsumptionDownAdd
        ? "examStaminaConsumptionDownAddPermil"
        : "examStaminaConsumptionDownPermil",
    );
    value = runtimeF32(value * runtimeFromPermil(1000 - setting));
  }
  if (Number(exam?.staminaConsumptionAdd ?? 0) > 0) {
    const setting = getExamRuntimeSetting(
      exam,
      exam?.staminaConsumptionAddDown
        ? "examStaminaConsumptionAddDownPermil"
        : "examStaminaConsumptionAddPermil",
    );
    value = runtimeF32(value * runtimeFromPermil(1000 + setting));
  }

  let damage = Math.ceil(value);
  if (applyFixed) {
    damage += Math.max(0, Math.trunc(Number(exam?.staminaConsumptionAddFix) || 0));
    const downFix = Math.max(0, Math.trunc(Number(exam?.staminaConsumptionDownFix) || 0));
    if (downFix >= 1) damage = Math.max(0, damage - downFix);

    const changeThreshold = Math.max(0, Math.trunc(Number(exam?.staminaReduceChange) || 0));
    if (changeThreshold >= 1 && damage <= changeThreshold) {
      damage = getExamRuntimeSetting(exam, "examStaminaReduceChange");
    }
  }

  const staminaDamage = Math.max(0, damage - block);
  const blockDamage = damage - staminaDamage;
  return {
    damage: Math.max(0, Math.trunc(damage)),
    staminaDamage: Math.max(0, Math.trunc(staminaDamage)),
    blockDamage: Math.max(0, Math.trunc(blockDamage)),
  };
}

export function payCardCost(exam, card) {
  const events = [];
  const direct = Math.max(0, Math.trunc(Number(card.forceStamina ?? 0) || 0));
  const normalBase = Math.max(0, Math.trunc(Number(card.stamina ?? 0) || 0));

  if (normalBase > 0) {
    const resolved = calculateNativeStaminaDamage(exam, normalBase, {
      penetrate: false,
      applyFixed: true,
    });
    if (resolved.blockDamage > 0) {
      exam.block = Math.max(0, Number(exam.block ?? 0) - resolved.blockDamage);
    }
    if (resolved.staminaDamage > 0) {
      exam.stamina = Math.max(0, Number(exam.stamina ?? 0) - resolved.staminaDamage);
    }
    events.push(
      `体力消費 ${resolved.damage}`
      + (resolved.blockDamage ? `（元気で${resolved.blockDamage}軽減）` : ""),
    );
  }

  // forceStamina is a direct/fixed stamina cost: it bypasses Genki and the
  // normal stamina-consumption multiplier path.
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
    case "ExamCostType_ExamFullPowerPoint":
      consumeStatus(exam, "fullPowerPoint", costValue, "全力値");
      if (costValue) events.push(`全力値 -${costValue}`);
      break;
    case "ExamCostType_ExamParameterBuffMultiplePerTurn":
      consumeStatus(exam, "parameterBuffMultiplePerTurn", costValue, "絶好調");
      if (costValue) events.push(`絶好調 -${costValue}`);
      break;
    case "ExamCostType_Unknown":
    case "":
      break;
    default:
      if (costValue) throw new Error(`未対応の追加コストです: ${card.costType}`);
  }
  return events;
}

export function applyParsedExamEffect(exam, parsed, scoreContext = {}) {
  const lessonResult = (baseValue, count = 1, modifier = null) => {
    const result = applyNativeLessonHits(exam, baseValue, count, scoreContext, modifier);
    return {
      applied: true,
      label: `パラメータ +${result.added}`,
      score: result,
    };
  };

  switch (parsed.kind) {
    case "none": return { applied: false, label: "" };

    case "lesson":
      // Native LessonEffectExecutor calculates and adds every repeat
      // independently. Do not aggregate value * count before rounding.
      return lessonResult(Number(parsed.value), Math.max(1, Number(parsed.count) || 1));

    case "lesson_multiple_lesson_buff": {
      const result = applyNativeModifiedLessonRepeat(
        exam,
        Number(parsed.value),
        Number(parsed.permil),
        Math.max(1, Number(parsed.count) || 1),
        NATIVE_LESSON_MODIFIER_KIND.LessonBuff,
        scoreContext,
      );
      return {
        applied: true,
        label: `集中効果×${1 + Number(parsed.permil) / 1000}でパラメータ +${result.added}`,
        score: result,
      };
    }

    case "lesson_add_multiple_parameter_buff": {
      // ExamAddingParameterAdditionalData.ParameterBuffMultiple receives
      // 1 + effectPermil/1000 and modifies only the ParameterBuff component.
      const modifier = {
        parameterBuffMultiple: Math.fround(
          Math.fround(1) + Math.fround(Math.fround(Number(parsed.permil)) / Math.fround(1000)),
        ),
      };
      return lessonResult(
        Number(parsed.value),
        Math.max(1, Number(parsed.count) || 1),
        modifier,
      );
    }

    case "lesson_depend_parameter_buff": {
      const base = calculateNativeDependentLessonBase(
        Number(exam.parameterBuff ?? 0),
        Number(parsed.permil ?? 0),
      );
      const result = lessonResult(base, Math.max(1, Number(parsed.count) || 1));
      result.label = `好調に応じて${result.label}`;
      return result;
    }

    case "lesson_depend_exam_review": {
      const base = calculateNativeDependentLessonBase(
        Number(exam.review ?? 0),
        Number(parsed.permil ?? 0),
      );
      const result = lessonResult(base, Math.max(1, Number(parsed.count) || 1));
      result.label = `好印象に応じて${result.label}`;
      return result;
    }

    case "lesson_depend_exam_aggressive": {
      const base = calculateNativeDependentLessonBase(
        Number(exam.aggressive ?? 0),
        Number(parsed.permil ?? 0),
      );
      const result = lessonResult(base, Math.max(1, Number(parsed.count) || 1));
      result.label = `やる気に応じて${result.label}`;
      return result;
    }

    case "lesson_value_multiple":
      addNativeScoreTimedStatus(exam, "lessonParameterMultiple", parsed.permil, parsed.turn);
      return { applied: true, label: `パラメータ上昇量 +${Number(parsed.permil) / 10}%（${parsed.turn < 0 ? "∞" : parsed.turn}T）` };

    case "lesson_value_multiple_down":
      addNativeScoreTimedStatus(exam, "lessonParameterDown", parsed.permil, parsed.turn);
      return { applied: true, label: `パラメータ上昇量 -${Number(parsed.permil) / 10}%（${parsed.turn < 0 ? "∞" : parsed.turn}T）` };

    case "lesson_buff_multiple":
      addNativeScoreTimedStatus(exam, "lessonBuffMultiple", parsed.permil, parsed.turn);
      return { applied: true, label: `集中効果量 +${Number(parsed.permil) / 10}%（${parsed.turn < 0 ? "∞" : parsed.turn}T）` };

    case "review_multiple":
      addNativeScoreTimedStatus(exam, "reviewMultiple", parsed.permil, parsed.turn);
      return { applied: true, label: `好印象強化 +${Number(parsed.permil) / 10}%（${parsed.turn < 0 ? "∞" : parsed.turn}T）` };

    case "review_count_add":
      addNativeScoreTimedStatus(exam, "reviewCountAdd", parsed.value, parsed.turn);
      return { applied: true, label: `好印象追加発動 +${parsed.value}（${parsed.turn < 0 ? "∞" : parsed.turn}T）` };

    case "lesson_value_multiple_depend_review_or_aggressive":
      addNativeScoreTimedStatus(exam, "lessonValueDependReviewAggressive", 0, parsed.turn);
      return { applied: true, label: `プライド（${parsed.turn < 0 ? "∞" : parsed.turn}T）` };

    case "review_turn_end_reduce_lock":
      addNativeScoreTimedStatus(exam, "reviewTurnEndReduceLock", 0, parsed.turn);
      return { applied: true, label: `好印象ターン減少無効（${parsed.turn < 0 ? "∞" : parsed.turn}T）` };

    case "parameter_buff_turn_end_reduce_lock":
      addNativeScoreTimedStatus(exam, "parameterBuffTurnEndReduceLock", 0, parsed.turn);
      return { applied: true, label: `好調ターン減少無効（${parsed.turn < 0 ? "∞" : parsed.turn}T）` };

    case "block": {
      const value = calculateNativeBlockAdd(exam, parsed.value);
      exam.block += value;
      return { applied: true, label: `元気 +${value}` };
    }
    case "review": {
      const value = Math.max(0, Math.ceil(Number(parsed.value) * Number(exam.reviewValueMultiple ?? 1) * (1000 + Number(exam.reviewAdditivePermil ?? 0)) / 1000));
      exam.review += value;
      return { applied: true, label: `好印象 +${value}` };
    }
    case "aggressive": {
      const value = Math.max(0, Math.ceil(Number(parsed.value) * Number(exam.aggressiveValueMultiple ?? 1) * (1000 + Number(exam.aggressiveAdditivePermil ?? 0)) / 1000) + Number(exam.aggressiveAdditiveFix ?? 0));
      exam.aggressive += value;
      return { applied: true, label: `やる気 +${value}` };
    }
    case "lesson_buff": {
      const value = Math.max(0, Math.ceil(Number(parsed.value) * (1000 + Number(exam.lessonBuffAdditivePermil ?? 0)) / 1000) + Number(exam.lessonBuffAdditiveFix ?? 0));
      exam.lessonBuff += value;
      return { applied: true, label: `集中 +${value}` };
    }
    case "parameter_buff": {
      const value = Math.max(0, Math.ceil(Number(parsed.value) * (1000 + Number(exam.parameterBuffAdditivePermil ?? 0)) / 1000));
      exam.parameterBuff += value;
      return { applied: true, label: `好調 +${value}ターン` };
    }
    case "parameter_buff_reduce": {
      const before = Math.max(0, Number(exam.parameterBuff ?? 0));
      exam.parameterBuff = Math.max(0, before - Math.max(0, Number(parsed.value) || 0));
      return { applied: true, label: `好調 -${before - exam.parameterBuff}ターン` };
    }
    case "concentration":
    {
      const stance = trySetExamStance(
        exam,
        EXAM_IDOL_STATUS_TYPE.Concentration,
        Math.max(1, Number(parsed.step) || 1),
      );
      return {
        applied: true,
        command: stance.changed ? "stance_change" : undefined,
        stance,
        label: stance.changed ? `強気${stance.step}段階目に変更` : "指針変更なし",
      };
    }
    case "preservation":
    {
      const stance = trySetExamStance(
        exam,
        EXAM_IDOL_STATUS_TYPE.Preservation,
        Math.max(1, Number(parsed.step) || 1),
      );
      return {
        applied: true,
        command: stance.changed ? "stance_change" : undefined,
        stance,
        label: stance.changed ? `温存${stance.step}段階目に変更` : "指針変更なし",
      };
    }
    case "stamina_recover": {
      if (exam.staminaRecoverRestriction) return { applied: true, label: "体力回復不可" };
      const before = exam.stamina;
      exam.stamina = exam.maxStamina > 0 ? Math.min(exam.maxStamina, exam.stamina + parsed.value) : exam.stamina + parsed.value;
      return { applied: true, label: `体力 +${exam.stamina - before}` };
    }
    case "stamina_consumption_down": exam.staminaConsumptionDown += parsed.value; return { applied: true, label: `体力消費減少 +${parsed.value}ターン` };
    case "stamina_consumption_add": exam.staminaConsumptionAdd += parsed.value; return { applied: true, label: `体力消費増加 +${parsed.value}ターン` };
    case "stamina_consumption_down_fix": exam.staminaConsumptionDownFix += parsed.value; return { applied: true, label: `体力消費固定軽減 +${parsed.value}` };
    case "stamina_consumption_add_fix": exam.staminaConsumptionAddFix += parsed.value; return { applied: true, label: `体力消費固定追加 +${parsed.value}` };
    case "extra_turn":
      exam.extraTurns += Math.max(1, Number(parsed.value) || 1);
      return { applied: true, command: "extra_turn", value: Math.max(1, Number(parsed.value) || 1), label: "追加ターン +1" };
    case "card_draw": return { applied: true, command: "draw", value: parsed.value, label: `${parsed.value}枚ドロー` };
    case "card_create_id":
      return {
        applied: true,
        command: "card_create_id",
        id: parsed.id,
        cardId: parsed.cardId,
        upgradeCount: parsed.upgradeCount,
        movePosition: parsed.movePosition,
        pickCountMin: parsed.pickCountMin,
        pickCountMax: parsed.pickCountMax,
        label: `カード生成: ${parsed.cardId} ×${parsed.pickCountMin}`,
      };
    case "card_move_search":
      return {
        applied: true,
        command: "card_move_search",
        id: parsed.id,
        searchPosition: parsed.searchPosition,
        cardId: parsed.cardId,
        movePosition: parsed.movePosition,
        pickRange: parsed.pickRange,
        pickCountMin: parsed.pickCountMin,
        pickCountMax: parsed.pickCountMax,
        label: `${parsed.searchPosition} の ${parsed.cardId} を ${parsed.movePosition} へ移動`,
      };
    case "add_grow_effect":
      return {
        applied: true,
        command: "add_grow_effect",
        effect: parsed,
        label: `対象カードに元気値 +${parsed.blockAdd} / コスト +${parsed.costAdd}`,
      };
    case "playable_add": return { applied: true, command: "playable_add", value: parsed.value, label: `カード使用回数 +${parsed.value}` };
    case "effect_timer": {
      const childLabel = parsed.child ? describeParsedEffect(parsed.child) : "";
      return {
        applied: true,
        command: "timer",
        timer: parsed,
        label: childLabel
          ? `${parsed.turn}ターン後: ${childLabel}`
          : `${parsed.turn}ターン後に効果発動`,
      };
    }
    case "card_search_effect_play_count_buff": return { applied: true, command: "effect_repeat", effect: parsed, label: `次のスキルカードの効果を追加で${parsed.value}回発動` };
    case "hand_grave_count_card_draw": return { applied: true, command: "hand_swap", label: "手札をすべて入れ替え" };
    case "card_upgrade_hand_all": return { applied: true, command: "upgrade_hand", label: "手札をすべて強化" };
    case "parameter_buff_multiple_per_turn":
      exam.parameterBuffMultiplePerTurn = Math.max(Number(exam.parameterBuffMultiplePerTurn ?? 0), Number(parsed.turn ?? 0));
      return { applied: true, label: `絶好調 ${parsed.turn}ターン` };
    case "status_enchant": return { applied: true, command: "status_enchant", enchant: parsed, label: `継続効果を追加: ${parsed.enchantId}` };
    case "master_effect": return {
      applied: true,
      command: "master_effect",
      effect: parsed,
      label: parsed.id,
    };
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
