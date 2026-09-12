import assert from "node:assert/strict";
import {
  normalizeSeedObservedName,
  resolveSeedBuilderCardRef,
} from "./web/seed_history_ref_v12.js";

const cards = [
  { id: "p_card-02-men-2_054", upgradeCount: 0, name: "本番前夜" },
  { id: "p_card-02-men-2_054", upgradeCount: 1, name: "本番前夜+" },
  { id: "p_card-02-men-2_054", upgradeCount: 2, name: "本番前夜++" },
  { id: "p_card-02-men-2_054", upgradeCount: 3, name: "本番前夜+++" },
  { id: "p_card-other", upgradeCount: 0, name: "別カード" },
];

assert.deepEqual(
  resolveSeedBuilderCardRef({
    datasetCardId: "p_card-02-men-2_054",
    datasetUpgraded: "0",
    detailText: "強化: 無印",
    visibleName: "本番前夜",
  }, cards),
  { id: "p_card-02-men-2_054", upgradeCount: 0 },
);

assert.deepEqual(
  resolveSeedBuilderCardRef({
    datasetCardId: "p_card-02-men-2_054",
    datasetUpgraded: "1",
    detailText: "強化: +",
    visibleName: "本番前夜+",
  }, cards),
  { id: "p_card-02-men-2_054", upgradeCount: 1 },
);

// app_v4 がID表示を「強化: 無印」に置き換えた後でも、表示名から一意なIDへ戻せる。
assert.deepEqual(
  resolveSeedBuilderCardRef({
    detailText: "強化: 無印",
    visibleName: "本番前夜",
  }, cards),
  { id: "p_card-02-men-2_054", upgradeCount: 0 },
);

// app_v4 が動く前の旧DOM形式も継続対応する。
assert.deepEqual(
  resolveSeedBuilderCardRef({
    detailText: "p_card-02-men-2_054 · +1",
    visibleName: "本番前夜+",
  }, cards),
  { id: "p_card-02-men-2_054", upgradeCount: 1 },
);

assert.equal(normalizeSeedObservedName("本番前夜+++"), "本番前夜+");
assert.equal(normalizeSeedObservedName("本番前夜 #2"), "本番前夜");

console.log("seed history ref v12 tests: ok");