#!/usr/bin/env python3
"""Losslessly encode/decode repeated ranking replay state snapshots as JSON deltas.

Usage:
  python tools/compact_ranking_replay.py compact capture.json -o compact.json
  python tools/compact_ranking_replay.py expand compact.json -o restored.json
  python tools/compact_ranking_replay.py verify capture.json compact.json

The compact format is NOT directly consumable as the original capture format.
Use 'expand' before feeding it into replay tools that expect original events.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

FORMAT = "gakumas-ranking-replay-state-delta-v1"
# Each patch is an ordered [opcode, key-path, optional value] tuple.
# Dicts are traversed, but lists are replaced atomically when they change.


def diff(old: Any, new: Any, path: list[str], changes: list[list[Any]]) -> None:
    if type(old) is not type(new):
        changes.append(["s", path, new])
        return
    if isinstance(new, dict):
        for key in old.keys() - new.keys():
            changes.append(["d", path + [key]])
        for key, value in new.items():
            if key not in old:
                changes.append(["s", path + [key], value])
            else:
                diff(old[key], value, path + [key], changes)
    elif old != new:
        changes.append(["s", path, new])


def apply_patch(old: Any, changes: list[list[Any]]) -> Any:
    result = copy.deepcopy(old)
    for entry in changes:
        op, path = entry[:2]
        if not path:
            if op != "s" or len(entry) != 3:
                raise ValueError("invalid root patch")
            result = copy.deepcopy(entry[2])
            continue
        target = result
        for key in path[:-1]:
            target = target[key]
        if op == "d" and len(entry) == 2:
            del target[path[-1]]
        elif op == "s" and len(entry) == 3:
            target[path[-1]] = copy.deepcopy(entry[2])
        else:
            raise ValueError("invalid delta entry")
    return result


def compact(document: dict[str, Any]) -> dict[str, Any]:
    if document.get("scope") != "audition-replay-capture":
        raise ValueError("not an audition replay capture")
    if not isinstance(document.get("events"), list):
        raise ValueError("capture has no events list")
    result = {key: value for key, value in document.items() if key != "events"}
    result["_deltaCodec"] = FORMAT
    history: dict[Any, Any] = {}
    events: list[dict[str, Any]] = []
    for event in document["events"]:
        encoded = {key: value for key, value in event.items() if key != "state"}
        if "state" in event:
            session = event.get("sessionId")
            state = event["state"]
            if session in history:
                changes: list[list[Any]] = []
                diff(history[session], state, [], changes)
                encoded["_statePatch"] = changes
            else:
                encoded["state"] = state
            history[session] = state
        events.append(encoded)
    result["events"] = events
    return result


def expand(document: dict[str, Any]) -> dict[str, Any]:
    if document.get("_deltaCodec") != FORMAT:
        raise ValueError("unrecognized delta codec")
    result = {key: value for key, value in document.items() if key not in {"_deltaCodec", "events"}}
    history: dict[Any, Any] = {}
    events: list[dict[str, Any]] = []
    for event in document["events"]:
        decoded = {key: value for key, value in event.items() if key != "_statePatch"}
        session = event.get("sessionId")
        if "_statePatch" in event:
            if session not in history:
                raise ValueError("state patch without a baseline")
            state = apply_patch(history[session], event["_statePatch"])
            decoded["state"] = state
            history[session] = state
        elif "state" in event:
            history[session] = event["state"]
        events.append(decoded)
    result["events"] = events
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["compact", "expand", "verify"])
    parser.add_argument("source", type=Path)
    parser.add_argument("target", nargs="?", type=Path, help="compact file, for verify")
    parser.add_argument("-o", "--output", type=Path)
    args = parser.parse_args()
    with args.source.open("r", encoding="utf-8") as stream:
        original = json.load(stream)
    if args.mode == "verify":
        if not args.target:
            parser.error("verify needs compact-file")
        with args.target.open("r", encoding="utf-8") as stream:
            encoded = json.load(stream)
        if expand(encoded) != original:
            raise SystemExit("FAILED: expanded capture differs from original")
        print(f"OK: {len(original['events'])} events restored without loss")
        return
    if args.output is None:
        parser.error("-o / --output is required")
    output = compact(original) if args.mode == "compact" else expand(original)
    with args.output.open("w", encoding="utf-8") as stream:
        json.dump(output, stream, ensure_ascii=False, separators=(",", ":"))
    print(f"{args.mode}: {len(output['events'])} events -> {args.output}")


if __name__ == "__main__":
    main()
