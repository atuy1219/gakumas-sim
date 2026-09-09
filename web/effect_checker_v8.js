import { ExtendedEffectKind } from "./exam_effect_extensions_v8.js";

export const EffectSupportState = Object.freeze({
  SUPPORTED: "supported",
  HOOK_REQUIRED: "hook_required",
  UNSUPPORTED: "unsupported",
});

const supported = new Set([
  ...Object.values(ExtendedEffectKind),
]);

export function checkEffectSupport(effect) {
  if (!effect) return { state: EffectSupportState.UNSUPPORTED, reason: "missing" };
  const kind = effect.kind ?? effect.type;
  if (supported.has(kind)) {
    if ([ExtendedEffectKind.CARD_DRAW, ExtendedEffectKind.CARD_SEARCH, ExtendedEffectKind.STATUS_ENCHANT].includes(kind)) {
      return { state: EffectSupportState.HOOK_REQUIRED, kind };
    }
    return { state: EffectSupportState.SUPPORTED, kind };
  }
  return { state: EffectSupportState.UNSUPPORTED, kind };
}

export function collectUnsupportedEffects(effects = []) {
  return effects
    .map((effect) => ({ effect, result: checkEffectSupport(effect) }))
    .filter((x) => x.result.state === EffectSupportState.UNSUPPORTED);
}
