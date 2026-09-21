import { normalizeCustomizes } from "./memory_judgement.js";

const UNKNOWN_GROW_TYPE = "ProduceCardGrowEffectType_Unknown";

function growType(effect) {
  return String(effect?.effectType ?? "");
}

function clonePlayEffects(playEffects) {
  return Array.isArray(playEffects) ? playEffects.map((effect) => ({ ...effect })) : [];
}

function adjustNonNegative(value, delta) {
  return Math.max(0, Number(value ?? 0) + Number(delta ?? 0));
}

function applyCostGrow(card, effect) {
  const type = growType(effect);
  const value = Number(effect?.value ?? 0) || 0;
  const sign = type.endsWith("Reduce") ? -1 : 1;

  if (type === "ProduceCardGrowEffectType_CostAdd" || type === "ProduceCardGrowEffectType_CostReduce") {
    card.stamina = adjustNonNegative(card.stamina, sign * value);
    return true;
  }
  if (type === "ProduceCardGrowEffectType_CostPenetrateAdd" || type === "ProduceCardGrowEffectType_CostPenetrateReduce") {
    card.forceStamina = adjustNonNegative(card.forceStamina, sign * value);
    return true;
  }

  const targetCostType = String(effect?.costType ?? "");
  if (!type.startsWith("ProduceCardGrowEffectType_Cost") || !targetCostType || targetCostType === "ExamCostType_Unknown") {
    return false;
  }
  if (String(card.costType ?? "") !== targetCostType) return false;
  card.costValue = adjustNonNegative(card.costValue, sign * value);
  return true;
}

function applyEffectGrow(card, effect) {
  const type = growType(effect);
  const playEffectId = String(effect?.playProduceExamEffectId ?? effect?.playEffectId ?? "");
  if (type === "ProduceCardGrowEffectType_EffectAdd" && playEffectId) {
    card.playEffects.push({
      produceExamTriggerId: String(effect?.playEffectProduceExamTriggerId ?? ""),
      produceExamEffectId: playEffectId,
    });
    return true;
  }

  if (type === "ProduceCardGrowEffectType_EffectChange" && playEffectId) {
    const targets = new Set((effect?.targetPlayProduceExamEffectIds ?? []).map(String));
    if (targets.size) {
      for (const entry of card.playEffects) {
        if (targets.has(String(entry?.produceExamEffectId ?? ""))) entry.produceExamEffectId = playEffectId;
      }
    } else if (card.playEffects.length) {
      for (const entry of card.playEffects) entry.produceExamEffectId = playEffectId;
    } else {
      card.playEffects.push({ produceExamTriggerId: "", produceExamEffectId: playEffectId });
    }
    return true;
  }

  if (type === "ProduceCardGrowEffectType_PlayEffectTriggerChange") {
    const nextTrigger = String(effect?.playEffectProduceExamTriggerId ?? "");
    if (!nextTrigger) return false;
    const targets = new Set((effect?.targetPlayEffectProduceExamTriggerIds ?? []).map(String));
    for (const entry of card.playEffects) {
      const current = String(entry?.produceExamTriggerId ?? "");
      if (!targets.size || targets.has(current)) entry.produceExamTriggerId = nextTrigger;
    }
    return true;
  }

  return false;
}

export function resolveCardCustomizationGrowEffects(
  card,
  customizeById = new Map(),
  growEffectById = new Map(),
) {
  const customizes = normalizeCustomizes(card?.customizes);
  const active = [];
  const unresolved = [];

  for (const customize of customizes) {
    const route = customizeById?.get?.(String(customize.id));
    const level = route?.levels?.get?.(Number(customize.customizeCount));
    if (!level) {
      unresolved.push(`customize:${customize.id}@${customize.customizeCount}`);
      continue;
    }

    const overwriteType = String(level.overwriteType ?? "");
    if (overwriteType && overwriteType !== UNKNOWN_GROW_TYPE) {
      for (let index = active.length - 1; index >= 0; index -= 1) {
        if (growType(active[index]) === overwriteType) active.splice(index, 1);
      }
    }

    for (const growEffectId of level.growEffectIds ?? []) {
      const growEffect = growEffectById?.get?.(String(growEffectId));
      if (!growEffect) {
        unresolved.push(`grow:${growEffectId}`);
        continue;
      }
      active.push({
        ...growEffect,
        customizeId: String(customize.id),
        customizeCount: Number(customize.customizeCount),
      });
    }
  }

  return { customizes, growEffects: active, unresolved };
}

export function applyCardCustomizations(
  cardInput,
  customizeById = new Map(),
  growEffectById = new Map(),
) {
  const card = {
    ...cardInput,
    playEffects: clonePlayEffects(cardInput?.playEffects),
  };
  const resolved = resolveCardCustomizationGrowEffects(card, customizeById, growEffectById);

  for (const effect of resolved.growEffects) {
    const type = growType(effect);
    if (applyCostGrow(card, effect) || applyEffectGrow(card, effect)) continue;

    if (type === "ProduceCardGrowEffectType_PlayMovePositionTypeChange") {
      const move = String(effect?.playMovePositionType ?? effect?.movePositionType ?? "");
      if (move && move !== "ProduceCardMovePositionType_Unknown") card.playMovePositionType = move;
      continue;
    }

    if (type === "ProduceCardGrowEffectType_PlayTriggerChange") {
      const nextTrigger = String(effect?.playProduceExamTriggerId ?? "");
      if (!nextTrigger) continue;
      const targets = new Set((effect?.targetPlayEffectProduceExamTriggerIds ?? []).map(String));
      const current = String(card.playProduceExamTriggerId ?? "");
      if (!targets.size || targets.has(current)) card.playProduceExamTriggerId = nextTrigger;
      continue;
    }

    if (type === "ProduceCardGrowEffectType_CardStatusEnchantChange") {
      card.produceCardStatusEnchantId = String(
        effect?.produceCardStatusEnchantId ?? effect?.statusEnchantId ?? "",
      );
      continue;
    }

    if (type === "ProduceCardGrowEffectType_InitialAdd") {
      card.isInitial = true;
    }
  }

  card.customGrowEffects = resolved.growEffects.map((effect) => ({ ...effect }));
  card.customGrowEffectIds = resolved.growEffects.map((effect) => String(effect.id));
  card.customizationUnresolved = [...resolved.unresolved];
  return card;
}

function growTotal(card, type) {
  return (card?.customGrowEffects ?? []).reduce(
    (sum, effect) => sum + (growType(effect) === type ? Number(effect?.value ?? 0) || 0 : 0),
    0,
  );
}

function adjustGain(card, value, addType, reduceType = "") {
  const original = Number(value ?? 0) || 0;
  let next = original + growTotal(card, addType);
  if (reduceType) next -= growTotal(card, reduceType);
  if (original > 0 && reduceType) return Math.max(1, next);
  return Math.max(0, next);
}

export function applyCardGrowEffectsToParsedEffect(parsedInput, card) {
  if (!parsedInput || typeof parsedInput !== "object") return parsedInput;
  const parsed = { ...parsedInput };

  switch (parsed.kind) {
    case "lesson":
      parsed.value = adjustGain(
        card,
        parsed.value,
        "ProduceCardGrowEffectType_LessonAdd",
        "ProduceCardGrowEffectType_LessonReduce",
      );
      parsed.count = Math.max(
        1,
        Number(parsed.count ?? 1)
          + growTotal(card, "ProduceCardGrowEffectType_LessonCountAdd")
          - growTotal(card, "ProduceCardGrowEffectType_LessonCountReduce"),
      );
      break;
    case "block":
      parsed.value = adjustGain(
        card,
        parsed.value,
        "ProduceCardGrowEffectType_BlockAdd",
        "ProduceCardGrowEffectType_BlockReduce",
      );
      break;
    case "review":
      parsed.value = adjustGain(card, parsed.value, "ProduceCardGrowEffectType_ReviewAdd");
      break;
    case "aggressive":
      parsed.value = adjustGain(card, parsed.value, "ProduceCardGrowEffectType_AggressiveAdd");
      break;
    case "lesson_buff":
      parsed.value = adjustGain(card, parsed.value, "ProduceCardGrowEffectType_LessonBuffAdd");
      break;
    case "parameter_buff":
      parsed.value = adjustGain(card, parsed.value, "ProduceCardGrowEffectType_ParameterBuffTurnAdd");
      break;
    case "lesson_depend_exam_review":
      parsed.permil = Math.max(
        0,
        Number(parsed.permil ?? 0) + growTotal(card, "ProduceCardGrowEffectType_LessonDependExamReviewAdd"),
      );
      break;
    case "lesson_depend_exam_aggressive":
      parsed.permil = Math.max(
        0,
        Number(parsed.permil ?? 0) + growTotal(card, "ProduceCardGrowEffectType_LessonDependExamCardPlayAggressiveAdd"),
      );
      break;
  }

  return parsed;
}
