import assert from "node:assert/strict";
import {applyRuntimeCardGrowEffects} from "../web/card_customization.js";

const add={id:"g_effect-cost_add-1",effectType:"ProduceCardGrowEffectType_CostAdd",value:1};
const reduce={id:"g_effect-cost_reduce-1",effectType:"ProduceCardGrowEffectType_CostReduce",value:1};
// In capture (16), session 8, 巻き返し+ starts with master stamina cost 0.
// A CostReduce(1) followed by CostAdd(1) must cancel, regardless of order.
for(const growths of [[reduce,add],[add,reduce]]){
 const card={id:"p_card-03-men-1_050",stamina:0};
 for(const effect of growths)applyRuntimeCardGrowEffects(card,[effect]);
 assert.equal(card.stamina,0,"additive and reductive cost growth must cancel");
 assert.equal(card.runtimeGrowEffects.length,2);
}
// Session 8 also has イメージの基本 with base stamina 2. No phantom +1.
for(const growths of [[reduce,add],[add,reduce]]){
 const card={id:"p_card-03-men-0_015",stamina:2};
 applyRuntimeCardGrowEffects(card,growths);
 assert.equal(card.stamina,2);
}
// Larger cost reductions are retained until positive growth can offset them.
{
 const card={id:"cost-zero",stamina:0};
 const reduce5={id:"reduce5",effectType:"ProduceCardGrowEffectType_CostReduce",value:5};
 const add3={id:"add3",effectType:"ProduceCardGrowEffectType_CostAdd",value:3};
 applyRuntimeCardGrowEffects(card,[reduce5]);
 assert.equal(card.stamina,0);
 applyRuntimeCardGrowEffects(card,[add3]);
 assert.equal(card.stamina,0,"net -2 remains clamped at zero");
 applyRuntimeCardGrowEffects(card,[{...add3,id:"add3b"}]);
 assert.equal(card.stamina,1,"5 reductions vs 6 additions results in 1");
}
console.log("Native cost-grow nonnegative netting is order-independent: OK");