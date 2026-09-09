import { drawCards, searchCards, addCardEnchant } from "./exam_card_runtime_v8.js";

export function createCardEffectHooks(zone, state) {
  return {
    draw(count = 1) {
      return drawCards(zone, count);
    },
    search(effect) {
      const predicate = effect.predicate ?? (() => true);
      return searchCards(zone, predicate, effect.limit ?? 1);
    },
    enchant(effect) {
      const cardId = effect.cardId ?? state.selectedCard?.id;
      if (cardId == null) return;
      addCardEnchant(zone, cardId, effect);
    },
  };
}
