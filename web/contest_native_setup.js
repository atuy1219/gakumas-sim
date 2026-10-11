// Conservative translator for passively observed IL2CPP setup objects.
// Nothing is guessed from the native score, first observed hand, or final result.
import { resolveProduceItems } from "./exam_effects.js";

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
 const turns=extractList(param,["TurnTargetStatusParameterTypeList","TurnParameterTypeList","ConfigParameterTypeOrderedList"])
  ??extractList(native,["TurnTargetStatusParameterTypeList","TurnParameterTypeList"]);
 const turnParameterTypes=normalizeTurnTypes(turns);
 const initialParameters={
  stamina,maxStamina,turnLimit,turnParameterTypes,
  drawPerTurn:number(names(param,["CardDrawCountPerTurn","DrawCardCount"])),
 };
 if(![stamina,maxStamina,turnLimit,initialParameters.drawPerTurn].every(Number.isFinite)||!turnParameterTypes)
  reasons.push("exact-initial-parameters-missing");
 // The state was recorded immediately before SetUpExam; it is not proven
 // to equal the pre-shuffle state until opening-hand parity confirms it.
 const randomState=session?.setup?.randomStateBeforeSetUp;
 if(!Number.isInteger(randomState)||randomState<0||randomState>0xffffffff)
  reasons.push("pre-setup-random-state-missing");
 return {
  available:reasons.length===0,
  reasons,
  input:reasons.length===0?{
   initialDeck,pItems,examSettings:setting,initialParameters,
   randomStateAtStart:randomState,
   metadata:{source:"native-passive-reflection",randomStateStage:"before-SetUpExam",verifiedPreShuffle:false,
    independentDecisionSearch:false},
  }:null,
  candidates:{deckCount:deckSource?.length??null,
   identifiedDeckCards:deckSource?.filter(card=>extractCard(card)!==null).length??null,
   initialStamina:stamina??null,initialMaxStamina:maxStamina??null,
   initialTurnLimit:turnLimit??null,
   pItemIds:pItemIds??null,
   randomStateBeforeSetUp:randomState??null,settingId:settingId??null,
   parameterKeys:plain(param?.fields)?Object.keys(param.fields):[]},
 };
}
