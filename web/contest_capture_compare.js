import { xorshift32 } from "./simulation.js";
/* Contest capture v1/v2 reconstruction and honest independent-simulator comparison.
 * A native capture is evidence, NEVER the simulator's predicted output. */
const FIELDS=["score","vocal","dance","visual"];
const PROGRESS=[...FIELDS,"evaluationScore","selectedPathEnded","selectedIndexes","turnCount"];
const TURN=["turn",...FIELDS,"addedScore","stamina","consumedStamina","block","addedBlock","hand","statuses","statusEffects","resultStatusEffects","commands","hold","triggeredEnchantIds","parameterType","idolStatusType","idolStatusStepCount"];
const REQUIRED=["initialDeck","pItems","initialParameters","examSettings","randomStateAtStart"];
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function reconstructContestCapture(capture){
 if(!object(capture)||capture.scope!=="contest-gameplay-capture"||!Array.isArray(capture.events))throw new TypeError("学マスのコンテストキャプチャーJSONではありません");
 const sessions=new Map(),warnings=[];
 for(let i=0;i<capture.events.length;i++){
  const e=capture.events[i];
  if(!object(e)||!Number.isSafeInteger(e.pid)||!Number.isSafeInteger(e.sessionId)){warnings.push("events["+i+"]:invalid-session-identity");continue;}
  const key=e.pid+":"+e.sessionId;
  if(!sessions.has(key))sessions.set(key,{key,pid:e.pid,sessionId:e.sessionId,start:null,setup:null,progress:[],result:null,turns:[],warnings:[],complete:true});
  const s=sessions.get(key);
  if(e.dataComplete===false){s.complete=false;s.warnings.push("step-"+e.step+":native-read-incomplete");}
  if(e.event==="contest-start"){
   if(s.start){s.complete=false;s.warnings.push("duplicate-start");}s.start=e;
  }else if(e.event==="contest-setup"){
   if(s.setup){s.warnings.push("multiple-setup-snapshots");}
   s.setup=e;
  }else if(e.event==="contest-progress"){
   const prev=s.progress.at(-1);
   if(prev&&e.step!==prev.step+1){s.complete=false;s.warnings.push("noncontiguous-progress-step:"+prev.step+"->"+e.step);}
   s.progress.push(e);
   if(!Array.isArray(e.turns)){s.complete=false;s.warnings.push("step-"+e.step+":missing-turns");continue;}
   if(e.turnsEncoding==="delta"){
    if(!Number.isSafeInteger(e.turnStartIndex)||e.turnStartIndex<0||e.turnStartIndex>s.turns.length){s.complete=false;s.warnings.push("step-"+e.step+":turn-delta-gap");continue;}
    for(let j=0;j<e.turns.length;j++){
     const n=e.turnStartIndex+j;
     if(n<s.turns.length){if(!equal(s.turns[n],e.turns[j])){s.complete=false;s.warnings.push("step-"+e.step+":turn-conflict-"+n);}}
     else s.turns.push(e.turns[j]);
    }
   }else{
    for(let j=0;j<e.turns.length;j++){
     if(j<s.turns.length&&!equal(s.turns[j],e.turns[j])){s.complete=false;s.warnings.push("step-"+e.step+":turn-conflict-"+j);}
     else if(j===s.turns.length)s.turns.push(e.turns[j]);
    }
   }
   if(Number.isSafeInteger(e.turnCount)&&e.dataComplete!==false&&s.turns.length!==e.turnCount){s.complete=false;s.warnings.push("step-"+e.step+":turn-count-mismatch:"+s.turns.length+"/"+e.turnCount);}
   if(FIELDS.every(f=>Number.isFinite(e[f]))&&e.score!==e.vocal+e.dance+e.visual){s.complete=false;s.warnings.push("step-"+e.step+":native-score-components-mismatch");}
  }else if(["contest-result","contest-stopped","contest-read-failed"].includes(e.event)){
   if(s.result){s.complete=false;s.warnings.push("duplicate-terminal");}s.result=e;
  }
 }
 for(const s of sessions.values()){
  if(!s.start){s.complete=false;s.warnings.push("missing-start");}
  if(!s.result){s.complete=false;s.warnings.push("missing-terminal");}
  if(s.result?.event==="contest-result"&&s.progress.length){
   const p=s.progress.at(-1);
   for(const field of FIELDS)if(s.result[field]!==p[field]){s.complete=false;s.warnings.push("terminal-"+field+"-mismatch");}
  }
  if(s.result?.recordingComplete!==true){s.complete=false;s.warnings.push("not-recorded-through-result");}
  if(s.result?.dataComplete===false){s.complete=false;s.warnings.push("terminal-marked-incomplete");}
 }
 return {sessions:[...sessions.values()],warnings};
}
// Report candidate configuration values from native reflection. These are
// observations, not silently promoted to a complete replay configuration.
export function extractSetupCandidates(session){
 const snapshots=[
  ["examData",session.start?.nativeInitialState],
  ["parameter",session.setup?.examParameterSnapshot],
  ["sequence",session.setup?.examSequenceSnapshot],
 ];
 const fields=[];
 const walk=(node,path,depth,visited)=>{
  if(!object(node)||depth>5||visited.count++>400)return;
  if(object(node.fields)){
   for(const [name,value] of Object.entries(node.fields)){
    const key=path+"."+name;
    if(/Deck|Card|Item|Drink|Parameter|Setting|Random|Seed|Turn|Stamina|Status|Effect|Initial|Support|Gimmick|Plan|Pool|Score|Block/i.test(name)){
     if(value===null||["string","number","boolean"].includes(typeof value)||Array.isArray(value))
      fields.push({path:key,value});
     else if(object(value)&&Array.isArray(value.elements))
      fields.push({path:key,type:value.$type,count:value.elements.length});
    }
    walk(value,key,depth+1,visited);
   }
  }
  if(Array.isArray(node.elements))for(let i=0;i<Math.min(64,node.elements.length);i++)walk(node.elements[i],path+".elements["+i+"]",depth+1,visited);
 };
 for(const [name,snapshot] of snapshots)if(object(snapshot)&&object(snapshot.root))walk(snapshot.root,name,0,{count:0});
 return {available:fields.length>0,fields:fields.slice(0,240),
   snapshots:snapshots.filter(x=>object(x[1])).map(([name,snapshot])=>({name,available:snapshot.available===true,complete:snapshot.complete===true,truncated:snapshot.truncated===true}))};
}
// Exact independent RNG-chain validation; this does not claim pre-shuffle
// state recovery, correct gameplay scores, or native action-selection parity.
export function verifyContestSetupRng(session,maxSteps=128){
 const seed=session?.start?.seed, observed=session?.setup?.randomStateObserved;
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff||
    !Number.isInteger(observed)||observed<0||observed>0xffffffff)
  return {status:"unavailable",reason:"seed-or-after-setup-state-missing"};
 let state=seed>>>0;
 for(let step=0;step<=maxSteps;step++){
  if(state===(observed>>>0))return {status:"match",seed,observed,advanceSteps:step,
   phase:"after-ExamSequence.SetUpExam",verifiedPreShuffle:false};
  state=xorshift32(state);
 }
 return {status:"unmatched",seed,observed,maximumAdvanceSteps:maxSteps,
  phase:"after-ExamSequence.SetUpExam",verifiedPreShuffle:false};
}
function diffInto(out,path,a,b){
 if(out.length>=100||equal(a,b))return;
 if(Array.isArray(a)&&Array.isArray(b)){
  if(a.length!==b.length)out.push({path:path+".length",realDevice:a.length,simulation:b.length});
  for(let i=0;i<Math.min(a.length,b.length);i++)diffInto(out,path+"["+i+"]",a[i],b[i]);
 }else if(object(a)&&object(b)){
  // A simulator may expose only a subset; missing predictions are not matches.
  for(const key of Object.keys(b))if(Object.hasOwn(a,key))diffInto(out,path+"."+key,a[key],b[key]);
 }else out.push({path,realDevice:a,simulation:b});
}
function compareFields(diffs,actual,pred,base,fields){
 if(!object(pred))return;
 for(const field of fields)if(Object.hasOwn(pred,field)){
  if(!Object.hasOwn(actual,field))diffs.push({path:base+"."+field,realDevice:null,simulation:pred[field],reason:"not-captured"});
  else diffInto(diffs,base+"."+field,actual[field],pred[field]);
 }
}
function compareSession(s,pred){
 const differences=[];
 // A first mismatch found inside the independent replay must outrank the
 // incidental "turns.length" difference caused by stopping at that point.
 for(const warning of pred?.warnings??[]){
  if(warning?.turn && warning?.phase){
   differences.push({path:"turns["+(warning.turn-1)+"]."+warning.phase,
    realDevice:warning.native??warning.nativeTurns??null,
    simulation:warning.simulator??warning.simulatorTurnLimit??warning.available??null,
    reason:"independent-replay-first-divergence"});
   break;
  }
 }
 if(Number.isInteger(pred?.extraTurnsObserved)&&Number.isInteger(pred?.extraTurnsSimulated)
   && pred.extraTurnsObserved!==pred.extraTurnsSimulated && !differences.length)
  differences.push({path:"extraTurns",realDevice:pred.extraTurnsObserved,
    simulation:pred.extraTurnsSimulated});
 if(Array.isArray(pred?.progress)){
  if(s.progress.length!==pred.progress.length)differences.push({path:"progress.length",realDevice:s.progress.length,simulation:pred.progress.length});
  for(let i=0;i<Math.min(s.progress.length,pred.progress.length);i++)compareFields(differences,s.progress[i],pred.progress[i],"progress["+i+"]",PROGRESS);
 }
 if(Array.isArray(pred?.turns)){
  if(s.turns.length!==pred.turns.length)differences.push({path:"turns.length",realDevice:s.turns.length,simulation:pred.turns.length});
  for(let i=0;i<Math.min(s.turns.length,pred.turns.length);i++)compareFields(differences,s.turns[i],pred.turns[i],"turns["+i+"]",TURN);
 }
 if(object(pred?.result))compareFields(differences,s.result||{},pred.result,"result",FIELDS);
 const compared=(
  (Array.isArray(pred?.progress)&&pred.progress.length>0&&pred.progress.some(p=>object(p)&&PROGRESS.some(k=>Object.hasOwn(p,k))))||
  (Array.isArray(pred?.turns)&&pred.turns.length>0&&pred.turns.some(t=>object(t)&&TURN.some(k=>Object.hasOwn(t,k))))||
  (object(pred?.result)&&FIELDS.some(k=>Object.hasOwn(pred.result,k)))
 );
 const completeCoverage=compared && object(pred?.result) &&
  FIELDS.every(k=>Object.hasOwn(pred.result,k)) &&
  Array.isArray(pred?.progress) && pred.progress.length===s.progress.length &&
  pred.progress.every(p=>object(p)&&PROGRESS.every(k=>Object.hasOwn(p,k))) &&
  Array.isArray(pred?.turns) && pred.turns.length===s.turns.length &&
  pred.turns.every(t=>object(t)&&TURN.every(k=>Object.hasOwn(t,k)));
 // Compare completed turn boundaries; selected-search progress is async.
 const turnDiagnostics=Array.isArray(pred?.turns)?s.turns.slice(0,pred.turns.length).map((real,i)=>{
  const sim=pred.turns[i]??{};
  const comparedFields=TURN.filter(k=>Object.hasOwn(real,k)&&Object.hasOwn(sim,k));
  return {turn:real.turn,comparedFields,
   mismatchedFields:comparedFields.filter(k=>!equal(real[k],sim[k])),
   nativeScore:real.score??null,simulationScore:sim.score??null,
   scoreDelta:Number.isFinite(real.score)&&Number.isFinite(sim.score)?sim.score-real.score:null,
   nativeCards:(real.commands??[]).filter(c=>c.commandType===2&&c.card?.id)
    .map(c=>({id:c.card.id,guid:c.card.guid??null,upgradeCount:c.card.baseUpgradeCount??null})),
   nativeStatuses:real.statuses??null};
 }):[];
 return {status:!compared?"not-comparable":differences.length?"mismatch":completeCoverage?"match":"partial-match",
  completeCoverage,differences,firstDivergence:differences[0]||null,turnDiagnostics,compared};
}
/* simulator(s,input) MUST run the independent engine; never echo native observations. */
export function compareContestCapture(capture,{simulator=null,resolveInput=null}={}){
 const normalized=reconstructContestCapture(capture),sessions=[];
 let compared=0,mismatches=0,matched=0,blocked=0,partial=0;
 for(const s of normalized.sessions){
  const inputs=object(capture.simulatorInputs)?capture.simulatorInputs:{};
  const normalizedSetup=typeof resolveInput==="function"?resolveInput(s):null;
  const input=inputs[s.key]||inputs[String(s.sessionId)]||s.start?.simulatorInputs||normalizedSetup?.input||{};
  const missing=REQUIRED.filter(k=>!Object.hasOwn(input,k)||input[k]===null);
  const warnings=[...s.warnings];
  let simulation=null,comparison={status:"unavailable",differences:[],firstDivergence:null,compared:false};
  if(typeof simulator==="function"&&!missing.length&&s.complete){
   try{
    simulation=simulator(s,input);
    if(simulation?.provenance!=="independent-simulator")throw new Error("independent-simulator provenance is required");
    comparison=compareSession(s,simulation);
    // The post-setup RNG state is NOT an independently captured shuffle
    // starting state. Even an accidental all-field match is provisional.
    if(input?.metadata?.verifiedPreShuffle!==true){
     warnings.push("unverified-pre-shuffle-rng:"+String(input?.metadata?.rngProvenance??"unknown"));
     if(comparison.status==="match")
      comparison={...comparison,status:"partial-match",completeCoverage:false};
    }
   }catch(err){warnings.push("simulator-execution-failed:"+String(err?.message||err));simulation=null;}
  }
  if(comparison.compared){compared++;if(comparison.status==="mismatch")mismatches++;else if(comparison.status==="match")matched++;else partial++;}
  else {blocked++;
   if(missing.length)warnings.push("simulator-input-missing:"+missing.join(","));
   else if(typeof simulator!=="function")warnings.push("simulator-runner-not-connected");
   else if(!s.complete)warnings.push("native-capture-incomplete");
   else if(!warnings.some(w=>w.startsWith("simulator-execution-failed:")))warnings.push("simulator-result-not-comparable");
  }
  sessions.push({pid:s.pid,sessionId:s.sessionId,characterId:s.start?.characterId||null,seed:s.start?.seed??null,
    nativeSetup:s.setup??null,setupCandidates:extractSetupCandidates(s),rngVerification:verifyContestSetupRng(s),
    normalization:normalizedSetup?{available:normalizedSetup.available,reasons:normalizedSetup.reasons,candidates:normalizedSetup.candidates}:null,
    realDevice:{score:s.result?.score??null,result:s.result,progress:s.progress,turns:s.turns,dataComplete:s.complete},
    simulation,comparison,
    scoreBonusEvidence:{
     nativeAttributeBonusPermil:normalizedSetup?.candidates?.nativeAttributeBonusPermil??null,
     accountSupportBonus:input?.supportBonus??normalizedSetup?.candidates?.supportBonus??null,
     separateAccountSupportPercentVerified:
      input?.supportBonus?.source==="verified-account-support-value" &&
      typeof input?.supportBonus?.percent==="number",
    },warnings});
 }
 const complete=sessions.filter(s=>s.realDevice.dataComplete).length;
 const summary={sessions:sessions.length,capturesComplete:complete,
  setupRngVerified:sessions.filter(s=>s.rngVerification.status==="match").length,
  setupRngUnmatched:sessions.filter(s=>s.rngVerification.status==="unmatched").length,
  totalProgress:sessions.reduce((n,s)=>n+s.realDevice.progress.length,0),
  totalTurns:sessions.reduce((n,s)=>n+s.realDevice.turns.length,0),
  simulationCompared:compared,simulationMatches:matched,simulationPartialMatches:partial,simulationMismatches:mismatches,simulationBlocked:blocked,
  nativeAttributeBonusCaptures:sessions.filter(s=>s.scoreBonusEvidence.nativeAttributeBonusPermil!==null).length,
  separatelyVerifiedAccountSupportBonuses:sessions.filter(s=>s.scoreBonusEvidence.separateAccountSupportPercentVerified).length};
 return {schemaVersion:1,scope:"gakumas-contest-comparison",captureModuleVersion:capture.moduleVersion||null,
  status:!sessions.length?"no-sessions":mismatches?"mismatch":blocked?"simulation-unavailable":partial?"partial-match":"match",
  complete:blocked===0&&sessions.length>0&&complete===sessions.length&&mismatches===0&&partial===0,
  summary,firstDivergence:sessions.find(s=>s.comparison.firstDivergence)?.comparison.firstDivergence||null,
  sessions,warnings:normalized.warnings,
  note:"Native self-consistency checks are not an independent gameplay simulation; incomplete simulator inputs block true parity."};
}
