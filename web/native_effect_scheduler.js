// Native Effect Scheduler for Gakumas Exam runtime.
//
// Scheduling/orchestration is intentionally separated from effect math.
// Native score/stamina/card movement remain owned by the exam runtime; this
// module decides WHEN a normalized effect is eligible to execute and tracks
// source, lifetime, counters, nested dispatches, and registration activation.

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
  "idolStatusType",
  "idolStatusStep",
  "lessonParameterMultiple",
  "lessonParameterDown",
  "lessonBuffMultiple",
  "reviewMultiple",
  "reviewCountAdd",
  "lessonValueDependReviewAggressive",
  "reviewTurnEndReduceLock",
  "parameterBuffTurnEndReduceLock",
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
    version: 2,
    nextRegistrationId: 1,
    sequence: 0,
    dispatchEpoch: 0,
    dispatchDepth: 0,
    dispatchStack: [],
    executingRegistrationIds: [],
    lastTurnTick: null,
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
  const createdDuringDispatch = Number(scheduler.dispatchDepth ?? 0) > 0;
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
    eligibleEpoch: createdDuringDispatch
      ? Number(scheduler.dispatchEpoch ?? 0) + 1
      : Number(scheduler.dispatchEpoch ?? 0),
    allowReentry: Boolean(spec.allowReentry),
    lastMatchedSequence: null,
    lastExecutedSequence: null,
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
    case "contains":
      return Array.isArray(actual)
        ? actual.includes(expected)
        : String(actual ?? "").includes(String(expected ?? ""));
    case "notContains":
      return Array.isArray(actual)
        ? !actual.includes(expected)
        : !String(actual ?? "").includes(String(expected ?? ""));
    case "exists": return actual !== undefined && actual !== null;
    case "notExists": return actual === undefined || actual === null;
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

  const predicates = [];
  if (Array.isArray(condition.all)) {
    predicates.push(condition.all.every((item) => evaluateNativeEffectCondition(item, context)));
  }
  if (Array.isArray(condition.any)) {
    predicates.push(condition.any.some((item) => evaluateNativeEffectCondition(item, context)));
  }
  if (condition.not !== undefined) {
    predicates.push(!evaluateNativeEffectCondition(condition.not, context));
  }
  if (condition.phase !== undefined) {
    predicates.push(String(context.phase) === String(condition.phase));
  }
  if (condition.cardCategory !== undefined) {
    predicates.push(String(context.card?.category ?? "") === String(condition.cardCategory));
  }
  if (condition.statusField !== undefined) {
    predicates.push(String(context.statusChange?.field ?? "") === String(condition.statusField));
  }
  if (condition.statusDirection !== undefined) {
    const delta = Number(context.statusChange?.delta ?? 0);
    predicates.push(
      String(condition.statusDirection) === "increase" ? delta > 0
        : String(condition.statusDirection) === "decrease" ? delta < 0
          : false,
    );
  }
  if (condition.playCountSinceInstallInterval !== undefined) {
    const interval = Math.max(1, Math.trunc(Number(condition.playCountSinceInstallInterval) || 1));
    const current = Number(context.exam?.cardPlayCount ?? 0);
    const installed = Number(context.registration?.metadata?.installedCardPlayCount ?? 0);
    const elapsed = current - installed;
    predicates.push(elapsed > 0 && elapsed % interval === 0);
  }
  if (condition.field !== undefined) {
    const actual = getPathValue(context, condition.field);
    predicates.push(compareCondition(actual, condition.op, condition.value));
  }

  return predicates.length ? predicates.every(Boolean) : true;
}

function appendTrace(scheduler, event) {
  scheduler.lastEvent = event;
  if (!scheduler.traceEnabled) return;
  scheduler.trace.push(event);
  if (scheduler.trace.length > scheduler.traceLimit) {
    scheduler.trace.splice(0, scheduler.trace.length - scheduler.traceLimit);
  }
}

function registrationCanRun(scheduler, registration) {
  if (!registration?.active) return false;
  if (Number(registration.eligibleEpoch ?? 0) > Number(scheduler?.dispatchEpoch ?? 0)) return false;
  if (
    !registration.allowReentry
    && scheduler?.executingRegistrationIds?.includes?.(registration.registrationId)
  ) return false;
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

function spendRegistration(registration, sequence) {
  registration.executionCount += 1;
  registration.lastExecutedSequence = sequence;

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

  const isRootDispatch = Number(scheduler.dispatchDepth ?? 0) === 0;
  if (isRootDispatch) scheduler.dispatchEpoch = Number(scheduler.dispatchEpoch ?? 0) + 1;

  const context = {
    ...contextInput,
    phase,
  };
  const parentSequence = scheduler.dispatchStack?.length
    ? scheduler.dispatchStack[scheduler.dispatchStack.length - 1]
    : null;
  const event = {
    sequence: ++scheduler.sequence,
    epoch: Number(scheduler.dispatchEpoch ?? 0),
    depth: Number(scheduler.dispatchDepth ?? 0),
    parentSequence,
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
  if (!Array.isArray(scheduler.dispatchStack)) scheduler.dispatchStack = [];
  if (!Array.isArray(scheduler.executingRegistrationIds)) scheduler.executingRegistrationIds = [];
  scheduler.dispatchStack.push(event.sequence);
  try {
    // Snapshot registrations and gate them by dispatch epoch. A registration
    // installed anywhere inside this root dispatch (including nested status
    // change dispatches) becomes eligible only on the next root dispatch.
    for (const registration of [...scheduler.registrations]) {
      if (registration.phase !== phase || !registrationCanRun(scheduler, registration)) continue;

      const supported = typeof hooks.evaluateCondition === "function"
        ? hooks.evaluateCondition(registration.condition, context, registration)
        : undefined;
      const conditionContext = { ...context, registration };
      const conditionMatched = supported === undefined
        ? evaluateNativeEffectCondition(registration.condition, conditionContext)
        : Boolean(supported);
      if (!conditionMatched) continue;

      registration.triggerCount += 1;
      registration.lastMatchedSequence = event.sequence;
      event.matchedRegistrationIds.push(registration.registrationId);
      if (typeof hooks.beforeRegistration === "function") {
        hooks.beforeRegistration(registration, context);
      }

      scheduler.executingRegistrationIds.push(registration.registrationId);
      try {
        for (const effect of registration.effects) {
          if (typeof hooks.executeEffect === "function") {
            hooks.executeEffect(effect, context, registration);
          }
        }
        spendRegistration(registration, event.sequence);
        event.executedRegistrationIds.push(registration.registrationId);
        if (typeof hooks.afterRegistration === "function") {
          hooks.afterRegistration(registration, context);
        }
      } finally {
        const index = scheduler.executingRegistrationIds.lastIndexOf(registration.registrationId);
        if (index >= 0) scheduler.executingRegistrationIds.splice(index, 1);
      }
    }
  } finally {
    scheduler.dispatchStack.pop();
    scheduler.dispatchDepth -= 1;
  }

  appendTrace(scheduler, event);
  return event;
}

export function tickNativeEffectSchedulerTurn(scheduler, options = {}) {
  if (!scheduler?.registrations) return [];
  const turn = Number(options.turn);
  if (Number.isFinite(turn)) {
    if (Number(scheduler.lastTurnTick) === turn) return [];
    scheduler.lastTurnTick = turn;
  }

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
