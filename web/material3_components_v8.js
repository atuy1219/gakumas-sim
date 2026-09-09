export const AppSections = Object.freeze({
  MEMORY: "memory",
  CATALOG_CARD: "catalog_card",
  CATALOG_ITEM: "catalog_item",
  SIM_EXAM: "sim_exam",
  SIM_CONTEST: "sim_contest",
  SIM_DOLLROAD: "sim_dollroad",
});

export function createDrawerItems() {
  return [
    { section: AppSections.MEMORY, label: "メモリー管理" },
    { section: AppSections.CATALOG_CARD, label: "カード図鑑" },
    { section: AppSections.CATALOG_ITEM, label: "Pアイテム図鑑" },
    { section: AppSections.SIM_EXAM, label: "試験" },
    { section: AppSections.SIM_CONTEST, label: "コンテスト" },
    { section: AppSections.SIM_DOLLROAD, label: "ドル道" },
  ];
}

export function createSimulationFlow(type) {
  if (type === AppSections.SIM_EXAM) {
    return ["MemorySelect", "CardSelect", "Simulation"];
  }
  return ["MemorySelect", "Simulation"];
}
