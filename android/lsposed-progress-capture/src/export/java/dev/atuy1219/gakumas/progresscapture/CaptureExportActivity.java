package dev.atuy1219.gakumas.progresscapture;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
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
    private static final String ROOT = "/data/user/0/com.bandainamcoent.idolmaster_gakuen/files/gakumas-sim/";
    private TextView statusView;
    private byte[] pending;
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
        layout.addView(statusView);
        Button save = new Button(this); save.setText("コンテスト記録を保存");
        save.setOnClickListener(v -> prepareExport(false)); layout.addView(save);
        Button previous = new Button(this); previous.setText("前回起動分の記録を保存");
        previous.setOnClickListener(v -> prepareExport(true)); layout.addView(previous);
        Button detail = new Button(this); detail.setText("保存済み詳細ログを保存");
        detail.setOnClickListener(v -> prepareExport(false, true)); layout.addView(detail);
        Button previousDetail = new Button(this); previousDetail.setText("前回起動分の詳細ログを保存");
        previousDetail.setOnClickListener(v -> prepareExport(true, true)); layout.addView(previousDetail);
        Button detailStatus = new Button(this); detailStatus.setText("詳細ログの取得状況を確認");
        detailStatus.setOnClickListener(v -> refreshDetail()); layout.addView(detailStatus);
        Button refresh = new Button(this); refresh.setText("記録状況を確認");
        refresh.setOnClickListener(v -> refresh()); layout.addView(refresh);
        Button diagnostics = new Button(this); diagnostics.setText("診断画面を開く");
        diagnostics.setOnClickListener(v -> {
            Intent intent = new Intent();
            intent.setClassName(this, "dev.atuy1219.gakumas.progresscapture.DiagnosticActivity");
            startActivity(intent);
        });
        layout.addView(diagnostics); setContentView(layout);
    }

    private static byte[] readRoot(String filename, int limit) throws Exception {
        if (!filename.matches("(?:contest_capture|detail_log_capture)(?:_status\\.json|(?:\\.previous)?\\.jsonl)"))
            throw new IllegalArgumentException("Invalid recording name");
        Process process = new ProcessBuilder("su", "-M", "-c", "cat '" + ROOT + filename + "'")
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

    private void refreshDetail() {
        if (busy) return; busy = true;
        new Thread(() -> {
            try {
                JSONObject s = new JSONObject(new String(readRoot("detail_log_capture_status.json", 65536), StandardCharsets.UTF_8));
                String text = "保存済み詳細ログの取得状況\n"
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
        if (busy) return; busy = true;
        new Thread(() -> {
            try {
                String base = detail ? "detail_log_capture" : "contest_capture";
                String name = base + (previous ? ".previous.jsonl" : ".jsonl");
                String raw = new String(readRoot(name, 32 * 1024 * 1024), StandardCharsets.UTF_8);
                JSONArray events = new JSONArray();
                boolean incompleteTail = !raw.endsWith("\n");
                String[] lines = raw.split("\n", -1);
                int completeLines = lines.length - 1;
                for (int i = 0; i < completeLines; i++) if (!lines[i].trim().isEmpty()) events.put(new JSONObject(lines[i]));
                if (events.length() == 0) throw new Exception(detail ? "詳細ログの記録がまだありません。取得モードを設定して学マスを再起動し、詳細ログを開いてください" : "記録がまだありません。コンテストを実行してから保存してください");
                JSONObject export = new JSONObject();
                export.put("schemaVersion", detail ? 1 : 2); export.put("scope", detail ? "saved-detail-log-capture" : "contest-gameplay-capture");
                export.put("moduleVersion", moduleVersion()); export.put("exportedAtUnixMs", System.currentTimeMillis());
                export.put("previousProcess", previous); export.put("events", events);
                export.put("incompleteTailOmitted", incompleteTail);
                if (!previous) {
                    JSONObject captureStatus = new JSONObject(new String(readRoot(base + "_status.json", 65536), StandardCharsets.UTF_8));
                    if (captureStatus.getLong("pid") != events.getJSONObject(0).getLong("pid"))
                        throw new Exception("学マスの起動が変わりました。もう一度保存してください");
                    export.put("captureStatus", captureStatus);
                }
                if (detail) {
                    try (InputStream input = getAssets().open("detail_log_enums.json");
                         ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                        byte[] buffer = new byte[4096]; int n;
                        while ((n = input.read(buffer)) >= 0) bytes.write(buffer, 0, n);
                        export.put("enumDefinitions", new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8)));
                    }
                }
                pending = export.toString().getBytes(StandardCharsets.UTF_8);
                runOnUiThread(() -> {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("application/json");
                    intent.putExtra(Intent.EXTRA_TITLE, detail ? (previous ? "gakumas-detail-log-previous.json" : "gakumas-detail-log.json") : (previous ? "gakumas-contest-previous.json" : "gakumas-contest-capture.json"));
                    startActivityForResult(intent, SAVE);
                });
            } catch (Exception e) { showError(e); runOnUiThread(() -> busy = false); }
        }).start();
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != SAVE) return;
        busy = false;
        byte[] payload = pending; pending = null;
        if (result != RESULT_OK || data == null || data.getData() == null || payload == null) return;
        new Thread(() -> {
            try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                if (output == null) throw new Exception("保存先を開けません");
                output.write(payload);
                runOnUiThread(() -> Toast.makeText(this, "コンテスト記録を保存しました", Toast.LENGTH_LONG).show());
            } catch (Exception e) { showError(e); }
        }).start();
    }

    private void showError(Exception error) {
        runOnUiThread(() -> Toast.makeText(this, String.valueOf(error.getMessage()), Toast.LENGTH_LONG).show());
    }
}
