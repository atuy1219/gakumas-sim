"""Static regressions for the shared M3-styled tab navigation."""
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
JAVA=ROOT/"android/lsposed-progress-capture/src"
EXPORT=JAVA/"export/java/dev/atuy1219/gakumas/progresscapture"
MAIN=JAVA/"main/java/dev/atuy1219/gakumas/progresscapture"


class TabNavigationTests(unittest.TestCase):
    def test_shared_tabs_all_sections(self):
        ui=(EXPORT/"CaptureUi.java").read_text()
        self.assertIn('String[] titles={"記録","診断","設定"};',ui)
        self.assertIn('interface TabListener',ui)
        self.assertIn("WindowInsets.Type.systemBars()",ui)
        self.assertIn('primaryContainer(c)',ui)
        self.assertIn("static void showDialog",ui)
        self.assertIn('system_accent1_600',ui)
        self.assertIn("static void applyWindow",ui)

    def test_capture_and_diagnostic_both_use_shared_components(self):
        capture=(EXPORT/"CaptureExportActivity.java").read_text()
        diagnostic=(MAIN/"DiagnosticActivity.java").read_text()
        self.assertIn('extends DiagnosticActivity',capture)
        self.assertIn('createCapturePage(LinearLayout shell)',capture)
        self.assertNotIn('startActivity(i)',capture)
        self.assertIn('capturePage=createCapturePage(shell)',diagnostic)
        self.assertIn('capturePage.setVisibility',diagnostic)
        self.assertIn('CaptureUi.tabs(this,tabHost,selectedTab',diagnostic)
        self.assertIn('CaptureUi.scrollContent(this,shell)',capture)
        self.assertIn('CaptureUi.scrollContent(this,shell)',diagnostic)
        self.assertIn('diagnosticPage.setVisibility',diagnostic)
        self.assertIn('settingsPage.setVisibility',diagnostic)
        self.assertIn('onNewIntent(Intent intent)',diagnostic)
        self.assertNotIn('new AlertDialog.Builder(this)',diagnostic)
        self.assertIn('CaptureUi.confirm',diagnostic)

    def test_replay_mode_is_live_and_uses_current_native_hooks(self):
        source=(EXPORT/"CaptureExportActivity.java").read_text()
        start=source.index("private void activateReplay()")
        end=source.index("private void refreshReplay()",start)
        replay=source[start:end]
        self.assertIn("DiagnosticStorage.configure(GAME_FILES,131072",replay)
        self.assertNotIn("1.6.5",source)
        self.assertIn('DiagnosticStorage.configure(GAME_FILES,65536',source)
        self.assertIn('readRoot("exam_hook_trace_status.json"',source)
        # Replay export is sourced from the new-build native hooks.
        self.assertIn("prepareExport(false,false,true)",source)

    def test_replay_uses_only_exact_current_image(self):
        native=(ROOT/"android/lsposed-progress-capture/src/main/cpp/progress_capture.cpp").read_text()
        self.assertIn('kCurrentReplayLogRva = 0x081EEAF0',native)
        self.assertIn('kCurrentReplayDataRva = 0x081EDE8C',native)
        self.assertIn('install_current_replay(image)',native)
        self.assertIn('replay_read(item+0x10,type)',native)
        self.assertIn('ranking_replay_capture.jsonl',native)
        ui=(EXPORT/"CaptureExportActivity.java").read_text()
        self.assertNotIn('1.6.5',ui)
        self.assertIn('mask==131072',ui)
        self.assertIn('現在のリプレイ形式ではありません',ui)

    def test_version_and_theme_are_consistent(self):
        manifest=(ROOT/"android/lsposed-progress-capture/AndroidManifest.xml").read_text()
        prop=(ROOT/"android/lsposed-progress-capture/src/main/resources/META-INF/xposed/module.prop").read_text()
        self.assertIn('android:theme="@android:style/Theme.Material.Light.NoActionBar"',manifest)
        self.assertNotIn('android:name=".DiagnosticActivity"',manifest)
        self.assertIn('android:versionName="1.9.0-replay"',manifest)
        self.assertIn('version=1.9.0-replay',prop)


if __name__=="__main__":
    unittest.main()
