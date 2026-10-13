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
// Native ExamCardData exposes permanent and temporary upgrades separately.
// Simulator runtime cards expose an effective upgrade count. Prefer the
// effective count and retain an explicit flag if only base can be matched.
export function findNativeReplayCardIndex(hand,nativeCard){
 const id=String(nativeCard?.id??"");
 const base=Number(nativeCard?.baseUpgradeCount??0);
 const temporary=Number(nativeCard?.temporaryUpgradeCount??0);
 const exact=hand.findIndex(x=>x.id===id &&
   Number(x.upgradeCount??0)===base+temporary);
 if(exact>=0)return {index:exact,upgradeFallback:false};
 if(temporary>0){
  const matches=hand.map((x,index)=>x.id===id &&
    Number(x.upgradeCount??0)===base?index:-1).filter(index=>index>=0);
  if(matches.length===1)return {index:matches[0],upgradeFallback:true};
 }
 return {index:-1,upgradeFallback:false};
}
export function replayObservedContest(session,input,{cardById=new Map(),cardVariantByKey=new Map(),customizeById=new Map(),growEffectById=new Map(),examItemCatalogs={}}={}){
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
 const initialLimit=requireNumber(p.turnLimit,"turnLimit");
 if(!Array.isArray(turnTypes)||turnTypes.length!==initialLimit)
  throw new ContestReplayUnsupported("base-turn-parameter-types-missing-or-incomplete");
 // Real card effects can add turns (e.g. 私がスター). Native clamps the
 // extra-turn parameter type to the final normal turn's type.
 // DO NOT require this list to equal the observed number of turns.
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
  // The native values represent final per-attribute battle multipliers.
  // Support bonus is NOT applied again on top of these captured values.
  ...(input.parameterBonus?{parameterBonus:input.parameterBonus}:{}),
  examRuntimeSettings:input.examSettings,examScoreSettings:input.examSettings,
  cardVariantByKey,customizeById,growEffectById,
  captureActionTelemetry:true,
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
 const turns=[],warnings=[],cardActionTrace=[],turnPhaseTrace=[],recycleEvents=[],rngTrace=[],scoreByType={vocal:0,dance:0,visual:0};
 const rng=(turn,phase)=>rngTrace.push({turn,phase,state:state.randomState>>>0});
 rng(0,"initial-post-shuffle");
 const recordRecycles=(observations,turn,phase)=>{
  for(const event of observations??[])recycleEvents.push({
   turn,phase,recycleCount:event.recycleCount??null,randomState:event.randomState??null,
   source:(event.source??[]).map(c=>({id:c.id,upgradeCount:c.upgradeCount})),
   shuffled:(event.shuffled??[]).map(c=>({id:c.id,upgradeCount:c.upgradeCount})),
  });
 };
 const snapshot = () => ({score:Number(state.exam.parameter??0),
  stamina:Number(state.exam.stamina??0),block:Number(state.exam.block??0),
  review:Number(state.exam.review??0),aggressive:Number(state.exam.aggressive??0)});
 const nativeExtraTurns=Math.max(0,session.turns.length-initialLimit);
 let previousScore=Number(state.exam.parameter??0);
 for(let i=0;i<session.turns.length;i++){
  const actual=session.turns[i];
  if(Number(actual.turn)!==i+1)throw new ContestReplayUnsupported("nonconsecutive-turn:"+actual.turn);
  rng(i+1,"before-turn-draw");
  const draw=drawTowerTurn(state,options.drawPerTurn);
  rng(i+1,"after-turn-draw");
  recordRecycles(draw.recycleEvents,i+1,"draw");
  if(draw.ended || state.ended){
   warnings.push({turn:i+1,phase:"extra-turn-not-generated",
    nativeTurns:session.turns.length,simulatorTurnLimit:state.turnLimit});
   break;
  }
  if(state.unsupported?.length)throw new ContestReplayUnsupported("unimplemented-turn-start-effect:"+state.unsupported.join("|"));
  const observedHand=(actual.hand??[]).map(x=>x.id);
  // Keep effective upgrade counts and names from the actual simulated hand.
  // Previously the replay output reduced every card to {id}, which made the
  // comparison HTML always display an unupgraded card even when + was active.
  const simulatedHandCards=(draw.hand??[]).map(x=>({
    id:String(x.id),upgradeCount:Number(x.upgradeCount??0),
    name:String(x.name??x.id),
  }));
  const simulatedHand=simulatedHandCards.map(x=>x.id);
  if(observedHand.length!==simulatedHand.length||observedHand.some((id,j)=>id!==simulatedHand[j])){
   warnings.push({turn:i+1,phase:"draw",native:observedHand,simulator:simulatedHand});
   // Preserve the *simulated* opening hand to make this the first structured
   // mismatch instead of marking the entire session incomparable.
   turns.push({turn:i+1,hand:simulatedHandCards});
   // Refuse to force a native hand into the simulated state. This is the
   // earliest independent RNG/deck divergence.
   break;
  }
  const beforeCards=snapshot();
  const commands=(actual.commands||[]).filter(x=>x.commandType===2&&x.card?.id);
  for(const command of commands){
   const cardId=String(command.card.id);
   const {index:pos,upgradeFallback}=findNativeReplayCardIndex(state.hand,command.card);
   if(pos<0){warnings.push({turn:i+1,phase:"card-selection",cardId,available:state.hand.map(x=>x.id)});break;}
   try {
    rng(i+1,"before-card:"+cardId);
    const event=playTowerCard(state,pos);
    rng(i+1,"after-card:"+cardId);
    recordRecycles(event.recycleEvents,i+1,"card:"+cardId);
    const steps=event.actionTelemetry??[];
    const beginning=steps[0]??null;
    const completed=steps.find(step=>
      step.phase==="after-main-card-effects-before-after-card-play-triggers")
      ??steps.at(-1)??null;
    const ending=steps.at(-1)??null;
    cardActionTrace.push({
      turn:i+1,
      commandIndex:cardActionTrace.filter(x=>x.turn===i+1).length,
      cardId,upgradeCount:Number(command.card.baseUpgradeCount??0),
      nativeTemporaryUpgradeCount:Number(command.card.temporaryUpgradeCount??0),
      // An unresolved temporary-upgrade mismatch remains provisional.
      upgradeFallback,
      nativePerCardMetricsAvailable:false,
      nativeMetricsUnavailableReason:"only-turn-result-is-recorded-by-passive-native-hook",
      simulated:{
        cardCostEvents:[...(event.cost??[])],
        before:beginning ? {score:beginning.score,stamina:beginning.stamina,block:beginning.block,review:beginning.review,aggressive:beginning.aggressive,staminaConsumptionDown:beginning.staminaConsumptionDown}:null,
        // Native completion is before deferred AFTER_CARD_PLAY triggers.
        // Reporting the final post-trigger state here fabricates differences
        // when a P-item changes stamina after the card-use completion hook.
        after:completed ? {score:completed.score,stamina:completed.stamina,block:completed.block,review:completed.review,aggressive:completed.aggressive,staminaConsumptionDown:completed.staminaConsumptionDown}:null,
        scoreGained:beginning&&completed?completed.score-beginning.score:null,
        blockDelta:beginning&&completed?completed.block-beginning.block:null,
        staminaDelta:beginning&&completed?completed.stamina-beginning.stamina:null,
        afterDeferredTriggers:ending ? {score:ending.score,stamina:ending.stamina,block:ending.block}:null,
        phases:steps,
      },
    });
   } catch(error) {
    // A native card play rejected by the simulated state is a useful first
    // divergence. Do not discard the otherwise valid session as unavailable.
    warnings.push({turn:i+1,phase:"card-play",
     native:{id:cardId,upgradeCount:Number(command.card.baseUpgradeCount??0)},
     simulator:{playsRemaining:state.playsRemaining,
      available:state.hand.map(x=>({id:x.id,upgradeCount:x.upgradeCount??0}))},
     error:String(error?.message??error)});
    break;
   }
   if(state.unsupported?.length)throw new ContestReplayUnsupported("unimplemented-card-effect:"+state.unsupported.join("|"));
  }
  if(warnings.length)break;
  const afterCards=snapshot();
  rng(i+1,"before-turn-finish");
  const result=finishTowerTurn(state,{type:state.playsRemaining>0?"skip":"end"});
  rng(i+1,"after-turn-finish");
  const afterTurn=snapshot();
  turnPhaseTrace.push({
   turn:i+1,
   nativeTurnSummary:{score:Number(actual.score??0),stamina:Number(actual.stamina??0),block:Number(actual.block??0)},
   afterDrawBeforeCards:beforeCards,
   afterAllCards:afterCards,
   afterTurnEffects:afterTurn,
   nonCardScoreDelta:afterTurn.score-afterCards.score,
   nativePerCardMetricsAvailable:false,
  });
  if(state.unsupported?.length)throw new ContestReplayUnsupported("unimplemented-turn-end-effect:"+state.unsupported.join("|"));
  const score=Number(state.exam.parameter??0);
  const scoreType=canonicalTypes[Math.min(i,canonicalTypes.length-1)];
  const addedScore=score-previousScore;
  scoreByType[scoreType]+=addedScore;
  previousScore=score;
  turns.push({
   turn:i+1,score,addedScore,
   vocal:scoreByType.vocal,dance:scoreByType.dance,visual:scoreByType.visual,
   stamina:Number(state.exam.stamina??0),
   block:Number(state.exam.block??0),
   hand:simulatedHandCards,
  });
 }
 const prediction={
  provenance:"independent-simulator",
  replayMode:"observed-actions",decisionSearchVerified:false,
  turns, warnings, cardActionTrace, turnPhaseTrace,recycleEvents,rngTrace,
  nativePerCardMetricsAvailable:false,
  extraTurnsObserved:nativeExtraTurns,
  extraTurnsSimulated:Math.max(0,Number(state.turnLimit)-initialLimit),
  rngProvenance:input.metadata?.rngProvenance??"unknown",
  verifiedPreShuffle:input.metadata?.verifiedPreShuffle===true,
  scoreBonusEvidence:{
   nativeAttributeBonusPermil:input.parameterBonus?
    Object.fromEntries(Object.entries(input.parameterBonus).map(
     ([type,item])=>[type,item?.bonusPermil??null])):null,
   accountSupportBonusPercent:input.supportBonus?.percent??null,
   supportBonusAppliedSeparately:false,
   provenance:input.metadata?.scoreBonusProvenance??"unknown",
  },
  // Only publish a predicted final result if every native turn was simulated.
  ...(warnings.length===0&&turns.length===session.turns.length?{result:{score:previousScore,
    vocal:scoreByType.vocal,dance:scoreByType.dance,visual:scoreByType.visual}}:{}),
 };
 return prediction;
}
