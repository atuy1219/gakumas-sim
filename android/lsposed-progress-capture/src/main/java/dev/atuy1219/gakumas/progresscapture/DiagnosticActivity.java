package dev.atuy1219.gakumas.progresscapture;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.content.Intent;
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
import java.io.ByteArrayOutputStream;
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
public final class DiagnosticActivity extends Activity {
    private static final String GAME = "com.bandainamcoent.idolmaster_gakuen";
    private static final String TRACE_DIR = "/data/user/0/" + GAME + "/files/gakumas-sim/";
    private static final int EXPORT_REQUEST = 1201;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1202;
    private static final String NOTIFICATION_CHANNEL = "gakumas-capture-files";
    private static final String[] SOURCE_FILES = {
        "bootstrap_status.json",
        "capture_status.json",
        "exam_session_status.json",
        "exam_lifecycle_status.json",
        "exam_runtime_inventory.json",
        "exam_lifecycle_status.json",
        "produce_cards.json",
        "exam_seed_trace.jsonl"
    };
    // Accessed only on the single-thread worker.
    private final Map<String, SourceFile> sourceCache = new LinkedHashMap<>();
    private final Map<String, String> lastPreflight = new LinkedHashMap<>();
    private final Set<String> previouslyObtained = new LinkedHashSet<>();
    private volatile String lastScreenState = "";

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
    private volatile boolean active;
    private volatile boolean checking;
    private volatile String latestReport = null;
    private volatile String lastDigest = "";
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!active) return;
            checkCapture();
            main.postDelayed(this, POLL_MS);
        }
    };

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(24, 24, 24, 24);
        TextView heading = new TextView(this);
        heading.setText("学マス実機診断");
        heading.setTextSize(22);
        root.addView(heading);

        TextView guidance = new TextView(this);
        guidance.setText("取得したファイルを個別に表示します。未生成はRootエラーではありません。"
            + "画面を開いている間は2.5秒ごとに確認し、新しく取得したファイルだけ通知します。"
            + "ゲーム全体の一致は未検証であり、現在比較できるのは乱数系列です。");
        guidance.setPadding(0, 12, 0, 12);
        root.addView(guidance);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        Button refresh = new Button(this);
        refresh.setText("再読込");
        refresh.setOnClickListener(v -> checkCapture());
        buttons.addView(refresh);
        Button export = new Button(this);
        export.setText("診断JSONを書き出す");
        export.setOnClickListener(v -> exportReport());
        buttons.addView(export);
        root.addView(buttons);

        ScrollView scrolling = new ScrollView(this);
        display = new TextView(this);
        display.setText("ログを確認していません。Rootアクセスが必要です。");
        display.setTextSize(14);
        display.setGravity(Gravity.START);
        scrolling.addView(display);
        root.addView(scrolling, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        setupNotifications();
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

    private static String runRoot(String command) throws Exception {
        Process process = new ProcessBuilder("su", "-c", command)
            .redirectErrorStream(true).start();
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        try (InputStream in = process.getInputStream()) {
            byte[] buffer = new byte[8192];
            int length;
            while ((length = in.read(buffer)) != -1) {
                if (result.size() + length > 64 * 1024 * 1024) {
                    process.destroyForcibly();
                    throw new IllegalStateException("ファイルが64MiBを超えています");
                }
                result.write(buffer, 0, length);
            }
        }
        if (process.waitFor() != 0) {
            throw new IllegalStateException(result.toString("UTF-8").trim());
        }
        return result.toString("UTF-8");
    }

    private Map<String, SourceFile> scanRootFiles() throws Exception {
        // One root shell probes ALL paths. Missing files are not errors.
        // The script contains only fixed, predefined names.
        StringBuilder command = new StringBuilder("id -u; for name in");
        for (String name : SOURCE_FILES) command.append(" ").append(name);
        command.append("; do f='").append(TRACE_DIR).append("'\"$name\"; ");
        command.append("if [ -f \"$f\" ]; then stat -c \"$name|%s|%Y\" \"$f\" ");
        command.append("|| echo \"$name|ERROR\"; else echo \"$name|MISSING\"; fi; done; ");
        command.append("echo '@gamePid|'$(pidof ").append(GAME).append(" 2>/dev/null || echo none); ");
        command.append("if [ -d '/data/user/0/").append(GAME).append("' ]; ");
        command.append("then echo '@targetDataDir|exists'; else echo '@targetDataDir|missing'; fi; ");
        command.append("for d in /data/user/*/").append(GAME).append("; do ");
        command.append("[ -d \"$d\" ] && echo \"@candidateDataDir|$d\"; done");
        String[] lines = runRoot(command.toString()).split("\\r?\\n");
        if (lines.length == 0 || !"0".equals(lines[0].trim())) {
            throw new SecurityException("KernelSUのsu権限が必要です: " +
                (lines.length > 0 ? lines[0] : "no root output"));
        }
        lastPreflight.clear();
        lastPreflight.put("rootUid", lines[0].trim());
        Map<String, SourceFile> files = new LinkedHashMap<>();
        for (String name : SOURCE_FILES) files.put(name, new SourceFile(name));
        for (int i = 1; i < lines.length; i++) {
            String[] parts = lines[i].trim().split("\\|", 3);
            if (parts.length < 2) continue;
            if (parts[0].startsWith("@")) {
                String key = parts[0].substring(1);
                if ("candidateDataDir".equals(key)) {
                    String previous = lastPreflight.get(key);
                    lastPreflight.put(key, previous == null ? parts[1] : previous + "; " + parts[1]);
                } else lastPreflight.put(key, parts[1]);
                continue;
            }
            SourceFile info = files.get(parts[0]);
            if (info == null) continue;
            if ("MISSING".equals(parts[1])) continue;
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

    private static String readRootFile(String basename) throws Exception {
        boolean trusted = false;
        for (String name : SOURCE_FILES) if (name.equals(basename)) trusted = true;
        if (!trusted) throw new SecurityException("Unexpected filename");
        return runRoot("cat " + TRACE_DIR + basename);
    }

    private Map<String, SourceFile> readAvailableFiles() throws Exception {
        Map<String, SourceFile> files = scanRootFiles();
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

    private static JSONObject makeReport(String trace, String cards, String sessionJson, String metadataJson,
        Map<String, SourceFile> sources, Map<String, String> preflight) throws Exception {
        JSONArray events = new JSONArray();
        JSONArray warnings = new JSONArray();
        JSONObject traceStart = null;
        JSONObject lastSnapshot = null;
        for (String line : trace.split("\n")) {
            if (line.trim().isEmpty()) continue;
            try {
                JSONObject event = new JSONObject(line);
                if (!event.has("event")) {
                    warnings.put("invalid-event-schema");
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

        JSONObject cardsPayload = null;
        if (!cards.trim().isEmpty()) {
            try { cardsPayload = new JSONObject(cards); }
            catch (JSONException error) { warnings.put("invalid-produce-cards-json"); }
        }
        if (traceStart == null || !traceStart.optBoolean("hooksInstalled", false)) {
            warnings.put("trace-hooks-not-confirmed");
        }
        warnings.put("full-gameplay-parity-not-available: score/status/choices not captured");
        JSONObject report = new JSONObject();
        report.put("schemaVersion", 1);
        report.put("createdAtUnixMs", System.currentTimeMillis());
        JSONObject environment = new JSONObject();
        environment.put("origin", "android-module");
        String hookResolution = content(sources, "exam_lifecycle_status.json");
        if (!hookResolution.isEmpty()) {
            try { environment.put("hookResolution", new JSONObject(hookResolution)); }
            catch (JSONException error) { warnings.put("invalid-hook-resolution"); }
        }
        environment.put("nativeBuildId",
            traceStart == null ? JSONObject.NULL : traceStart.optString("libil2cppBuildId", ""));
        environment.put("nativeSessionStarted",
            traceStart == null ? JSONObject.NULL : traceStart.optLong("capturedAtUnixMs"));
        environment.put("captureSha256", sha256(trace));
        if (!sessionJson.trim().isEmpty()) {
            try { environment.put("session", new JSONObject(sessionJson)); }
            catch (JSONException error) { warnings.put("invalid-session-status"); }
        }
        if (!metadataJson.trim().isEmpty()) {
            try { environment.put("runtimeMetadataInventory", new JSONObject(metadataJson)); }
            catch (JSONException error) { warnings.put("invalid-runtime-metadata-inventory"); }
        }
        for (String config : new String[]{"bootstrap_status.json", "capture_status.json"}) {
            String text = content(sources, config);
            if (!text.trim().isEmpty()) {
                try { environment.put(config, new JSONObject(text)); }
                catch (JSONException error) { warnings.put("invalid-" + config); }
            }
        }
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
                fileSummary.append("ゲームPID: ").append(lastPreflight.get("gamePid")).append("\n");
                fileSummary.append("user 0のゲームデータ: ").append(lastPreflight.get("targetDataDir"))
                    .append("\n");
                if (lastPreflight.containsKey("candidateDataDir")) {
                    fileSummary.append("検出したユーザー領域: ")
                        .append(lastPreflight.get("candidateDataDir")).append("\n");
                }
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
                        fileSummary.append("未生成  ").append(info.name).append("\n");
                    } else {
                        fileSummary.append("取得失敗  ").append(info.name).append(": ")
                            .append(info.detail).append("\n");
                    }
                }
                previouslyObtained.clear();
                previouslyObtained.addAll(liveFiles);
                if (!acquired.isEmpty()) main.post(() -> notifyNewFiles(acquired));
                if (liveFiles.isEmpty()) {
                    fileSummary.append("\n診断: 全ファイル未生成です。");
                    fileSummary.append("Rootは使用できていますが、LSPosedが学マスに注入された証拠がありません。");
                    fileSummary.append("LSPosedの有効化・スコープ設定と学マスの再起動を確認してください。\n");
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
                    String serialized = report.toString(2);
                    File saved = new File(getFilesDir(), "gakumas-diagnostic-latest.json");
                    try (FileOutputStream out = new FileOutputStream(saved)) {
                        out.write(serialized.getBytes(StandardCharsets.UTF_8));
                    }
                    latestReport = serialized;
                    lastDigest = digest;
                    JSONObject comparison = report.getJSONObject("comparison");
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
                    message.append("\n診断JSONには各ファイルの取得状態も含まれます。");
                    String shown = message.toString();
                    lastScreenState = shown;
                    main.post(() -> display.setText(shown));
                }
            } catch (Exception error) {
                String explanation = "ファイル一覧の検査に失敗しました: " + error.getMessage()
                    + "\nRoot権限、学マス側のフォルダ、SELinux拒否を確認してください。";
                main.post(() -> display.setText(explanation));
            } finally {
                checking = false;
            }
        });
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
