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


@unittest.skipUnless(shutil.which("javac"), "host JDK required")
class DiagnosticScanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        package = "dev.atuy1219.gakumas.progresscapture"
        harness = cls.root / "ScanHarness.java"
        harness.write_text("package " + package + r''';
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;
public final class ScanHarness {
    public static void main(String[] args) throws Exception {
        if (args[0].equals("command")) {
            System.out.print(DiagnosticScan.command(0, args[1],
                new String[]{"bootstrap_status.json", "native_self_test.json"}));
            return;
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[1024];
        int count;
        while ((count = System.in.read(buffer)) != -1) bytes.write(buffer, 0, count);
        DiagnosticScan.Result result = DiagnosticScan.parse(
            new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        if (args[0].equals("validate")) {
            System.out.print(DiagnosticScan.traceDirectory(0, result));
            return;
        }
        for (java.util.Map.Entry<String,String> entry : result.preflight.entrySet())
            System.out.println("@" + entry.getKey() + "|" + entry.getValue());
        for (String[] parts : result.files.values())
            System.out.println(String.join("|", parts));
    }
}
''')
        subprocess.run(["javac", "-d", str(cls.root),
                        str(ANDROID / "java/dev/atuy1219/gakumas/progresscapture/DiagnosticScan.java"),
                        str(harness)], check=True)
        cls.runner = ["java", "-cp", str(cls.root), package + ".ScanHarness"]

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def parse(self, output):
        return subprocess.run(self.runner + ["parse"], input=output, text=True,
                              capture_output=True)

    def scan(self, visible=False, process_user=0, root_uid=0, process_running=True):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            game = "com.bandainamcoent.idolmaster_gakuen"
            data = root / "data/user"
            data.mkdir(parents=True)
            if visible:
                capture = data / "0" / game / "files/gakumas-sim"
                capture.mkdir(parents=True)
                (capture / "bootstrap_status.json").write_text("{}\n")
            proc = root / "proc/24540"
            proc.mkdir(parents=True)
            game_root = root / "game-root"
            (game_root / "data/user" / str(process_user) / game / "files").mkdir(parents=True)
            (proc / "root").symlink_to(game_root, target_is_directory=True)
            (proc / "status").write_text(f"Uid:\t{process_user * 100000 + 12345}\t12345\n")
            (proc / "maps").write_text("r-xp libil2cpp.so\n")
            commands = root / "bin"
            commands.mkdir()
            (commands / "id").write_text(f"#!/bin/sh\necho {root_uid}\n")
            (commands / "pidof").write_text("#!/bin/sh\n" + ("echo 24540\n" if process_running else "exit 1\n"))
            for path in commands.iterdir():
                path.chmod(0o755)
            # The tested shell is generated by the production Java class.
            script = subprocess.check_output(self.runner + ["command", "/data/app/module's base.apk"], text=True)
            script = script.replace("/data/user", str(data)).replace("/proc", str(root / "proc"))
            # /proc/PID/root paths must still refer to the game-root data tree.
            script = script.replace("/root" + str(data), "/root/data/user")
            env = dict(os.environ, PATH=str(commands) + os.pathsep + os.environ["PATH"])
            result = subprocess.run(["sh", "-c", script], env=env, capture_output=True, text=True)
            # Read-only scanning must never create configs or diagnostic files.
            self.assertEqual(list(root.rglob("native_hookmask.txt")), [])
            return result

    def test_no_candidate_or_files_is_completed_not_exit_one(self):
        result = self.scan(process_running=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("@scanComplete|yes", result.stdout)
        self.assertIn("bootstrap_status.json|INACCESSIBLE", result.stdout)
        self.assertNotIn("@candidateDataDir|", result.stdout)
        self.assertEqual(self.parse(result.stdout).returncode, 0)

    def test_same_user_process_root_fallback_is_read_only(self):
        result = self.scan()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("@tracePathKind|game-process-root-read-only", result.stdout)
        self.assertIn("@gameUid|12345", result.stdout)
        self.assertIn("native_self_test.json|MISSING", result.stdout)
        self.assertIn("@il2cppLibraryMapped|yes", result.stdout)
        self.assertEqual(self.parse(result.stdout).returncode, 0)

    def test_other_android_profile_is_not_selected(self):
        result = self.scan(process_user=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("@gameUser|10", result.stdout)
        self.assertIn("@tracePathKind|app-user", result.stdout)
        self.assertIn("bootstrap_status.json|INACCESSIBLE", result.stdout)

    def test_existing_files_and_missing_mask_are_distinct(self):
        result = self.scan(visible=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("bootstrap_status.json|3|", result.stdout)
        self.assertIn("@hookMask|unreadable-or-missing", result.stdout)
        self.assertIn("@tracePathKind|app-user", result.stdout)
        parsed = self.parse(result.stdout)
        self.assertEqual(parsed.returncode, 0, parsed.stderr)
        self.assertIn("bootstrap_status.json|3|", parsed.stdout)

    def test_non_root_or_incomplete_scan_is_not_success(self):
        result = self.scan(root_uid=2000)
        self.assertEqual(result.returncode, 32)
        self.assertNotIn("@scanComplete", result.stdout)
        for output in (result.stdout, "@rootUid|0\n", "@rootUid|2000\n@scanComplete|yes\n"):
            self.assertNotEqual(self.parse(output).returncode, 0)

    def test_real_newlines_pipe_fields_and_multiple_candidates(self):
        result = self.parse("@rootUid|0\r\nbootstrap_status.json|12|123\r\n"
                            "@targetDataDirDetails|a|b\r\n"
                            "@candidateDataDir|/data/user/0/game\r\n"
                            "@candidateDataDir|/data/user/10/game\r\n@scanComplete|yes\r\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("@targetDataDirDetails|a|b\n", result.stdout)
        self.assertIn("@candidateDataDir|/data/user/0/game; /data/user/10/game", result.stdout)
        self.assertIn("bootstrap_status.json|12|123", result.stdout)

    def test_only_fixed_same_user_read_paths_are_accepted(self):
        suffix = "/data/user/0/com.bandainamcoent.idolmaster_gakuen/files/gakumas-sim/"
        for path, user, good in [(suffix, "0", True), ("/proc/24540/root" + suffix, "0", True),
                                 ("/proc/24540/root" + suffix, "10", False),
                                 (suffix + "';echo injected;#", "0", False),
                                 ("/data/local/tmp/", "0", False),
                                 ("/proc/999/root" + suffix, "0", False)]:
            output = f"@rootUid|0\n@gamePid|24540\n@gameUser|{user}\n@traceDirectory|{path}\n@scanComplete|yes\n"
            result = subprocess.run(self.runner + ["validate"], input=output, text=True,
                                    capture_output=True)
            self.assertEqual(result.returncode == 0, good, result.stderr)


if __name__ == "__main__":
    unittest.main()
