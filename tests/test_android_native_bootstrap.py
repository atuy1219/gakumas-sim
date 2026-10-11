"""Host regressions for mask safety, self-test verdicts and root repair scope."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "android/lsposed-progress-capture/src/main"


class NativeProbeTests(unittest.TestCase):
    def test_masks_and_self_test_require_actual_detour_and_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "test.cpp"
            source.write_text(r'''
#include "native_probe.h"
#include <cassert>
int main() {
    unsigned mask = 99;
    for (const auto* text : {"0", "128\n", "256", " 384 \n"})
        assert(native_probe::parse_mask(text, mask));
    for (const auto* text : {"", "1", "32", "127", "129", "-128",
                            "512", "4294967296", "128junk", "128 256"})
        assert(!native_probe::parse_mask(text, mask));
    assert(native_probe::self_test_passed(true, true, 1, 42, 42, 43));
    assert(!native_probe::self_test_passed(false, true, 1, 42, 42, 43));
    assert(!native_probe::self_test_passed(true, false, 1, 42, 42, 43));
    assert(!native_probe::self_test_passed(true, true, 0, 42, 42, 43));
    assert(!native_probe::self_test_passed(true, true, 2, 42, 42, 43));
    assert(!native_probe::self_test_passed(true, true, 1, 42, 42, 42));
    assert(!native_probe::self_test_passed(true, true, 1, 42, 41, 43));
}
''')
            subprocess.run(["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror",
                            "-I", str(ANDROID / "cpp"), str(source), "-o", str(root / "test")], check=True)
            subprocess.run([str(root / "test")], check=True)


@unittest.skipUnless(shutil.which("javac"), "host JDK required")
class DiagnosticStorageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        package = "dev.atuy1219.gakumas.progresscapture"
        harness = cls.root / "StorageHarness.java"
        harness.write_text("package " + package + r''';
public final class StorageHarness {
    public static void main(String[] args) {
        System.out.print(DiagnosticStorage.configure(args[0], Integer.parseInt(args[1]),
            new String[]{"bootstrap_status.json", "capture_status.json"}));
    }
}
''')
        subprocess.run(["javac", "-d", str(cls.root),
                        str(ANDROID / "java/dev/atuy1219/gakumas/progresscapture/DiagnosticStorage.java"),
                        str(harness)], check=True)
        cls.runner = ["java", "-cp", str(cls.root), package + ".StorageHarness"]

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def command(self, mask=0):
        return subprocess.check_output(self.runner + [
            "/data/user/0/com.bandainamcoent.idolmaster_gakuen/files", str(mask)], text=True)

    def run_repair(self, preparation):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parent = root / "files"
            parent.mkdir()
            capture = parent / "gakumas-sim"
            capture.mkdir()
            outside = root / "game-save"
            outside.write_text("untouched")
            preparation(capture, outside)
            commands = root / "bin"
            commands.mkdir()
            # Ownership cannot be transferred inside an unprivileged host
            # namespace. Mock only the privileged calls and stat UID/GID.
            stat = shutil.which("stat")
            (commands / "stat").write_text("#!/bin/sh\ncase \"$2\" in %u|%g) echo 10000;; *) exec " + stat + " \"$@\";; esac\n")
            (commands / "chown").write_text("#!/bin/sh\nprintf '%s=%s\\n' \"$2\" \"$(cat \"$CAPTURE/native_hookmask.txt\" 2>/dev/null)\" >> \"$REPAIR_LOG\"\n")
            (commands / "restorecon").write_text("#!/bin/sh\nprintf 'context %s\\n' \"$1\" >> \"$REPAIR_LOG\"\n")
            for path in commands.iterdir():
                path.chmod(0o755)
            script = self.command().replace(
                "/data/user/0/com.bandainamcoent.idolmaster_gakuen/files", str(parent))
            env = dict(os.environ, PATH=str(commands) + os.pathsep + os.environ["PATH"],
                       CAPTURE=str(capture), REPAIR_LOG=str(root / "operations"))
            result = subprocess.run(["sh", "-c", script], env=env, capture_output=True, text=True)
            self.assertEqual(outside.read_text(), "untouched")
            if result.returncode == 0:
                self.assertEqual((capture / "native_hookmask.txt").read_text(), "0\n")
                self.assertEqual(capture.stat().st_mode & 0o777, 0o700)
                operations = (root / "operations").read_text()
                self.assertIn(str(capture) + "=0\n", operations)
                self.assertNotIn(str(outside), operations)
                for path in capture.iterdir():
                    self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            else:
                self.assertFalse((root / "operations").exists(), "mutated before rejecting unsafe child")
            return result.returncode

    def test_safe_mask_before_directory_repair_and_child_temp_permissions(self):
        def prepare(capture, _):
            (capture / "native_hookmask.txt").write_text("128\n")
            (capture / "bootstrap_status.json.tmp").write_text("old root-owned temporary")
        self.assertEqual(self.run_repair(prepare), 0)

    def test_dangling_symlink_rejected_before_mutation(self):
        self.assertEqual(self.run_repair(lambda c, o:
            (c / "native_hookmask.txt").symlink_to(o.parent / "missing")), 37)

    def test_status_symlink_and_hard_link_rejected_before_mutation(self):
        self.assertEqual(self.run_repair(lambda c, o:
            (c / "capture_status.json.tmp").symlink_to(o)), 37)
        self.assertEqual(self.run_repair(lambda c, o:
            os.link(o, c / "capture_status.json")), 38)

    def test_legacy_masks_and_non_game_paths_rejected(self):
        for parent, mask in [("/data/user/0/com.bandainamcoent.idolmaster_gakuen/files", "127"),
                             ("/data/user/0/com.other/files", "0")]:
            result = subprocess.run(self.runner + [parent, mask], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, b"")


if __name__ == "__main__":
    unittest.main()
