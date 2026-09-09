import { CardZoneState } from "./exam_card_state_v8.js";

export function createSimulationState(options = {}) {
  return {
    ...options,
    zones: new CardZoneState(options.deck ?? []),
    cardEnchants: new Map(),
    cardPlayCount: new Map(),
  };
}

export function recordCardPlay(state, cardId) {
  const count = state.cardPlayCount.get(cardId) ?? 0;
  state.cardPlayCount.set(cardId, count + 1);
}

export function addCardEnchant(state, cardId, enchant) {
  const list = state.cardEnchants.get(cardId) ?? [];
  list.push({ ...enchant });
  state.cardEnchants.set(cardId, list);
}

export function getCardEnchants(state, cardId) {
  return state.cardEnchants.get(cardId) ?? [];
}

export function getCardPlayCount(state, cardId) {
  return state.cardPlayCount.get(cardId) ?? 0;
}
