#!/usr/bin/env python3
"""Offline tests: the current game Build ID is not an implicit hook migration."""
import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "android/lsposed-progress-capture/src/main/cpp/progress_capture.cpp"
HEADER = ROOT / "android/lsposed-progress-capture/src/main/cpp/native_probe.h"
SCRIPT = ROOT / "tools/verify_gakumas_symbol_build.py"

spec = importlib.util.spec_from_file_location("symbol_inventory", SCRIPT)
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class LatestBuildTests(unittest.TestCase):
    def test_symbol_inventory_requires_every_exact_method(self):
        fake_nm = [f"{0x1000 + i * 4:016x} T {name}\n"
                   for i, name in enumerate(inventory.METHODS.values())]
        result = inventory.parse_nm(fake_nm)
        self.assertEqual(len(result), len(inventory.METHODS))
        self.assertEqual(result["ExamSequence.SetUpExam"], 0x1000)
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            inventory.parse_nm(fake_nm + fake_nm[:1])
        with self.assertRaisesRegex(ValueError, "missing or renamed"):
            inventory.parse_nm(fake_nm[1:])

    def test_build_id_parsing(self):
        self.assertEqual(inventory.extract_build_id(
            "Some notes\n    Build ID: 5ac77881A1242477B5BF6BD928CE8C1765A55F2F\n"),
            inventory.EXPECTED_BUILD_ID)
        with self.assertRaisesRegex(ValueError, "Build ID"):
            inventory.extract_build_id("no build note")

    def test_current_build_never_installs_old_collectors(self):
        cpp = NATIVE.read_text()
        self.assertIn('kCurrentBuildId = "5ac77881a1242477b5bf6bd928ce8c1765a55f2f"', cpp)
        self.assertIn("kCurrentSetUpExamRva = 0x0815C230", cpp)
        self.assertIn("g_hook_mask.load(std::memory_order_acquire) != native_probe::kSetupProbe", cpp)
        begin = cpp.index("if (image.build_id == kCurrentBuildId) {", cpp.index("void install_il2cpp_hooks()"))
        old = cpp.index("if (image.build_id != kV341BuildId)", begin)
        section = cpp[begin:old]
        self.assertIn("install_current_setup_probe(image)", section)
        self.assertIn("return;  // never install any v3.4.1 native capture hook", section)
        self.assertNotIn("contest_capture::install", section)
        self.assertNotIn("detail_log_capture::install", section)
        self.assertIn("gameCaptureVerified\\\":false", cpp)

    def test_mask_parser_rejects_integer_overflow(self):
        if not subprocess.run(["which", "g++"], capture_output=True).returncode == 0:
            self.skipTest("g++ not installed")
        with tempfile.TemporaryDirectory() as tmp:
            exe = Path(tmp) / "check"
            cpp = Path(tmp) / "check.cpp"
            cpp.write_text(
                '#include "native_probe.h"\n'
                '#include <cassert>\n'
                'int main(){unsigned m=0;'
                'assert(native_probe::parse_mask("128\\n",m)&&m==128);'
                'assert(!native_probe::parse_mask("4294967424",m));'
                'assert(!native_probe::parse_mask("18446744073709551616",m));'
                'assert(!native_probe::parse_mask("32768",m));'
                'assert(!native_probe::parse_mask("128oops",m));'
                '}\n'
            )
            subprocess.check_call(["g++", "-std=c++17", "-I", str(HEADER.parent),
                                   str(cpp), "-o", str(exe)])
            subprocess.check_call([str(exe)])


if __name__ == "__main__":
    unittest.main()
