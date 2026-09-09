import { ExtendedEffectKind } from "./exam_effect_extensions_v8.js";

export const EffectSupportState = Object.freeze({
  SUPPORTED: "supported",
  HOOK_REQUIRED: "hook_required",
  UNSUPPORTED: "unsupported",
  INVALID: "invalid",
});

const supported = new Set(Object.values(ExtendedEffectKind));

const hookKinds = new Set([
  ExtendedEffectKind.CARD_DRAW,
  ExtendedEffectKind.CARD_SEARCH,
  ExtendedEffectKind.STATUS_ENCHANT,
]);

function normalizeKind(effect) {
  return effect?.kind ?? effect?.type ?? effect?.effectType ?? null;
}

export function checkEffectSupport(effect) {
  if (!effect || typeof effect !== "object") {
    return { state: EffectSupportState.INVALID, reason: "missing_or_invalid" };
  }

  const kind = normalizeKind(effect);

  if (supported.has(kind)) {
    if (hookKinds.has(kind)) {
      return { state: EffectSupportState.HOOK_REQUIRED, kind };
    }
    return { state: EffectSupportState.SUPPORTED, kind };
  }

  const text = JSON.stringify(effect).toLowerCase();
  if (["timer", "turn_end", "after_card", "condition", "enchant"].some((x) => text.includes(x))) {
    return {
      state: EffectSupportState.HOOK_REQUIRED,
      kind,
      reason: "runtime_hook",
    };
  }

  return { state: EffectSupportState.UNSUPPORTED, kind };
}

export function classifyEffects(effects = []) {
  const result = {
    supported: [],
    hookRequired: [],
    unsupported: [],
    invalid: [],
  };

  for (const effect of effects) {
    const item = { effect, result: checkEffectSupport(effect) };
    switch (item.result.state) {
      case EffectSupportState.SUPPORTED:
        result.supported.push(item);
        break;
      case EffectSupportState.HOOK_REQUIRED:
        result.hookRequired.push(item);
        break;
      case EffectSupportState.INVALID:
        result.invalid.push(item);
        break;
      default:
        result.unsupported.push(item);
    }
  }

  return result;
}

export function collectUnsupportedEffects(effects = []) {
  const result = classifyEffects(effects);
  return result.unsupported;
}

export function createEffectReport(effects = []) {
  const result = classifyEffects(effects);
  return {
    total: effects.length,
    supported: result.supported.length,
    hookRequired: result.hookRequired.length,
    unsupported: result.unsupported.length,
    invalid: result.invalid.length,
    details: result,
  };
}
