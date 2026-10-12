// Exact ELF 77fda4e2... v3.4.1. The selected result's ExamSaveData is the
// lineage anchor; matching card GUIDs alone cannot select a DFS branch.
bool obscuredInt(Address parameter,size_t offset,int32_t& value){
    uint8_t present=0;uint32_t seed=0,encoded=0;
    if(!read(parameter,offset,present)||present>1)return false;
    if(!present){value=0;return true;}
    if(!read(parameter,offset+4,seed)||!read(parameter,offset+0x18,encoded))return false;
    // Obscured.get_Value 0x809f438 -> RandomFlipper.Flip 0x809f80c.
    // ARM W-register arithmetic wraps at 32 bits. The same XOR decodes/encodes.
    uint32_t mask=(seed*uint32_t(0x85ebca77))^(seed*uint32_t(0x794ee000));
    mask^=mask>>17;
    const uint32_t decoded=encoded^mask^(mask<<5);
    std::memcpy(&value,&decoded,sizeof(value));return true;
}
Address sequenceForContext(Address context){
    if(!active||!active->trace)return 0;
    const auto identity=inspectContext(context);if(!identity.verified)return 0;
    for(const auto& row:active->trace->sequences)
        if(row.second.parameter==identity.parameter&&row.second.controller==identity.controller)return row.first;
    return 0;
}
void bindTraceSequence(Address sequence){
    if(!active||!active->trace)return;
    auto it=active->trace->sequences.find(sequence);
    if(it==active->trace->sequences.end())return;
    readBudget=64;firstReadFailure={};readStage.clear();
    namedRef(sequence,{"<Parameter>k__BackingField"},it->second.parameter);
    namedRef(sequence,{"<CardController>k__BackingField"},it->second.controller);
}
std::string traceMetrics(Address sequence){
    Address parameter=0;int32_t v[6]={};
    bool ok=namedRef(sequence,{"<Parameter>k__BackingField"},parameter)&&parameter;
    const size_t offsets[]={0x570,0x58c,0x5a8,0x1cc,0x248,0x144};
    for(unsigned i=0;i<6;++i)if(!obscuredInt(parameter,offsets[i],v[i]))ok=false;
    const auto status=sampleStatus(sequence);
    std::ostringstream s;
    s<<"{\"source\":\"ELF-verified-Obscured-int-XOR-decode\",\"available\":"<<(ok?"true":"false")
     <<",\"getterBytecodeVerified\":true,\"additionalGameCalls\":false"
     <<",\"score\":"<<(ok?std::to_string(int64_t(v[0])+v[1]+v[2]):"null")
     <<",\"scoreVocal\":"<<(ok?std::to_string(v[0]):"null")
     <<",\"scoreDance\":"<<(ok?std::to_string(v[1]):"null")
     <<",\"scoreVisual\":"<<(ok?std::to_string(v[2]):"null")
     <<",\"stamina\":"<<(ok?std::to_string(v[3]):"null")
     <<",\"block\":"<<(ok?std::to_string(v[4]):"null")
     <<",\"turn\":"<<(ok?std::to_string(v[5]):"null")
     <<",\"statusListComplete\":"<<(status.listComplete?"true":"false")
     <<",\"statusEffects\":"<<statusesJson(status.statuses)
     <<",\"parameterStatusFields\":"<<parameterFieldsJson(status.parameterFields)<<"}";
    return s.str();
}
void traceAppend(Address sequence,const char* event,const std::string& fields){
    if(!active||!active->trace||!sequence)return;
    if(!active->trace->append(sequence,event,fields))++lineageDrops;
}
void traceBeginCard(Address sequence,Address card){
    if(!active||!active->trace||!card)return;
    auto it=active->trace->sequences.find(sequence);
    if(it==active->trace->sequences.end())return;
    std::lock_guard<std::mutex> guard(mutex);
    readBudget=2048;firstReadFailure={};readStage.clear();
    bool ok=true;const auto info=liveCard(card,ok);
    if(!ok||info=="null"){it->second.complete=false;return;}
    if(it->second.pendingCards.empty())it->second.beforeCardMetrics=
        it->second.nextCardBefore!="null"?it->second.nextCardBefore:traceMetrics(sequence);
    it->second.nextCardBefore="null";it->second.nextCardCommand=0;
    ++it->second.serial;
    it->second.pendingCards.push_back(info);
    traceAppend(sequence,"contest-card-use-start",",\"cardActionSerial\":"+
        std::to_string(it->second.serial)+",\"card\":"+info+
        ",\"metrics\":"+traceMetrics(sequence)+",\"cardEffectsComplete\":false");
}
// A terminal MoveNext can be success OR SetException. Observe the latter's
// actual call on the exact builder (+8), without invoking any game method.
struct CommandFinishFrame {
    Address builder=0;bool exception=false;CommandFinishFrame* previous=nullptr;
    Address sequence=0,runner=0;bool recorded=false,eligible=false;
};
thread_local CommandFinishFrame* currentCommandFinish=nullptr;
using BuilderExceptionFn=void(*)(uintptr_t,uintptr_t,uintptr_t);
BuilderExceptionFn originalBuilderException=nullptr;
__attribute__((noinline)) void builderException(uintptr_t builder,uintptr_t exception,uintptr_t method){
    for(auto* frame=currentCommandFinish;frame;frame=frame->previous)
        if(frame->builder==builder)frame->exception=true;
    originalBuilderException(builder,exception,method);
}
// The ELF's initial MoveNext returns -2 immediately when IsCommandPlaying is
// already true (0x80e1100..0x80e119c). That is a reentrant no-op, not completion.
// Resolve the actual AwaitableProperty<bool> backing field through metadata.
bool commandPlaying(Address sequence,bool& playing){
    Address property=0,klass=0;
    if(!namedRef(sequence,{"_isCommandPlaying"},property)||!property||
       !read(property,0,klass)||!klass)return false;
    const auto& api=setup_probe::api();
    if(!api.getFields||!api.fieldName||!api.fieldType||!api.typeKind||!api.fieldOffset)return false;
    for(void* cls=reinterpret_cast<void*>(klass);cls;cls=api.classParent?api.classParent(cls):nullptr){
        void* iterator=nullptr;
        for(unsigned n=0;n<128;++n){
            void* field=api.getFields(cls,&iterator);if(!field)break;
            const char* name=api.fieldName(field);
            if(!name||std::strcmp(name,"_value")!=0)continue;
            const int kind=api.typeKind(api.fieldType(field));
            // Inflated generic field metadata may retain IL2CPP_TYPE_VAR;
            // the exact _isCommandPlaying property is AwaitableProperty<bool>.
            if(kind!=0x02&&kind!=0x13)continue;
            const size_t offset=api.fieldOffset(field);uint8_t value=0;
            if(offset<0x10||offset>0x400||!read(property,offset,value)||value>1)return false;
            playing=value!=0;return true;
        }
    }
    return false;
}
void traceCommandCompletion(Address sequence,bool success){
    if(!active||!active->trace)return;
    auto it=active->trace->sequences.find(sequence);
    if(it==active->trace->sequences.end())return;
    std::lock_guard<std::mutex> guard(mutex);
    auto& branch=it->second;
    ++commandCompletions;
    if(branch.pendingCards.empty()){
        if(success){++emptyCommandCompletionsSuppressed;return;}
        branch.complete=false;
        traceAppend(sequence,"contest-command-list-failed",
            ",\"completionSuccessVerified\":false,\"reason\":\"command-list-exception-without-card\"");
        return;
    }
    readBudget=4096;firstReadFailure={};readStage.clear();
    Address parameter=0;namedRef(sequence,{"<Parameter>k__BackingField"},parameter);
    std::ostringstream s;
    s<<",\"capturePhase\":\"after-ExecuteCommandListImplAsync-success\""
     <<",\"completionBoundaryVerified\":true"
     <<",\"commandListCompleted\":true,\"completionSuccessVerified\":"<<(success?"true":"false")
     <<",\"cardActionSerial\":"<<branch.serial
     <<",\"cardUseCompletionVerified\":"<<(success&&!branch.pendingCards.empty()?"true":"false")
     <<",\"cardEffectsComplete\":"<<(success&&!branch.pendingCards.empty()?"true":"false")
     <<",\"singleCardAction\":"<<(branch.pendingCards.size()==1?"true":"false")
     <<",\"card\":"<<(branch.pendingCards.size()==1?branch.pendingCards.front():"null")
     <<",\"cardsExecuted\":[";
    for(size_t i=0;i<branch.pendingCards.size();++i){if(i)s<<',';s<<branch.pendingCards[i];}
    s<<"],\"beforeMetrics\":"<<branch.beforeCardMetrics
     <<",\"metrics\":"<<traceMetrics(sequence)
     <<",\"poolState\":"<<selectedPoolsJson(sequence,parameter);
    traceAppend(sequence,"contest-card-use-complete",s.str());
    if(!success)branch.complete=false;
    branch.pendingCards.clear();branch.beforeCardMetrics="null";
}
// For suspended UniTasks, SetResult resumes the awaiting parent immediately.
// Snapshot BEFORE forwarding SetResult, otherwise selection may already have
// returned and disposed the clone when MoveNext's wrapper regains control.
using RunnerResultFn=void(*)(uintptr_t,uintptr_t);
std::map<Address,RunnerResultFn> runnerResultOriginals;
std::map<Address,RunnerResultFn> runnerClassOriginals;
void observeRunnerResult(uintptr_t self,uintptr_t method,RunnerResultFn original){
    for(auto* frame=currentCommandFinish;frame;frame=frame->previous){
        if(frame->runner==self&&!frame->recorded&&frame->eligible){
            frame->recorded=true;
            traceCommandCompletion(frame->sequence,true);
            break;
        }
    }
    original(self,method);
}
// Each code address has its own trampoline slot. Shared generic code may be
// called by unregistered runner classes: those calls must still forward once.
RunnerResultFn runnerSlotOriginals[16]={};
template<unsigned Slot> __attribute__((noinline)) void runnerResultSlot(uintptr_t self,uintptr_t method){
    observeRunnerResult(self,method,runnerSlotOriginals[Slot]);
}
constexpr RunnerResultFn runnerSlots[]={
    runnerResultSlot<0>,runnerResultSlot<1>,runnerResultSlot<2>,runnerResultSlot<3>,
    runnerResultSlot<4>,runnerResultSlot<5>,runnerResultSlot<6>,runnerResultSlot<7>,
    runnerResultSlot<8>,runnerResultSlot<9>,runnerResultSlot<10>,runnerResultSlot<11>,
    runnerResultSlot<12>,runnerResultSlot<13>,runnerResultSlot<14>,runnerResultSlot<15>};
unsigned runnerSlotCount=0;
// Host fixture entrypoint; native detours use the per-code slots above.
void runnerResult(uintptr_t self,uintptr_t method){
    readBudget=16;Address klass=0;read(self,0,klass);
    const auto found=runnerClassOriginals.find(klass);
    if(found!=runnerClassOriginals.end())observeRunnerResult(self,method,found->second);
}
void installRunnerResult(Address runner){
    if(!runner)return;
    readBudget=32;Address klass=0;read(runner,0,klass);
    if(!klass||runnerClassOriginals.count(klass))return;
    const auto& api=setup_probe::api();if(!api.methodFromName)return;
    const auto* info=api.methodFromName(reinterpret_cast<void*>(klass),"SetResult",0);
    Address code=0;if(!info||!read(reinterpret_cast<Address>(info),0,code)||!code)return;
    auto it=runnerResultOriginals.find(code);
    RunnerResultFn original=nullptr;
    if(it!=runnerResultOriginals.end())original=it->second;
    else if(runnerSlotCount<16){
        const unsigned slot=runnerSlotCount;
        if(install_hook(code,reinterpret_cast<void*>(runnerSlots[slot]),
                        reinterpret_cast<void**>(&runnerSlotOriginals[slot]))){
            original=runnerSlotOriginals[slot];runnerResultOriginals[code]=original;++runnerSlotCount;
        }
    }
    if(original)runnerClassOriginals[klass]=original;
}
// UseHand/UsePool consume the cost BEFORE ExecuteCardCommandImpl. Capture
// the state-machine's command entry, not the later command-builder boundary.
// ELF 0x80a78b0 stores command at +0x18 and owner at +0x20; MoveNext
// 0x80d91d8 uses those exact fields (0x80d9788 etc.).
using CommandExecutionFn=void(*)(uintptr_t,uintptr_t);
CommandExecutionFn originalCommandExecution=nullptr;
__attribute__((noinline)) void commandExecution(uintptr_t stateMachine,uintptr_t method){
    Address sequence=0,command=0;int32_t state=0,type=0;
    readBudget=64;firstReadFailure={};readStage.clear();
    if(active&&active->trace&&read(stateMachine,0,state)&&state==-1&&
       read(stateMachine,0x18,command)&&read(stateMachine,0x20,sequence)&&
       command&&read(command,0x10,type)&&(type==2||type==4)){
        auto it=active->trace->sequences.find(sequence);
        if(it!=active->trace->sequences.end()){
            readBudget=2048;
            it->second.nextCardBefore=traceMetrics(sequence);
            it->second.nextCardCommand=command;
        }
    }
    originalCommandExecution(stateMachine,method);
    if(active&&active->trace&&sequence){
        auto it=active->trace->sequences.find(sequence);
        readBudget=16;
        if(it!=active->trace->sequences.end()&&it->second.nextCardCommand==command&&
           read(stateMachine,0,state)&&state==-2){
            it->second.nextCardBefore="null";it->second.nextCardCommand=0;
        }
    }
}
using CopySequenceFn=uintptr_t(*)(uintptr_t,uintptr_t,uintptr_t,uintptr_t);
using SyncSequenceFn=void(*)(uintptr_t,uintptr_t,uintptr_t);
using SaveSequenceFn=void(*)(uintptr_t,uintptr_t,uint32_t,uintptr_t);
using DisposeSequenceFn=void(*)(uintptr_t,uintptr_t);
CopySequenceFn originalCopySequence=nullptr;
SyncSequenceFn originalSyncSequence=nullptr,originalLoadSequence=nullptr;
SaveSequenceFn originalSaveSequence=nullptr,originalSaveConstructor=nullptr;
DisposeSequenceFn originalEmptySave=nullptr;
DisposeSequenceFn originalDisposeSequence=nullptr;
__attribute__((noinline)) uintptr_t copySequence(uintptr_t self,uintptr_t handler,uintptr_t logger,uintptr_t method){
    const auto result=originalCopySequence(self,handler,logger,method);
    if(active&&active->trace&&result){++cloneCalls;active->trace->copy(result,self);bindTraceSequence(result);}
    return result;
}
__attribute__((noinline)) void syncSequence(uintptr_t self,uintptr_t source,uintptr_t method){
    originalSyncSequence(self,source,method);
    if(active&&active->trace){active->trace->copy(self,source);bindTraceSequence(self);}
}
__attribute__((noinline)) void loadSequence(uintptr_t self,uintptr_t save,uintptr_t method){
    originalLoadSequence(self,save,method);
    if(active&&active->trace){
        ++loadCalls;active->trace->load(self,save);bindTraceSequence(self);
        if(self==active->sequence){
            readBudget=64;firstReadFailure={};readStage.clear();
            namedRef(self,{"<Parameter>k__BackingField"},active->parameter);
            namedRef(self,{"<CardController>k__BackingField"},active->controller);
        }
    }
}
__attribute__((noinline)) void saveSequence(uintptr_t self,uintptr_t sequence,uint32_t small,uintptr_t method){
    originalSaveSequence(self,sequence,small,method);
    if(active&&active->trace)active->trace->save(self,sequence);
}
__attribute__((noinline)) void saveConstructor(uintptr_t self,uintptr_t sequence,uint32_t small,uintptr_t method){
    originalSaveConstructor(self,sequence,small,method);
    if(active&&active->trace)active->trace->save(self,sequence);
}
__attribute__((noinline)) void emptySave(uintptr_t self,uintptr_t method){
    originalEmptySave(self,method);
    if(active&&active->trace)active->trace->saves.erase(self);
}
__attribute__((noinline)) void disposeSequence(uintptr_t self,uintptr_t method){
    originalDisposeSequence(self,method);
    if(active&&active->trace)active->trace->sequences.erase(self);
}
void publishSelectedTrace(Run& run,Address save){
    if(!run.trace)return;
    auto it=run.trace->saves.find(save);
    if(it==run.trace->saves.end()){
        ++lineageMissingSaves;
        emit(run,"contest-lineage-unavailable",",\"reason\":\"selected-save-not-captured\"");return;
    }
    ++lineageSelectedSaves;
    const bool complete=it->second.complete&&!run.trace->overflow;
    for(const auto& node:run.trace->selected(save)){
        // Selection is proven by native copy/save identity, not by card GUID.
        auto payload=node->fields;
        const std::string marker=",\"selectedRehearsalPathVerified\":false";
        const auto at=payload.find(marker);
        if(at!=std::string::npos)payload.erase(at,marker.size());
        const auto fields=payload+
            ",\"selectedLineageVerified\":true,\"selectedRehearsalPathVerified\":true"
            ",\"lineageComplete\":"+(complete?std::string("true"):std::string("false"))+
            ",\"observedDuringDfs\":true,\"selectionSource\":\"ExamSimulateResult.ExamSaveData\"";
        if(emit(run,node->event.c_str(),fields)){
            run.trace->published.insert(node->id);++lineageSelectedEvents;
        }
    }
    // Retain only the exact selected checkpoint. This bounds memory and prevents
    // address reuse across searches from inheriting a rejected sibling's trace.
    run.trace->checkpoint(save,run.sequence);bindTraceSequence(run.sequence);
}
void installLineageHooks(const ImageInfo& image){
    const auto install=[&](Address rva,void* hook,void** original){return install_hook(image.base+rva,hook,original);};
    const bool copy=install(0x80afee0,reinterpret_cast<void*>(copySequence),reinterpret_cast<void**>(&originalCopySequence));
    const bool sync=install(0x80b04b0,reinterpret_cast<void*>(syncSequence),reinterpret_cast<void**>(&originalSyncSequence));
    const bool load=install(0x80a3b34,reinterpret_cast<void*>(loadSequence),reinterpret_cast<void**>(&originalLoadSequence));
    const bool save=install(0x809c4fc,reinterpret_cast<void*>(saveSequence),reinterpret_cast<void**>(&originalSaveSequence));
    const bool ctor=install(0x809b760,reinterpret_cast<void*>(saveConstructor),reinterpret_cast<void**>(&originalSaveConstructor));
    const bool empty=install(0x809b718,reinterpret_cast<void*>(emptySave),reinterpret_cast<void**>(&originalEmptySave));
    const bool dispose=install(0x80b0dc0,reinterpret_cast<void*>(disposeSequence),reinterpret_cast<void**>(&originalDisposeSequence));
    exceptionHookInstalled=install(0x646a038,reinterpret_cast<void*>(builderException),reinterpret_cast<void**>(&originalBuilderException));
    const bool command=install(0x80d91d8,reinterpret_cast<void*>(commandExecution),reinterpret_cast<void**>(&originalCommandExecution));
    lineageHooksInstalled=copy&&sync&&load&&save&&ctor&&empty&&dispose&&command;
}
