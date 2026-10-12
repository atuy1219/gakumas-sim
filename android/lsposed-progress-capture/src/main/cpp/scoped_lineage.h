#pragma once
#include <cstdint>
#include <map>
#include <string>
#include <utility>

// Pure bookkeeping: no game calls, pointer dereferences, I/O or clock access.
// Runtime supplies only identities read through process_vm_readv.
namespace scoped_lineage {
using Address = uintptr_t;
struct Root {
    uint64_t generation = 0;
    Address sequence = 0, parameter = 0;
    std::string lane;
};
struct Binding {
    uint64_t id = 0, parent = 0;
    Root root;
    Address sequence = 0, parameter = 0, node = 0, simulator = 0;
    Address originSequence = 0, originParameter = 0;
    uint64_t originId = 0;
    enum Kind { Origin, Clone, Execution } kind = Origin;
    int examType = -1, replay = -1, phase = -1;
    bool end = false, setter = false, log = false;
    explicit operator bool() const { return id != 0; }
};
struct Snapshot {
    uint64_t id = 0, sourceId = 0;
    Root root;
    Address address = 0, sourceSequence = 0, sourceParameter = 0;
    explicit operator bool() const { return id != 0; }
};
struct Owner {
    Address node = 0, simulator = 0, sequence = 0, parameter = 0;
    bool operator==(const Owner& b) const {
        return node == b.node && simulator == b.simulator && sequence == b.sequence && parameter == b.parameter;
    }
};
struct Budget {
    static constexpr unsigned perOrigin = 128, globalLimit = 4096, ownerLimit = 4096;
    unsigned reads = 0, ownerReads = 0, drops = 0, negativeHits = 0;
    std::map<uint64_t, unsigned> origins;
    // A cache is scoped to a live owner read; a negative hit never establishes lineage.
    struct Negative { Address sequence, parameter; };
    std::map<Address, Negative> negative;
    bool ownerAttempt() {
        if (ownerReads >= ownerLimit) { ++drops; return false; }
        ++ownerReads; return true;
    }
    bool attempt(uint64_t origin) {
        if (!origin || reads >= globalLimit || origins[origin] >= perOrigin) { ++drops; return false; }
        ++reads; ++origins[origin]; return true;
    }
    bool cached(Address simulator, Address sequence, Address parameter) {
        const auto i = negative.find(simulator);
        if (i == negative.end() || i->second.sequence != sequence || i->second.parameter != parameter) return false;
        ++negativeHits; return true;
    }
    void reject(Address simulator, Address sequence, Address parameter) {
        if (negative.size() >= 64 && !negative.count(simulator)) negative.erase(negative.begin());
        negative[simulator] = {sequence, parameter};
    }
    void accepted(Address simulator) { negative.erase(simulator); }
};
class Book {
    std::map<Address, Binding> bindings_;
    std::map<Address, Snapshot> snapshots_;
    std::multimap<Address, Address> models_;
    void erase(Address sequence) {
        auto i=bindings_.find(sequence);
        if(i==bindings_.end())return;
        auto range=models_.equal_range(i->second.parameter);
        for(auto j=range.first;j!=range.second;) {
            if(j->second==sequence)j=models_.erase(j);else ++j;
        }
        bindings_.erase(i);
    }
    uint64_t next_ = 0, generation_ = 0, snapshot_ = 0;
    void trim(Binding::Kind kind, size_t cap) {
        size_t count = 0; Address oldest = 0; uint64_t id = UINT64_MAX;
        for (const auto& kv : bindings_) if (kv.second.kind == kind) {
            ++count; if (kv.second.id < id) { id = kv.second.id; oldest = kv.first; }
        }
        if (count >= cap && oldest) invalidate(oldest);
    }
    Binding put(Binding b) {
        invalidate(b.sequence);
        trim(b.kind, b.kind == Binding::Execution ? 64 : b.kind == Binding::Clone ? 32 : 128);
        b.id = ++next_; bindings_[b.sequence] = b;
        models_.emplace(b.parameter,b.sequence); return b;
    }
public:
    Binding sequence(Address a) const {
        auto i = bindings_.find(a); return i == bindings_.end() ? Binding{} : i->second;
    }
    Binding parameter(Address a) const {
        // Ambiguity fails closed; hot getters use an indexed lookup.
        auto range=models_.equal_range(a);
        if(range.first==range.second)return {};
        auto i=range.first; auto next=i; ++next;
        return next==range.second ? sequence(i->second) : Binding{};
    }
    bool current(const Binding& b) const {
        auto now = sequence(b.sequence); return b && now.id == b.id && now.parameter == b.parameter;
    }
    void invalidate(Address a) {
        const auto previous = sequence(a); erase(a);
        if (previous) for (auto i = bindings_.begin(); i != bindings_.end();) {
            if (i->second.originId == previous.id) {Address child=i->first; ++i; erase(child);} else ++i;
        }
    }
    Binding setup(Address sequence, Address parameter, const std::string& lane) {
        invalidate(sequence);
        if (!sequence || !parameter || generation_ >= 128) return {};
        Binding b; b.sequence = sequence; b.parameter = parameter;
        b.root = {++generation_, sequence, parameter, lane}; return put(b);
    }
    Binding clone(const Binding& from, Address result, Address parameter) {
        if (!current(from) || !result || !parameter || result == from.sequence) return {};
        Binding b; b.root = from.root; b.sequence = result; b.parameter = parameter;
        b.kind = Binding::Clone; b.parent = from.id; return put(b);
    }
    Binding execution(const Binding& origin, const Owner& owner, Address sequence, Address parameter) {
        if (!current(origin) || owner.sequence != origin.sequence || owner.parameter != origin.parameter ||
            !owner.node || !owner.simulator || !sequence || !parameter || sequence == origin.sequence) return {};
        Binding b; b.root = origin.root; b.sequence = sequence; b.parameter = parameter;
        b.kind = Binding::Execution; b.node = owner.node; b.simulator = owner.simulator;
        b.originSequence = owner.sequence; b.originParameter = owner.parameter; b.originId = origin.id;
        return put(b);
    }
    void forgetSnapshot(Address a) { snapshots_.erase(a); }
    Snapshot snapshot(Address address, const Binding& source) {
        forgetSnapshot(address);
        if (!address || !current(source)) return {};
        if (snapshots_.size() >= 128) {
            auto oldest = snapshots_.begin();
            for (auto i = snapshots_.begin(); i != snapshots_.end(); ++i)
                if (i->second.id < oldest->second.id) oldest = i;
            snapshots_.erase(oldest);
        }
        Snapshot s{++snapshot_, source.id, source.root, address, source.sequence, source.parameter};
        snapshots_[address] = s; return s;
    }
    Snapshot snapshot(Address a) const {
        auto i = snapshots_.find(a); return i == snapshots_.end() ? Snapshot{} : i->second;
    }
    Binding reload(const Snapshot& s, Address sequence, Address parameter) {
        // Frozen ancestry survives source sequence reuse. Constructor epochs,
        // not a currently live root address, determine snapshot identity.
        const auto now = snapshot(s.address);
        if (!s || now.id != s.id || !sequence || !parameter) return {};
        Binding b; b.root = s.root; b.sequence = sequence; b.parameter = parameter;
        b.parent = s.sourceId; return put(b);
    }
    bool update(const Binding& old, int field, int value, Binding& result) {
        if (!current(old)) return false;
        auto& b = bindings_.at(old.sequence); bool changed = false;
        switch (field) {
            case 0: changed = b.examType != value; b.examType = value; break;
            case 1: changed = b.replay != value; b.replay = value; break;
            case 2: changed = b.phase != value; b.phase = value; break;
            case 3: changed = !b.end && value; b.end = b.end || value; break;
            case 4: changed = !b.setter && value; b.setter = b.setter || value; break;
            case 5: changed = !b.log && value; b.log = b.log || value; break;
        }
        result = b; return changed;
    }
    uint64_t generations() const { return generation_; }
    size_t retained(Binding::Kind kind) const {
        size_t n = 0; for (const auto& kv : bindings_) if (kv.second.kind == kind) ++n; return n;
    }
    size_t snapshots() const { return snapshots_.size(); }
};
} // namespace scoped_lineage
