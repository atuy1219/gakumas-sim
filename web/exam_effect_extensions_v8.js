import { UnsupportedRuntimePath, StatusKind, addStatus, addParameterBuff, addLessonBuff, executeExamEffect } from "./exam_runtime_v8.js";

export const ExtendedEffectKind = Object.freeze({
  TIMER: "Timer",
  PARAMETER_BUFF_MULTIPLE_PER_TURN: "ParameterBuffMultiplePerTurn",
  LESSON_DEPEND_PARAMETER_BUFF: "LessonDependParameterBuff",
  CARD_DRAW: "CardDraw",
  CARD_SEARCH: "CardSearch",
  STATUS_ENCHANT: "StatusEnchant",
});

export function addTimedEffect(state, effect, turns) {
  addStatus(state, {
    kind: StatusKind.TIMER,
    turnLimited: true,
    turn: Number(turns),
    effect,
  });
}

export function addParameterBuffMultiplePerTurn(state, value) {
  addStatus(state, {
    kind: StatusKind.PARAMETER_BUFF_MULTIPLE_PER_TURN,
    value: Number(value),
  });
}

export function calculateLessonByParameterBuff(value, state, permil) {
  const buffTurns = state.statuses
    .filter((x) => x.kind === StatusKind.PARAMETER_BUFF)
    .reduce((sum, x) => sum + Number(x.turn ?? 0), 0);
  return Math.ceil(Number(value) * (1 + buffTurns * Number(permil) / 1000));
}

export function executeExtendedEffect(state, effect, hooks = {}) {
  if (!effect) throw new UnsupportedRuntimePath("ExamEffect", "missing effect");

  const kind = effect.kind ?? effect.type;
  switch (kind) {
    case ExtendedEffectKind.PARAMETER_BUFF_MULTIPLE_PER_TURN:
      addParameterBuffMultiplePerTurn(state, effect.value ?? 0);
      return;
    case ExtendedEffectKind.LESSON_DEPEND_PARAMETER_BUFF:
      return {
        value: calculateLessonByParameterBuff(effect.value ?? 0, state, effect.permil ?? 0),
      };
    case ExtendedEffectKind.TIMER:
      addTimedEffect(state, effect.child, effect.turn ?? 1);
      return;
    case ExtendedEffectKind.CARD_DRAW:
      if (!hooks.draw) throw new UnsupportedRuntimePath("CardDraw", "draw hook required");
      hooks.draw(effect.count ?? 1);
      return;
    case ExtendedEffectKind.CARD_SEARCH:
      if (!hooks.search) throw new UnsupportedRuntimePath("CardSearch", "search hook required");
      hooks.search(effect);
      return;
    case ExtendedEffectKind.STATUS_ENCHANT:
      if (!hooks.enchant) throw new UnsupportedRuntimePath("StatusEnchant", "enchant hook required");
      hooks.enchant(effect);
      return;
    default:
      return executeExamEffect(state, effect, hooks);
  }
}
