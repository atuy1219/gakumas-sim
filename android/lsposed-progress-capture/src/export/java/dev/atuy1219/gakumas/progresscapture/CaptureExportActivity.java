package dev.atuy1219.gakumas.progresscapture;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.BufferedInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Manual export of actual selected contest data; no background polling. */
public final class CaptureExportActivity extends Activity {
    private static final int SAVE = 14;
    private String moduleVersion() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (Exception ignored) { return "unknown"; }
    }
    private static final String GAME_FILES = "/data/user/0/com.bandainamcoent.idolmaster_gakuen/files";
    private static final String ROOT = "/data/user/0/com.bandainamcoent.idolmaster_gakuen/files/gakumas-sim/";
    private TextView statusView;
    private ExportRequest pending;
    private static final int MAX_EVENT_BYTES = 16 * 1024 * 1024;
    private static final class ExportRequest {
        final String base;
        final boolean previous, detail;
        ExportRequest(String base, boolean previous, boolean detail) {
            this.base = base; this.previous = previous; this.detail = detail;
        }
    }
    private static final class EventReadResult {
        final int count;
        final boolean incompleteTail;
        EventReadResult(int count, boolean incompleteTail) {
            this.count = count; this.incompleteTail = incompleteTail;
        }
    }
    private boolean busy;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int padding = (int)(20 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding, padding, padding);
        statusView = new TextView(this);
        statusView.setText("Gakumas Progress Capture v" + moduleVersion()
            + "\n\n保存済み詳細ログ取得を選び、学マスを再起動してください。\n詳細→詳細ログを開いたあと、この画面で詳細ログを保存できます。");
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true);
        scroll.addView(layout); setContentView(scroll);
        Button activate = new Button(this); activate.setText("詳細ログ取得モードに切り替える");
        activate.setOnClickListener(v -> activateDetail()); layout.addView(activate);
        Button detailStatus = new Button(this); detailStatus.setText("詳細ログの取得状況を確認");
        detailStatus.setOnClickListener(v -> refreshDetail()); layout.addView(detailStatus);
        layout.addView(statusView);
        Button save = new Button(this); save.setText("コンテスト記録を保存");
        save.setOnClickListener(v -> prepareExport(false)); layout.addView(save);
        Button previous = new Button(this); previous.setText("前回起動分の記録を保存");
        previous.setOnClickListener(v -> prepareExport(true)); layout.addView(previous);
        Button detail = new Button(this); detail.setText("保存済み詳細ログを保存");
        detail.setOnClickListener(v -> prepareExport(false, true)); layout.addView(detail);
        Button previousDetail = new Button(this); previousDetail.setText("前回起動分の詳細ログを保存");
        previousDetail.setOnClickListener(v -> prepareExport(true, true)); layout.addView(previousDetail);
        Button refresh = new Button(this); refresh.setText("記録状況を確認");
        refresh.setOnClickListener(v -> refresh()); layout.addView(refresh);
        Button diagnostics = new Button(this); diagnostics.setText("診断画面を開く");
        diagnostics.setOnClickListener(v -> {
            Intent intent = new Intent();
            intent.setClassName(this, "dev.atuy1219.gakumas.progresscapture.DiagnosticActivity");
            startActivity(intent);
        });
        layout.addView(diagnostics);
    }

    private static byte[] readRoot(String filename, int limit) throws Exception {
        if (!filename.equals("native_bootstrap_status.json") && !filename.matches("(?:contest_capture|detail_log_capture)(?:_status\\.json|(?:\\.previous)?\\.jsonl)"))
            throw new IllegalArgumentException("Invalid recording name");
        return rootCommand("cat '" + ROOT + filename + "'", limit);
    }

    private static byte[] rootCommand(String command, int limit) throws Exception {
        Process process = new ProcessBuilder("su", "-M", "-c", command)
                .redirectErrorStream(true).start();
        Thread watchdog = new Thread(() -> {
            try { Thread.sleep(15000); process.destroy(); }
            catch (InterruptedException ignored) {}
        });
        watchdog.setDaemon(true); watchdog.start();
        try (InputStream input = process.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n;
            while ((n = input.read(buffer)) >= 0) {
                if (bytes.size() + n > limit) throw new Exception("記録ファイルが上限を超えています");
                bytes.write(buffer, 0, n);
            }
            if (process.waitFor() != 0) throw new Exception("記録を読み取れません。root権限と学マスの再起動を確認してください");
            return bytes.toByteArray();
        } finally { watchdog.interrupt(); process.destroy(); }
    }

    private void activateDetail() {
        if (busy) return; busy = true;
        new Thread(() -> {
            try {
                String command = DiagnosticStorage.configure(GAME_FILES, 8192,
                    new String[]{"detail_log_capture.jsonl", "detail_log_capture_status.json"});
                rootCommand(command, 65536);
                runOnUiThread(() -> statusView.setText("詳細ログ取得モード（8192）を設定しました。\n"
                    + "学マスを完全終了して再起動し、詳細→詳細ログを開いてください。\n"
                    + "その後、上の取得状況ボタンで実際に有効になったモードを確認できます。"));
            } catch (Exception e) { showError(e); }
            finally { runOnUiThread(() -> busy = false); }
        }).start();
    }

    private void refreshDetail() {
        if (busy) return; busy = true;
        new Thread(() -> {
            try {
                JSONObject boot = new JSONObject(new String(readRoot("native_bootstrap_status.json", 65536), StandardCharsets.UTF_8));
                int actualMask = boot.optInt("effectiveHookMask", -1);
                if (actualMask != 8192 || !boot.optBoolean("nativeApiAccepted")) {
                    String message = "学マスが現在読み込んでいるモード: " + actualMask
                        + "\nNativeモジュール受付: " + boot.optBoolean("nativeApiAccepted")
                        + "\n詳細ログ取得モードに切り替え、学マスを完全終了して再起動してください。";
                    runOnUiThread(() -> statusView.setText(message)); return;
                }
                JSONObject s = new JSONObject(new String(readRoot("detail_log_capture_status.json", 65536), StandardCharsets.UTF_8));
                if (boot.getLong("pid") != s.getLong("pid"))
                    throw new Exception("詳細ログの取得状況は以前の起動分です。診断画面で初期化ログを保存してください。");
                String text = "保存済み詳細ログの取得状況\n現在のモード: " + actualMask + "\n"
                    + "保存データ読込: " + s.optBoolean("loadInstalled")
                    + "\nコンテスト詳細画面: " + s.optBoolean("competitionInstalled")
                    + "\n詳細ログ画面: " + s.optBoolean("overlayInstalled")
                    + "\n取得機会: " + s.optLong("callbacks") + "\n保存件数: " + s.optLong("records")
                    + "\n読み取り不完全: " + s.optLong("incomplete") + "\n書き込み失敗: " + s.optLong("writeFailures")
                    + "\n上限による省略: " + s.optLong("limitDrops");
                runOnUiThread(() -> statusView.setText(text));
            } catch (Exception e) { showError(e); }
            finally { runOnUiThread(() -> busy = false); }
        }).start();
    }

    private void refresh() {
        if (busy) return; busy = true;
        new Thread(() -> {
            try {
                JSONObject s = new JSONObject(new String(readRoot("contest_capture_status.json", 65536), StandardCharsets.UTF_8));
                String text = "Gakumas Progress Capture v" + moduleVersion() + "\n\n"
                    + "記録開始: " + (s.optBoolean("moveNextInstalled") && s.optBoolean("searchResultInstalled") ? "準備済み" : "準備できていません")
                    + "\n対象実行: " + s.optLong("sessions") + "\n保存件数: " + s.optLong("recordsWritten")
                    + "\n読み取り不完全: " + s.optLong("incompleteReads") + "\n書き込み失敗: " + s.optLong("writeFailures")
                    + "\n上限による省略: " + s.optLong("limitDrops")
                    + "\nカード移動フック: " + s.optBoolean("cardMoveInstalled")
                    + "\nカード指令フック: " + s.optBoolean("triggerCommandInstalled")
                    + "\nカード移動観測: " + s.optLong("cardMoveSamples")
                    + "\nカード指令観測: " + s.optLong("effectSamples")
                    + "\nカード指令呼出: " + s.optLong("triggerCommandCalls")
                    + "\nコントローラー読取: " + s.optLong("cardMoveControllerReadable")
                    + "\nコントローラー一致: " + s.optLong("cardMoveControllerMatched")
                    + "\n探索コピー追跡: " + s.optBoolean("lineageHooksInstalled")
                    + "\n採用経路の記録: " + s.optLong("lineageSelectedEvents")
                    + "\n採用結果との照合: " + s.optLong("lineageSelectedSaves")
                    + "\n採用結果の照合失敗: " + s.optLong("lineageMissingSaves")
                    + "\n探索記録の欠落: " + s.optLong("lineageDrops")
                    + "\nカードなし完了（保存省略）: " + s.optLong("emptyCommandCompletionsSuppressed")
                    + "\n再入通知（除外）: " + s.optLong("reentrantCommandCompletionsIgnored")
                    + "\n完了判定の読取失敗: " + s.optLong("commandCompletionGateUnreadable")
                    + "\nパラメータ一致: " + s.optLong("cardMoveParameterMatched")
                    + "\n記録試行: " + s.optLong("cardSnapshotAttempts")
                    + "\n記録用パラメータ一致: " + s.optLong("cardSnapshotParameterMatched")
                    + "\nステータス取得失敗: " + s.optLong("nativeMetricReadFailures")
                    + (s.optBoolean("lineageHooksInstalled") ? "\n採用経路の完了状態を記録します" : "\n探索コピーの追跡が未成立です");
                runOnUiThread(() -> statusView.setText(text));
            } catch (Exception e) { showError(e); }
            finally { runOnUiThread(() -> busy = false); }
        }).start();
    }

    private void prepareExport(boolean previous) { prepareExport(previous, false); }

    private void prepareExport(boolean previous, boolean detail) {
        if (busy) return;
        busy = true;
        pending = new ExportRequest(detail ? "detail_log_capture" : "contest_capture",
                                    previous, detail);
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        String title = detail ? (previous ? "gakumas-detail-log-previous.json" : "gakumas-detail-log.json")
                              : (previous ? "gakumas-contest-previous.json" : "gakumas-contest-capture.json");
        intent.putExtra(Intent.EXTRA_TITLE, title);
        try {
            startActivityForResult(intent, SAVE);
        } catch (Exception e) {
            busy = false;
            pending = null;
            showError(e);
        }
    }

    // Root reads and SAF writes are streamed line-by-line. A large capture is
    // never materialized as JSONArray, String[], or one pending byte array.
    private static String segmentReadCommand(ExportRequest request) {
        String stem = ROOT + request.base + (request.previous ? ".previous" : "");
        // The wildcard deliberately remains unquoted so the shell expands
        // part0001, part0002, ... in lexicographic order.
        return "for f in '" + stem + ".jsonl' " + stem
            + ".part????.jsonl; do if [ -f \"$f\" ]; then cat \"$f\"; fi; done";
    }

    private static EventReadResult streamEvents(ExportRequest request,
                                                 OutputStream output,
                                                 long expectedPid) throws Exception {
        Process process = new ProcessBuilder("su", "-M", "-c",
            segmentReadCommand(request)).start();
        int count = 0;
        long filePid = -1;
        ByteArrayOutputStream line = new ByteArrayOutputStream(32768);
        try (InputStream input = new BufferedInputStream(process.getInputStream(), 32768)) {
            int next;
            while ((next = input.read()) != -1) {
                if (next != '\n') {
                    if (line.size() >= MAX_EVENT_BYTES)
                        throw new Exception("1件の記録が16MiBを超えています。破損や過大なスナップショットを確認してください");
                    line.write(next);
                    continue;
                }
                if (line.size() == 0) continue;
                byte[] record = line.toByteArray();
                line.reset();
                JSONObject parsed = new JSONObject(new String(record, StandardCharsets.UTF_8));
                long pid = parsed.getLong("pid");
                if (filePid == -1) filePid = pid;
                if (pid != filePid || (expectedPid >= 0 && pid != expectedPid))
                    throw new Exception("別の学マス起動のデータが混在しています。記録を取り直してください");
                if (count++ != 0) output.write(',');
                output.write(record);
            }
            if (process.waitFor() != 0)
                throw new Exception("記録を読み取れません。root権限を確認してください");
            return new EventReadResult(count, line.size() > 0);
        } finally {
            process.destroy();
        }
    }

    private static void writeUtf8(OutputStream output, String value) throws Exception {
        output.write(value.getBytes(StandardCharsets.UTF_8));
    }

    private void streamExport(ExportRequest request, OutputStream output) throws Exception {
        JSONObject captureStatus = null;
        long expectedPid = -1;
        if (!request.previous) {
            captureStatus = new JSONObject(new String(
                readRoot(request.base + "_status.json", 65536), StandardCharsets.UTF_8));
            expectedPid = captureStatus.getLong("pid");
        }
        writeUtf8(output, "{\"schemaVersion\":" + (request.detail ? 1 : 2)
            + ",\"scope\":" + JSONObject.quote(request.detail
                 ? "saved-detail-log-capture" : "contest-gameplay-capture")
            + ",\"moduleVersion\":" + JSONObject.quote(moduleVersion())
            + ",\"exportedAtUnixMs\":" + System.currentTimeMillis()
            + ",\"previousProcess\":" + request.previous + ",\"events\":[");
        EventReadResult result = streamEvents(request, output, expectedPid);
        if (result.count == 0)
            throw new Exception("記録がまだありません。取得モードを設定し、学マスを再起動してから試してください");
        writeUtf8(output, "],\"incompleteTailOmitted\":" + result.incompleteTail);
        if (captureStatus != null)
            writeUtf8(output, ",\"captureStatus\":" + captureStatus.toString());
        if (request.detail) {
            try (InputStream input = getAssets().open("detail_log_enums.json");
                 ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096]; int n;
                while ((n = input.read(buffer)) >= 0) bytes.write(buffer, 0, n);
                JSONObject enums = new JSONObject(
                    new String(bytes.toByteArray(), StandardCharsets.UTF_8));
                writeUtf8(output, ",\"enumDefinitions\":" + enums.toString());
            }
        }
        writeUtf8(output, "}");
        output.flush();
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != SAVE) return;
        ExportRequest selected = pending;
        pending = null;
        if (result != RESULT_OK || data == null || data.getData() == null || selected == null) {
            busy = false; return;
        }
        new Thread(() -> {
            try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                if (output == null) throw new Exception("保存先を開けません");
                streamExport(selected, output);
                runOnUiThread(() -> Toast.makeText(this, "記録を保存しました", Toast.LENGTH_LONG).show());
            } catch (Exception e) { showError(e); }
            finally { runOnUiThread(() -> busy = false); }
        }).start();
    }

    private void showError(Exception error) {
        runOnUiThread(() -> Toast.makeText(this, String.valueOf(error.getMessage()), Toast.LENGTH_LONG).show());
    }
}
