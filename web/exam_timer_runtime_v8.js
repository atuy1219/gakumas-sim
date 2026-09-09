import { addStatus, StatusKind, UnsupportedRuntimePath } from "./exam_runtime_v8.js";

export function addTimerEffect(state, childEffect, turns = 1) {
  addStatus(state, {
    kind: StatusKind.TIMER,
    turnLimited: true,
    turn: Number(turns),
    childEffect,
  });
}

export function tickTimerEffects(state, execute) {
  const expired = [];
  for (const status of state.statuses) {
    if (status.kind !== StatusKind.TIMER) continue;
    status.turn -= 1;
    if (status.turn <= 0) expired.push(status);
  }

  for (const status of expired) {
    state.statuses.splice(state.statuses.indexOf(status), 1);
    if (typeof execute !== "function") {
      throw new UnsupportedRuntimePath("TimerEffect", "executor required");
    }
    execute(status.childEffect);
  }
}
