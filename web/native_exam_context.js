// Live, non-serializable naming bridge for IL2CPP Campus.InGame.Exam classes.
//
// The simulator's existing lower-camel-case fields form its persisted JSON
// contract. Do not copy their values into a second "native" state: a snapshot
// would diverge during effects, draws or replay. These views read and write the
// original state and deliberately do not appear in JSON.stringify(state).
//
// Source: gakumas_analysis(1).elf, Assembly-CSharp.dll, IL2CPP metadata v31.
// Build ID: 77fda4e2a21f23954e2349b83fc113ede408f70b
// Offsets are AArch64 object byte offsets, not JavaScript object layouts.

export const NATIVE_IL2CPP_BUILD_ID = "77fda4e2a21f23954e2349b83fc113ede408f70b";

export const EXAM_PARAMETER_MODEL_FIELDS = Object.freeze({
  Seed:                { owner: "state", field: "seed", offset: 0x10, type: "System.UInt32" },
  RandomState:         { owner: "state", field: "randomState", offset: 0x77c, type: "System.UInt32", readonly: true },
  CurrentTurn:         { owner: "state", field: "turn", offset: 0x144, type: "System.Int32" },
  Stamina:             { owner: "exam", field: "stamina", offset: 0x1cc, type: "System.Int32" },
  MaxStamina:          { owner: "exam", field: "maxStamina", offset: 0x1e8, type: "System.Int32" },
  JudgeParameter:      { owner: "exam", field: "parameter", offset: 0x220, type: "System.Int32", readonly: true },
  Block:               { owner: "exam", field: "block", offset: 0x248, type: "System.Int32" },
  TurnCardPlayCount:   { owner: "exam", field: "turnCardPlayCount", offset: 0x2d0, type: "System.Int32" },
  ExamCardPlayCount:   { owner: "exam", field: "cardPlayCount", offset: 0x2ec, type: "System.Int32" },
});

export const EXAM_EFFECT_CALCULATE_CONTEXT_FIELDS = Object.freeze({
  HandList:                { owner: "state", field: "hand", offset: 0x20 },
  DeckList:                { owner: "state", field: "deck", offset: 0x28 },
  GraveList:               { owner: "state", field: "discard", offset: 0x30 },
  LostList:                { owner: "state", field: "lost", offset: 0x38 },
  HoldList:                { owner: "state", field: "hold", offset: 0x40 },
  PlayingCard:             { owner: "state", field: "playingCard", offset: 0x78 },
  RemainCanPlayCardCount:  { owner: "state", field: "playsRemaining", offset: 0x90, type: "System.Int32" },
});

// Only getters confirmed to exist on ExamStatusEffectCollection are exposed.
// Status durations, UIDs and trigger registrations remain separate, just as
// they are in the native model.
const STATUS_GETTERS = Object.freeze({
  GetReview: "review",
  GetAggressive: "aggressive",
  GetFullPowerPoint: "fullPowerPoint",
  GetLessonBuff: "lessonBuff",
  GetParameterBuffTurn: "parameterBuff",
});

const parameterViews = new WeakMap();
const contextViews = new WeakMap();
const statusViews = new WeakMap();

function requireExamState(state) {
  if (!state || typeof state !== "object" || !state.exam || typeof state.exam !== "object") {
    throw new TypeError("ExamParameterModel view requires a simulation state with state.exam");
  }
}

function makeFieldView(state, fields) {
  const view = Object.create(null);
  for (const [nativeName, binding] of Object.entries(fields)) {
    const descriptor = {
      enumerable: true,
      configurable: false,
      get() {
        const container = binding.owner === "exam" ? state.exam : state;
        const value = container[binding.field];
        return binding.type === "System.UInt32" && value != null ? Number(value) >>> 0 : value;
      },
    };
    if (!binding.readonly) {
      descriptor.set = value => {
        const container = binding.owner === "exam" ? state.exam : state;
        container[binding.field] = binding.type === "System.UInt32" ? Number(value) >>> 0 : value;
      };
    }
    Object.defineProperty(view, nativeName, descriptor);
  }
  return view;
}

export function getExamStatusEffectCollection(state) {
  requireExamState(state);
  if (!statusViews.has(state)) {
    const view = Object.create(null);
    for (const [method, field] of Object.entries(STATUS_GETTERS)) {
      Object.defineProperty(view, method, {
        enumerable: true,
        value: () => Number(state.exam[field] ?? 0),
      });
    }
    statusViews.set(state, Object.freeze(view));
  }
  return statusViews.get(state);
}

export function getExamParameterModel(state) {
  requireExamState(state);
  if (!parameterViews.has(state)) {
    const view = makeFieldView(state, EXAM_PARAMETER_MODEL_FIELDS);
    Object.defineProperty(view, "StatusEffectCollection", {
      enumerable: true,
      get: () => getExamStatusEffectCollection(state),
    });
    parameterViews.set(state, Object.freeze(view));
  }
  return parameterViews.get(state);
}

export function getExamEffectCalculateContext(state) {
  requireExamState(state);
  if (!contextViews.has(state)) {
    const view = makeFieldView(state, EXAM_EFFECT_CALCULATE_CONTEXT_FIELDS);
    Object.defineProperty(view, "ExamParameter", {
      enumerable: true,
      get: () => getExamParameterModel(state),
    });
    contextViews.set(state, Object.freeze(view));
  }
  return contextViews.get(state);
}
