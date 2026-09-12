export function normalizeSeedObservedName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+#\d+$/, "")
    .replace(/\s*\++\s*$/, (suffix) => suffix.trim() ? "+" : "");
}

function baseCardName(value) {
  return String(value ?? "").trim().replace(/\s*\++\s*$/, "").trim();
}

function explicitUpgradeFromName(value) {
  return /\+\s*$/.test(String(value ?? "").trim()) ? 1 : 0;
}

function normalizeMemoryUpgrade(value) {
  return Number(value ?? 0) > 0 ? 1 : 0;
}

export function resolveSeedBuilderCardRef(meta, cards = []) {
  const datasetCardId = String(meta?.datasetCardId ?? "").trim();
  const datasetUpgraded = String(meta?.datasetUpgraded ?? "").trim();
  const detailText = String(meta?.detailText ?? "").trim();
  const visibleName = String(meta?.visibleName ?? "").trim();

  const detailId = detailText.match(/p_card-[^\s·]+/)?.[0] ?? "";
  let id = /^p_card-/.test(datasetCardId) ? datasetCardId : detailId;

  let upgradeCount;
  if (datasetUpgraded === "0" || datasetUpgraded === "1") {
    upgradeCount = Number(datasetUpgraded);
  } else {
    const detailUpgrade = detailText.match(/(?:^|·|\s)\+(\d+)\s*$/)?.[1];
    if (detailUpgrade !== undefined) upgradeCount = normalizeMemoryUpgrade(detailUpgrade);
  }

  if (!id && visibleName) {
    const visibleBase = baseCardName(visibleName);
    const matches = cards.filter((card) => {
      const name = String(card?.name ?? "");
      const baseName = String(card?.baseName ?? baseCardName(name));
      return name === visibleName || baseName === visibleBase || baseCardName(name) === visibleBase;
    });
    const ids = [...new Set(matches.map((card) => String(card?.id ?? "")).filter(Boolean))];
    if (ids.length === 1) id = ids[0];
    if (upgradeCount === undefined && matches.length) {
      const exact = matches.find((card) => String(card?.name ?? "") === visibleName);
      upgradeCount = normalizeMemoryUpgrade(exact?.upgradeCount ?? explicitUpgradeFromName(visibleName));
    }
  }

  if (!id) return null;
  if (upgradeCount === undefined) upgradeCount = explicitUpgradeFromName(visibleName);
  return { id, upgradeCount: normalizeMemoryUpgrade(upgradeCount) };
}

export function seedRefLabels(ref, cardVariantByKey, cardById, observationCardLabel) {
  const upgradeCount = normalizeMemoryUpgrade(ref?.upgradeCount);
  const master = cardVariantByKey?.get?.(`${String(ref?.id ?? "")}@@${upgradeCount}`)
    ?? cardById?.get?.(String(ref?.id ?? ""))
    ?? {};
  const rawName = String(master?.name ?? ref?.visibleName ?? ref?.id ?? "");
  return new Set([
    normalizeSeedObservedName(rawName),
    normalizeSeedObservedName(observationCardLabel(rawName, upgradeCount)),
    normalizeSeedObservedName(ref?.visibleName),
    normalizeSeedObservedName(ref?.id),
  ].filter(Boolean));
}
