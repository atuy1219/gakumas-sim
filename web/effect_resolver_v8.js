import { executeExtendedEffect } from "./exam_effect_extensions_v8.js";

export function resolveEffect(state, effect, hooks = {}) {
  return executeExtendedEffect(state, normalizeEffect(effect), hooks);
}

function normalizeEffect(effect) {
  if (!effect) return effect;
  return {
    ...effect,
    kind: effect.kind ?? effect.type,
  };
}
