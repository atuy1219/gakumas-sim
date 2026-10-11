#include <algorithm>
#include <cmath>
#include <dlfcn.h>
// Selected auto-play results only. No polling, synthetic getters or DFS leaf logs.
namespace contest_capture {
using Address = uintptr_t;
constexpr unsigned kSessionLimit = 64, kStepLimit = 128;
constexpr size_t kFileLimit = 8 * 1024 * 1024;
std::mutex mutex;
struct Run { uint64_t id=0; Address owner=0, data=0; unsigned steps=0, turnsCaptured=0; bool terminal=false, complete=true, setupRecorded=false; };
std::map<Address, Run> runs;
uint64_t nextId=0, moveCalls=0, selectedCalls=0, written=0, failures=0, writeFailures=0, drops=0;
size_t fileBytes=0;
bool moveInstalled=false, resultInstalled=false;
std::atomic<bool> attempted{false};
thread_local Run* active=nullptr;
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
std::string liveCard(Address a,bool& ok) {
    if(!a)return "null";
    Address data=0;int32_t base=0,tmp=0;
    if(!read(a,0x10,data) || !read(a,0x24,base) || !read(a,0x28,tmp)){ok=false;return "null";}
    return "{\"id\":"+stringField(data,0x18,ok)+",\"guid\":"+stringField(a,0x18,ok)+
        ",\"baseUpgradeCount\":"+std::to_string(base)+",\"temporaryUpgradeCount\":"+std::to_string(tmp)+"}";
}
std::string command(Address a,bool& ok) {
    if(!a){ok=false;return "null";}
    int32_t turn=0,phase=0;Address select=0,card=0,item=0,drink=0,cmd=0;uint8_t cost=0,selectLog=0;
    if(!read(a,0x10,turn)||!read(a,0x18,select)||!read(a,0x20,selectLog)||!read(a,0x28,card)||
       !read(a,0x30,item)||!read(a,0x38,drink)||!read(a,0x40,cmd)||!read(a,0x48,phase)||!read(a,0x4c,cost)){
        ok=false;return "null";
    }
    std::ostringstream s;s<<"{\"turn\":"<<turn<<",\"phase\":"<<phase<<",\"selectIndexes\":"<<integers(select,false,64,ok)
      <<",\"isSelectLog\":"<<(selectLog?"true":"false")<<",\"costFailed\":"<<(cost?"true":"false")
      <<",\"card\":"<<liveCard(card,ok)<<",\"itemId\":"<<(item?stringField(item,0x10,ok):"null")
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
struct API {
    GetFields getFields=nullptr;FieldName fieldName=nullptr;FieldOffset fieldOffset=nullptr;
    FieldType fieldType=nullptr;TypeKind typeKind=nullptr;ClassName className=nullptr;
    ClassFromType classFromType=nullptr;ElementClass elementClass=nullptr;ValueType valueType=nullptr;ValueSize valueSize=nullptr;ClassParent classParent=nullptr;InstanceSize instanceSize=nullptr;
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
        if(nestedCardMaster&&!idField)continue;
        if(!internalValueWrapper&&!wanted(fieldName,depth))continue;
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

void status() {
    std::ostringstream s;s<<"{\"schemaVersion\":2,\"pid\":"<<getpid()<<",\"hookMask\":"<<g_hook_mask.load()
      <<",\"moveNextInstalled\":"<<(moveInstalled?"true":"false")<<",\"searchResultInstalled\":"<<(resultInstalled?"true":"false")
      <<",\"moveCalls\":"<<moveCalls<<",\"selectedResultCalls\":"<<selectedCalls<<",\"sessions\":"<<nextId
      <<",\"recordsWritten\":"<<written<<",\"incompleteReads\":"<<failures<<",\"writeFailures\":"<<writeFailures
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
struct BeforeSetup { uint32_t randomState=0; bool available=false; };
BeforeSetup observeBeforeSetup(Address sequence){
    if(!active || !sequence)return {};
    readBudget=16;firstReadFailure={};readStage.clear();
    Address parameter=0;uint32_t randomState=0;
    if(!read(sequence,0x10,parameter) || !parameter || !read(parameter,0x77c,randomState))return {};
    return {randomState,true};
}
// Verified SetUpExam caller (0x07EFD3B4) executes within the original
// selected contest-auto MoveNext. Capture its real managed parameter/pools
// without invoking any managed getter or changing the game RNG.
void recordSetup(Address sequence,BeforeSetup before) {
    if(!active || active->setupRecorded || !sequence)return;
    std::lock_guard<std::mutex> guard(mutex);
    if(!active || active->setupRecorded)return;
    active->setupRecorded=true;
    readBudget=8192;firstReadFailure={};readStage.clear();
    Address parameter=0;
    bool hasParameter=read(sequence,0x10,parameter)&&parameter;
    uint32_t randomState=0;
    const bool randomRead=hasParameter && read(parameter,0x77c,randomState);
    std::ostringstream content;
    content<<",\"capturePhase\":\"after-ExamSequence.SetUpExam\",\"setupOrigin\":\"0x07EFD3B4\""
           <<",\"randomStateBeforeSetUp\":"<<(before.available?std::to_string(before.randomState):"null")
           <<",\"beforeRandomSource\":\"verified-caller-before-managed-setup\""
           <<",\"randomStateObserved\":"<<(randomRead?std::to_string(randomState):"null")
           <<",\"randomStateProvenance\":\"after-setup-not-necessarily-pre-shuffle\""
           <<",\"examParameterSnapshot\":"<<(hasParameter?setup_probe::capture(parameter):"null")
           <<",\"examSequenceSnapshot\":"<<setup_probe::capture(sequence)
           <<",\"dataComplete\":true";
    emit(*active,"contest-setup",content.str());
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
    s<<",\"turnCount\":"<<historyCount
     <<",\"turnsContainerShape\":\""<<(turnsArrayShaped?"array-shaped":"list-or-unknown")<<"\"";
    s<<",\"dataComplete\":"<<(ok?"true":"false");
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
            current={++nextId,owner,data,0,false};runs[machine]=current;
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
    std::lock_guard<std::mutex> guard(mutex);status();
}
} // namespace contest_capture
