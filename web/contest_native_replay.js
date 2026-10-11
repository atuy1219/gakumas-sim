// Independent effect replay for contest captures whose initial conditions are
// fully resolved. Native actions are used as a decision trace; scoring and RNG
// are computed by gakumas-sim, not copied from observed scores.
import { createTowerTurnState, drawTowerTurn, playTowerCard, finishTowerTurn } from "./tower_runtime.js";

export class ContestReplayUnsupported extends Error {
  constructor(message){super(message);this.name="ContestReplayUnsupported";}
}
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
function requireNumber(x,name){
 const n=Number(x);
 if(x===null||x===undefined||x===""||!Number.isFinite(n))throw new ContestReplayUnsupported("missing-or-invalid:"+name);
 return n;
}
function deckIds(deck) {return deck.map(c=>String(c.id??c.produceCardId??""));}
function normalizeType(type){
 const t=String(type??"").toLowerCase();
 if(["1","vocal","vo"].includes(t))return "vocal";
 if(["2","dance","da"].includes(t))return "dance";
 if(["3","visual","vi"].includes(t))return "visual";
 throw new ContestReplayUnsupported("unsupported-turn-parameter-type:"+type);
}
function normalizeCard(card){
 return {id:String(card?.id??card?.produceCardId??""),upgradeCount:Number(card?.upgradeCount??0)};
}
export function replayObservedContest(session,input,{cardById=new Map(),cardVariantByKey=new Map(),examItemCatalogs={}}={}){
 if(!session?.start||!Array.isArray(session.turns)||!session.turns.length)
  throw new ContestReplayUnsupported("no-complete-native-turn-history");
 if(!session.complete)throw new ContestReplayUnsupported("incomplete-native-capture");
 const deck=input?.initialDeck, p=input?.initialParameters;
 if(!Array.isArray(deck)||!deck.length||deck.some(c=>!String(c?.id??c?.produceCardId??"")))
  throw new ContestReplayUnsupported("initialDeck-not-available");
 if(!p||typeof p!=="object")throw new ContestReplayUnsupported("initialParameters-not-available");
 if(!Array.isArray(input?.pItems)||!input?.examSettings)
  throw new ContestReplayUnsupported("pItems-or-examSettings-missing");
 const random=requireNumber(input.randomStateAtStart,"randomStateAtStart");
 const seed=requireNumber(session.start.seed,"seed");
 const stamina=requireNumber(p.stamina,"initialParameters.stamina");
 const maxStamina=requireNumber(p.maxStamina,"initialParameters.maxStamina");
 const turnTypes=p.turnParameterTypes;
 if(!Array.isArray(turnTypes)||turnTypes.length<session.turns.length)
  throw new ContestReplayUnsupported("turn-parameter-types-missing");
 const canonicalTypes=turnTypes.map(normalizeType);
 const masters=new Map(cardById);
 for(const [id,master] of Object.entries(input.cardMasters||{}))masters.set(id,master);
 for(const card of deck){
  const id=String(card.id??card.produceCardId);
  if(!masters.has(id))throw new ContestReplayUnsupported("missing-card-master:"+id);
 }
 const options={
  initialRandomState:random>>>0,initialRandomStateSource:"captured",
  stamina,drawPerTurn:requireNumber(p.drawPerTurn,"drawPerTurn"),
  turnLimit:requireNumber(p.turnLimit,"turnLimit"),
  pItems:input.pItems,turnParameterTypes:canonicalTypes,
  examRuntimeSettings:input.examSettings,examScoreSettings:input.examSettings,
  cardVariantByKey,
  itemById:examItemCatalogs.itemById,
  examEffectById:examItemCatalogs.examEffectById??new Map(),
  examStatusEnchantById:examItemCatalogs.examStatusEnchantById??new Map(),
  examTriggerById:examItemCatalogs.examTriggerById??new Map(),
  cardSearchById:examItemCatalogs.cardSearchById??new Map(),
  cardRandomPoolById:examItemCatalogs.cardRandomPoolById??new Map(),
  cardStatusEnchantById:examItemCatalogs.cardStatusEnchantById??new Map(),
  cardPoolById:examItemCatalogs.cardPoolById??new Map(),
 };
 const state=createTowerTurnState(deck,seed,masters,options);
 state.exam.maxStamina=maxStamina;
 // Absolute score and status are initialized only from captured setup, not
 // inferred from the result or intermediate native turn snapshots.
 for(const attr of ["parameter","review","block","parameterBuff","concentration","fullPower","motivation"]){
  if(own(p,attr))state.exam[attr]=requireNumber(p[attr],"initialParameters."+attr);
 }
 const turns=[],warnings=[],scoreByType={vocal:0,dance:0,visual:0};
 let previousScore=Number(state.exam.parameter??0);
 for(let i=0;i<session.turns.length;i++){
  const actual=session.turns[i];
  if(Number(actual.turn)!==i+1)throw new ContestReplayUnsupported("nonconsecutive-turn:"+actual.turn);
  const draw=drawTowerTurn(state,options.drawPerTurn);
  if(state.unsupported?.length)throw new ContestReplayUnsupported("unimplemented-turn-start-effect:"+state.unsupported.join("|"));
  const observedHand=(actual.hand??[]).map(x=>x.id);
  const simulatedHand=(draw.hand??[]).map(x=>x.id);
  if(observedHand.length!==simulatedHand.length||observedHand.some((id,j)=>id!==simulatedHand[j])){
   warnings.push({turn:i+1,phase:"draw",native:observedHand,simulator:simulatedHand});
   // Preserve the *simulated* opening hand to make this the first structured
   // mismatch instead of marking the entire session incomparable.
   turns.push({turn:i+1,hand:simulatedHand.map(id=>({id}))});
   // Refuse to force a native hand into the simulated state. This is the
   // earliest independent RNG/deck divergence.
   break;
  }
  const commands=(actual.commands||[]).filter(x=>x.commandType===2&&x.card?.id);
  for(const command of commands){
   const cardId=String(command.card.id);
   const pos=state.hand.findIndex(x=>x.id===cardId &&
     Number(x.upgradeCount??0)===Number(command.card.baseUpgradeCount??0));
   if(pos<0){warnings.push({turn:i+1,phase:"card-selection",cardId,available:state.hand.map(x=>x.id)});break;}
   playTowerCard(state,pos);
   if(state.unsupported?.length)throw new ContestReplayUnsupported("unimplemented-card-effect:"+state.unsupported.join("|"));
  }
  if(warnings.length)break;
  const result=finishTowerTurn(state,{type:state.playsRemaining>0?"skip":"end"});
  if(state.unsupported?.length)throw new ContestReplayUnsupported("unimplemented-turn-end-effect:"+state.unsupported.join("|"));
  const score=Number(state.exam.parameter??0);
  scoreByType[canonicalTypes[i]]+=(score-previousScore);
  previousScore=score;
  turns.push({
   turn:i+1,score,
   stamina:Number(state.exam.stamina??0),
   block:Number(state.exam.block??0),
   hand:simulatedHand.map(id=>({id})),
  });
 }
 const prediction={
  provenance:"independent-simulator",
  replayMode:"observed-actions",decisionSearchVerified:false,
  turns, warnings,
  // Only publish a predicted final result if every native turn was simulated.
  ...(turns.length===session.turns.length?{result:{score:previousScore,
    vocal:scoreByType.vocal,dance:scoreByType.dance,visual:scoreByType.visual}}:{}),
 };
 return prediction;
}
