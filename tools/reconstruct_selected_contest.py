#!/usr/bin/env python3
"""Reconstruct selected contest actions from game-owned ExamSimulateResult logs.

DFS mutation probes are evidence only; GUID matches do NOT establish that the
mutation executed on the selected clone. No inferred per-card score is emitted.
"""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path


PLAY_COMMAND_TYPES = {2, 4}


def extract_played(turn):
    """The native command log provides each selected action and exact card GUID."""
    if isinstance(turn.get("selectedPlayedCards"), list):
        plays = turn["selectedPlayedCards"]
    else:
        plays = [
            {
                "turn": row.get("turn"),
                "phase": row.get("phase"),
                "commandType": row.get("commandType"),
                "playIndex": row.get("playIndex"),
                "cardPosition": row.get("cardPosition"),
                "card": row.get("card"),
                "source": "ExamSimulateResult.turns.commands",
                "selectedResultVerified": True,
                "cardEffectsComplete": False,
            }
            for row in (turn.get("commands") or [])
            if row.get("commandType") in PLAY_COMMAND_TYPES and row.get("card")
        ]
    return [row for row in plays if isinstance(row.get("card"), dict)]


def identity(card):
    if not isinstance(card, dict):
        return None
    guid = card.get("guid")
    return ("guid", guid) if guid else ("id", card.get("id")) if card.get("id") else None


def comparable_cards(rows):
    return [{"id": row.get("id"), "guid": row.get("guid"),
             "upgradeCount": row.get("upgradeCount")}
            for row in (rows or []) if isinstance(row, dict)]


def reconstruct(document):
    if document.get("scope") != "contest-gameplay-capture":
        raise ValueError("Expected contest-gameplay-capture export")
    events = document.get("events") or []
    grouped = defaultdict(list)
    for event in events:
        if event.get("sessionId") is not None:
            grouped[event["sessionId"]].append(event)
    sessions = []
    for session_id, rows in sorted(grouped.items()):
        rows.sort(key=lambda row: row.get("observedAtUnixMs", 0))
        starts = [row for row in rows if row.get("event") == "contest-start"]
        ends = [row for row in rows if row.get("event") == "contest-result"]
        progress = [row for row in rows if row.get("event") == "contest-progress"]
        # Selected step index is saved independently of other native hook events.
        progress.sort(key=lambda row: row.get("step", 0))
        candidate = [row for row in rows if row.get("event") == "contest-native-mutation"
                     and row.get("nativeMethod") == "ExamSequence.ExecuteCardCommandImpl"]
        by_guid = defaultdict(list)
        for probe in candidate:
            key = identity(probe.get("card"))
            if key:
                by_guid[key].append(probe)
        completions = [row for row in rows if row.get("event") == "contest-card-use-complete"
                       and row.get("selectedLineageVerified") is True
                       and row.get("lineageComplete") is True
                       and row.get("completionSuccessVerified") is True
                       and row.get("completionBoundaryVerified") is True
                       and row.get("capturePhase") == "before-card-SeparateActivity-handler"
                       and row.get("cardUseCompletionVerified") is True
                       and row.get("singleCardAction") is True]
        consumed_completions = set()
        turns = []
        selected_plays = []
        errors = []
        cursor = 0
        previous_step_score = 0
        for step in progress:
            index = step.get("turnStartIndex")
            delta = step.get("turns")
            if index != cursor:
                errors.append({"error": "turn-history-discontinuity",
                               "expectedIndex": cursor, "observedIndex": index,
                               "step": step.get("step")})
                # Never silently skip or duplicate a turn and call it verified.
                continue
            if not isinstance(delta, list):
                errors.append({"error": "turn-history-not-array", "step": step.get("step")})
                continue
            for turn in delta:
                number = turn.get("turn")
                if number is None:
                    errors.append({"error": "missing-turn-number"})
                    continue
                plays = extract_played(turn)
                stage = {
                    "turn": number,
                    "turnScoreSnapshot": turn.get("score"),
                    "addedScoreRecorded": turn.get("addedScore"),
                    "stamina": turn.get("stamina"),
                    "consumedStamina": turn.get("consumedStamina"),
                    "block": turn.get("block"),
                    "hand": comparable_cards(turn.get("hand")),
                    "hold": comparable_cards(turn.get("hold")),
                    "statusEffects": turn.get("statusEffects"),
                    "resultStatusEffects": turn.get("resultStatusEffects"),
                    "triggeredEnchantIds": turn.get("triggeredEnchantIds"),
                    "playedCards": [],
                    "commandCount": len(turn.get("commands") or []),
                    "source": "selected-ExamSimulateResult",
                }
                for action_index, play in enumerate(plays):
                    card = play["card"]
                    ident = identity(card)
                    matching = by_guid.get(ident, []) if ident else []
                    # Match by GUID only as correlation, never as verified lineage.
                    record = {
                        "turn": number,
                        "actionInTurn": action_index,
                        "card": card,
                        "commandType": play.get("commandType"),
                        "playIndex": play.get("playIndex"),
                        "cardPosition": play.get("cardPosition"),
                        "selectedResultVerified": True,
                        "candidateDfsMutationMatches": len(matching),
                        "candidateMatchedBy": ident[0] if matching else None,
                        "candidateLineageVerified": False,
                        "perCardScore": None,
                        "perCardScoreAvailable": False,
                        "cardEffectsComplete": False,
                    }
                    # The event is already selected through native clone/save
                    # identity. GUID is used only to assign that verified event
                    # to its command, preserving repeated uses in turn order.
                    for ci, done in enumerate(completions):
                        before_metrics = done.get("beforeMetrics") or {}
                        after_metrics = done.get("metrics") or {}
                        if (ci in consumed_completions
                                or done.get("step") != step.get("step")
                                or after_metrics.get("turn") != number
                                or identity(done.get("card")) != ident):
                            continue
                        consumed_completions.add(ci)
                        measured = (before_metrics.get("available") is True
                                    and after_metrics.get("available") is True
                                    and isinstance(before_metrics.get("score"), int)
                                    and isinstance(after_metrics.get("score"), int))
                        record.update({
                            "candidateLineageVerified": True,
                            "cardActionSerial": done.get("cardActionSerial"),
                            "perCardScore": after_metrics["score"] - before_metrics["score"] if measured else None,
                            "perCardScoreAvailable": measured,
                            "cardEffectsComplete": True,
                            "beforeMetrics": before_metrics,
                            "afterMetrics": after_metrics,
                            "poolStateAfterCard": done.get("poolState"),
                            "measurementSource": "native-selected-clone-command-list-completion",
                        })
                        break
                    stage["playedCards"].append(record)
                    selected_plays.append(record)
                turns.append(stage)
            cursor += len(delta)
            if step.get("turnCount") is not None and step.get("turnCount") != cursor:
                errors.append({"error": "turn-count-mismatch", "step": step.get("step"),
                               "claimed": step.get("turnCount"), "actual": cursor})
            if isinstance(step.get("score"), int):
                previous_step_score = step["score"]
        total = ends[-1].get("score") if ends else None
        if ends and progress and previous_step_score != total:
            errors.append({"error": "selected-score-mismatch",
                           "progressScore": previous_step_score, "resultScore": total})
        sessions.append({
            "sessionId": session_id,
            "seed": starts[0].get("seed") if starts else None,
            "characterId": starts[0].get("characterId") if starts else None,
            "settingId": starts[0].get("settingId") if starts else None,
            "score": total,
            "completed": bool(ends),
            "historyContinuous": not errors,
            "turns": turns,
            "selectedPlays": selected_plays,
            "unverifiedDfsCandidateCommands": len(candidate),
            "selectedPlayCount": len(selected_plays),
            "errors": errors,
        })
    status = document.get("captureStatus") or {}
    return {
        "schemaVersion": 1,
        "source": "native-ExamSimulateResult-selected-turn-history",
        "gameBuildId": next((e.get("libil2cppBuildId") for e in events
                             if e.get("libil2cppBuildId")), None),
        "moduleVersion": document.get("moduleVersion"),
        "sessionCount": len(sessions),
        "selectedPlayCount": sum(x["selectedPlayCount"] for x in sessions),
        "allSessionsCompleted": all(x["completed"] for x in sessions),
        "allTurnHistoriesContinuous": all(x["historyContinuous"] for x in sessions),
        "writeFailures": status.get("writeFailures"),
        "reconstructionNotes": [
            "Selected turns and played cards are sourced from game-owned result logs.",
            "Turn score snapshots are not per-card scores.",
            "Unselected DFS candidate GUID matches remain correlations; only native selected-save lineage verifies ancestry.",
            "Obscured<T> backing integers must not be treated as decrypted metrics.",
        ],
        "sessions": sessions,
    }


def compare_to_simulator(game, simulator):
    """Compare only explicitly provided matching quantities, never interpolate."""
    sim_sessions = simulator.get("sessions", [])
    if not isinstance(sim_sessions, list):
        raise ValueError("Simulator sessions must be a list")
    indexed = {x["sessionId"]: x for x in sim_sessions if "sessionId" in x}
    differences = []
    compared = 0
    for native in game["sessions"]:
        simulated = indexed.get(native["sessionId"])
        if simulated is None:
            differences.append({"sessionId": native["sessionId"],
                                "field": "session", "problem": "missing-simulator-session"})
            continue
        for key in ("seed", "score"):
            if key in simulated and simulated[key] is not None and native.get(key) is not None:
                compared += 1
                if native[key] != simulated[key]:
                    differences.append({"sessionId": native["sessionId"],
                                        "field": key, "game": native[key],
                                        "simulator": simulated[key]})
        sim_turns = {t.get("turn"): t for t in simulated.get("turns", [])
                     if isinstance(t, dict) and t.get("turn") is not None}
        for turn in native["turns"]:
            other = sim_turns.get(turn["turn"])
            if other is None:
                continue
            for game_key, sim_key in (("turnScoreSnapshot", "score"),
                                      ("stamina", "stamina"), ("block", "block")):
                if sim_key not in other or other[sim_key] is None or turn[game_key] is None:
                    continue
                compared += 1
                if turn[game_key] != other[sim_key]:
                    differences.append({"sessionId": native["sessionId"],
                                        "turn": turn["turn"], "field": game_key,
                                        "game": turn[game_key], "simulator": other[sim_key]})
            if "playedCardIds" in other:
                actual = [c["card"].get("id") for c in turn["playedCards"]]
                compared += 1
                if actual != other["playedCardIds"]:
                    differences.append({"sessionId": native["sessionId"],
                                        "turn": turn["turn"], "field": "playedCardIds",
                                        "game": actual, "simulator": other["playedCardIds"]})
    return {"comparedFields": compared, "mismatchCount": len(differences),
            "differences": differences, "fullParityVerified": False,
            "note": "Matched fields only; this does not certify simulator-wide parity."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("-o", "--output", type=Path)
    parser.add_argument("--simulator", type=Path)
    args = parser.parse_args()
    result = reconstruct(json.loads(args.capture.read_text(encoding="utf-8")))
    if args.simulator:
        result["simulatorComparison"] = compare_to_simulator(
            result, json.loads(args.simulator.read_text(encoding="utf-8")))
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
