package dev.atuy1219.gakumas.progresscapture;

import android.app.Activity;
import android.os.Bundle;
import android.os.Process;
import android.text.InputType;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public final class ExportActivity extends Activity {
    private static final String TARGET = "com.bandainamcoent.idolmaster_gakuen";
    private TextView status;
    private Button exportButton;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("Gakumas Progress Capture");
        title.setTextSize(22f);
        root.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView guide = new TextView(this);
        guide.setText("ゲームを起動し、LSPosedフックが有効な状態で実行してください。\n"
                + "現在の最新既知データを取得し、/storage/emulated/0/Download/gakumas-sim/ に保存します。");
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

        status = new TextView(this);
        status.setPadding(0, pad / 2, 0, 0);
        status.setText("待機中");
        root.addView(status);

        exportButton.setOnClickListener(v -> {
            final String requested = sanitizeFileName(fileName.getText().toString());
            exportButton.setEnabled(false);
            status.setText("ゲームプロセスへ取得要求を送信中…");
            new Thread(() -> performExport(requested), "GakumasExportUi").start();
        });

        setContentView(root);
    }

    private void performExport(String fileName) {
        final int userId = Process.myUid() / 100000;
        final String internalDir = "/data/user/" + userId + "/" + TARGET + "/files/gakumas-sim";
        final String request = internalDir + "/export_request.txt";
        final String done = internalDir + "/export_done.txt";
        final String source = internalDir + "/manual_export.json";
        final String downloadDir = "/storage/emulated/" + userId + "/Download/gakumas-sim";
        final String destination = downloadDir + "/" + fileName;
        final String token = System.currentTimeMillis() + "-" + Process.myPid();

        try {
            RootResult requestResult = runRoot(
                    "mkdir -p " + shellQuote(internalDir)
                    + " && rm -f " + shellQuote(done)
                    + " && printf %s " + shellQuote(token) + " > " + shellQuote(request));
            if (requestResult.exitCode != 0) {
                throw new IllegalStateException("root要求の作成に失敗しました: " + requestResult.output);
            }

            String completion = "";
            for (int i = 0; i < 40; i++) {
                Thread.sleep(250L);
                RootResult result = runRoot("cat " + shellQuote(done) + " 2>/dev/null || true");
                completion = result.output.trim();
                if (completion.startsWith(token + "\t")) break;
            }
            if (!completion.startsWith(token + "\t")) {
                throw new IllegalStateException("ゲーム側から応答がありません。ゲーム起動・LSPosed有効化を確認してください。");
            }
            if (!completion.equals(token + "\tok")) {
                throw new IllegalStateException("取得可能なカードデータがまだありません。プロデュースを開いてから再実行してください。");
            }

            RootResult copyResult = runRoot(
                    "mkdir -p " + shellQuote(downloadDir)
                    + " && cat " + shellQuote(source) + " > " + shellQuote(destination)
                    + " && chmod 0664 " + shellQuote(destination)
                    + " && sync");
            if (copyResult.exitCode != 0) {
                throw new IllegalStateException("Downloadへの保存に失敗しました: " + copyResult.output);
            }
            postStatus("保存しました\n" + destination);
        } catch (Throwable error) {
            postStatus("エラー: " + String.valueOf(error.getMessage()));
        }
    }

    private void postStatus(String message) {
        runOnUiThread(() -> {
            status.setText(message);
            exportButton.setEnabled(true);
        });
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
