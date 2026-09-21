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

using GetterInt32Fn = int32_t (*)(void*, const void*);
using GetterBoolFn = bool (*)(void*, const void*);
using GetterObjectFn = void* (*)(void*, const void*);
struct RuntimeGetter {
    uintptr_t address = 0;
    const void* method = nullptr;
};
bool g_use_runtime_getters = false;
RuntimeGetter g_get_number;
RuntimeGetter g_get_produce_card_id;
RuntimeGetter g_get_upgrade_count;
RuntimeGetter g_get_deleted;
RuntimeGetter g_get_origin_type;
RuntimeGetter g_get_customizing;
RuntimeGetter g_get_customizes;

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

    if (g_use_runtime_getters) {
        if (!g_get_number.address || !g_get_produce_card_id.address ||
            !g_get_upgrade_count.address || !g_get_deleted.address || !g_get_origin_type.address) {
            return card;
        }
        card.number = reinterpret_cast<GetterInt32Fn>(g_get_number.address)(self, g_get_number.method);
        void* id_string = reinterpret_cast<GetterObjectFn>(g_get_produce_card_id.address)(
            self, g_get_produce_card_id.method);
        card.produce_card_id = il2cpp_string_to_utf8(id_string);
        card.upgrade_count = reinterpret_cast<GetterInt32Fn>(g_get_upgrade_count.address)(
            self, g_get_upgrade_count.method);
        card.deleted = reinterpret_cast<GetterBoolFn>(g_get_deleted.address)(
            self, g_get_deleted.method);
        card.origin_type = reinterpret_cast<GetterInt32Fn>(g_get_origin_type.address)(
            self, g_get_origin_type.method);
        if (g_get_customizing.address) {
            card.customizing = reinterpret_cast<GetterBoolFn>(g_get_customizing.address)(
                self, g_get_customizing.method);
        }
        if (g_get_customizes.address) {
            card.has_customizes = reinterpret_cast<GetterObjectFn>(g_get_customizes.address)(
                self, g_get_customizes.method) != nullptr;
        }
        return card;
    }

    // Verified offsets for the reference ELF; only used on that exact Build ID.
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
void write_status(const std::string& phase, const std::string& build_id = "", bool get_ok = false, bool merge_ok = false, bool deck_ok = false) {
    const int user_id = static_cast<int>(getuid() / 100000);
    const std::string path =
        "/data/user/" + std::to_string(user_id) + "/" + kTargetPackage +
        "/files/gakumas-sim/capture_status.json";
    std::ostringstream out;
    out << "{\n"
        << "  \"phase\": \"" << json_escape(phase) << "\",\n"
        << "  \"process\": \"" << json_escape(process_name()) << "\",\n"
        << "  \"libil2cppBuildId\": \"" << json_escape(build_id) << "\",\n"
        << "  \"expectedBuildId\": \"" << kExpectedBuildId << "\",\n"
        << "  \"hooks\": {"
        << "\"getProduceCardData\":" << (get_ok ? "true" : "false") << ","
        << "\"internalMergeFrom\":" << (merge_ok ? "true" : "false") << ","
        << "\"createDeck\":" << (deck_ok ? "true" : "false") << "}\n"
        << "}\n";
    atomic_write(path, out.str());
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
    std::string path;
    const ElfW(Phdr)* phdr = nullptr;
    ElfW(Half) phnum = 0;
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
    result->path = info->dlpi_name;
    result->phdr = info->dlpi_phdr;
    result->phnum = info->dlpi_phnum;
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


uintptr_t dynamic_ptr(uintptr_t base, ElfW(Addr) value) {
    // Some Android linkers expose already-relocated DT_* pointers, others retain
    // image-relative virtual addresses. Accept both forms.
    if (value >= base && value < base + (uintptr_t(1) << 40)) {
        return static_cast<uintptr_t>(value);
    }
    return base + static_cast<uintptr_t>(value);
}

size_t gnu_hash_symbol_count(const uint32_t* header) {
    if (!header) return 0;
    const uint32_t nbuckets = header[0];
    const uint32_t symoffset = header[1];
    const uint32_t bloom_size = header[2];
    const auto* bloom = reinterpret_cast<const ElfW(Addr)*>(header + 4);
    const auto* buckets = reinterpret_cast<const uint32_t*>(bloom + bloom_size);
    const auto* chains = buckets + nbuckets;
    uint32_t max_bucket = 0;
    for (uint32_t i = 0; i < nbuckets; ++i) max_bucket = std::max(max_bucket, buckets[i]);
    if (max_bucket < symoffset) return symoffset;
    uint32_t index = max_bucket;
    for (size_t guard = 0; guard < 10000000; ++guard, ++index) {
        if (chains[index - symoffset] & 1u) return static_cast<size_t>(index) + 1u;
    }
    return 0;
}

void* resolve_export(const ImageInfo& image, const char* wanted) {
    if (!image.base || !image.phdr || !wanted) return nullptr;
    const ElfW(Dyn)* dynamic = nullptr;
    for (ElfW(Half) i = 0; i < image.phnum; ++i) {
        const auto& ph = image.phdr[i];
        if (ph.p_type == PT_DYNAMIC) {
            dynamic = reinterpret_cast<const ElfW(Dyn)*>(image.base + ph.p_vaddr);
            break;
        }
    }
    if (!dynamic) return nullptr;

    const ElfW(Sym)* symtab = nullptr;
    const char* strtab = nullptr;
    const uint32_t* sysv_hash = nullptr;
    const uint32_t* gnu_hash = nullptr;
    size_t syment = sizeof(ElfW(Sym));
    for (const ElfW(Dyn)* d = dynamic; d->d_tag != DT_NULL; ++d) {
        switch (d->d_tag) {
            case DT_SYMTAB:
                symtab = reinterpret_cast<const ElfW(Sym)*>(dynamic_ptr(image.base, d->d_un.d_ptr));
                break;
            case DT_STRTAB:
                strtab = reinterpret_cast<const char*>(dynamic_ptr(image.base, d->d_un.d_ptr));
                break;
            case DT_HASH:
                sysv_hash = reinterpret_cast<const uint32_t*>(dynamic_ptr(image.base, d->d_un.d_ptr));
                break;
            case DT_GNU_HASH:
                gnu_hash = reinterpret_cast<const uint32_t*>(dynamic_ptr(image.base, d->d_un.d_ptr));
                break;
            case DT_SYMENT:
                syment = static_cast<size_t>(d->d_un.d_val);
                break;
            default:
                break;
        }
    }
    if (!symtab || !strtab || syment != sizeof(ElfW(Sym))) return nullptr;

    size_t symbol_count = 0;
    if (sysv_hash) symbol_count = sysv_hash[1];
    if (!symbol_count && gnu_hash) symbol_count = gnu_hash_symbol_count(gnu_hash);
    if (!symbol_count || symbol_count > 10000000) return nullptr;

    for (size_t i = 0; i < symbol_count; ++i) {
        const auto& sym = symtab[i];
        if (!sym.st_name || !sym.st_value) continue;
        const char* name = strtab + sym.st_name;
        if (std::strcmp(name, wanted) == 0) {
            return reinterpret_cast<void*>(image.base + static_cast<uintptr_t>(sym.st_value));
        }
    }
    return nullptr;
}

struct RuntimeIl2CppApi {
    using DomainGet = void* (*)();
    using DomainGetAssemblies = const void** (*)(const void*, size_t*);
    using AssemblyGetImage = const void* (*)(const void*);
    using ImageGetName = const char* (*)(const void*);
    using ClassFromName = void* (*)(const void*, const char*, const char*);
    using ClassGetMethodFromName = const void* (*)(void*, const char*, int);

    DomainGet domain_get = nullptr;
    DomainGetAssemblies domain_get_assemblies = nullptr;
    AssemblyGetImage assembly_get_image = nullptr;
    ImageGetName image_get_name = nullptr;
    ClassFromName class_from_name = nullptr;
    ClassGetMethodFromName class_get_method_from_name = nullptr;
};

bool load_runtime_il2cpp_api(const ImageInfo& image, RuntimeIl2CppApi& api) {
    api.domain_get = reinterpret_cast<RuntimeIl2CppApi::DomainGet>(
        resolve_export(image, "il2cpp_domain_get"));
    api.domain_get_assemblies = reinterpret_cast<RuntimeIl2CppApi::DomainGetAssemblies>(
        resolve_export(image, "il2cpp_domain_get_assemblies"));
    api.assembly_get_image = reinterpret_cast<RuntimeIl2CppApi::AssemblyGetImage>(
        resolve_export(image, "il2cpp_assembly_get_image"));
    api.image_get_name = reinterpret_cast<RuntimeIl2CppApi::ImageGetName>(
        resolve_export(image, "il2cpp_image_get_name"));
    api.class_from_name = reinterpret_cast<RuntimeIl2CppApi::ClassFromName>(
        resolve_export(image, "il2cpp_class_from_name"));
    api.class_get_method_from_name = reinterpret_cast<RuntimeIl2CppApi::ClassGetMethodFromName>(
        resolve_export(image, "il2cpp_class_get_method_from_name"));
    return api.domain_get && api.domain_get_assemblies && api.assembly_get_image &&
           api.image_get_name && api.class_from_name && api.class_get_method_from_name;
}

const void* find_assembly_csharp(const RuntimeIl2CppApi& api) {
    void* domain = api.domain_get();
    if (!domain) return nullptr;
    size_t count = 0;
    const void** assemblies = api.domain_get_assemblies(domain, &count);
    if (!assemblies || count == 0 || count > 4096) return nullptr;
    for (size_t i = 0; i < count; ++i) {
        const void* image = api.assembly_get_image(assemblies[i]);
        if (!image) continue;
        const char* name = api.image_get_name(image);
        if (name && std::strcmp(name, "Assembly-CSharp.dll") == 0) return image;
    }
    return nullptr;
}

uintptr_t resolve_managed_method(
    const RuntimeIl2CppApi& api,
    const void* assembly_image,
    const char* namespaze,
    const char* class_name,
    const char* method_name) {
    if (!assembly_image) return 0;
    void* klass = api.class_from_name(assembly_image, namespaze, class_name);
    if (!klass) return 0;
    const void* method = api.class_get_method_from_name(klass, method_name, -1);
    if (!method) return 0;
    return reinterpret_cast<uintptr_t>(*reinterpret_cast<void* const*>(method));
}


RuntimeGetter resolve_runtime_getter(
    const RuntimeIl2CppApi& api,
    const void* assembly_image,
    const char* namespaze,
    const char* class_name,
    const char* method_name) {
    RuntimeGetter result;
    if (!assembly_image) return result;
    void* klass = api.class_from_name(assembly_image, namespaze, class_name);
    if (!klass) return result;
    const void* method = api.class_get_method_from_name(klass, method_name, -1);
    if (!method) return result;
    result.method = method;
    result.address = reinterpret_cast<uintptr_t>(*reinterpret_cast<void* const*>(method));
    return result;
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
    if (!image.base) {
        write_status("waiting-for-libil2cpp");
        g_hooks_installed.store(false);
        return;
    }

    uintptr_t get_card_address = 0;
    uintptr_t create_deck_address = 0;
    bool merge_ok = false;

    if (image.build_id == kExpectedBuildId) {
        g_use_runtime_getters = false;
        // Exact ELF used during the original analysis: retain the verified RVAs.
        get_card_address = image.base + kRvaGetProduceCardData;
        create_deck_address = image.base + kRvaCreateDeckProduceCardMasters;
        merge_ok = install_hook(
            image.base + kRvaInternalMergeFrom,
            reinterpret_cast<void*>(hooked_internal_merge_from),
            reinterpret_cast<void**>(&g_orig_internal_merge_from));
    } else {
        // App update: resolve the managed methods from IL2CPP metadata instead of
        // guessing new RVAs from the old binary.
        RuntimeIl2CppApi api;
        if (!load_runtime_il2cpp_api(image, api)) {
            write_status("il2cpp-api-unavailable", image.build_id);
            g_hooks_installed.store(false);
            return;
        }
        const void* assembly_image = find_assembly_csharp(api);
        if (!assembly_image) {
            write_status("waiting-for-il2cpp-domain", image.build_id);
            g_hooks_installed.store(false);
            return;
        }
        get_card_address = resolve_managed_method(
            api,
            assembly_image,
            "Campus.Common.Proto.Client.Transaction",
            "UserProduceProgressProduceCard",
            "GetProduceCardData");
        create_deck_address = resolve_managed_method(
            api,
            assembly_image,
            "Campus.InGame",
            "ProduceUtility",
            "CreateDeckProduceCardMasters");

        const char* card_ns = "Campus.Common.Proto.Client.Transaction";
        const char* card_class = "UserProduceProgressProduceCard";
        g_get_number = resolve_runtime_getter(api, assembly_image, card_ns, card_class, "get_Number");
        g_get_produce_card_id = resolve_runtime_getter(api, assembly_image, card_ns, card_class, "get_ProduceCardId");
        g_get_upgrade_count = resolve_runtime_getter(api, assembly_image, card_ns, card_class, "get_UpgradeCount");
        g_get_deleted = resolve_runtime_getter(api, assembly_image, card_ns, card_class, "get_Deleted");
        g_get_origin_type = resolve_runtime_getter(api, assembly_image, card_ns, card_class, "get_OriginType");
        g_get_customizing = resolve_runtime_getter(api, assembly_image, card_ns, card_class, "get_Customizing");
        g_get_customizes = resolve_runtime_getter(api, assembly_image, card_ns, card_class, "get_Customizes");

        if (!get_card_address || !create_deck_address ||
            !g_get_number.address || !g_get_produce_card_id.address ||
            !g_get_upgrade_count.address || !g_get_deleted.address || !g_get_origin_type.address) {
            write_status("method-resolution-failed", image.build_id);
            g_hooks_installed.store(false);
            return;
        }
        g_use_runtime_getters = true;

        // InternalMergeFrom is diagnostic-only; deck capture does not require it.
        merge_ok = true;
    }

    const bool get_ok = install_hook(
        get_card_address,
        reinterpret_cast<void*>(hooked_get_card_data),
        reinterpret_cast<void**>(&g_orig_get_card_data));
    const bool deck_ok = install_hook(
        create_deck_address,
        reinterpret_cast<void*>(hooked_create_deck),
        reinterpret_cast<void**>(&g_orig_create_deck));

    write_status(
        (get_ok && deck_ok) ? "hooks-installed" : "hook-install-failed",
        image.build_id,
        get_ok,
        merge_ok,
        deck_ok);

    if (!(get_ok && deck_ok)) g_hooks_installed.store(false);
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
    write_status("native-init");

    // LSPosed may load this module after libil2cpp.so is already mapped.
    // Install immediately when possible, and also keep the load callback for
    // the normal early-module/late-il2cpp case.
    install_il2cpp_hooks();
    return on_library_loaded;
}
