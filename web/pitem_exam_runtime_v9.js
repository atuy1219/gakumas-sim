import { parseExamEffectId, parseYamlRecordsWithLists } from "./exam_effects_v7.js";

export const PITEM_EXAM_MASTER_URLS = Object.freeze({
  statusEnchants: [
    "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceExamStatusEnchant.yaml",
  ],
  triggers: [
    "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceExamTrigger.yaml",
    "https://raw.githubusercontent.com/zliu-aki/simple_gakuen_idolmaster/main/yaml/ProduceExamTrigger.yaml",
  ],
});

const PHASE_MAP = Object.freeze({
  ProduceExamPhaseType_ExamStartExam: "start_exam",
  ProduceExamPhaseType_ExamStartTurn: "start_turn",
  ProduceExamPhaseType_ExamCardPlay: "card_play",
  ProduceExamPhaseType_ExamCardPlayAfter: "card_play_after",
  ProduceExamPhaseType_ExamEndTurn: "end_turn",
});

const LESSON_TYPE_MAP = Object.freeze({
  ProduceStepLessonType_LessonVocal: "Vo",
  ProduceStepLessonType_LessonDance: "Da",
  ProduceStepLessonType_LessonVisual: "Vi",
});

let masterPromise = null;
let masterCatalog = {
  ready: false,
  statusEnchants: [],
  statusEnchantById: new Map(),
  triggers: [],
  triggerById: new Map(),
  error: null,
};

async function fetchFirst(urls, fetchImpl) {
  let lastError = null;
  for (const url of urls ?? []) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) {
        lastError = new Error(`${url}: HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      if (text.trim()) return text;
      lastError = new Error(`${url}: empty response`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Pアイテム試験効果マスタを取得できません。");
}

export function parsePItemStatusEnchantCatalog(text) {
  return parseYamlRecordsWithLists(
    text,
    ["assetId", "produceExamTriggerId"],
    ["produceExamEffectIds"],
  );
}

export function parsePItemExamTriggerCatalog(text) {
  return parseYamlRecordsWithLists(
    text,
    ["produceCardSearchId", "upperSearchCount", "lowerSearchCount", "cardMovePositionType", "lessonType"],
    ["phaseTypes", "phaseValues", "fieldStatusCheckTypes", "fieldStatusTypes", "fieldStatusValues", "fieldStatusProduceCardSearchIds", "effectTypes"],
  );
}

export async function loadPItemExamMaster(fetchImpl = globalThis.fetch, urls = PITEM_EXAM_MASTER_URLS) {
  if (masterCatalog.ready) return masterCatalog;
  if (masterPromise) return masterPromise;
  if (typeof fetchImpl !== "function") throw new Error("Pアイテム試験効果マスタを取得する fetch がありません。");

  masterPromise = (async () => {
    try {
      const [enchantText, triggerText] = await Promise.all([
        fetchFirst(urls.statusEnchants, fetchImpl),
        fetchFirst(urls.triggers, fetchImpl),
      ]);
      const statusEnchants = parsePItemStatusEnchantCatalog(enchantText);
      const triggers = parsePItemExamTriggerCatalog(triggerText);
      masterCatalog = {
        ready: true,
        statusEnchants,
        statusEnchantById: new Map(statusEnchants.map((row) => [String(row.id), row])),
        triggers,
        triggerById: new Map(triggers.map((row) => [String(row.id), row])),
        error: null,
      };
      return masterCatalog;
    } catch (error) {
      masterCatalog = { ...masterCatalog, ready: false, error };
      throw error;
    } finally {
      masterPromise = null;
    }
  })();
  return masterPromise;
}

export function getPItemExamMaster() {
  return masterCatalog;
}

export function isPItemExamMasterReady() {
  return Boolean(masterCatalog.ready);
}

function boundedTurns(raw) {
  const value = Number(raw ?? -1);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.max(1, Math.trunc(value));
}

function boundedCount(raw) {
  const value = Number(raw ?? 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

function rememberUnsupported(state, value) {
  const text = String(value ?? "").trim();
  if (!text) return;
  state.unsupported ??= [];
  if (!state.unsupported.includes(text)) state.unsupported.push(text);
}

export function initializePItemExamRuntime(state, master = getPItemExamMaster()) {
  const enchants = [];
  if (!(master?.ready && master.statusEnchantById instanceof Map && master.triggerById instanceof Map)) {
    if ((state.pItems ?? []).some((item) => (item.effects ?? []).some((effect) => effect.effectType === "ProduceItemEffectType_ExamStatusEnchant"))) {
      rememberUnsupported(state, "pitem-master:not-loaded");
    }
    state.pItemEnchants = enchants;
    return enchants;
  }

  for (const item of state.pItems ?? []) {
    for (const effect of item.effects ?? []) {
      if (String(effect.effectType ?? "") !== "ProduceItemEffectType_ExamStatusEnchant") continue;
      const enchantId = String(effect.produceExamStatusEnchantId ?? "").trim();
      const enchant = master.statusEnchantById.get(enchantId);
      if (!enchant) {
        rememberUnsupported(state, `pitem-enchant:${enchantId || effect.id}`);
        continue;
      }
      const triggerId = String(enchant.produceExamTriggerId ?? "").trim();
      if (!master.triggerById.has(triggerId)) {
        rememberUnsupported(state, `pitem-trigger:${triggerId || enchantId}`);
        continue;
      }
      enchants.push({
        enchantId,
        triggerId,
        effectIds: (enchant.produceExamEffectIds ?? []).map(String).filter(Boolean),
        remainingTurns: boundedTurns(effect.effectTurn),
        remainingCount: boundedCount(effect.effectCount),
        sourceItemId: String(item.id ?? item.name ?? enchantId),
        sourceItemName: String(item.name ?? item.id ?? enchantId),
        appliedTurn: Number(state.turn ?? 0),
      });
    }
  }
  state.pItemEnchants = enchants;
  return enchants;
}

function phaseMatch(trigger, context) {
  const phaseTypes = trigger.phaseTypes ?? [];
  const phaseValues = trigger.phaseValues ?? [];
  let sawKnown = false;
  for (let index = 0; index < phaseTypes.length; index += 1) {
    const phaseType = String(phaseTypes[index]);
    if (phaseType === "ProduceExamPhaseType_ExamTurnTimer") {
      sawKnown = true;
      const expectedTurn = Number(phaseValues[index] ?? phaseValues[0] ?? 0);
      if (context.phase === "start_turn" && Number(context.turn ?? 0) === expectedTurn) return { matched: true, supported: true };
      continue;
    }
    const mapped = PHASE_MAP[phaseType];
    if (!mapped) continue;
    sawKnown = true;
    if (mapped === context.phase) return { matched: true, supported: true };
  }
  return sawKnown ? { matched: false, supported: true } : { matched: false, supported: false, reason: `phase:${phaseTypes.join(",")}` };
}

function currentStatusValue(type, context) {
  const exam = context.exam ?? {};
  switch (String(type ?? "")) {
    case "ProduceExamFieldStatusType_ParameterBuff":
    case "ProduceExamFieldStatusType_ParameterBuffUp": return { supported: true, value: Number(exam.parameterBuff ?? 0), mode: "min" };
    case "ProduceExamFieldStatusType_ConcentrationUp":
    case "ProduceExamFieldStatusType_LessonBuffUp": return { supported: true, value: Number(exam.lessonBuff ?? 0), mode: "min" };
    case "ProduceExamFieldStatusType_ReviewUp": return { supported: true, value: Number(exam.review ?? 0), mode: "min" };
    case "ProduceExamFieldStatusType_AggressiveUp":
    case "ProduceExamFieldStatusType_CardPlayAggressiveUp": return { supported: true, value: Number(exam.aggressive ?? 0), mode: "min" };
    case "ProduceExamFieldStatusType_BlockUp": return { supported: true, value: Number(exam.block ?? 0), mode: "min" };
    case "ProduceExamFieldStatusType_CardPlayCountUp": return { supported: true, value: Number(exam.cardPlayCount ?? 0), mode: "min" };
    case "ProduceExamFieldStatusType_TurnProgressUp": return { supported: true, value: Math.max(0, Number(context.turn ?? 0) - 1), mode: "min" };
    case "ProduceExamFieldStatusType_StaminaUpMultiple": {
      const max = Number(exam.maxStamina ?? 0);
      return { supported: max > 0, value: max > 0 ? Number(exam.stamina ?? 0) * 1000 / max : 0, mode: "min" };
    }
    case "ProduceExamFieldStatusType_StaminaLessMultiple": {
      const max = Number(exam.maxStamina ?? 0);
      return { supported: max > 0, value: max > 0 ? Number(exam.stamina ?? 0) * 1000 / max : 0, mode: "max" };
    }
    default: return { supported: false, value: 0, mode: "min" };
  }
}

function fieldStatusMatch(trigger, context) {
  const types = trigger.fieldStatusTypes ?? [];
  const values = trigger.fieldStatusValues ?? [];
  const checks = trigger.fieldStatusCheckTypes ?? [];
  for (let index = 0; index < types.length; index += 1) {
    const type = String(types[index] ?? "");
    const status = currentStatusValue(type, context);
    if (!status.supported) return { matched: false, supported: false, reason: `field:${type}` };
    const threshold = Number(values[index] ?? 0);
    let matched = status.mode === "max" ? status.value <= threshold : status.value >= threshold;
    if (String(checks[index] ?? "") === "ProduceExamTriggerCheckType_Not") matched = !matched;
    if (!matched) return { matched: false, supported: true };
  }
  return { matched: true, supported: true };
}

function lessonTypeMatch(trigger, context) {
  const lessonType = String(trigger.lessonType ?? "");
  const expected = LESSON_TYPE_MAP[lessonType];
  if (!expected) return { matched: true, supported: true };
  if (!context.turnType) return { matched: false, supported: false, reason: `turn-type:${expected}` };
  return { matched: String(context.turnType) === expected, supported: true };
}

function cardSearchMatch(trigger, context) {
  const searchId = String(trigger.produceCardSearchId ?? "").trim();
  if (!searchId) return { matched: true, supported: true };
  const card = context.card;
  if (!card) return { matched: false, supported: true };
  const category = String(card.category ?? "");
  if (searchId.includes("active_skill") && category !== "ProduceCardCategory_ActiveSkill") return { matched: false, supported: true };
  if (searchId.includes("mental_skill") && category !== "ProduceCardCategory_MentalSkill") return { matched: false, supported: true };
  if (searchId.includes("trouble") && category !== "ProduceCardCategory_Trouble") return { matched: false, supported: true };

  // Search ids with identity/rarity/effect filters require ProduceCardSearch master,
  // which this lightweight web runtime does not have yet. Do not guess them.
  if (/(idol|unique|rarity|effect_group|ssr|sr)(?:-|$)/.test(searchId)) {
    return { matched: false, supported: false, reason: `card-search:${searchId}` };
  }
  return { matched: true, supported: true };
}

export function matchPItemExamTrigger(trigger, context = {}) {
  if (!trigger) return { matched: false, supported: false, reason: "trigger:missing" };
  for (const result of [
    phaseMatch(trigger, context),
    lessonTypeMatch(trigger, context),
    fieldStatusMatch(trigger, context),
    cardSearchMatch(trigger, context),
  ]) {
    if (!result.supported || !result.matched) return result;
  }
  return { matched: true, supported: true };
}

export function dispatchPItemExamPhase(state, phase, event, executeEffect, master = getPItemExamMaster(), card = null) {
  if (!Array.isArray(state.pItemEnchants) || !state.pItemEnchants.length) return [];
  const fired = [];
  const firedSources = new Set();
  const context = {
    phase,
    turn: Number(state.turn ?? 0),
    turnType: state.currentTurnType ?? null,
    exam: state.exam ?? {},
    card,
  };

  for (const enchant of [...state.pItemEnchants]) {
    if (enchant.remainingCount != null && enchant.remainingCount <= 0) continue;
    if (firedSources.has(enchant.sourceItemId)) continue;
    const trigger = master.triggerById?.get?.(String(enchant.triggerId));
    const result = matchPItemExamTrigger(trigger, context);
    if (!result.supported) {
      rememberUnsupported(state, `pitem-${result.reason ?? enchant.triggerId}`);
      continue;
    }
    if (!result.matched) continue;

    for (const effectId of enchant.effectIds ?? []) {
      executeEffect(parseExamEffectId(effectId), event, enchant);
    }
    fired.push({ enchantId: enchant.enchantId, sourceItemId: enchant.sourceItemId, phase });
    firedSources.add(enchant.sourceItemId);
    if (enchant.remainingCount != null) enchant.remainingCount -= 1;
  }

  state.pItemEnchants = state.pItemEnchants.filter((enchant) => enchant.remainingCount == null || enchant.remainingCount > 0);
  return fired;
}

export function tickPItemEnchantTurns(state) {
  if (!Array.isArray(state.pItemEnchants)) return;
  const currentTurn = Number(state.turn ?? 0);
  for (const enchant of state.pItemEnchants) {
    if (enchant.remainingTurns == null) continue;
    if (Number(enchant.appliedTurn ?? 0) < currentTurn) enchant.remainingTurns -= 1;
  }
  state.pItemEnchants = state.pItemEnchants.filter((enchant) => enchant.remainingTurns == null || enchant.remainingTurns > 0);
}
