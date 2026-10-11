"""Exercise production detours with a bounded transport fixture and fake callees.
Host sandbox denies process_vm_readv; no production read fallback is added.
"""
from pathlib import Path
import json
import os
import subprocess
import tempfile
import unittest

CPP=Path(__file__).resolve().parents[1]/'android/lsposed-progress-capture/src/main/cpp'
class RuntimeTests(unittest.TestCase):
    def test_natural_call_forwarding_and_saved_origin(self):
        prefix=r'''
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <map>
#include <mutex>
#include <sstream>
#include <string>
#include <sys/uio.h>
#include <sys/syscall.h>
#include <unistd.h>
#include "scoped_lineage.h"
#include "native_probe.h"
#include <cassert>
std::atomic<uintptr_t> g_il2cpp_base{0};
std::atomic<unsigned> g_hook_mask{7808};
constexpr const char* kTargetPackage="com.bandainamcoent.idolmaster_gakuen";
constexpr const char* kV341BuildId="77fda4e2a21f23954e2349b83fc113ede408f70b";
uint64_t unix_time_ms(){return 100000;}
std::string hex_value(uintptr_t a){std::ostringstream s;s<<"0x"<<std::hex<<a;return s.str();}
void ensure_parent_dir(const std::string&){}
std::map<std::string,std::string> statusFiles;
bool atomic_write(const std::string& p,const std::string& s){statusFiles[p]=s;return true;}
bool hook_enabled(unsigned v){return (g_hook_mask.load()&v)!=0;}
struct ImageInfo {uintptr_t base;std::string build_id;};
bool install_hook(uintptr_t,void*,void**){return false;}
const char* verified_setup_origin(uintptr_t r){return r==0x07EFD3B4?"contest-auto-calculation":nullptr;}
bool transportBlocked=false;
std::map<uintptr_t,size_t> regions;
long fixtureSyscall(long number,pid_t,const iovec* local,size_t nl,const iovec* remote,size_t nr,unsigned flags){
 assert(number==SYS_process_vm_readv && nl==1 && nr==1 && flags==0);
 if(transportBlocked){errno=EPERM;return -1;}
 uintptr_t address=reinterpret_cast<uintptr_t>(remote->iov_base);
 for(const auto& region:regions)if(address>=region.first && address+remote->iov_len<=region.first+region.second){
   memcpy(local->iov_base,remote->iov_base,remote->iov_len);return remote->iov_len;
 }
 errno=EFAULT;return -1;
}
#define syscall(...) fixtureSyscall(__VA_ARGS__)
uintptr_t testCaller=0;
#define GAKUMAS_PASSIVE_CALLER_RVA() testCaller
'''
        body=r'''
alignas(8) uint64_t root[32]={},rootModel[4]={},exec[32]={},execModel[4]={},
 node[4]={},sim[4]={},copied[32]={},copyModel[4]={},saveData[4]={},loaded[32]={},loadedModel[4]={},
 unknownRoot[32]={},unknownModel[4]={},unknownSim[4]={},unknownNode[4]={},unknownExec[32]={};
unsigned forwards[10]={};const void* expectedMethod=reinterpret_cast<void*>(0x1238);
int typeOriginal(void*,const void* m){assert(m==expectedMethod);++forwards[0];return 2;}
bool replayOriginal(void*,const void* m){assert(m==expectedMethod);++forwards[1];return false;}
int phaseOriginal(void*,const void* m){assert(m==expectedMethod);++forwards[4];return 6;}
bool endOriginal(void*,const void* m){assert(m==expectedMethod);++forwards[2];return true;}
void disposeOriginal(void*,const void* m){assert(m==expectedMethod);++forwards[3];}
void setterOriginal(void*,bool v,const void* m){assert(v && m==expectedMethod);++forwards[5];}
void logOriginal(void*,const void* m){assert(m==expectedMethod);++forwards[6];}
void* copyOriginal(void* a,void* h,void* l,const void* m){
 assert(a==exec && h==node && l==sim && m==expectedMethod);++forwards[7];
 copied[2]=reinterpret_cast<uintptr_t>(copyModel);return copied;
}
void saveOriginal(void* d,void* q,bool v,const void* m){
 assert(d==saveData && q==copied && v && m==expectedMethod);++forwards[9];
}
void emptyOriginal(void* d,const void* m){assert(d==saveData && m==expectedMethod);++forwards[9];}
void loadOriginal(void* q,void* d,const void* m){
 assert(m==expectedMethod);++forwards[8];
 if(q==loaded){assert(d==saveData);loaded[2]=reinterpret_cast<uintptr_t>(loadedModel);}
 else if(q==exec)exec[2]=reinterpret_cast<uintptr_t>(execModel);
}
int main(){
 using namespace passive;
 std::fill(std::begin(installed),std::end(installed),true);
 originalType=typeOriginal;originalReplay=replayOriginal;originalPhase=phaseOriginal;
 originalEnd=endOriginal;originalDispose=disposeOriginal;originalSetter=setterOriginal;originalLog=logOriginal;
 originalCopy=copyOriginal;originalSave=saveOriginal;originalEmptySave=emptyOriginal;originalLoad=loadOriginal;
 for(auto* q : {root,rootModel,exec,execModel,node,sim,copied,copyModel,saveData,loaded,loadedModel,unknownRoot,unknownModel,unknownSim,unknownNode,unknownExec})
   regions[reinterpret_cast<uintptr_t>(q)] = (q==root || q==exec || q==copied || q==loaded || q==unknownRoot || q==unknownExec) ? 256 : 32;
 root[2]=reinterpret_cast<uintptr_t>(rootModel);
 transportBlocked=true;uintptr_t denied=99;
 assert(!read(reinterpret_cast<uintptr_t>(root),0x10,denied) && denied==0 && referenceErrno==EPERM);
 transportBlocked=false;
 setup(reinterpret_cast<uintptr_t>(root),0x07EFD3B4);
 sim[2]=reinterpret_cast<uintptr_t>(root);node[2]=reinterpret_cast<uintptr_t>(sim);node[3]=reinterpret_cast<uintptr_t>(exec);
 exec[15]=reinterpret_cast<uintptr_t>(node);exec[2]=reinterpret_cast<uintptr_t>(rootModel);
 testCaller=0x07F009CC;load(exec,nullptr,expectedMethod);
 auto e=book.sequence(reinterpret_cast<uintptr_t>(exec));
 if(!e)fprintf(stderr,"bind failed errno=%d ownerReads=%u reads=%u roots=%zu fail=%u\n",referenceErrno,budget.ownerReads,budget.reads,book.retained(Binding::Origin),readFailures);
 assert(e && e.kind==Binding::Execution);
 assert(type(execModel,expectedMethod)==2);assert(!replay(execModel,expectedMethod));
 assert(phase(execModel,expectedMethod)==6);assert(end(exec,expectedMethod));
 setter(execModel,true,expectedMethod);testCaller=0x080B7FC4;log(execModel,expectedMethod);
 assert(book.sequence(e.sequence).end && book.sequence(e.sequence).setter && book.sequence(e.sequence).log);
 // Expired LoadExam sampling must not sever a verified BranchNode save.
 book.invalidate(e.sequence);budget.origins[e.originId]=Budget::perOrigin;
 testCaller=0x07EFFACC;assert(copy(exec,node,sim,expectedMethod)==copied);
 assert(book.sequence(e.sequence).id!=e.id);
 testCaller=0x07EFFAF8;save(saveData,copied,true,expectedMethod);
 assert(book.snapshot(reinterpret_cast<uintptr_t>(saveData)));
 // A hot stream of unknown origins cannot use the positive model-read budget.
 unknownRoot[2]=reinterpret_cast<uintptr_t>(unknownModel);unknownSim[2]=reinterpret_cast<uintptr_t>(unknownRoot);
 unknownNode[2]=reinterpret_cast<uintptr_t>(unknownSim);unknownNode[3]=reinterpret_cast<uintptr_t>(unknownExec);
 unknownExec[15]=reinterpret_cast<uintptr_t>(unknownNode);
 unsigned readsBefore=budget.reads;
 testCaller=0x07F00A00;
 for(unsigned i=0;i<115;++i)load(unknownExec,nullptr,expectedMethod);
 assert(budget.reads==readsBefore && budget.negativeHits==114 && unknownOrigins==115);
 testCaller=0x07EFD2AC;load(loaded,saveData,expectedMethod);
 auto resumed=book.sequence(reinterpret_cast<uintptr_t>(loaded));
 assert(resumed && resumed.root.generation==e.root.generation && reloads==1);
 assert(resumed.sequence!=resumed.root.sequence);
 emptySave(saveData,expectedMethod);
 load(loaded,saveData,expectedMethod);
 assert(!book.sequence(reinterpret_cast<uintptr_t>(loaded)) && unknownReloads==1);
 uintptr_t value=99;assert(!read(0x12345000,0x10,value) && value==0);
 // Failed hook installation is represented, never replaced by an unsafe read.
 assert(forwards[0]==1 && forwards[1]==1 && forwards[2]==1 && forwards[4]==1 &&
        forwards[5]==1 && forwards[6]==1 && forwards[7]==1 && forwards[8]==118 && forwards[9]==2);
 dispose(exec,expectedMethod);assert(forwards[3]==1 && !book.sequence(e.sequence));
 status(true);
 for(const auto& file:statusFiles){std::ofstream out(file.first);out<<file.second;}
}
'''
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            runtime=(CPP/'scoped_runtime.inc').read_text()
            old='return "/data/user/" + std::to_string(getuid()/100000) + "/" + kTargetPackage + "/files/gakumas-sim/" + name;'
            self.assertIn(old,runtime)
            runtime=runtime.replace(old,'return std::string('+json.dumps(str(p)+'/')+') + name;')
            (p/'harness.cpp').write_text(prefix+runtime+body)
            subprocess.run(['g++','-std=c++17','-O1','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-I',str(CPP),str(p/'harness.cpp'),'-o',str(p/'harness')],check=True)
            subprocess.run([str(p/'harness')],check=True,env=dict(os.environ,ASAN_OPTIONS='detect_leaks=0'))
            events=[]
            for name in ('exam_mode_probes.jsonl','exam_clone_probes.jsonl','exam_execution_probes.jsonl'):
                events += [json.loads(x) for x in (p/name).read_text().splitlines()]
            names={x['event'] for x in events}
            self.assertTrue({'sequence-save-snapshot-bound','sequence-saved-origin-bound','execution-load-bound','execution-branch-owner-bound'}<=names)
            self.assertTrue(all(not x['gameCaptureVerified'] and not x['syntheticGameCalls'] and not x['rootCompletionVerified'] for x in events))
            status=json.loads((p/'exam_execution_probe_status.json').read_text())
            self.assertEqual(status['negativeCacheHits'],114)
            self.assertEqual(status['savedOriginLoads'],1)
            self.assertEqual(status['loadReadAttemptsLowerBound'],1)
            self.assertEqual(status['boundCallsLowerBound']['examType'],1)
            mode=json.loads((p/'exam_mode_probe_status.json').read_text())
            self.assertEqual(mode['callsLowerBound']['examType']['boundAtEntry'],0)
