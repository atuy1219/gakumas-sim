#include <algorithm>
#include <cmath>
#include <cctype>
#include <dlfcn.h>
// Selected auto-play results only. No polling, synthetic getters or DFS leaf logs.
namespace contest_capture {
using Address = uintptr_t;
constexpr unsigned kSessionLimit = 64, kStepLimit = 128;
constexpr size_t kFileLimit = 8 * 1024 * 1024;
std::mutex mutex;
struct Run { uint64_t id=0; Address owner=0, data=0, sequence=0, parameter=0, controller=0; unsigned steps=0, turnsCaptured=0, effectSamples=0, cardMoveSamples=0, cardActionSerial=0, mutationSamples=0, candidateMutationSamples=0, candidateMutationStep=~0u, candidateSamplesThisStep=0, commandListSamples=0; bool terminal=false, complete=true, setupRecorded=false; std::string previousCard; int64_t prevScore=0; int32_t prevStamina=0,prevBlock=0,prevReview=0,prevAggressive=0; bool prevRaw=false,prevReviewAvailable=false,prevAggressiveAvailable=false; std::map<std::string,std::map<std::string,int64_t>> prevStatusFields; std::map<std::string,int64_t> prevParameterFields; bool prevStatusesComplete=false; int32_t latestStamina=0,latestBlock=0,latestTurn=0; uint64_t staminaGetterCalls=0,blockGetterCalls=0,turnGetterCalls=0; };
std::map<Address, Run> runs;
uint64_t nextId=0, moveCalls=0, selectedCalls=0, written=0, failures=0, writeFailures=0, drops=0;
size_t fileBytes=0;
bool moveInstalled=false, resultInstalled=false, triggerCommandInstalled=false, cardMoveInstalled=false, drawInstalled=false;
bool selectedHooksAttempted=false;
bool numericGetterHooksAttempted=false,staminaGetterInstalled=false,blockGetterInstalled=false,turnGetterInstalled=false;
uint64_t naturalStaminaGetterCalls=0,naturalBlockGetterCalls=0,naturalTurnGetterCalls=0;
bool moveCardNativeInstalled=false,recycleNativeInstalled=false,shuffleNativeInstalled=false;
bool createIdNativeInstalled=false,createSearchNativeInstalled=false,cardCommandNativeInstalled=false,commandListFinishInstalled=false;
uint64_t drawCalls=0,drawMatched=0,drawSamples=0,drawContextReadable=0,drawContextParameterMatched=0,moveContextReadable=0;
uint64_t triggerCommandCalls=0, cardMoveCalls=0, effectSamples=0, cardMoveSamples=0, metricReadFailures=0;
uint64_t cardMoveControllerReadable=0,cardMoveControllerMatched=0,cardMoveParameterMatched=0;
uint64_t cardSnapshotAttempts=0,cardSnapshotParameterMatched=0,cardSnapshotSequenceMatched=0;
constexpr unsigned kNativeCardSamplesPerSession=512;
std::atomic<bool> attempted{false};
thread_local Run* active=nullptr;
// The exact ELF's ExamSequence.ExecuteCardCommandImpl (0x080A5BB0) receives
// the concrete ExamCardData in x2. GetTriggerEffectListCommand runs inside it,
// before CardController.PlayingCard has necessarily been populated.
// Preserve the argument only for the lifetime of this native call: never
// retain a managed pointer beyond the command builder.
struct CardCommandFrame {
    Address sequence=0,context=0,card=0;
    CardCommandFrame* previous=nullptr;
};
thread_local CardCommandFrame* currentCardCommand=nullptr;
struct ScopedCardCommand {
    CardCommandFrame frame;
    ScopedCardCommand(Address sequence,Address context,Address card) {
        frame={sequence,context,card,currentCardCommand};
        currentCardCommand=&frame;
    }
    ~ScopedCardCommand(){currentCardCommand=frame.previous;}
    ScopedCardCommand(const ScopedCardCommand&)=delete;
    ScopedCardCommand& operator=(const ScopedCardCommand&)=delete;
};
thread_local unsigned readBudget=0;
// Preserve the first error in each event, including the failed read's context.
struct ReadFailure {
    std::string reason, stage;
    Address address=0;
    size_t offset=0, requested=0;
    int sysErrno=0;
    uint64_t observed=0;
};
thread_local ReadFailure firstReadFailure;
thread_local std::string readStage;
struct ReadScope {
    std::string previous;
    explicit ReadScope(const char* name):previous(readStage) {
        if(!readStage.empty())readStage+='.';
        readStage+=name;
    }
    ~ReadScope(){readStage=previous;}
};
void noteReadFailure(const char* reason,Address a,size_t offset,size_t requested,
                     int sysErrno=0,uint64_t observed=0) {
    if(firstReadFailure.reason.empty())
        firstReadFailure={reason,readStage,a,offset,requested,sysErrno,observed};
}
std::string readFailureJson() {
    if(firstReadFailure.reason.empty())
        return "{\"reason\":\"decode-incomplete\",\"stage\":\"unknown\"}";
    const auto& f=firstReadFailure;
    std::ostringstream s;
    s<<"{\"reason\":\""<<f.reason<<"\",\"stage\":\""<<f.stage
     <<"\",\"address\":\"0x"<<std::hex<<f.address<<std::dec
     <<"\",\"offset\":"<<f.offset<<",\"requestedBytes\":"<<f.requested
     <<",\"errno\":"<<f.sysErrno<<",\"observed\":"<<f.observed<<"}";
    return s.str();
}
using MoveFn=void(*)(void*,const void*);
// IL2CPP Nullable<ExamSimulateResult>: 72 bytes, returned through AArch64 x8.
struct alignas(8) SearchResult { uint64_t words[9]; };
static_assert(sizeof(SearchResult)==72, "Pinned IL2CPP result ABI");
using ResultFn=SearchResult(*)(void*,const void*);
MoveFn originalMove=nullptr;
ResultFn originalResult=nullptr;
std::string path(const char* name) {
    #ifdef GAKUMAS_CONTEST_CAPTURE_DIR
    return std::string(GAKUMAS_CONTEST_CAPTURE_DIR)+name;
    #else
    return "/data/user/"+std::to_string(getuid()/100000)+"/"+kTargetPackage+"/files/gakumas-sim/"+name;
    #endif
}
bool bytes(Address a,size_t offset,void* out,size_t size) {
    if(!a || a>UINTPTR_MAX-offset || a+offset>UINTPTR_MAX-size || !size || size>4096) {
        noteReadFailure("invalid-address-or-size",a,offset,size);return false;
    }
    if(!readBudget) {noteReadFailure("read-budget-exhausted",a,offset,size);return false;}
    --readBudget;
    iovec local{out,size},remote{reinterpret_cast<void*>(a+offset),size};
    // A passive hook must not change errno visible to the game's caller.
    const int savedErrno=errno;
    const auto n=syscall(SYS_process_vm_readv,getpid(),&local,1,&remote,1,0);
    const int readErrno=n<0?errno:0;
    errno=savedErrno;
    if(n!=static_cast<ssize_t>(size)) {
        noteReadFailure(n<0?"memory-read-failed":"short-read",a,offset,size,
                        readErrno,n>=0?static_cast<uint64_t>(n):0);
        return false;
    }
    return true;
}
template<class T> bool read(Address a,size_t offset,T& v) {v={};return bytes(a,offset,&v,sizeof(v));}
template<class T> T local(const SearchResult& r,size_t offset) {
    T v{};std::memcpy(&v,reinterpret_cast<const char*>(&r)+offset,sizeof(v));return v;
}
std::string string(Address a,bool& ok) {
    if(!a)return "null";
    int32_t n=0; if(!read(a,0x10,n) || n<0 || n>256){ok=false;return "null";}
    uint16_t chars[256]={}; if(n && !bytes(a,0x14,chars,n*2)){ok=false;return "null";}
    std::ostringstream s;s<<'"';
    for(int i=0;i<n;++i)s<<"\\u"<<std::hex<<std::setfill('0')<<std::setw(4)<<chars[i];
    s<<'"';return s.str();
}
std::string stringField(Address a,size_t offset,bool& ok) {
    Address p=0;if(!read(a,offset,p)){ok=false;return "null";}return string(p,ok);
}
template<class T> bool array(Address a,unsigned cap,std::vector<T>& items) {
    ReadScope scope("array");
    if(!a){items.clear();return true;}
    uint64_t n=0;
    {ReadScope header("length");if(!read(a,0x18,n))return false;}
    if(n>cap){noteReadFailure("array-length-out-of-range",a,0x18,sizeof(n),0,n);return false;}
    items.resize(n);
    ReadScope data("elements");
    return !n || bytes(a,0x20,items.data(),n*sizeof(T));
}
template<class T> bool list(Address a,unsigned cap,std::vector<T>& items) {
    ReadScope scope("list");
    if(!a){items.clear();return true;}
    Address backing=0, again=0;int32_t count=0,after=0,version=0,versionAfter=0;
    {
        ReadScope header("header");
        if(!read(a,0x10,backing) || !read(a,0x18,count) || !read(a,0x1c,version))return false;
    }
    if(count<0 || unsigned(count)>cap){
        noteReadFailure("list-count-out-of-range",a,0x18,sizeof(count),0,static_cast<uint32_t>(count));
        return false;
    }
    uint64_t capacity=0;
    if(count){
        ReadScope length("backing-length");
        if(!read(backing,0x18,capacity))return false;
        if(capacity<unsigned(count)){
            noteReadFailure("list-capacity-too-small",backing,0x18,sizeof(capacity),0,capacity);
            return false;
        }
    }
    items.resize(count);
    {ReadScope elements("elements");if(count && !bytes(backing,0x20,items.data(),count*sizeof(T)))return false;}
    {
        ReadScope stable("stability-check");
        if(!read(a,0x10,again) || !read(a,0x18,after) || !read(a,0x1c,versionAfter))return false;
    }
    if(again!=backing || count!=after || version!=versionAfter){
        noteReadFailure("list-changed-during-read",a,0x10,0);
        return false;
    }
    return true;
}
std::string integers(Address a,bool asList,unsigned cap,bool& ok) {
    std::vector<int32_t> values;
    if(!(asList?list(a,cap,values):array(a,cap,values))){ok=false;return "null";}
    std::ostringstream s;s<<'[';for(size_t i=0;i<values.size();++i){if(i)s<<',';s<<values[i];}s<<']';return s.str();
}
std::string savedCard(Address a,bool& ok) {
    if(!a)return "null";
    int32_t upgrade=0;Address custom=0;
    if(!read(a,0x18,upgrade) || !read(a,0x20,custom)){ok=false;return "null";}
    return "{\"id\":"+stringField(a,0x10,ok)+",\"upgradeCount\":"+std::to_string(upgrade)+
        ",\"customizeCounts\":"+integers(custom,true,32,ok)+"}";
}
std::string statusEffect(Address a,bool& ok) {
    int32_t v[3]={};uint8_t passing=0;
    if(!a || !bytes(a,0x10,v,sizeof(v)) || !read(a,0x1c,passing)){ok=false;return "null";}
    return "{\"type\":"+std::to_string(v[0])+",\"value\":"+std::to_string(v[1])+",\"turn\":"+
        std::to_string(v[2])+",\"isPassingTurnStart\":"+(passing?"true":"false")+"}";
}
std::string liveCard(Address a,bool& ok);
std::string command(Address a,bool& ok) {
    if(!a){ok=false;return "null";}
    int32_t turn=0,phase=0;Address select=0,card=0,item=0,drink=0,cmd=0;uint8_t cost=0,selectLog=0;
    if(!read(a,0x10,turn)||!read(a,0x18,select)||!read(a,0x20,selectLog)||!read(a,0x28,card)||
       !read(a,0x30,item)||!read(a,0x38,drink)||!read(a,0x40,cmd)||!read(a,0x48,phase)||!read(a,0x4c,cost)){
        ok=false;return "null";
    }
    bool identityOk=true;
    const std::string verifiedCard=card?liveCard(card,identityOk):"null";
    // A stale/unknown card layout must not suppress independently verified
    // score, hand, or turn history. It is reported as unverified separately.
    std::ostringstream s;s<<"{\"turn\":"<<turn<<",\"phase\":"<<phase<<",\"selectIndexes\":"<<integers(select,false,64,ok)
      <<",\"isSelectLog\":"<<(selectLog?"true":"false")<<",\"costFailed\":"<<(cost?"true":"false")
      <<",\"card\":"<<verifiedCard<<",\"cardIdentityVerified\":"<<(identityOk?"true":"false")
      <<",\"itemId\":"<<(item?stringField(item,0x10,ok):"null")
      <<",\"drinkId\":"<<(drink?stringField(drink,0x10,ok):"null");
    int32_t type=0,index=0,position=0,remaining=0;
    if(cmd && read(cmd,0x10,type)&&read(cmd,0x18,index)&&read(cmd,0x1c,position)&&read(cmd,0x64,remaining))
        s<<",\"commandType\":"<<type<<",\"playIndex\":"<<index<<",\"cardPosition\":"<<position<<",\"remainingPlayCount\":"<<remaining;
    else {s<<",\"commandType\":null";if(cmd)ok=false;}
    s<<'}';return s.str();
}
using Serializer=std::string(*)(Address,bool&);
std::string serializeObjects(const std::vector<Address>& values,Serializer serialize,bool& ok) {
    std::ostringstream s;s<<'[';
    for(size_t i=0;i<values.size();++i){if(i)s<<',';s<<serialize(values[i],ok);}s<<']';return s.str();
}
std::string objectList(Address a,unsigned cap,Serializer serialize,bool& ok) {
    std::vector<Address> values;if(!list(a,cap,values)){ok=false;return "null";}
    return serializeObjects(values,serialize,ok);
}
// These are *selected* card plays reconstructed from native result-history
// command log types 2 (play) and 4 (play from special position). Candidate
// DFS contexts are never promoted to selected play events by this function.
std::string selectedPlayedCards(Address commandLog,bool& ok){
    std::vector<Address> logs;
    if(!list(commandLog,128,logs)){ok=false;return "null";}
    std::ostringstream out;
    out<<'[';bool comma=false;
    for(Address entry:logs){
        if(!entry){ok=false;return "null";}
        Address commandData=0,card=0;int32_t turn=0,phase=0,kind=0,index=0,position=0;
        if(!read(entry,0x40,commandData)||!commandData||
           !read(commandData,0x10,kind)) {ok=false;return "null";}
        if(kind!=2&&kind!=4)continue;
        if(!read(entry,0x28,card)||!card||
           !read(entry,0x10,turn)||!read(entry,0x48,phase)||
           !read(commandData,0x18,index)||!read(commandData,0x1c,position)) {
            ok=false;return "null";
        }
        bool cardOk=true;const auto identity=liveCard(card,cardOk);
        if(!cardOk||identity=="null"){ok=false;return "null";}
        if(comma)out<<',';comma=true;
        out<<"{\"turn\":"<<turn<<",\"phase\":"<<phase<<",\"commandType\":"
           <<kind<<",\"playIndex\":"<<index<<",\"cardPosition\":"<<position
           <<",\"card\":"<<identity
           <<",\"source\":\"ExamSimulateResult.turns.commands\","
           <<"\"selectedResultVerified\":true,\"cardEffectsComplete\":false}";
    }
    out<<']';return out.str();
}
std::string turn(Address a,bool& ok) {
    int32_t v[10]={},tail[3]={};Address refs[5]={},hold=0,enchant=0;
    if(!a || !bytes(a,0x10,v,sizeof(v)) || !bytes(a,0x38,refs,sizeof(refs)) || !bytes(a,0x60,tail,sizeof(tail)) ||
       !read(a,0x70,hold)||!read(a,0x78,enchant)){ok=false;return "null";}
    const char* names[]={"turn","score","vocal","dance","visual","addedScore","stamina","consumedStamina","block","addedBlock"};
    std::ostringstream s;s<<'{';for(unsigned i=0;i<10;++i){if(i)s<<',';s<<'"'<<names[i]<<"\":"<<v[i];}
    s<<",\"hand\":"<<objectList(refs[0],64,savedCard,ok)<<",\"statuses\":"<<objectList(refs[1],128,string,ok)
      <<",\"statusEffects\":"<<objectList(refs[2],128,statusEffect,ok)
      <<",\"resultStatusEffects\":"<<objectList(refs[3],128,statusEffect,ok)
      <<",\"commands\":"<<objectList(refs[4],128,command,ok)<<",\"hold\":"<<objectList(hold,64,savedCard,ok)
      <<",\"triggeredEnchantIds\":"<<objectList(enchant,128,string,ok)
      <<",\"selectedPlayedCards\":"<<selectedPlayedCards(refs[4],ok)
      <<",\"parameterType\":"<<tail[0]<<",\"idolStatusType\":"<<tail[1]<<",\"idolStatusStepCount\":"<<tail[2]<<'}';
    return s.str();
}
// Device evidence (54/54 v1.5.15 progress events): the object stored
// at Nullable<ExamSimulateResult>+40 has a null word at +0x10 and a
// non-zero, bounded word at +0x18. This is the IL2CPP SZARRAY header
// shape (bounds=nullptr, max_length), not a populated List<T> object.
// The previous serializer dereferenced +0x10 as List<T>._items and
// failed at NULL+0x18. Probe both representations without calling the game.
// ExamSimulateResult includes all previous turns on each selected step.
// Serialize each stable turn once per session; later steps report the total
// history length and only the appended contiguous suffix. On a partial read,
// retain the index of the first missing turn so a subsequent step can retry.
std::string turnHistory(Address a,unsigned& nextIndex,bool& ok,
                        bool& arrayShaped,unsigned& turnCount) {
    ReadScope scope("turns");
    if(!a){ok=false;noteReadFailure("missing-turn-history",a,0,0);return "null";}
    Address items=0;uint64_t sizeWord=0;
    {
        ReadScope header("container-header");
        if(!read(a,0x10,items)||!read(a,0x18,sizeWord)){ok=false;return "null";}
    }
    std::vector<Address> values;
    if(!items && sizeWord>0 && sizeWord<=128){
        arrayShaped=true;
        ReadScope shape("array-shaped");
        if(!array(a,128,values)){ok=false;return "null";}
    }else{
        ReadScope shape("list-shaped");
        if(!list(a,128,values)){ok=false;return "null";}
    }
    turnCount=static_cast<unsigned>(values.size());
    if(nextIndex>turnCount){
        noteReadFailure("turn-history-shrank",a,0x18,sizeof(sizeWord),0,turnCount);
        ok=false;return "null";
    }
    std::ostringstream s;s<<'[';
    bool wrote=false;
    for(unsigned i=nextIndex;i<turnCount;++i){
        const auto indexLabel="index-"+std::to_string(i);
        ReadScope itemScope(indexLabel.c_str());
        bool turnOk=true;
        const std::string record=turn(values[i],turnOk);
        if(!turnOk){ok=false;break;}
        if(wrote)s<<',';
        s<<record;
        wrote=true;++nextIndex;
    }
    s<<']';return s.str();
}

// Passive, bounded IL2CPP field inventory for the original ExamData object.
// The observer calls IL2CPP metadata functions, never a managed getter or
// game-side simulation method. This captures named setup fields without
// relying on unverified hard-coded offsets for nested collections.
namespace setup_probe {
using GetFields=void*(*)(void*,void**);
using FieldName=const char*(*)(void*);
using FieldOffset=size_t(*)(void*);
using FieldType=void*(*)(void*);
using TypeKind=int(*)(void*);
using ClassName=const char*(*)(void*);
using ClassFromType=void*(*)(void*);
using ElementClass=void*(*)(void*);
using ValueType=bool(*)(void*);
using ValueSize=int32_t(*)(void*,uint32_t*);
using ClassParent=void*(*)(void*);
using InstanceSize=int32_t(*)(void*);
using MethodFromName=const void*(*)(void*,const char*,int);
using MethodReturnType=void*(*)(const void*);
struct API {
    GetFields getFields=nullptr;FieldName fieldName=nullptr;FieldOffset fieldOffset=nullptr;
    FieldType fieldType=nullptr;TypeKind typeKind=nullptr;ClassName className=nullptr;
    ClassFromType classFromType=nullptr;ElementClass elementClass=nullptr;ValueType valueType=nullptr;ValueSize valueSize=nullptr;ClassParent classParent=nullptr;InstanceSize instanceSize=nullptr;MethodFromName methodFromName=nullptr;MethodReturnType methodReturnType=nullptr;
    bool ready()const{return getFields&&fieldName&&fieldOffset&&fieldType&&typeKind&&className&&classFromType;}
};
const API& api(){
    static const API p=[]{
        API p;
        // libil2cpp may be loaded RTLD_LOCAL. NOLOAD only returns an already
        // mapped handle and must never load a second game library.
        void* existing=dlopen("libil2cpp.so",RTLD_NOW|RTLD_NOLOAD);
        const ImageInfo image=find_il2cpp_image();
        const auto resolve=[&](const char* symbol)->void* {
            void* entry=dlsym(RTLD_DEFAULT,symbol);
            if(!entry && existing)entry=dlsym(existing,symbol);
            return entry?entry:resolve_export(image,symbol);
        };
        p.getFields=reinterpret_cast<GetFields>(resolve("il2cpp_class_get_fields"));
        p.fieldName=reinterpret_cast<FieldName>(resolve("il2cpp_field_get_name"));
        p.fieldOffset=reinterpret_cast<FieldOffset>(resolve("il2cpp_field_get_offset"));
        p.fieldType=reinterpret_cast<FieldType>(resolve("il2cpp_field_get_type"));
        p.typeKind=reinterpret_cast<TypeKind>(resolve("il2cpp_type_get_type"));
        p.className=reinterpret_cast<ClassName>(resolve("il2cpp_class_get_name"));
        p.classFromType=reinterpret_cast<ClassFromType>(resolve("il2cpp_class_from_type"));
        p.elementClass=reinterpret_cast<ElementClass>(resolve("il2cpp_class_get_element_class"));
        p.valueType=reinterpret_cast<ValueType>(resolve("il2cpp_class_is_valuetype"));
        p.valueSize=reinterpret_cast<ValueSize>(resolve("il2cpp_class_value_size"));
        p.classParent=reinterpret_cast<ClassParent>(resolve("il2cpp_class_get_parent"));
        p.instanceSize=reinterpret_cast<InstanceSize>(resolve("il2cpp_class_instance_size"));
        p.methodFromName=reinterpret_cast<MethodFromName>(resolve("il2cpp_class_get_method_from_name"));
        p.methodReturnType=reinterpret_cast<MethodReturnType>(resolve("il2cpp_method_get_return_type"));
        if(existing)dlclose(existing);
        return p;
    }();
    return p;
}
bool wanted(const char* n,int depth){
    if(!n)return false;
    if(depth==0)return true;
    // v1.5.22 IL2CPP metadata: ExamCardData owns _cardData at +0x10.
    // This lower-case field is filtered out by the ordinary Card/Id tokens.
    if(std::strcmp(n,"_cardData")==0)return true;
    const std::string name(n);
    for(const char* word:{"Deck","Card","Item","Drink","Parameter","Setting",
         "Turn","Random","Stamina","Status","Effect","Initial","Plan","Support",
         "Gimmick","Score","Bonus","Seed","Idol","Character","Hand","Grave","Hold",
         "Pool","Limit","Vocal","Dance","Visual","Config","Exam",
         "Upgrade","Customize","customize","Guid","Number","Origin","Type",
         "Count","value__","Value","value","_value","m_value","state","State",
         "Current","Max","Id","id"}){
        if(name.find(word)!=std::string::npos)return true;
    }
    return false;
}
// IL2CPP fields can be _turnTarget... or <TurnTarget...>k__BackingField.
// The previous case-sensitive filter silently discarded the real v1.5.23
// turn-target list even though the snapshot was not truncated.
bool keepSetupParameterField(const char* name){
    if(!name)return false;
    std::string field(name);
    std::transform(field.begin(),field.end(),field.begin(),
      [](unsigned char c){return static_cast<char>(std::tolower(c));});
    for(const char* part:{"turntargetstatusparametertypelist",
                          "configparametertypeorderedlist","drawcard",
                          "carddraw","turnstartdistribute","random","settingid"})
        if(field.find(part)!=std::string::npos)return true;
    return false;
}
struct Context {
    unsigned nodes=0;
    size_t remaining=65536;
    bool truncated=false;
    bool cardMetadataEmitted=false;
    std::vector<Address> seen;
};
// ExamCardData inherits its card identity. On some game builds the parent
// metadata accessor is absent; a read-only, bounded pointer scan can still
// identify a single direct UTF-16 "p_card-" field without guessing its offset.
// The scan is observational only: multiple candidates => no identity.
struct ScannedCardId { std::string json="null"; size_t offset=0; bool found=false; bool ambiguous=false; };
ScannedCardId scanCardIdentity(Address card,void* cardClass){
    ScannedCardId result;
    unsigned char data[4096]={};
    const ReadFailure previous=firstReadFailure;
    // Do not read past the actual managed object's IL2CPP instance size.
    const int32_t instance=api().instanceSize?api().instanceSize(cardClass):0;
    const size_t span=instance>=0x20&&instance<=4096
        ? static_cast<size_t>(instance) : size_t(768);
    bool loaded=bytes(card,0,data,span);
    if(!loaded)loaded=bytes(card,0,data,std::min(span,size_t(256)));
    // A failed optional probe must not make the parent snapshot a failure.
    firstReadFailure=previous;
    if(!loaded)return result;
    for(size_t offset=0x10;offset+8<=span;offset+=8){
        Address candidate=0;std::memcpy(&candidate,data+offset,sizeof(candidate));
        if(candidate<0x10000ULL||(candidate&7)!=0)continue;
        int32_t size=0;
        if(!read(candidate,0x10,size)){
            firstReadFailure=previous;continue;
        }
        if(size<9||size>112)continue;
        char16_t prefix[7]={};
        if(!bytes(candidate,0x14,prefix,sizeof(prefix))){
            firstReadFailure=previous;continue;
        }
        if(std::memcmp(prefix,u"p_card-",sizeof(prefix))!=0)continue;
        // Successful UTF-16 prefix is necessary but not sufficient; validate
        // every encoded character and insist on a single distinct ID.
        bool ok=true;
        const std::string serialized=string(candidate,ok);
        if(!ok){firstReadFailure=previous;continue;}
        if(result.found){
            if(result.json!=serialized)result.ambiguous=true;
        }else{
            result.json=serialized;result.offset=offset;result.found=true;
        }
    }
    firstReadFailure=previous;
    if(result.ambiguous){result.json="null";result.found=false;}
    return result;
}
// One per snapshot: metadata-only inventory determines whether a card ID is
// an instance field or computed through a getter. No managed getter is called.
std::string cardClassInventory(void* cls){
    const API& p=api();
    std::ostringstream out;
    out<<"{\"runtimeSize\":";
    const int32_t size=p.instanceSize?p.instanceSize(cls):0;
    if(size>0&&size<65536)out<<size;else out<<"null";
    out<<",\"hierarchy\":[";
    unsigned parentCount=0;
    for(void* current=cls;current&&parentCount<8;
        current=p.classParent?p.classParent(current):nullptr){
        if(parentCount++)out<<',';
        const char* className=p.className(current);
        out<<"{\"class\":\""<<(className?className:"?")<<"\",\"fields\":[";
        void* iterator=nullptr;
        for(unsigned n=0;n<140;++n){
            void* field=p.getFields(current,&iterator);
            if(!field)break;
            const char* name=p.fieldName(field);
            if(n)out<<',';
            out<<"{\"name\":\"";
            if(name)for(const char* c=name;*c;++c){
                if(*c=='"'||*c=='\\')out<<'\\';
                if(static_cast<unsigned char>(*c)>=0x20)out<<*c;
            }
            void* ft=p.fieldType(field);
            out<<"\",\"offset\":"<<p.fieldOffset(field)
               <<",\"kind\":"<<(ft?p.typeKind(ft):-1)<<"}";
        }
        out<<"]}";
    }
    out<<"]}";return out.str();
}
std::string value(Address where,int type,void* cls,int depth,Context& c,bool& ok);
std::string object(Address ptr,void* cls,int depth,Context& c,bool& ok,bool unboxed=false){
    if(!ptr)return "null";
    if(depth>5||c.nodes++>=220||c.seen.size()>=220){c.truncated=true;return "null";}
    for(Address old:c.seen)if(old==ptr)return "{\"$cycle\":true}";
    c.seen.push_back(ptr);
    // Record only the active recursion path. The same master CardData object
    // may be referenced by multiple copies of one card in the deck. A
    // snapshot-global seen set loses their identity after the first copy.
    struct PopPath{std::vector<Address>& path;~PopPath(){path.pop_back();}} popPath{c.seen};
    const auto& p=api();
    // For reference objects, use the actual runtime class instead of a
    // declared interface/base class. Otherwise IReadOnlyList<T> exposes no
    // concrete List<T> elements and card inheritance remains incomplete.
    if(!unboxed){
        Address klass=0;
        if(!read(ptr,0,klass)){ok=false;return "null";}
        if(!klass){ok=false;return "null";}
        cls=reinterpret_cast<void*>(klass);
    }else if(!cls){c.truncated=true;return "null";}
    const char* name=p.className(cls);
    if(!name){ok=false;return "null";}
    if(std::strcmp(name,"String")==0)return string(ptr,ok);
    if(std::strcmp(name,"List`1")==0){
        Address backing=0;int32_t count=0;
        if(!read(ptr,0x10,backing)||!read(ptr,0x18,count)){ok=false;return "null";}
        if(count<0||count>64||(!backing&&count)){c.truncated=true;return "null";}
        if(!backing)return "{\"$type\":\"List`1\",\"count\":0,\"elements\":[]}";
        if(!p.elementClass||!p.valueType){c.truncated=true;return "null";}
        Address arrayClass=0;uint64_t capacity=0;
        if(!read(backing,0,arrayClass)||!read(backing,0x18,capacity)){ok=false;return "null";}
        void* element=p.elementClass(reinterpret_cast<void*>(arrayClass));
        if(!element||capacity<static_cast<unsigned>(count)){c.truncated=true;return "null";}
        const bool elemValue=p.valueType(element);
        uint32_t align=0;
        const int32_t stride=elemValue&&p.valueSize?p.valueSize(element,&align):8;
        if(stride<=0||stride>128){c.truncated=true;return "null";}
        std::ostringstream items;
        items<<"{\"$type\":\"List`1\",\"count\":"<<count<<",\"elements\":[";
        for(int i=0;i<count;++i){
            if(i)items<<',';
            if(elemValue){
                const Address at=backing+0x20+static_cast<size_t>(i)*stride;
                const std::string typeName(p.className(element)?p.className(element):"");
                if(typeName=="Int32"||typeName=="UInt32"){
                    uint32_t raw=0;if(!read(at,0,raw)){ok=false;return "null";}
                    items<<raw;
                }else items<<object(at,element,depth+1,c,ok,true);
            }else{
                Address item=0;if(!read(backing,0x20+i*8,item)){ok=false;return "null";}
                items<<object(item,element,depth+1,c,ok);
            }
        }
        items<<"]}";
        return items.str();
    }
    if(c.remaining<100){c.truncated=true;return "null";}
    std::ostringstream out;out<<"{\"$type\":\""<<name<<"\",\"fields\":{";
    bool first=true;unsigned fieldCount=0;
    if(std::strcmp(name,"ExamCardData")==0){
        const auto identity=scanCardIdentity(ptr,cls);
        out<<"\"$scannedCardId\":"<<identity.json
           <<",\"$scannedCardIdOffset\":"<<(identity.found?std::to_string(identity.offset):"null")
           <<",\"$scannedCardIdAmbiguous\":"<<(identity.ambiguous?"true":"false");
        first=false;
        if(!c.cardMetadataEmitted){
            out<<",\"$cardClassInventory\":"<<cardClassInventory(cls);
            c.cardMetadataEmitted=true;
        }
    }
    void* targetClass=cls;
    // il2cpp_class_get_fields lists declared fields only. ExamCardData
    // inherits its ID/metadata from the ProduceCardData parent; inspect
    // up to six levels, respecting the runtime field offsets.
    for(unsigned parentDepth=0;targetClass&&parentDepth<6;++parentDepth){
      void* iterator=nullptr;
      for(unsigned localField=0;localField<180&&fieldCount<320;++localField,++fieldCount){
        void* field=p.getFields(targetClass,&iterator);
        if(!field)break;
        const char* fieldName=p.fieldName(field);
        const bool internalValueWrapper=std::strncmp(name,"Obscured`",9)==0||
            std::strncmp(name,"Raw`",4)==0||std::strncmp(name,"ArraySegment`",13)==0;
        // CardData is a master reference. We only need its identity here;
        // fully serializing effect trees for every duplicate card is costly.
        const bool nestedCardMaster=std::strcmp(name,"ExamCardData")!=0 &&
            (std::strstr(name,"CardData")!=nullptr || std::strstr(name,"CardMaster")!=nullptr);
        const bool idField=fieldName&&(
            std::strcmp(fieldName,"_id")==0||
            std::strcmp(fieldName,"id")==0||
            std::strstr(fieldName,"CardId")!=nullptr||
            std::strstr(fieldName,"<Id>")!=nullptr);
        // A managed card master may hold per-instance customization counts.
        // Inspect only fields explicitly named for customization, without
        // invoking getters or traversing unrelated effect trees.
        const bool customizeField=fieldName&&(
            std::strstr(fieldName,"Customize")!=nullptr||
            std::strstr(fieldName,"customize")!=nullptr);
        if(nestedCardMaster&&!idField&&!customizeField)continue;
        if(!internalValueWrapper&&!wanted(fieldName,depth))continue;
        // The ExamData start snapshot already holds cards, P-items, stamina
        // and the seed in plain text. ExamParameterModel has dozens of
        // encrypted Obscured<T> fields before its turn-target vector.
        // Recursing those redundant wrappers exhausted the 220-node cap
        // before the last 1-11 target entries. Capture only setup-specific
        // fields from this model to preserve the complete exact turn order.
        if(std::strcmp(name,"ExamParameterModel")==0 &&
           !keepSetupParameterField(fieldName))continue;
        // A replay needs the initial card's identity, upgrades and custom
        // support modifiers, not its potentially large dynamic effect graph.
        // This projection is read-only and never invokes managed getters.
        if(std::strcmp(name,"ExamCardData")==0 && fieldName){
            bool essential=false;
            for(const char* field:{"_cardData","_guid","_fixedDeckOrder",
                     "_baseUpgradeCount","_tmpUpgradeCount",
                     "_supportUpgradeIdList","_statusEffect",
                     "_customizeCountList","_customizeCounts"}){
                if(std::strcmp(fieldName,field)==0){essential=true;break;}
            }
            if(!essential)continue;
        }
        // Drop cache-only icon/description internals from each deck card.
        // They consume most of the snapshot budget but cannot reconstruct
        // the card's ID, upgrade level, origin or runtime effects.
        if(std::strcmp(name,"ExamCardData")==0 && fieldName &&
          (std::strstr(fieldName,"ProduceExamEffect")||
           std::strstr(fieldName,"GrowEffect")||
           std::strstr(fieldName,"Enchant")||
          (std::strstr(fieldName,"Icon")||std::strstr(fieldName,"Internal")||
           std::strstr(fieldName,"Description")||
           std::strstr(fieldName,"Cache"))))continue;
        const size_t offset=p.fieldOffset(field);
        if(offset<0x10||offset>0x2000)continue;
        void* ft=p.fieldType(field);
        if(!ft)continue;
        const int kind=p.typeKind(ft);
        void* nested=p.classFromType(ft);
        const Address fieldAddress = ptr+(unboxed?offset-0x10:offset);
        const std::string serialized=value(fieldAddress,kind,nested,depth+1,c,ok);
        if(!first)out<<',';
        first=false;
        out<<'"';
        // Metadata identifiers are compiler-generated alphanumerics and simple punctuation;
        // escape arbitrary characters defensively.
        for(const char* it=fieldName;*it;++it){
            if(*it=='"'||*it=='\\')out<<'\\';
            if(static_cast<unsigned char>(*it)<0x20)continue;
            out<<*it;
        }
        out<<"\":"<<serialized;
        if(out.tellp()>40000||c.nodes>=220){c.truncated=true;break;}
      }
      if(!p.classParent || out.tellp()>40000 || c.nodes>=220)break;
      targetClass=p.classParent(targetClass);
    }
    out<<"}}";
    c.remaining-=std::min(c.remaining,static_cast<size_t>(out.tellp()));
    return out.str();
}
std::string value(Address where,int kind,void* cls,int depth,Context& c,bool& ok){
    if(depth>6||c.remaining<100){c.truncated=true;return "null";}
    switch(kind){
        case 0x02:{uint8_t v=0;if(!read(where,0,v)){ok=false;return "null";}return v?"true":"false";}
        case 0x04:case 0x05:{uint8_t v=0;if(!read(where,0,v)){ok=false;return "null";}return std::to_string(v);}
        case 0x06:case 0x07:{uint16_t v=0;if(!read(where,0,v)){ok=false;return "null";}return std::to_string(v);}
        case 0x08:{int32_t v=0;if(!read(where,0,v)){ok=false;return "null";}return std::to_string(v);}
        case 0x09:{uint32_t v=0;if(!read(where,0,v)){ok=false;return "null";}return std::to_string(v);}
        case 0x0a:case 0x0b:{uint64_t v=0;if(!read(where,0,v)){ok=false;return "null";}return "\""+std::to_string(v)+"\"";}
        case 0x0c:{float v=0;if(!read(where,0,v)){ok=false;return "null";}return std::isfinite(v)?std::to_string(v):"null";}
        case 0x0d:{double v=0;if(!read(where,0,v)){ok=false;return "null";}return std::isfinite(v)?std::to_string(v):"null";}
        case 0x0e:{Address v=0;if(!read(where,0,v)){ok=false;return "null";}return string(v,ok);}
        case 0x11: // Typed unboxed value; field offsets include a 0x10 boxed header.
            return cls?object(where,cls,depth,c,ok,true):"null";
        case 0x12:case 0x15:case 0x1c:case 0x1d:case 0x14:{
            // Generic instantiation can be an unboxed value type. Do not
            // interpret its first bytes as a managed reference pointer.
            if(kind==0x15 && cls && api().valueType && api().valueType(cls))
                return object(where,cls,depth,c,ok,true);
            Address ptr=0;if(!read(where,0,ptr)){ok=false;return "null";}
            if(!ptr)return "null";
            const auto& p=api();
            if(kind==0x1d||kind==0x14){
                if(!p.elementClass||!p.valueType){c.truncated=true;return "null";}
                void* element=p.elementClass(cls);
                if(!element||p.valueType(element)){c.truncated=true;return "null";}
                uint64_t length=0;
                if(!read(ptr,0x18,length)){ok=false;return "null";}
                if(length>64){c.truncated=true;return "null";}
                std::ostringstream result;result<<'[';
                for(uint64_t i=0;i<length;++i){
                    Address item=0;if(!read(ptr,0x20+i*8,item)){ok=false;return "null";}
                    if(i)result<<',';
                    result<<object(item,element,depth+1,c,ok);
                }
                result<<']';return result.str();
            }
            return object(ptr,cls,depth+1,c,ok);
        }
        default:
            c.truncated=true;
            // The exact IL2CPP type kind is needed to decode generic
            // Obscured<T> fields without guessing pointer/value layout.
            return "{\"$unsupportedIl2CppTypeKind\":"+std::to_string(kind)+"}";
    }
}
// Even stripped game builds can be diagnosed without guessing field offsets.
// These bounded bytes are offline layout evidence, NOT a decoded deck or input
// to the simulator. No arbitrary recursive pointer chase and no managed calls.
std::string rawLayout(Address root) {
    readBudget=2048;firstReadFailure={};readStage.clear();
    std::ostringstream out;
    out<<"{\"format\":\"hex-pointer-inventory\",\"rootBytes\":384,\"rootHex\":";
    unsigned char raw[384]={};
    if(!bytes(root,0,raw,sizeof(raw))){
        out<<"null,\"readFailure\":"<<readFailureJson()<<"}";
        return out.str();
    }
    static const char h[]="0123456789abcdef";
    const auto encode=[&](const unsigned char* ptr,size_t count)->std::string{
        std::string out;out.reserve(count*2);
        for(size_t i=0;i<count;++i){out.push_back(h[ptr[i]>>4]);out.push_back(h[ptr[i]&15]);}
        return out;
    };
    out<<"\""<<encode(raw,sizeof(raw))<<"\",\"references\":[";
    unsigned found=0;
    for(size_t offset=0x10;offset+8<=sizeof(raw)&&found<24;offset+=8){
        Address ptr=0;std::memcpy(&ptr,raw+offset,sizeof(ptr));
        if(ptr<0x1000000000ull||(ptr&7)!=0)continue;
        unsigned char sample[64]={};
        // Missing optional references are an expected outcome. Do not promote
        // their failures into an error for the independent root memory dump.
        if(!bytes(ptr,0,sample,sizeof(sample)))continue;
        if(found++)out<<',';
        out<<"{\"offset\":"<<offset<<",\"value\":\"0x"<<std::hex<<ptr<<std::dec
           <<"\",\"sampleHex\":\""<<encode(sample,sizeof(sample))<<"\"}";
    }
    out<<"]}";
    return out.str();
}
std::string missingExports() {
    const API& p=api();
    std::ostringstream out;out<<'[';bool first=true;
    const auto append=[&](const char* symbol,bool found){
        if(found)return;
        if(!first)out<<',';
        first=false;out<<'"'<<symbol<<'"';
    };
    append("il2cpp_class_get_fields",p.getFields!=nullptr);
    append("il2cpp_field_get_name",p.fieldName!=nullptr);
    append("il2cpp_field_get_offset",p.fieldOffset!=nullptr);
    append("il2cpp_field_get_type",p.fieldType!=nullptr);
    append("il2cpp_type_get_type",p.typeKind!=nullptr);
    append("il2cpp_class_get_name",p.className!=nullptr);
    append("il2cpp_class_from_type",p.classFromType!=nullptr);
    append("il2cpp_class_get_element_class",p.elementClass!=nullptr);
    append("il2cpp_class_is_valuetype",p.valueType!=nullptr);
    append("il2cpp_class_value_size",p.valueSize!=nullptr);
    out<<']';return out.str();
}
std::string capture(Address data) {
    const auto& p=api();
    if(!p.ready())return "{\"available\":false,\"reason\":\"il2cpp-reflection-exports-unavailable\",\"missingExports\":"+missingExports()+",\"rawLayout\":"+rawLayout(data)+"}";
    bool ok=true;readBudget=16384;firstReadFailure={};readStage.clear();
    Context c;
    const std::string root=object(data,nullptr,0,c,ok);
    std::ostringstream out;
    const bool rootDecoded=root.rfind("{\"$type\":",0)==0;
    out<<"{\"available\":"<<(rootDecoded?"true":"false")
       <<",\"complete\":"<<((ok&&!c.truncated)?"true":"false")
       <<",\"source\":\"passive-il2cpp-metadata-and-readv\",\"classParentApiAvailable\":"<<(p.classParent?"true":"false")<<",\"root\":"<<root
       <<",\"truncated\":"<<(c.truncated?"true":"false")
       <<",\"objectsVisited\":"<<c.nodes;
    if(!ok)out<<",\"readFailure\":"<<readFailureJson();
    out<<'}';
    return out.str();
}
} // namespace setup_probe

bool namedOffset(Address object,std::initializer_list<const char*> names,bool reference,size_t& at){
    const auto& p=setup_probe::api();
    if(!object||!p.ready()||!p.classParent||!p.instanceSize)return false;
    Address klass=0;if(!read(object,0,klass)||!klass)return false;
    for(void* cls=reinterpret_cast<void*>(klass);cls;cls=p.classParent(cls)){
        void* iterator=nullptr;
        for(unsigned i=0;i<256;++i){
            void* field=p.getFields(cls,&iterator);if(!field)break;
            const char* name=p.fieldName(field);if(!name)continue;
            bool matches=false;
            for(const char* request:names)if(std::strcmp(request,name)==0){matches=true;break;}
            if(!matches)continue;
            void* type=p.fieldType(field);const int kind=type?p.typeKind(type):-1;
            // Managed System.String (IL2CPP_TYPE_STRING = 0x0e) is a reference too.
            // Excluding it silently rejected every ExamCardData._guid and ProduceCardData._id.
            if(reference?(kind!=0x0e&&kind!=0x12&&kind!=0x15&&kind!=0x1c):kind!=0x08)continue;
            const size_t offset=p.fieldOffset(field);
            const int32_t length=p.instanceSize(cls);
            if(offset<0x10||length<=0||offset+(reference?8:4)>static_cast<size_t>(length))continue;
            at=offset;return true;
        }
    }
    return false;
}
bool namedRef(Address object,std::initializer_list<const char*> names,Address& out){
    out=0;size_t at=0;
    return namedOffset(object,names,true,at)&&read(object,at,out);
}
bool namedInt(Address object,std::initializer_list<const char*> names,int32_t& out){
    out=0;size_t at=0;
    return namedOffset(object,names,false,at)&&read(object,at,out);
}
bool validCard(Address object){
    const auto& p=setup_probe::api();
    Address klass=0;if(!read(object,0,klass)||!klass||!p.className)return false;
    const char* name=p.className(reinterpret_cast<void*>(klass));
    return name&&std::strcmp(name,"ExamCardData")==0;
}
std::string liveCard(Address card,bool& ok){
    if(!card){ok=false;return "null";}
    Address master=0,id=0,guid=0;int32_t base=0,temp=0;
    if(!validCard(card)||!namedRef(card,{"_cardData"},master)||!master||
       !namedRef(master,{"_id"},id)||!id||!namedRef(card,{"_guid"},guid)||
       !namedInt(card,{"_baseUpgradeCount"},base)||
       !namedInt(card,{"_tmpUpgradeCount"},temp)){
        ok=false;return "null";
    }
    int32_t length=0;char16_t prefix[7]={};
    if(!read(id,0x10,length)||length<8||length>120||
       !bytes(id,0x14,prefix,sizeof(prefix))||
       std::memcmp(prefix,u"p_card-",sizeof(prefix))!=0){ok=false;return "null";}
    return "{\"id\":"+string(id,ok)+",\"guid\":"+string(guid,ok)+
           ",\"baseUpgradeCount\":"+std::to_string(base)+
           ",\"temporaryUpgradeCount\":"+std::to_string(temp)+"}";
}
// Traverse the selected hand object's typed fields, not arbitrary pointer offsets.
// A list is accepted only when its backing array element is ExamCardData.
void collectHandLists(Address object,int depth,std::vector<Address>& seen,std::vector<std::string>& lists){
    if(!object||depth>3||seen.size()>48||std::find(seen.begin(),seen.end(),object)!=seen.end())return;
    seen.push_back(object);
    const auto& p=setup_probe::api();
    Address klass=0;if(!read(object,0,klass)||!klass||!p.className)return;
    void* cls=reinterpret_cast<void*>(klass);
    const char* name=p.className(cls);if(!name)return;
    if(std::strcmp(name,"List\x60""1")==0){
        Address backing=0,arrayClass=0;
        if(!read(object,0x10,backing)||!backing||!read(backing,0,arrayClass)||
           !arrayClass||!p.elementClass)return;
        void* elem=p.elementClass(reinterpret_cast<void*>(arrayClass));
        const char* elemName=elem?p.className(elem):nullptr;
        if(!elemName||std::strcmp(elemName,"ExamCardData")!=0)return;
        std::vector<Address> cards;
        if(!list(object,64,cards))return;
        std::ostringstream value;value<<'[';
        for(size_t i=0;i<cards.size();++i){
            if(!cards[i])return;
            bool okay=true;const auto info=liveCard(cards[i],okay);
            if(!okay||info=="null")return;
            if(i)value<<',';
            value<<info;
        }
        value<<']';lists.push_back(value.str());return;
    }
    const std::string type(name);
    if(type.find("Hand")==std::string::npos&&type.find("CardPool")==std::string::npos)return;
    for(void* parent=cls;parent&&p.classParent;parent=p.classParent(parent)){
        void* iter=nullptr;
        for(unsigned i=0;i<160;++i){
            void* field=p.getFields(parent,&iter);if(!field)break;
            void* ft=p.fieldType(field);int kind=ft?p.typeKind(ft):-1;
            if(kind!=0x12&&kind!=0x15&&kind!=0x1c)continue;
            const size_t at=p.fieldOffset(field);
            const int32_t size=p.instanceSize?p.instanceSize(parent):0;
            if(at<0x10||size<=0||at+8>static_cast<size_t>(size))continue;
            Address next=0;if(read(object,at,next)&&next)collectHandLists(next,depth+1,seen,lists);
        }
    }
}
// The actual v3.4.1 ExamSequence owns an ExamDataStore. Its typed
// <HandList>/<DeckList>/<GraveList>/<LostList>/<HoldList> fields are the
// authoritative ordered containers in the native setup snapshot. Do not infer
// draw order from a guessed ExamHandModel child or from selected turn logs.
std::string selectedPoolJson(Address store,const char* field) {
    ReadScope scope(field);
    Address address=0;
    if(!store||!namedRef(store,{field},address)||!address)
        return "{\"available\":false,\"reason\":\"pool-field-unavailable\",\"cards\":null}";
    const auto& api=setup_probe::api();
    Address klass=0;
    const char* listType=nullptr;
    if(!read(address,0,klass)||!klass||!api.className||
       !(listType=api.className(reinterpret_cast<void*>(klass)))||
       std::strcmp(listType,"List\x60""1")!=0)
        return "{\"available\":false,\"reason\":\"not-a-managed-list\",\"cards\":null}";
    std::vector<Address> values;
    if(!list(address,128,values))
        return "{\"available\":false,\"reason\":\"list-read-incomplete\",\"cards\":null}";
    std::ostringstream s;s<<"{\"available\":true,\"count\":"<<values.size()<<",\"cards\":[";
    for(size_t i=0;i<values.size();++i){
        bool ok=true;
        const auto card=liveCard(values[i],ok);
        if(i)s<<',';
        s<<card;
        if(!ok)
            return "{\"available\":false,\"reason\":\"card-identity-unverified\",\"count\":"+
                   std::to_string(values.size())+",\"cards\":null}";
    }
    s<<"],\"source\":\"ExamDataStore.typed-list\"}";
    return s.str();
}
std::string selectedPoolsJson(Address sequence,Address parameter) {
    const ReadFailure oldFailure=firstReadFailure;
    Address store=0;
    std::ostringstream s;
    if(!sequence||!namedRef(sequence,{"_dataStore"},store)||!store){
        firstReadFailure=oldFailure;
        return "{\"available\":false,\"reason\":\"ExamDataStore-unavailable\"}";
    }
    s<<"{\"available\":true,\"source\":\"selected-ExamSequence._dataStore\","
      <<"\"hand\":"<<selectedPoolJson(store,"<HandList>k__BackingField")
      <<",\"deck\":"<<selectedPoolJson(store,"<DeckList>k__BackingField")
      <<",\"grave\":"<<selectedPoolJson(store,"<GraveList>k__BackingField")
      <<",\"lost\":"<<selectedPoolJson(store,"<LostList>k__BackingField")
      <<",\"hold\":"<<selectedPoolJson(store,"<HoldList>k__BackingField");
    uint32_t rng=0;
    const bool hasRandom=parameter&&read(parameter,0x77c,rng);
    s<<",\"randomStateObserved\":"<<(hasRandom?std::to_string(rng):"null")
      <<",\"randomStateSource\":\"ExamParameterModel+0x77c-v3.4.1-unverified-at-draw-boundary\"}";
    firstReadFailure=oldFailure;
    return s.str();
}
bool emit(const Run& run,const char* event,const std::string& content);
// Exact v3.4.1 ROM: ExamEffectCalculateContext stores ExamParameter at
// +0x10, CardController at +0x18, then Hand/Deck/Grave/Lost/Hold at
// +0x20/+0x28/+0x30/+0x38/+0x40 (getter RVAs 0x802b584..0x802b614).
// This context belongs to the *specific* effect evaluation. A cloned search
// candidate must not be silently labeled the selected rehearsal path.
struct ContextIdentity {
    bool verified=false;
    Address parameter=0,controller=0;
};
ContextIdentity inspectContext(Address ctx){
    ContextIdentity identity;
    if(!ctx)return identity;
    const auto& p=setup_probe::api();
    if(!p.className)return identity;
    Address cls=0;
    if(!read(ctx,0,cls)||!cls)return identity;
    const char* className=p.className(reinterpret_cast<void*>(cls));
    if(!className||std::strcmp(className,"ExamEffectCalculateContext")!=0)
        return identity;
    if(!namedRef(ctx,{"<ExamParameter>k__BackingField"},identity.parameter)||
       !namedRef(ctx,{"<CardController>k__BackingField"},identity.controller))
        return identity;
    identity.verified=identity.parameter&&identity.controller;
    return identity;
}
std::string contextPoolsJson(Address context){
    const ReadFailure oldFailure=firstReadFailure;
    const ContextIdentity i=inspectContext(context);
    if(!i.verified){
        firstReadFailure=oldFailure;
        return "{\"available\":false,\"reason\":\"invalid-effect-context\"}";
    }
    std::ostringstream s;
    s<<"{\"available\":true,\"source\":\"ExamEffectCalculateContext\","
     <<"\"hand\":"<<selectedPoolJson(context,"<HandList>k__BackingField")
     <<",\"deck\":"<<selectedPoolJson(context,"<DeckList>k__BackingField")
     <<",\"grave\":"<<selectedPoolJson(context,"<GraveList>k__BackingField")
     <<",\"lost\":"<<selectedPoolJson(context,"<LostList>k__BackingField")
     <<",\"hold\":"<<selectedPoolJson(context,"<HoldList>k__BackingField");
    uint32_t rng=0;const bool available=read(i.parameter,0x77c,rng);
    s<<",\"randomStateObserved\":"<<(available?std::to_string(rng):"null")<<"}";
    firstReadFailure=oldFailure;return s.str();
}
struct MutationProbe {
    Run* run=nullptr;
    Address context=0, controller=0;
    bool active=false,selectedContext=false,contextVerified=false;
    std::string before="null";
};
constexpr unsigned kMutationSelectedCap=32,kMutationCandidateCap=32,kMutationCandidatePerStepCap=2;
MutationProbe beginMutation(Address controller,Address context){
    MutationProbe p{};
    p.run=active;p.controller=controller;p.context=context;
    if(!p.run||!p.run->setupRecorded)return p;
    readBudget=1024;firstReadFailure={};readStage.clear();
    const auto identity=inspectContext(context);
    p.contextVerified=identity.verified;
    p.selectedContext=identity.verified&&identity.parameter==p.run->parameter&&
                       identity.controller==controller&&
                       controller==p.run->controller;
    if(p.selectedContext)
        p.active=p.run->mutationSamples<kMutationSelectedCap;
    else{
        // Sample a small number of cloned search candidates per selected
        // progress step, not just at the start of rehearsal. These candidates
        // must never be reported as confirmed real-game action sequences.
        if(p.run->candidateMutationStep!=p.run->steps){
            p.run->candidateMutationStep=p.run->steps;
            p.run->candidateSamplesThisStep=0;
        }
        p.active=p.contextVerified&&
                 p.run->candidateMutationSamples<kMutationCandidateCap&&
                 p.run->candidateSamplesThisStep<kMutationCandidatePerStepCap;
    }
    if(p.active)p.before=contextPoolsJson(context);
    return p;
}
void finishMutation(const MutationProbe& p,const char* action,Address card=0){
    if(!p.active||!p.run||active!=p.run)return;
    std::lock_guard<std::mutex> guard(mutex);
    readBudget=1024;firstReadFailure={};readStage.clear();
    bool cardOk=true;
    std::string cardJson=card?liveCard(card,cardOk):"null";
    const auto after=contextPoolsJson(p.context);
    std::ostringstream e;
    e<<",\"capturePhase\":\"after-native-mutation-return\""
     <<",\"nativeMethod\":\""<<action<<"\""
     <<",\"selectedContextMatched\":"<<(p.selectedContext?"true":"false")
     <<",\"contextClassVerified\":"<<(p.contextVerified?"true":"false")
     <<",\"selectedRehearsalPathVerified\":false"
     <<",\"card\":"<<cardJson
     <<",\"cardIdentityVerified\":"<<(cardOk?"true":"false")
     <<",\"beforePools\":"<<p.before<<",\"afterPools\":"<<after
     <<",\"cardEffectsComplete\":false";
    if(p.selectedContext)++p.run->mutationSamples;
    else ++p.run->candidateMutationSamples,++p.run->candidateSamplesThisStep;
    if(!emit(*p.run,"contest-native-mutation",e.str())){
        if(p.selectedContext)--p.run->mutationSamples;
        else --p.run->candidateMutationSamples,--p.run->candidateSamplesThisStep;
    }
}

std::string selectedHandJson(Address sequence){
    // Prefer the exact data-store list used by native ExamSequence.
    const ReadFailure oldFailure=firstReadFailure;
    Address store=0;
    if(sequence&&namedRef(sequence,{"_dataStore"},store)&&store){
        const auto hand=selectedPoolJson(store,"<HandList>k__BackingField");
        firstReadFailure=oldFailure;
        return hand;
    }
    // Legacy host fixtures expose an ExamHandModel instead.
    Address hand=0;std::string value;
    if(!namedRef(sequence,{"_hand"},hand)||!hand)
        value="{\"available\":false,\"reason\":\"hand-field-missing\",\"cards\":null}";
    else{
        std::vector<Address> seen;std::vector<std::string> lists;
        collectHandLists(hand,0,seen,lists);
        if(lists.size()==1)
            value="{\"available\":true,\"cards\":"+lists.front()+
                  ",\"source\":\"legacy-selected-hand-model\",\"turnResultParityVerified\":false}";
        else
            value="{\"available\":false,\"reason\":\""+std::string(lists.empty()?"no-typed-card-list":"ambiguous-card-lists")+
                  "\",\"cards\":null}";
    }
    firstReadFailure=oldFailure;
    return value;
}
// Natural managed getter returns are observed only after the game's original
// method runs. No getters are invoked by the module, and IL2CPP return kinds
// are validated before installing a hook. These are decoded results produced
// by the GAME, not raw Obscured<T> backing bytes.
using NumericGetterFn=int32_t(*)(void*,const void*);
NumericGetterFn originalStaminaGetter=nullptr,originalBlockGetter=nullptr,originalTurnGetter=nullptr;
__attribute__((noinline)) int32_t staminaGetter(void* self,const void* method){
    const int32_t value=originalStaminaGetter(self,method);
    ++naturalStaminaGetterCalls;
    if(active&&active->setupRecorded&&active->parameter==reinterpret_cast<Address>(self)){
        active->latestStamina=value;++active->staminaGetterCalls;
    }
    return value;
}
__attribute__((noinline)) int32_t blockGetter(void* self,const void* method){
    const int32_t value=originalBlockGetter(self,method);
    ++naturalBlockGetterCalls;
    if(active&&active->setupRecorded&&active->parameter==reinterpret_cast<Address>(self)){
        active->latestBlock=value;++active->blockGetterCalls;
    }
    return value;
}
__attribute__((noinline)) int32_t turnGetter(void* self,const void* method){
    const int32_t value=originalTurnGetter(self,method);
    ++naturalTurnGetterCalls;
    if(active&&active->setupRecorded&&active->parameter==reinterpret_cast<Address>(self)){
        active->latestTurn=value;++active->turnGetterCalls;
    }
    return value;
}
std::string gameGetterValuesJson(const Run& run) {
    std::ostringstream out;
    out<<"{\"provenance\":\"natural-managed-getter-return-only\","
       <<"\"additionalGameCalls\":false,"
       <<"\"stamina\":"<<(run.staminaGetterCalls?std::to_string(run.latestStamina):"null")
       <<",\"block\":"<<(run.blockGetterCalls?std::to_string(run.latestBlock):"null")
       <<",\"turn\":"<<(run.turnGetterCalls?std::to_string(run.latestTurn):"null")
       <<",\"staminaSamples\":"<<run.staminaGetterCalls
       <<",\"blockSamples\":"<<run.blockGetterCalls
       <<",\"turnSamples\":"<<run.turnGetterCalls
       <<",\"valuesNotGuaranteedSameInstant\":true}";
    return out.str();
}
void installNumericGetterHooks(Address parameter){
    if(numericGetterHooksAttempted||!parameter)return;
    numericGetterHooksAttempted=true;
    const auto& api=setup_probe::api();
    if(!api.methodFromName||!api.methodReturnType||!api.typeKind)return;
    Address klass=0;if(!read(parameter,0,klass)||!klass)return;
    const auto install=[&](const char* name,void* replacement,void** original)->bool {
        const void* info=api.methodFromName(reinterpret_cast<void*>(klass),name,0);
        if(!info)return false;
        void* type=api.methodReturnType(info);
        if(!type||api.typeKind(type)!=0x08)return false; // System.Int32 only
        Address code=0;
        return read(reinterpret_cast<Address>(info),0,code)&&code&&
               install_hook(code,replacement,original);
    };
    staminaGetterInstalled=install("get_Stamina",reinterpret_cast<void*>(staminaGetter),
                                   reinterpret_cast<void**>(&originalStaminaGetter));
    blockGetterInstalled=install("get_Block",reinterpret_cast<void*>(blockGetter),
                                 reinterpret_cast<void**>(&originalBlockGetter));
    turnGetterInstalled=install("get_CurrentTurn",reinterpret_cast<void*>(turnGetter),
                                reinterpret_cast<void**>(&originalTurnGetter));
}
void installSelectedHooks(Address controller);

void status() {
    std::ostringstream s;s<<"{\"schemaVersion\":2,\"pid\":"<<getpid()<<",\"hookMask\":"<<g_hook_mask.load()
      <<",\"moveNextInstalled\":"<<(moveInstalled?"true":"false")<<",\"searchResultInstalled\":"<<(resultInstalled?"true":"false")
      <<",\"moveCalls\":"<<moveCalls<<",\"selectedResultCalls\":"<<selectedCalls<<",\"sessions\":"<<nextId
      <<",\"recordsWritten\":"<<written<<",\"incompleteReads\":"<<failures<<",\"writeFailures\":"<<writeFailures
      <<",\"cardMoveInstalled\":"<<(cardMoveInstalled?"true":"false")
       <<",\"drawInstalled\":"<<(drawInstalled?"true":"false")
       <<",\"drawCalls\":"<<drawCalls<<",\"drawControllerMatched\":"<<drawMatched
       <<",\"drawSamples\":"<<drawSamples<<",\"drawContextReadable\":"<<drawContextReadable
       <<",\"drawContextParameterMatched\":"<<drawContextParameterMatched
       <<",\"cardMoveContextReadable\":"<<moveContextReadable
      <<",\"effectDifferenceInstalled\":false,\"effectDifferenceCalls\":0"
      <<",\"triggerCommandInstalled\":"<<(triggerCommandInstalled?"true":"false")
      <<",\"triggerCommandCalls\":"<<triggerCommandCalls<<",\"cardMoveCalls\":"<<cardMoveCalls
      <<",\"cardMoveControllerReadable\":"<<cardMoveControllerReadable
      <<",\"cardMoveControllerMatched\":"<<cardMoveControllerMatched
      <<",\"cardMoveParameterMatched\":"<<cardMoveParameterMatched
      <<",\"cardSnapshotAttempts\":"<<cardSnapshotAttempts
      <<",\"cardSnapshotSequenceMatched\":"<<cardSnapshotSequenceMatched
      <<",\"cardSnapshotParameterMatched\":"<<cardSnapshotParameterMatched
      <<",\"cardMoveSamples\":"<<cardMoveSamples<<",\"effectSamples\":"<<effectSamples
      <<",\"moveCardNativeInstalled\":"<<(moveCardNativeInstalled?"true":"false")
      <<",\"recycleNativeInstalled\":"<<(recycleNativeInstalled?"true":"false")
      <<",\"shuffleNativeInstalled\":"<<(shuffleNativeInstalled?"true":"false")
      <<",\"createIdNativeInstalled\":"<<(createIdNativeInstalled?"true":"false")
      <<",\"createSearchNativeInstalled\":"<<(createSearchNativeInstalled?"true":"false")
      <<",\"cardCommandNativeInstalled\":"<<(cardCommandNativeInstalled?"true":"false")
      <<",\"commandListFinishInstalled\":"<<(commandListFinishInstalled?"true":"false")
      <<",\"naturalStaminaGetterCalls\":"<<naturalStaminaGetterCalls
      <<",\"naturalBlockGetterCalls\":"<<naturalBlockGetterCalls
      <<",\"naturalTurnGetterCalls\":"<<naturalTurnGetterCalls
      <<",\"staminaGetterInstalled\":"<<(staminaGetterInstalled?"true":"false")
      <<",\"blockGetterInstalled\":"<<(blockGetterInstalled?"true":"false")
      <<",\"turnGetterInstalled\":"<<(turnGetterInstalled?"true":"false")
      <<",\"nativeMetricReadFailures\":"<<metricReadFailures
      <<",\"limitDrops\":"<<drops<<",\"fileBytes\":"<<fileBytes<<",\"fileByteLimit\":"<<kFileLimit
      <<",\"scope\":\"selected-contest-auto-play-data\",\"gameCaptureVerified\":false,\"syntheticGameCalls\":false}";
    atomic_write(path("contest_capture_status.json"),s.str());
}
bool emit(const Run& run,const char* event,const std::string& content) {
    std::ostringstream s;s<<"{\"schemaVersion\":2,\"pid\":"<<getpid()<<",\"tid\":"<<gettid()
      <<",\"observedAtUnixMs\":"<<unix_time_ms()<<",\"sessionId\":"<<run.id
      <<",\"event\":\""<<event<<"\",\"step\":"<<run.steps<<",\"source\":\"natural-selected-auto-play\","
      <<"\"gameCaptureVerified\":false,\"rngCaptured\":false,\"syntheticGameCalls\":false,"
      <<"\"libil2cppBuildId\":\""<<kV341BuildId<<"\""<<content<<"}\n";
    const auto line=s.str();if(fileBytes+line.size()>kFileLimit){++drops;status();return false;}
    std::ofstream out(path("contest_capture.jsonl"),std::ios::app|std::ios::binary);out<<line;out.flush();
    if(out){++written;fileBytes+=line.size();}else ++writeFailures;
    status();
    return bool(out);
}
struct BeforeSetup {
    uint32_t randomState=0, examSeed=0;
    bool available=false, examSeedAvailable=false;
    bool sequenceParameterReadable=false, sequenceParameterPresent=false;
    const char* unavailableReason="not-observed";
};
BeforeSetup observeBeforeSetup(Address sequence,Address examData){
    BeforeSetup before;
    if(!active){before.unavailableReason="no-active-contest";return before;}
    readBudget=16;firstReadFailure={};readStage.clear();
    // ExamData is the actual SetUpExam argument. Its Seed is independent
    // of whether ExamSequence has bound its new ParameterModel yet.
    if(examData)before.examSeedAvailable=read(examData,0x14,before.examSeed);
    if(!sequence){before.unavailableReason="sequence-null";return before;}
    Address parameter=0;
    before.sequenceParameterReadable=read(sequence,0x10,parameter);
    if(!before.sequenceParameterReadable){
        before.unavailableReason="sequence-parameter-unreadable";return before;
    }
    before.sequenceParameterPresent=parameter!=0;
    if(!parameter){
        before.unavailableReason="sequence-parameter-not-yet-bound";return before;
    }
    if(!read(parameter,0x77c,before.randomState)){
        before.unavailableReason="parameter-random-state-unreadable";return before;
    }
    before.available=true;
    before.unavailableReason="none";
    return before;
}
// Verified SetUpExam caller (0x07EFD3B4) executes within the original
// selected contest-auto MoveNext. Capture its real managed parameter/pools
// without invoking any managed getter or changing the game RNG.
void recordSetup(Address sequence,BeforeSetup before) {
    if(!active || active->setupRecorded || !sequence)return;
    std::lock_guard<std::mutex> guard(mutex);
    if(!active || active->setupRecorded)return;
    active->setupRecorded=true;
    active->sequence=sequence;
    readBudget=8192;firstReadFailure={};readStage.clear();
    Address parameter=0;
    bool hasParameter=namedRef(sequence,{"<Parameter>k__BackingField"},parameter)&&parameter;
    Address controller=0;
    const bool hasController=namedRef(sequence,{"<CardController>k__BackingField"},controller)&&controller;
    active->controller=hasController?controller:0;
    uint32_t randomState=0;
    const bool randomRead=hasParameter && read(parameter,0x77c,randomState);
    active->parameter=hasParameter?parameter:0;
    if(hasController)installSelectedHooks(controller);
    if(hasParameter)installNumericGetterHooks(parameter);
    std::ostringstream content;
    content<<",\"capturePhase\":\"after-ExamSequence.SetUpExam\",\"setupOrigin\":\"0x07EFD3B4\""
           <<",\"randomStateBeforeSetUp\":"<<(before.available?std::to_string(before.randomState):"null")
           <<",\"beforeRandomSource\":\"verified-caller-before-managed-setup\""
           <<",\"beforeRandomUnavailableReason\":\""<<before.unavailableReason<<"\""
           <<",\"seedBeforeSetUp\":"<<(before.examSeedAvailable?std::to_string(before.examSeed):"null")
           <<",\"beforeSequenceParameterReadable\":"<<(before.sequenceParameterReadable?"true":"false")
           <<",\"beforeSequenceParameterPresent\":"<<(before.sequenceParameterPresent?"true":"false")
           <<",\"afterSequenceParameterPresent\":"<<(hasParameter?"true":"false")
            <<",\"selectedControllerMetadataResolved\":"<<(hasController?"true":"false")
           <<",\"randomStateObserved\":"<<(randomRead?std::to_string(randomState):"null")
           <<",\"randomStateProvenance\":\"after-setup-not-necessarily-pre-shuffle\""
           <<",\"examParameterSnapshot\":"<<(hasParameter?setup_probe::capture(parameter):"null")
           <<",\"examSequenceSnapshot\":"<<setup_probe::capture(sequence)
           <<",\"dataComplete\":true";
    emit(*active,"contest-setup",content.str());
}
// Optional exact-build native telemetry. All examined game memory is read via
// process_vm_readv; no managed getters, status setters, RNG or game effects
// are invoked by this code. An effect-log callback is NOT a verified
// "all effects of this card have finished" boundary.
// v3.4.1 ExecuteCardCommandImpl directly calls GetTriggerEffectListCommand
// (RVA 0x080A67B8, two arguments: effect commands and bool flag).
// It constructs commands and is NOT an after-effect-completion callback.
using TriggerCommandFn=void*(*)(void*,void*,uint32_t,const void*);
using CardMoveFn=void(*)(void*,void*,uintptr_t,const void*);
TriggerCommandFn originalTriggerCommand=nullptr;
CardMoveFn originalCardMove=nullptr;
// Capture all loaded IL2CPP status-effect variants using *runtime metadata*.
// Read only scalar fields with bounded process_vm_readv; never call a game getter.
struct NativeEffectStatus {
    std::string type,key;
    std::map<std::string,int64_t> fields;
    bool complete=false;
};
std::string safeStatusName(const std::string& src){
    std::string out;
    for(unsigned char ch:src){
        if(out.size()>=96)break;
        if((ch>='a'&&ch<='z')||(ch>='A'&&ch<='Z')||
           (ch>='0'&&ch<='9')||ch=='_'||ch=='<'||ch=='>')
            out+=static_cast<char>(ch);
        else out+='_';
    }
    return out;
}
bool interestingStatusField(const char* text){
    if(!text)return false;
    std::string s(text);
    std::transform(s.begin(),s.end(),s.begin(),[](unsigned char c){
        return static_cast<char>(std::tolower(c));
    });
    for(const char* term:{"value","turn","count","remaining","duration",
        "passingturnstart","status","point","stance","fix","multiple",
        "consumption","buff","concentration","enthusiastic","uplifting",
        "fullpower","reduce","limit","lock","cooldown"})
        if(s.find(term)!=std::string::npos)return true;
    return false;
}
bool readStatusScalar(Address address,size_t offset,int kind,int64_t& output){
    if(offset<0x10||offset>0x800)return false;
    switch(kind){
        case 0x02:case 0x04:{uint8_t x=0;if(!read(address,offset,x))return false;output=x;return true;}
        case 0x05:{int8_t x=0;if(!read(address,offset,x))return false;output=x;return true;}
        case 0x06:{uint16_t x=0;if(!read(address,offset,x))return false;output=x;return true;}
        case 0x07:{int16_t x=0;if(!read(address,offset,x))return false;output=x;return true;}
        case 0x08:{int32_t x=0;if(!read(address,offset,x))return false;output=x;return true;}
        case 0x09:{uint32_t x=0;if(!read(address,offset,x))return false;output=x;return true;}
        case 0x0a:{int64_t x=0;if(!read(address,offset,x))return false;output=x;return true;}
        default:return false;
    }
}
NativeEffectStatus inspectStatus(Address entry,void* klass,const std::string& type,
                                 const std::string& key) {
    NativeEffectStatus out;out.type=safeStatusName(type);out.key=key;
    const auto& p=setup_probe::api();
    if(!p.getFields||!p.fieldName||!p.fieldOffset||!p.fieldType||!p.typeKind)
        return out;
    bool ok=true;unsigned count=0;
    for(void* parent=klass;parent&&count<24;) {
        void* iter=nullptr;
        for(unsigned n=0;n<64&&count<24;++n){
            void* field=p.getFields(parent,&iter);
            if(!field)break;
            const char* name=p.fieldName(field);
            if(!interestingStatusField(name))continue;
            void* ft=p.fieldType(field);
            const int kind=ft?p.typeKind(ft):-1;
            if(kind!=0x02&&kind!=0x04&&kind!=0x05&&kind!=0x06&&kind!=0x07
               &&kind!=0x08&&kind!=0x09&&kind!=0x0a)continue;
            std::string id=safeStatusName(name);
            if(id.empty()||out.fields.count(id))continue;
            int64_t value=0;
            if(!readStatusScalar(entry,p.fieldOffset(field),kind,value)){ok=false;continue;}
            out.fields.emplace(id,value);++count;
        }
        if(!p.classParent)break;
        parent=p.classParent(parent);
    }
    // Without parent metadata, inherited scalar fields are necessarily incomplete.
    out.complete=ok&&count<24&&p.classParent;return out;
}
// The two stance modes can also live on ExamParameterModel rather than as
// StatusEffect instances. Project only explicitly status-named primitive fields
// without recursive traversal or managed method invocation.
using ParameterStatusFields=std::map<std::string,int64_t>;
bool parameterFieldWanted(const char* field){
    if(!field)return false;
    std::string n(field);
    std::transform(n.begin(),n.end(),n.begin(),[](unsigned char ch){
        return static_cast<char>(std::tolower(ch));
    });
    for(const char* token:{"stance","uplifting","hold","strong","enthusi",
            "fullpower","lessonbuff","parameterbuff","concentration",
            "review","aggressive","motivation","staminaconsumption"})
        if(n.find(token)!=std::string::npos)return true;
    return false;
}
ParameterStatusFields inspectParameterStatuses(Address parameter,bool& metadataReady){
    ParameterStatusFields out;
    const auto& p=setup_probe::api();
    metadataReady=p.getFields&&p.fieldName&&p.fieldOffset&&p.fieldType&&p.typeKind;
    if(!metadataReady)return out;
    Address klass=0;
    if(!read(parameter,0,klass)||!klass)return out;
    unsigned count=0;
    for(void* parent=reinterpret_cast<void*>(klass);parent&&count<32;){
        void* it=nullptr;
        for(unsigned i=0;i<180 && count<32;++i){
            void* field=p.getFields(parent,&it);
            if(!field)break;
            const char* name=p.fieldName(field);
            if(!parameterFieldWanted(name))continue;
            void* ft=p.fieldType(field);
            const int kind=ft?p.typeKind(ft):-1;
            int64_t value=0;
            if(readStatusScalar(parameter,p.fieldOffset(field),kind,value)){
                out.emplace(safeStatusName(name),value);
                ++count;
            }
        }
        if(!p.classParent)break;
        parent=p.classParent(parent);
    }
    return out;
}
std::string parameterFieldsJson(const ParameterStatusFields& fields){
    std::ostringstream out;out<<'{';bool comma=false;
    for(const auto& field:fields){
        if(comma)out<<',';comma=true;
        out<<'"'<<field.first<<"\":"<<field.second;
    }
    out<<'}';return out.str();
}
using StatusFields=std::map<std::string,std::map<std::string,int64_t>>;
StatusFields statusIndex(const std::vector<NativeEffectStatus>& effects){
    StatusFields out;
    for(const auto& item:effects)out.emplace(item.key,item.fields);
    return out;
}
std::string statusesJson(const std::vector<NativeEffectStatus>& effects){
    std::ostringstream out;out<<'[';bool comma=false;
    for(const auto& e:effects){
        if(comma)out<<',';comma=true;
        out<<"{\"type\":\""<<e.type<<"\",\"key\":\""<<e.key
           <<"\",\"fieldsComplete\":"<<(e.complete?"true":"false")<<",\"fields\":{";
        bool fc=false;
        for(const auto& f:e.fields){
            if(fc)out<<',';fc=true;out<<'"'<<f.first<<"\":"<<f.second;
        }
        out<<"}}";
    }
    out<<']';return out.str();
}
std::string statusDeltasJson(const StatusFields& before,const StatusFields& after,bool valid){
    std::ostringstream out;out<<"{\"comparable\":"<<(valid?"true":"false")<<",\"entries\":[";
    bool comma=false;
    if(valid)for(const auto& item:after){
        if(comma)out<<',';comma=true;
        out<<"{\"key\":\""<<item.first<<"\",\"added\":"<<(before.count(item.first)?"false":"true")<<",\"fields\":{";
        const auto old=before.find(item.first);
        bool fc=false;
        for(const auto& field:item.second){
            if(fc)out<<',';fc=true;
            out<<'"'<<field.first<<"\":";
            if(old==before.end()){out<<"null";continue;}
            const auto prev=old->second.find(field.first);
            if(prev==old->second.end())out<<"null";
            else out<<(field.second-prev->second);
        }
        out<<"}}";
    }
    if(valid)for(const auto& item:before){
        if(after.count(item.first))continue;
        if(comma)out<<',';comma=true;
        out<<"{\"key\":\""<<item.first<<"\",\"removed\":true,\"fields\":{}";
        out<<",\"previousFields\":{";
        bool fc=false;
        for(const auto& field:item.second){
            if(fc)out<<',';fc=true;
            out<<'"'<<field.first<<"\":"<<field.second;
        }
        out<<"}}";
    }
    out<<"]}";return out.str();
}
struct NativeStatusSample {
    int32_t scoreVocal=0,scoreDance=0,scoreVisual=0,stamina=0,block=0,turn=0;
    int32_t review=0,aggressive=0;
    bool rawNumbers=false,backingStorageReadable=false,reviewAvailable=false,aggressiveAvailable=false;
    bool listComplete=false,statusMetadataAvailable=false;
    std::vector<NativeEffectStatus> statuses;
    ParameterStatusFields parameterFields;
    bool parameterMetadataAvailable=false;
};
// The exact v3.4.1 getters use the following addresses:
// Stamina +0x1cc, Block +0x248, judge Vo/Da/Vi +0x570/+0x58c/+0x5a8.
// They wrap Obscured<int>; the *native getter* returns Raw._value at +0x18
// only when _nonDefault is true, otherwise zero (verified by disassembly).
// Score is the sum of the three captured attribute values; each observed
// session still requires an on-device turn-result consistency check.
NativeStatusSample sampleStatus(Address sequence) {
    NativeStatusSample s;
    Address parameter=0;
    if(!sequence || !namedRef(sequence,{"<Parameter>k__BackingField"},parameter) || !parameter)return s;
    s.parameterFields=inspectParameterStatuses(parameter,s.parameterMetadataAvailable);
    int32_t raw[6]={};
    const size_t offsets[]={0x570,0x58c,0x5a8,0x1cc,0x248,0x144};
    bool ok=true;
    for(unsigned i=0;i<6;i++){
        // The pinned v3.4.1 Obscured<int>.get_Value assembly tests
        // _nonDefault at +0, then returns Raw._value at +0x18.
        uint8_t present=0;
        if(!read(parameter,offsets[i],present)){ok=false;continue;}
        if(!present)raw[i]=0;
        else if(!read(parameter,offsets[i]+0x18,raw[i]))ok=false;
    }
    if(ok){
        s.scoreVocal=raw[0];s.scoreDance=raw[1];s.scoreVisual=raw[2];
        s.stamina=raw[3];s.block=raw[4];s.turn=raw[5];
        // The ELF confirms these Obscured<int> backing fields, but an encoded
        // backing value is NOT yet proof of the managed getter's actual result.
        // Export the evidence separately, never mislabel it as a real score.
        s.backingStorageReadable=true;
        s.rawNumbers=false;
    }
    Address effects=0,list=0;
    if(!read(parameter,0x390,effects)||!effects||!read(effects,0x10,list)||!list)
        return s;
    std::vector<Address> entries;
    if(!contest_capture::list(list,96,entries))return s;
    const auto className=setup_probe::api().className;
    if(!className)return s;
    bool complete=true;
    std::map<std::string,unsigned> ordinals;
    const auto& metadata=setup_probe::api();
    s.statusMetadataAvailable=metadata.getFields&&metadata.fieldName&&metadata.fieldOffset&&metadata.fieldType&&metadata.typeKind;
    for(Address entry:entries){
        if(!entry)continue;
        Address klass=0;
        if(!read(entry,0,klass)||!klass){complete=false;continue;}
        // Metadata-only class-name lookup; does not run a managed getter.
        const char* type=className(reinterpret_cast<void*>(klass));
        if(!type){complete=false;continue;}
        const std::string typeName(type);
        if(typeName.find("StatusEffect")!=std::string::npos){
            const auto key=safeStatusName(typeName)+"#"+std::to_string(ordinals[typeName]++);
            s.statuses.push_back(inspectStatus(entry,reinterpret_cast<void*>(klass),typeName,key));
        }
        if(std::strcmp(type,"ReviewStatusEffect")==0){
            int32_t value=0;
            if(read(entry,0x14,value)){s.review=value;s.reviewAvailable=true;}
            else complete=false;
        }else if(std::strcmp(type,"AggressiveStatusEffect")==0){
            int32_t value=0;
            if(read(entry,0x28,value)){s.aggressive=value;s.aggressiveAvailable=true;}
            else complete=false;
        }
    }
    // Missing status object may legitimately mean zero. Leave the field
    // absent, rather than invent zero or using simulator predictions.
    s.listComplete=complete;
    return s;
}
std::string sampleJson(const NativeStatusSample& s) {
    std::ostringstream out;
    out<<"{\"source\":\"native-process-vm-readv\",\"getterBytecodeVerified\":false"
       <<",\"obscuredBackingStorage\":{\"readable\":"<<(s.backingStorageReadable?"true":"false")
       <<",\"vocal\":"<<(s.backingStorageReadable?std::to_string(s.scoreVocal):"null")
       <<",\"dance\":"<<(s.backingStorageReadable?std::to_string(s.scoreDance):"null")
       <<",\"visual\":"<<(s.backingStorageReadable?std::to_string(s.scoreVisual):"null")
       <<",\"stamina\":"<<(s.backingStorageReadable?std::to_string(s.stamina):"null")
       <<",\"block\":"<<(s.backingStorageReadable?std::to_string(s.block):"null")
       <<",\"turn\":"<<(s.backingStorageReadable?std::to_string(s.turn):"null")
       <<",\"decoded\":false}"
       <<",\"turnResultParityVerified\":false"
       <<",\"score\":"<<(s.rawNumbers?std::to_string(static_cast<int64_t>(s.scoreVocal)+s.scoreDance+s.scoreVisual):"null")
       <<",\"scoreVocal\":"<<(s.rawNumbers?std::to_string(s.scoreVocal):"null")
       <<",\"scoreDance\":"<<(s.rawNumbers?std::to_string(s.scoreDance):"null")
       <<",\"scoreVisual\":"<<(s.rawNumbers?std::to_string(s.scoreVisual):"null")
       <<",\"stamina\":"<<(s.rawNumbers?std::to_string(s.stamina):"null")
       <<",\"block\":"<<(s.rawNumbers?std::to_string(s.block):"null")
       <<",\"turn\":"<<(s.rawNumbers?std::to_string(s.turn):"null")
       <<",\"review\":"<<(s.reviewAvailable?std::to_string(s.review):"null")
       <<",\"aggressive\":"<<(s.aggressiveAvailable?std::to_string(s.aggressive):"null")
       <<",\"statusListComplete\":"<<(s.listComplete?"true":"false")
       <<",\"statusMetadataAvailable\":"<<(s.statusMetadataAvailable?"true":"false")
       <<",\"statusEffects\":"<<statusesJson(s.statuses)
       <<",\"parameterStatusMetadataAvailable\":"<<(s.parameterMetadataAvailable?"true":"false")
       <<",\"parameterStatusFields\":"<<parameterFieldsJson(s.parameterFields)<<"}";
    return out.str();
}
void emitCardObservation(Run& run,const char* event,Address sequence,Address explicitCard,
                         const std::string& beforeCommandPools="null") {
    // Owner identity is validated at setup; do not mix forecast/clone
    // sequences with the auto-play sequence or invoke a game getter.
    ++cardSnapshotAttempts;
    if(!run.setupRecorded||!run.sequence||run.sequence!=sequence)return;
    ++cardSnapshotSequenceMatched;
    if(run.effectSamples+run.cardMoveSamples>=kNativeCardSamplesPerSession){++drops;return;}
    readBudget=2048;firstReadFailure={};readStage.clear();
    Address controller=0,playing=0,parameter=0;
    const bool match=namedRef(sequence,{"<Parameter>k__BackingField"},parameter)&&parameter==run.parameter;
    if(!match)return;
    ++cardSnapshotParameterMatched;
    if(!explicitCard && namedRef(sequence,{"<CardController>k__BackingField"},controller)&&controller)
        namedRef(controller,{"<PlayingCard>k__BackingField"},playing);
    else playing=explicitCard;
    bool cardOk=true;
    const std::string card=playing?liveCard(playing,cardOk):"null";
    if(!playing)cardOk=false;
    const NativeStatusSample sample=sampleStatus(sequence);
    const bool isMove=std::strcmp(event,"contest-card-move")==0;
    if(isMove)++run.cardActionSerial;
    const bool sameCard=!run.previousCard.empty()&&run.previousCard!="null"
                        &&card!="null"&&run.previousCard==card;
    const auto fieldDelta=[](bool same,bool current,bool previous,int64_t value)->std::string {
        return same&&current&&previous?std::to_string(value):"null";
    };
    const int64_t currentScore=static_cast<int64_t>(sample.scoreVocal)
                               +sample.scoreDance+sample.scoreVisual;
    std::ostringstream change;
    change<<"{\"fromPreviousSameCardSample\":"<<(sameCard?"true":"false")
          <<",\"score\":"<<fieldDelta(sameCard,sample.rawNumbers,run.prevRaw,currentScore-run.prevScore)
          <<",\"stamina\":"<<fieldDelta(sameCard,sample.rawNumbers,run.prevRaw,static_cast<int64_t>(sample.stamina)-run.prevStamina)
          <<",\"block\":"<<fieldDelta(sameCard,sample.rawNumbers,run.prevRaw,static_cast<int64_t>(sample.block)-run.prevBlock)
          <<",\"review\":"<<fieldDelta(sameCard,sample.reviewAvailable,run.prevReviewAvailable,static_cast<int64_t>(sample.review)-run.prevReview)
          <<",\"aggressive\":"<<fieldDelta(sameCard,sample.aggressiveAvailable,run.prevAggressiveAvailable,static_cast<int64_t>(sample.aggressive)-run.prevAggressive)
          <<"}";
    const auto currentStatuses=statusIndex(sample.statuses);
    const bool statusComparable=sameCard&&sample.listComplete&&run.prevStatusesComplete&&sample.statusMetadataAvailable;
    const std::string statusDeltas=statusDeltasJson(run.prevStatusFields,currentStatuses,statusComparable);
    const StatusFields oldParameter{{"ExamParameterModel",run.prevParameterFields}};
    const StatusFields newParameter{{"ExamParameterModel",sample.parameterFields}};
    const std::string parameterDeltas=statusDeltasJson(oldParameter,newParameter,
        sameCard&&sample.parameterMetadataAvailable&&run.prevStatusesComplete);
    std::ostringstream value;
    value<<",\"capturePhase\":\""<<event<<"\""
         <<",\"cardActionSerial\":"<<run.cardActionSerial
         <<",\"card\":"<<card<<",\"cardIdentityReadable\":"<<(cardOk?"true":"false")
         <<",\"metrics\":"<<sampleJson(sample)<<",\"changes\":"<<change.str()
         <<",\"statusEffectChanges\":"<<statusDeltas
         <<",\"parameterStatusChanges\":"<<parameterDeltas
         <<",\"poolStateBeforeCommandBuild\":"<<beforeCommandPools
         <<",\"poolStateAtObservation\":"<<selectedPoolsJson(sequence,run.parameter)
         <<",\"cardEffectsComplete\":false"
         <<",\"provenance\":\""<<(std::strcmp(event,"contest-card-command-return")==0
                    ?"after-synchronous-card-command-return-not-async-effects"
                    :"native-command-builder-boundary-not-card-completion")<<"\""
         <<",\"dataComplete\":"<<((sample.rawNumbers&&cardOk)?"true":"false");
    if(!sample.rawNumbers)++metricReadFailures;
    // emit() also persists the counters; update them before emitting so
    // the status JSON never lags one event behind.
    if(isMove)++run.cardMoveSamples,++cardMoveSamples;
    else ++run.effectSamples,++effectSamples;
    if(emit(run,event,value.str())){
        run.previousCard=card;
        run.prevScore=currentScore;
        run.prevStamina=sample.stamina;run.prevBlock=sample.block;
        run.prevReview=sample.review;run.prevAggressive=sample.aggressive;
        run.prevRaw=sample.rawNumbers;
        run.prevReviewAvailable=sample.reviewAvailable;
        run.prevAggressiveAvailable=sample.aggressiveAvailable;
        run.prevStatusFields=currentStatuses;
        run.prevParameterFields=sample.parameterFields;
        run.prevStatusesComplete=sample.listComplete&&sample.statusMetadataAvailable;
    }else{
        if(isMove)--run.cardMoveSamples,--cardMoveSamples;
        else --run.effectSamples,--effectSamples;
        status();
    }
}
// Called after the game's *natural* effect-difference log update. Nothing is
// executed a second time; the output is measured at this exact callback stage.
__attribute__((noinline)) void* triggerCommand(void* self,void* commandList,uint32_t mode,const void* method){
    // Observe only this selected sequence. Most calls belong to DFS clones and
    // must not be serialized as if they were the selected path.
    Run* selectedRun=active;
    const bool selected=selectedRun&&selectedRun->setupRecorded&&
                        selectedRun->sequence==reinterpret_cast<Address>(self);
    std::string beforeCommandPools="null";
    if(selected){
        std::lock_guard<std::mutex> guard(mutex);
        readBudget=2048;firstReadFailure={};readStage.clear();
        beforeCommandPools=selectedPoolsJson(selectedRun->sequence,selectedRun->parameter);
    }
    // No effect invocation is added. Native function is forwarded exactly once.
    void* result=originalTriggerCommand(self,commandList,mode,method);
    if(!active||!self)return result;
    std::lock_guard<std::mutex> guard(mutex);++triggerCommandCalls;
    if(selected&&active==selectedRun) {
        // The card command's actual x2 argument is more authoritative than
        // CardController.PlayingCard, which can be null during command construction.
        const Address sequence=reinterpret_cast<Address>(self);
        Address explicitCard=0;
        if(currentCardCommand && currentCardCommand->sequence==sequence) {
            explicitCard=currentCardCommand->card;
            // ELF ExamEffectCalculateContext.get_PlayingCard loads +0x78.
            // Resolve the typed field through live IL2CPP metadata instead of
            // trusting a hard-coded offset or an unrelated controller instance.
            if(!explicitCard && currentCardCommand->context)
                namedRef(currentCardCommand->context,
                         {"<PlayingCard>k__BackingField"},explicitCard);
        }
        emitCardObservation(*selectedRun,"contest-card-command-snapshot",
                            sequence,explicitCard,beforeCommandPools);
    }
    if(triggerCommandCalls<=8 || (triggerCommandCalls&(triggerCommandCalls-1))==0)status();
    return result;
}
// Exact Build ID 77fda4e2...; typed void-returning methods (verified via
// IL2CPP v31 method definitions and Assembly-CSharp codegen relocations).
// Capture before and after each native mutation. Async effect completion is
// NOT implied by any of these synchronous function returns.
using MoveCardNativeFn=void(*)(uintptr_t,uintptr_t,uintptr_t,uintptr_t,uintptr_t,uintptr_t);
using RecycleNativeFn=void(*)(uintptr_t,uintptr_t,uintptr_t,uintptr_t);
using ShuffleNativeFn=void(*)(uintptr_t,uintptr_t,uintptr_t);
using CreateNativeFn=void(*)(uintptr_t,uintptr_t,uintptr_t);
using CardCommandNativeFn=void(*)(uintptr_t,uintptr_t,uintptr_t,uintptr_t,uintptr_t,uintptr_t);
MoveCardNativeFn originalMoveCardNative=nullptr;
RecycleNativeFn originalRecycleNative=nullptr;
ShuffleNativeFn originalShuffleNative=nullptr;
CreateNativeFn originalCreateIdNative=nullptr,originalCreateSearchNative=nullptr;
CardCommandNativeFn originalCardCommandNative=nullptr;
__attribute__((noinline)) void moveCardNative(uintptr_t self,uintptr_t fromList,
    uintptr_t target,uintptr_t effect,uintptr_t context,uintptr_t method){
    const auto probe=beginMutation(self,context);
    originalMoveCardNative(self,fromList,target,effect,context,method);
    finishMutation(probe,"ExamCardMoveController.MoveCard");
}
__attribute__((noinline)) void recycleNative(uintptr_t self,uintptr_t context,
    uintptr_t preDrawCount,uintptr_t method){
    const auto probe=beginMutation(self,context);
    originalRecycleNative(self,context,preDrawCount,method);
    finishMutation(probe,"ExamCardMoveController.ReplaceGraveToDeck");
}
__attribute__((noinline)) void shuffleNative(uintptr_t self,uintptr_t context,
    uintptr_t method){
    const auto probe=beginMutation(self,context);
    originalShuffleNative(self,context,method);
    finishMutation(probe,"ExamCardMoveController.ShuffleDeck");
}
__attribute__((noinline)) void createIdNative(uintptr_t self,uintptr_t context,
    uintptr_t method){
    readBudget=48;firstReadFailure={};readStage.clear();
    const auto identity=inspectContext(context);
    const auto probe=beginMutation(identity.controller,context);
    originalCreateIdNative(self,context,method);
    finishMutation(probe,"CardCreateIdEffectExecutor.ExecuteEffect");
}
__attribute__((noinline)) void createSearchNative(uintptr_t self,uintptr_t context,
    uintptr_t method){
    readBudget=48;firstReadFailure={};readStage.clear();
    const auto identity=inspectContext(context);
    const auto probe=beginMutation(identity.controller,context);
    originalCreateSearchNative(self,context,method);
    finishMutation(probe,"CardCreateSearchEffectExecutor.ExecuteEffect");
}
__attribute__((noinline)) void cardCommandNative(uintptr_t self,uintptr_t position,
    uintptr_t card,uintptr_t useCount,uintptr_t context,uintptr_t method){
    readBudget=48;firstReadFailure={};readStage.clear();
    const auto identity=inspectContext(context);
    const auto probe=beginMutation(identity.controller,context);
    {
        ScopedCardCommand commandScope(self,context,card);
        originalCardCommandNative(self,position,card,useCount,context,method);
    }
    finishMutation(probe,"ExamSequence.ExecuteCardCommandImpl",card);
    // Observe the same card after this synchronous native call. The method
    // can schedule deferred effects, so this is NOT a completion marker.
    if(active&&active->setupRecorded&&active->sequence==self&&card){
        std::lock_guard<std::mutex> guard(mutex);
        emitCardObservation(*active,"contest-card-command-return",self,card);
    }
}

// Exact v3.4.1: <ExecuteCommandListImplAsync>d__110.MoveNext is at
// 0x80E0F40. Prologue loads state from [x0] and owner sequence from [x0+0x18]
// (0x80E0FB8 / 0x80E0FBC). State transition to -2 denotes completion of
// this UniTask command-list runner, not necessarily of *all* deferred effects.
using CommandListMoveNextFn=void(*)(uintptr_t,uintptr_t);
CommandListMoveNextFn originalCommandListMoveNext=nullptr;
__attribute__((noinline)) void commandListMoveNext(uintptr_t stateMachine,uintptr_t method){
    int32_t before=0,after=0;Address sequence=0;
    readBudget=64;firstReadFailure={};readStage.clear();
    const bool identity=stateMachine&&read(stateMachine,0,before)&&
                        read(stateMachine,0x18,sequence)&&sequence;
    originalCommandListMoveNext(stateMachine,method); // exactly once
    if(!identity)return;
    readBudget=64;firstReadFailure={};readStage.clear();
    if(!read(stateMachine,0,after)||before==-2||after!=-2)return;
    std::lock_guard<std::mutex> guard(mutex);
    Run* selected=nullptr;
    if(active&&active->setupRecorded&&active->sequence==sequence)
        selected=active;
    if(!selected)for(auto& entry:runs)
        if(entry.second.setupRecorded&&entry.second.sequence==sequence){
            selected=&entry.second;break;
        }
    if(!selected||selected->commandListSamples>=64)return;
    readBudget=2048;firstReadFailure={};readStage.clear();
    std::ostringstream fields;
    fields<<",\"capturePhase\":\"after-ExecuteCommandListImplAsync-completion\""
          <<",\"commandListCompleted\":true,\"completionState\":-2"
          <<",\"completionSuccessVerified\":false"
          <<",\"cardUseCompletionVerified\":false"
          <<",\"poolState\":"<<selectedPoolsJson(sequence,selected->parameter)
          <<",\"naturalGameGetterValues\":"<<gameGetterValuesJson(*selected)
          <<",\"metrics\":"<<sampleJson(sampleStatus(sequence))
          <<",\"cardEffectsComplete\":false";
    ++selected->commandListSamples;
    if(!emit(*selected,"contest-command-list-complete",fields.str()))
        --selected->commandListSamples;
}

// Card movement is not completion of effects. Validate the context BEFORE
// forwarding, because IL2CPP may reuse the calculation context afterwards.
__attribute__((noinline)) void cardMove(void* self,void* card,uintptr_t context,const void* method){
    Address parameter=0;bool readable=false;
    const bool trace=active&&active->setupRecorded&&self&&context;
    if(trace){readBudget=64;firstReadFailure={};readStage.clear();
        readable=namedRef(context,{"<ExamParameter>k__BackingField"},parameter);}
    const auto mutation=beginMutation(reinterpret_cast<Address>(self),context);
    originalCardMove(self,card,context,method);
    finishMutation(mutation,"ExamCardMoveController.MovePlayCard",reinterpret_cast<Address>(card));
    if(!trace)return;
    std::lock_guard<std::mutex> guard(mutex);++cardMoveCalls;
    if(active->controller)++cardMoveControllerReadable;
    const bool controllerMatched=reinterpret_cast<Address>(self)==active->controller;
    if(controllerMatched)++cardMoveControllerMatched;
    if(readable)++moveContextReadable;
    const bool parameterMatched=readable&&parameter==active->parameter;
    if(parameterMatched)++cardMoveParameterMatched;
    if(controllerMatched&&parameterMatched)
        emitCardObservation(*active,"contest-card-move",active->sequence,
                            reinterpret_cast<Address>(card));
    if(cardMoveCalls<=8 || (cardMoveCalls&(cardMoveCalls-1))==0)status();
}
using DrawFn=uintptr_t(*)(uintptr_t,uintptr_t,uintptr_t,uintptr_t,
                          uintptr_t,uintptr_t,uintptr_t,uintptr_t);
DrawFn originalDraw=nullptr;
// Read-only before/after observations. No game getter or extra draw is called.
__attribute__((noinline)) uintptr_t drawCard(
    uintptr_t a0,uintptr_t a1,uintptr_t a2,uintptr_t a3,
    uintptr_t a4,uintptr_t a5,uintptr_t a6,uintptr_t a7){
    Run* selectedRun=active;
    const bool selected=selectedRun&&selectedRun->setupRecorded&&
                        selectedRun->controller==a0&&selectedRun->sequence;
    const auto candidateProbe=selected?MutationProbe{}:beginMutation(a0,a2);
    std::string before="null",beforePools="null";
    if(selected){
        std::lock_guard<std::mutex> guard(mutex);
        readBudget=2048;firstReadFailure={};readStage.clear();
        before=selectedHandJson(selectedRun->sequence);
        beforePools=selectedPoolsJson(selectedRun->sequence,selectedRun->parameter);
    }
    // Native call exactly once: the returned value and all registers are forwarded.
    const uintptr_t result=originalDraw(a0,a1,a2,a3,a4,a5,a6,a7);
    finishMutation(candidateProbe,"ExamCardMoveController.DrawCard");
    if(!active)return result;
    std::lock_guard<std::mutex> guard(mutex);++drawCalls;
    if(!selected||active!=selectedRun){
        if(drawCalls<=8||(drawCalls&(drawCalls-1))==0)status();
        return result;
    }
    ++drawMatched;readBudget=2048;firstReadFailure={};readStage.clear();
    Address parameter=0;
    // ROM v3.4.1: DrawCard(int, ExamEffectCalculateContext, bool) at 0x827cff0.
    // ExamEffectCalculateContext.get_ExamParameter at 0x802b584 loads [x0,#0x10].
    // Retain observations when the selected controller matches, even if a
    // transient context is unreadable.
    const bool contextReadable=a2&&namedRef(a2,{"<ExamParameter>k__BackingField"},parameter);
    if(contextReadable)++drawContextReadable;
    const bool contextMatched=contextReadable&&parameter==selectedRun->parameter;
    if(contextMatched)++drawContextParameterMatched;
    if(drawSamples>=kNativeCardSamplesPerSession){++drops;return result;}
    const auto after=selectedHandJson(selectedRun->sequence);
    const auto afterPools=selectedPoolsJson(selectedRun->sequence,selectedRun->parameter);
    std::ostringstream fields;
    fields<<",\"capturePhase\":\"after-DrawCard-return\""
          <<",\"requestedCount\":"<<static_cast<int32_t>(a1)
          <<",\"beforeHand\":"<<before<<",\"afterHand\":"<<after
          <<",\"beforePools\":"<<beforePools<<",\"afterPools\":"<<afterPools
          <<",\"controllerIdentityMatched\":true"
          <<",\"contextParameterReadable\":"<<(contextReadable?"true":"false")
          <<",\"contextParameterMatched\":"<<(contextMatched?"true":"false")
          <<",\"contextSignatureVerified\":true"
          <<",\"turnResultParityVerified\":false,\"cardEffectsComplete\":false";
    // emit() persists status immediately; count this attempt first so the
    // on-device drawSamples counter is not one sample behind.
    ++drawSamples;
    if(!emit(*selectedRun,"contest-draw",fields.str())){
        --drawSamples;status();
    }
    return result;
}
void installSelectedHooks(Address controller){
    if(selectedHooksAttempted||!controller)return;
    selectedHooksAttempted=true;
    // Actual v3.4.1 MethodInfo pointers from runtime metadata, not old RVAs.
    const auto& api=setup_probe::api();
    if(!api.methodFromName)return;
    Address klass=0;if(!read(controller,0,klass)||!klass)return;
    const auto resolve=[&](const char* name,int count)->Address{
        const void* info=api.methodFromName(reinterpret_cast<void*>(klass),name,count);
        Address target=0;
        return info&&read(reinterpret_cast<Address>(info),0,target)?target:0;
    };
    const Address draw=resolve("DrawCard",3),move=resolve("MovePlayCard",2);
    if(draw)
        drawInstalled=install_hook(draw,reinterpret_cast<void*>(drawCard),
                                   reinterpret_cast<void**>(&originalDraw));
    if(move)
        cardMoveInstalled=install_hook(move,reinterpret_cast<void*>(cardMove),
                                       reinterpret_cast<void**>(&originalCardMove));
}

__attribute__((noinline)) SearchResult result(void* self,const void* method) {
    const Address caller=GAKUMAS_PASSIVE_CALLER_RVA();
    SearchResult r=originalResult(self,method); // exactly once, unchanged sret payload
    if(!active || caller!=0x07EFD634 || !local<uint8_t>(r,0))return r;
    std::lock_guard<std::mutex> guard(mutex);++selectedCalls;
    active->terminal=local<uint8_t>(r,64)!=0;
    if(active->steps>=kStepLimit){++drops;status();return r;}
    ++active->steps;readBudget=8192;firstReadFailure={};readStage.clear();bool ok=true;
    const bool terminal=local<uint8_t>(r,64)!=0;active->terminal=terminal;
    std::ostringstream s;s<<",\"score\":"<<local<int32_t>(r,48)<<",\"vocal\":"<<local<int32_t>(r,52)
      <<",\"dance\":"<<local<int32_t>(r,56)<<",\"visual\":"<<local<int32_t>(r,60)
      <<",\"evaluationScore\":"<<local<int32_t>(r,32)<<",\"selectedPathEnded\":"<<(terminal?"true":"false")
      <<",\"selectedIndexes\":";
    {ReadScope scope("selectedIndexes");s<<integers(local<Address>(r,8),false,256,ok);}
    const unsigned before=active->turnsCaptured;
    unsigned historyCount=0;
    s<<",\"turnsEncoding\":\"delta\",\"turnStartIndex\":"<<before<<",\"turns\":";
    bool turnsArrayShaped=false;
    s<<turnHistory(local<Address>(r,40),active->turnsCaptured,ok,turnsArrayShaped,historyCount);
    s<<",\"selectedPathEvidence\":\"native-ExamSimulateResult-turn-history\""
     <<",\"selectedResultVerified\":"<<(ok?"true":"false")
     <<",\"candidateDfsMutationsAreSelected\":false";
    s<<",\"turnCount\":"<<historyCount
     <<",\"turnsContainerShape\":\""<<(turnsArrayShaped?"array-shaped":"list-or-unknown")<<"\"";
    // Read the selected sequence after this natural selected-result callback.
    // This is a post-search-step observation, NOT a proven end-of-card-effects
    // callback: the DFS may have restored or cloned state by this point.
    s<<",\"naturalGameGetterValues\":"<<gameGetterValuesJson(*active);
    s<<",\"postSelectedState\":{\"capturePhase\":\"after-selected-result-return\","
      <<"\"poolState\":"<<selectedPoolsJson(active->sequence,active->parameter)
      <<",\"metrics\":"<<sampleJson(sampleStatus(active->sequence))
      <<",\"cardEffectsComplete\":false,\"cardUseCompletionVerified\":false}"
      <<",\"dataComplete\":"<<(ok?"true":"false");
    if(!ok){
        ++failures;active->complete=false;
        s<<",\"readFailure\":"<<readFailureJson();
    }
    if(!emit(*active,"contest-progress",s.str())){
        // A dropped event must not silently advance the replay cursor.
        active->turnsCaptured=before;active->complete=false;
    }
    return r;
}
__attribute__((noinline)) void move(void* self,const void* method) {
    Run current;Address machine=reinterpret_cast<Address>(self),owner=0,data=0;int32_t state=0;
    {std::lock_guard<std::mutex> guard(mutex);++moveCalls;readBudget=4096;firstReadFailure={};readStage.clear();
      if(read(machine,0,state)&&read(machine,0x20,owner)&&read(machine,0x28,data)&&owner&&data){
        if(state!=-2){
        auto i=runs.find(machine);
        if(state==-1 || i==runs.end() || i->second.owner!=owner || i->second.data!=data){
          if(nextId<kSessionLimit){
            current=Run{};current.id=++nextId;current.owner=owner;current.data=data;runs[machine]=current;
            bool ok=true;int32_t type=0;uint32_t seed=0;
            const bool values=read(data,0x10,type)&&read(data,0x14,seed);
            std::ostringstream s;s<<",\"examType\":"<<(values?std::to_string(type):"null")<<",\"seed\":"<<(values?std::to_string(seed):"null")
              <<",\"characterId\":"<<stringField(data,0x78,ok)<<",\"idolCardId\":"<<stringField(data,0x88,ok)
              <<",\"settingId\":"<<stringField(data,0x18,ok)<<",\"nativeInitialState\":"<<setup_probe::capture(data)<<",\"dataComplete\":"<<(ok&&values?"true":"false");
            if(!ok||!values){++failures;current.complete=false;runs[machine]=current;}emit(current,"contest-start",s.str());
          }else {++drops;status();}
        }else current=i->second;
        }
      }else {++failures;status();}}
    Run* previous=active;active=current.id?&current:nullptr;
    struct Restore {Run* previous;~Restore(){active=previous;}} restore{previous};
    originalMove(self,method); // callbacks run with no capture mutex held
    if(!current.id)return;
    std::lock_guard<std::mutex> guard(mutex);readBudget=4096;Address ownerAfter=0,dataAfter=0;
    if(!read(machine,0,state)||!read(machine,0x20,ownerAfter)||!read(machine,0x28,dataAfter)||ownerAfter!=owner||dataAfter!=data){
        ++failures;emit(current,"contest-read-failed",",\"reason\":\"state-machine-identity-changed-or-unreadable\"");runs.erase(machine);return;
    }
    if(state==-2){
        int32_t values[4]={};bool ok=bytes(owner,0x20,values,sizeof(values));
        std::ostringstream s;s<<",\"recordingComplete\":"<<(current.terminal?"true":"false")<<",\"dataComplete\":"<<(ok&&current.complete?"true":"false");
        if(ok)s<<",\"score\":"<<values[0]<<",\"vocal\":"<<values[1]<<",\"dance\":"<<values[2]<<",\"visual\":"<<values[3];
        if(!ok)++failures;emit(current,current.terminal?"contest-result":"contest-stopped",s.str());runs.erase(machine);
    }else runs[machine]=current;
}
void install(const ImageInfo& image) {
    if(image.build_id!=kV341BuildId || !hook_enabled(4096) || attempted.exchange(true))return;
    ensure_parent_dir(path("contest_capture.jsonl"));
    // Keep the previous process's recording as a bounded recovery copy.
    std::rename(path("contest_capture.jsonl").c_str(),path("contest_capture.previous.jsonl").c_str());
    std::ofstream(path("contest_capture.jsonl"),std::ios::trunc).close();
    resultInstalled=install_hook(image.base+0x07EFE28C,reinterpret_cast<void*>(result),reinterpret_cast<void**>(&originalResult));
    moveInstalled=install_hook(image.base+0x07EFCFB0,reinterpret_cast<void*>(move),reinterpret_cast<void**>(&originalMove));
    // Exact Build ID + 4096 opt-in. Core contest capture remains operational
    // even if either optional per-card telemetry hook cannot be installed.
    // ROM ExecuteCardCommandImpl (0x080A5BB0) calls this at 0x080A5E9C,
    // 0x080A5F08, 0x080A5FCC and 0x080A6098. Unlike the former
    // AddEffectDifferenceLog hook, this is in the direct card-command path.
    triggerCommandInstalled=install_hook(image.base+0x080A67B8,
        reinterpret_cast<void*>(triggerCommand),
        reinterpret_cast<void**>(&originalTriggerCommand));
    // Relocation-derived native entrypoints for exact Build ID, no app calls added.
    moveCardNativeInstalled=install_hook(image.base+0x82769B0,reinterpret_cast<void*>(moveCardNative),reinterpret_cast<void**>(&originalMoveCardNative));
    recycleNativeInstalled=install_hook(image.base+0x827C978,reinterpret_cast<void*>(recycleNative),reinterpret_cast<void**>(&originalRecycleNative));
    shuffleNativeInstalled=install_hook(image.base+0x827E884,reinterpret_cast<void*>(shuffleNative),reinterpret_cast<void**>(&originalShuffleNative));
    createIdNativeInstalled=install_hook(image.base+0x804A504,reinterpret_cast<void*>(createIdNative),reinterpret_cast<void**>(&originalCreateIdNative));
    createSearchNativeInstalled=install_hook(image.base+0x804AB14,reinterpret_cast<void*>(createSearchNative),reinterpret_cast<void**>(&originalCreateSearchNative));
    cardCommandNativeInstalled=install_hook(image.base+0x80A5BB0,reinterpret_cast<void*>(cardCommandNative),reinterpret_cast<void**>(&originalCardCommandNative));
    commandListFinishInstalled=install_hook(image.base+0x80E0F40,reinterpret_cast<void*>(commandListMoveNext),reinterpret_cast<void**>(&originalCommandListMoveNext));
    // DrawCard/MovePlayCard are installed from live MethodInfo in recordSetup().
    std::lock_guard<std::mutex> guard(mutex);status();
}
} // namespace contest_capture
