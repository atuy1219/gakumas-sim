export class UnsupportedRuntimePath extends Error {
  constructor(path, detail = "") {
    super(`${path}: ${detail || "runtime path is not implemented"}`);
    this.name = "UnsupportedRuntimePath";
    this.path = path;
    this.detail = detail;
  }
}

const F32 = new Float32Array(1);
export function f32(value) {
  F32[0] = Number(value);
  return F32[0];
}

function ceilF32(value) { return Math.ceil(f32(value)); }
function floorF32(value) { return Math.floor(f32(value)); }
function fromPermil(value) { return f32(f32(Number(value)) / f32(1000)); }

export const StatusKind = Object.freeze({
  PARAMETER_BUFF: "ParameterBuff",
  REVIEW: "Review",
  LESSON_BUFF: "LessonBuff",
  SLUMP: "Slump",
  PARAMETER_BUFF_ADDITIVE_FIX: "ParameterBuffAdditiveFix",
  PARAMETER_BUFF_ADDITIVE_MULTIPLE: "ParameterBuffAdditiveMultiple",
  REVIEW_ADDITIVE_FIX: "ReviewAdditiveFix",
  REVIEW_ADDITIVE_MULTIPLE: "ReviewAdditiveMultiple",
  LESSON_BUFF_ADDITIVE_FIX: "LessonBuffAdditiveFix",
  LESSON_BUFF_ADDITIVE_MULTIPLE: "LessonBuffAdditiveMultiple",
  PARAMETER_BUFF_MULTIPLE_PER_TURN: "ParameterBuffMultiplePerTurn",
  PARAMETER_DEBUFF: "ParameterDebuff",
  LESSON_DEBUFF: "LessonDebuff",
  ENTHUSIASTIC: "Enthusiastic",
  LESSON_PARAMETER_MULTIPLE: "LessonParameterMultiple",
  LESSON_PARAMETER_DOWN: "LessonParameterDown",
  LESSON_BUFF_MULTIPLE: "LessonBuffMultiple",
  BLOCK_RESTRICTION: "BlockRestriction",
  AGGRESSIVE: "Aggressive",
  BLOCK_ADD_DOWN: "BlockAddDown",
  BLOCK_ADD_DOWN_FIX: "BlockAddDownFix",
  STAMINA_CONSUMPTION_DOWN: "StaminaConsumptionDown",
  STAMINA_CONSUMPTION_ADD: "StaminaConsumptionAdd",
  STAMINA_CONSUMPTION_DOWN_FIX: "StaminaConsumptionDownFix",
  STAMINA_CONSUMPTION_ADD_FIX: "StaminaConsumptionAddFix",
  STAMINA_REDUCE_CHANGE: "StaminaReduceChange",
  STAMINA_CONSUMPTION_DOWN_ADD: "StaminaConsumptionDownAdd",
  STAMINA_CONSUMPTION_ADD_DOWN: "StaminaConsumptionAddDown",
  UPLIFTING: "Uplifting",
  CONCENTRATION_LESSON_MULTIPLE_ADDITIVE: "ConcentrationLessonMultipleAdditive",
  FULL_POWER_LESSON_MULTIPLE_ADDITIVE: "FullPowerLessonMultipleAdditive",
  LESSON_VALUE_DEPEND_REVIEW_AGGRESSIVE: "LessonValueMultipleDependReviewOrAggressive",
  TIMER: "Timer",
  TRIGGER: "Trigger",
  ENCHANT: "Enchant",
});

export function createExamRuntimeState(options = {}) {
  const stamina = Number(options.stamina ?? 0);
  return {
    judgeParameter: Number(options.judgeParameter ?? 0),
    parameterAddLimit: options.parameterAddLimit == null ? null : Number(options.parameterAddLimit),
    stamina,
    maxStamina: Number(options.maxStamina ?? stamina),
    block: Number(options.block ?? 0),
    currentTurn: Number(options.currentTurn ?? 0),
    remainTurn: Number(options.remainTurn ?? 0),
    extraTurn: Number(options.extraTurn ?? 0),
    currentTurnConsumeStamina: Number(options.currentTurnConsumeStamina ?? 0),
    reviewConsumptionSumCount: Number(options.reviewConsumptionSumCount ?? 0),
    idolStatusType: Number(options.idolStatusType ?? 0),
    idolStatusStep: Number(options.idolStatusStep ?? 0),
    statusCreateCount: 0,
    statuses: (options.statuses ?? []).map((x) => ({ ...x })),
    settingSlots: { ...(options.settingSlots ?? {}) },
  };
}

function activeStatuses(state, kind) {
  return state.statuses.filter((x) => x.kind === kind && !(x.turnLimited && Number(x.turn) <= 0));
}
export function hasStatus(state, kind) { return activeStatuses(state, kind).length > 0; }
export function statusValue(state, kind) { return activeStatuses(state, kind).reduce((s, x) => s + Number(x.value ?? 0), 0); }
export function statusTurn(state, kind) { return Number(activeStatuses(state, kind)[0]?.turn ?? 0); }
function firstStatus(state, kind) { return activeStatuses(state, kind)[0] ?? null; }
function ratioMultiple(state, kind) {
  let value = f32(1);
  for (const status of activeStatuses(state, kind)) {
    value = f32(value + f32(f32(Number(status.value ?? 0)) / f32(1000)));
  }
  return value;
}
function setting(state, slot, why) {
  if (!Object.prototype.hasOwnProperty.call(state.settingSlots, String(slot)) &&
      !Object.prototype.hasOwnProperty.call(state.settingSlots, slot)) {
    throw new UnsupportedRuntimePath("IExamSetting.Get", `slot ${slot} required by ${why}; field mapping is not available`);
  }
  return Number(state.settingSlots[slot] ?? state.settingSlots[String(slot)]);
}
function nextUid(state) { state.statusCreateCount += 1; return state.statusCreateCount; }

export function addStatus(state, status) {
  state.statuses.push({ uid: nextUid(state), turnLimited: false, value: 0, turn: 0, ...status });
}

function applyAdditive(state, value, fixKind, multipleKind) {
  const fixed = Number(value) + statusValue(state, fixKind);
  const multiple = ratioMultiple(state, multipleKind);
  return ceilF32(f32(f32(fixed) * multiple));
}

export function addParameterBuff(state, turn) {
  const resolved = applyAdditive(state, Number(turn), StatusKind.PARAMETER_BUFF_ADDITIVE_FIX, StatusKind.PARAMETER_BUFF_ADDITIVE_MULTIPLE);
  if (resolved < 0) throw new UnsupportedRuntimePath("TryAddParameterBuffStatus", "negative turn");
  const current = firstStatus(state, StatusKind.PARAMETER_BUFF);
  if (current) {
    if (!current.turnLimited) throw new UnsupportedRuntimePath("TryAddParameterBuffStatus", "existing status is not turn-limited");
    current.turn = Number(current.turn) + resolved;
  } else {
    addStatus(state, { kind: StatusKind.PARAMETER_BUFF, turn: resolved, turnLimited: true });
  }
}

export function addReview(state, turn, isFix = false) {
  const resolved = isFix ? Number(turn) : applyAdditive(state, Number(turn), StatusKind.REVIEW_ADDITIVE_FIX, StatusKind.REVIEW_ADDITIVE_MULTIPLE);
  if (resolved < 0) throw new UnsupportedRuntimePath("TryAddReviewStatus", "negative turn");
  const current = firstStatus(state, StatusKind.REVIEW);
  if (current) {
    if (!current.turnLimited) throw new UnsupportedRuntimePath("TryAddReviewStatus", "existing status is not turn-limited");
    current.turn = Number(current.turn) + resolved;
  } else {
    addStatus(state, { kind: StatusKind.REVIEW, turn: resolved, turnLimited: true });
  }
}

export function addLessonBuff(state, value, isFix = false) {
  const resolved = isFix ? Number(value) : applyAdditive(state, Number(value), StatusKind.LESSON_BUFF_ADDITIVE_FIX, StatusKind.LESSON_BUFF_ADDITIVE_MULTIPLE);
  const current = firstStatus(state, StatusKind.LESSON_BUFF);
  if (current) current.value = Math.max(0, Number(current.value) + resolved);
  else addStatus(state, { kind: StatusKind.LESSON_BUFF, value: Math.max(0, resolved) });
}

export function getRatioEffectIntValue(value, permil, ceilMode) {
  value = Number(value);
  if (value < 1) return 0;
  const ratio = f32(f32(Number(permil)) / f32(1000));
  const x = f32(ratio * f32(value));
  return ceilMode ? ceilF32(f32(x + f32(0.0001))) : floorF32(f32(x + f32(-0.0001)));
}

export function calculateAddingParameter(value, state, modifier = null) {
  if (hasStatus(state, StatusKind.SLUMP)) return 0;

  let parameterBuffMultiple = f32(1);
  if (hasStatus(state, StatusKind.PARAMETER_BUFF)) {
    let pb = f32(fromPermil(setting(state, 37, "ParameterBuff")) + f32(-1));
    if (hasStatus(state, StatusKind.PARAMETER_BUFF_MULTIPLE_PER_TURN)) {
      const extra = f32(f32(statusTurn(state, StatusKind.PARAMETER_BUFF)) * fromPermil(setting(state, 38, "ParameterBuffMultiplePerTurn")));
      pb = f32(pb + extra);
    }
    if (modifier) pb = f32(pb * f32(modifier.parameterBuffMultiple ?? 1));
    parameterBuffMultiple = f32(f32(1) + pb);
  }

  let parameterDebuffPermil = 1000;
  if (hasStatus(state, StatusKind.PARAMETER_DEBUFF)) parameterDebuffPermil = setting(state, 36, "ParameterDebuff");
  const parameterDebuffMultiple = fromPermil(parameterDebuffPermil);

  const lessonBuff = statusValue(state, StatusKind.LESSON_BUFF);
  const lessonDebuff = statusValue(state, StatusKind.LESSON_DEBUFF);
  let enthusiastic = statusValue(state, StatusKind.ENTHUSIASTIC);
  if (modifier) enthusiastic = ceilF32(f32(f32(modifier.enthusiasticMultiple ?? 1) * f32(enthusiastic)));

  const lessonMultiple = ratioMultiple(state, StatusKind.LESSON_PARAMETER_MULTIPLE);
  let lessonDown = ratioMultiple(state, StatusKind.LESSON_PARAMETER_DOWN);
  if (!hasStatus(state, StatusKind.LESSON_PARAMETER_DOWN)) lessonDown = f32(0);
  const downFactor = f32(Math.max(f32(0), f32(f32(1) - lessonDown)));

  let dep = f32(0);
  if (hasStatus(state, StatusKind.LESSON_VALUE_DEPEND_REVIEW_AGGRESSIVE)) {
    const rv = Math.max(statusValue(state, StatusKind.REVIEW), statusValue(state, StatusKind.AGGRESSIVE));
    dep = f32(f32(rv) * fromPermil(setting(state, 44, "LessonValueDependReviewOrAggressive")));
    dep = f32(Math.min(dep, fromPermil(setting(state, 45, "LessonValueDependReviewOrAggressive cap"))));
  }

  let lessonBuffMultiple = ratioMultiple(state, StatusKind.LESSON_BUFF_MULTIPLE);
  if (!hasStatus(state, StatusKind.LESSON_BUFF_MULTIPLE)) lessonBuffMultiple = f32(1);

  let stanceMultiple = f32(1);
  const type = Number(state.idolStatusType ?? 0);
  const step = Number(state.idolStatusStep ?? 0);
  if (type === 1) {
    const slot = step === 1 ? 23 : 24;
    let base = f32(fromPermil(setting(state, slot, "Concentration stance")) + f32(-1));
    base = f32(base + f32(ratioMultiple(state, StatusKind.CONCENTRATION_LESSON_MULTIPLE_ADDITIVE) - f32(1)));
    const factor = f32(modifier?.concentrationMultiple ?? 1);
    stanceMultiple = f32(f32(1) + f32(base * factor));
  } else if (type === 2) {
    stanceMultiple = fromPermil(setting(state, step === 1 ? 25 : 26, "Preservation stance"));
  } else if (type === 3) {
    let base = f32(fromPermil(setting(state, 9, "FullPower stance")) + f32(-1));
    base = f32(base + f32(ratioMultiple(state, StatusKind.FULL_POWER_LESSON_MULTIPLE_ADDITIVE) - f32(1)));
    const factor = f32(modifier?.fullPowerMultiple ?? 1);
    stanceMultiple = f32(f32(1) + f32(base * factor));
  } else if (type === 4) {
    stanceMultiple = fromPermil(setting(state, 20, "OverPreservation stance"));
  }

  let adjusted = Number(value);
  const more = firstStatus(state, "LessonChangeSpecifyMoreThan");
  if (more && Number(more.value) >= 0) adjusted = Number(more.value);
  const less = firstStatus(state, "LessonChangeSpecifyLessThan");
  if (less && Number(less.value) >= 0) adjusted = Number(less.value);

  const base = Math.max(0, ceilF32(f32(lessonBuffMultiple * f32(lessonBuff))) - lessonDebuff + enthusiastic + adjusted);
  const multiple = f32(lessonMultiple + dep);
  let result = f32(f32(f32(f32(stanceMultiple * downFactor) * multiple) * parameterDebuffMultiple) * parameterBuffMultiple);
  result = f32(result * f32(base));
  const out = ceilF32(f32(result + f32(0.0001)));
  return Math.min(0x7fffffff, Math.max(0, Number(out)));
}

export function addParameterFix(state, value) {
  let after = Number(state.judgeParameter) + Number(value);
  if (state.parameterAddLimit != null) after = Math.min(after, Number(state.parameterAddLimit));
  state.judgeParameter = after;
}

export function calculateAddBlock(value, state, aggressiveMultiple = 1) {
  value = Number(value);
  if (value < 1) return 0;
  if (hasStatus(state, StatusKind.BLOCK_RESTRICTION)) return 0;
  value += ceilF32(f32(f32(statusValue(state, StatusKind.AGGRESSIVE)) * f32(aggressiveMultiple)));
  if (value < 1) return Math.max(0, value);
  if (hasStatus(state, StatusKind.BLOCK_ADD_DOWN)) {
    const permil = 1000 - setting(state, 4, "BlockAddDown");
    value -= getRatioEffectIntValue(value, permil, false);
  }
  const fix = statusValue(state, StatusKind.BLOCK_ADD_DOWN_FIX);
  if (fix >= 1) value -= fix;
  return Math.max(0, Math.trunc(value));
}

export function addBlockFix(state, value) {
  const before = Number(state.block);
  const delta = Math.max(-before, Number(value));
  state.block = before + delta;
}

export function addStaminaFix(state, value) {
  const before = Number(state.stamina);
  state.stamina = Math.max(0, Math.min(Number(state.maxStamina), before + Number(value)));
}

export function calculateDamage(value, penetrate, applyFixed, state) {
  const block = penetrate ? 0 : Number(state.block);
  let n = f32(Number(value));
  const type = Number(state.idolStatusType ?? 0);
  const step = Number(state.idolStatusStep ?? 0);
  if (type === 1) n = f32(n * fromPermil(setting(state, step === 1 ? 27 : 28, "Concentration stamina")));
  else if (type === 2) n = f32(n * fromPermil(setting(state, step === 1 ? 31 : 32, "Preservation stamina")));
  else if (type === 4) n = f32(n * fromPermil(setting(state, 21, "OverPreservation stamina")));

  if (hasStatus(state, StatusKind.STAMINA_CONSUMPTION_DOWN)) {
    const slot = hasStatus(state, StatusKind.STAMINA_CONSUMPTION_DOWN_ADD) ? 5 : 0;
    n = f32(n * fromPermil(1000 - setting(state, slot, "StaminaConsumptionDown")));
  }
  if (hasStatus(state, StatusKind.STAMINA_CONSUMPTION_ADD)) {
    const slot = hasStatus(state, StatusKind.STAMINA_CONSUMPTION_ADD_DOWN) ? 6 : 1;
    n = f32(n * fromPermil(1000 + setting(state, slot, "StaminaConsumptionAdd")));
  }
  let damage = ceilF32(n);
  if (applyFixed) {
    damage += Math.max(0, statusValue(state, StatusKind.STAMINA_CONSUMPTION_ADD_FIX));
    const down = statusValue(state, StatusKind.STAMINA_CONSUMPTION_DOWN_FIX);
    if (down >= 1) damage = Math.max(0, damage - down);
    const threshold = statusValue(state, StatusKind.STAMINA_REDUCE_CHANGE);
    if (damage <= threshold && threshold >= 1) damage = setting(state, 7, "StaminaReduceChange");
  }
  const staminaDamage = Math.max(0, damage - block);
  const blockDamage = damage - staminaDamage;
  return { staminaDamage, blockDamage };
}

export function damageStamina(state, value, penetrate = false) {
  const before = Number(state.stamina);
  const { staminaDamage, blockDamage } = calculateDamage(value, penetrate, true, state);
  if (blockDamage >= 1) state.block = Math.max(0, Number(state.block) - blockDamage);
  if (staminaDamage >= 1) {
    state.stamina = Math.max(0, Math.min(Number(state.maxStamina), Number(state.stamina) - staminaDamage));
    state.currentTurnConsumeStamina += before - state.stamina;
  }
  if (staminaDamage >= 1 && statusValue(state, StatusKind.UPLIFTING) >= 1) reduceStatusValue(state, StatusKind.UPLIFTING, 1);
  return { staminaDamage, blockDamage };
}

export function reduceStatusValue(state, kind, amount) {
  let remaining = Math.max(0, Number(amount));
  for (const status of [...activeStatuses(state, kind)]) {
    if (remaining <= 0) break;
    const take = Math.min(Math.max(0, Number(status.value ?? 0)), remaining);
    status.value = Number(status.value ?? 0) - take;
    remaining -= take;
    if (status.value <= 0 && !status.turnLimited) state.statuses.splice(state.statuses.indexOf(status), 1);
  }
}

export function spendTurnStrict(state, { initial = false } = {}) {
  const complex = new Set([StatusKind.TIMER, StatusKind.TRIGGER, StatusKind.ENCHANT]);
  if (initial && state.statuses.length) {
    throw new UnsupportedRuntimePath("ExamStatusEffectCollection.SpendInitialTurn", "non-empty initial status list");
  }
  for (const status of [...state.statuses]) {
    if (complex.has(status.kind)) throw new UnsupportedRuntimePath("ExamStatusEffectCollection.SpendTurn", `complex status ${status.kind}`);
    if (status.turnLimited) {
      const before = Number(status.turn ?? 0);
      status.turn = before - 1;
      if (status.kind === StatusKind.REVIEW && before > status.turn) state.reviewConsumptionSumCount += before - status.turn;
    }
    if (status.turnLimited && Number(status.turn) <= 0) state.statuses.splice(state.statuses.indexOf(status), 1);
  }
}

export const ExamEffectType = Object.freeze({
  LESSON: 1,
  PARAMETER_BUFF: 2,
  BLOCK: 3,
  DRAW: 4,
  LESSON_BUFF: 10,
  REVIEW: 31,
  EXTRA_TURN: 63,
});

function intField(record, key, fallback = 0) { return Number(record?.[String(key)] ?? record?.[key] ?? fallback); }

export function executeExamEffect(state, effect, hooks = {}) {
  if (!effect) throw new UnsupportedRuntimePath("ProduceExamEffect", "missing master record");
  const type = intField(effect, 2);
  switch (type) {
    case ExamEffectType.LESSON: {
      const value = intField(effect, 5);
      const count = intField(effect, 7, 1);
      if (count < 1) return { type, value, count, parameterAdded: 0 };
      const before = state.judgeParameter;
      for (let i = 0; i < count; i += 1) addParameterFix(state, calculateAddingParameter(value, state));
      return { type, value, count, parameterAdded: state.judgeParameter - before };
    }
    case ExamEffectType.PARAMETER_BUFF: {
      const turn = intField(effect, 8);
      addParameterBuff(state, turn);
      return { type, turn };
    }
    case ExamEffectType.BLOCK: {
      const value = intField(effect, 5);
      const added = calculateAddBlock(value, state);
      addBlockFix(state, added);
      return { type, value, blockAdded: added };
    }
    case ExamEffectType.DRAW: {
      const value = intField(effect, 5);
      if (typeof hooks.draw !== "function") throw new UnsupportedRuntimePath("DrawEffectExecutor", "draw hook is required");
      hooks.draw(value);
      return { type, value };
    }
    case ExamEffectType.LESSON_BUFF: {
      const value = intField(effect, 5);
      addLessonBuff(state, value);
      return { type, value };
    }
    case ExamEffectType.REVIEW: {
      const value = intField(effect, 5);
      addReview(state, value);
      return { type, value };
    }
    case ExamEffectType.EXTRA_TURN: {
      state.remainTurn += 1;
      state.extraTurn += 1;
      return { type, value: 1 };
    }
    default:
      throw new UnsupportedRuntimePath("ExamEffect", `ProduceExamEffect type ${type} (${effect.i ?? effect[1] ?? "unknown"}) is not implemented`);
  }
}

export function payStaminaCost(state, value, { penetrate = false } = {}) {
  value = Number(value ?? 0);
  if (value <= 0) return { staminaDamage: 0, blockDamage: 0 };
  return damageStamina(state, value, penetrate);
}
