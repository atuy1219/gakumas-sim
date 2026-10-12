#pragma once
#include <algorithm>
#include <cstdint>
#include <memory>
#include <map>
#include <set>
#include <string>
#include <vector>

// Native object addresses are keys only. Nodes contain copied text, never live
// managed pointers. Immutable parents let sibling DFS branches share ancestry.
namespace contest_capture {
struct TraceNode {
    uint64_t id=0;
    std::shared_ptr<const TraceNode> previous;
    std::string event, fields;
};
struct TraceBranch {
    std::shared_ptr<const TraceNode> head;
    std::vector<std::string> pendingCards;
    std::string beforeCardMetrics="null",nextCardBefore="null";
    uintptr_t nextCardCommand=0;
    uintptr_t parameter=0,controller=0;
    unsigned serial=0;
    bool complete=true;
};
struct TraceStore {
    std::map<uintptr_t,TraceBranch> sequences, saves;
    std::set<uint64_t> published;
    uint64_t nextNode=0;
    size_t bytes=0;
    bool overflow=false;
    static constexpr size_t kByteLimit=64*1024*1024;
    static constexpr size_t kIdentityLimit=8192;
    bool append(uintptr_t sequence,const std::string& event,const std::string& fields) {
        auto it=sequences.find(sequence);
        if(it==sequences.end())return false;
        const size_t n=event.size()+fields.size()+sizeof(TraceNode);
        if(bytes+n>kByteLimit){overflow=true;it->second.complete=false;return false;}
        auto node=std::make_shared<TraceNode>();
        node->id=++nextNode;node->previous=it->second.head;
        node->event=event;node->fields=fields;
        it->second.head=std::move(node);bytes+=n;return true;
    }
    bool copy(uintptr_t target,uintptr_t source) {
        auto it=sequences.find(source);
        if(it==sequences.end()){sequences.erase(target);return false;}
        if(!sequences.count(target)&&sequences.size()>=kIdentityLimit){overflow=true;return false;}
        // Copy before replacing: source and target can be the same object.
        const auto branch=it->second;sequences[target]=branch;return true;
    }
    void save(uintptr_t target,uintptr_t sequence) {
        auto it=sequences.find(sequence);
        // A reused managed address must never retain an earlier object's trace.
        if(it==sequences.end()){saves.erase(target);return;}
        if(!saves.count(target)&&saves.size()>=kIdentityLimit){overflow=true;return;}
        saves[target]=it->second;
    }
    bool load(uintptr_t sequence,uintptr_t saved) {
        auto it=saves.find(saved);
        if(it==saves.end()){sequences.erase(sequence);return false;}
        if(!sequences.count(sequence)&&sequences.size()>=kIdentityLimit){overflow=true;return false;}
        const auto branch=it->second;sequences[sequence]=branch;return true;
    }
    std::vector<std::shared_ptr<const TraceNode>> selected(uintptr_t saved) const {
        std::vector<std::shared_ptr<const TraceNode>> out;
        auto it=saves.find(saved);if(it==saves.end())return out;
        for(auto n=it->second.head;n;n=n->previous)
            if(!published.count(n->id))out.push_back(n);
        std::reverse(out.begin(),out.end());return out;
    }
    void checkpoint(uintptr_t saved,uintptr_t sequence) {
        auto it=saves.find(saved);if(it==saves.end())return;
        auto branch=it->second;branch.head.reset();branch.pendingCards.clear();
        branch.beforeCardMetrics="null";branch.nextCardBefore="null";branch.nextCardCommand=0;
        sequences.clear();saves.clear();published.clear();bytes=0;
        sequences[sequence]=branch;saves[saved]=branch;
    }
};
} // namespace contest_capture
