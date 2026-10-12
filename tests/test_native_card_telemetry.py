"""Host-verify passive per-card native sampling and exact-once forwarding."""
from pathlib import Path
import json
import os
import subprocess
import tempfile
import unittest

CPP = Path(__file__).resolve().parents[1] / 'android/lsposed-progress-capture/src/main/cpp'


class CardTelemetryTests(unittest.TestCase):
    def test_native_card_effect_samples(self):
        source=r'''
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
char reviewClass[8],aggressiveClass[8],buffClass[8],focusClass[8];
char fullPowerClass[8],enthusiasmClass[8],upliftingClass[8],excellentClass[8],staminaDownClass[8],parameterClass[8];
const char* nameForClass(void* k){
 if(k==reviewClass)return "ReviewStatusEffect";
 if(k==aggressiveClass)return "AggressiveStatusEffect";
 if(k==buffClass)return "ParameterBuffStatusEffect";
 if(k==focusClass)return "LessonBuffStatusEffect";
 if(k==fullPowerClass)return "FullPowerPointStatusEffect";
 if(k==enthusiasmClass)return "EnthusiasticStatusEffect";
 if(k==upliftingClass)return "UpliftingStatusEffect";
 if(k==excellentClass)return "ParameterBuffMultiplePerTurnStatusEffect";
 if(k==staminaDownClass)return "StaminaConsumptionDownStatusEffect";
 if(k==parameterClass)return "ExamParameterModel";
 return "Unknown";
}
struct FieldInfo {const char* name;size_t offset;int kind;};
FieldInfo fieldValue{"_value",0x14,0x08},fieldTurn{"_turn",0x18,0x08};
FieldInfo fieldPassing{"_isPassingTurnStart",0x1c,0x02};
FieldInfo fieldAggressive{"_value",0x28,0x08};
FieldInfo fieldStance{"_stance",0x90,0x08},fieldFullPower{"_fullPowerPoint",0x94,0x08};
FieldInfo fieldEnthusiasm{"_enthusiasticValue",0x98,0x08};
void* fakeGetFields(void* klass,void** iterator){
 FieldInfo* data[]={&fieldValue,&fieldTurn,&fieldPassing};
 const uintptr_t n=reinterpret_cast<uintptr_t>(*iterator);
 if(n>=3)return nullptr;
 *iterator=reinterpret_cast<void*>(n+1);
 if(klass==parameterClass){
  FieldInfo* parameterFields[]={&fieldStance,&fieldFullPower,&fieldEnthusiasm};
  return parameterFields[n];
 }
 if(klass==aggressiveClass && n==0)return &fieldAggressive;
 return data[n];
}
const char* fakeFieldName(void* field){return static_cast<FieldInfo*>(field)->name;}
size_t fakeFieldOffset(void* field){return static_cast<FieldInfo*>(field)->offset;}
void* fakeFieldType(void* field){return field;}
int fakeTypeKind(void* field){return static_cast<FieldInfo*>(field)->kind;}
void* fakeParent(void*){return nullptr;}
void* resolve_export(const ImageInfo&,const char* n){
 if(strcmp(n,"il2cpp_class_get_name")==0)return (void*)nameForClass;
 if(strcmp(n,"il2cpp_class_get_fields")==0)return (void*)fakeGetFields;
 if(strcmp(n,"il2cpp_field_get_name")==0)return (void*)fakeFieldName;
 if(strcmp(n,"il2cpp_field_get_offset")==0)return (void*)fakeFieldOffset;
 if(strcmp(n,"il2cpp_field_get_type")==0)return (void*)fakeFieldType;
 if(strcmp(n,"il2cpp_type_get_type")==0)return (void*)fakeTypeKind;
 if(strcmp(n,"il2cpp_class_get_parent")==0)return (void*)fakeParent;
 return nullptr;
}
bool install_hook(uintptr_t,void*,void**){return false;}
std::map<uintptr_t,size_t> regions;
long fixtureSyscall(long n,pid_t,const iovec* l,size_t nl,const iovec* r,size_t nr,unsigned flags){
 assert(n==SYS_process_vm_readv && nl==1 && nr==1 && flags==0);
 uintptr_t a=reinterpret_cast<uintptr_t>(r->iov_base);
 for(auto range:regions)if(a>=range.first&&a+r->iov_len<=range.first+range.second){
  memcpy(l->iov_base,r->iov_base,r->iov_len);return r->iov_len;
 }
 return -1;
}
#define syscall(...) fixtureSyscall(__VA_ARGS__)
#define GAKUMAS_PASSIVE_CALLER_RVA() 0x07EFD634
#include "contest_capture.inc"
using namespace contest_capture;
struct Obj {
 alignas(8) unsigned char data[4096]={};
 Obj(){regions[(uintptr_t)data]=sizeof(data);}
 template<class T>void put(size_t off,T val){memcpy(data+off,&val,sizeof(val));}
 uintptr_t addr(){return (uintptr_t)data;}
};
Obj sequence, parameter, controller, effects, effectsList, effectsArray, review, aggressive;
Obj buff, focus, fullPower, enthusiasm, uplifting, excellent, staminaDown;
Obj card, cardData, cardId, cardGuid;
void text(Obj& obj,const std::u16string& chars){
 obj.put<int32_t>(0x10,chars.size());
 memcpy(obj.data+0x14,chars.data(),chars.size()*2);
}
unsigned effectForwarded=0,moveForwarded=0;
void* gameTriggerCommand(void* self,void* commandList,uint32_t mode,const void*){
 assert(self==sequence.data && commandList==(void*)0x1234 && mode==0);
 ++effectForwarded;
 parameter.put<int32_t>(0x570+0x18,10);
 parameter.put<int32_t>(0x1cc+0x18,25);
 parameter.put<int32_t>(0x90,2);parameter.put<int32_t>(0x94,8);
 parameter.put<int32_t>(0x98,5);
 review.put<int32_t>(0x14,3);
 aggressive.put<int32_t>(0x28,7);
 buff.put<int32_t>(0x14,4);
 focus.put<int32_t>(0x14,8);
 fullPower.put<int32_t>(0x14,9);
 enthusiasm.put<int32_t>(0x14,6);
 uplifting.put<int32_t>(0x14,2);
 excellent.put<int32_t>(0x18,3);
 staminaDown.put<int32_t>(0x18,4);
 return (void*)0x5678;
}
void gameMove(void* self,void* playing,uintptr_t,const void*){
 assert(self==controller.data && playing==card.data);
 ++moveForwarded;
}
int main(){
 originalTriggerCommand=gameTriggerCommand; originalCardMove=gameMove;
 text(cardId,u"p_card-01-act-1_001"); text(cardGuid,u"guid-001");
 cardData.put(0x18,cardId.addr());
 card.put(0x10,cardData.addr());card.put(0x18,cardGuid.addr());
 card.put<int32_t>(0x24,1);card.put<int32_t>(0x28,0);
 sequence.put(0x10,parameter.addr()); sequence.put(0x58,controller.addr());
 parameter.put(0,(uintptr_t)parameterClass);
 parameter.put<int32_t>(0x90,1);parameter.put<int32_t>(0x94,4);
 parameter.put<int32_t>(0x98,3);
 controller.put(0x48,card.addr());
 parameter.put(0x390,effects.addr());
 effects.put(0x10,effectsList.addr());
 effectsList.put(0x10,effectsArray.addr());effectsList.put<int32_t>(0x18,9);
 effectsArray.put<uint64_t>(0x18,9);
 Obj* rows[]={&review,&aggressive,&buff,&focus,&fullPower,&enthusiasm,&uplifting,&excellent,&staminaDown};
 uintptr_t classes[]={reinterpret_cast<uintptr_t>(reviewClass),reinterpret_cast<uintptr_t>(aggressiveClass),
 reinterpret_cast<uintptr_t>(buffClass),reinterpret_cast<uintptr_t>(focusClass),reinterpret_cast<uintptr_t>(fullPowerClass),
 reinterpret_cast<uintptr_t>(enthusiasmClass),reinterpret_cast<uintptr_t>(upliftingClass),
 reinterpret_cast<uintptr_t>(excellentClass),reinterpret_cast<uintptr_t>(staminaDownClass)};
 for(size_t n=0;n<9;n++){effectsArray.put(0x20+8*n,rows[n]->addr());rows[n]->put(0,classes[n]);}
 review.put<int32_t>(0x14,2);aggressive.put<int32_t>(0x28,4);
 buff.put<int32_t>(0x14,3);focus.put<int32_t>(0x14,5);
 fullPower.put<int32_t>(0x14,1);enthusiasm.put<int32_t>(0x14,2);
 uplifting.put<int32_t>(0x14,1);excellent.put<int32_t>(0x18,2);
 staminaDown.put<int32_t>(0x18,3);
 for(size_t o:{size_t(0x570),size_t(0x58c),size_t(0x5a8),
               size_t(0x1cc),size_t(0x248),size_t(0x144)})
  parameter.put<uint8_t>(o,1);
 parameter.put<int32_t>(0x570+0x18,5);
 parameter.put<int32_t>(0x58c+0x18,6);
 parameter.put<int32_t>(0x5a8+0x18,7);
 parameter.put<int32_t>(0x1cc+0x18,30);
 parameter.put<int32_t>(0x248+0x18,12);
 parameter.put<int32_t>(0x144+0x18,1);
 Run run{};run.id=1;run.sequence=sequence.addr();run.parameter=parameter.addr();
 run.setupRecorded=true;active=&run;
 readBudget=768;firstReadFailure={};
 NativeStatusSample before=sampleStatus(sequence.addr());
 assert(before.rawNumbers && before.reviewAvailable && before.aggressiveAvailable);
 assert(before.scoreVocal==5 && before.stamina==30 && before.block==12);
 assert(before.review==2 && before.aggressive==4);
 cardMove(controller.data,card.data,0,nullptr);
 assert(triggerCommand(sequence.data,(void*)0x1234,0,nullptr)==(void*)0x5678);
 assert(moveForwarded==1 && effectForwarded==1 && run.effectSamples==1);
 assert(run.cardMoveSamples==1 && written==2);
 // A genuine MovePlayCard callback from another controller must not be
 // mistaken for the auto-play sequence; rejection counters must still flush.
 sequence.put<uintptr_t>(0x58,0);
 cardMove(controller.data,card.data,0,nullptr);
 assert(moveForwarded==2 && run.cardMoveSamples==1 && written==2);
 active=nullptr;
 // Outside the exact session, forward once but never write evidence.
 assert(triggerCommand(sequence.data,(void*)0x1234,0,nullptr)==(void*)0x5678);
 assert(effectForwarded==2 && written==2);
}
'''
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            (root/'test.cpp').write_text(source)
            subprocess.run(
                ['g++','-std=c++17','-Wall','-Wextra','-Werror',
                 '-Wno-misleading-indentation','-fsanitize=address,undefined',
                 '-fno-pie','-no-pie','-DGAKUMAS_CONTEST_CAPTURE_DIR="'+d+'/"',
                 '-I',str(CPP),str(root/'test.cpp'),'-o',str(root/'test')],check=True)
            subprocess.run([str(root/'test')],check=True,
                           env=dict(os.environ,ASAN_OPTIONS='detect_leaks=0'))
            events=[json.loads(line) for line in (root/'contest_capture.jsonl').read_text().splitlines()]
            self.assertEqual([x['event'] for x in events],
                             ['contest-card-move','contest-card-command-snapshot'])
            move,effect=events
            self.assertEqual(move['card']['id'],'p_card-01-act-1_001')
            self.assertEqual(effect['card']['guid'],'guid-001')
            self.assertFalse(effect['cardEffectsComplete'])
            self.assertEqual(effect['metrics']['score'],23)
            self.assertEqual(effect['metrics']['stamina'],25)
            self.assertEqual(effect['metrics']['block'],12)
            self.assertEqual(effect['metrics']['review'],3)
            self.assertEqual(effect['metrics']['aggressive'],7)
            self.assertFalse(effect['metrics']['turnResultParityVerified'])
            self.assertEqual(effect['cardActionSerial'],1)
            self.assertTrue(effect['changes']['fromPreviousSameCardSample'])
            self.assertEqual(effect['changes']['score'],5)
            self.assertEqual(effect['changes']['stamina'],-5)
            self.assertEqual(effect['changes']['block'],0)
            self.assertEqual(effect['changes']['review'],1)
            self.assertEqual(effect['changes']['aggressive'],3)
            self.assertTrue(effect['metrics']['statusMetadataAvailable'])
            statuses={x['type']:x for x in effect['metrics']['statusEffects']}
            self.assertEqual(statuses['ParameterBuffStatusEffect']['fields']['_value'],4)
            self.assertEqual(statuses['LessonBuffStatusEffect']['fields']['_value'],8)
            self.assertEqual(statuses['FullPowerPointStatusEffect']['fields']['_value'],9)
            self.assertEqual(statuses['EnthusiasticStatusEffect']['fields']['_value'],6)
            self.assertEqual(statuses['UpliftingStatusEffect']['fields']['_value'],2)
            self.assertEqual(statuses['ParameterBuffMultiplePerTurnStatusEffect']['fields']['_turn'],3)
            self.assertEqual(statuses['StaminaConsumptionDownStatusEffect']['fields']['_turn'],4)
            deltas={x['key']:x['fields'] for x in effect['statusEffectChanges']['entries']}
            self.assertTrue(effect['statusEffectChanges']['comparable'])
            self.assertEqual(deltas['ParameterBuffStatusEffect#0']['_value'],1)
            self.assertEqual(deltas['LessonBuffStatusEffect#0']['_value'],3)
            self.assertEqual(deltas['FullPowerPointStatusEffect#0']['_value'],8)
            self.assertEqual(deltas['EnthusiasticStatusEffect#0']['_value'],4)
            self.assertEqual(deltas['UpliftingStatusEffect#0']['_value'],1)
            self.assertEqual(deltas['ParameterBuffMultiplePerTurnStatusEffect#0']['_turn'],1)
            self.assertEqual(deltas['StaminaConsumptionDownStatusEffect#0']['_turn'],1)
            self.assertEqual(effect['metrics']['parameterStatusFields']['_stance'],2)
            self.assertEqual(effect['metrics']['parameterStatusFields']['_fullPowerPoint'],8)
            self.assertEqual(effect['metrics']['parameterStatusFields']['_enthusiasticValue'],5)
            fields=effect['parameterStatusChanges']['entries'][0]['fields']
            self.assertEqual(fields['_stance'],1)
            self.assertEqual(fields['_fullPowerPoint'],4)
            self.assertEqual(fields['_enthusiasticValue'],2)
            status=json.loads((root/'contest_capture_status.json').read_text())
            self.assertEqual(status['effectSamples'],1)
            self.assertEqual(status['triggerCommandCalls'],1)
            self.assertEqual(status['cardMoveCalls'],2)
            self.assertEqual(status['cardMoveControllerReadable'],2)
            self.assertEqual(status['cardMoveControllerMatched'],1)
            self.assertEqual(status['cardMoveParameterMatched'],1)
            self.assertEqual(status['cardSnapshotAttempts'],2)
            self.assertEqual(status['cardSnapshotSequenceMatched'],2)
            self.assertEqual(status['cardSnapshotParameterMatched'],2)
            self.assertEqual(status['cardMoveSamples'],1)


if __name__=='__main__':
    unittest.main()
