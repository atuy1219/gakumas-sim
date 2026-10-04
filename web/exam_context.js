// Explicit battle inputs retained with the deck. Missing gimmicks are never inferred.
export function normalizeExamContext(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result = {};
  for (const key of ["produceItemIds", "produceExamGimmickEffectGroupId", "gimmicks", "parameterBonus", "examSetting", "turnLimit"]) {
    if (Object.hasOwn(input, key)) result[key] = JSON.parse(JSON.stringify(input[key] ?? null));
  }
  return result;
}
