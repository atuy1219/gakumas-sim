// Conservative translator for passively observed IL2CPP setup objects.
// Nothing is guessed from the native score, first observed hand, or final result.
import { resolveProduceItems } from "./exam_effects.js";
import { calculateWeightedTurnParameterTypes } from "./turn_parameters.js";
import { advanceXorshift32 } from "./simulation.js";

const plain=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const unwrapName=s=>String(s??"").replace(/^<([^>]+)>k__BackingField$/,"$1").replace(/^_/,"").toLowerCase();
const names=(node,keys)=>{
 const fields=node?.fields;
 if(!plain(fields))return undefined;
 const accepted=new Set(keys.map(unwrapName));
 for(const [name,value] of Object.entries(fields))if(accepted.has(unwrapName(name)))return value;
 return undefined;
};
function primitive(value){
 if(typeof value==="string"||typeof value==="number"||typeof value==="boolean")return value;
 if(plain(value)&&plain(value.fields)){
  const fieldNames=Object.keys(value.fields).filter(k=>!k.startsWith("$"));
  if(fieldNames.length===1)return primitive(value.fields[fieldNames[0]]);
  const raw=names(value,["value__","value","Value","_value"]);
  if(raw!==undefined)return primitive(raw);
 }
 return undefined;
}
function number(value){
 const p=primitive(value);
 if((typeof p==="string"||typeof p==="number")&&p!==""&&Number.isFinite(Number(p)))return Number(p);
 return undefined;
}
function elements(value){
 if(Array.isArray(value))return value;
 if(plain(value)&&Array.isArray(value.elements))return value.elements;
 if(value?.$type?.startsWith?.("ArraySegment")&&plain(value.fields)){
  const array=value.fields._array??value.fields.array;
  const offset=number(value.fields._offset??value.fields.offset);
  const count=number(value.fields._count??value.fields.count);
  const entries=elements(array);
  if(Array.isArray(entries)&&Number.isInteger(offset)&&offset>=0&&
    Number.isInteger(count)&&count>=0&&offset+count<=entries.length)
   return entries.slice(offset,offset+count);
 }
 return undefined;
}
function extractCard(value){
 if(typeof value==="string"&&value.startsWith("p_card-"))return {id:value,upgradeCount:0};
 if(!plain(value))return null;
 const cardMaster=names(value,["CardData"]);
 const id=primitive(names(value,["ProduceCardId","CardId","Id"]))??
  primitive(names(cardMaster,["ProduceCardId","CardId","Id"]))??
  (value.fields?.$scannedCardIdAmbiguous===false?value.fields?.$scannedCardId:undefined)??value.$scannedCardId;
 if(typeof id!=="string"||!id.startsWith("p_card-"))return null;
 const upgrade=number(names(value,["UpgradeCount","BaseUpgradeCount","baseUpgradeCount"]));
 if(!Number.isInteger(upgrade)||upgrade<0||upgrade>3)return null;
 const order=number(names(value,["FixedDeckOrder","fixedDeckOrder"]));
 return {id,upgradeCount:upgrade,...(Number.isInteger(order)?{fixedDeckOrder:order}:{})};
}
function extractList(node,keys){
 const value=names(node,keys);
 return elements(value);
}
function rawIds(array,prefix){
 if(!Array.isArray(array))return null;
 const ids=[];
 for(const item of array){
  const v=primitive(typeof item==="string"?item:names(item,["Id","ProduceItemId","ItemId"]));
  if(typeof v!=="string"||!v.startsWith(prefix))return null;
  ids.push(v);
 }
 return ids;
}
function normalizeTurnTypes(list){
 if(!Array.isArray(list))return null;
 const types=[];
 for(const v of list){
  const raw=primitive(v);
  // Enum ordinals alone are ambiguous across game versions. Only consume
  // explicit type names produced by the managed metadata.
  const type=typeof raw==="string"?raw.toLowerCase():"";
  // ExamParameterType/StatusParameterType ordinals are pinned by the
  // local native-engine model: None=0, Vocal=1, Dance=2, Visual=3.
  // Numeric values from unrelated enums are deliberately rejected.
  const verifiedEnum=/^(?:ExamParameterType|StatusParameterType|ProduceParameterType)$/.test(String(v?.$type??""));
  const canonical=type.includes("vocal")?"vocal":type.includes("dance")?"dance"
    :type.includes("visual")?"visual"
      :(verifiedEnum&&Number.isInteger(raw)?({1:"vocal",2:"dance",3:"visual"}[raw]??null):null);
  if(!canonical)return null;
  types.push(canonical);
 }
 return types;
}
export function normalizeNativeContestSetup(session,{examItemCatalogs={}}={}){
 const reasons=[];
 const native=session?.start?.nativeInitialState?.root;
 const param=session?.setup?.examParameterSnapshot?.root;
 const deckSource=extractList(native,[
  "InitialDeckProduceCardDataList","DeckProduceCardDataList","ProduceCardDataList",
  "InitialDeckCardList","DeckCardList","DeckList","ProduceCardList",
 ]);
 let initialDeck=null;
 if(deckSource){
  const cards=deckSource.map(extractCard);
  if(cards.every(Boolean)&&cards.length)initialDeck=cards;
 }
 if(!initialDeck)reasons.push("native-deck-not-recognized");
 let pItemSource=extractList(native,["ProduceItemDataList","ProduceItemList","ItemDataList","ItemList"]);
 if(!pItemSource)pItemSource=extractList(param,["ItemList","ProduceItemList"]);
 // The native game IDs start with pitem_, not p_item-.
 const pItemIds=rawIds(pItemSource,"pitem_");
 let pItems=null;
 if(pItemIds){
  const resolved=resolveProduceItems(pItemIds,examItemCatalogs.itemById,examItemCatalogs.itemEffectById,examItemCatalogs);
  if(!resolved.unresolved.length&&resolved.items.every(item=>!item.effects?.some(e=>e.unresolved)))pItems=resolved.items;
 }
 if(!pItems)reasons.push("native-p-items-or-masters-missing");
 const settingId=session.start?.settingId;
 const setting=examItemCatalogs.examSettings?.find(row=>row.id===settingId);
 if(!setting)reasons.push("exact-exam-setting-master-missing");
 // ExamParameterModel wraps these values in Obscured<T>; its Raw<T>
 // is encrypted and MUST NOT be interpreted as the real parameter.
 const stamina=number(names(native,["Stamina"]));
 const maxStamina=number(names(native,["MaxStamina"]));
 const turnLimit=number(names(native,["LimitTurn"]));
 // ConfigParameterTypeOrderedList is an ordering of three *weights*, NOT
 // the full turn-target list. In v1.5.23 it contained three ValueTuple entries.
 const turns=extractList(param,["TurnTargetStatusParameterTypeList","TurnParameterTypeList"])
  ??extractList(native,["TurnTargetStatusParameterTypeList","TurnParameterTypeList"]);
 let turnParameterTypes=normalizeTurnTypes(turns);
 // A partial native list must never be promoted to an exact stage schedule.
 if(turnParameterTypes && (!Number.isInteger(turnLimit) || turnParameterTypes.length!==turnLimit))
  turnParameterTypes=null;
 let turnTypeSource=turnParameterTypes?"native-exact-turn-target-list":null;
 const seed=session?.start?.seed;
 const observedAfterSetup=session?.setup?.randomStateObserved;
 const vocal=number(names(native,["VocalConfigParameter"]));
 const dance=number(names(native,["DanceConfigParameter"]));
 const visual=number(names(native,["VisualConfigParameter"]));
 // Verified on 9 native v1.5.23 contest sessions: the game consumes
 // exactly (turnLimit - 3) XorShift32 words while scheduling the base
 // turns. This reproduces all 90 observed base turn attributes.
 // Never substitute a native hand, score, or captured turn actions.
 // A malformed *present* native turn list is NOT repaired by this fallback.
 const seedTurnRngVerified=turns===undefined&&Number.isInteger(turnLimit)&&turnLimit>3&&
  Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff&&
  Number.isInteger(observedAfterSetup)&&observedAfterSetup>=0&&observedAfterSetup<=0xffffffff&&
  [vocal,dance,visual].every(v=>Number.isInteger(v)&&v>0)&&
  advanceXorshift32(seed,turnLimit-3)===(observedAfterSetup>>>0);
 if(!turnParameterTypes&&seedTurnRngVerified){
  try{
   const derived=calculateWeightedTurnParameterTypes({turn:turnLimit,vocal,dance,visual},seed);
   if(derived.length===turnLimit){
    turnParameterTypes=derived.map(t=>t.toLowerCase());
    turnTypeSource="seed-weights-verified-xorshift32";
   }
  }catch{
   // Unsupported or inconsistent master data must fail closed.
  }
 }
 // ExamSetting p_exam_setting-1 declares turnStartDistribute: 3. Read it
 // from the exact loaded master, not a constant or the observed first hand.
 const nativeDraw=number(names(param,["CardDrawCountPerTurn","DrawCardCount","TurnStartDistribute"]));
 const masterDraw=number(setting?.turnStartDistribute);
 const drawPerTurn=Number.isInteger(nativeDraw)&&nativeDraw>0?nativeDraw
  :Number.isInteger(masterDraw)&&masterDraw>0?masterDraw:undefined;
 const initialParameters={
  stamina,maxStamina,turnLimit,turnParameterTypes,drawPerTurn,
 };
 if(![stamina,maxStamina,turnLimit,initialParameters.drawPerTurn].every(Number.isFinite)||!turnParameterTypes)
  reasons.push("exact-initial-parameters-missing");
 // After SetUpExam the exact game RNG is observable even when the
 // ExamParameterModel has not yet been bound at the *entry* callsite.
 // Reusing that state for the first deck shuffle is a diagnostic HYPOTHESIS:
 // it is never described as a verified native pre-shuffle observation.
 // A future v3.4.1 hook may prove this phase; old post-setup
 // observations are not proof of the initial shuffle RNG state.
 const preShuffleState=session?.setup?.randomStateBeforeInitialShuffle;
 const verifiedPreShuffle=session?.setup?.preShuffleStateVerified===true &&
  Number.isInteger(preShuffleState)&&preShuffleState>=0&&preShuffleState<=0xffffffff;
 const beforeState=session?.setup?.randomStateBeforeSetUp;
 const observedState=session?.setup?.randomStateObserved;
 const isUint32=n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
 const nativeBeforeAvailable=isUint32(beforeState);
 const verifiedSetupRng=isUint32(seed)&&isUint32(observedState)&&
  Number.isInteger(turnLimit)&&turnLimit>3&&
  advanceXorshift32(seed,turnLimit-3)===(observedState>>>0);
 const randomState=verifiedPreShuffle?preShuffleState:
  nativeBeforeAvailable?beforeState:verifiedSetupRng?observedState:null;
 const randomStateStage=verifiedPreShuffle?"verified-before-initial-shuffle":
  nativeBeforeAvailable?"before-SetUpExam":
  verifiedSetupRng?"after-SetUpExam-hypothesis":null;
 if(randomState===null)reasons.push("initial-shuffle-random-state-unavailable");
 // ExamData provides final per-attribute battle multipliers. The account's
 // separate support bonus is not present in this capture. Multiplying an
 // arbitrary support bonus a second time would double-count it.
 const bonusFields={
  vocal:"VocalBonusPermil",dance:"DanceBonusPermil",visual:"VisualBonusPermil"};
 const bonusValues=Object.fromEntries(Object.entries(bonusFields).map(
  ([type,name])=>[type,number(names(native,[name]))]));
 const parameterBonus=Object.values(bonusValues).every(
  value=>Number.isInteger(value)&&value>=0)
  ?Object.fromEntries(Object.entries(bonusValues).map(
    ([type,bonusPermil])=>[type,{bonusPermil}])):null;
 const supportBonus={percent:null,source:"account-support-bonus-not-captured",
  treatment:parameterBonus?"use-native-final-attribute-multipliers":"unknown"};
 return {
  available:reasons.length===0,
  reasons,
  input:reasons.length===0?{
   initialDeck,pItems,examSettings:setting,initialParameters,
   randomStateAtStart:randomState,
   ...(parameterBonus?{parameterBonus}:{}),supportBonus,
   metadata:{source:"native-passive-reflection",randomStateStage,verifiedPreShuffle,
    rngProvenance:verifiedPreShuffle?"captured-at-verified-shuffle-entry":
     nativeBeforeAvailable?"captured-before-setup":"verified-seed-post-setup-hypothesis",
    scoreBonusProvenance:parameterBonus?"native-battle-bonus-permil":"not-observed",
    supportBonusSeparatelyVerified:false,
    turnParameterTypesSource:turnTypeSource,independentDecisionSearch:false},
  }:null,
  candidates:{deckCount:deckSource?.length??null,
   identifiedDeckCards:deckSource?.filter(card=>extractCard(card)!==null).length??null,
   initialStamina:stamina??null,initialMaxStamina:maxStamina??null,
   initialTurnLimit:turnLimit??null,
   turnParameterTypes:turnParameterTypes??null,
   turnParameterTypesSource:turnTypeSource,
   seedTurnRngVerified,
   turnConfigWeights:{vocal:vocal??null,dance:dance??null,visual:visual??null},
   rawTurnTargetCount:turns?.length??null,
   rawTurnTargetsDecoded:turns?.filter(v=>v!==null&&v!==undefined).length??null,
   drawPerTurn:drawPerTurn??null,
   drawPerTurnProvenance:Number.isInteger(nativeDraw)&&nativeDraw>0?"native-parameter":
    Number.isInteger(masterDraw)&&masterDraw>0?"exact-exam-setting-master":null,
   pItemIds:pItemIds??null,
   randomStateBeforeSetUp:beforeState??null,
   candidateInitialShuffleState:randomState,
   candidateShuffleStateStage:randomStateStage,
   verifiedPreShuffle,
   nativeAttributeBonusPermil:parameterBonus?bonusValues:null,
   supportBonus,
   genericSnapshotTruncated:session?.start?.nativeInitialState?.truncated===true,
   verifiedSetupRng,settingId:settingId??null,
   parameterKeys:plain(param?.fields)?Object.keys(param.fields):[]},
 };
}
