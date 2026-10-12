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
        source = fixture[:fixture.index(' Run run{};')]
        source += r'''
 Run run{};run.id=1;run.sequence=sequence.addr();run.parameter=parameter.addr();
 run.controller=controller.addr();run.setupRecorded=true;active=&run;
 run.trace=std::make_shared<TraceStore>();run.trace->sequences[sequence.addr()]={};
 lineageHooksInstalled=true;exceptionHookInstalled=true;bindTraceSequence(sequence.addr());
 Obj playingProperty;
 playingProperty.put(0,(uintptr_t)playingPropertyClass);
 sequence.put(0x70,playingProperty.addr());
 context.put(0x18,controller.addr());
 assert(sequenceForContext(context.addr())==sequence.addr());
 // A genuine nonzero flipper seed: raw storage is never a valid score.
 const uint32_t seed=0xf137be92;
 parameter.put<uint32_t>(0x570+4,seed);
 parameter.put<uint32_t>(0x570+0x18,uint32_t(0xf0d7ceb6));
 readBudget=64;int32_t decoded=0;
 assert(obscuredInt(parameter.addr(),0x570,decoded)&&decoded==1234);
 parameter.put<uint8_t>(0x58c,0);
 parameter.put<uint8_t>(0x5a8,0);
 Obj executionState,executionCommand;
 executionState.put<int32_t>(0,-1);executionState.put(0x18,executionCommand.addr());
 executionState.put(0x20,sequence.addr());executionCommand.put<int32_t>(0x10,2);
 originalCommandExecution=[](uintptr_t sm,uintptr_t){
     parameter.put<int32_t>(0x1cc+0x18,25); // game's cost, before card builder
     traceBeginCard(sequence.addr(),card.addr());
     int32_t done=-2;memcpy((void*)sm,&done,4);
 };
 commandExecution(executionState.addr(),0);
 Obj commandState;
 commandState.put<int32_t>(0,-1);commandState.put(0x18,sequence.addr());
 // Nested ExecuteCommandList while the parent is playing immediately returns
 // -2 with unchanged metrics. It MUST preserve the pending card and baseline.
 playingProperty.put<uint8_t>(0x10,1);
 originalCommandListMoveNext=[](uintptr_t sm,uintptr_t){int32_t done=-2;memcpy((void*)sm,&done,4);};
 commandListMoveNext(commandState.addr(),0);
 assert(commandCompletions==0&&reentrantCommandCompletionsIgnored==1);
 assert(run.trace->sequences[sequence.addr()].pendingCards.size()==1);
 playingProperty.put<uint8_t>(0x10,0);commandState.put<int32_t>(0,-1);
 parameter.put<uint32_t>(0x570+0x18,uint32_t(0xf0d7cf60));
 originalCommandListMoveNext=[](uintptr_t sm,uintptr_t){int32_t done=-2;memcpy((void*)sm,&done,4);};
 commandListMoveNext(commandState.addr(),0);
 assert(commandCompletions==1);
 Obj sibling, selectedSave, rejectedSave;
 // Identical GUIDs on siblings must not cause candidate mixing.
 run.trace->copy(sibling.addr(),sequence.addr());
 run.trace->append(sibling.addr(),"rejected-sibling",",\"card\":{\"guid\":\"guid-001\"}");
 run.trace->save(rejectedSave.addr(),sibling.addr());
 run.trace->append(sequence.addr(),"selected-move",",\"marker\":1");
 run.trace->save(selectedSave.addr(),sequence.addr());
 run.steps=1;publishSelectedTrace(run,selectedSave.addr());
 assert(lineageSelectedEvents==3&&lineageSelectedSaves==1);
 assert(run.trace->bytes==0&&run.trace->sequences.size()==1);
 // Exact saved checkpoint loaded for a subsequent search. Unknown/reused
 // save addresses must erase old ancestry rather than silently inheriting it.
 assert(run.trace->load(sequence.addr(),selectedSave.addr()));
 assert(!run.trace->load(sibling.addr(),rejectedSave.addr()));
 run.trace->save(selectedSave.addr(),sibling.addr());
 assert(!run.trace->saves.count(selectedSave.addr()));
 // Unregistered classes sharing a generic runner entry still forward once.
 runnerSlotOriginals[0]=[](uintptr_t self,uintptr_t){assert(self==sequence.addr());++effectForwarded;};
 runnerResultSlot<0>(sequence.addr(),0);assert(effectForwarded==1);
 // A thrown/cancelled command list sets -2 too; it is not successful.
 traceBeginCard(sequence.addr(),card.addr());
 commandState.put<int32_t>(0,-1);
 originalBuilderException=[](uintptr_t,uintptr_t,uintptr_t){};
 originalCommandListMoveNext=[](uintptr_t sm,uintptr_t){
     builderException(sm+8,0x1234,0);
     int32_t done=-2;memcpy((void*)sm,&done,4);
 };
 commandListMoveNext(commandState.addr(),0);
 run.trace->save(selectedSave.addr(),sequence.addr());
 run.steps=2;publishSelectedTrace(run,selectedSave.addr());
 // Suspended SetResult resumes its parent inline. The snapshot must already
 // exist when that continuation creates/selects/disposes the native save.
 run.trace->sequences[sequence.addr()].complete=true;
 traceBeginCard(sequence.addr(),card.addr());
 Obj runner;runner.put(0,(uintptr_t)controllerClass);
 commandState.put<int32_t>(0,0);commandState.put(8,runner.addr());
 runnerClassOriginals[(uintptr_t)controllerClass]=[](uintptr_t,uintptr_t){
     assert(active->trace->sequences[sequence.addr()].pendingCards.empty());
     active->trace->save(0xfeed,sequence.addr());
     ++active->steps;publishSelectedTrace(*active,0xfeed);
 };
 originalCommandListMoveNext=[](uintptr_t sm,uintptr_t){
     int32_t done=-2;memcpy((void*)sm,&done,4);
     runnerResult(currentCommandFinish->runner,0);
 };
 commandListMoveNext(commandState.addr(),0);
 assert(commandCompletions==3);
 // Non-card success is a counter only. No metrics/pools/trace allocation.
 const auto allocated=run.trace->bytes;const auto writes=written;
 for(unsigned i=0;i<100;++i){
     commandState.put<int32_t>(0,-1);commandState.put<uintptr_t>(8,0);
     originalCommandListMoveNext=[](uintptr_t sm,uintptr_t){int32_t done=-2;memcpy((void*)sm,&done,4);};
     commandListMoveNext(commandState.addr(),0);
 }
 assert(emptyCommandCompletionsSuppressed==100&&commandCompletions==103);
 assert(run.trace->bytes==allocated&&written==writes);
 // Non-card failures remain compact diagnostic events and invalidate lineage.
 traceCommandCompletion(sequence.addr(),false);
 run.trace->save(0xbeef,sequence.addr());++run.steps;publishSelectedTrace(run,0xbeef);
 Obj escaped;
 text(escaped,u"ASCII \"\\\n日本");
 readBudget=64;bool stringOk=true;
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
            self.assertEqual(len(completions), 3)
            normal, failed, suspended = completions
            self.assertTrue(normal['selectedLineageVerified'])
            self.assertTrue(normal['cardUseCompletionVerified'])
            self.assertTrue(normal['completionBoundaryVerified'])
            self.assertEqual(normal['beforeMetrics']['score'], 1234)
            self.assertEqual(normal['metrics']['score'], 1284)
            self.assertEqual(normal['metrics']['turn'], 1)
            self.assertEqual(normal['beforeMetrics']['stamina'], 30)
            self.assertEqual(normal['metrics']['stamina'], 25)
            self.assertFalse(failed['completionSuccessVerified'])
            self.assertFalse(failed['cardEffectsComplete'])
            self.assertFalse(failed['lineageComplete'])
            self.assertTrue(suspended['completionSuccessVerified'])
            self.assertNotIn('contest-command-list-complete', [r['event'] for r in rows])
            failure = next(r for r in rows if r['event']=='contest-command-list-failed')
            self.assertNotIn('metrics', failure)
            self.assertFalse(failure['lineageComplete'])


if __name__ == '__main__':
    unittest.main()
