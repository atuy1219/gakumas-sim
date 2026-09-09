export const DrawerItems = [
  { id: "memory", label: "メモリー管理" },
  { id: "card_catalog", label: "P図鑑 - カード" },
  { id: "item_catalog", label: "P図鑑 - Pアイテム" },
  { id: "simulator", label: "シミュレーター" },
];

export const SimulatorItems = [
  { id: "audition", label: "試験" },
  { id: "contest", label: "コンテスト" },
  { id: "dollroad", label: "ドル道" },
];

export function createMaterial3NavigationState() {
  return {
    drawerOpen: false,
    current: "simulator",
  };
}
