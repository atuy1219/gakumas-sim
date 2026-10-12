#pragma once
#include <cctype>
#include <cstdint>
#include <string>

namespace native_probe {
// Legacy game hooks have unverified ABI/state handling. Accept only the
// observation probe and an opt-in hook of our OWN pure native function.
constexpr unsigned kSetupProbe = 128;
constexpr unsigned kSelfTest = 256;
constexpr unsigned kMode = 512, kEndPaths = 1024, kClone = 2048, kExecution = 4096;
constexpr unsigned kDetailLog = 8192;
constexpr unsigned kAllowed = kSetupProbe | kSelfTest | kMode | kEndPaths | kClone | kExecution | kDetailLog;
inline bool parse_mask(const std::string& text, unsigned& mask) {
    size_t i = 0;
    while (i < text.size() && std::isspace(static_cast<unsigned char>(text[i]))) ++i;
    if (i == text.size() || !std::isdigit(static_cast<unsigned char>(text[i]))) return false;
    unsigned value = 0;
    while (i < text.size() && std::isdigit(static_cast<unsigned char>(text[i]))) {
        value = value * 10 + (text[i++] - '0');
        if (value > kAllowed) return false;
    }
    while (i < text.size() && std::isspace(static_cast<unsigned char>(text[i]))) ++i;
    if (i != text.size() || (value & ~kAllowed)) return false;
    mask = value;
    return true;
}
inline bool self_test_passed(bool installed, bool backup_available,
                             unsigned calls, int baseline, int original, int detoured) {
    return installed && backup_available && calls == 1 && original == baseline
        && detoured == baseline + 1;
}
}  // namespace native_probe
