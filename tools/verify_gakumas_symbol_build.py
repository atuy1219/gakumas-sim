#!/usr/bin/env python3
"""Inventory selected game methods in a symbolized ARM64 libil2cpp ELF.

Uses nm/readelf only; never loads or executes the game binary. These
symbol-derived RVAs do not certify native calling conventions, layouts,
caller identities or live hook safety.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

EXPECTED_BUILD_ID = "5ac77881a1242477b5bf6bd928ce8c1765a55f2f"
METHODS = {
    "ExamSequence.SetUpExam": "Campus::InGame::Exam::ExamSequence::SetUpExam(Campus::InGame::Exam::ExamData)",
    "ExamSequence.StartExam": "Campus::InGame::Exam::ExamSequence::StartExam()",
    "ExamSequence.Dispose": "Campus::InGame::Exam::ExamSequence::Dispose()",
    "ExamSequence.get_Parameter": "Campus::InGame::Exam::ExamSequence::get_Parameter()",
    "ExamSequence.get_CardController": "Campus::InGame::Exam::ExamSequence::get_CardController()",
    "ExamSequence.get_PlayingCard": "Campus::InGame::Exam::ExamSequence::get_PlayingCard()",
    "ExamSequence.GetTriggerEffectListCommand": "Campus::InGame::Exam::ExamSequence::GetTriggerEffectListCommand(System::Collections::Generic::IEnumerable<Campus::InGame::Exam::TriggerEffectStatusEffect>, bool)",
    "ProduceUtility.CreateDeckProduceCardMasters": "Campus::InGame::ProduceUtility::CreateDeckProduceCardMasters()",
    "UserProduceProgressProduceCard.GetProduceCardData": "Campus::Common::Proto::Client::Transaction::UserProduceProgressProduceCard::GetProduceCardData()",
    "UserProduceProgressProduceCard.InternalMergeFrom": "Campus::Common::Proto::Client::Transaction::UserProduceProgressProduceCard::pb__Google_Protobuf_IBufferMessage_InternalMergeFrom(Google::Protobuf::ParseContext&)",
    "ExamParameterModel.GetRandomInt": "Campus::InGame::Exam::ExamParameterModel::GetRandomInt()",
    "ExamParameterModel.GetRandomIntRange": "Campus::InGame::Exam::ExamParameterModel::GetRandomInt(int, int)",
    "ExamCardMoveController.DrawCard": "Campus::InGame::Card::ExamCardMoveController::DrawCard(int, Campus::InGame::Exam::ExamEffectCalculateContext, bool)",
    "ExamCardMoveController.ResetHand": "Campus::InGame::Card::ExamCardMoveController::ResetHand(Campus::InGame::Exam::ExamEffectCalculateContext)",
    "ExamCardMoveController.ShuffleDeck": "Campus::InGame::Card::ExamCardMoveController::ShuffleDeck(Campus::InGame::Exam::ExamEffectCalculateContext)",
    "ExamCardMoveController.ShuffleDeckGrave": "Campus::InGame::Card::ExamCardMoveController::ShuffleDeckGrave(Campus::InGame::Exam::ExamEffectCalculateContext)",
    "ExamCardMoveController.ReplaceGraveToDeck": "Campus::InGame::Card::ExamCardMoveController::ReplaceGraveToDeck(Campus::InGame::Exam::ExamEffectCalculateContext, int)",
    "ExamCardMoveController.SetInitialCard": "Campus::InGame::Card::ExamCardMoveController::SetInitialCard(int, Campus::InGame::Exam::ExamEffectCalculateContext)",
    "ExamCardMoveController.MovePlayCard": "Campus::InGame::Card::ExamCardMoveController::MovePlayCard(Campus::InGame::Card::ExamCardData, Campus::InGame::Exam::ExamEffectCalculateContext)",
    "CardMoveEffectExecutor.ExecuteEffect": "Campus::InGame::Exam::CardMoveEffectExecutor::ExecuteEffect(Campus::InGame::Exam::ExamEffectCalculateContext)",
    "ExamSavePlayLogData.LoadAll": "Campus::InGame::Exam::ExamSavePlayLogData::LoadAll(System::String)",
    "ExamData.get_ExamType": "Campus::InGame::Exam::ExamData::get_ExamType()",
    "ExamData.get_IsReplay": "Campus::InGame::Exam::ExamData::get_IsReplay()",
    "ContestProgressData.get_IsRehearsal": "Campus::InGame::ContestProgressData::get_IsRehearsal()",
}


def extract_build_id(note: str) -> str:
    match = re.search(r"Build ID:\s*([0-9a-fA-F]+)", note)
    if not match:
        raise ValueError("GNU Build ID not present")
    return match.group(1).lower()


def parse_nm(lines: list[str] | object) -> dict[str, int]:
    reverse = {symbol: key for key, symbol in METHODS.items()}
    result: dict[str, int] = {}
    for line in lines:
        match = re.match(r"^([0-9a-fA-F]{8,16})\s+[TtWw]\s+(.+)$", line.rstrip("\n"))
        if not match:
            continue
        identifier = reverse.get(match.group(2))
        if identifier is None:
            continue
        if identifier in result:
            raise ValueError(f"ambiguous function address for {identifier}")
        result[identifier] = int(match.group(1), 16)
    missing = sorted(set(METHODS) - set(result))
    if missing:
        raise ValueError("missing or renamed methods: " + ", ".join(missing))
    return result


def inventory(elf: Path) -> dict:
    note = subprocess.check_output(["readelf", "-n", str(elf)], text=True)
    build_id = extract_build_id(note)
    process = subprocess.Popen(["nm", "-n", "-C", str(elf)], stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True)
    assert process.stdout is not None
    try:
        rvas = parse_nm(process.stdout)
    finally:
        process.stdout.close()
    err = process.stderr.read() if process.stderr else ""
    if process.wait() != 0:
        raise RuntimeError("nm failed: " + err[:500])
    return {"buildId": build_id, "source": "ELF .symtab via nm -C",
            "methodCount": len(rvas), "methods": {name: f"0x{rva:08X}" for name, rva in sorted(rvas.items())},
            "verifiedRuntimeABI": False, "verifiedRuntimeCallerClassification": False}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("elf", type=Path)
    parser.add_argument("--expect-build-id", default=EXPECTED_BUILD_ID)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = inventory(args.elf)
    if result["buildId"] != args.expect_build_id.lower():
        parser.error("Build ID differs: got " + result["buildId"])
    data = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(data, encoding="utf-8")
    else:
        print(data, end="")


if __name__ == "__main__":
    main()
