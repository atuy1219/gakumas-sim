import assert from "node:assert/strict";
import { XorShift32 } from "../web/engine.js";
import {
  NATIVE_EFFECT_PHASE,
  createNativeEffectScheduler,
  registerNativeEffect,
  dispatchNativeEffectPhase,
} from "../web/native_effect_scheduler.js";

// The native GetInsertTriggerEffectListCommand at 0x80A7C18 calls SpendCount
// at 0x80A8104 while building commands, before ExecuteEffect starts.
// Old behavior consumed counts *after* each effect and allowed a nested
// event to observe still-eligible registrations from the same phase.
{
  const scheduler = createNativeEffectScheduler({ traceEnabled: true });
  const order = [];
  const registrations = ["first", "second"].map(id => registerNativeEffect(scheduler, {
    id, phase: NATIVE_EFFECT_PHASE.CARD_PLAY, count: 1,
    effects: [id],
  }));
  const initialRng = 0x12345678;
  const rng = new XorShift32(initialRng);
  const oracle = new XorShift32(initialRng);
  const expectedRolls = [oracle.nextInt(0, 1000), oracle.nextInt(0, 1000)];
  const observedRolls = [];
  let inNested = false;
  const hooks = {
    beforeRegistration(registration) {
      order.push(`match:${registration.id}`);
      // The command collector does not draw random numbers.
      assert.equal(rng.state, initialRng);
    },
    afterRegistration(registration) {
      order.push(`reserve:${registration.id}`);
      assert.equal(registration.remainingCount, 0);
      assert.equal(registration.active, false);
      assert.equal(rng.state, initialRng);
    },
    executeEffect(effect) {
      order.push(`execute:${effect}`);
      assert.equal(registrations[0].remainingCount, 0);
      assert.equal(registrations[1].remainingCount, 0);
      observedRolls.push(rng.nextInt(0, 1000));
      if (effect === "first" && !inNested) {
        inNested = true;
        dispatchNativeEffectPhase(scheduler, NATIVE_EFFECT_PHASE.CARD_PLAY, {}, hooks);
        inNested = false;
      }
    },
  };
  const evt = dispatchNativeEffectPhase(scheduler, NATIVE_EFFECT_PHASE.CARD_PLAY, {}, hooks);
  assert.deepEqual(order, ["match:first", "reserve:first", "match:second", "reserve:second", "execute:first", "execute:second"]);
  assert.deepEqual(observedRolls, expectedRolls);
  assert.equal(rng.state, oracle.state);
  assert.deepEqual(evt.executedRegistrationIds, registrations.map(r => r.registrationId));
  assert.equal(scheduler.dispatchDepth, 0);
}

// Eligibility snapshots are evaluated before commands modify state, and all
// limits are reserved before the first effect can mutate a status.
{
  const scheduler = createNativeEffectScheduler();
  const exam = { review: 0 };
  const events = [];
  const registrations = ["A", "B"].map(id => registerNativeEffect(scheduler, {
    id, phase: NATIVE_EFFECT_PHASE.START_OF_TURN, count: 1,
    condition: { field: "exam.review", op: "eq", value: 0 },
    effects: [id],
  }));
  dispatchNativeEffectPhase(scheduler, NATIVE_EFFECT_PHASE.START_OF_TURN, { exam }, {
    executeEffect(effect) {
      events.push([effect, registrations.map(r => r.remainingCount)]);
      exam.review = 10;
    },
  });
  assert.deepEqual(events, [["A", [0, 0]], ["B", [0, 0]]]);
}

// A shared count mirror (the status/P-item/gimmick case) is spent before
// nested commands and can prevent later registrations sharing one budget.
{
  const scheduler = createNativeEffectScheduler();
  const shared = { count: 1 };
  const calls = [];
  for (const id of ["first", "second"]) registerNativeEffect(scheduler, {
    id, phase: NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY, count: 1,
    effects: [id],
  });
  dispatchNativeEffectPhase(scheduler, NATIVE_EFFECT_PHASE.AFTER_CARD_PLAY, {}, {
    beforeRegistration() { return shared.count > 0; },
    afterRegistration() { shared.count -= 1; },
    executeEffect(effect) { calls.push(effect); assert.equal(shared.count, 0); },
  });
  assert.deepEqual(calls, ["first"]);
}

console.log("native command materialization, trigger timing, and RNG sequence: OK");
