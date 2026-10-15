import unittest

from tools.compact_ranking_replay import compact, expand, diff, apply_patch


class RankingReplayDeltaTests(unittest.TestCase):
    def test_nested_updates_and_deletes_are_lossless(self):
        a = {"v": 1, "stack": [1, 2], "effects": {"a": {"left": 3}}, "removed": True}
        b = {"v": 0, "stack": [1, 3], "effects": {"a": {"left": 0}, "new": None}}
        edits = []
        diff(a, b, [], edits)
        self.assertEqual(apply_patch(a, edits), b)
        self.assertEqual(a["v"], 1)

    def test_separate_baselines_per_session(self):
        source = {
            "scope": "audition-replay-capture",
            "events": [
                {"sessionId": 1, "event": "before", "state": {"hp": 10}},
                {"sessionId": 2, "event": "before", "state": {"hp": 5}},
                {"sessionId": 1, "event": "after", "state": {"hp": 9}},
                {"sessionId": 2, "event": "after", "state": {"hp": 3}},
                {"sessionId": 1, "event": "complete"},
            ],
        }
        encoded = compact(source)
        self.assertNotIn("state", encoded["events"][2])
        self.assertIn("_statePatch", encoded["events"][2])
        self.assertEqual(expand(encoded), source)

    def test_bad_codec_and_unbased_delta_rejected(self):
        with self.assertRaises(ValueError):
            expand({"_deltaCodec": "unknown"})
        with self.assertRaises(ValueError):
            expand({"_deltaCodec": "gakumas-ranking-replay-state-delta-v1",
                    "events": [{"sessionId": 1, "_statePatch": [["s", ["hp"], 1]]}]})


if __name__ == "__main__":
    unittest.main()
