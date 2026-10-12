"""Exercise sibling DFS branches, saved-state identity and async continuation order."""
import ast
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CPP = ROOT / 'android/lsposed-progress-capture/src/main/cpp'


class LineageTests(unittest.TestCase):
    def test_branch_selection_and_actual_completion(self):
        # Reuse the metadata/memory fixture, with an independent native scenario.
        tree = ast.parse((ROOT / 'tests/test_native_card_telemetry.py').read_text())
        fixture = max((n.value for n in ast.walk(tree)
                       if isinstance(n, ast.Constant) and isinstance(n.value, str)), key=len)
        fixture = fixture.replace('char handClass[8]', 'char playingPropertyClass[8];\nchar handClass[8]')
        fixture = fixture.replace('FieldInfo fieldValue', 'FieldInfo seqPlaying{"_isCommandPlaying",0x70,0x12},playingValue{"_value",0x10,0x02};\nFieldInfo fieldValue')
        fixture = fixture.replace('selected[3]=&seqStore;count=4;', 'selected[3]=&seqStore;selected[4]=&seqPlaying;count=5;')
        fixture = fixture.replace('else if(klass==handClass)', 'else if(klass==playingPropertyClass){selected[0]=&playingValue;count=1;}\n else if(klass==handClass)')
        fixture = fixture.replace('#define GAKUMAS_PASSIVE_CALLER_RVA() 0x07EFD634',
                                  'uintptr_t fixtureCaller=0;\n#define GAKUMAS_PASSIVE_CALLER_RVA() fixtureCaller')
        source = fixture[:fixture.index(' Run run{};')]
        source += r'''
 Run run{};run.id=1;run.sequence=sequence.addr();run.parameter=parameter.addr();
 run.controller=controller.addr();run.setupRecorded=true;active=&run;
 run.trace=std::make_shared<TraceStore>();run.trace->sequences[sequence.addr()]={};
 lineageHooksInstalled=true;exceptionHookInstalled=true;bindTraceSequence(sequence.addr());
 Obj playingProperty,handler,executionState,executionCommand,commandState,selectedSave,sibling;
 playingProperty.put(0,(uintptr_t)playingPropertyClass);
 sequence.put(0x70,playingProperty.addr());sequence.put(0x78,handler.addr());
 context.put(0x18,controller.addr());
 assert(sequenceForContext(context.addr())==sequence.addr());
 const uint32_t seed=0xf137be92;
 parameter.put<uint32_t>(0x570+4,seed);
 parameter.put<uint32_t>(0x570+0x18,uint32_t(0xf0d7ceb6));
 readBudget=64;int32_t decoded=0;
 assert(obscuredInt(parameter.addr(),0x570,decoded)&&decoded==1234);
 parameter.put<uint8_t>(0x58c,0);parameter.put<uint8_t>(0x5a8,0);
 executionState.put<int32_t>(0,-1);executionState.put(0x18,executionCommand.addr());
 executionState.put(0x20,sequence.addr());executionCommand.put<int32_t>(0x10,2);
 originalCommandExecution=[](uintptr_t sm,uintptr_t){
     parameter.put<int32_t>(0x1cc+0x18,25);
     traceBeginCard(sequence.addr(),card.addr());
     int32_t done=-2;memcpy((void*)sm,&done,4);
 };
 commandExecution(executionState.addr(),0);
 commandState.put<int32_t>(0,-1);commandState.put(0x18,sequence.addr());
 playingProperty.put<uint8_t>(0x10,1);
 originalCommandListMoveNext=[](uintptr_t sm,uintptr_t){int32_t done=-2;memcpy((void*)sm,&done,4);};
 commandListMoveNext(commandState.addr(),0);
 assert(commandCompletions==0&&reentrantCommandCompletionsIgnored==1);
 assert(run.trace->sequences[sequence.addr()].pendingCards.size()==1);
 // Checkpointing a saved pending action must not erase its cost baseline.
 run.trace->save(selectedSave.addr(),sequence.addr());
 run.trace->checkpoint(selectedSave.addr(),sequence.addr());
 assert(run.trace->load(sequence.addr(),selectedSave.addr()));
 assert(run.trace->sequences[sequence.addr()].pendingCards.size()==1);
 // Completion comes after cleanup but before the handler's inline save/load.
 executionState.put<int32_t>(0,-1);executionCommand.put<int32_t>(0x10,9);
 executionCommand.put(0x58,card.addr());executionCommand.put<uint8_t>(0xd0,0);
 parameter.put<uint32_t>(0x570+0x18,uint32_t(0xf0d7cf60));
 originalSeparateActivity=[ ](uint32_t slot,uintptr_t interfaceType,uintptr_t h,uint32_t start,uintptr_t c,uintptr_t cancel){
     assert(slot==15&&interfaceType==0x1234&&h&&start==0&&c==card.addr()&&cancel==0x5678);
     assert(active->trace->sequences[sequence.addr()].pendingCards.empty());
     active->trace->save(0xfeed,sequence.addr());
     ++effectForwarded;
     return ActivityTask{0xabc,0xdef};
 };
 originalCommandExecution=[](uintptr_t sm,uintptr_t){
     const auto result=separateActivity(15,0x1234,*(uintptr_t*)(sequence.data+0x78),0,card.addr(),0x5678);
     assert(result.source==0xabc&&result.token==0xdef);
     int32_t done=-2;memcpy((void*)sm,&done,4);
 };
 fixtureCaller=0x80dd8c8;
 commandExecution(executionState.addr(),0);
 assert(effectForwarded==1);
 // A second use of the SAME GUID is distinct, and retains the first completion
 // through native save/load even though the outer command list has not ended.
 assert(run.trace->load(sequence.addr(),0xfeed));
 traceBeginCard(sequence.addr(),card.addr());
 executionState.put<int32_t>(0,10); // suspended SeparateActivity resumption
 parameter.put<int32_t>(0x1cc+0x18,23);
 commandExecution(executionState.addr(),0);
 assert(effectForwarded==2&&run.trace->sequences[sequence.addr()].pendingCards.empty());
 // End handler repeats / non-card end / start marker must not duplicate records.
 originalSeparateActivity=[](uint32_t,uintptr_t,uintptr_t,uint32_t,uintptr_t,uintptr_t){++effectForwarded;return ActivityTask{0xabc,0xdef};};
 executionState.put<int32_t>(0,-1);commandExecution(executionState.addr(),0);
 assert(effectForwarded==3);
 run.trace->copy(sibling.addr(),sequence.addr());
 run.trace->append(sibling.addr(),"rejected-sibling",",\"card\":{\"guid\":\"guid-001\"}");
 run.trace->save(0xbad,sibling.addr());
 run.trace->save(selectedSave.addr(),sequence.addr());run.steps=1;
 publishSelectedTrace(run,selectedSave.addr());
 assert(run.trace->bytes==0&&run.trace->sequences.size()==1);
 assert(!run.trace->load(sibling.addr(),0xbad));
 // A wrong caller, handler, start marker or GUID cannot close a pending card.
 traceBeginCard(sequence.addr(),card.addr());
 executionState.put<int32_t>(0,-1);fixtureCaller=0x80dd8c4;
 commandExecution(executionState.addr(),0);
 assert(run.trace->sequences[sequence.addr()].pendingCards.size()==1);
 fixtureCaller=0x80dd8c8;executionState.put<int32_t>(0,-1);
 sequence.put<uintptr_t>(0x78,0);commandExecution(executionState.addr(),0);
 assert(run.trace->sequences[sequence.addr()].pendingCards.size()==1);
 sequence.put(0x78,handler.addr());
 readBudget=64;assert(!traceCardBoundary(sequence.addr(),0));
 executionState.put<int32_t>(0,-1);
 executionCommand.put<uint8_t>(0xd0,1);commandExecution(executionState.addr(),0);
 assert(run.trace->sequences[sequence.addr()].pendingCards.size()==1);
 // A list fallback is diagnostic ONLY; it must never claim per-card effects.
 playingProperty.put<uint8_t>(0x10,0);commandState.put<int32_t>(0,-1);
 commandListMoveNext(commandState.addr(),0);
 run.trace->save(selectedSave.addr(),sequence.addr());++run.steps;publishSelectedTrace(run,selectedSave.addr());
 assert(commandCompletions==1);
 // Unregistered shared runner calls preserve forwarding.
 runnerSlotOriginals[0]=[](uintptr_t,uintptr_t){++effectForwarded;};
 const auto beforeForward=effectForwarded;runnerResultSlot<0>(sequence.addr(),0);
 assert(effectForwarded==beforeForward+1);
 // No-card list successes allocate/write nothing; failures stay visible.
 const auto allocated=run.trace->bytes;const auto writes=written;
 for(unsigned i=0;i<100;++i){commandState.put<int32_t>(0,-1);commandListMoveNext(commandState.addr(),0);}
 assert(emptyCommandCompletionsSuppressed==100&&commandCompletions==101);
 assert(run.trace->bytes==allocated&&written==writes);
 traceCommandCompletion(sequence.addr(),false);
 run.trace->save(selectedSave.addr(),sequence.addr());++run.steps;publishSelectedTrace(run,selectedSave.addr());
 Obj escaped;text(escaped,u"ASCII \"\\\n日本");readBudget=64;bool stringOk=true;
 const auto encoded=string(escaped.addr(),stringOk);assert(stringOk);
 std::ofstream(path("escaped.json"))<<encoded;
 active=nullptr;
}
'''
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / 'test.cpp').write_text(source)
            subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                            '-Wno-misleading-indentation', '-fsanitize=address,undefined',
                            '-fno-pie', '-no-pie',
                            '-DGAKUMAS_CONTEST_CAPTURE_DIR="'+directory+'/"',
                            '-I', str(CPP), str(folder/'test.cpp'), '-o', str(folder/'test')], check=True)
            subprocess.run([str(folder/'test')], check=True,
                           env=dict(os.environ, ASAN_OPTIONS='detect_leaks=0'))
            rows = [json.loads(line) for line in (folder/'contest_capture.jsonl').read_text().splitlines()]
            self.assertEqual(json.loads((folder/'escaped.json').read_text()), 'ASCII "\\\n日本')
            self.assertNotIn('rejected-sibling' , [r['event'] for r in rows])
            completions = [r for r in rows if r['event']=='contest-card-use-complete']
            self.assertEqual(len(completions), 2)
            normal, repeated = completions
            for row in completions:
                self.assertTrue(row['selectedLineageVerified'])
                self.assertTrue(row['cardUseCompletionVerified'])
                self.assertTrue(row['completionBoundaryVerified'])
                self.assertFalse(row['commandListCompleted'])
                self.assertTrue(row['singleCardAction'])
            self.assertEqual(normal['beforeMetrics']['score'], 1234)
            self.assertEqual(normal['metrics']['score'], 1284)
            self.assertEqual(normal['beforeMetrics']['stamina'], 30)
            self.assertEqual(normal['metrics']['stamina'], 25)
            self.assertEqual(repeated['beforeMetrics']['stamina'], 25)
            self.assertEqual(repeated['metrics']['stamina'], 23)
            self.assertEqual(repeated['cardActionSerial'], normal['cardActionSerial']+1)
            incomplete = next(r for r in rows if r['event']=='contest-card-use-incomplete')
            self.assertFalse(incomplete['cardEffectsComplete'])
            self.assertFalse(incomplete['completionBoundaryVerified'])
            self.assertFalse(incomplete['lineageComplete'])
            self.assertNotIn('contest-command-list-complete', [r['event'] for r in rows])
            failure = next(r for r in rows if r['event']=='contest-command-list-failed')
            self.assertNotIn('metrics', failure)
            self.assertFalse(failure['lineageComplete'])


if __name__ == '__main__':
    unittest.main()
