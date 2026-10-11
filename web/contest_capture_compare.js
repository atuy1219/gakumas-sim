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
  if(!sessions.has(key))sessions.set(key,{key,pid:e.pid,sessionId:e.sessionId,start:null,progress:[],result:null,turns:[],warnings:[],complete:true});
  const s=sessions.get(key);
  if(e.dataComplete===false){s.complete=false;s.warnings.push("step-"+e.step+":native-read-incomplete");}
  if(e.event==="contest-start"){
   if(s.start){s.complete=false;s.warnings.push("duplicate-start");}s.start=e;
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
 return {status:!compared?"not-comparable":differences.length?"mismatch":completeCoverage?"match":"partial-match",
  completeCoverage,differences,firstDivergence:differences[0]||null,compared};
}
/* simulator(s,input) MUST run the independent engine; never echo native observations. */
export function compareContestCapture(capture,{simulator=null}={}){
 const normalized=reconstructContestCapture(capture),sessions=[];
 let compared=0,mismatches=0,matched=0,blocked=0,partial=0;
 for(const s of normalized.sessions){
  const inputs=object(capture.simulatorInputs)?capture.simulatorInputs:{};
  const input=inputs[s.key]||inputs[String(s.sessionId)]||{};
  const missing=REQUIRED.filter(k=>!Object.hasOwn(input,k)||input[k]===null);
  const warnings=[...s.warnings];
  let simulation=null,comparison={status:"unavailable",differences:[],firstDivergence:null,compared:false};
  if(typeof simulator==="function"&&!missing.length&&s.complete){
   try{
    simulation=simulator(s,input);
    if(simulation?.provenance!=="independent-simulator")throw new Error("independent-simulator provenance is required");
    comparison=compareSession(s,simulation);
   }catch(err){warnings.push("simulator-execution-failed:"+String(err?.message||err));simulation=null;}
  }
  if(comparison.compared){compared++;if(comparison.status==="mismatch")mismatches++;else if(comparison.status==="match")matched++;else partial++;}
  else {blocked++;warnings.push(missing.length?"simulator-input-missing:"+missing.join(","):"simulator-runner-not-connected");}
  sessions.push({pid:s.pid,sessionId:s.sessionId,characterId:s.start?.characterId||null,seed:s.start?.seed??null,
    realDevice:{score:s.result?.score??null,result:s.result,progress:s.progress,turns:s.turns,dataComplete:s.complete},
    simulation,comparison,warnings});
 }
 const complete=sessions.filter(s=>s.realDevice.dataComplete).length;
 const summary={sessions:sessions.length,capturesComplete:complete,
  totalProgress:sessions.reduce((n,s)=>n+s.realDevice.progress.length,0),
  totalTurns:sessions.reduce((n,s)=>n+s.realDevice.turns.length,0),
  simulationCompared:compared,simulationMatches:matched,simulationPartialMatches:partial,simulationMismatches:mismatches,simulationBlocked:blocked};
 return {schemaVersion:1,scope:"gakumas-contest-comparison",captureModuleVersion:capture.moduleVersion||null,
  status:!sessions.length?"no-sessions":mismatches?"mismatch":blocked?"simulation-unavailable":partial?"partial-match":"match",
  complete:blocked===0&&sessions.length>0&&complete===sessions.length&&mismatches===0&&partial===0,
  summary,firstDivergence:sessions.find(s=>s.comparison.firstDivergence)?.comparison.firstDivergence||null,
  sessions,warnings:normalized.warnings,
  note:"Native self-consistency checks are not an independent gameplay simulation; incomplete simulator inputs block true parity."};
}
