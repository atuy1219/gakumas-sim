"""Execute the real APK report builder on the host; no Android Activity is created.

Requires a locally built APK's app-classes, SDK android.jar, and org.json.
Only Process.myUid is stubbed; report parsing/classification runs unchanged.
"""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "android/lsposed-progress-capture"
SDK = Path(os.environ.get("ANDROID_HOME", str(ROOT.parent / "android-sdk")))
ANDROID_JAR = SDK / "platforms/android-35/android.jar"
JSON_JAR = Path(os.environ.get("GAKUMAS_HOST_JSON_JAR", str(ROOT.parent / "android-sdk-download/json-20240303.jar")))
CLASSES = APP / "out/app-classes"


@unittest.skipUnless(shutil.which("javac") and ANDROID_JAR.exists() and JSON_JAR.exists()
                     and (CLASSES / "dev/atuy1219/gakumas/progresscapture/DiagnosticEvidence.class").exists(),
                     "local APK build + SDK + host org.json required")
class AndroidReportEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        process = cls.root / "Process.java"
        process.write_text("package android.os; public final class Process { public static int myUid() { return 10000; } }")
        harness = cls.root / "ReportEvidenceHarness.java"
        harness.write_text(r'''
import java.lang.reflect.*;
import java.util.*;
import org.json.*;
public final class ReportEvidenceHarness {
    static void require(boolean good, String message) { if (!good) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        String running = args[0];
        int testPid = Integer.parseInt(args[1]);
        int original = Integer.parseInt(args[2]);
        Map<String,String> texts = new LinkedHashMap<>();
        texts.put("native_bootstrap_status.json", "{\"pid\":11340,\"uid\":10537,\"jniLoaded\":true,\"nativeApiAccepted\":true}");
        texts.put("native_self_test.json", new JSONObject().put("pid", testPid).put("uid",10537)
            .put("status","passed").put("scope","module-local-pure-function")
            .put("selfTestTouchesGameFunctions",false).put("installed",true).put("backupAvailable",true)
            .put("replacementCalls",1).put("baseline",46).put("originalResult",original).put("detouredResult",47).toString());
        texts.put("exam_lifecycle_status.json", "{\"startInstalled\":true,\"disposeInstalled\":true,\"endInstalled\":true}");
        texts.put("exam_entry_probe_status.json", "{\"pid\":11340,\"installed\":true,\"callsObserved\":1,\"recordedSamples\":1}");
        String cards = "{\"produceCards\":[{\"produceCardId\":\"old\"}]}";
        String metadata = "{\"selectedClassCount\":109}";
        String trace = "{\"event\":\"GetRandomInt\",\"seq\":1,\"before\":1,\"after\":270369}\n";
        Class<?> activity = Class.forName("dev.atuy1219.gakumas.progresscapture.DiagnosticActivity");
        Class<?> file = Class.forName(activity.getName()+"$SourceFile");
        Constructor<?> constructor=file.getDeclaredConstructor(String.class); constructor.setAccessible(true);
        Field content=file.getDeclaredField("content"); content.setAccessible(true);
        Field status=file.getDeclaredField("status"); status.setAccessible(true);
        Field sourceNames=activity.getDeclaredField("SOURCE_FILES"); sourceNames.setAccessible(true);
        Map<String,Object> sources=new LinkedHashMap<>();
        for(String name:(String[])sourceNames.get(null)) {
            Object source=constructor.newInstance(name);
            if(texts.containsKey(name)) { content.set(source,texts.get(name)); status.set(source,"obtained"); }
            sources.put(name,source);
        }
        Method report=activity.getDeclaredMethod("makeReport",String.class,String.class,String.class,
            String.class,Map.class,Map.class); report.setAccessible(true);
        JSONObject result=(JSONObject)report.invoke(null,trace,cards,"",metadata,sources,
            Collections.singletonMap("gamePid",running));
        JSONObject env=result.getJSONObject("environment");
        JSONObject init=env.getJSONObject("nativeInitialization");
        boolean current=running.equals("11340");
        boolean stopped=running.equals("none");
        require(init.getBoolean("currentProcess")==current,"wrong active-process verdict");
        require(init.getString("status").equals(current?"native-api-accepted":stopped?
            "last-run-native-api-accepted":"historical-native-api-accepted"),"previous success lost or treated as current");
        boolean valid=testPid==11340 && original==46;
        require(init.getBoolean("recordedSelfTestPassed")==valid,"bad backup/cross-run accepted");
        if(valid) require(init.getString("selfTest").equals(current?"passed":stopped?"last-run-passed":"historical-passed"),"wrong self-test scope");
        require(!init.getBoolean("gameCaptureVerified"),"module test promoted to game capture");
        require(!env.has("hookResolution"),"legacy StartExam hooks advertised as current");
        require(!env.has("runtimeMetadataInventory"),"unattributed inventory advertised as current");
        require(env.getJSONObject("historicalRecords").has("exam_lifecycle_status.json"),"history not retained");
        require(env.has("entryProbe")==current,"old probe installed advertised as active");
        require(env.getJSONObject("entryProbeRecord").getString("recordScope").equals(current?
            "current-process":stopped?"last-known-run":"historical-or-other-process"),"probe scope missing");
        require(result.getJSONObject("input").isNull("capturedCards"),"old cards promoted to current input");
        require(result.getJSONObject("realDevice").getJSONArray("events").length()==0,"old RNG used");
        require(result.getJSONObject("comparison").getInt("comparedRandomCalls")==0,"old RNG counted");
        System.out.print("ok");
    }
}
''')
        cls.classpath = os.pathsep.join(map(str, [cls.root, JSON_JAR, CLASSES, ANDROID_JAR]))
        subprocess.run(["javac", "-cp", cls.classpath, "-d", str(cls.root), str(process), str(harness)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def report(self, running, test_pid=11340, original=46):
        result = subprocess.run(["java", "-cp", self.classpath, "ReportEvidenceHarness",
                                 running, str(test_pid), str(original)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "ok")

    def test_stopped_game_preserves_recorded_success_without_claiming_live_hooks(self):
        self.report("none")

    def test_running_matching_pid_and_other_pid_are_distinct(self):
        self.report("11340")
        self.report("99999")

    def test_bad_backup_and_cross_process_test_are_rejected(self):
        self.report("11340", original=45)
        self.report("none", test_pid=11341)


if __name__ == "__main__":
    unittest.main()
