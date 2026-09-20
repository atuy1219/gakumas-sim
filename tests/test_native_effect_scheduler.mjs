import assert from "node:assert/strict";
import {
  NATIVE_EFFECT_PHASE,
  NATIVE_EFFECT_SOURCE,
  captureNativeStatusSnapshot,
  createNativeEffectScheduler,
  dispatchNativeEffectPhase,
  dispatchNativeStatusDiff,
  evaluateNativeEffectCondition,
  registerNativeEffect,
  registerNativeEnchantEffects,
  registerNativeGimmickEffects,
  registerNativePItemEffects,
  tickNativeEffectSchedulerTurn,
} from "../web/native_effect_scheduler.js";
import {
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  playTowerCard,
} from "../web/tower_runtime.js";

// Condition skeleton: boolean composition plus field/card/status selectors.
{
  const context = {
    phase: NATIVE_EFFECT_PHASE.CARD_PLAY,
    exam: { review: 8 },
    card: { category: "ProduceCardCategory_ActiveSkill" },
    statusChange: { field: "review", delta: 3 },
  };
  assert.equal(evaluateNativeEffectCondition({
    all: [
      { field: "exam.review", op: "gte", value: 5 },
      { cardCategory: "ProduceCardCategory_ActiveSkill" },
    ],
  }, context), true);
  assert.equal(evaluateNativeEffectCondition({
    any: [
      { field: "exam.review", op: "lt", value: 5 },
      { statusField: "review" },
    ],
  }, context), true);
  assert.equal(evaluateNativeEffectCondition({
    not: { field: "exam.review", op: "eq", value: 0 },
  }, context), true);
}

// count / limit / phase dispatch.
{
  const scheduler = createNativeEffectScheduler({ traceEnabled: true });
  const executed = [];
  const registration = registerNativeEffect(scheduler, {
    id: "test-card-play",
    phase: NATIVE_EFFECT_PHASE.CARD_PLAY,
    sourceType: NATIVE_EFFECT_SOURCE.CARD,
    sourceId: "CARD-A",
    count: 2,
    limit: 3,
    condition: { field: "exam.review", op: "gte", value: 2 },
    effects: ["effect-a"],
  });

  const hooks = {
    executeEffect(effect) {
      executed.push(effect);
    },
  };

  dispatchNativeEffectPhase(
    scheduler,
    NATIVE_EFFECT_PHASE.CARD_PLAY,
    { exam: { review: 1 } },
    hooks,
  );
  assert.deepEqual(executed, []);
  assert.equal(registration.remainingCount, 2);

  dispatchNativeEffectPhase(
    scheduler,
    NATIVE_EFFECT_PHASE.CARD_PLAY,
    { exam: { review: 2 } },
    hooks,
  );
  dispatchNativeEffectPhase(
    scheduler,
    NATIVE_EFFECT_PHASE.CARD_PLAY,
    { exam: { review: 3 } },
    hooks,
  );
  assert.deepEqual(executed, ["effect-a", "effect-a"]);
  assert.equal(registration.remainingCount, 0);
  assert.equal(registration.active, false);
  assert.equal(registration.executionCount, 2);
  assert.equal(scheduler.trace.length, 3);
}

// turn / ttl skeleton.
{
  const scheduler = createNativeEffectScheduler();
  const registration = registerNativeEffect(scheduler, {
    id: "ttl-2",
    phase: NATIVE_EFFECT_PHASE.END_TURN,
    ttl: 2,
  });
  assert.equal(registration.remainingTurns, 2);
  assert.deepEqual(tickNativeEffectSchedulerTurn(scheduler), []);
  assert.equal(registration.remainingTurns, 1);
  assert.deepEqual(tickNativeEffectSchedulerTurn(scheduler), [registration.registrationId]);
  assert.equal(registration.remainingTurns, 0);
  assert.equal(registration.active, false);
}

// P-item / Enchant / Gimmick are source adapters over the same scheduler.
{
  const scheduler = createNativeEffectScheduler();
  const [pItem] = registerNativePItemEffects(scheduler, "PITEM-X", [{
    phase: NATIVE_EFFECT_PHASE.START_OF_TURN,
  }]);
  const [enchant] = registerNativeEnchantEffects(scheduler, "ENCHANT-X", [{
    phase: NATIVE_EFFECT_PHASE.CARD_PLAY,
  }]);
  const [gimmick] = registerNativeGimmickEffects(scheduler, "GIMMICK-X", [{
    phase: NATIVE_EFFECT_PHASE.END_TURN,
  }]);

  assert.equal(pItem.sourceType, NATIVE_EFFECT_SOURCE.P_ITEM);
  assert.equal(pItem.sourceId, "PITEM-X");
  assert.equal(enchant.sourceType, NATIVE_EFFECT_SOURCE.ENCHANT);
  assert.equal(gimmick.sourceType, NATIVE_EFFECT_SOURCE.GIMMICK);
}

// status increased/decreased diff dispatch.
{
  const scheduler = createNativeEffectScheduler();
  const hits = [];
  registerNativeEffect(scheduler, {
    id: "review-up",
    phase: NATIVE_EFFECT_PHASE.STATUS_INCREASED,
    condition: { statusField: "review" },
    effects: ["review-up-effect"],
  });
  registerNativeEffect(scheduler, {
    id: "block-down",
    phase: NATIVE_EFFECT_PHASE.STATUS_DECREASED,
    condition: { statusField: "block" },
    effects: ["block-down-effect"],
  });

  const before = captureNativeStatusSnapshot({ review: 2, block: 5 });
  const after = captureNativeStatusSnapshot({ review: 4, block: 3 });
  const events = dispatchNativeStatusDiff(
    scheduler,
    before,
    after,
    {},
    { executeEffect: (effect) => hits.push(effect) },
  );

  assert.deepEqual(hits, ["block-down-effect", "review-up-effect"]);
  assert.deepEqual(
    events.map((event) => [event.phase, event.statusChange.field, event.statusChange.delta]),
    [
      [NATIVE_EFFECT_PHASE.STATUS_DECREASED, "block", -2],
      [NATIVE_EFFECT_PHASE.STATUS_INCREASED, "review", 2],
    ],
  );
}

// Tower runtime integration: the scheduler is present and the canonical phases
// are dispatched without replacing the legacy Timer/Enchant paths yet.
{
  const masters = [
    {
      id: "A",
      isInitial: true,
      category: "ProduceCardCategory_ActiveSkill",
      playMovePositionType: "ProduceCardMovePositionType_Grave",
      playEffects: [],
    },
    {
      id: "B",
      category: "ProduceCardCategory_MentalSkill",
      playMovePositionType: "ProduceCardMovePositionType_Grave",
      playEffects: [],
    },
    {
      id: "C",
      category: "ProduceCardCategory_MentalSkill",
      playMovePositionType: "ProduceCardMovePositionType_Grave",
      playEffects: [],
    },
  ];
  const cardById = new Map(masters.map((card) => [card.id, card]));
  const state = createTowerTurnState(
    masters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
    1,
    cardById,
    { stamina: 10, effectSchedulerTrace: true },
  );

  registerNativeEffect(state.effectScheduler, {
    id: "card-phase-score",
    sourceType: NATIVE_EFFECT_SOURCE.GIMMICK,
    sourceId: "test-gimmick",
    phase: NATIVE_EFFECT_PHASE.CARD_PLAY,
    count: 1,
    effects: ["e_effect-exam_lesson-0002-01"],
  });
  registerNativeEffect(state.effectScheduler, {
    id: "after-card-score",
    sourceType: NATIVE_EFFECT_SOURCE.ENCHANT,
    sourceId: "test-enchant",
    phase: NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY,
    count: 1,
    effects: ["e_effect-exam_lesson-0003-01"],
  });

  drawTowerTurn(state, 3);
  assert.deepEqual(
    state.effectScheduler.trace.slice(0, 3).map((event) => event.phase),
    [
      NATIVE_EFFECT_PHASE.BEFORE_START_OF_TURN,
      NATIVE_EFFECT_PHASE.START_OF_TURN,
      NATIVE_EFFECT_PHASE.AFTER_START_OF_TURN,
    ],
  );

  const index = state.hand.findIndex((card) => card.id === "A");
  assert.ok(index >= 0);
  playTowerCard(state, index);
  assert.equal(state.exam.parameter, 5);
  assert.deepEqual(
    state.effectScheduler.trace.slice(-2).map((event) => event.phase),
    [NATIVE_EFFECT_PHASE.CARD_PLAY, NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY],
  );

  finishTowerTurn(state, { type: "end" });
  assert.equal(
    state.effectScheduler.trace.some((event) => event.phase === NATIVE_EFFECT_PHASE.END_TURN),
    true,
  );
}


// Composite condition objects AND their structural predicates with field/card
// predicates instead of returning after the first recognized key.
{
  const context = {
    exam: { review: 2 },
    card: { category: "ProduceCardCategory_ActiveSkill" },
  };
  assert.equal(evaluateNativeEffectCondition({
    all: [{ cardCategory: "ProduceCardCategory_ActiveSkill" }],
    field: "exam.review",
    op: "gte",
    value: 3,
  }, context), false);
}

// Registrations installed during a root dispatch are not visible to nested
// status dispatches from the same effect chain. They become eligible at the
// next root dispatch epoch.
{
  const scheduler = createNativeEffectScheduler();
  const hits = [];
  const hooks = {
    executeEffect(effect) {
      hits.push(effect);
      if (effect !== "install") return;
      registerNativeEffect(scheduler, {
        id: "late-status",
        phase: NATIVE_EFFECT_PHASE.STATUS_INCREASED,
        condition: { statusField: "review" },
        effects: ["late"],
      });
      dispatchNativeStatusDiff(
        scheduler,
        { review: 0 },
        { review: 1 },
        {},
        hooks,
      );
    },
  };
  registerNativeEffect(scheduler, {
    id: "installer",
    phase: NATIVE_EFFECT_PHASE.CARD_PLAY,
    count: 1,
    effects: ["install"],
  });

  dispatchNativeEffectPhase(scheduler, NATIVE_EFFECT_PHASE.CARD_PLAY, {}, hooks);
  assert.deepEqual(hits, ["install"]);

  dispatchNativeEffectPhase(
    scheduler,
    NATIVE_EFFECT_PHASE.STATUS_INCREASED,
    { statusChange: { field: "review", before: 1, after: 2, delta: 1 } },
    hooks,
  );
  assert.deepEqual(hits, ["install", "late"]);
}

// A registration cannot recursively re-enter itself unless explicitly opted
// in. This prevents self-amplifying status-change effects from exhausting the
// global recursion guard.
{
  const scheduler = createNativeEffectScheduler();
  let executions = 0;
  const hooks = {
    executeEffect() {
      executions += 1;
      dispatchNativeEffectPhase(
        scheduler,
        NATIVE_EFFECT_PHASE.STATUS_INCREASED,
        { statusChange: { field: "review", before: 1, after: 2, delta: 1 } },
        hooks,
      );
    },
  };
  registerNativeEffect(scheduler, {
    id: "self-status",
    phase: NATIVE_EFFECT_PHASE.STATUS_INCREASED,
    condition: { statusField: "review" },
    effects: ["again"],
  });
  dispatchNativeEffectPhase(
    scheduler,
    NATIVE_EFFECT_PHASE.STATUS_INCREASED,
    { statusChange: { field: "review", before: 0, after: 1, delta: 1 } },
    hooks,
  );
  assert.equal(executions, 1);
}

// Supplying the native turn number makes TTL spending idempotent for that turn.
{
  const scheduler = createNativeEffectScheduler();
  const registration = registerNativeEffect(scheduler, {
    id: "ttl-idempotent",
    phase: NATIVE_EFFECT_PHASE.END_TURN,
    ttl: 2,
  });
  tickNativeEffectSchedulerTurn(scheduler, { turn: 1 });
  tickNativeEffectSchedulerTurn(scheduler, { turn: 1 });
  assert.equal(registration.remainingTurns, 1);
  tickNativeEffectSchedulerTurn(scheduler, { turn: 2 });
  assert.equal(registration.active, false);
}

// Gimmick sources are wired into the real tower runtime, not only exposed as a
// scheduler adapter.
{
  const masters = ["GA", "GB", "GC"].map((id, index) => ({
    id,
    isInitial: index === 0,
    category: "ProduceCardCategory_ActiveSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  }));
  const cardById = new Map(masters.map((card) => [card.id, card]));
  const trigger = {
    id: "gimmick-trigger",
    phaseTypes: ["ProduceExamPhaseType_ExamCardPlayAfter"],
    phaseValues: [],
    fieldStatusCheckTypes: [],
    fieldStatusTypes: [],
    fieldStatusValues: [],
    fieldStatusProduceCardSearchIds: [],
    effectTypes: [],
    lessonType: "ProduceStepLessonType_Unknown",
    upperSearchCount: 0,
    lowerSearchCount: 0,
    cardSearch: null,
  };
  const state = createTowerTurnState(
    masters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
    7,
    cardById,
    {
      stamina: 10,
      gimmicks: [{
        id: "gimmick-test",
        effects: [{
          id: "gimmick-effect",
          effectCount: 1,
          effectTurn: -1,
          trigger,
          examEffects: [{
            id: "gimmick-review",
            effectType: "ProduceExamEffectType_ExamReview",
            effectValue1: 4,
            effectCount: 1,
          }],
        }],
      }],
    },
  );

  assert.equal(
    state.effectScheduler.registrations.some((entry) => entry.sourceType === "gimmick"),
    true,
  );
  drawTowerTurn(state, 3);
  const index = state.hand.findIndex((card) => card.id === "GA");
  assert.ok(index >= 0);
  playTowerCard(state, index);
  assert.equal(state.exam.review, 4);
  assert.equal(state.gimmickEffectRemainingCounts.get("gimmick::gimmick-test::gimmick-effect"), 0);
}


// Native ProduceExamGimmickEffectGroup rows resolve exactly once at startTurn,
// in ascending native priority. Later rows observe effects from earlier rows.
{
  const masters = ["RAW-A", "RAW-B", "RAW-C"].map((id, index) => ({
    id,
    isInitial: index === 0,
    category: "ProduceCardCategory_ActiveSkill",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  }));
  const cardById = new Map(masters.map((card) => [card.id, card]));
  const examEffectById = new Map([
    ["raw-block", {
      id: "raw-block",
      effectType: "ProduceExamEffectType_ExamBlock",
      effectValue1: 1,
    }],
    ["raw-review", {
      id: "raw-review",
      effectType: "ProduceExamEffectType_ExamReview",
      effectValue1: 4,
    }],
    ["raw-frozen", {
      id: "raw-frozen",
      effectType: "ProduceExamEffectType_ExamReview",
      effectValue1: 99,
    }],
  ]);
  const state = createTowerTurnState(
    masters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
    11,
    cardById,
    {
      stamina: 10,
      examEffectById,
      gimmicks: [
        {
          id: "raw-gimmick",
          priority: 2,
          startTurn: 1,
          fieldStatusType: "ProduceExamFieldStatusType_BlockUp",
          fieldStatusValue: 1,
          fieldStatusCheckType: "ProduceExamTriggerCheckType_Unknown",
          produceExamEffectId: "raw-review",
        },
        {
          id: "raw-gimmick",
          priority: 1,
          startTurn: 1,
          fieldStatusType: "ProduceExamFieldStatusType_Unknown",
          fieldStatusValue: 0,
          fieldStatusCheckType: "ProduceExamTriggerCheckType_Unknown",
          produceExamEffectId: "raw-block",
        },
        {
          id: "raw-gimmick-frozen",
          priority: 3,
          startTurn: 1,
          fieldStatusType: "ProduceExamFieldStatusType_ReviewUp",
          fieldStatusValue: 999,
          fieldStatusCheckType: "ProduceExamTriggerCheckType_Unknown",
          produceExamEffectId: "raw-frozen",
        },
      ],
    },
  );

  drawTowerTurn(state, 3);
  assert.equal(state.exam.block, 1);
  assert.equal(state.exam.review, 4, "priority 1 block must make priority 2 condition true");
  const frozen = state.effectScheduler.registrations.find(
    (entry) => entry.sourceId === "raw-gimmick-frozen",
  );
  assert.equal(frozen.active, false, "failed startTurn condition is resolved and cannot fire later");
  state.exam.review = 999;
  assert.equal(frozen.active, false);
}

// Explicit scheduler priority is deterministic and stable for ties.
{
  const scheduler = createNativeEffectScheduler();
  const order = [];
  registerNativeEffect(scheduler, {
    id: "normal-a",
    phase: NATIVE_EFFECT_PHASE.START_OF_TURN,
    priority: 0,
    effects: ["normal-a"],
  });
  registerNativeEffect(scheduler, {
    id: "early",
    phase: NATIVE_EFFECT_PHASE.START_OF_TURN,
    priority: -10,
    effects: ["early"],
  });
  registerNativeEffect(scheduler, {
    id: "normal-b",
    phase: NATIVE_EFFECT_PHASE.START_OF_TURN,
    priority: 0,
    effects: ["normal-b"],
  });
  dispatchNativeEffectPhase(
    scheduler,
    NATIVE_EFFECT_PHASE.START_OF_TURN,
    {},
    { executeEffect: (effect) => order.push(effect) },
  );
  assert.deepEqual(order, ["early", "normal-a", "normal-b"]);
}

console.log("native effect scheduler tests: ok");
