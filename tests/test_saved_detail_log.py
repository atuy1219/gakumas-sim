"""Verify post-game native readback, independent of active contest/DFS state."""
import ast
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
CPP=ROOT/'android/lsposed-progress-capture/src/main/cpp'

class SavedDetailTests(unittest.TestCase):
    def test_readback_and_forwarding(self):
        tree=ast.parse((ROOT/'tests/test_native_card_telemetry.py').read_text())
        fixture=max((n.value for n in ast.walk(tree) if isinstance(n,ast.Constant) and isinstance(n.value,str)),key=len)
        source=fixture[:fixture.index('int main(){')]
        source=source.replace('char reviewClass[8]', 'char itemClass[8],detailClass[8],lineClass[8];\nchar reviewClass[8]')
        source=source.replace(' if(k==reviewClass)', ' if(k==itemClass)return "ExamUserPlayLogItemModel";\n if(k==detailClass)return "ExamUserPlayLogDetailModel";\n if(k==lineClass)return "ExamPlayLogDetailLineModel";\n if(k==reviewClass)')
        source+=r'''
#include "detail_log_capture.inc"
int main(){
 alignas(8) unsigned char big[8192]={};regions[(uintptr_t)big]=sizeof(big);
 const uintptr_t arrayType=(uintptr_t)arrayClass;const uint64_t length=600;
 memcpy(big,&arrayType,8);memcpy(big+0x18,&length,8);
 for(uint64_t i=0;i<length;++i)memcpy(big+0x20+i*8,&i,8);
 readBudget=100;std::vector<uintptr_t> copied;
 assert(detail_log_capture::collection((uintptr_t)big,1024,copied));
 assert(copied.size()==600&&copied.back()==599);
 g_hook_mask.store(8192);assert(contest_capture::active==nullptr);
 Obj items,details,lines,logs,detailList,lineList,item,detail,line,label,cardIds,ids;
 items.put(0,(uintptr_t)arrayClass);items.put<uint64_t>(0x18,1);items.put(0x20,item.addr());
 logs.put(0,(uintptr_t)listClass);logs.put(0x10,items.addr());logs.put<int32_t>(0x18,1);
 details.put(0,(uintptr_t)arrayClass);details.put<uint64_t>(0x18,1);details.put(0x20,detail.addr());
 detailList.put(0,(uintptr_t)listClass);detailList.put(0x10,details.addr());detailList.put<int32_t>(0x18,1);
 lines.put(0,(uintptr_t)arrayClass);lines.put<uint64_t>(0x18,1);lines.put(0x20,line.addr());
 lineList.put(0,(uintptr_t)listClass);lineList.put(0x10,lines.addr());lineList.put<int32_t>(0x18,1);
 item.put(0,(uintptr_t)itemClass);item.put<int32_t>(0x10,3);item.put<int32_t>(0x20,2);item.put(0x18,detailList.addr());
 detail.put(0,(uintptr_t)detailClass);detail.put(0x18,lineList.addr());detail.put<int32_t>(0x20,7);
 line.put(0,(uintptr_t)lineClass);line.put<int32_t>(0x10,3);line.put<int32_t>(0x14,100);line.put<int32_t>(0x18,217);
 text(label,u"contest-log");text(cardId,u"p_card-test");
 cardIds.put(0,(uintptr_t)arrayClass);cardIds.put<uint64_t>(0x18,1);cardIds.put(0x20,cardId.addr());
 ids.put(0,(uintptr_t)listClass);ids.put(0x10,cardIds.addr());ids.put<int32_t>(0x18,1);
 item.put(0x78,ids.addr());item.put(0x98,ids.addr());line.put(0x58,ids.addr());
 detail_log_capture::originalLoad=[](uintptr_t l,uintptr_t m){assert(l&&m==0x1234);++effectForwarded;return controller.addr();};
 // Forward original result exactly; an unsupported root records incomplete.
 const auto result=detail_log_capture::load(label.addr(),0x1234);
 assert(result==controller.addr()&&effectForwarded==1&&detail_log_capture::incomplete==1);
 detail_log_capture::capture(logs.addr(),"saved-log-LoadAll",label.addr());
 detail_log_capture::capture(logs.addr(),"saved-log-LoadAll",label.addr());
 assert(detail_log_capture::records==2&&detail_log_capture::duplicates==1);
 detail_log_capture::originalOverlay=[](uintptr_t s,uintptr_t l,uintptr_t c,uint32_t b,uintptr_t sk,uintptr_t m){
     assert(s==0x1&&l&&c==0&&b==1&&sk==0x2&&m==0x3);++effectForwarded;
 };
 detail_log_capture::overlay(0x1,logs.addr(),0,1,0x2,0x3);
 assert(effectForwarded==2&&detail_log_capture::records==3);
 // Oversized root collection fails closed, rather than truncating as complete.
 logs.put<int32_t>(0x18,4097);detail_log_capture::capture(logs.addr(),"saved-log-LoadAll");
 assert(detail_log_capture::incomplete==2);
 // Mismatched model classes never reinterpret arbitrary object payloads.
 logs.put<int32_t>(0x18,1);item.put(0,(uintptr_t)cardClass);
 detail_log_capture::capture(logs.addr(),"saved-log-LoadAll");
 assert(detail_log_capture::incomplete==3);
 // Mode off is a no-op for capture, while original call still forwards once.
 const auto count=detail_log_capture::records;g_hook_mask.store(0);
 detail_log_capture::overlay(0x1,logs.addr(),0,1,0x2,0x3);
 assert(effectForwarded==3&&detail_log_capture::records==count);
}
'''
        # Generic array fixture names the element type; give the actual array suffix.
        source=source.replace('return "ExamCardData[]"','return "ExamUserPlayLogItemModel[]"')
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);(p/'test.cpp').write_text(source)
            subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',
                            '-fsanitize=address,undefined','-fno-pie','-no-pie',
                            '-DGAKUMAS_CONTEST_CAPTURE_DIR="'+d+'/"','-I',str(CPP),str(p/'test.cpp'),'-o',str(p/'test')],check=True)
            subprocess.run([str(p/'test')],check=True,env=dict(os.environ,ASAN_OPTIONS='detect_leaks=0'))
            rows=[json.loads(s) for s in (p/'detail_log_capture.jsonl').read_text().splitlines()]
            complete=[r for r in rows if r['dataComplete']]
            self.assertEqual(len(complete),2)
            model=complete[0]['items'][0]
            self.assertEqual(model['cellType'],3)
            self.assertEqual(model['playCardIds'],['p_card-test'])
            self.assertEqual(model['drawCardIds'],['p_card-test'])
            line=model['details'][0]['lines'][0]
            self.assertEqual((line['before'],line['after'],line['delta']),(100,217,117))
            self.assertEqual(line['afterIdList'],['p_card-test'])
            self.assertTrue(all(r['additionalGameCalls'] is False for r in rows))
