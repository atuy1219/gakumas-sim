"""Host test for the opt-in LSPosed contest card-move RNG origin probe."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CPP = ROOT / "android/lsposed-progress-capture/src/main/cpp"

HOST = r'''
#include <array>
#include <atomic>
#include <cassert>
#include <cerrno>
#include <cstdint>
#include <mutex>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <map>
#include <sstream>
#include <string>
#include <sys/types.h>
#include <unistd.h>
#include <iostream>
std::atomic<uintptr_t> g_il2cpp_base{0};
const char* kV341BuildId = "77fda4e2a21f23954e2349b83fc113ede408f70b";
struct ImageInfo { uintptr_t base; std::string build_id; };
unsigned currentMask = 20608;
bool hook_enabled(unsigned flag) { return (currentMask & flag) != 0; }
bool atomic_write(const std::string&, const std::string&) {return true;}
namespace native_probe {
constexpr unsigned kRngOrigin = 16384, kExecution = 4096, kSetupProbe = 128;
}
namespace contest_capture {
struct Run {
  uint64_t id = 1;
  bool setupRecorded = true;
  uintptr_t parameter = 0;
  unsigned steps = 1;
};
thread_local Run* active = nullptr;
std::mutex mutex;
std::string last;
int emits = 0;
std::string path(const char* name) { return name; }
bool emit(const Run&, const char* event, const std::string& fields) {
  if (std::string(event) != "contest-rng-origin") return false;
  last = fields;
  ++emits;
  return true;
}
}
bool install_hook(uintptr_t, void*, void**) { return false; }
#include "contest_rng_origin.inc"
using namespace contest_rng_origin;
struct alignas(8) FakeParameter {
    uint8_t padding[0x77c]{};
    uint32_t state = 0x12345678;
};
FakeParameter model, cloneModel;
struct FakeContext {
    uint8_t padding[0x10]{};
    FakeParameter* parameter = nullptr;
};
static_assert(offsetof(FakeContext, parameter) == 0x10);
FakeContext context;
FakeParameter* currentModel = &model;
unsigned rollCount = 2;
unsigned origCalls = 0, effectCalls = 0;
int32_t actualRandom(void* obj, const void*) {
    ++origCalls;
    auto* p = reinterpret_cast<FakeParameter*>(obj);
    const uint32_t old = p->state;
    p->state = nextXorShift(p->state);
    return static_cast<int32_t>(old);
}
void actualEffect(uintptr_t x, uintptr_t y, uintptr_t z) {
    assert(x == 11 && y == reinterpret_cast<uintptr_t>(&context) && z == 33);
    ++effectCalls;
    assert(randomNoArg(currentModel, nullptr) == static_cast<int32_t>(0x12345678));
    for (unsigned i = 1; i < rollCount; ++i) (void)randomNoArg(currentModel, nullptr);
}
int main() {
    contest_capture::Run run;
    run.parameter = reinterpret_cast<uintptr_t>(&model);
    originalNoArg = actualRandom;
    originalEffect = actualEffect;
    context.parameter = &model;
    const uintptr_t contextPtr = reinterpret_cast<uintptr_t>(&context);
    // Outside scoped selected auto-play: original called, no capture.
    cardMoveEffect(11, contextPtr, 33);
    assert(effectCalls == 1 && origCalls == 2 && contest_capture::emits == 0);
    model.state = 0x12345678;
    origCalls = 0;
    contest_capture::active = &run;
    cardMoveEffect(11, contextPtr, 33);
    contest_capture::active = nullptr;
    assert(effectCalls == 2 && origCalls == 2 && contest_capture::emits == 1);
    const auto& report = contest_capture::last;
    assert(report.find("\"observedXorShiftSteps\":2") != std::string::npos);
    assert(report.find("\"capturedRandomCallCount\":2") != std::string::npos);
    assert(report.find("\"gameCallsInjected\":false") != std::string::npos);
    assert(report.find("\"index\":1") != std::string::npos);
    assert(report.find("\"index\":2") != std::string::npos);
    // DFS clone has a DIFFERENT parameter model from the selected Run,
    // exactly the case missed by v1.5.37.
    context.parameter = &cloneModel;
    currentModel = &cloneModel;
    rollCount = 4;
    origCalls = 0;
    contest_capture::active = &run;
    cardMoveEffect(11, contextPtr, 33);
    contest_capture::active = nullptr;
    assert(effectCalls == 3 && origCalls == 4 && contest_capture::emits == 2);
    assert(contest_capture::last.find("\"observedXorShiftSteps\":4") != std::string::npos);
    assert(contest_capture::last.find("\"capturedRandomCallCount\":4") != std::string::npos);
    assert(contest_capture::last.find("\"contextParameterMatched\":false") != std::string::npos);
    assert(contest_capture::last.find("\"contextParameterIsClone\":true") != std::string::npos);
    assert(model.state == nextXorShift(nextXorShift(0x12345678)));
    std::cout << "selected + DFS clone RNG origin probe: preserved original calls\n";
}
'''

class RngOriginProbeTests(unittest.TestCase):
    def test_real_include_forwards_original_exactly_once_and_records_scoped_rng(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "test.cpp"
            exe = Path(tmp) / "probe"
            path.write_text(HOST)
            subprocess.run(["g++", "-std=c++17", "-O0", "-Wall", "-Wextra", "-Werror",
                            "-I", str(CPP), str(path), "-o", str(exe)], check=True)
            subprocess.run([str(exe)], check=True)

    def test_mask_and_exposure(self):
        parser = (CPP / "native_probe.h").read_text()
        ui = (ROOT / "android/lsposed-progress-capture/src/main/java/dev/atuy1219/gakumas/progresscapture/DiagnosticActivity.java").read_text()
        main = (CPP / "progress_capture.cpp").read_text()
        self.assertIn("kRngOrigin = 16384", parser)
        self.assertIn("20608", ui)
        self.assertIn('#include "contest_rng_origin.inc"', main)
        self.assertIn("contest_rng_origin::install(image);", main)

if __name__ == "__main__":
    unittest.main()
