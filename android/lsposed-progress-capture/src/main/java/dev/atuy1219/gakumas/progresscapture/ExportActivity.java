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
        title.setText("Gakumas Progress Capture 1.1.7");
        title.setTextSize(22f);
        root.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView guide = new TextView(this);
        guide.setText("ゲームを起動し、LSPosedフックが有効な状態で実行してください。\n"
                + "制御・取得ファイルは学マスのAndroid/data配下を使用します。");
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

    private int userId() {
        return Process.myUid() / 100000;
    }

    private String externalLogicalDir() {
        return "/storage/emulated/" + userId() + "/Android/data/" + TARGET + "/files/gakumas-sim";
    }

    private String externalPhysicalDir() {
        return "/data/media/" + userId() + "/Android/data/" + TARGET + "/files/gakumas-sim";
    }

    private int resolveGamePid() throws Exception {
        RootResult result = runRoot("pidof " + shellQuote(TARGET) + " 2>/dev/null || true");
        String value = result.output.trim();
        if (value.isEmpty()) return -1;
        String first = value.split("\\s+")[0];
        try {
            return Integer.parseInt(first);
        } catch (NumberFormatException ignored) {
            return -1;
        }
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
        final int pid = resolveGamePid();
        final String logicalDir = externalLogicalDir();
        final String physicalDir = externalPhysicalDir();
        final String bootstrap = physicalDir + "/bootstrap_status.json";
        final String nativeConstructor = physicalDir + "/native_constructor_status.json";
        final String nativeEntry = physicalDir + "/native_entry_status.json";
        final String capture = physicalDir + "/capture_status.json";
        final String exportStatus = physicalDir + "/export_status.json";
        final String snapshot = physicalDir + "/exam_preset.json";
        final String request = physicalDir + "/export_request.txt";
        final String done = physicalDir + "/export_done.txt";
        final String manual = physicalDir + "/manual_export.json";
        final String internal = "/data/user/" + userId() + "/" + TARGET;

        String command =
                "echo 'module=1.1.7'; "
                + "echo 'gamePid=" + pid + "'; "
                + "echo 'controlLogical=" + logicalDir + "'; "
                + "echo 'controlPhysical=" + physicalDir + "'; "
                + "echo '--- external dirs ---'; "
                + "ls -ldZ " + shellQuote(logicalDir) + " " + shellQuote(physicalDir) + " 2>&1 || true; "
                + "echo '--- bootstrap_status.json ---'; cat " + shellQuote(bootstrap) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- native_constructor_status.json ---'; cat " + shellQuote(nativeConstructor) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- native_entry_status.json ---'; cat " + shellQuote(nativeEntry) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- capture_status.json ---'; cat " + shellQuote(capture) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- export_status.json ---'; cat " + shellQuote(exportStatus) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- process identity ---'; "
                + (pid > 0
                    ? "grep -E '^(Name|Uid|Gid|Groups):' /proc/" + pid + "/status 2>/dev/null || true; "
                      + "printf 'selinux='; cat /proc/" + pid + "/attr/current 2>/dev/null || true; echo; "
                    : "echo '(game process not found)'; ")
                + "echo '--- private-data visibility (diagnostic only) ---'; "
                + "ls -ldZ " + shellQuote(internal) + " " + shellQuote(internal + "/files") + " 2>&1 || true; "
                + "echo '--- native maps ---'; "
                + (pid > 0
                    ? "grep -F 'libgakumas_progress_capture.so' /proc/" + pid + "/maps 2>/dev/null || true; "
                    : "true; ")
                + "echo '--- relevant logcat ---'; "
                + "logcat -d -v time 2>/dev/null | grep -E 'GakumasProgressCapture|VectorModuleManager|native_api|Native module library|native module|libgakumas_progress_capture' | tail -n 180 || true; "
                + "echo '--- control files ---'; ls -lZ "
                + shellQuote(snapshot) + " "
                + shellQuote(request) + " "
                + shellQuote(done) + " "
                + shellQuote(manual)
                + " 2>&1 || true";
        return runRoot(command);
    }

    private void performExport(String fileName) {
        final int uidUser = userId();
        final String controlDir = externalPhysicalDir();
        final String request = controlDir + "/export_request.txt";
        final String done = controlDir + "/export_done.txt";
        final String source = controlDir + "/manual_export.json";
        final String exportStatus = controlDir + "/export_status.json";
        final String downloadPhysicalDir = "/data/media/" + uidUser + "/Download/gakumas-sim";
        final String destinationPhysical = downloadPhysicalDir + "/" + fileName;
        final String destinationLogical = "/storage/emulated/" + uidUser + "/Download/gakumas-sim/" + fileName;
        final String token = System.currentTimeMillis() + "-" + Process.myPid();

        try {
            final int pid = resolveGamePid();
            if (pid <= 0) {
                throw new IllegalStateException("ゲームプロセスが見つかりません。");
            }

            postDiagnostics(collectDiagnostics().output);

            // The game creates these files through its own /storage/emulated/.../Android/data
            // path. Root accesses the same underlying inodes via /data/media, avoiding the
            // per-app CE-data and FUSE mount namespaces.
            RootResult requestResult = runRoot(
                    "test -f " + shellQuote(request)
                    + " && test -f " + shellQuote(done)
                    + " || exit 42; "
                    + ": > " + shellQuote(done)
                    + " && printf %s " + shellQuote(token) + " > " + shellQuote(request)
                    + " && sync");
            if (requestResult.exitCode == 42) {
                throw new IllegalStateException(
                        "ゲーム側のexport watcherがまだ準備できていません。"
                        + "Android/data配下の export_status.json / native_entry_status.json を確認してください。");
            }
            if (requestResult.exitCode != 0) {
                throw new IllegalStateException(
                        "Android/data制御ファイルへの要求書き込みに失敗しました: " + requestResult.output);
            }

            postStatus("要求を送信しました。ゲーム側の応答を待っています…");
            String completion = "";
            for (int i = 0; i < 60; i++) {
                Thread.sleep(250L);
                RootResult result = runRoot("cat " + shellQuote(done) + " 2>/dev/null || true");
                completion = result.output.trim();
                if (completion.startsWith(token + "\t")) break;
                if (i % 4 == 3) {
                    RootResult live = runRoot(
                            "echo '--- export_status.json ---'; cat " + shellQuote(exportStatus)
                            + " 2>/dev/null || echo '(なし)'; "
                            + "echo '--- handshake files ---'; ls -lZ "
                            + shellQuote(request) + " " + shellQuote(done) + " 2>&1 || true");
                    postDiagnostics(live.output);
                }
                RootResult alive = runRoot("kill -0 " + pid + " 2>/dev/null");
                if (alive.exitCode != 0) {
                    throw new IllegalStateException("待機中にゲームプロセスが終了しました。");
                }
            }
            if (!completion.startsWith(token + "\t")) {
                postDiagnostics(collectDiagnostics().output);
                throw new IllegalStateException(
                        "ゲーム側から応答がありません。Android/data側の export_status.json を確認してください。");
            }
            if (!completion.equals(token + "\tok")) {
                postDiagnostics(collectDiagnostics().output);
                throw new IllegalStateException(
                        "ゲーム側は要求を受信しましたが、取得可能なカードが0枚です。"
                        + " 診断欄の deckCount を確認してください。");
            }

            RootResult copyResult = runRoot(
                    "test -f " + shellQuote(source)
                    + " && mkdir -p " + shellQuote(downloadPhysicalDir)
                    + " && cat " + shellQuote(source) + " > " + shellQuote(destinationPhysical)
                    + " && chmod 0664 " + shellQuote(destinationPhysical)
                    + " && sync");
            if (copyResult.exitCode != 0) {
                throw new IllegalStateException(
                        "Android/dataからDownloadへの保存に失敗しました: " + copyResult.output);
            }
            postDiagnostics(collectDiagnostics().output);
            postStatus("保存しました\n" + destinationLogical);
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
