// Passive readback of game-owned saved/display log models, pinned to v3.4.1.
// No replay, simulation, RNG, getters or save methods are invoked by this probe.
namespace detail_log_capture {
using namespace contest_capture;
std::mutex detailMutex;
std::atomic<bool> detailAttempted{false};
bool loadInstalled=false,competitionInstalled=false,overlayInstalled=false;
uint64_t callbacks=0,records=0,incomplete=0,errors=0,omitted=0,duplicates=0;
size_t storedBytes=0;
std::string lastPayload;
constexpr size_t maxRecord=8*1024*1024,maxFile=32*1024*1024;
std::string className(Address a){
    Address klass=0;const auto& api=setup_probe::api();
    if(!a||!api.className||!read(a,0,klass)||!klass)return {};
    const char* name=api.className(reinterpret_cast<void*>(klass));
    return name?name:"";
}
bool typed(Address a,const char* expected,bool& ok){
    if(className(a)==expected)return true;
    ok=false;noteReadFailure("unexpected-detail-log-type",a,0,8);return false;
}
// Lists may exceed readv's per-read byte bound. Validate count/version twice
// and copy at most 4096 bytes per read. Arrays have their own checked layout.
template<class T> bool collection(Address a,unsigned cap,std::vector<T>& out,unsigned depth=0){
    out.clear();if(!a)return true;
    const auto name=className(a);
    if(name=="ReadOnlyCollection`1"&&depth<2){
        Address inner=0;return namedRef(a,{"list","_list"},inner)&&collection(inner,cap,out,depth+1);
    }
    Address backing=a;int32_t count=0,version=0;uint64_t capacity=0;
    const bool isList=name=="List`1";
    if(isList){
        if(!read(a,0x10,backing)||!read(a,0x18,count)||!read(a,0x1c,version)||count<0)return false;
        if(unsigned(count)>cap)return false;
        if(!count)return true;
        if(!read(backing,0x18,capacity)||capacity<unsigned(count))return false;
    }else{
        if(name.size()<2||name.substr(name.size()-2)!="[]"||!read(a,0x18,capacity)||capacity>cap)return false;
        count=static_cast<int32_t>(capacity);
    }
    out.resize(count);
    for(size_t pos=0;pos<out.size();){
        const size_t n=std::min(out.size()-pos,size_t(4096/sizeof(T)));
        if(!bytes(backing,0x20+pos*sizeof(T),out.data()+pos,n*sizeof(T)))return false;
        pos+=n;
    }
    if(isList){
        Address again=0;int32_t after=0,v=0;
        if(!read(a,0x10,again)||!read(a,0x18,after)||!read(a,0x1c,v)||again!=backing||after!=count||v!=version)return false;
    }else {uint64_t again=0;if(!read(a,0x18,again)||again!=capacity)return false;}
    return true;
}
std::string refStrings(Address a,bool& ok){
    std::vector<Address> values;if(!collection(a,512,values)){ok=false;return "null";}
    return serializeObjects(values,string,ok);
}
std::string refInts(Address a,bool& ok){
    std::vector<int32_t> values;if(!collection(a,512,values)){ok=false;return "null";}
    std::ostringstream s;s<<'[';for(size_t i=0;i<values.size();++i){if(i)s<<',';s<<values[i];}s<<']';return s.str();
}
std::string refAt(Address a,size_t off,bool& ok){Address v=0;if(!read(a,off,v)){ok=false;return "null";}return refStrings(v,ok);}
std::string intsAt(Address a,size_t off,bool& ok){Address v=0;if(!read(a,off,v)){ok=false;return "null";}return refInts(v,ok);}
using Encode=std::string(*)(Address,bool&);
std::string objectsAt(Address a,size_t off,unsigned cap,Encode encode,bool& ok){
    Address v=0;std::vector<Address> items;
    if(!read(a,off,v)||!collection(v,cap,items)){ok=false;return "null";}
    return serializeObjects(items,encode,ok);
}
std::string customize(Address a,bool& ok){
    if(!typed(a,"ExamUserPlayLogCardCustomizeListData",ok))return "null";
    return intsAt(a,0x10,ok);
}
std::string detailLine(Address a,bool& ok){
    if(!typed(a,"ExamPlayLogDetailLineModel",ok))return "null";
    int32_t type=0,before=0,after=0,before2=0,after2=0,sub=0,from=0,to=0,effect=0;
    if(!read(a,0x10,type)||!read(a,0x14,before)||!read(a,0x18,after)||
       !read(a,0x1c,before2)||!read(a,0x20,after2)||!read(a,0x30,sub)||
       !read(a,0x34,from)||!read(a,0x38,to)||!read(a,0x3c,effect))ok=false;
    std::ostringstream s;s<<"{\"lineType\":"<<type<<",\"before\":"<<before<<",\"after\":"<<after
      <<",\"delta\":"<<(int64_t(after)-before)<<",\"before2\":"<<before2<<",\"after2\":"<<after2
      <<",\"targetId\":"<<stringField(a,0x28,ok)<<",\"targetSubscriptionNumber\":"<<sub
      <<",\"cardFromPosition\":"<<from<<",\"targetMovePosition\":"<<to<<",\"effectType\":"<<effect
      <<",\"message\":"<<stringField(a,0x48,ok)<<",\"beforeIdList\":"<<refAt(a,0x50,ok)
      <<",\"afterIdList\":"<<refAt(a,0x58,ok)<<"}";return s.str();
}
std::string detail(Address a,bool& ok){
    if(!typed(a,"ExamUserPlayLogDetailModel",ok))return "null";
    int32_t type=0,trigger=0,number=0,divideType=0,uid=0,divideNumber=0;uint8_t divided=0;
    if(!read(a,0x10,type)||!read(a,0x20,trigger)||!read(a,0x30,number)||!read(a,0x48,divided)||
       !read(a,0x4c,divideType)||!read(a,0x58,uid)||!read(a,0x5c,divideNumber)||divided>1)ok=false;
    std::ostringstream s;s<<"{\"detailType\":"<<type<<",\"triggerType\":"<<trigger
      <<",\"triggerId\":"<<stringField(a,0x28,ok)<<",\"triggerNumber\":"<<number
      <<",\"triggerSupportIds\":"<<refAt(a,0x40,ok)<<",\"isDivideDetail\":"<<(divided?"true":"false")
      <<",\"divideCellType\":"<<divideType<<",\"divideTriggerId\":"<<stringField(a,0x50,ok)
      <<",\"divideTriggerUid\":"<<uid<<",\"divideTriggerNumber\":"<<divideNumber
      <<",\"divideTriggerOwnerId\":"<<stringField(a,0x60,ok)
      <<",\"lines\":"<<objectsAt(a,0x18,1024,detailLine,ok)<<"}";return s.str();
}
std::string item(Address a,bool& ok){
    if(!typed(a,"ExamUserPlayLogItemModel",ok))return "null";
    int32_t type=0,turn=0,limit=0,extra=0,bonus=0,sub=0,uid=0;uint8_t boolean=0;
    if(!read(a,0x10,type)||!read(a,0x20,turn)||!read(a,0x24,limit)||!read(a,0x28,extra)||
       !read(a,0x38,bonus)||!read(a,0x48,sub)||!read(a,0x58,boolean)||!read(a,0x68,uid)||boolean>1)ok=false;
    std::ostringstream s;s<<"{\"cellType\":"<<type<<",\"turn\":"<<turn<<",\"limitTurn\":"<<limit
      <<",\"extraTurn\":"<<extra<<",\"turnTypeList\":"<<intsAt(a,0x30,ok)<<",\"bonusPermil\":"<<bonus
      <<",\"triggerId\":"<<stringField(a,0x40,ok)<<",\"triggerSubscriptionNumber\":"<<sub
      <<",\"triggerSubscriptionNumberList\":"<<intsAt(a,0x50,ok)
      <<",\"triggerSubscriptionBoolean\":"<<(boolean?"true":"false")
      <<",\"triggerOwnerId\":"<<stringField(a,0x60,ok)<<",\"triggerUid\":"<<uid
      <<",\"playCardIds\":"<<refAt(a,0x78,ok)<<",\"playCardUpgrades\":"<<intsAt(a,0x80,ok)
      <<",\"playCardCustomizes\":"<<objectsAt(a,0x88,128,customize,ok)
      <<",\"drawCardIds\":"<<refAt(a,0x98,ok)<<",\"drawCardUpgrades\":"<<intsAt(a,0xa0,ok)
      <<",\"drawCardCustomizes\":"<<objectsAt(a,0xa8,128,customize,ok)
      <<",\"details\":"<<objectsAt(a,0x18,1024,detail,ok)<<"}";return s.str();
}
void status(){
    std::ofstream f(path("detail_log_capture_status.json"),std::ios::trunc);
    f<<"{\"schemaVersion\":1,\"pid\":"<<getpid()<<",\"loadInstalled\":"<<(loadInstalled?"true":"false")
     <<",\"competitionInstalled\":"<<(competitionInstalled?"true":"false")<<",\"overlayInstalled\":"<<(overlayInstalled?"true":"false")
     <<",\"callbacks\":"<<callbacks<<",\"records\":"<<records<<",\"incomplete\":"<<incomplete
     <<",\"writeFailures\":"<<errors<<",\"limitDrops\":"<<omitted<<",\"duplicatesSuppressed\":"<<duplicates<<"}";
}
void capture(Address list,const char* source,Address label=0,Address character=0,int isOwn=-1){
    if(!hook_enabled(8192))return;
    std::lock_guard<std::mutex> lock(detailMutex);++callbacks;
    readBudget=200000;firstReadFailure={};readStage.clear();bool ok=true;
    std::vector<Address> models;
    if(!list||!collection(list,4096,models)){ok=false;noteReadFailure("unsupported-detail-log-list",list,0,8);}
    const auto payload=serializeObjects(models,item,ok);
    const auto labelJson=string(label,ok),characterJson=string(character,ok);
    const std::string key=std::string(source)+labelJson+characterJson+std::to_string(isOwn)+payload;
    if(ok&&key==lastPayload){++duplicates;status();return;}
    std::ostringstream s;s<<"{\"schemaVersion\":1,\"pid\":"<<getpid()<<",\"observedAtUnixMs\":"<<unix_time_ms()
      <<",\"source\":\""<<source<<"\",\"libil2cppBuildId\":\""<<kV341BuildId
      <<"\",\"dataComplete\":"<<(ok?"true":"false")<<",\"additionalGameCalls\":false"
      <<",\"label\":"<<labelJson<<",\"characterId\":"<<characterJson
      <<",\"isOwn\":"<<(isOwn<0?"null":isOwn?"true":"false")
      <<",\"itemCount\":"<<models.size()<<",\"items\":"<<payload;
    if(!ok){++incomplete;s<<",\"readFailure\":"<<readFailureJson();}s<<"}\n";
    const auto text=s.str();
    if(text.size()>maxRecord||storedBytes+text.size()>maxFile){++omitted;status();return;}
    std::ofstream file(path("detail_log_capture.jsonl"),std::ios::app);file<<text;file.flush();
    if(!file.good())++errors;else {++records;storedBytes+=text.size();if(ok)lastPayload=key;}
    status();
}
// LoadAll is STATIC: x0 is label, result x0 is the restored log list.
using LoadFn=uintptr_t(*)(uintptr_t,uintptr_t);
LoadFn originalLoad=nullptr;
__attribute__((noinline)) uintptr_t load(uintptr_t label,uintptr_t method){
    const auto result=originalLoad(label,method);capture(result,"saved-log-LoadAll",label);return result;
}
using CompetitionFn=void(*)(uintptr_t,uintptr_t,uintptr_t,uint32_t,uintptr_t,uintptr_t);
CompetitionFn originalCompetition=nullptr;
__attribute__((noinline)) void competition(uintptr_t self,uintptr_t logs,uintptr_t idols,uint32_t own,uintptr_t skins,uintptr_t method){
    originalCompetition(self,logs,idols,own,skins,method);
    capture(logs,"competition-detail-screen",0,0,own?1:0);
}
using OverlayFn=void(*)(uintptr_t,uintptr_t,uintptr_t,uint32_t,uintptr_t,uintptr_t);
OverlayFn originalOverlay=nullptr;
__attribute__((noinline)) void overlay(uintptr_t self,uintptr_t logs,uintptr_t character,uint32_t battle,uintptr_t skins,uintptr_t method){
    originalOverlay(self,logs,character,battle,skins,method);
    capture(logs,"detail-log-overlay",0,character);
}
void install(const ImageInfo& image){
    if(image.build_id!=kV341BuildId||!hook_enabled(8192)||detailAttempted.exchange(true))return;
    ensure_parent_dir(path("detail_log_capture.jsonl"));
    std::rename(path("detail_log_capture.jsonl").c_str(),path("detail_log_capture.previous.jsonl").c_str());
    std::ofstream(path("detail_log_capture.jsonl"),std::ios::trunc).close();
    loadInstalled=install_hook(image.base+0x8137ecc,reinterpret_cast<void*>(load),reinterpret_cast<void**>(&originalLoad));
    competitionInstalled=install_hook(image.base+0x82440d8,reinterpret_cast<void*>(competition),reinterpret_cast<void**>(&originalCompetition));
    overlayInstalled=install_hook(image.base+0x824708c,reinterpret_cast<void*>(overlay),reinterpret_cast<void**>(&originalOverlay));
    status();
}
} // namespace detail_log_capture
