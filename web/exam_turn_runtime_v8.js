import { executeExtendedEffect } from "./exam_effect_extensions_v8.js";

export function processTurnEnd(state, hooks = {}) {
  const expired = [];

  for (const status of state.statuses ?? []) {
    if (status.kind !== "Timer") continue;
    status.turn = Number(status.turn ?? 0) - 1;
    if (status.turn <= 0) {
      expired.push(status);
    }
  }

  for (const timer of expired) {
    if (timer.effect) {
      executeExtendedEffect(state, timer.effect, hooks);
    }
    state.statuses = state.statuses.filter((x) => x !== timer);
  }
}
