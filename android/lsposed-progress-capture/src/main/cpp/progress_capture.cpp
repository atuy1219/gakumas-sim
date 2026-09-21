#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <dlfcn.h>
#include <elf.h>
#include <fstream>
#include <iomanip>
#include <link.h>
#include <map>
#include <mutex>
#include <sstream>
#include <string>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#include <utility>
#include <vector>

namespace {

constexpr const char* kTargetPackage = "com.bandainamcoent.idolmaster_gakuen";
constexpr const char* kExpectedBuildId = "c94ab574cfe2d62da43ec6167db4d96d429b18f8";
constexpr uintptr_t kRvaCreateDeckProduceCardMasters = 0x077C7018;
constexpr uintptr_t kRvaGetProduceCardData = 0x074DBEE0;
constexpr uintptr_t kRvaInternalMergeFrom = 0x074DBAB0;

constexpr size_t kOffsetNumber = 0x18;
constexpr size_t kOffsetProduceCardId = 0x20;
constexpr size_t kOffsetUpgradeCount = 0x28;
constexpr size_t kOffsetDeleted = 0x2C;
constexpr size_t kOffsetOriginType = 0x30;
constexpr size_t kOffsetCustomizes = 0x38;
constexpr size_t kOffsetCustomizing = 0x40;

using HookFunType = int (*)(void* func, void* replace, void** backup);
using UnhookFunType = int (*)(void* func);
using NativeOnModuleLoaded = void (*)(const char* name, void* handle);
struct NativeAPIEntries {
    uint32_t version;
    HookFunType hookFunc;
    UnhookFunType unhookFunc;
};

struct CardRecord {
    int32_t number = 0;
    std::string produce_card_id;
    int32_t upgrade_count = 0;
    bool deleted = false;
    int32_t origin_type = 0;
    bool customizing = false;
    bool has_customizes = false;
};

HookFunType g_hook = nullptr;
std::atomic<bool> g_hooks_installed{false};
std::mutex g_seen_mutex;
std::map<int32_t, CardRecord> g_seen_by_number;
thread_local int g_capture_depth = 0;
thread_local std::vector<CardRecord> g_capture_cards;

using CreateDeckFn = void* (*)(void*, void*);
using GetProduceCardDataFn = void* (*)(void*, void*);
using InternalMergeFromFn = void (*)(void*, void*, void*);
CreateDeckFn g_orig_create_deck = nullptr;
GetProduceCardDataFn g_orig_get_card_data = nullptr;
InternalMergeFromFn g_orig_internal_merge_from = nullptr;

std::string process_name() {
    std::ifstream in("/proc/self/cmdline", std::ios::binary);
    std::string value;
    std::getline(in, value, '\0');
    return value;
}

bool target_process() {
    return process_name() == kTargetPackage;
}

std::string json_escape(const std::string& value) {
    std::ostringstream out;
    for (unsigned char ch : value) {
        switch (ch) {
            case '\\': out << "\\\\"; break;
            case '"': out << "\\\""; break;
            case '\b': out << "\\b"; break;
            case '\f': out << "\\f"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (ch < 0x20) {
                    out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(ch)
                        << std::dec << std::setfill(' ');
                } else {
                    out << static_cast<char>(ch);
                }
        }
    }
    return out.str();
}

void append_utf8(std::string& out, uint32_t cp) {
    if (cp <= 0x7F) {
        out.push_back(static_cast<char>(cp));
    } else if (cp <= 0x7FF) {
        out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp <= 0xFFFF) {
        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
}

std::string il2cpp_string_to_utf8(void* string_object) {
    if (!string_object) return {};
    const auto* base = static_cast<const uint8_t*>(string_object);
    const int32_t length = *reinterpret_cast<const int32_t*>(base + 0x10);
    if (length < 0 || length > 1024) return {};
    const auto* chars = reinterpret_cast<const char16_t*>(base + 0x14);
    std::string result;
    result.reserve(static_cast<size_t>(length));
    for (int32_t i = 0; i < length; ++i) {
        uint32_t cp = chars[i];
        if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < length) {
            const uint32_t low = chars[i + 1];
            if (low >= 0xDC00 && low <= 0xDFFF) {
                cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                ++i;
            }
        }
        append_utf8(result, cp);
    }
    return result;
}

CardRecord read_card(void* self) {
    CardRecord card;
    if (!self) return card;
    const auto* base = static_cast<const uint8_t*>(self);
    card.number = *reinterpret_cast<const int32_t*>(base + kOffsetNumber);
    void* id_string = *reinterpret_cast<void* const*>(base + kOffsetProduceCardId);
    card.produce_card_id = il2cpp_string_to_utf8(id_string);
    card.upgrade_count = *reinterpret_cast<const int32_t*>(base + kOffsetUpgradeCount);
    card.deleted = *(base + kOffsetDeleted) != 0;
    card.origin_type = *reinterpret_cast<const int32_t*>(base + kOffsetOriginType);
    card.has_customizes = *reinterpret_cast<void* const*>(base + kOffsetCustomizes) != nullptr;
    card.customizing = *(base + kOffsetCustomizing) != 0;
    return card;
}

void remember_card(const CardRecord& card) {
    if (card.number <= 0 || card.produce_card_id.empty()) return;
    std::lock_guard<std::mutex> lock(g_seen_mutex);
    g_seen_by_number[card.number] = card;
}

std::string card_json(const CardRecord& card) {
    std::ostringstream out;
    out << "{"
        << "\"number\":" << card.number << ","
        << "\"produceCardId\":\"" << json_escape(card.produce_card_id) << "\","
        << "\"upgradeCount\":" << card.upgrade_count << ","
        << "\"deleted\":" << (card.deleted ? "true" : "false") << ","
        << "\"originType\":" << card.origin_type << ","
        << "\"customizing\":" << (card.customizing ? "true" : "false") << ","
        << "\"hasCustomizes\":" << (card.has_customizes ? "true" : "false")
        << "}";
    return out.str();
}

void mkdir_if_needed(const std::string& path) {
    if (::mkdir(path.c_str(), 0700) == 0) return;
}

std::vector<std::string> output_paths() {
    const int user_id = static_cast<int>(getuid() / 100000);
    const std::string user = std::to_string(user_id);
    return {
        "/data/user/" + user + "/" + kTargetPackage + "/files/gakumas-sim/produce_cards.json",
        "/storage/emulated/" + user + "/Android/data/" + kTargetPackage + "/files/gakumas-sim/produce_cards.json",
    };
}

void ensure_parent_dir(const std::string& file_path) {
    const auto slash = file_path.rfind('/');
    if (slash == std::string::npos) return;
    const std::string target = file_path.substr(0, slash);
    size_t pos = 1;
    while ((pos = target.find('/', pos)) != std::string::npos) {
        mkdir_if_needed(target.substr(0, pos));
        ++pos;
    }
    mkdir_if_needed(target);
}

void atomic_write(const std::string& path, const std::string& data) {
    ensure_parent_dir(path);
    const std::string temp = path + ".tmp";
    {
        std::ofstream out(temp, std::ios::binary | std::ios::trunc);
        if (!out) return;
        out.write(data.data(), static_cast<std::streamsize>(data.size()));
        out.flush();
        if (!out) return;
    }
    ::rename(temp.c_str(), path.c_str());
}

int64_t unix_time_ms() {
    timespec ts{};
    clock_gettime(CLOCK_REALTIME, &ts);
    return static_cast<int64_t>(ts.tv_sec) * 1000 + ts.tv_nsec / 1000000;
}

void write_snapshot(std::vector<CardRecord> deck) {
    deck.erase(std::remove_if(deck.begin(), deck.end(), [](const CardRecord& card) {
        return card.number <= 0 || card.produce_card_id.empty() || card.deleted;
    }), deck.end());
    std::stable_sort(deck.begin(), deck.end(), [](const CardRecord& a, const CardRecord& b) {
        return a.number < b.number;
    });
    deck.erase(std::unique(deck.begin(), deck.end(), [](const CardRecord& a, const CardRecord& b) {
        return a.number == b.number;
    }), deck.end());
    if (deck.empty()) return;

    std::vector<CardRecord> seen;
    {
        std::lock_guard<std::mutex> lock(g_seen_mutex);
        for (const auto& [number, card] : g_seen_by_number) seen.push_back(card);
    }

    std::ostringstream out;
    out << "{\n"
        << "  \"format\": \"gakumas-sim-progress-capture\",\n"
        << "  \"version\": 1,\n"
        << "  \"capturedAtUnixMs\": " << unix_time_ms() << ",\n"
        << "  \"source\": \"LSPosed native hook / CreateDeckProduceCardMasters\",\n"
        << "  \"packageName\": \"" << kTargetPackage << "\",\n"
        << "  \"libil2cppBuildId\": \"" << kExpectedBuildId << "\",\n"
        << "  \"ordering\": \"Deleted=false, Number ascending (native deck construction order)\",\n"
        << "  \"produceCards\": [\n";
    for (size_t i = 0; i < deck.size(); ++i) {
        out << "    " << card_json(deck[i]) << (i + 1 == deck.size() ? "" : ",") << "\n";
    }
    out << "  ],\n"
        << "  \"observedInstances\": [\n";
    for (size_t i = 0; i < seen.size(); ++i) {
        out << "    " << card_json(seen[i]) << (i + 1 == seen.size() ? "" : ",") << "\n";
    }
    out << "  ]\n"
        << "}\n";

    const std::string json = out.str();
    for (const auto& path : output_paths()) atomic_write(path, json);
}

struct ImageInfo {
    uintptr_t base = 0;
    std::string build_id;
};

std::string bytes_to_hex(const uint8_t* data, size_t size) {
    static constexpr char hex[] = "0123456789abcdef";
    std::string out;
    out.resize(size * 2);
    for (size_t i = 0; i < size; ++i) {
        out[i * 2] = hex[(data[i] >> 4) & 0xF];
        out[i * 2 + 1] = hex[data[i] & 0xF];
    }
    return out;
}

size_t align4(size_t value) {
    return (value + 3u) & ~size_t(3u);
}

int image_callback(dl_phdr_info* info, size_t, void* opaque) {
    if (!info || !info->dlpi_name || !std::strstr(info->dlpi_name, "libil2cpp.so")) return 0;
    auto* result = static_cast<ImageInfo*>(opaque);
    result->base = static_cast<uintptr_t>(info->dlpi_addr);
    for (ElfW(Half) i = 0; i < info->dlpi_phnum; ++i) {
        const auto& ph = info->dlpi_phdr[i];
        if (ph.p_type != PT_NOTE) continue;
        const auto* cursor = reinterpret_cast<const uint8_t*>(info->dlpi_addr + ph.p_vaddr);
        const auto* end = cursor + ph.p_memsz;
        while (cursor + sizeof(ElfW(Nhdr)) <= end) {
            const auto* note = reinterpret_cast<const ElfW(Nhdr)*>(cursor);
            cursor += sizeof(ElfW(Nhdr));
            if (cursor + align4(note->n_namesz) + align4(note->n_descsz) > end) break;
            const char* name = reinterpret_cast<const char*>(cursor);
            cursor += align4(note->n_namesz);
            const uint8_t* desc = cursor;
            cursor += align4(note->n_descsz);
            if (note->n_type == NT_GNU_BUILD_ID && note->n_namesz >= 3 && std::memcmp(name, "GNU", 3) == 0) {
                result->build_id = bytes_to_hex(desc, note->n_descsz);
                return 1;
            }
        }
    }
    return 1;
}

ImageInfo find_il2cpp_image() {
    ImageInfo info;
    dl_iterate_phdr(image_callback, &info);
    return info;
}

void* hooked_get_card_data(void* self, void* method) {
    const CardRecord card = read_card(self);
    remember_card(card);
    if (g_capture_depth > 0 && !card.deleted) g_capture_cards.push_back(card);
    return g_orig_get_card_data(self, method);
}

void hooked_internal_merge_from(void* self, void* parse_context, void* method) {
    g_orig_internal_merge_from(self, parse_context, method);
    remember_card(read_card(self));
}

void* hooked_create_deck(void* a0, void* a1) {
    const bool outermost = g_capture_depth == 0;
    if (outermost) g_capture_cards.clear();
    ++g_capture_depth;
    void* result = g_orig_create_deck(a0, a1);
    --g_capture_depth;
    if (outermost) write_snapshot(g_capture_cards);
    return result;
}

bool install_hook(uintptr_t address, void* replacement, void** original) {
    if (!g_hook || address == 0) return false;
    return g_hook(reinterpret_cast<void*>(address), replacement, original) == 0 && *original != nullptr;
}

void install_il2cpp_hooks() {
    if (g_hooks_installed.exchange(true)) return;
    if (!target_process()) return;

    const ImageInfo image = find_il2cpp_image();
    if (!image.base || image.build_id != kExpectedBuildId) {
        g_hooks_installed.store(false);
        return;
    }

    const bool get_ok = install_hook(
        image.base + kRvaGetProduceCardData,
        reinterpret_cast<void*>(hooked_get_card_data),
        reinterpret_cast<void**>(&g_orig_get_card_data));
    const bool merge_ok = install_hook(
        image.base + kRvaInternalMergeFrom,
        reinterpret_cast<void*>(hooked_internal_merge_from),
        reinterpret_cast<void**>(&g_orig_internal_merge_from));
    const bool deck_ok = install_hook(
        image.base + kRvaCreateDeckProduceCardMasters,
        reinterpret_cast<void*>(hooked_create_deck),
        reinterpret_cast<void**>(&g_orig_create_deck));

    if (!(get_ok && merge_ok && deck_ok)) {
        // Partial hooks are intentionally left untouched: the expected build ID matched,
        // but no state-changing behavior is introduced. A restart after updating the module
        // is the recovery path.
    }
}

void on_library_loaded(const char* name, void*) {
    if (!name) return;
    const char* base = std::strrchr(name, '/');
    base = base ? base + 1 : name;
    if (std::strcmp(base, "libil2cpp.so") == 0) install_il2cpp_hooks();
}

}  // namespace

extern "C" __attribute__((visibility("default")))
NativeOnModuleLoaded native_init(const NativeAPIEntries* entries) {
    if (!entries || !entries->hookFunc || entries->version < 1) return nullptr;
    if (!target_process()) return nullptr;
    g_hook = entries->hookFunc;

    // LSPosed may load this module after libil2cpp.so is already mapped.
    // Install immediately when possible, and also keep the load callback for
    // the normal early-module/late-il2cpp case.
    install_il2cpp_hooks();
    return on_library_loaded;
}
