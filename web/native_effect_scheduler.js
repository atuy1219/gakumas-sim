// Native Effect Scheduler skeleton for Gakumas Exam runtime.
//
// This module intentionally separates scheduling/orchestration from effect
// math. Native score/stamina/card movement remain owned by the existing
// runtime; the scheduler only decides WHEN a normalized effect is eligible to
// execute and tracks its source/lifetime/counters.

export const NATIVE_EFFECT_PHASE = Object.freeze({
  BEFORE_START_OF_TURN: "beforeStartOfTurn",
  START_OF_TURN: "startOfTurn",
  AFTER_START_OF_TURN: "afterStartOfTurn",
  CARD_PLAY: "cardPlay",
  AFTER_CARD_PLAY: "afterCardPlay",
  END_TURN: "endTurn",
  STATUS_INCREASED: "statusIncreased",
  STATUS_DECREASED: "statusDecreased",
});

export const NATIVE_EFFECT_PHASES = Object.freeze(Object.values(NATIVE_EFFECT_PHASE));

export const NATIVE_EFFECT_SOURCE = Object.freeze({
  SYSTEM: "system",
  CARD: "card",
  P_ITEM: "pItem",
  ENCHANT: "enchant",
  GIMMICK: "gimmick",
});

export const NATIVE_STATUS_CHANGE_FIELDS = Object.freeze([
  "block",
  "review",
  "aggressive",
  "lessonBuff",
  "parameterBuff",
  "parameterBuffMultiplePerTurn",
  "parameterDebuff",
  "lessonDebuff",
  "enthusiastic",
  "staminaConsumptionDown",
  "staminaConsumptionAdd",
  "staminaConsumptionDownFix",
  "staminaConsumptionAddFix",
  "fullPowerPoint",
]);

const PHASE_SET = new Set(NATIVE_EFFECT_PHASES);
const SOURCE_SET = new Set(Object.values(NATIVE_EFFECT_SOURCE));

function normalizeFinitePositive(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const integer = Math.trunc(numeric);
  return integer > 0 ? integer : null;
}

function normalizeRemainingTurns(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.max(0, Math.trunc(numeric));
}

function normalizePhase(value) {
  const phase = String(value ?? "");
  if (!PHASE_SET.has(phase)) throw new Error(`未知のNative Effect phaseです: ${phase}`);
  return phase;
}

function normalizeSourceType(value) {
  const sourceType = String(value ?? NATIVE_EFFECT_SOURCE.SYSTEM);
  if (!SOURCE_SET.has(sourceType)) throw new Error(`未知のNative Effect sourceです: ${sourceType}`);
  return sourceType;
}

function cloneEffect(effect) {
  if (effect && typeof effect === "object") return { ...effect };
  return effect;
}

export function createNativeEffectScheduler(options = {}) {
  return {
    version: 1,
    nextRegistrationId: 1,
    sequence: 0,
    dispatchDepth: 0,
    maxDispatchDepth: Math.max(1, Math.trunc(Number(options.maxDispatchDepth ?? 64))),
    traceEnabled: Boolean(options.traceEnabled),
    traceLimit: Math.max(1, Math.trunc(Number(options.traceLimit ?? 200))),
    registrations: [],
    trace: [],
    lastEvent: null,
  };
}

export function registerNativeEffect(scheduler, spec = {}) {
  if (!scheduler || !Array.isArray(scheduler.registrations)) {
    throw new Error("Native Effect Schedulerが初期化されていません。");
  }

  const registrationId = String(
    spec.registrationId
    ?? `native-effect-${scheduler.nextRegistrationId++}`,
  );
  const remainingTurns = normalizeRemainingTurns(spec.ttl ?? spec.turn);
  const registration = {
    registrationId,
    id: String(spec.id ?? registrationId),
    sourceType: normalizeSourceType(spec.sourceType),
    sourceId: String(spec.sourceId ?? ""),
    phase: normalizePhase(spec.phase),
    condition: spec.condition ?? null,
    effects: Array.isArray(spec.effects) ? spec.effects.map(cloneEffect) : [],
    remainingCount: normalizeFinitePositive(spec.count),
    executionLimit: normalizeFinitePositive(spec.limit),
    remainingTurns,
    triggerCount: Math.max(0, Math.trunc(Number(spec.triggerCount ?? 0))),
    executionCount: Math.max(0, Math.trunc(Number(spec.executionCount ?? 0))),
    installedTurn: Number.isFinite(Number(spec.installedTurn))
      ? Math.trunc(Number(spec.installedTurn))
      : null,
    active: spec.active !== false && remainingTurns !== 0,
    metadata: spec.metadata && typeof spec.metadata === "object"
      ? { ...spec.metadata }
      : {},
  };
  scheduler.registrations.push(registration);
  return registration;
}

export function registerNativeEffectSource(
  scheduler,
  sourceType,
  sourceId,
  specs = [],
  defaults = {},
) {
  return (specs ?? []).map((spec) => registerNativeEffect(scheduler, {
    ...defaults,
    ...spec,
    sourceType,
    sourceId,
  }));
}

export function registerNativePItemEffects(scheduler, pItemId, specs = [], defaults = {}) {
  return registerNativeEffectSource(
    scheduler,
    NATIVE_EFFECT_SOURCE.P_ITEM,
    pItemId,
    specs,
    defaults,
  );
}

export function registerNativeEnchantEffects(scheduler, enchantId, specs = [], defaults = {}) {
  return registerNativeEffectSource(
    scheduler,
    NATIVE_EFFECT_SOURCE.ENCHANT,
    enchantId,
    specs,
    defaults,
  );
}

export function registerNativeGimmickEffects(scheduler, gimmickId, specs = [], defaults = {}) {
  return registerNativeEffectSource(
    scheduler,
    NATIVE_EFFECT_SOURCE.GIMMICK,
    gimmickId,
    specs,
    defaults,
  );
}

export function deactivateNativeEffect(scheduler, registrationId) {
  const registration = scheduler?.registrations?.find(
    (entry) => entry.registrationId === String(registrationId),
  );
  if (!registration) return false;
  registration.active = false;
  return true;
}

function getPathValue(root, pathInput) {
  const path = String(pathInput ?? "").trim();
  if (!path) return undefined;
  return path.split(".").reduce((value, key) => (
    value === null || value === undefined ? undefined : value[key]
  ), root);
}

function compareCondition(actual, op, expected) {
  switch (String(op ?? "eq")) {
    case "eq": return actual === expected;
    case "ne": return actual !== expected;
    case "gt": return Number(actual) > Number(expected);
    case "gte": return Number(actual) >= Number(expected);
    case "lt": return Number(actual) < Number(expected);
    case "lte": return Number(actual) <= Number(expected);
    case "truthy": return Boolean(actual);
    case "falsy": return !actual;
    case "in": return Array.isArray(expected) && expected.includes(actual);
    case "notIn": return Array.isArray(expected) && !expected.includes(actual);
    default: throw new Error(`未知のNative Effect condition operatorです: ${op}`);
  }
}

export function evaluateNativeEffectCondition(condition, context = {}) {
  if (condition === null || condition === undefined) return true;
  if (typeof condition === "boolean") return condition;
  if (typeof condition === "function") return Boolean(condition(context));
  if (Array.isArray(condition)) {
    return condition.every((item) => evaluateNativeEffectCondition(item, context));
  }
  if (typeof condition !== "object") return Boolean(condition);

  if (Array.isArray(condition.all)) {
    return condition.all.every((item) => evaluateNativeEffectCondition(item, context));
  }
  if (Array.isArray(condition.any)) {
    return condition.any.some((item) => evaluateNativeEffectCondition(item, context));
  }
  if (condition.not !== undefined) {
    return !evaluateNativeEffectCondition(condition.not, context);
  }
  if (condition.phase !== undefined && String(context.phase) !== String(condition.phase)) {
    return false;
  }
  if (
    condition.cardCategory !== undefined
    && String(context.card?.category ?? "") !== String(condition.cardCategory)
  ) {
    return false;
  }
  if (
    condition.statusField !== undefined
    && String(context.statusChange?.field ?? "") !== String(condition.statusField)
  ) {
    return false;
  }
  if (condition.field !== undefined) {
    const actual = getPathValue(context, condition.field);
    return compareCondition(actual, condition.op, condition.value);
  }

  return true;
}

function appendTrace(scheduler, event) {
  scheduler.lastEvent = event;
  if (!scheduler.traceEnabled) return;
  scheduler.trace.push(event);
  if (scheduler.trace.length > scheduler.traceLimit) {
    scheduler.trace.splice(0, scheduler.trace.length - scheduler.traceLimit);
  }
}

function registrationCanRun(registration) {
  if (!registration?.active) return false;
  if (registration.remainingTurns === 0) return false;
  if (
    registration.remainingCount !== null
    && Number(registration.remainingCount) <= 0
  ) return false;
  if (
    registration.executionLimit !== null
    && Number(registration.executionCount) >= Number(registration.executionLimit)
  ) return false;
  return true;
}

function spendRegistration(registration) {
  registration.triggerCount += 1;
  registration.executionCount += 1;

  if (registration.remainingCount !== null) {
    registration.remainingCount = Math.max(0, registration.remainingCount - 1);
    if (registration.remainingCount === 0) registration.active = false;
  }
  if (
    registration.executionLimit !== null
    && registration.executionCount >= registration.executionLimit
  ) {
    registration.active = false;
  }
}

export function dispatchNativeEffectPhase(
  scheduler,
  phaseInput,
  contextInput = {},
  hooks = {},
) {
  const phase = normalizePhase(phaseInput);
  if (!scheduler) throw new Error("Native Effect Schedulerがありません。");
  if (scheduler.dispatchDepth >= scheduler.maxDispatchDepth) {
    throw new Error("Native Effect Schedulerの再帰上限を超えました。");
  }

  const context = {
    ...contextInput,
    phase,
  };
  const event = {
    sequence: ++scheduler.sequence,
    phase,
    turn: Number.isFinite(Number(context.state?.turn))
      ? Number(context.state.turn)
      : null,
    cardId: String(context.card?.id ?? ""),
    statusChange: context.statusChange ? { ...context.statusChange } : null,
    matchedRegistrationIds: [],
    executedRegistrationIds: [],
  };

  scheduler.dispatchDepth += 1;
  try {
    // Snapshot the list so registrations created during this phase are first
    // eligible on the next dispatch, avoiding order-dependent self-installation.
    for (const registration of [...scheduler.registrations]) {
      if (registration.phase !== phase || !registrationCanRun(registration)) continue;

      const supported = typeof hooks.evaluateCondition === "function"
        ? hooks.evaluateCondition(registration.condition, context, registration)
        : undefined;
      const conditionMatched = supported === undefined
        ? evaluateNativeEffectCondition(registration.condition, context)
        : Boolean(supported);
      if (!conditionMatched) continue;

      event.matchedRegistrationIds.push(registration.registrationId);
      if (typeof hooks.beforeRegistration === "function") {
        hooks.beforeRegistration(registration, context);
      }

      for (const effect of registration.effects) {
        if (typeof hooks.executeEffect === "function") {
          hooks.executeEffect(effect, context, registration);
        }
      }

      spendRegistration(registration);
      event.executedRegistrationIds.push(registration.registrationId);
      if (typeof hooks.afterRegistration === "function") {
        hooks.afterRegistration(registration, context);
      }
    }
  } finally {
    scheduler.dispatchDepth -= 1;
  }

  appendTrace(scheduler, event);
  return event;
}

export function tickNativeEffectSchedulerTurn(scheduler) {
  if (!scheduler?.registrations) return [];
  const expired = [];
  for (const registration of scheduler.registrations) {
    if (!registration.active || registration.remainingTurns === null) continue;
    registration.remainingTurns = Math.max(0, Number(registration.remainingTurns) - 1);
    if (registration.remainingTurns === 0) {
      registration.active = false;
      expired.push(registration.registrationId);
    }
  }
  return expired;
}

export function captureNativeStatusSnapshot(exam = {}) {
  const snapshot = {};
  for (const field of NATIVE_STATUS_CHANGE_FIELDS) {
    const value = exam?.[field];
    if (Number.isFinite(Number(value))) snapshot[field] = Number(value);
  }
  return snapshot;
}

export function dispatchNativeStatusDiff(
  scheduler,
  before = {},
  after = {},
  context = {},
  hooks = {},
) {
  const events = [];
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const field of fields) {
    const previous = Number(before[field] ?? 0);
    const current = Number(after[field] ?? 0);
    if (!Number.isFinite(previous) || !Number.isFinite(current) || current === previous) continue;
    const delta = current - previous;
    const phase = delta > 0
      ? NATIVE_EFFECT_PHASE.STATUS_INCREASED
      : NATIVE_EFFECT_PHASE.STATUS_DECREASED;
    events.push(dispatchNativeEffectPhase(
      scheduler,
      phase,
      {
        ...context,
        statusChange: {
          field,
          before: previous,
          after: current,
          delta,
        },
      },
      hooks,
    ));
  }
  return events;
}
