import { createHash } from "node:crypto";

const canonical = (customizes) => JSON.stringify(customizes
  .map(({ id, customizeCount }) => ({ id, customizeCount }))
  .sort((a, b) => a.id.localeCompare(b.id)));

// Explicit, capture-bound evidence supplements. Never infer customization
// from a native score, or replace captured customization with a guessed value.
export function prepareCustomizationOverrides(manifest, captureBytes, customizeById) {
  const captureSha256 = createHash("sha256").update(captureBytes).digest("hex");
  if (manifest?.schemaVersion !== 1 || typeof manifest.source !== "string" || !manifest.source.trim()
      || !Array.isArray(manifest.captureSha256) || !manifest.captureSha256.includes(captureSha256)
      || !Array.isArray(manifest.sessions)) {
    throw new Error("Customization supplement is invalid or does not cover this capture SHA-256");
  }
  const sessions = new Map();
  for (const row of manifest.sessions) {
    if (!Number.isInteger(row.sessionId) || row.sessionId < 1 || sessions.has(row.sessionId)
        || !Array.isArray(row.cards)) throw new Error("Invalid customization supplement session");
    const ids = new Set();
    for (const card of row.cards) {
      if (typeof card.id !== "string" || !card.id || ids.has(card.id)
          || !Array.isArray(card.customizes) || !card.customizes.length) {
        throw new Error("Invalid customization supplement card");
      }
      ids.add(card.id);
      const customIds = new Set();
      for (const custom of card.customizes) {
        const master = customizeById.get(custom.id);
        if (customIds.has(custom.id) || !Number.isInteger(custom.customizeCount)
            || custom.customizeCount < 1
            || !(master?.levels ?? []).some((level) => level.count === custom.customizeCount)) {
          throw new Error("Unknown or invalid customization supplement level: " + custom.id);
        }
        customIds.add(custom.id);
      }
    }
    sessions.set(row.sessionId, row.cards);
  }
  const appliedBySession = [];
  return {
    evidence: { source: manifest.source, captureSha256, appliedBySession },
    apply(sessionId, normalized) {
      const cards = sessions.get(Number(sessionId));
      if (!cards || !normalized.input) return normalized;
      const appliedCardIds = [];
      for (const supplement of cards) {
        const matches = normalized.input.initialDeck.filter((card) => card.id === supplement.id);
        if (matches.length !== 1) throw new Error("Customization supplement card identity is not unique: " + supplement.id);
        const card = matches[0];
        if (Array.isArray(card.customizes)) {
          if (canonical(card.customizes) !== canonical(supplement.customizes)) {
            throw new Error("Customization supplement conflicts with captured data: " + card.id);
          }
          continue;
        }
        card.customizes = supplement.customizes.map((custom) => ({ ...custom }));
        card.customizationSource = "explicit-user-confirmed-supplement";
        appliedCardIds.push(card.id);
      }
      const evidence = { source: manifest.source, captureSha256, appliedCardIds };
      appliedBySession.push({ sessionId: Number(sessionId), ...evidence });
      normalized.candidates.customizationSupplement = evidence;
      // External evidence never becomes a verified native initial capture.
      normalized.input.metadata.initialDeckCustomizationVerified = false;
      return normalized;
    },
  };
}
