"""Run production identity bookkeeping against saved-origin and budget regressions."""
from pathlib import Path
import subprocess
import os
import tempfile
import unittest

CPP = Path(__file__).resolve().parents[1] / 'android/lsposed-progress-capture/src/main/cpp'

class LineageTests(unittest.TestCase):
    def test_saved_origin_reuse_and_budget_isolation(self):
        source = r'''
#include "scoped_lineage.h"
#include "native_probe.h"
#include <cassert>
using namespace scoped_lineage;
int main() {
    unsigned mask = 0;
    assert(native_probe::parse_mask("7808\n", mask) && mask == 7808);
    for (const char* bad : {"1", "7809", "4294967296", "7808junk"})
        assert(!native_probe::parse_mask(bad, mask));
    Book b; Budget budget;
    auto root = b.setup(0x1000,0x2000,"contest-auto-calculation");
    Owner first{0x3000,0x4000,root.sequence,root.parameter};
    auto exec = b.execution(root,first,0x5000,0x6000);
    assert(exec && exec.root.generation == 1);
    auto copied = b.clone(exec,0x7000,0x8000);
    assert(copied && copied.parent == exec.id);
    auto save = b.snapshot(0x9000,copied);
    assert(save && save.sourceId == copied.id);
    // Source addresses reused after the save do not destroy frozen ancestry.
    b.invalidate(exec.sequence); b.invalidate(copied.sequence); b.invalidate(root.sequence);
    assert(!b.current(root) && !b.current(exec) && !b.current(copied));
    auto loaded = b.reload(save,0xa000,0xb000);
    assert(loaded && loaded.root.generation == root.root.generation);
    assert(loaded.sequence != loaded.root.sequence);
    Owner second{0xc000,0xd000,loaded.sequence,loaded.parameter};
    auto next = b.execution(loaded,second,0xe000,0xf000);
    assert(next && next.originId == loaded.id);
    // A constructor reusing the SaveData address makes the saved epoch stale.
    b.forgetSnapshot(save.address);
    assert(!b.reload(save,0x10000,0x11000));
    // Setup on a reused sequence invalidates old executions, even same model.
    auto replacement = b.setup(loaded.sequence,loaded.parameter,"contest-auto-calculation");
    assert(replacement.id != loaded.id && !b.current(next));
    assert(!b.execution(loaded,second,0x12000,0x13000));
    // Wrong owner reference or model never binds a node to a nearby root.
    second.parameter ^= 0x10;
    assert(!b.execution(replacement,second,0x14000,0x15000));
    // Unknown origins cannot consume a known-origin model read allowance.
    for (unsigned i=0;i<115;++i) {
        assert(!budget.attempt(0));
        budget.reject(0xdead,0xbeef,0xface);
        assert(budget.cached(0xdead,0xbeef,0xface));
    }
    assert(budget.reads == 0);
    for (unsigned i=0;i<128;++i) assert(budget.attempt(root.id));
    assert(!budget.attempt(root.id));
    assert(budget.attempt(replacement.id));
    assert(!budget.cached(0xdead,0xbeef,0xffff));
    budget.accepted(0xdead); assert(!budget.cached(0xdead,0xbeef,0xface));
    // Both per-origin and absolute process bounds hold.
    for (unsigned id=100;id<200;++id) for(unsigned i=0;i<128;++i) budget.attempt(id);
    assert(budget.reads == Budget::globalLimit);
    for (unsigned i=0;i<Budget::ownerLimit;++i) assert(budget.ownerAttempt());
    assert(!budget.ownerAttempt());
    // Active storage is bounded; histories have monotonically increasing IDs.
    Book many;
    auto r=many.setup(0x1000,0x2000,"contest-auto-calculation");
    for(unsigned i=0;i<100;++i) {
        auto clone=many.clone(r,0x10000+16*i,0x20000+16*i);
        assert(clone); many.snapshot(0x30000+16*i,clone);
        Owner o{0x40000+16*i,0x50000,r.sequence,r.parameter};
        assert(many.execution(r,o,0x60000+16*i,0x70000+16*i));
    }
    assert(many.retained(Binding::Clone)==32);
    assert(many.retained(Binding::Execution)==64);
    assert(many.snapshots()==100);
    Binding updated;
    assert(many.update(r,0,2,updated));
    assert(!many.update(updated,0,2,updated));
    assert(many.update(updated,3,1,updated));
    assert(!many.update(updated,3,0,updated) && updated.end);
    // A shared model is ambiguous; neither sequence owns its observations.
    auto other=many.setup(0x90000,r.parameter,"other"); assert(other);
    assert(!many.parameter(r.parameter));
}
'''
        with tempfile.TemporaryDirectory() as d:
            p=Path(d); (p/'harness.cpp').write_text(source)
            subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-I',str(CPP),str(p/'harness.cpp'),'-o',str(p/'harness')],check=True)
            subprocess.run([str(p/'harness')],check=True,env=dict(os.environ,ASAN_OPTIONS="detect_leaks=0"))
