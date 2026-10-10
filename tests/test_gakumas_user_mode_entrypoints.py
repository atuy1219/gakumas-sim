"""Validate exact-build Gakumas capture scope invariants (no APK blobs needed)."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MAP = json.loads((ROOT / "tools/gakumas_v341_user_mode_entrypoints.json").read_text())
NATIVE = (ROOT / "android/lsposed-progress-capture/src/main/cpp/progress_capture.cpp").read_text()

class GakumasModeScopeTests(unittest.TestCase):
    def test_user_requested_modes(self):
        self.assertEqual(set(MAP["userModes"]), {"audition", "contest", "tower"})
        self.assertEqual([MAP["userModes"][key]["modeType"]
                          for key in ("audition", "contest", "tower")], [1, 2, 5])

    def test_existing_generic_start_is_not_unique(self):
        legacy = MAP["shared"]["unsafeGenericStartExam"]
        self.assertEqual(legacy["rva"], "0x080A5354")
        self.assertIn("forecast", legacy["reason"])
        self.assertIn("case 0x0811E834: return \"internal-fixed-action-simulator\";", NATIVE)
        self.assertIn("if (std::strcmp(lane, \"internal-fixed-action-simulator\") == 0) return;", NATIVE)

    def test_scoped_probe_matches_audited_bl_returns(self):
        probe = MAP["shared"]["scopedSetupProbe"]
        self.assertEqual(probe["rva"], "0x080A1E90")
        self.assertEqual(probe["token"], "0x060050A4")
        for return_rva, description in probe["observedReturnRva"]:
            self.assertIn("case " + return_rva.upper().replace("0X", "0x") + ":", NATIVE,
                          "missing scope return address " + return_rva)
        self.assertIn("if (sample >= 128) return;", NATIVE)

    def test_never_assume_tour_rehearsal_is_contest(self):
        methods = MAP["userModes"]["contest"]["methods"]
        names = [v[0] for v in methods]
        self.assertTrue(any("get_IsRehearsal" in n for n in names))
        self.assertFalse(any("TourExamUtility" in n for n in names))

if __name__ == "__main__":
    unittest.main()
