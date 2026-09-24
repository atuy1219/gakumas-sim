package dev.atuy1219.gakumas.progresscapture;

import android.app.Activity;
import android.os.Bundle;
import android.os.Process;
import android.text.InputType;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public final class ExportActivity extends Activity {
    private static final String TARGET = "com.bandainamcoent.idolmaster_gakuen";
    private TextView status;
    private TextView diagnostics;
    private Button exportButton;
    private Button refreshButton;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(this);
        title.setText("Gakumas Progress Capture 1.1.4");
        title.setTextSize(22f);
        root.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView guide = new TextView(this);
        guide.setText("ゲームを起動し、LSPosedフックが有効な状態で実行してください。\n"
                + "要求の検出状況・取得枚数まで下の診断欄に表示します。");
        guide.setPadding(0, pad / 2, 0, pad / 2);
        root.addView(guide);

        EditText fileName = new EditText(this);
        fileName.setSingleLine(true);
        fileName.setInputType(InputType.TYPE_CLASS_TEXT);
        fileName.setHint("ファイル名");
        fileName.setText("gakumas-exam-" + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date()));
        root.addView(fileName, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        exportButton = new Button(this);
        exportButton.setText("現在のデータを取得してエクスポート");
        root.addView(exportButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        refreshButton = new Button(this);
        refreshButton.setText("診断情報を更新");
        root.addView(refreshButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        status = new TextView(this);
        status.setPadding(0, pad / 2, 0, pad / 2);
        status.setText("待機中");
        root.addView(status);

        TextView diagnosticTitle = new TextView(this);
        diagnosticTitle.setText("診断");
        diagnosticTitle.setTextSize(18f);
        root.addView(diagnosticTitle);

        diagnostics = new TextView(this);
        diagnostics.setTextIsSelectable(true);
        diagnostics.setText("読み込み中…");
        root.addView(diagnostics, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        exportButton.setOnClickListener(v -> {
            final String requested = sanitizeFileName(fileName.getText().toString());
            exportButton.setEnabled(false);
            refreshButton.setEnabled(false);
            status.setText("ゲームプロセスへ取得要求を送信中…");
            new Thread(() -> performExport(requested), "GakumasExportUi").start();
        });
        refreshButton.setOnClickListener(v -> refreshDiagnostics());

        setContentView(scroll);
        refreshDiagnostics();
    }

    private String internalDir() {
        final int userId = Process.myUid() / 100000;
        return "/data/user/" + userId + "/" + TARGET + "/files/gakumas-sim";
    }

    private void refreshDiagnostics() {
        refreshButton.setEnabled(false);
        new Thread(() -> {
            String result;
            try {
                result = collectDiagnostics().output;
            } catch (Throwable error) {
                result = "診断取得エラー: " + String.valueOf(error.getMessage());
            }
            final String shown = result;
            runOnUiThread(() -> {
                diagnostics.setText(shown);
                refreshButton.setEnabled(true);
            });
        }, "GakumasDiagnostics").start();
    }

    private RootResult collectDiagnostics() throws Exception {
        final String dir = internalDir();
        final String bootstrap = dir + "/bootstrap_status.json";
        final String nativeConstructor = dir + "/native_constructor_status.json";
        final String nativeEntry = dir + "/native_entry_status.json";
        final String capture = dir + "/capture_status.json";
        final String exportStatus = dir + "/export_status.json";
        final String snapshot = dir + "/exam_preset.json";
        final String request = dir + "/export_request.txt";
        final String done = dir + "/export_done.txt";
        final String manual = dir + "/manual_export.json";
        String command =
                "echo 'module=1.1.4'; "
                + "printf 'gamePids='; pidof " + shellQuote(TARGET) + " 2>/dev/null || true; echo; "
                + "echo '--- bootstrap_status.json ---'; cat " + shellQuote(bootstrap) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- native_constructor_status.json ---'; cat " + shellQuote(nativeConstructor) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- native_entry_status.json ---'; cat " + shellQuote(nativeEntry) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- capture_status.json ---'; cat " + shellQuote(capture) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- export_status.json ---'; cat " + shellQuote(exportStatus) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- process identity ---'; for p in $(pidof " + shellQuote(TARGET) + " 2>/dev/null); do "
                + "echo pid=$p; grep -E '^(Name|Uid|Gid|Groups):' /proc/$p/status 2>/dev/null || true; "
                + "printf 'selinux='; cat /proc/$p/attr/current 2>/dev/null || true; echo; done; "
                + "echo '--- target data dirs ---'; "
                + "ls -ldZ /data/user/0/" + TARGET + " /data/user/0/" + TARGET + "/files "
                + shellQuote(dir) + " 2>&1 || true; "
                + "echo '--- native maps ---'; for p in $(pidof " + shellQuote(TARGET) + " 2>/dev/null); do "
                + "grep -F 'libgakumas_progress_capture.so' /proc/$p/maps 2>/dev/null || true; done; "
                + "echo '--- relevant logcat ---'; "
                + "logcat -d -v time 2>/dev/null | grep -E 'GakumasProgressCapture|VectorModuleManager|native_api|Native module library|native module|libgakumas_progress_capture' | tail -n 180 || true; "
                + "echo '--- files ---'; ls -lZ "
                + shellQuote(snapshot) + " "
                + shellQuote(request) + " "
                + shellQuote(done) + " "
                + shellQuote(manual)
                + " 2>&1 || true";
        return runRoot(command);
    }

    private void performExport(String fileName) {
        final int userId = Process.myUid() / 100000;
        final String internalDir = internalDir();
        final String request = internalDir + "/export_request.txt";
        final String done = internalDir + "/export_done.txt";
        final String source = internalDir + "/manual_export.json";
        final String exportStatus = internalDir + "/export_status.json";
        final String downloadDir = "/storage/emulated/" + userId + "/Download/gakumas-sim";
        final String destination = downloadDir + "/" + fileName;
        final String token = System.currentTimeMillis() + "-" + Process.myPid();

        try {
            postDiagnostics(collectDiagnostics().output);
            RootResult requestResult = runRoot(
                    "mkdir -p " + shellQuote(internalDir)
                    + " && owner=\"$(stat -c '%u:%g' " + shellQuote(internalDir) + " 2>/dev/null || true)\""
                    + " && rm -f " + shellQuote(done)
                    + " && printf %s " + shellQuote(token) + " > " + shellQuote(request)
                    + " && if [ -n \"$owner\" ]; then chown \"$owner\" " + shellQuote(request) + "; fi"
                    + " && chmod 0600 " + shellQuote(request)
                    + " && (restorecon -F " + shellQuote(request) + " >/dev/null 2>&1 || true)");
            if (requestResult.exitCode != 0) {
                throw new IllegalStateException("root要求の作成に失敗しました: " + requestResult.output);
            }

            postStatus("要求ファイルを作成しました。ゲーム側の検出を待っています…");
            String completion = "";
            for (int i = 0; i < 60; i++) {
                Thread.sleep(250L);
                RootResult result = runRoot("cat " + shellQuote(done) + " 2>/dev/null || true");
                completion = result.output.trim();
                if (completion.startsWith(token + "\t")) break;
                if (i % 4 == 3) {
                    RootResult live = runRoot(
                            "echo '--- export_status.json ---'; cat " + shellQuote(exportStatus)
                            + " 2>/dev/null || echo '(なし)'; echo '--- request ---'; "
                            + "ls -lZ " + shellQuote(request) + " 2>&1 || true");
                    postDiagnostics(live.output);
                }
            }
            if (!completion.startsWith(token + "\t")) {
                postDiagnostics(collectDiagnostics().output);
                throw new IllegalStateException(
                        "ゲーム側から応答がありません。診断欄の export_status.json を確認してください。"
                        + " watcher-started まで出ていれば要求ファイルの権限/SELinux、"
                        + " export_status.json 自体が無ければnative初期化を疑えます。");
            }
            if (!completion.equals(token + "\tok")) {
                postDiagnostics(collectDiagnostics().output);
                throw new IllegalStateException(
                        "ゲーム側は要求を受信しましたが、取得可能なカードが0枚です。"
                        + " 診断欄の deckCount を確認してください。");
            }

            RootResult copyResult = runRoot(
                    "mkdir -p " + shellQuote(downloadDir)
                    + " && cat " + shellQuote(source) + " > " + shellQuote(destination)
                    + " && chmod 0664 " + shellQuote(destination)
                    + " && sync");
            if (copyResult.exitCode != 0) {
                throw new IllegalStateException("Downloadへの保存に失敗しました: " + copyResult.output);
            }
            postDiagnostics(collectDiagnostics().output);
            postStatus("保存しました\n" + destination);
        } catch (Throwable error) {
            postStatus("エラー: " + String.valueOf(error.getMessage()));
        } finally {
            runOnUiThread(() -> {
                exportButton.setEnabled(true);
                refreshButton.setEnabled(true);
            });
        }
    }

    private void postStatus(String message) {
        runOnUiThread(() -> status.setText(message));
    }

    private void postDiagnostics(String message) {
        runOnUiThread(() -> diagnostics.setText(message));
    }

    private static String sanitizeFileName(String input) {
        String value = input == null ? "" : input.trim();
        value = value.replaceAll("[\\\\/:*?\"<>|\\r\\n]+", "_");
        if (value.isEmpty()) value = "gakumas-exam";
        if (!value.toLowerCase(Locale.ROOT).endsWith(".json")) value += ".json";
        return value;
    }

    private static String shellQuote(String value) {
        return "'" + value.replace("'", "'\\''") + "'";
    }

    private static RootResult runRoot(String command) throws Exception {
        java.lang.Process process = new ProcessBuilder("su", "-c", command)
                .redirectErrorStream(true)
                .start();
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (output.length() > 0) output.append('\n');
                output.append(line);
            }
        }
        int exit = process.waitFor();
        return new RootResult(exit, output.toString());
    }

    private static final class RootResult {
        final int exitCode;
        final String output;
        RootResult(int exitCode, String output) {
            this.exitCode = exitCode;
            this.output = output;
        }
    }
}
