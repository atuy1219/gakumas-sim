package dev.atuy1219.gakumas.progresscapture;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.content.Intent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Offline, read-only diagnostics. This activity is in the MODULE process, not
 * the game's process. It reads the native LSPosed capture with explicit su
 * permission and never sends captured data over the network.
 *
 * Currently independent RNG verification only; full exam replay is delegated
 * to the host comparison tool with an independently verified stage profile.
 */
public class DiagnosticActivity extends Activity {
    private static final String GAME = "com.bandainamcoent.idolmaster_gakuen";
    private static final String GAME_DATA = "/data/user/" + (android.os.Process.myUid() / 100000) + "/" + GAME;
    private static final String GAME_FILES = GAME_DATA + "/files";
    private static final String TRACE_DIR = GAME_FILES + "/gakumas-sim/";
    private static final int EXPORT_REQUEST = 1201;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1202;
    private static final String NOTIFICATION_CHANNEL = "gakumas-capture-files";
    private static final String[] SOURCE_FILES = {
        "detail_log_capture.jsonl", "detail_log_capture_status.json",
        "bootstrap_status.json",
        "capture_status.json",
        "native_bootstrap_status.json",
        "native_self_test.json",
        "exam_session_status.json",
        "exam_lifecycle_status.json",
        "exam_entry_probe_status.json",
        "exam_entry_probes.jsonl",
        "exam_hook_trace_status.json",
        "ranking_replay_capture_status.json",
        "exam_runtime_inventory.json",
        "produce_cards.json",
        "exam_seed_trace.jsonl"
    };
    // Accessed only on the single-thread worker.
    private final Map<String, SourceFile> sourceCache = new LinkedHashMap<>();
    private final DiagnosticRootShell rootShell = new DiagnosticRootShell();
    private final Map<String, String> lastPreflight = new LinkedHashMap<>();
    private String resolvedTraceDir = TRACE_DIR;
    private final Set<String> previouslyObtained = new LinkedHashSet<>();
    private volatile String lastScreenState = "";
    // Explicitly requested only; never continuously read logcat during polling.
    private volatile String lastInjectionLog = "";

    private static final class SourceFile {
        final String name;
        String status = "missing";
        String fingerprint = "";
        String content = "";
        long size = -1L;
        String detail = "";
        SourceFile(String name) { this.name = name; }

        JSONObject asJson() throws JSONException {
            JSONObject info = new JSONObject();
            info.put("name", name);
            info.put("status", status);
            info.put("bytes", size < 0 ? JSONObject.NULL : size);
            if (!detail.isEmpty()) info.put("detail", detail);
            return info;
        }
    }
    private static final long POLL_MS = 2500L;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private TextView display;
    private TextView settingFeedback;
    private Button detailsButton;
    private volatile String detailedScreenState = "";
    private boolean detailedMode = false;
    private LinearLayout tabHost;
    private View diagnosticPage;
    private View settingsPage;
    private View capturePage;
    private int selectedTab = 0;
    private volatile boolean active;
    private volatile boolean checking;
    private volatile String latestReport = null;
    private volatile String lastDigest = "";
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!active) return;
            if (selectedTab == 1) checkCapture();
            main.postDelayed(this, POLL_MS);
        }
    };

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout shell=CaptureUi.shell(this);
        CaptureUi.applyWindow(this,shell);
        setContentView(shell);
        CaptureUi.header(this,shell,"学マス キャプチャ","記録・診断・設定");
        tabHost=new LinearLayout(this);
        tabHost.setOrientation(LinearLayout.VERTICAL);
        shell.addView(tabHost);
        capturePage=createCapturePage(shell);

        LinearLayout diagnostics=CaptureUi.scrollContent(this,shell);
        diagnosticPage=(View)diagnostics.getParent();
        CaptureUi.info(this,diagnostics,
            "Nativeの状態と記録ファイルを確認します。");
        LinearLayout actions=CaptureUi.card(this,diagnostics,"診断ツール",
            "必要に応じて詳細情報を表示・保存できます。");
        CaptureUi.button(this,actions,"診断を更新",this::checkCapture,true);
        detailsButton=CaptureUi.button(this,actions,"詳細を表示",()->{
            detailedMode=!detailedMode;
            detailsButton.setText(detailedMode?"概要を表示":"詳細を表示");
            display.setText(detailedMode?detailedScreenState:lastScreenState);
        });
        CaptureUi.button(this,actions,"診断JSONを保存",this::exportReport);
        CaptureUi.button(this,actions,"表示内容をコピー",()->copyDiagnostic(false));
        CaptureUi.button(this,actions,"初期化情報をコピー",()->copyDiagnostic(true));
        LinearLayout data=CaptureUi.card(this,diagnostics,"診断結果","");
        display=CaptureUi.secondary(this,"未確認です。Root権限が必要です。",13);
        display.setTextIsSelectable(true);
        display.setGravity(Gravity.START);
        data.addView(display,new LinearLayout.LayoutParams(-1,-2));

        LinearLayout settings=CaptureUi.scrollContent(this,shell);
        settingsPage=(View)settings.getParent();
        CaptureUi.info(this,settings,
            "変更後はゲームを完全終了して再起動してください。");
        LinearLayout hookCard=CaptureUi.card(this,settings,"取得設定",
            "記録する内容を選びます。");
        CaptureUi.button(this,hookCard,"取得モードを選択",this::chooseHookMode,true);
        CaptureUi.button(this,hookCard,"Hookを無効にする",
            ()->CaptureUi.confirm(this,"記録を停止",
                "次のゲーム起動からHookを無効にします。",
                "無効にする",()->saveHookMode(0)));
        LinearLayout debugCard=CaptureUi.card(this,settings,"トラブルシューティング",
            "初期化や保存先の問題を確認します。");
        CaptureUi.button(this,debugCard,"LSPosed初期化ログを取得",this::collectInjectionLogs);
        CaptureUi.button(this,debugCard,"保存先の権限を修復",
            ()->CaptureUi.confirm(this,"学マスの診断ファイル保存先を修復",
                "診断専用ディレクトリとHook設定ファイルの所有者・SELinuxラベルのみを修復します。"
                +"既存のHook設定は安全モードに戻します。ゲームのセーブデータは変更しません。",
                "修復する",this::repairCaptureDirectory));
        
        settingFeedback=CaptureUi.secondary(this,"",14);
        settingFeedback.setTextIsSelectable(true);
        LinearLayout.LayoutParams feedback=new LinearLayout.LayoutParams(-1,-2);
        feedback.topMargin=CaptureUi.dp(this,12);
        debugCard.addView(settingFeedback,feedback);

        int initial=savedInstanceState!=null
            ?savedInstanceState.getInt("currentTab",0)
            :getIntent().getIntExtra("tab",0);
        selectTab(initial);
        setupNotifications();
    }

    /** The launcher Activity supplies the capture tab in the same window. */
    protected View createCapturePage(LinearLayout shell) {
        throw new IllegalStateException("The capture tab must be supplied by the launcher");
    }

    private void selectTab(int tab) {
        selectedTab=Math.max(0,Math.min(2,tab));
        tabHost.removeAllViews();
        CaptureUi.tabs(this,tabHost,selectedTab,this::selectTab);
        capturePage.setVisibility(selectedTab==0?View.VISIBLE:View.GONE);
        diagnosticPage.setVisibility(selectedTab==1?View.VISIBLE:View.GONE);
        settingsPage.setVisibility(selectedTab==2?View.VISIBLE:View.GONE);
        if (active && selectedTab==1) checkCapture();
    }

    @Override public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        selectTab(intent.getIntExtra("tab",0));
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        out.putInt("currentTab",selectedTab);
        super.onSaveInstanceState(out);
    }

    @Override protected void onStart() {
        super.onStart();
        active = true;
        main.post(poll);
    }

    @Override protected void onStop() {
        active = false;
        main.removeCallbacks(poll);
        super.onStop();
    }

    @Override protected void onDestroy() {
        worker.shutdownNow();
        super.onDestroy();
    }

    private void chooseHookMode() {
        final String[] names={"無効（安全）","オーディション・リプレイ","試験イベント取得","試験開始診断","Hook動作確認"};
        final int[] masks={0,131072,65536,128,256};
        CaptureUi.choose(this,"取得モード",names,index->{
            if(index<0||index>=masks.length)return;
            saveHookMode(masks[index]);
        });
    }

    private static String hookModeName(int mask) {
        switch(mask){
            case 0:return "無効（安全）";
            case 131072:return "リプレイ取得";
            case 65536:return "試験イベント取得";
            case 128:return "試験開始診断";
            case 256:return "Hook動作確認";
            default:return "その他";
        }
    }

    private void repairCaptureDirectory() {
        configureNativeMask(0, "保存先修復成功（フック無効）");
    }

    private void saveHookMode(int mask) {
        configureNativeMask(mask, "取得機能を「" + hookModeName(mask) + "」に変更しました");
    }

    private void configureNativeMask(int mask, String success) {
        worker.execute(() -> {
            try {
                scanRootFiles();
                sourceCache.clear();
                String gameUser = lastPreflight.get("gameUser");
                if (gameUser != null && !"unavailable".equals(gameUser)
                    && !gameUser.equals(lastPreflight.get("diagnosticUser")))
                    throw new IllegalStateException("学マスと診断アプリのAndroidユーザーが異なります。"
                        + "同じユーザー領域で診断してください。設定は変更していません。");
                if ("game-process-root-read-only".equals(lastPreflight.get("tracePathKind")))
                    throw new IllegalStateException("Rootの通常パスから学マス保存先が見えません。"
                        + "ゲームプロセス経由の読取のみ可能です。初期化ログを含む診断JSONを"
                        + "書き出してください。設定は変更していません。");
                final String result = runRoot(DiagnosticStorage.configure(GAME_FILES, mask, SOURCE_FILES));
                main.post(() -> {
                    String message=success + ": " + result
                        + "\n学マスの完全終了・再起動後に診断を再確認してください。";
                    settingFeedback.setText(message);
                    display.append("\n" + message);
                });
            } catch (Exception error) {
                main.post(() -> {
                    String message="設定／保存先修復失敗: " + error.getMessage();
                    settingFeedback.setText(message);
                    display.append("\n" + message);
                });
            }
        });
    }

    private void collectInjectionLogs() {
        worker.execute(() -> {
            try {
                // Explicit action only. Export our tag and AVCs mentioning
                // fixed capture names; do not export unrelated game logs.
                String command = "logcat -d -v brief -s GakumasCapture:V 2>&1 | tail -n 48; "
                    + "printf '\\n--- capture-file AVC (empty does not prove no denial) ---\\n'; "
                    + "logcat -b all -d -v brief 2>/dev/null | grep -F 'avc: denied' "
                    + "| grep -E 'gakumas-sim|gakumas_progress_capture|bootstrap_status\\.json|native_hookmask\\.txt' "
                    + "| tail -n 24";
                String logs = runRoot(command).trim();
                if (logs.length() > 16000)
                    logs = logs.substring(logs.length() - 16000);
                if (logs.isEmpty() || logs.startsWith("--- capture-file AVC"))
                    logs = "(GakumasCaptureのログは確認できませんでした。"
                        + "LSPosedの適用範囲とAPIバージョンを確認してください。)\n" + logs;
                lastInjectionLog = logs;
                final String toDisplay = logs;
                main.post(() -> {
                    display.append("\n\n--- LSPosed初期化ログ ---\n" + toDisplay);
                    lastDigest = "";
                    checkCapture();
                });
            } catch (Exception error) {
                main.post(() -> display.append(
                    "\n初期化ログを取得できません: " + error.getMessage()));
            }
        });
    }

    private void setupNotifications() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && manager != null) {
            NotificationChannel channel = new NotificationChannel(
                NOTIFICATION_CHANNEL, "学マス 診断ファイル取得",
                NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("LSPosedが新しい診断ファイルを取得したときに通知");
            manager.createNotificationChannel(channel);
        }
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            && !getPreferences(MODE_PRIVATE).getBoolean("notification_permission_requested", false)) {
            getPreferences(MODE_PRIVATE).edit()
                .putBoolean("notification_permission_requested", true).apply();
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},
                NOTIFICATION_PERMISSION_REQUEST);
        }
    }

    private void notifyNewFiles(ArrayList<String> names) {
        if (names.isEmpty()) return;
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        String joined = android.text.TextUtils.join("、", names);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, NOTIFICATION_CHANNEL)
            : new Notification.Builder(this);
        builder.setContentTitle("学マス診断: " + names.size() + "件のファイルを取得")
            .setContentText(joined)
            .setStyle(new Notification.BigTextStyle().bigText(joined))
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setAutoCancel(true);
        manager.notify(101, builder.build());
    }

    private String runRoot(String command) throws Exception {
        return rootShell.execute(command);
    }

    private Map<String, SourceFile> scanRootFiles() throws Exception {
        DiagnosticScan.Result scan = DiagnosticScan.parse(runRoot(DiagnosticScan.command(
            android.os.Process.myUid() / 100000, getApplicationInfo().sourceDir, SOURCE_FILES)));
        lastPreflight.clear();
        lastPreflight.putAll(scan.preflight);
        lastPreflight.put("rootInvocation", rootShell.invocation());
        lastPreflight.put("suHelpStatus", rootShell.helpStatus());
        resolvedTraceDir = DiagnosticScan.traceDirectory(android.os.Process.myUid() / 100000, scan);
        Map<String, SourceFile> files = new LinkedHashMap<>();
        for (String name : SOURCE_FILES) files.put(name, new SourceFile(name));
        for (String[] parts : scan.files.values()) {
            SourceFile info = files.get(parts[0]);
            if (info == null) continue;
            if ("MISSING".equals(parts[1])) continue;
            if ("INACCESSIBLE".equals(parts[1])) {
                info.status = "inaccessible";
                info.detail = "保存先を参照できません（未生成とは判定できません）";
                continue;
            }
            if ("ERROR".equals(parts[1]) || parts.length != 3) {
                info.status = "error";
                info.detail = "ファイルの状態を取得できません";
                continue;
            }
            try {
                info.size = Long.parseLong(parts[1]);
                info.fingerprint = parts[1] + "|" + parts[2];
                info.status = info.size == 0 ? "empty" : "available";
            } catch (NumberFormatException error) {
                info.status = "error";
                info.detail = "ファイルのサイズ情報が不正です";
            }
        }
        return files;
    }

    private String readRootFile(String basename) throws Exception {
        boolean trusted = false;
        for (String name : SOURCE_FILES) if (name.equals(basename)) trusted = true;
        if (!trusted) throw new SecurityException("Unexpected filename");
        return runRoot("cat '" + resolvedTraceDir + basename + "'");
    }

    private Map<String, SourceFile> readAvailableFiles() throws Exception {
        String previousPid = lastPreflight.get("gamePid");
        String previousTraceDir = resolvedTraceDir;
        Map<String, SourceFile> files = scanRootFiles();
        if (!String.valueOf(lastPreflight.get("gamePid")).equals(previousPid)
            || !resolvedTraceDir.equals(previousTraceDir)) sourceCache.clear();
        for (SourceFile info : files.values()) {
            if (!"available".equals(info.status) && !"empty".equals(info.status)) continue;
            SourceFile prior = sourceCache.get(info.name);
            if (prior != null && info.fingerprint.equals(prior.fingerprint)
                && ("obtained".equals(prior.status) || "empty".equals(prior.status))) {
                info.content = prior.content;
                info.status = prior.status;
                continue;
            }
            if ("empty".equals(info.status)) continue;
            try {
                info.content = readRootFile(info.name);
                info.status = info.content.isEmpty() ? "empty" : "obtained";
            } catch (Exception error) {
                info.status = "error";
                info.detail = error.getMessage() == null ? error.toString() : error.getMessage();
            }
        }
        sourceCache.clear();
        sourceCache.putAll(files);
        return files;
    }

    private static String content(Map<String, SourceFile> files, String name) {
        SourceFile info = files.get(name);
        return info == null ? "" : info.content;
    }

    private static JSONObject fileStatuses(Map<String, SourceFile> files) throws JSONException {
        JSONObject result = new JSONObject();
        for (SourceFile info : files.values()) result.put(info.name, info.asJson());
        return result;
    }

    private static String sha256(String content) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] bytes = digest.digest(content.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format("%02x", value & 0xff));
        return result.toString();
    }

    private static long nextXorShift(long value) {
        long x = value & 0xffffffffL;
        x = (x ^ ((x << 13) & 0xffffffffL)) & 0xffffffffL;
        x = (x ^ (x >>> 17)) & 0xffffffffL;
        x = (x ^ ((x << 5) & 0xffffffffL)) & 0xffffffffL;
        return x;
    }

    private static JSONObject currentRecord(String text, String name,
        Map<String, String> preflight, JSONObject historical, JSONArray warnings) throws JSONException {
        if (text.trim().isEmpty()) return null;
        try {
            JSONObject record = new JSONObject(text);
            String scope = DiagnosticEvidence.scope(preflight.get("gamePid"), record.optInt("pid", -1), -1);
            if ("current-process".equals(scope)) return record;
            historical.put(name, new JSONObject().put("scope", scope).put("record", record));
            warnings.put("historical-or-unattributed-source:" + name);
        } catch (JSONException malformed) {
            warnings.put("invalid-" + name);
        }
        return null;
    }

    private static JSONObject makeReport(String trace, String cards, String sessionJson, String metadataJson,
        Map<String, SourceFile> sources, Map<String, String> preflight) throws Exception {
        JSONArray events = new JSONArray();
        JSONArray warnings = new JSONArray();
        JSONObject traceStart = null;
        JSONObject lastSnapshot = null;
        JSONObject historical = new JSONObject();
        int ignoredEvents = 0;
        for (String line : trace.split("\n")) {
            if (line.trim().isEmpty()) continue;
            try {
                JSONObject event = new JSONObject(line);
                if (!event.has("event")) {
                    warnings.put("invalid-event-schema");
                    continue;
                }
                if (!"current-process".equals(DiagnosticEvidence.scope(
                    preflight.get("gamePid"), event.optInt("pid", -1), -1))) {
                    ignoredEvents++;
                    continue;
                }
                events.put(event);
                if ("trace-start".equals(event.optString("event"))) traceStart = event;
                if (event.has("hand") && event.optJSONArray("hand") != null) lastSnapshot = event;
            } catch (JSONException error) {
                warnings.put("invalid-or-partial-jsonl-line");
            }
        }

        JSONArray randomEvents = new JSONArray();
        JSONArray differences = new JSONArray();
        JSONObject firstDifference = null;
        for (int i = 0; i < events.length(); i++) {
            JSONObject actual = events.getJSONObject(i);
            if (!"GetRandomInt".equals(actual.optString("event"))) continue;
            if (!actual.has("before") || !actual.has("after")) {
                warnings.put("missing-rng-state-at-seq:" + actual.optLong("seq"));
                continue;
            }
            long before = actual.getLong("before") & 0xffffffffL;
            long after = nextXorShift(before);
            JSONObject simulated = new JSONObject();
            simulated.put("seq", actual.optLong("seq"));
            simulated.put("event", "GetRandomInt");
            simulated.put("before", before);
            simulated.put("after", after);
            if ("range".equals(actual.optString("overload"))
                && actual.has("minimum") && actual.has("maximum")) {
                long min = actual.getLong("minimum");
                long max = actual.getLong("maximum");
                if (max >= min) {
                    long expected = min + BigInteger.valueOf(before)
                        .multiply(BigInteger.valueOf(max - min)).shiftRight(32).longValue();
                    simulated.put("result", expected);
                }
            }
            randomEvents.put(simulated);
            if ((actual.getLong("after") & 0xffffffffL) != after) {
                JSONObject diff = new JSONObject();
                diff.put("seq", actual.optLong("seq"));
                diff.put("field", "randomState");
                diff.put("actual", actual.getLong("after") & 0xffffffffL);
                diff.put("simulated", after);
                differences.put(diff);
                if (firstDifference == null) firstDifference = diff;
            }
            if (simulated.has("result") && actual.has("result")
                && simulated.getLong("result") != actual.getLong("result")) {
                JSONObject diff = new JSONObject();
                diff.put("seq", actual.optLong("seq"));
                diff.put("field", "randomResult");
                diff.put("actual", actual.getLong("result"));
                diff.put("simulated", simulated.getLong("result"));
                differences.put(diff);
                if (firstDifference == null) firstDifference = diff;
            }
        }

        if (ignoredEvents > 0) warnings.put("ignored-historical-or-unattributed-trace-events:" + ignoredEvents);
        JSONObject cardsPayload = currentRecord(cards, "produce_cards.json", preflight, historical, warnings);
        if (traceStart == null || !traceStart.optBoolean("hooksInstalled", false)) {
            warnings.put("trace-hooks-not-confirmed");
        }
        warnings.put("full-gameplay-parity-not-available: score/status/choices not captured");
        JSONObject report = new JSONObject();
        report.put("schemaVersion", 1);
        report.put("createdAtUnixMs", System.currentTimeMillis());
        JSONObject environment = new JSONObject();
        environment.put("origin", "android-module");
        String entryProbeJson = content(sources, "exam_entry_probe_status.json");
        JSONObject probe = currentRecord(entryProbeJson, "exam_entry_probe_status.json", preflight, historical, warnings);
        if (probe != null) environment.put("entryProbe", probe);
        // These legacy hooks are unreachable for ALL accepted masks. Preserve
        // their files as historical evidence, never advertise them as live.
        String hookResolution = content(sources, "exam_lifecycle_status.json");
        if (!hookResolution.trim().isEmpty()) {
            try { historical.put("exam_lifecycle_status.json", new JSONObject()
                .put("scope", "legacy-hooks-disabled").put("record", new JSONObject(hookResolution))); }
            catch (JSONException error) { warnings.put("invalid-hook-resolution"); }
        }
        environment.put("legacyDetailedCaptureEnabled", false);
        environment.put("nativeBuildId",
            traceStart == null ? JSONObject.NULL : traceStart.optString("libil2cppBuildId", ""));
        environment.put("nativeSessionStarted",
            traceStart == null ? JSONObject.NULL : traceStart.optLong("capturedAtUnixMs"));
        environment.put("captureSha256", sha256(trace));
        JSONObject session = currentRecord(sessionJson, "exam_session_status.json", preflight, historical, warnings);
        if (session != null) environment.put("session", session);
        JSONObject inventory = currentRecord(metadataJson, "exam_runtime_inventory.json", preflight, historical, warnings);
        if (inventory != null) environment.put("runtimeMetadataInventory", inventory);
        environment.put("historicalRecords", historical);
        for (String config : new String[]{"bootstrap_status.json", "capture_status.json", "native_bootstrap_status.json", "native_self_test.json"}) {
            String text = content(sources, config);
            if (!text.trim().isEmpty()) {
                try { environment.put(config, new JSONObject(text)); }
                catch (JSONException error) { warnings.put("invalid-" + config); }
            }
        }
        JSONObject nativeInit = new JSONObject();
        String nativeStatus = content(sources, "native_bootstrap_status.json");
        String selfTestStatus = content(sources, "native_self_test.json");
        nativeInit.put("status", "unobserved");
        nativeInit.put("gameCaptureVerified", false);
        try {
            JSONObject state = nativeStatus.isEmpty() ? new JSONObject() : new JSONObject(nativeStatus);
            int pid = state.optInt("pid", -1);
            int uid = state.optInt("uid", -1);
            String scope = DiagnosticEvidence.scope(preflight.get("gamePid"), pid, pid);
            boolean current = "current-process".equals(scope);
            boolean lastRun = "last-known-run".equals(scope);
            nativeInit.put("recordedPid", pid);
            nativeInit.put("recordScope", scope);
            nativeInit.put("currentProcess", current);
            String initialization = !state.optBoolean("jniLoaded") ? "jni-not-observed"
                : state.optBoolean("nativeApiAccepted") ? "native-api-accepted" : "jni-loaded-native-api-missing";
            nativeInit.put("status", pid <= 0 ? "unobserved" : current ? initialization
                : (lastRun ? "last-run-" : "historical-") + initialization);
            if (!selfTestStatus.isEmpty()) {
                JSONObject test = new JSONObject(selfTestStatus);
                boolean passed = state.optBoolean("jniLoaded") && state.optBoolean("nativeApiAccepted")
                    && DiagnosticEvidence.selfTestPassed(test.optString("status"), test.optString("scope"),
                        test.optBoolean("selfTestTouchesGameFunctions", true),
                        test.optInt("pid", -2), pid, test.optInt("uid", -2), uid,
                        test.optBoolean("installed"), test.optBoolean("backupAvailable"),
                        test.optInt("replacementCalls", -1), test.optInt("baseline", Integer.MIN_VALUE),
                        test.optInt("originalResult", Integer.MAX_VALUE), test.optInt("detouredResult", Integer.MIN_VALUE));
                nativeInit.put("recordedSelfTestPassed", passed);
                String result = passed ? "passed" : "passed".equals(test.optString("status"))
                    ? "invalid-evidence" : test.optString("status", "unverified");
                boolean sameRun = pid > 0 && pid == test.optInt("pid", -2) && uid == test.optInt("uid", -2);
                nativeInit.put("selfTest", !sameRun ? "unattributed-or-other-run"
                    : current ? result : (lastRun ? "last-run-" : "historical-") + result);
            }
        } catch (JSONException malformed) {
            warnings.put("invalid-native-initialization-status");
        }
        if (!entryProbeJson.isEmpty()) {
            try {
                JSONObject record = new JSONObject(entryProbeJson);
                record.put("recordScope", DiagnosticEvidence.scope(preflight.get("gamePid"),
                    record.optInt("pid", -1), nativeInit.optInt("recordedPid", -1)));
                environment.put("entryProbeRecord", record);
            } catch (JSONException malformed) { warnings.put("invalid-entry-probe-status"); }
        }
        environment.put("nativeInitialization", nativeInit);
        report.put("sources", fileStatuses(sources));
        report.put("preflight", new JSONObject(preflight));
        for (SourceFile info : sources.values()) {
            if (!"obtained".equals(info.status))
                warnings.put("source-" + info.status + ":" + info.name);
        }
        if (!"obtained".equals(sources.get("bootstrap_status.json").status)
            && !"obtained".equals(sources.get("capture_status.json").status)) {
            warnings.put("module-injection-or-capture-bootstrap-not-observed");
        }
        report.put("environment", environment);

        JSONObject input = new JSONObject();
        input.put("capturedCards", cardsPayload == null ? JSONObject.NULL : cardsPayload);
        input.put("profile", JSONObject.NULL);
        report.put("input", input);

        JSONObject realDevice = new JSONObject();
        realDevice.put("events", events);
        realDevice.put("finalCheckpoint", lastSnapshot == null ? JSONObject.NULL : lastSnapshot);
        report.put("realDevice", realDevice);

        JSONObject simulation = new JSONObject();
        simulation.put("mode", "rng-only");
        simulation.put("randomEvents", randomEvents);
        simulation.put("checkpoints", new JSONArray());
        simulation.put("finalState", JSONObject.NULL);
        report.put("simulation", simulation);

        JSONObject comparison = new JSONObject();
        comparison.put("status", differences.length() == 0 ? "unverified" : "mismatch");
        comparison.put("complete", false);
        comparison.put("firstDivergence",
            firstDifference == null ? JSONObject.NULL : firstDifference);
        comparison.put("differences", differences);
        comparison.put("warnings", warnings);
        comparison.put("comparedRandomCalls", randomEvents.length());
        comparison.put("comparedGameCheckpoints", 0);
        report.put("comparison", comparison);
        return report;
    }

    private void checkCapture() {
        if (checking) return;
        checking = true;
        worker.execute(() -> {
            try {
                Map<String, SourceFile> sources = readAvailableFiles();
                ArrayList<String> acquired = new ArrayList<>();
                Set<String> liveFiles = new LinkedHashSet<>();
                StringBuilder fileSummary = new StringBuilder("ファイル取得状況\n");
                fileSummary.append("Root UID: ").append(lastPreflight.get("rootUid")).append("\n");
                fileSummary.append("Root実行方法: ").append(lastPreflight.get("rootInvocation")).append("\n");
                fileSummary.append("su機能検出: ").append(lastPreflight.get("suHelpStatus")).append("\n");
                fileSummary.append("ゲームPID: ").append(lastPreflight.get("gamePid")).append("\n");
                fileSummary.append("設定済みフックマスク: ").append(lastPreflight.get("hookMask")).append("\n");
                fileSummary.append("ゲーム内Nativeライブラリ: ")
                    .append(lastPreflight.get("moduleLibraryMapped")).append("\n");
                fileSummary.append("IL2CPPライブラリ: ")
                    .append(lastPreflight.get("il2cppLibraryMapped")).append("\n");
                fileSummary.append("保存先ディレクトリ: ")
                    .append(lastPreflight.get("captureDirectory")).append("\n");
                fileSummary.append("保存先所有者: ")
                    .append(lastPreflight.get("captureDirectoryOwner")).append("\n");
                fileSummary.append("同一ユーザーのゲームデータ: ").append(lastPreflight.get("targetDataDir"))
                    .append("\n");
                if (lastPreflight.containsKey("candidateDataDir")) {
                    fileSummary.append("検出したユーザー領域: ")
                        .append(lastPreflight.get("candidateDataDir")).append("\n");
                }
                fileSummary.append("ゲームUID／Androidユーザー: ")
                    .append(lastPreflight.get("gameUid")).append(" / ")
                    .append(lastPreflight.get("gameUser")).append("\n");
                fileSummary.append("診断アプリのAndroidユーザー: ")
                    .append(lastPreflight.get("diagnosticUser")).append("\n");
                fileSummary.append("期待するゲームデータ: ")
                    .append(lastPreflight.get("expectedDataDir")).append("\n");
                fileSummary.append("実際の読取先: ").append(resolvedTraceDir).append("\n");
                fileSummary.append("読取経路: ").append(lastPreflight.get("tracePathKind")).append("\n");
                fileSummary.append("SELinuxモード: ").append(lastPreflight.get("selinuxMode")).append("\n");
                fileSummary.append("Rootから見えるゲームデータ: ")
                    .append(lastPreflight.get("targetDataDirDetails")).append("\n");
                fileSummary.append("ゲームプロセスから見えるfiles: ")
                    .append(lastPreflight.get("gameProcessFilesDetails")).append("\n");
                fileSummary.append("Root／init／ゲームのmount namespace: ")
                    .append(lastPreflight.get("rootMountNamespace")).append(" / ")
                    .append(lastPreflight.get("initMountNamespace")).append(" / ")
                    .append(lastPreflight.get("gameMountNamespace")).append("\n");
                if ("game-process-root-read-only".equals(lastPreflight.get("tracePathKind")))
                    fileSummary.append("通常パスは見えないため、ゲームプロセス経由で読み取りました。修復・設定変更は通常パスが参照できる環境で行う必要があります。\n");
                fileSummary.append("\n");
                for (SourceFile info : sources.values()) {
                    if ("obtained".equals(info.status)) {
                        liveFiles.add(info.name);
                        if (!previouslyObtained.contains(info.name)) acquired.add(info.name);
                        fileSummary.append("取得済み  ").append(info.name).append(" (")
                            .append(info.size).append(" B)\n");
                    } else if ("empty".equals(info.status)) {
                        fileSummary.append("空ファイル  ").append(info.name).append("\n");
                    } else if ("missing".equals(info.status)) {
                        fileSummary.append("未検出  ").append(info.name).append("\n");
                    } else {
                        fileSummary.append("取得失敗  ").append(info.name).append(": ")
                            .append(info.detail).append("\n");
                    }
                }
                previouslyObtained.clear();
                previouslyObtained.addAll(liveFiles);
                if (!acquired.isEmpty()) main.post(() -> notifyNewFiles(acquired));
                if (liveFiles.isEmpty()) {
                    fileSummary.append("\n診断: 全ファイルを取得できません。未生成か、保存先へのアクセス不能かを切り分ける必要があります。");
                    if ("none".equals(lastPreflight.get("gamePid"))) {
                        fileSummary.append("診断では学マスPIDを検出できていません。起動状態を確認してください。");
                    } else if ("no".equals(lastPreflight.get("moduleLibraryMapped"))) {
                        fileSummary.append("ゲームプロセス内にNativeモジュールが確認できません。");
                        fileSummary.append("APK内直接ロードではmapsにSO名が出ない場合があります。初期化JSON／ログを確認してください。");
                    } else if ("yes".equals(lastPreflight.get("moduleLibraryMapped"))) {
                        fileSummary.append("Nativeライブラリはロード済みですが診断ファイルがありません。");
                        fileSummary.append("初期化失敗またはファイル書込権限を確認してください。");
                    } else {
                        fileSummary.append("Rootは使えますが、Nativeモジュールのロード状態を判定できません。");
                    }
                    fileSummary.append("\n「LSPosed初期化ログを取得」で詳細を調べられます。\n");
                }
                StringBuilder key = new StringBuilder();
                for (SourceFile source : sources.values()) {
                    key.append(source.name).append('|').append(source.status)
                        .append('|').append(source.fingerprint).append('|').append(source.detail).append(';');
                }
                key.append(lastPreflight.toString());
                String digest = sha256(key.toString());
                if (!digest.equals(lastDigest)) {
                    JSONObject report = makeReport(
                        content(sources, "exam_seed_trace.jsonl"),
                        content(sources, "produce_cards.json"),
                        content(sources, "exam_session_status.json"),
                        content(sources, "exam_runtime_inventory.json"), sources,
                        new LinkedHashMap<>(lastPreflight));
                    if (!lastInjectionLog.isEmpty())
                        report.put("injectionLogcat", lastInjectionLog);
                    String entryProbes = content(sources, "exam_entry_probes.jsonl");
                    if (!entryProbes.isEmpty()) {
                        JSONArray probeEvents = new JSONArray();
                        JSONObject initEvidence = report.getJSONObject("environment").getJSONObject("nativeInitialization");
                        String probePid = lastPreflight.get("gamePid");
                        boolean priorRun = "none".equals(probePid);
                        if (priorRun) probePid = String.valueOf(initEvidence.optInt("recordedPid", -1));
                        report.put("entryProbeEventScope", priorRun ? "last-known-run" : "current-process");
                        for (String line : entryProbes.split("\\r?\\n")) {
                            if (line.trim().isEmpty()) continue;
                            try {
                                JSONObject event = new JSONObject(line);
                                // Last-run samples remain useful when stopped,
                                // but are explicitly distinct from current ones.
                                if (event.optInt("pid", -1) > 0
                                    && String.valueOf(event.optInt("pid", -1)).equals(probePid))
                                    probeEvents.put(event);
                            }
                            catch (JSONException malformed) {
                                probeEvents.put(new JSONObject()
                                    .put("event", "invalid-probe-record"));
                            }
                            if (probeEvents.length() >= 128) break;
                        }
                        report.put("entryProbeEvents", probeEvents);
                    }
                    String serialized = report.toString(2);
                    File saved = new File(getFilesDir(), "gakumas-diagnostic-latest.json");
                    try (FileOutputStream out = new FileOutputStream(saved)) {
                        out.write(serialized.getBytes(StandardCharsets.UTF_8));
                    }
                    latestReport = serialized;
                    lastDigest = digest;
                    JSONObject comparison = report.getJSONObject("comparison");
                    JSONObject init = report.getJSONObject("environment").getJSONObject("nativeInitialization");
                    fileSummary.append("\nNative初期化: ").append(init.optString("status"))
                        .append("\nNative自己テスト: ").append(init.optString("selfTest", "未実行"))
                        .append("\n記録PID: ").append(init.optInt("recordedPid", -1))
                        .append(" / ").append(init.optString("recordScope", "unobserved"))
                        .append("\n（ゲーム関数のログ取得・正常動作は別途検証が必要）\n");
                    if ("none".equals(lastPreflight.get("gamePid")))
                        fileSummary.append("学マスPIDは今回の検査では未検出です。last-runは最後の実行記録です。\n");
                    StringBuilder message = new StringBuilder(fileSummary);
                    message.append("\n診断ステータス: ").append(comparison.getString("status")).append("\n");
                    message.append("RNG比較件数: ").append(comparison.getInt("comparedRandomCalls")).append("\n");
                    message.append("差分件数: ").append(comparison.getJSONArray("differences").length()).append("\n");
                    JSONObject sessionStatus = report.getJSONObject("environment").optJSONObject("session");
                    if (sessionStatus != null) {
                        message.append("試験記録: ").append(sessionStatus.optString("phase", "unknown"))
                            .append(" / ").append(sessionStatus.optString("mode", "unknown"))
                            .append(" / ExamType=").append(sessionStatus.optInt("examType", -1)).append("\n");
                    }
                    JSONObject hooks = report.getJSONObject("environment")
                        .optJSONObject("hookResolution");
                    JSONObject probe = report.getJSONObject("environment")
                        .optJSONObject("entryProbe");
                    JSONObject recordedProbe = report.getJSONObject("environment").optJSONObject("entryProbeRecord");
                    if (recordedProbe != null) {
                        message.append("SetUpExam記録: ").append(recordedProbe.optString("recordScope"))
                            .append(" / PID ").append(recordedProbe.optInt("pid", -1))
                            .append(" / callsObserved=").append(recordedProbe.optInt("callsObserved", 0))
                            .append(" / recordedSamples=").append(recordedProbe.optInt("recordedSamples", 0)).append("\n");
                    }
                    if (probe != null) {
                        message.append("SetUpExam呼出元プローブ: ")
                            .append(probe.optBoolean("installed", false) ? "installed" : "unverified")
                            .append("\n");
                    }
                    // Historical status is available in JSON but is not presented as active capture.

                    if (hooks != null) {
                        message.append("ExamSequence.StartExam: ")
                            .append(hooks.optBoolean("startInstalled", false) ? "installed" : "unverified")
                            .append("\n");
                        message.append("ExamSequence.Dispose: ")
                            .append(hooks.optBoolean("disposeInstalled", false) ? "installed" : "unverified")
                            .append("\n");
                        message.append("ExamParameterModel.SetExamEndComplete: ")
                            .append(hooks.optBoolean("endInstalled", false) ? "installed" : "unverified")
                            .append("\n");
                    }
                    JSONObject metadata = report.getJSONObject("environment")
                        .optJSONObject("runtimeMetadataInventory");
                    if (metadata != null) {
                        message.append("IL2CPP検出クラス: ")
                            .append(metadata.optInt("selectedClassCount", 0)).append("\n");
                    }
                    JSONObject first = comparison.optJSONObject("firstDivergence");
                    if (first != null) message.append("最初の差分: ")
                        .append(first.toString()).append("\n");
                    if (!"obtained".equals(sources.get("exam_seed_trace.jsonl").status)) {
                        message.append("\n試験ログはまだ取得できていません。"
                            + "学マス側のフック状態はcapture_status.jsonを確認してください。"
                            + "ファイル未生成とRoot権限不足は別の状態です。\n");
                    }
                    if (!lastInjectionLog.isEmpty())
                        message.append("\n--- GakumasCapture初期化ログ ---\n")
                            .append(lastInjectionLog).append("\n");
                    message.append("\n診断JSONには各ファイルの取得状態も含まれます。");
                    String shown = "ゲームPID: " + lastPreflight.get("gamePid")
                        + "\nNative初期化: " + init.optString("status","未確認")
                        + "\n取得ファイル: " + liveFiles.size() + "件"
                        + "\nRNG差分: " + comparison.getJSONArray("differences").length() + "件";
                    lastScreenState = shown;
                    detailedScreenState = message.toString();
                    main.post(() -> display.setText(detailedMode?detailedScreenState:shown));
                }
            } catch (Exception error) {
                String explanation = "ファイル一覧の検査に失敗しました: " + error.getMessage()
                    + "\nエラーも診断JSONとして書き出せます。初期化ログを取得して書き出してください。";
                // Never export a previous successful scan after a failed one.
                sourceCache.clear();
                lastPreflight.clear();
                lastPreflight.put("scanComplete", "no");
                lastPreflight.put("scanError", String.valueOf(error.getMessage()));
                lastPreflight.put("rootInvocation", rootShell.invocation());
                lastPreflight.put("suHelpStatus", rootShell.helpStatus());
                lastDigest = "";
                latestReport = null;
                try {
                    Map<String, SourceFile> failed = new LinkedHashMap<>();
                    for (String name : SOURCE_FILES) {
                        SourceFile file = new SourceFile(name);
                        file.status = "error";
                        file.detail = "一覧検査失敗のため取得状態は不明";
                        failed.put(name, file);
                    }
                    JSONObject report = makeReport("", "", "", "", failed,
                        new LinkedHashMap<>(lastPreflight));
                    if (!lastInjectionLog.isEmpty()) report.put("injectionLogcat", lastInjectionLog);
                    latestReport = report.toString(2);
                } catch (Exception reportError) {
                    explanation += "\nエラーJSON作成失敗: " + reportError.getMessage();
                }
                lastScreenState = explanation;
                final String shown = explanation;
                main.post(() -> display.setText(shown));
            } finally {
                checking = false;
            }
        });
    }

    private void copyDiagnostic(boolean json) {
        String text = json ? latestReport : display.getText().toString();
        if (text == null || text.isEmpty()) {
            Toast.makeText(this, "まだ診断データがありません", Toast.LENGTH_SHORT).show();
            return;
        }
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (clipboard == null) {
            Toast.makeText(this, "クリップボードを利用できません", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            if (json) {
                // Clipboard payload deliberately omits inventories/card/trace
                // dumps. Full diagnostic JSON remains available via export.
                JSONObject report = new JSONObject(text);
                JSONObject compact = new JSONObject();
                compact.put("scope", "initialization-only");
                compact.put("preflight", report.optJSONObject("preflight"));
                compact.put("sources", report.opt("sources"));
                JSONObject environment = report.optJSONObject("environment");
                if (environment != null) {
                    for (String name : new String[]{"nativeInitialization", "bootstrap_status.json",
                        "capture_status.json", "native_bootstrap_status.json", "native_self_test.json", "entryProbeRecord"}) {
                        if (environment.has(name)) compact.put(name, environment.get(name));
                    }
                }
                if (report.has("entryProbeEvents")) {
                    compact.put("entryProbeEvents", report.get("entryProbeEvents"));
                    compact.put("entryProbeEventScope", report.optString("entryProbeEventScope"));
                }
                if (report.has("injectionLogcat"))
                    compact.put("injectionLogcat", report.get("injectionLogcat"));
                text = compact.toString(2);
            }
            clipboard.setPrimaryClip(ClipData.newPlainText("学マス実機診断", text));
            Toast.makeText(this, "診断をコピーしました", Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            Toast.makeText(this, "コピーできませんでした。診断JSONを書き出してください", Toast.LENGTH_LONG).show();
        }
    }

    private void exportReport() {
        if (latestReport == null) {
            display.setText("まだ診断データがありません。");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.setType("application/json");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.putExtra(Intent.EXTRA_TITLE, "gakumas-diagnostic.json");
        startActivityForResult(intent, EXPORT_REQUEST);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != EXPORT_REQUEST || resultCode != RESULT_OK || data == null) return;
        Uri uri = data.getData();
        if (uri == null || latestReport == null) return;
        try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new IllegalStateException("Export stream unavailable");
            out.write(latestReport.getBytes(StandardCharsets.UTF_8));
            display.append("\n\n診断JSONを保存しました。");
        } catch (Exception error) {
            display.append("\n\n保存に失敗: " + error.getMessage());
        }
    }
}
