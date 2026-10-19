// v3.4.1 selected-contest, read-only RNG origin trace for CardMove effects.
// Opt-in mask: 128 (scoped setup) | 4096 (selected contest) | 16384 = 20608.
// No managed getters, extra RNG calls, synthetic play, or argument mutation.
namespace contest_rng_origin {
constexpr uintptr_t kCardMoveEffectRva = 0x0804BCA8;
constexpr uintptr_t kRandomNoArgRva = 0x0808A340;
constexpr uintptr_t kRandomRangeRva = 0x0808A438;
constexpr size_t kCallLimit = 48;
constexpr unsigned kSessionWindowLimit = 96;
constexpr unsigned kGlobalWindowLimit = 512;

using EffectFn = void (*)(uintptr_t, uintptr_t, uintptr_t);
using RandomNoArgFn = int32_t (*)(void*, const void*);
using RandomRangeFn = int32_t (*)(void*, int32_t, int32_t, const void*);
EffectFn originalEffect = nullptr;
RandomNoArgFn originalNoArg = nullptr;
RandomRangeFn originalRange = nullptr;
std::atomic<bool> attempted{false};
bool effectInstalled = false, noArgInstalled = false, rangeInstalled = false;
unsigned emittedWindows = 0, droppedWindows = 0;
std::map<uint64_t, unsigned> windowsPerSession;

struct Call {
    uintptr_t caller = 0;
    uint32_t before = 0, after = 0;
    int32_t result = 0, minimum = 0, maximum = 0;
    bool beforeReadable = false, afterReadable = false, ranged = false;
};
struct Window {
    contest_capture::Run* run = nullptr;
    uintptr_t context = 0, parameter = 0;
    bool selectedParameter = false;
    uint32_t before = 0, after = 0;
    bool beforeReadable = false, afterReadable = false;
    size_t kept = 0, total = 0;
    std::array<Call, kCallLimit> calls{};
};
thread_local Window* current = nullptr;

// process_vm_readv is passive and fails safely on a stale pointer. Preserve
// errno so this probe does not change the observed game's error state.
bool readState(void* parameter, uint32_t& state) {
    if (!parameter) return false;
    constexpr uintptr_t kRandomStateOffset = 0x77c; // pinned v3.4.1
    iovec dst{&state, sizeof(state)};
    iovec src{reinterpret_cast<void*>(reinterpret_cast<uintptr_t>(parameter) +
                                       kRandomStateOffset), sizeof(state)};
    const int saved = errno;
    const auto n = syscall(SYS_process_vm_readv, getpid(), &dst, 1, &src, 1, 0);
    errno = saved;
    return n == static_cast<ssize_t>(sizeof(state));
}
// The effect calculation context owns the RNG model being mutated. During
// automatic contest DFS this can be a clone, not Run::parameter.
bool contextParameter(uintptr_t context, uintptr_t& parameter) {
    if (!context || context > UINTPTR_MAX - 0x10u) return false;
    iovec dst{&parameter, sizeof(parameter)};
    iovec src{reinterpret_cast<void*>(context + 0x10u), sizeof(parameter)};
    const int saved = errno;
    const auto n = syscall(SYS_process_vm_readv, getpid(), &dst, 1, &src, 1, 0);
    errno = saved;
    return n == static_cast<ssize_t>(sizeof(parameter)) && parameter != 0;
}
uintptr_t callerRva(void* caller) {
    const uintptr_t address = reinterpret_cast<uintptr_t>(caller);
    const uintptr_t base = g_il2cpp_base.load(std::memory_order_relaxed);
    return base && address >= base ? address - base : 0;
}
std::string hexRva(uintptr_t rva) {
    std::ostringstream stream;
    stream << "0x" << std::hex << rva;
    return stream.str();
}
uint32_t nextXorShift(uint32_t x) {
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    return x;
}
int observedSteps(uint32_t before, uint32_t after) {
    if (before == after) return 0;
    for (int n = 1; n <= 256; ++n) {
        before = nextXorShift(before);
        if (before == after) return n;
    }
    return -1; // unknown, not zero
}
void collect(Window* w, void* parameter, bool ranged, int32_t minimum,
             int32_t maximum, int32_t result, uintptr_t caller,
             uint32_t before, bool beforeReadable,
             uint32_t after, bool afterReadable) {
    if (!w || !w->run || reinterpret_cast<uintptr_t>(parameter) != w->parameter)
        return; // exact calculation-context model, including DFS clones
    ++w->total;
    if (w->kept >= kCallLimit) return;
    Call& call = w->calls[w->kept++];
    call = {caller, before, after, result, minimum, maximum,
            beforeReadable, afterReadable, ranged};
}
__attribute__((noinline)) int32_t randomNoArg(void* self, const void* method) {
    Window* w = current;
    if (!w || !w->run || reinterpret_cast<uintptr_t>(self) != w->parameter)
        return originalNoArg(self, method);
    uint32_t before = 0, after = 0;
    const bool beforeOK = readState(self, before);
    const uintptr_t caller = callerRva(__builtin_extract_return_addr(__builtin_return_address(0)));
    const int32_t result = originalNoArg(self, method); // exactly once
    const bool afterOK = readState(self, after);
    collect(w, self, false, 0, 0, result, caller, before, beforeOK, after, afterOK);
    return result;
}
__attribute__((noinline)) int32_t randomRange(void* self, int32_t min, int32_t max,
                                               const void* method) {
    Window* w = current;
    if (!w || !w->run || reinterpret_cast<uintptr_t>(self) != w->parameter)
        return originalRange(self, min, max, method);
    uint32_t before = 0, after = 0;
    const bool beforeOK = readState(self, before);
    const uintptr_t caller = callerRva(__builtin_extract_return_addr(__builtin_return_address(0)));
    const int32_t result = originalRange(self, min, max, method); // exactly once
    const bool afterOK = readState(self, after);
    collect(w, self, true, min, max, result, caller, before, beforeOK, after, afterOK);
    return result;
}
__attribute__((noinline)) void cardMoveEffect(uintptr_t executor, uintptr_t context,
                                               uintptr_t method) {
    // This hook brackets the REAL CardMoveEffectExecutor.ExecuteEffect. A nested
    // effect on the same thread gets its own window; the previous is restored.
    contest_capture::Run* run = contest_capture::active;
    if (!run || !run->setupRecorded || !run->parameter) {
        originalEffect(executor, context, method);
        return;
    }
    // Reading Run::parameter filtered out the exact Tenpu+ card-move cases:
    // their effect executes in a separate native DFS ExamParameterModel clone.
    uintptr_t parameter = 0;
    if (!contextParameter(context, parameter)) {
        originalEffect(executor, context, method);
        return;
    }
    Window window;
    window.run = run;
    window.context = context;
    window.parameter = parameter;
    window.selectedParameter = parameter == run->parameter;
    window.beforeReadable = readState(reinterpret_cast<void*>(parameter), window.before);
    Window* previous = current;
    current = &window;
    originalEffect(executor, context, method); // exactly once, no lock held
    current = previous;
    window.afterReadable = readState(reinterpret_cast<void*>(parameter), window.after);

    // This might not be a Random-search effect; retain only windows with RNG
    // or an unexplained state transition. Never report calls as exhaustive if
    // the observed state changed without an intercepted call.
    if (window.total == 0 && (!window.beforeReadable || !window.afterReadable ||
                              window.before == window.after)) return;
    std::lock_guard<std::mutex> guard(contest_capture::mutex);
    unsigned& used = windowsPerSession[run->id];
    if (used >= kSessionWindowLimit || emittedWindows >= kGlobalWindowLimit) {
        ++droppedWindows;
        return;
    }
    ++used;
    ++emittedWindows;
    std::ostringstream out;
    out << ",\"capturePhase\":\"after-CardMoveEffectExecutor.ExecuteEffect\""
        << ",\"probe\":\"tenpu-rng-origin-v1\""
        << ",\"effectExecutor\":\"" << hexRva(kCardMoveEffectRva) << "\""
        << ",\"contextParameterReadable\":true"
        << ",\"contextParameterMatched\":" << (window.selectedParameter ? "true" : "false")
        << ",\"contextParameterIsClone\":" << (!window.selectedParameter ? "true" : "false")
        << ",\"selectedLineageVerified\":false"
        << ",\"randomBefore\":" << (window.beforeReadable ? std::to_string(window.before) : "null")
        << ",\"randomAfter\":" << (window.afterReadable ? std::to_string(window.after) : "null")
        << ",\"observedXorShiftSteps\":"
        << (window.beforeReadable && window.afterReadable
            ? std::to_string(observedSteps(window.before, window.after)) : "null")
        << ",\"capturedRandomCallCount\":" << window.total
        << ",\"truncated\":" << (window.total > kCallLimit ? "true" : "false")
        << ",\"randomCalls\":[";
    for (size_t i = 0; i < window.kept; ++i) {
        const Call& c = window.calls[i];
        if (i) out << ",";
        out << "{\"index\":" << i + 1
            << ",\"method\":\"" << (c.ranged ? "ExamParameterModel.GetRandomInt(range)"
                                            : "ExamParameterModel.GetRandomInt()") << "\""
            << ",\"callerRva\":\"" << hexRva(c.caller) << "\""
            << ",\"before\":" << (c.beforeReadable ? std::to_string(c.before) : "null")
            << ",\"after\":" << (c.afterReadable ? std::to_string(c.after) : "null")
            << ",\"result\":" << c.result;
        if (c.ranged) out << ",\"minimum\":" << c.minimum << ",\"maximum\":" << c.maximum;
        out << "}";
    }
    out << "],\"gameCallsInjected\":false,\"nativeEffectComplete\":false";
    contest_capture::emit(*run, "contest-rng-origin", out.str());
}
void install(const ImageInfo& image) {
    if (image.build_id != kV341BuildId ||
        !hook_enabled(native_probe::kRngOrigin) ||
        !hook_enabled(native_probe::kExecution) ||
        !hook_enabled(native_probe::kSetupProbe) || attempted.exchange(true)) return;
    // Exact-build pinned methods. Do not allow an outdated or partial game
    // hook to claim runtime verification.
    effectInstalled = install_hook(image.base + kCardMoveEffectRva,
        reinterpret_cast<void*>(cardMoveEffect),
        reinterpret_cast<void**>(&originalEffect));
    noArgInstalled = install_hook(image.base + kRandomNoArgRva,
        reinterpret_cast<void*>(randomNoArg),
        reinterpret_cast<void**>(&originalNoArg));
    rangeInstalled = install_hook(image.base + kRandomRangeRva,
        reinterpret_cast<void*>(randomRange),
        reinterpret_cast<void**>(&originalRange));
    std::ostringstream out;
    out << "{\"schemaVersion\":1,\"pid\":" << getpid()
        << ",\"libil2cppBuildId\":\"" << image.build_id << "\""
        << ",\"probe\":\"tenpu-rng-origin-v1\""
        << ",\"effectInstalled\":" << (effectInstalled ? "true" : "false")
        << ",\"randomNoArgInstalled\":" << (noArgInstalled ? "true" : "false")
        << ",\"randomRangeInstalled\":" << (rangeInstalled ? "true" : "false")
        << ",\"verifiedOnDevice\":false"
        << ",\"output\":\"contest_capture.jsonl\"}";
    atomic_write(contest_capture::path("contest_rng_origin_status.json"), out.str());
}
} // namespace contest_rng_origin
