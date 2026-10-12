import unittest
from tools.reconstruct_selected_contest import reconstruct, compare_to_simulator


def sample_capture():
    card = {"id": "p_card-a", "guid": "card-guid-1"}
    return {
        "scope": "contest-gameplay-capture", "moduleVersion": "1.5.30",
        "captureStatus": {"writeFailures": 0},
        "events": [
            {"sessionId": 1, "event": "contest-start", "seed": 42,
             "observedAtUnixMs": 1, "libil2cppBuildId": "exact-build"},
            {"sessionId": 1, "event": "contest-native-mutation",
             "nativeMethod": "ExamSequence.ExecuteCardCommandImpl",
             "card": card, "selectedContextMatched": False,
             "observedAtUnixMs": 2},
            {"sessionId": 1, "event": "contest-progress", "step": 1,
             "turnStartIndex": 0, "turnCount": 1, "score": 100,
             "turns": [{"turn": 1, "score": 0, "addedScore": 100, "stamina": 30,
                        "commands": [{"commandType": 2, "card": card,
                                      "playIndex": 0, "cardPosition": 2},
                                     {"commandType": 9, "card": card}],
                        "hand": [{"id": "p_card-a"}]}],
             "observedAtUnixMs": 3},
            {"sessionId": 1, "event": "contest-result", "score": 100,
             "observedAtUnixMs": 4},
        ],
    }


class SelectedContestReconstructionTests(unittest.TestCase):
    def test_only_complete_selected_single_card_boundary_supplies_score(self):
        capture = sample_capture()
        done = {"sessionId": 1, "event": "contest-card-use-complete", "step": 1,
                "selectedLineageVerified": True, "lineageComplete": True,
                "completionSuccessVerified": True, "completionBoundaryVerified": True, "cardUseCompletionVerified": True,
                "singleCardAction": True, "cardActionSerial": 7,
                "card": {"id": "p_card-a", "guid": "card-guid-1"},
                "beforeMetrics": {"available": True, "score": 12},
                "metrics": {"available": True, "score": 100, "turn": 1}}
        capture["events"].insert(2, done)
        play = reconstruct(capture)["sessions"][0]["selectedPlays"][0]
        self.assertEqual(play["perCardScore"], 88)
        self.assertEqual(play["cardActionSerial"], 7)
        self.assertTrue(play["cardEffectsComplete"])
        for key in ("selectedLineageVerified", "lineageComplete", "singleCardAction",
                    "completionSuccessVerified", "completionBoundaryVerified", "cardUseCompletionVerified"):
            done[key] = False
            self.assertIsNone(reconstruct(capture)["sessions"][0]["selectedPlays"][0]["perCardScore"])
            done[key] = True

    def test_native_result_is_authoritative_and_guid_is_only_a_clue(self):
        result = reconstruct(sample_capture())
        self.assertEqual(result["sessionCount"], 1)
        self.assertTrue(result["allSessionsCompleted"])
        self.assertTrue(result["allTurnHistoriesContinuous"])
        self.assertEqual(result["selectedPlayCount"], 1)
        session = result["sessions"][0]
        self.assertEqual(session["selectedPlays"][0]["card"]["id"], "p_card-a")
        self.assertTrue(session["selectedPlays"][0]["selectedResultVerified"])
        self.assertEqual(session["selectedPlays"][0]["candidateDfsMutationMatches"], 1)
        self.assertFalse(session["selectedPlays"][0]["candidateLineageVerified"])
        self.assertIsNone(session["selectedPlays"][0]["perCardScore"])

    def test_discontinuous_history_is_not_marked_complete(self):
        capture = sample_capture()
        capture["events"][2]["turnStartIndex"] = 1
        result = reconstruct(capture)
        self.assertFalse(result["allTurnHistoriesContinuous"])
        self.assertEqual(result["selectedPlayCount"], 0)

    def test_only_explicitly_comparable_metrics_are_checked(self):
        native = reconstruct(sample_capture())
        equal = {"sessions": [{"sessionId": 1, "score": 100, "turns": [
            {"turn": 1, "stamina": 30, "playedCardIds": ["p_card-a"]}]}]}
        checked = compare_to_simulator(native, equal)
        self.assertEqual(checked["comparedFields"], 3)
        self.assertEqual(checked["mismatchCount"], 0)
        self.assertFalse(checked["fullParityVerified"])
        equal["sessions"][0]["turns"][0]["playedCardIds"] = ["wrong"]
        mismatch = compare_to_simulator(native, equal)
        self.assertEqual(mismatch["mismatchCount"], 1)

    def test_command_log_can_be_native_derived_play_list(self):
        capture = sample_capture()
        turn = capture["events"][2]["turns"][0]
        turn["selectedPlayedCards"] = [{"commandType": 4, "card":
                                       {"id": "from-native", "guid": "x"}}]
        result = reconstruct(capture)
        self.assertEqual(result["sessions"][0]["selectedPlays"][0]["card"]["id"],
                         "from-native")


if __name__ == "__main__":
    unittest.main()
