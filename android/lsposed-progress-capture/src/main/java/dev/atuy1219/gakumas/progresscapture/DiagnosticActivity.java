package dev.atuy1219.gakumas.progresscapture;

import android.app.Activity;
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
        guidance.setText("LSPosedの対象を学マスに設定して再起動してください。"
            + "この画面を開いている間、約2.5秒ごとにログを更新します。"
            + "ゲーム全体の一致は未検証であり、現時点で比較できるのは乱数系列です。");
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

    private static String readRootFile(String basename, boolean required) throws Exception {
        // Only fixed, hardcoded filenames enter the privileged shell.
        if (!"exam_seed_trace.jsonl".equals(basename) && !"produce_cards.json".equals(basename)
            && !"exam_session_status.json".equals(basename)) {
            throw new SecurityException("Unexpected filename");
        }
        Process process = new ProcessBuilder("su", "-c", "cat " + TRACE_DIR + basename)
            .redirectErrorStream(true).start();
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        try (InputStream in = process.getInputStream()) {
            byte[] buffer = new byte[8192];
            int length;
            while ((length = in.read(buffer)) != -1) {
                if (result.size() + length > 64 * 1024 * 1024) {
                    process.destroy();
                    throw new IllegalStateException("Trace exceeds 64 MiB");
                }
                result.write(buffer, 0, length);
            }
        }
        if (process.waitFor() != 0) {
            if (!required) return "";
            throw new IllegalStateException("su/cat failed: " + result.toString("UTF-8"));
        }
        return result.toString("UTF-8");
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

    private static JSONObject makeReport(String trace, String cards, String sessionJson) throws Exception {
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
        environment.put("nativeBuildId",
            traceStart == null ? JSONObject.NULL : traceStart.optString("libil2cppBuildId", ""));
        environment.put("nativeSessionStarted",
            traceStart == null ? JSONObject.NULL : traceStart.optLong("capturedAtUnixMs"));
        environment.put("captureSha256", sha256(trace));
        if (!sessionJson.trim().isEmpty()) {
            try { environment.put("session", new JSONObject(sessionJson)); }
            catch (JSONException error) { warnings.put("invalid-session-status"); }
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
                String trace = readRootFile("exam_seed_trace.jsonl", true);
                String cards = readRootFile("produce_cards.json", false);
                String session = readRootFile("exam_session_status.json", false);
                String digest = sha256(trace + "\0" + cards + "\0" + session);
                if (!digest.equals(lastDigest)) {
                    JSONObject report = makeReport(trace, cards, session);
                    String serialized = report.toString(2);
                    File saved = new File(getFilesDir(), "gakumas-diagnostic-latest.json");
                    try (FileOutputStream out = new FileOutputStream(saved)) {
                        out.write(serialized.getBytes(StandardCharsets.UTF_8));
                    }
                    latestReport = serialized;
                    lastDigest = digest;
                    JSONObject comparison = report.getJSONObject("comparison");
                    StringBuilder message = new StringBuilder();
                    JSONObject sessionStatus = report.getJSONObject("environment").optJSONObject("session");
                    if (sessionStatus != null) {
                        message.append("試験記録: ").append(sessionStatus.optString("phase", "unknown"))
                            .append(" / ").append(sessionStatus.optString("mode", "unknown"))
                            .append(" / ExamType=").append(sessionStatus.optInt("examType", -1)).append("\n");
                    }
                    message.append("診断ステータス: ").append(comparison.getString("status")).append("\n");
                    message.append("RNG比較件数: ").append(comparison.getInt("comparedRandomCalls")).append("\n");
                    message.append("差分件数: ").append(comparison.getJSONArray("differences").length()).append("\n");
                    message.append("実機イベント: ").append(report.getJSONObject("realDevice").getJSONArray("events").length()).append("\n");
                    message.append("ゲームのスコア・効果・手札の完全一致: 未検証\n\n");
                    JSONObject first = comparison.optJSONObject("firstDivergence");
                    if (first != null) message.append("最初の差分:\n").append(first.toString(2)).append("\n\n");
                    message.append("診断JSONはアプリ内へ自動保存されます。\n");
                    message.append("AIへ渡すときは「診断JSONを書き出す」を選択してください。");
                    main.post(() -> display.setText(message));
                }
            } catch (Exception error) {
                main.post(() -> display.setText("取得できません: " + error.getMessage()
                    + "\n\nKernelSUで本モジュールアプリにsu権限を許可し、学マスを起動してください。"));
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
