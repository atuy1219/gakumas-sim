import assert from "node:assert/strict";
import {calculateNativeAddingParameter} from "../web/exam_score.js";
import {createTowerTurnState, drawTowerTurn} from "../web/tower_runtime.js";

// Native GetEnthusiasticBuff is already scaled when the status is granted.
// Re-applying enthusiasticMultiple while scoring must not alter its value.
const without = {enthusiastic:42, enthusiasticMultiple:1};
const withGrantMultiple = {enthusiastic:42, enthusiasticMultiple:3};
assert.equal(calculateNativeAddingParameter(withGrantMultiple, 10),
             calculateNativeAddingParameter(without, 10));
assert.equal(calculateNativeAddingParameter(withGrantMultiple, 10),52);

// Native StartTurn can automatically put cards in hand before normal draw.
// The draw only fills up to the desired hand size.
const cards=Array.from({length:9},(_,i)=>({id:`basic-${i}`,stamina:0}));
const byId=new Map(cards.map(c=>[c.id,c]));
const s=createTowerTurnState(cards,1,byId,{stamina:20,turnLimit:3,drawPerTurn:3});
drawTowerTurn(s,3);
assert.equal(s.hand.length,3);
console.log("Native enthusiasm scaling and ordinary hand capacity: ok");
