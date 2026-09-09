import { checkEffectSupport, EffectSupportState } from "./effect_checker_v8.js";

export function checkEffectList(effects = []) {
  return effects.map((effect) => ({
    effect,
    result: checkEffectSupport(effect),
  }));
}

export function getUnsupportedEffects(effects = []) {
  return checkEffectList(effects).filter((x) =>
    x.result.state === EffectSupportState.UNSUPPORTED || x.result.state === EffectSupportState.INVALID,
  );
}
