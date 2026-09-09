export const NavigationItems = Object.freeze([
  { id: "memory", label: "メモリー管理" },
  { id: "pokedex-card", label: "P図鑑 - カード" },
  { id: "pokedex-item", label: "P図鑑 - Pアイテム" },
  { id: "simulator-audition", label: "試験" },
  { id: "simulator-contest", label: "コンテスト" },
  { id: "simulator-dollar-road", label: "ドル道" },
]);

export const SimulatorFlow = Object.freeze({
  audition: ["MemorySelect", "CardSelect", "Simulation"],
  contest: ["MemorySelect", "Simulation"],
  dollarRoad: ["MemorySelect", "RouteSelect", "Simulation"],
});
