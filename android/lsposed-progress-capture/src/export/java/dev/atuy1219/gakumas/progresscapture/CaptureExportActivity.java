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
            + "\n\nコンテストの自動計算で選ばれた経過と結果を記録します。\nプレイ後に記録ファイルを保存してください。");
        layout.addView(statusView);
        Button save = new Button(this); save.setText("コンテスト記録を保存");
        save.setOnClickListener(v -> prepareExport(false)); layout.addView(save);
        Button previous = new Button(this); previous.setText("前回起動分の記録を保存");
        previous.setOnClickListener(v -> prepareExport(true)); layout.addView(previous);
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
        if (!filename.matches("contest_capture(?:_status\\.json|(?:\\.previous)?\\.jsonl)"))
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
                    + "\nパラメータ一致: " + s.optLong("cardMoveParameterMatched")
                    + "\n記録試行: " + s.optLong("cardSnapshotAttempts")
                    + "\n記録用パラメータ一致: " + s.optLong("cardSnapshotParameterMatched")
                    + "\nステータス取得失敗: " + s.optLong("nativeMetricReadFailures")
                    + "\n注意: 指令生成時の状態であり、全効果完了を保証しません";
                runOnUiThread(() -> statusView.setText(text));
            } catch (Exception e) { showError(e); }
            finally { runOnUiThread(() -> busy = false); }
        }).start();
    }

    private void prepareExport(boolean previous) {
        if (busy) return; busy = true;
        new Thread(() -> {
            try {
                String name = previous ? "contest_capture.previous.jsonl" : "contest_capture.jsonl";
                String raw = new String(readRoot(name, 8 * 1024 * 1024), StandardCharsets.UTF_8);
                JSONArray events = new JSONArray();
                boolean incompleteTail = !raw.endsWith("\n");
                String[] lines = raw.split("\n", -1);
                int completeLines = lines.length - 1;
                for (int i = 0; i < completeLines; i++) if (!lines[i].trim().isEmpty()) events.put(new JSONObject(lines[i]));
                if (events.length() == 0) throw new Exception("記録がまだありません。コンテストを実行してから保存してください");
                JSONObject export = new JSONObject();
                export.put("schemaVersion", 2); export.put("scope", "contest-gameplay-capture");
                export.put("moduleVersion", moduleVersion()); export.put("exportedAtUnixMs", System.currentTimeMillis());
                export.put("previousProcess", previous); export.put("events", events);
                export.put("incompleteTailOmitted", incompleteTail);
                if (!previous) {
                    JSONObject captureStatus = new JSONObject(new String(readRoot("contest_capture_status.json", 65536), StandardCharsets.UTF_8));
                    if (captureStatus.getLong("pid") != events.getJSONObject(0).getLong("pid"))
                        throw new Exception("学マスの起動が変わりました。もう一度保存してください");
                    export.put("captureStatus", captureStatus);
                }
                pending = export.toString(2).getBytes(StandardCharsets.UTF_8);
                runOnUiThread(() -> {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("application/json");
                    intent.putExtra(Intent.EXTRA_TITLE, previous ? "gakumas-contest-previous.json" : "gakumas-contest-capture.json");
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
