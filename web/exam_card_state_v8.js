export class CardZoneState {
  constructor(cards = []) {
    this.deck = [...cards];
    this.hand = [];
    this.grave = [];
    this.exile = [];
    this.playHistory = [];
    this.playCount = new Map();
  }

  draw(count = 1) {
    const result = [];
    for (let i = 0; i < count; i += 1) {
      const card = this.deck.shift();
      if (!card) break;
      this.hand.push(card);
      result.push(card);
    }
    return result;
  }

  play(cardId) {
    const index = this.hand.findIndex((card) => card.id === cardId);
    if (index < 0) return null;
    const [card] = this.hand.splice(index, 1);
    this.grave.push(card);
    this.playHistory.push(card);
    this.playCount.set(card.id, (this.playCount.get(card.id) ?? 0) + 1);
    return card;
  }

  countPlayed(cardId) {
    return this.playCount.get(cardId) ?? 0;
  }

  countZone(zone) {
    return Array.isArray(this[zone]) ? this[zone].length : 0;
  }

  search(predicate) {
    return this.deck.filter(predicate);
  }
}

export function createCardZoneState(cards) {
  return new CardZoneState(cards);
}
