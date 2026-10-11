// Selected auto-play results only. No polling, synthetic getters or DFS leaf logs.
namespace contest_capture {
using Address = uintptr_t;
constexpr unsigned kSessionLimit = 64, kStepLimit = 128;
constexpr size_t kFileLimit = 8 * 1024 * 1024;
std::mutex mutex;
struct Run { uint64_t id=0; Address owner=0, data=0; unsigned steps=0, turnsCaptured=0; bool terminal=false, complete=true; };
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
              <<",\"settingId\":"<<stringField(data,0x18,ok)<<",\"dataComplete\":"<<(ok&&values?"true":"false");
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
