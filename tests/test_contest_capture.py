"""Exercise production selected-result hooks, forwarding, bounded reads and files.
The host fixture replaces only kernel read transport, never production behavior.
"""
from pathlib import Path
import json
import os
import subprocess
import tempfile
import unittest

CPP = Path(__file__).resolve().parents[1] / 'android/lsposed-progress-capture/src/main/cpp'

class CaptureTests(unittest.TestCase):
    def test_selected_progress_and_completion(self):
        source = r'''
#include <atomic>
#include <cassert>
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <map>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>
#include <sys/uio.h>
#include <sys/syscall.h>
#include <unistd.h>
std::atomic<unsigned> g_hook_mask{7808};
constexpr const char* kTargetPackage="com.bandainamcoent.idolmaster_gakuen";
constexpr const char* kV341BuildId="77fda4e2a21f23954e2349b83fc113ede408f70b";
uint64_t unix_time_ms(){return 100000;}
void ensure_parent_dir(const std::string&){}
bool atomic_write(const std::string& p,const std::string& s){std::ofstream o(p);o<<s;return bool(o);}
bool hook_enabled(unsigned v){return (g_hook_mask.load()&v)!=0;}
struct ImageInfo {uintptr_t base;std::string build_id;};
ImageInfo find_il2cpp_image(){return {};}
void* resolve_export(const ImageInfo&,const char*){return nullptr;}
bool install_hook(uintptr_t,void*,void**){return false;}
bool blocked=false;
std::map<uintptr_t,size_t> regions;
long fixtureSyscall(long n,pid_t,const iovec* l,size_t nl,const iovec* r,size_t nr,unsigned flags){
 assert(n==SYS_process_vm_readv && nl==1 && nr==1 && flags==0);
 if(blocked)return -1;
 uintptr_t a=reinterpret_cast<uintptr_t>(r->iov_base);
 for(auto range:regions) if(a>=range.first && a+r->iov_len<=range.first+range.second){
   memcpy(l->iov_base,r->iov_base,r->iov_len);return r->iov_len;
 }
 return -1;
}
#define syscall(...) fixtureSyscall(__VA_ARGS__)
uintptr_t testCaller=0x07EFD634;
#define GAKUMAS_PASSIVE_CALLER_RVA() testCaller
#include "contest_capture.inc"
using namespace contest_capture;
struct Obj { alignas(8) unsigned char data[1024]={}; Obj(){regions[(uintptr_t)data]=sizeof(data);}
 template<class T>void put(size_t o,T v){memcpy(data+o,&v,sizeof(v));}
 uintptr_t addr(){return (uintptr_t)data;}
};
Obj sequence,parameter, machine,owner,exam,turnLog,secondTurn,turnArray,turnList,selectArray,selectList,card,cardArray,cardList,cardName,cardIdentity,commandLog,cmd,commandArray,commandList;
SearchResult payload{}; unsigned moved=0,returned=0; bool finish=false;
const void* methodInfo=(void*)0x1234;
template<class T>void resultPut(size_t offset,T v){memcpy((char*)&payload+offset,&v,sizeof(v));}
SearchResult gameResult(void* self,const void* m){assert(self==owner.data && m==methodInfo);++returned;return payload;}
void gameMove(void* self,const void* m){assert(self==machine.data && m==methodInfo);++moved;
 auto r=result(owner.data,m);assert(memcmp(&r,&payload,72)==0);
 machine.put<int32_t>(0,finish?-2:0);
 owner.put<int32_t>(0x20,12345); owner.put<int32_t>(0x24,4000);
 owner.put<int32_t>(0x28,5000); owner.put<int32_t>(0x2c,3345);
}
void pointerList(Obj& l,Obj& a,uintptr_t p){l.put(0x10,a.addr());l.put<int32_t>(0x18,1);a.put<uint64_t>(0x18,1);a.put(0x20,p);}
int main(){
 originalMove=gameMove;originalResult=gameResult;
 const std::u16string nativeCardId=u"p_card-00-men-3_003";
 cardIdentity.put<int32_t>(0x10,static_cast<int32_t>(nativeCardId.size()));
 std::memcpy(cardIdentity.data+0x14,nativeCardId.data(),nativeCardId.size()*2);
 card.put<uintptr_t>(0x98,cardIdentity.addr());
 readBudget=8192;firstReadFailure={};
 assert(setup_probe::wanted("_cardData",2));
 assert(setup_probe::keepSetupParameterField("_turnTargetStatusParameterTypeList"));
 assert(setup_probe::keepSetupParameterField("<TurnTargetStatusParameterTypeList>k__BackingField"));
 assert(!setup_probe::keepSetupParameterField("_irrelevantObscuredValue"));
 const auto captured=setup_probe::scanCardIdentity(card.addr(),nullptr);
 assert(captured.found && captured.offset==0x98 && !captured.ambiguous);
 assert(captured.json.find("\\u0070\\u005f")!=std::string::npos);

 assert(setup_probe::capture(exam.addr()).find("rawLayout")!=std::string::npos);
 assert(setup_probe::capture(exam.addr()).find("il2cpp_class_get_fields")!=std::string::npos);
 machine.put<int32_t>(0,-1);machine.put(0x20,owner.addr());machine.put(0x28,exam.addr());
 exam.put<int32_t>(0x10,2);exam.put<uint32_t>(0x14,42);
 // Before SetUpExam the sequence may have no ParameterModel yet. Preserve
 // the exact failure stage and independent ExamData seed, never invent state.
 Run setupRun;setupRun.id=999;active=&setupRun;
 auto unbound=observeBeforeSetup(sequence.addr(),exam.addr());
 assert(!unbound.available && unbound.examSeedAvailable && unbound.examSeed==42);
 assert(!unbound.sequenceParameterPresent &&
        strcmp(unbound.unavailableReason,"sequence-parameter-not-yet-bound")==0);
 sequence.put<uintptr_t>(0x10,parameter.addr());
 parameter.put<uint32_t>(0x77c,0x12345678);
 auto bound=observeBeforeSetup(sequence.addr(),exam.addr());
 assert(bound.available && bound.randomState==0x12345678);
 assert(bound.sequenceParameterPresent && bound.examSeed==42);
 active=nullptr;
 turnLog.put<int32_t>(0x10,1);turnLog.put<int32_t>(0x14,12345);turnLog.put<int32_t>(0x28,27);
 secondTurn.put<int32_t>(0x10,2);secondTurn.put<int32_t>(0x14,12345);secondTurn.put<int32_t>(0x28,25);
 cardName.put<int32_t>(0x10,4);uint16_t name[4]={'c','a','r','d'};memcpy(cardName.data+0x14,name,8);
 card.put(0x10,cardName.addr());card.put<int32_t>(0x18,2);
 pointerList(cardList,cardArray,card.addr());turnLog.put(0x38,cardList.addr());
 commandLog.put<int32_t>(0x10,1);commandLog.put<int32_t>(0x48,6);commandLog.put(0x40,cmd.addr());
 cmd.put<int32_t>(0x10,7);cmd.put<int32_t>(0x18,2);cmd.put<int32_t>(0x64,1);
 pointerList(commandList,commandArray,commandLog.addr());turnLog.put(0x58,commandList.addr());
 pointerList(turnList,turnArray,turnLog.addr());
 selectList.put(0x10,selectArray.addr());selectList.put<int32_t>(0x18,2);selectArray.put<uint64_t>(0x18,2);
 selectArray.put<int32_t>(0x20,2);selectArray.put<int32_t>(0x24,0);
 resultPut<uint8_t>(0,1);resultPut<uintptr_t>(8,selectArray.addr());resultPut<uintptr_t>(40,turnList.addr());
 resultPut<int32_t>(32,987);resultPut<int32_t>(48,12345);resultPut<int32_t>(52,4000);resultPut<int32_t>(56,5000);resultPut<int32_t>(60,3345);
 // Outside active auto-play, even matching callsite must only forward.
 // v1.5.15 on-device evidence: zero bounds at +0x10 and a nonzero
 // element count at +0x18. Treat this as an SZARRAY-shaped container.
 result(owner.data,methodInfo);assert(written==0 && returned==1);
 resultPut<uintptr_t>(40,turnArray.addr());
 move(machine.data,methodInfo);assert(written==2 && active==nullptr && moved==1 && returned==2);
 // The next selected step appends one immutable turn. The event must
 // contain only that suffix, not the earlier turn already captured.
 turnArray.put<uint64_t>(0x18,2);turnArray.put(0x28,secondTurn.addr());
 turnList.put<int32_t>(0x18,2);
 resultPut<uintptr_t>(40,turnList.addr());
 // Another game callsite forwards but never adds a selected-progress record.
 testCaller=0xdead;move(machine.data,methodInfo);assert(written==2 && returned==3 && moved==2);
 testCaller=0x07EFD634;finish=true;resultPut<uint8_t>(64,1);
 move(machine.data,methodInfo);assert(written==4 && returned==4 && moved==3 && runs.empty());
 // A finished state cannot fabricate another session/completion.
 move(machine.data,methodInfo);assert(written==4 && nextId==1);
 // Reused machine address begins a distinct run; no terminal => stopped.
 machine.put<int32_t>(0,-1);resultPut<uint8_t>(64,0);move(machine.data,methodInfo);
 assert(nextId==2 && written==7);
 // Malformed list length cannot read beyond fixture; mark partial but forward intact.
 machine.put<int32_t>(0,-1);turnList.put<int32_t>(0x18,129);resultPut<uint8_t>(64,1);
 move(machine.data,methodInfo);assert(written==10 && failures==1);
 // Failed transport never blocks original execution or claims capture.
 machine.put<int32_t>(0,-1);blocked=true;auto before=written;move(machine.data,methodInfo);
 assert(written==before && moved==7 && returned==8);blocked=false;
 // Bounded file stops writing, exposes a drop; no misleading success count.
 fileBytes=kFileLimit;machine.put<int32_t>(0,-1);move(machine.data,methodInfo);
 assert(written==before && drops==3);
 bool ok=true;readBudget=4096;assert(objectList(turnList.addr(),128,turn,ok)=="null" && !ok);
}
'''
        with tempfile.TemporaryDirectory() as d:
            p=Path(d); (p/'harness.cpp').write_text(source)
            subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',
                            '-fsanitize=address,undefined', '-fno-pie','-no-pie',
                            '-DGAKUMAS_CONTEST_CAPTURE_DIR="'+d+'/"', '-I',str(CPP),str(p/'harness.cpp'),'-o',str(p/'harness')],check=True)
            subprocess.run([str(p/'harness')],check=True,env=dict(os.environ,ASAN_OPTIONS='detect_leaks=0'))
            events=[json.loads(s) for s in (p/'contest_capture.jsonl').read_text().splitlines()]
            self.assertEqual(len(events),10)
            self.assertEqual(events[0]['seed'],42)
            progress=events[1]
            self.assertEqual(progress['selectedIndexes'],[2,0])
            self.assertEqual(progress['score'],12345)
            self.assertTrue(progress['dataComplete'])
            self.assertEqual(progress['turnsContainerShape'],'array-shaped')
            self.assertEqual(events[2]['turnsContainerShape'],'list-or-unknown')
            self.assertEqual(events[1]['turnsEncoding'],'delta')
            self.assertEqual(events[1]['turnStartIndex'],0)
            self.assertEqual(events[1]['turnCount'],1)
            self.assertEqual(events[2]['turnsEncoding'],'delta')
            self.assertEqual(events[2]['turnStartIndex'],1)
            self.assertEqual(events[2]['turnCount'],2)
            self.assertEqual([t['turn'] for t in events[2]['turns']],[2])
            self.assertEqual(events[1]['schemaVersion'],2)
            turn=progress['turns'][0]
            self.assertEqual((turn['turn'],turn['score'],turn['stamina']),(1,12345,27))
            self.assertEqual(turn['hand'][0]['id'],'card')
            self.assertEqual(turn['commands'][0]['commandType'],7)
            self.assertEqual(events[3]['event'],'contest-result')
            self.assertTrue(events[3]['recordingComplete'])
            self.assertEqual(events[6]['event'],'contest-stopped')
            self.assertFalse(events[6]['recordingComplete'])
            self.assertFalse(events[8]['dataComplete'])
            self.assertIsNone(events[8]['turns'])
            self.assertEqual(events[8]['readFailure']['reason'],'list-count-out-of-range')
            self.assertEqual(events[8]['readFailure']['stage'],'turns.list-shaped.list')
            self.assertEqual(events[8]['readFailure']['observed'],129)
            self.assertEqual(events[8]['readFailure']['offset'],0x18)
            self.assertFalse(events[9]['dataComplete'])
            status=json.loads((p/'contest_capture_status.json').read_text())
            self.assertEqual(status['limitDrops'],3)
