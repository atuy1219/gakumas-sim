// Native score/parameter calculation port for Gakumas Exam.
//
// Verified against the 2026-09-06 Android IL2CPP binary:
//   ExamEffectUtility.CalculateAddingParameter @ 0x7FED83C
//   ExamEffectUtility.AddParameter          @ 0x7FEE20C
//   ExamEffectUtility.AddParameterFix       @ 0x7FEE25C
//   ExamParameterModel.CalcCurrentTurnBattleBonus @ 0x804B634
//
// All intermediate arithmetic that is native float is explicitly rounded to
// float32 with Math.fround. The native epsilon constant at 0x272BA00 is
// -0.0001f, used immediately before ceil in the final parameter/battle paths.

const F32_NEG_EPSILON = Math.fround(-0.0001);
const INT32_MAX = 0x7fffffff;

export const EXAM_SCORE_DEFAULT_SETTING = Object.freeze({
  examGimmickParameterDebuffPermil: 667,
  examParameterBuffPermil: 1500,
  examParameterBuffMultiplePerTurnPermil: 100,
  examConcentrationLessonValueMultiplePermil: 2000,
  examFullPowerLessonValueMultiplePermil: 3000,
  examOverPreservationLessonValueMultiplePermil: 0,
  examConcentrationLessonValueMultiplePermil1: 2000,
  examConcentrationLessonValueMultiplePermil2: 2500,
  examPreservationLessonValueMultiplePermil1: 500,
  examPreservationLessonValueMultiplePermil2: 250,
  examLessonValueMultipleDependReviewOrAggressiveMultiplePermil: 20,
  examLessonValueMultipleDependReviewOrAggressiveMaxPermil: 500,
});

export const EXAM_IDOL_STATUS_TYPE = Object.freeze({
  Unknown: 0,
  Concentration: 1,
  Preservation: 2,
  FullPower: 3,
  OverPreservation: 4,
});

function f32(value) {
  return Math.fround(Number(value) || 0);
}

function ceilF32(value) {
  return Math.ceil(f32(value));
}

function fromPermil(value) {
  return f32(f32(value) / f32(1000));
}

function clampInt32NonNegative(value) {
  if (!Number.isFinite(Number(value))) return INT32_MAX;
  return Math.max(0, Math.min(INT32_MAX, Math.trunc(Number(value))));
}

function positiveInt(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function ratioOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? f32(numeric) : f32(fallback);
}

function settingValue(settings, key) {
  const value = settings?.[key];
  if (value !== undefined && value !== null && Number.isFinite(Number(value))) return Number(value);
  return Number(EXAM_SCORE_DEFAULT_SETTING[key] ?? 0);
}

export function nativeCeilWithEpsilon(value) {
  return ceilF32(f32(f32(value) + F32_NEG_EPSILON));
}

export function calculateNativeDependentLessonBase(sourceValue, permil) {
  const scaled = f32(fromPermil(permil) * f32(sourceValue));
  return clampInt32NonNegative(nativeCeilWithEpsilon(scaled));
}

export function calculateNativeAddingParameter(exam, valueInput, options = {}) {
  // ExamEffectUtility.CalculateAddingParameter(..., isBuffActive=true).
  if (exam?.slump) return 0;

  const settings = options.settings ?? exam?.scoreSettings ?? EXAM_SCORE_DEFAULT_SETTING;
  const modifier = options.modifier ?? null;

  let parameterBuffMultiple = f32(1);
  if (positiveInt(exam?.parameterBuff) > 0) {
    let parameterBuff = f32(
      fromPermil(settingValue(settings, "examParameterBuffPermil")) + f32(-1),
    );
    if (positiveInt(exam?.parameterBuffMultiplePerTurn) > 0) {
      const extra = f32(
        f32(positiveInt(exam?.parameterBuff))
        * fromPermil(settingValue(settings, "examParameterBuffMultiplePerTurnPermil")),
      );
      parameterBuff = f32(parameterBuff + extra);
    }
    if (modifier && Number.isFinite(Number(modifier.parameterBuffMultiple))) {
      parameterBuff = f32(parameterBuff * f32(modifier.parameterBuffMultiple));
    }
    parameterBuffMultiple = f32(f32(1) + parameterBuff);
  }

  const parameterDebuffMultiple = exam?.parameterDebuff
    ? fromPermil(settingValue(settings, "examGimmickParameterDebuffPermil"))
    : f32(1);

  const lessonBuff = positiveInt(exam?.lessonBuff);
  const lessonDebuff = positiveInt(exam?.lessonDebuff);
  let enthusiastic = positiveInt(exam?.enthusiastic);
  if (modifier && Number.isFinite(Number(modifier.enthusiasticMultiple))) {
    enthusiastic = clampInt32NonNegative(
      ceilF32(f32(f32(modifier.enthusiasticMultiple) * f32(enthusiastic))),
    );
  }

  // Native GetLessonParameterMultiple is 1 + sum(statusPermil/1000).
  const lessonParameterMultiple = ratioOr(exam?.lessonParameterMultiple, 1);
  const lessonParameterDown = ratioOr(exam?.lessonParameterDown, 0);
  const downFactor = f32(Math.max(f32(0), f32(f32(1) - lessonParameterDown)));

  let reviewAggressiveDepend = f32(0);
  if (exam?.lessonValueDependReviewAggressive) {
    const source = Math.max(positiveInt(exam?.review), positiveInt(exam?.aggressive));
    reviewAggressiveDepend = f32(
      f32(source)
      * fromPermil(settingValue(settings, "examLessonValueMultipleDependReviewOrAggressiveMultiplePermil")),
    );
    reviewAggressiveDepend = f32(Math.min(
      reviewAggressiveDepend,
      fromPermil(settingValue(settings, "examLessonValueMultipleDependReviewOrAggressiveMaxPermil")),
    ));
  }

  const lessonBuffMultiple = ratioOr(exam?.lessonBuffMultiple, 1);
  let stanceMultiple = f32(1);
  const idolStatusType = Math.trunc(Number(exam?.idolStatusType) || 0);
  const idolStatusStep = Math.trunc(Number(exam?.idolStatusStep) || 0);

  if (idolStatusType === EXAM_IDOL_STATUS_TYPE.Concentration) {
    const key = idolStatusStep === 1
      ? "examConcentrationLessonValueMultiplePermil1"
      : "examConcentrationLessonValueMultiplePermil2";
    let base = f32(fromPermil(settingValue(settings, key)) + f32(-1));
    base = f32(
      base
      + f32(ratioOr(exam?.concentrationLessonMultipleAdditive, 1) - f32(1)),
    );
    const factor = modifier && Number.isFinite(Number(modifier.concentrationMultiple))
      ? f32(modifier.concentrationMultiple)
      : f32(1);
    stanceMultiple = f32(f32(1) + f32(base * factor));
  } else if (idolStatusType === EXAM_IDOL_STATUS_TYPE.Preservation) {
    const key = idolStatusStep === 1
      ? "examPreservationLessonValueMultiplePermil1"
      : "examPreservationLessonValueMultiplePermil2";
    stanceMultiple = fromPermil(settingValue(settings, key));
  } else if (idolStatusType === EXAM_IDOL_STATUS_TYPE.FullPower) {
    let base = f32(
      fromPermil(settingValue(settings, "examFullPowerLessonValueMultiplePermil"))
      + f32(-1),
    );
    base = f32(
      base
      + f32(ratioOr(exam?.fullPowerLessonMultipleAdditive, 1) - f32(1)),
    );
    const factor = modifier && Number.isFinite(Number(modifier.fullPowerMultiple))
      ? f32(modifier.fullPowerMultiple)
      : f32(1);
    stanceMultiple = f32(f32(1) + f32(base * factor));
  } else if (idolStatusType === EXAM_IDOL_STATUS_TYPE.OverPreservation) {
    stanceMultiple = fromPermil(
      settingValue(settings, "examOverPreservationLessonValueMultiplePermil"),
    );
  }

  // GetLessonChangeSpecifyMoreThanStatus / LessThanStatus can replace the
  // incoming base. The web state exposes the resolved override values directly.
  let adjusted = Math.trunc(Number(valueInput) || 0);
  if (Number.isFinite(Number(exam?.lessonChangeSpecifyMoreThan))
      && Number(exam.lessonChangeSpecifyMoreThan) >= 0) {
    adjusted = Math.trunc(Number(exam.lessonChangeSpecifyMoreThan));
  }
  if (Number.isFinite(Number(exam?.lessonChangeSpecifyLessThan))
      && Number(exam.lessonChangeSpecifyLessThan) >= 0) {
    adjusted = Math.trunc(Number(exam.lessonChangeSpecifyLessThan));
  }

  // This inner ceil has no epsilon in native code.
  const multipliedLessonBuff = ceilF32(f32(lessonBuffMultiple * f32(lessonBuff)));
  const base = Math.max(
    0,
    multipliedLessonBuff - lessonDebuff + enthusiastic + adjusted,
  );

  const lessonMultiple = f32(lessonParameterMultiple + reviewAggressiveDepend);
  let result = f32(stanceMultiple * downFactor);
  result = f32(result * lessonMultiple);
  result = f32(result * parameterDebuffMultiple);
  result = f32(result * parameterBuffMultiple);
  result = f32(result * f32(base));

  return clampInt32NonNegative(nativeCeilWithEpsilon(result));
}

export function applyNativeBattleBonus(valueInput, bonusPermilInput) {
  const value = clampInt32NonNegative(valueInput);
  const bonusPermil = Number(bonusPermilInput);
  if (!Number.isFinite(bonusPermil)) return value;
  const result = f32(fromPermil(bonusPermil) * f32(value));
  return Math.max(0, nativeCeilWithEpsilon(result));
}

function parameterField(parameterType) {
  switch (String(parameterType ?? "")) {
    case "Vocal": return "parameterVocal";
    case "Dance": return "parameterDance";
    case "Visual": return "parameterVisual";
    default: return "";
  }
}

export function addNativeLessonParameter(exam, baseValue, scoreContext = {}, modifier = null) {
  const calculated = calculateNativeAddingParameter(exam, baseValue, {
    settings: scoreContext.settings,
    modifier,
  });
  const added = scoreContext.isBattle || Number.isFinite(Number(scoreContext.battleBonusPermil))
    ? applyNativeBattleBonus(calculated, scoreContext.battleBonusPermil)
    : calculated;

  exam.parameter = clampInt32NonNegative(Number(exam?.parameter ?? 0) + added);
  const field = parameterField(scoreContext.parameterType);
  if (field) exam[field] = clampInt32NonNegative(Number(exam?.[field] ?? 0) + added);

  return {
    baseValue: Math.trunc(Number(baseValue) || 0),
    calculated,
    added,
    parameterType: String(scoreContext.parameterType ?? ""),
    battleBonusPermil: Number.isFinite(Number(scoreContext.battleBonusPermil))
      ? Number(scoreContext.battleBonusPermil)
      : null,
  };
}

export function applyNativeLessonHits(exam, baseValue, countInput = 1, scoreContext = {}, modifier = null) {
  const count = Math.max(0, Math.trunc(Number(countInput) || 0));
  const hits = [];
  for (let index = 0; index < count; index += 1) {
    hits.push(addNativeLessonParameter(exam, baseValue, scoreContext, modifier));
  }
  return {
    hits,
    added: hits.reduce((sum, hit) => sum + hit.added, 0),
  };
}

export function applyNativeReviewTurnEnd(exam, scoreContext = {}) {
  // ExamSequence turn-end path @ 0x8096850:
  // Review -> ReviewMultiple -> ceil(review * multiple), then emits the
  // equivalent Lesson effect ReviewCountAdd + 1 times.
  const review = positiveInt(exam?.review);
  if (review < 1) return { baseValue: 0, count: 0, hits: [], added: 0 };

  const reviewMultiple = ratioOr(exam?.reviewMultiple, 1);
  const baseValue = clampInt32NonNegative(ceilF32(f32(reviewMultiple * f32(review))));
  const count = positiveInt(exam?.reviewCountAdd) + 1;
  const result = applyNativeLessonHits(exam, baseValue, count, scoreContext);
  return { baseValue, count, ...result };
}
