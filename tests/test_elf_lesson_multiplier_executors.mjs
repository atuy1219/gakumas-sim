import assert from "node:assert/strict";
import { createExamState } from "../web/exam_effects.js";
import {
  NATIVE_LESSON_MODIFIER_KIND, applyNativeModifiedLessonRepeat,
  EXAM_IDOL_STATUS_TYPE,
} from "../web/exam_score.js";
import {
  NATIVE_EFFECT_EXECUTOR_CLASSES, NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES,
  currentTowerScoreContext,
} from "../web/tower_runtime.js";

// ELF: LessonMultipleConcentrationEffectExecutor @ 0x805b180,
// LessonMultipleFullPowerEffectExecutor @ 0x805b658.
// Each calculates once with modifier = 1 + FloatFromPermil(Value2) and
// invokes AddParameter Count times, WITHOUT recalculating each hit.
const cases = [
  {
    name: "LessonMultipleConcentrationEffectExecutor",
    type: "ExamMultipleConcentrationLesson",
    stance: EXAM_IDOL_STATUS_TYPE.Concentration,
    modifier: NATIVE_LESSON_MODIFIER_KIND.Concentration,
    settings: { examConcentrationLessonValueMultiplePermil1: 2000 },
  },
  {
    name: "LessonMultipleFullPowerEffectExecutor",
    type: "ExamMultipleFullPowerLesson",
    stance: EXAM_IDOL_STATUS_TYPE.FullPower,
    modifier: NATIVE_LESSON_MODIFIER_KIND.FullPower,
    settings: { examFullPowerLessonValueMultiplePermil: 2000 },
  },
];

for (const scenario of cases) {
  const ctor = NATIVE_EFFECT_EXECUTOR_CLASSES[scenario.name];
  assert.equal(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES[scenario.type], ctor);
  const exam = createExamState();
  exam.idolStatusType = scenario.stance;
  exam.idolStatusStep = 1;
  const state = {
    exam, turn: 1, examScoreSettings: scenario.settings,
    turnParameterTypes: [], parameterBonus: {},
  };
  const event = { effects: [] };
  const parsed = { id: scenario.type, count: 3, value1: 10, value2: 500 };
  ctor.ExecuteEffect({
    state, parsed, event, exam, v1: 10, v2: 500,
    type: scenario.type,
  });
  const expectedExam = createExamState();
  expectedExam.idolStatusType = scenario.stance;
  expectedExam.idolStatusStep = 1;
  const expected = applyNativeModifiedLessonRepeat(
    expectedExam, 10, 500, 3, scenario.modifier,
    currentTowerScoreContext(state),
  );
  assert.equal(exam.parameter, expectedExam.parameter, scenario.name);
  assert.equal(expected.hits.length, 3);
  assert.equal(exam.parameter, expected.added);
  assert.equal(event.effects.length, 1);
  assert.match(event.effects[0], new RegExp(String(expected.added)));

  const before = exam.parameter;
  ctor.ExecuteEffect({
    state, parsed: { ...parsed, count: 0 }, event, exam, v1: 10, v2: 500,
    type: scenario.type,
  });
  assert.equal(exam.parameter, before, "native Count=0 must not invoke AddParameter");
}
console.log("ELF lesson multiplier executors (concentration/fullpower): OK");
