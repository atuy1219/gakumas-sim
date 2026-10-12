// Included inside the existing native bootstrap namespace.
#ifndef GAKUMAS_PASSIVE_CALLER_RVA
#define GAKUMAS_PASSIVE_CALLER_RVA() (reinterpret_cast<scoped_lineage::Address>(__builtin_extract_return_addr(__builtin_return_address(0)))-g_il2cpp_base.load())
#endif
// v1.5.12 reconstructs passive probes from the recovered v1.5.11 ABI evidence.
// Never invoke a getter/game method to obtain state: each detour forwards once.
namespace passive {
using scoped_lineage::Address;
using scoped_lineage::Binding;
using scoped_lineage::Snapshot;
using scoped_lineage::Owner;
using scoped_lineage::Book;
using scoped_lineage::Budget;
Book book;
Budget budget;
std::mutex mutex;
bool installed[10] = {};
std::atomic<bool> attempted{false};
uint64_t calls[7] = {}, bound[7] = {}, executionBound[7] = {};
unsigned rows[3] = {}, writes[3] = {}, drops[3] = {};
uint64_t clones = 0, knownClones = 0, loads = 0, selectedLoads = 0, executions = 0;
unsigned bindingFailures = 0, readFailures = 0, unknownOrigins = 0, negativeRows = 0;
unsigned observationReads = 0, lineageReads = 0, snapshots = 0, reloads = 0, unknownReloads = 0;
int referenceErrno = 0;
uint64_t lastStatus = 0;
std::map<uint64_t,unsigned> executionRows;
const char* names[7] = {"examType", "isReplay", "isEndExam", "dispose", "phase", "completeSetter", "logCheck"};
const char* paths[3] = {"exam_mode_probes.jsonl", "exam_clone_probes.jsonl", "exam_execution_probes.jsonl"};
constexpr unsigned limits[3] = {512,128,256};
std::string path(const char* name) {
    return "/data/user/" + std::to_string(getuid()/100000) + "/" + kTargetPackage + "/files/gakumas-sim/" + name;
}
bool read(Address object, size_t offset, Address& result) {
    result = 0;
    if (!object || object & 7 || object > UINTPTR_MAX-offset-sizeof(result)) { referenceErrno = EINVAL; return false; }
    iovec local{&result, sizeof(result)}, remote{reinterpret_cast<void*>(object+offset), sizeof(result)};
    const ssize_t n = syscall(SYS_process_vm_readv, getpid(), &local, 1, &remote, 1, 0);
    if (n != static_cast<ssize_t>(sizeof(result))) {
        referenceErrno = n < 0 ? errno : EIO; result = 0; ++readFailures; return false;
    }
    referenceErrno = 0;
    if (!result || result & 7) { referenceErrno = ENOENT; return false; }
    return true;
}
bool owner(Address sequence, Owner& out);
bool identity(const Binding& b) {
    Address model = 0;
    if (!book.current(b) || !read(b.sequence,0x10,model) || model != b.parameter) return false;
    if (b.kind != Binding::Execution) return true;
    if (lineageReads >= 512) return false;
    ++lineageReads; Owner o; Binding origin = book.sequence(b.originSequence);
    return origin.id == b.originId && owner(b.sequence,o) && o.node == b.node && o.simulator == b.simulator &&
        o.sequence == b.originSequence && o.parameter == b.originParameter;
}
bool owner(Address sequence, Owner& out) {
    Address backlink = 0;
    return read(sequence,0x78,out.node) && read(out.node,0x18,backlink) && backlink == sequence &&
        read(out.node,0x10,out.simulator) && read(out.simulator,0x10,out.sequence) &&
        read(out.sequence,0x10,out.parameter);
}
bool executionIdentity(const Binding& b) {
    if (!book.current(b) || observationReads >= 512) return false;
    ++observationReads;
    Owner o; Address model = 0;
    const Binding origin = book.sequence(b.originSequence);
    return origin.id == b.originId && owner(b.sequence,o) && o.node == b.node && o.simulator == b.simulator &&
        o.sequence == b.originSequence && o.parameter == b.originParameter && read(b.sequence,0x10,model) && model == b.parameter;
}
void base(std::ostringstream& s, const char* event) {
    s << "{\"schemaVersion\":1,\"pid\":" << getpid() << ",\"tid\":" << gettid()
      << ",\"observedAtUnixMs\":" << unix_time_ms() << ",\"event\":\"" << event << "\"";
}
void fields(std::ostringstream& s,const Binding& b) {
    s << ",\"rootGeneration\":" << b.root.generation << ",\"generation\":" << b.root.generation
      << ",\"bindingId\":" << b.id << ",\"sequence\":\"" << hex_value(b.sequence) << "\""
      << ",\"parameter\":\"" << hex_value(b.parameter) << "\""
      << ",\"rootSequence\":\"" << hex_value(b.root.sequence) << "\""
      << ",\"rootParameter\":\"" << hex_value(b.root.parameter) << "\""
      << ",\"lane\":\"" << b.root.lane << "\",\"examType\":" << b.examType
      << ",\"isReplay\":" << (b.replay < 0 ? "null" : b.replay ? "true" : "false")
      << ",\"phase\":" << b.phase << ",\"endPredicateObserved\":" << (b.end ? "true" : "false")
      << ",\"completeSetterReturned\":" << (b.setter ? "true" : "false")
      << ",\"endLogCheckReturned\":" << (b.log ? "true" : "false");
    if (b.kind == Binding::Clone) s << ",\"cloneId\":" << b.id << ",\"parentBindingId\":" << b.parent;
    if (b.kind == Binding::Execution) s << ",\"executionId\":" << b.id
      << ",\"node\":\"" << hex_value(b.node) << "\",\"simulator\":\"" << hex_value(b.simulator)
      << "\",\"originSequence\":\"" << hex_value(b.originSequence) << "\",\"originParameter\":\""
      << hex_value(b.originParameter) << "\",\"originBindingId\":" << b.originId;
}
void emit(unsigned stream, std::ostringstream& s) {
    if (rows[stream] >= limits[stream]) { ++drops[stream]; return; }
    s << ",\"modeVerified\":false,\"rehearsal\":null,\"rankingReplay\":null,\"rootCompletionVerified\":false,"
      << "\"taskCompletionVerified\":false,\"gameCaptureVerified\":false,\"rngCaptured\":false,\"syntheticGameCalls\":false,"
      << "\"memoryReadScope\":\"kernel-checked-exact-build-reference-identities-only\","
      << "\"libil2cppBuildId\":\"" << kV341BuildId << "\"}\n";
    ensure_parent_dir(path(paths[stream]));
    std::ofstream out(path(paths[stream]),std::ios::app | std::ios::binary);
    out << s.str(); out.flush();
    if (out) ++rows[stream]; else ++writes[stream];
}
void event(unsigned stream,const char* name,const Binding& b,Address caller = 0) {
    if(stream==2 && b.originId) {
      unsigned& n=executionRows[b.originId];
      const bool terminal=b.end || b.setter || b.log;
      if(n>=24 && !terminal){++drops[2];return;} ++n;
    }
    std::ostringstream s; base(s,name); fields(s,b);
    if (caller) s << ",\"callerReturnRva\":\"" << hex_value(caller) << "\"";
    s << ",\"source\":\"natural-game-calls\""; emit(stream,s);
}
void common(std::ostringstream& s) {
    s << "\"schemaVersion\":1,\"pid\":" << getpid() << ",\"hookMask\":" << g_hook_mask.load()
      << ",\"counterSnapshotAtUnixMs\":" << unix_time_ms()
      << ",\"counterScope\":\"snapshot-lower-bound\",\"gameCaptureVerified\":false,\"syntheticGameCalls\":false,"
      << "\"rootCompletionVerified\":false,\"taskCompletionVerified\":false,\"rngCaptured\":false";
}
void status(bool force = false) {
    uint64_t now = unix_time_ms(); if (!force && now-lastStatus < 250) return; lastStatus = now;
    std::ostringstream m; m << '{'; common(m);
    m << ",\"scope\":\"passive-mode-lifecycle-only\",\"enabled\":" << (installed[0]&&installed[1]&&installed[2]&&installed[3]?"true":"false")
      << ",\"hooks\":{\"examType\":" << (installed[0]?"true":"false") << ",\"isReplay\":" << (installed[1]?"true":"false")
      << ",\"isEndExam\":" << (installed[2]?"true":"false") << ",\"dispose\":" << (installed[3]?"true":"false")
      << ",\"phase\":" << (installed[4]?"true":"false") << ",\"completeSetter\":" << (installed[5]?"true":"false")
      << ",\"endLogCheck\":" << (installed[6]?"true":"false") << "},\"callsLowerBound\":{";
    for (unsigned i=0;i<7;++i) { if(i)m<<','; m<<'"'<<names[i]<<"\":{\"total\":"<<calls[i]<<",\"boundAtEntry\":"<<bound[i]<<'}'; }
    m << "},\"generations\":" << book.generations() << ",\"activeBindings\":" << book.retained(Binding::Origin)
      << ",\"recordedSamples\":" << rows[0] << ",\"sampleLimit\":512,\"generationLimit\":128,\"bindingFailures\":" << bindingFailures
      << ",\"writeFailures\":" << writes[0] << ",\"droppedSamples\":" << drops[0] << ",\"lastReferenceReadErrno\":" << referenceErrno << "}\n";
    atomic_write(path("exam_mode_probe_status.json"),m.str());
    std::ostringstream c; c<<'{'; common(c);
    c << ",\"scope\":\"selected-dfs-clone-and-save-ancestry-only\",\"enabled\":" << (installed[7]?"true":"false")
      << ",\"installed\":" << (installed[7]?"true":"false") << ",\"callsLowerBound\":" << clones
      << ",\"knownSourceCallsLowerBound\":" << knownClones << ",\"trackedClones\":" << book.retained(Binding::Clone)
      << ",\"retainedEntries\":" << book.retained(Binding::Clone) << ",\"recordedSamples\":" << rows[1]
      << ",\"bindingFailures\":" << bindingFailures << ",\"writeFailures\":" << writes[1] << ",\"limitDrops\":" << drops[1]
      << ",\"cloneLimit\":32,\"sampleLimit\":128,\"completeAncestryCoverage\":false,\"savedSnapshots\":" << snapshots
      << ",\"retainedSnapshots\":" << book.snapshots() << ",\"snapshotLimit\":128,\"saveConstructorInstalled\":" << (installed[9]?"true":"false") << "}\n";
    atomic_write(path("exam_clone_probe_status.json"),c.str());
    std::ostringstream e; e<<'{'; common(e);
    e << ",\"scope\":\"dfs-loaded-execution-owner-and-saved-origin-only\",\"enabled\":" << (installed[8]?"true":"false")
      << ",\"installed\":" << (installed[8]?"true":"false") << ",\"loadCallsLowerBound\":" << loads << ",\"selectedCallsLowerBound\":" << selectedLoads
      << ",\"loadReadAttemptsLowerBound\":" << budget.reads << ",\"ownerReadAttemptsLowerBound\":" << budget.ownerReads
      << ",\"loadReadAttemptLimit\":4096,\"perOriginReadAttemptLimit\":128,\"ownerReadAttemptLimit\":4096"
      << ",\"loadReadBudgetScope\":\"per-origin-binding-plus-process-cap\",\"negativeCacheHits\":" << budget.negativeHits
      << ",\"lineageReadAttemptsLowerBound\":" << lineageReads << ",\"lineageReadAttemptLimit\":512,\"perOriginSampleLimit\":24"
      << ",\"observationReadAttemptsLowerBound\":" << observationReads << ",\"observationReadAttemptLimit\":512"
      << ",\"trackedExecutions\":" << executions << ",\"retainedEntries\":" << book.retained(Binding::Execution)
      << ",\"executionLimit\":64,\"recordedSamples\":" << rows[2] << ",\"sampleLimit\":256,\"writeFailures\":" << writes[2]
      << ",\"limitDrops\":" << budget.drops << ",\"eventLimitDrops\":" << drops[2] << ",\"failureSamples\":" << negativeRows
      << ",\"failureSampleLimit\":16,\"lastReferenceReadErrno\":" << referenceErrno
      << ",\"failureReasonsLowerBound\":{\"origin-unbound-or-stale\":" << unknownOrigins
      << ",\"reference-or-identity-check-failed\":" << readFailures << "},\"boundCallsLowerBound\":{";
    for(unsigned i=0;i<7;++i){if(i)e<<',';e<<'"'<<names[i]<<"\":"<<executionBound[i];}
    e << "},\"savedOriginLoads\":" << reloads << ",\"unboundSavedOriginLoads\":" << unknownReloads << ",\"completeAncestryCoverage\":false}\n";
    atomic_write(path("exam_execution_probe_status.json"),e.str());
}
void setup(Address sequence,Address returned) {
    if (!installed[0]) return;
    std::lock_guard<std::mutex> guard(mutex);
    book.invalidate(sequence);
    const char* lane = verified_setup_origin(returned);
    if (!lane || std::strcmp(lane,"internal-fixed-action-simulator")==0) return;
    Address parameter = 0;
    if (!read(sequence,0x10,parameter)) { ++bindingFailures; status(true); return; }
    Binding b=book.setup(sequence,parameter,lane);
    if (b) event(0,"sequence-setup-bound",b,returned); else ++bindingFailures;
    status(true);
}
Binding before(Address address,bool sequence,unsigned call) {
    std::lock_guard<std::mutex> guard(mutex); ++calls[call];
    Binding b = sequence ? book.sequence(address) : book.parameter(address);
    if (!b) return {};
    if (b.kind == Binding::Execution && observationReads >= 512) return {};
    const bool valid = b.kind == Binding::Execution ? executionIdentity(b) : identity(b);
    if (!valid) { book.invalidate(b.sequence); return {}; }
    if(b.kind==Binding::Execution)++executionBound[call];
    else if(b.kind==Binding::Origin)++bound[call];
    return b;
}
void after(const Binding& old,int field,int value,const char* modeName,const char* executionName) {
    if (!old) return;
    std::lock_guard<std::mutex> guard(mutex);
    if (!book.current(old)) return;
    // Original getter cannot establish identity after an owner/model switch.
    // The returned pointer identity is checked again, under a bounded budget.
    if (old.kind == Binding::Execution && observationReads >= 512) return;
    const bool valid = old.kind == Binding::Execution ? executionIdentity(old) : identity(old);
    if (!valid) {book.invalidate(old.sequence); return;}
    Binding now;
    if (book.update(old,field,value,now)) event(now.kind==Binding::Execution?2:0,now.kind==Binding::Execution?executionName:modeName,now);
    status();
}
using IntFn=int(*)(void*,const void*);
using BoolFn=bool(*)(void*,const void*);
using VoidFn=void(*)(void*,const void*);
using SetterFn=void(*)(void*,bool,const void*);
using CopyFn=void*(*)(void*,void*,void*,const void*);
using LoadFn=void(*)(void*,void*,const void*);
using SaveFn=void(*)(void*,void*,bool,const void*);
IntFn originalType=nullptr,originalPhase=nullptr;
BoolFn originalReplay=nullptr,originalEnd=nullptr;
VoidFn originalDispose=nullptr,originalLog=nullptr,originalEmptySave=nullptr;
SetterFn originalSetter=nullptr;
CopyFn originalCopy=nullptr;
LoadFn originalLoad=nullptr;
SaveFn originalSave=nullptr;
__attribute__((noinline)) int type(void* a,const void* m) {
    Binding b=before(reinterpret_cast<Address>(a),false,0);int v=originalType(a,m);after(b,0,v,"exam-type-return","execution-exam-type-return");return v;
}
__attribute__((noinline)) bool replay(void* a,const void* m) {
    Binding b=before(reinterpret_cast<Address>(a),false,1);bool v=originalReplay(a,m);after(b,1,v,"is-replay-return","execution-is-replay-return");return v;
}
__attribute__((noinline)) int phase(void* a,const void* m) {
    Binding b=before(reinterpret_cast<Address>(a),false,4);int v=originalPhase(a,m);after(b,2,v,"exam-phase-return","execution-phase-return");return v;
}
__attribute__((noinline)) bool end(void* a,const void* m) {
    Binding b=before(reinterpret_cast<Address>(a),true,2);bool v=originalEnd(a,m);after(b,3,v,"exam-end-predicate-return","execution-end-predicate-return");return v;
}
__attribute__((noinline)) void dispose(void* a,const void* m) {
    Binding b=before(reinterpret_cast<Address>(a),true,3);
    {std::lock_guard<std::mutex> guard(mutex);book.invalidate(reinterpret_cast<Address>(a));}
    originalDispose(a,m);
    if(b){std::lock_guard<std::mutex> guard(mutex);event(b.kind==Binding::Execution?2:0,"sequence-dispose-return",b);status(true);}
}
__attribute__((noinline)) void setter(void* a,bool value,const void* m) {
    Binding b=before(reinterpret_cast<Address>(a),false,5);originalSetter(a,value,m);
    after(b,4,value,"exam-complete-setter-return","execution-complete-setter-return");
}
__attribute__((noinline)) void log(void* a,const void* m) {
    Address r=GAKUMAS_PASSIVE_CALLER_RVA();
    Binding b=before(reinterpret_cast<Address>(a),false,6);originalLog(a,m);
    if(r==0x080B7FC4)after(b,5,1,"exam-end-log-check-return","execution-end-log-check-return");
}
__attribute__((noinline)) void* copy(void* a,void* handler,void* logger,const void* m) {
    Address seq=reinterpret_cast<Address>(a);
    Address r=GAKUMAS_PASSIVE_CALLER_RVA();
    Binding source;
    {std::lock_guard<std::mutex> guard(mutex);++clones;
      if(r==0x07F01DD8 || r==0x07F01F1C || r==0x07EFFACC) {
        source=book.sequence(seq);if(source && !identity(source))source={};
        // BranchNode can run after the ordinary LoadExam sampling allowance
        // has expired. Its verified callsite + live owner backlink permits a
        // bounded identity-only binding, without calling a game getter.
        if(!source && r==0x07EFFACC && lineageReads<512) {
          ++lineageReads;Owner o;Address model=0;
          if(owner(seq,o) && read(seq,0x10,model)) {
            Binding origin=book.sequence(o.sequence);
            if(origin && origin.parameter==o.parameter) {
              source=book.execution(origin,o,seq,model);
              if(source){++executions;event(2,"execution-branch-owner-bound",source,r);}
            }
          }
        }
        if(source)++knownClones;
      }}
    void* result=originalCopy(a,handler,logger,m);
    if(!source)return result;
    std::lock_guard<std::mutex> guard(mutex);Address parameter=0;
    if(!identity(source) || !read(reinterpret_cast<Address>(result),0x10,parameter)){++bindingFailures;status();return result;}
    Binding b=book.clone(source,reinterpret_cast<Address>(result),parameter);
    if(b)event(1,"sequence-deep-copy-bound",b,r);else ++bindingFailures;
    status();return result;
}
// Every constructor invalidates a reused SaveData address, including unselected
// constructors. Only the verified BranchNode callsite can establish ancestry.
__attribute__((noinline)) void save(void* data,void* sequence,bool small,const void* m) {
    Address addr=reinterpret_cast<Address>(data);
    Address r=GAKUMAS_PASSIVE_CALLER_RVA();
    Binding source;
    {std::lock_guard<std::mutex> guard(mutex);book.forgetSnapshot(addr);
      if(installed[9] && r==0x07EFFAF8){source=book.sequence(reinterpret_cast<Address>(sequence));if(source && !identity(source))source={};}}
    originalSave(data,sequence,small,m);
    if(!source)return;
    std::lock_guard<std::mutex> guard(mutex);if(!identity(source))return;
    Snapshot s=book.snapshot(addr,source);
    if(s){++snapshots;std::ostringstream row;base(row,"sequence-save-snapshot-bound");fields(row,source);
      row<<",\"snapshotId\":"<<s.id<<",\"saveData\":\""<<hex_value(addr)<<"\",\"saveCallerReturnRva\":\""<<hex_value(r)<<"\"";emit(1,row);status(true);}
}
__attribute__((noinline)) void emptySave(void* data,const void* m) {
    {std::lock_guard<std::mutex> guard(mutex);book.forgetSnapshot(reinterpret_cast<Address>(data));}
    originalEmptySave(data,m);
}
__attribute__((noinline)) void load(void* a,void* data,const void* m) {
    Address seq=reinterpret_cast<Address>(a),saveData=reinterpret_cast<Address>(data);
    Address r=GAKUMAS_PASSIVE_CALLER_RVA();
    Owner beforeOwner;Binding origin;Snapshot saved;bool selected=false,attempt=false;
    {std::lock_guard<std::mutex> guard(mutex);++loads;book.invalidate(seq);
      if(r==0x07EFD2AC){saved=book.snapshot(saveData);}
      else if(r==0x07F009CC || r==0x07F00A00){selected=true;++selectedLoads;
        if(budget.ownerAttempt() && owner(seq,beforeOwner)) {
          origin=book.sequence(beforeOwner.sequence);
          if(origin && origin.parameter==beforeOwner.parameter){budget.accepted(beforeOwner.simulator);attempt=budget.attempt(origin.id);}
          else {origin={};++unknownOrigins;referenceErrno=ESTALE;
            if(!budget.cached(beforeOwner.simulator,beforeOwner.sequence,beforeOwner.parameter)) {
              budget.reject(beforeOwner.simulator,beforeOwner.sequence,beforeOwner.parameter);
              if(negativeRows<16){++negativeRows;std::ostringstream row;base(row,"execution-binding-or-observation-rejected");
                row<<",\"sequence\":\""<<hex_value(seq)<<"\",\"simulator\":\""<<hex_value(beforeOwner.simulator)
                  <<"\",\"rootSequence\":\""<<hex_value(beforeOwner.sequence)<<"\",\"rootParameter\":\""<<hex_value(beforeOwner.parameter)
                  <<"\",\"loadCallerReturnRva\":\""<<hex_value(r)<<"\",\"reason\":\"origin-unbound-or-stale\",\"referenceReadErrno\":116,\"rootGeneration\":0,\"executionId\":0";emit(2,row);}
            }
          }
        }
      }}
    originalLoad(a,data,m);
    std::lock_guard<std::mutex> guard(mutex);Address parameter=0;
    if(r==0x07EFD2AC){
      if(saved && read(seq,0x10,parameter)){
        Binding b=book.reload(saved,seq,parameter);
        if(b){++reloads;std::ostringstream row;base(row,"sequence-saved-origin-bound");fields(row,b);
          row<<",\"snapshotId\":"<<saved.id<<",\"saveData\":\""<<hex_value(saveData)<<"\",\"loadCallerReturnRva\":\""<<hex_value(r)<<"\"";emit(0,row);}
        else ++unknownReloads;
      } else ++unknownReloads;
      status(true);
    } else if(selected && attempt){
      Owner afterOwner;
      if(owner(seq,afterOwner) && afterOwner==beforeOwner && read(seq,0x10,parameter)){
        Binding b=book.execution(origin,afterOwner,seq,parameter);
        if(b){++executions;event(2,"execution-load-bound",b,r);}else ++bindingFailures;
      }else ++bindingFailures;
      status();
    }
    if(selected)status();
}
void install(const ImageInfo& image) {
    if(image.build_id!=kV341BuildId || !hook_enabled(512) || attempted.exchange(true))return;
    // Signatures verified against decrypted metadata + this exact ELF.
    installed[0]=install_hook(image.base+0x0808DA38,reinterpret_cast<void*>(type),reinterpret_cast<void**>(&originalType));
    installed[1]=install_hook(image.base+0x0808DE38,reinterpret_cast<void*>(replay),reinterpret_cast<void**>(&originalReplay));
    installed[2]=install_hook(image.base+0x080A5698,reinterpret_cast<void*>(end),reinterpret_cast<void**>(&originalEnd));
    installed[3]=install_hook(image.base+0x080B0DC0,reinterpret_cast<void*>(dispose),reinterpret_cast<void**>(&originalDispose));
    if(hook_enabled(1024)) {
      installed[4]=install_hook(image.base+0x0808E0F4,reinterpret_cast<void*>(phase),reinterpret_cast<void**>(&originalPhase));
      installed[5]=install_hook(image.base+0x0808E4C0,reinterpret_cast<void*>(setter),reinterpret_cast<void**>(&originalSetter));
      installed[6]=install_hook(image.base+0x08096564,reinterpret_cast<void*>(log),reinterpret_cast<void**>(&originalLog));
    }
    if(hook_enabled(2048))installed[7]=install_hook(image.base+0x080AFEE0,reinterpret_cast<void*>(copy),reinterpret_cast<void**>(&originalCopy));
    if(hook_enabled(4096)){
      installed[8]=install_hook(image.base+0x080A3B34,reinterpret_cast<void*>(load),reinterpret_cast<void**>(&originalLoad));
      bool filled=install_hook(image.base+0x0809B760,reinterpret_cast<void*>(save),reinterpret_cast<void**>(&originalSave));
      bool empty=install_hook(image.base+0x0809B718,reinterpret_cast<void*>(emptySave),reinterpret_cast<void**>(&originalEmptySave));
      installed[9]=filled && empty;
    }
    std::lock_guard<std::mutex> guard(mutex);status(true);
}
} // namespace passive
