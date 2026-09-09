import { classifyEffects } from "./effect_checker_v8.js";

function normalizeEffect(effect, source = "unknown") {
  if (!effect || typeof effect !== "object") {
    return {
      source,
      raw: effect,
      invalid: true,
    };
  }

  return {
    ...effect,
    source,
    id: String(effect.id ?? effect.effectId ?? ""),
    kind: effect.kind ?? effect.type ?? effect.effectType ?? effect.effectId,
  };
}

export function collectEffectMasterEntries({
  cards = [],
  items = [],
  memories = [],
} = {}) {
  return [
    ...cards.map((e) => normalizeEffect(e, "card")),
    ...items.map((e) => normalizeEffect(e, "item")),
    ...memories.map((e) => normalizeEffect(e, "memory")),
  ];
}

export function generateEffectReport(effectEntries = []) {
  const result = classifyEffects(effectEntries);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: effectEntries.length,
      supported: result.supported.length,
      hookRequired: result.hookRequired.length,
      unsupported: result.unsupported.length,
      invalid: result.invalid.length,
    },
    supported: result.supported,
    hookRequired: result.hookRequired,
    unsupported: result.unsupported,
    invalid: result.invalid,
  };
}

export function printEffectReport(report) {
  return JSON.stringify(report, null, 2);
}
