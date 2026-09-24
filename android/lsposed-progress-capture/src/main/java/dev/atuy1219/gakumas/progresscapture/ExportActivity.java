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
        title.setText("Gakumas Progress Capture 1.1.5");
        title.setTextSize(22f);
        root.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView guide = new TextView(this);
        guide.setText("ゲームを起動し、LSPosedフックが有効な状態で実行してください。\n"
                + "Androidのapp-data分離を回避するため、ゲームPIDのmount namespace経由で取得します。");
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

    private String logicalInternalDir() {
        return "/data/user/" + userId() + "/" + TARGET + "/files/gakumas-sim";
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

    private static String throughGameRoot(int pid, String logicalPath) {
        return "/proc/" + pid + "/root" + logicalPath;
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
        if (pid <= 0) {
            return new RootResult(0, "module=1.1.5\ngamePids=\nゲームプロセスが見つかりません。");
        }

        final String logicalDir = logicalInternalDir();
        final String dir = throughGameRoot(pid, logicalDir);
        final String bootstrap = dir + "/bootstrap_status.json";
        final String nativeConstructor = dir + "/native_constructor_status.json";
        final String nativeEntry = dir + "/native_entry_status.json";
        final String capture = dir + "/capture_status.json";
        final String exportStatus = dir + "/export_status.json";
        final String snapshot = dir + "/exam_preset.json";
        final String request = dir + "/export_request.txt";
        final String done = dir + "/export_done.txt";
        final String manual = dir + "/manual_export.json";
        final String logicalTarget = "/data/user/" + userId() + "/" + TARGET;
        final String rootedTarget = throughGameRoot(pid, logicalTarget);
        final String rootedFiles = rootedTarget + "/files";

        String command =
                "echo 'module=1.1.5'; "
                + "echo 'gamePid=" + pid + "'; "
                + "echo 'accessMode=/proc/" + pid + "/root'; "
                + "echo '--- bootstrap_status.json ---'; cat " + shellQuote(bootstrap) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- native_constructor_status.json ---'; cat " + shellQuote(nativeConstructor) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- native_entry_status.json ---'; cat " + shellQuote(nativeEntry) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- capture_status.json ---'; cat " + shellQuote(capture) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- export_status.json ---'; cat " + shellQuote(exportStatus) + " 2>/dev/null || echo '(なし)'; "
                + "echo '--- process identity ---'; "
                + "grep -E '^(Name|Uid|Gid|Groups):' /proc/" + pid + "/status 2>/dev/null || true; "
                + "printf 'selinux='; cat /proc/" + pid + "/attr/current 2>/dev/null || true; echo; "
                + "echo '--- target data via game namespace ---'; "
                + "ls -ldZ " + shellQuote(rootedTarget) + " " + shellQuote(rootedFiles) + " "
                + shellQuote(dir) + " 2>&1 || true; "
                + "echo '--- raw host namespace visibility ---'; "
                + "ls -ldZ " + shellQuote(logicalTarget) + " " + shellQuote(logicalTarget + "/files") + " "
                + shellQuote(logicalDir) + " 2>&1 || true; "
                + "echo '--- native maps ---'; "
                + "grep -F 'libgakumas_progress_capture.so' /proc/" + pid + "/maps 2>/dev/null || true; "
                + "echo '--- relevant logcat ---'; "
                + "logcat -d -v time 2>/dev/null | grep -E 'GakumasProgressCapture|VectorModuleManager|native_api|Native module library|native module|libgakumas_progress_capture' | tail -n 180 || true; "
                + "echo '--- files via game namespace ---'; ls -lZ "
                + shellQuote(snapshot) + " "
                + shellQuote(request) + " "
                + shellQuote(done) + " "
                + shellQuote(manual)
                + " 2>&1 || true";
        return runRoot(command);
    }

    private void performExport(String fileName) {
        final int uidUser = userId();
        final String logicalDir = logicalInternalDir();
        final String downloadDir = "/storage/emulated/" + uidUser + "/Download/gakumas-sim";
        final String destination = downloadDir + "/" + fileName;
        final String token = System.currentTimeMillis() + "-" + Process.myPid();

        try {
            final int pid = resolveGamePid();
            if (pid <= 0) {
                throw new IllegalStateException("ゲームプロセスが見つかりません。");
            }

            final String internalDir = throughGameRoot(pid, logicalDir);
            final String request = internalDir + "/export_request.txt";
            final String done = internalDir + "/export_done.txt";
            final String source = internalDir + "/manual_export.json";
            final String exportStatus = internalDir + "/export_status.json";

            postDiagnostics(collectDiagnostics().output);

            // The watcher creates request/done from inside the game process, preserving the
            // target app's ownership and SELinux/MCS label. Only truncate those existing inodes
            // through /proc/<pid>/root; never create app-private files from the launcher namespace.
            RootResult requestResult = runRoot(
                    "test -f " + shellQuote(request)
                    + " && test -f " + shellQuote(done)
                    + " || exit 42; "
                    + ": > " + shellQuote(done)
                    + " && printf %s " + shellQuote(token) + " > " + shellQuote(request)
                    + " && sync");
            if (requestResult.exitCode == 42) {
                throw new IllegalStateException(
                        "ゲーム側のexport watcherがまだ準備できていません。診断欄の"
                        + " export_status.json / native_entry_status.json を確認してください。");
            }
            if (requestResult.exitCode != 0) {
                throw new IllegalStateException(
                        "ゲームmount namespaceへの要求書き込みに失敗しました: " + requestResult.output);
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
                if (!new java.io.File("/proc/" + pid).exists()) {
                    throw new IllegalStateException("待機中にゲームプロセスが終了しました。");
                }
            }
            if (!completion.startsWith(token + "\t")) {
                postDiagnostics(collectDiagnostics().output);
                throw new IllegalStateException(
                        "ゲーム側から応答がありません。診断欄の export_status.json を確認してください。");
            }
            if (!completion.equals(token + "\tok")) {
                postDiagnostics(collectDiagnostics().output);
                throw new IllegalStateException(
                        "ゲーム側は要求を受信しましたが、取得可能なカードが0枚です。"
                        + " 診断欄の deckCount を確認してください。");
            }

            RootResult copyResult = runRoot(
                    "test -f " + shellQuote(source)
                    + " && mkdir -p " + shellQuote(downloadDir)
                    + " && cat " + shellQuote(source) + " > " + shellQuote(destination)
                    + " && chmod 0664 " + shellQuote(destination)
                    + " && sync");
            if (copyResult.exitCode != 0) {
                throw new IllegalStateException(
                        "ゲームnamespaceからDownloadへの保存に失敗しました: " + copyResult.output);
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
