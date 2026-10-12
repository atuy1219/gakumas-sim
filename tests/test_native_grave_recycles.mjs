import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { XorShift32 } from "../web/engine.js";

// Native ExamCardMoveController.ReplaceGraveToDeck capture 1.5.34.
// Compare the complete pool order and RNG state, not merely the first draw.
const fixture=JSON.parse(readFileSync(new URL("./fixtures/native-grave-recycles-v1534.json",import.meta.url),"utf8"));
assert.equal(fixture.observations.length,22);
for(const obs of fixture.observations){
 const rng=new XorShift32(obs.beforeRandomState);
 const simulated=[...obs.grave];
 for(let n=simulated.length;n>=2;n--){
  const j=rng.nextInt(0,n);
  [simulated[j],simulated[n-1]]=[simulated[n-1],simulated[j]];
 }
 assert.deepEqual(simulated,obs.deck,
  "incorrect grave recycle order in native session "+obs.sessionId+" step "+obs.step);
 assert.equal(rng.state>>>0,obs.afterRandomState>>>0,
  "incorrect RNG state in native session "+obs.sessionId+" step "+obs.step);
}
console.log("Native grave recycling: 22/22 complete order and RNG-state parity");
