import assert from "node:assert/strict";
import { createExamState, calculateNativeBlockAdd } from "../web/exam_effects.js";
import { NATIVE_EFFECT_EXECUTOR_CLASSES, NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES } from "../web/tower_runtime.js";

const check = (executorName, type, exam, { v1 = 0, v2 = 0, count = 1, search = 0 }, expected) => {
  const ctor = NATIVE_EFFECT_EXECUTOR_CLASSES[executorName];
  assert.equal(NATIVE_MASTER_EFFECT_EXECUTOR_CLASSES[type], ctor, type);
  const state = { exam, turn: 1, turnParameterTypes: [], parameterBonus: {} };
  const event = { effects: [] };
  ctor.ExecuteEffect({ state, exam, event, parsed: { count, value1: v1, value2: v2 },
    v1, v2, searchCount: () => search, type,
    status: (field, value, label) => { exam[field] = Number(exam[field] ?? 0) + value; event.effects.push(label + " +" + value); },
  });
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(exam[key], value, executorName + " " + key);
  }
  assert.equal(event.effects.length >= 1, true, executorName);
};
{
  const e = createExamState(); e.review=6;
  check("AggressiveDependReviewEffectExecutor","ExamAggressiveDependReview",e,{ v1:500 },{aggressive:3, review:6});
}
{
  const e=createExamState();
  check("AggressivePerSearchCountEffectExecutor","ExamAggressivePerSearchCount",e,
    { v1:4, v2:500, search:3 },{aggressive:6});
}
{
  const e=createExamState();
  check("AggressivePerSearchCountEffectExecutor","ExamAggressivePerSearchCount",e,
    { v1:4, v2:500, search:0 },{aggressive:4});
}
{
  const e=createExamState();
  check("BlockPerSearchCountEffectExecutor","ExamBlockPerSearchCount",e,
    { v1:3, v2:1000, search:2 },{block:5});
}
{
  const e=createExamState();e.fullPowerPointGetSum=10;
  check("FullPowerPointDependFullPowerPointGetSumEffectExecutor",
    "ExamFullPowerPointDependFullPowerPointGetSum",e,{v1:500},
    {fullPowerPoint:5, fullPowerPointGetSum:15});
}
{
  const e=createExamState();
  check("FullPowerPointPerSearchCountEffectExecutor","ExamFullPowerPointPerSearchCount",e,
    {v1:4,v2:500,search:2},{fullPowerPoint:5,fullPowerPointGetSum:5});
}
{
  const e=createExamState();e.aggressive=8;
  check("LessonDependAggressiveAndSearchCountEffectExecutor",
    "ExamLessonDependAggressiveAndSearchCount",e,
    {v1:1000,v2:500,count:2,search:2},{parameter:32,aggressive:8});
}
{
  const e=createExamState();e.review=6;
  check("LessonDependReviewAndSearchCountEffectExecutor",
    "ExamLessonDependReviewAndSearchCount",e,
    {v1:500,v2:500,count:2,search:2},{parameter:18,review:6});
}
{
  const e=createExamState();e.review=6;
  check("LessonDependReviewAndSearchCountEffectExecutor",
    "ExamLessonDependReviewAndSearchCount",e,
    {v1:500,v2:500,count:0,search:2},{parameter:0,review:6});
}
{
  const e=createExamState();
  check("LessonAddBlockEffectExecutor","ExamLessonAddBlock",e,{v1:8},
    {parameter:8,block:calculateNativeBlockAdd(createExamState(),8)});
}
console.log("8 ELF-backed dependent/search/lesson executors: passed");
