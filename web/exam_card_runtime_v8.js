import { UnsupportedRuntimePath } from "./exam_runtime_v8.js";

export function createCardZoneState(cards = []) {
  return {
    deck: [...cards],
    hand: [],
    grave: [],
    exile: [],
    playCount: new Map(),
    enchants: new Map(),
  };
}

export function drawCards(zone, count = 1) {
  const result = [];
  for (let i = 0; i < Number(count); i++) {
    const card = zone.deck.shift();
    if (card == null) break;
    zone.hand.push(card);
    result.push(card);
  }
  return result;
}

export function searchCards(zone, predicate, limit = 1) {
  const found = [];
  zone.deck = zone.deck.filter((card) => {
    if (found.length >= limit || !predicate(card)) return true;
    found.push(card);
    return false;
  });
  return found;
}

export function playCard(zone, card) {
  const index = zone.hand.indexOf(card);
  if (index < 0) throw new UnsupportedRuntimePath("CardPlay", "card is not in hand");
  zone.hand.splice(index, 1);
  zone.grave.push(card);
  zone.playCount.set(card.id, (zone.playCount.get(card.id) ?? 0) + 1);
  return card;
}

export function addCardEnchant(zone, cardId, enchant) {
  const list = zone.enchants.get(cardId) ?? [];
  list.push(enchant);
  zone.enchants.set(cardId, list);
}
