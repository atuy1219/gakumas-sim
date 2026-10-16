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
public final class CaptureExportActivity extends DiagnosticActivity {
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
        final boolean previous, detail, replay;
        ExportRequest(String base, boolean previous, boolean detail, boolean replay) {
            this.base = base;
            this.previous = previous;
            this.detail = detail;
            this.replay = replay;
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

    @Override protected android.view.View createCapturePage(LinearLayout shell) {
        LinearLayout root=CaptureUi.scrollContent(this,shell);
        CaptureUi.info(this,root,
            "取得モードの変更はゲームの完全終了・再起動後に反映されます。"
            +"最新Build IDでは開始診断のみ対応しています。未対応の詳細フックは動作しません。");

        LinearLayout current=CaptureUi.card(this,root,"記録状況",
            "診断結果とエクスポートのメッセージ");
        CaptureUi.button(this,current,"記録状況を再読込",this::refresh);
        statusView=CaptureUi.secondary(this,
            "取得状況は未確認です。必要な記録を有効にしたあと確認してください。",14);
        statusView.setTextIsSelectable(true);
        LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(-1,-2);
        sp.topMargin=CaptureUi.dp(this,14);
        current.addView(statusView,sp);

        LinearLayout replay=CaptureUi.card(this,root,"オーディション・リプレイ",
            "現在のソースビルドにはランキングリプレイ用のネイティブフックがありません。"
            +"旧版の記録ファイルを読み出すことはできます。");
        CaptureUi.button(this,replay,"リプレイ取得の対応状況",this::activateReplay);
        CaptureUi.button(this,replay,"取得状況を確認",this::refreshReplay);
        CaptureUi.button(this,replay,"現在の記録を保存",()->prepareExport(false,false,true),true);
        CaptureUi.button(this,replay,"前回起動分を保存",()->prepareExport(true,false,true));

        LinearLayout contest=CaptureUi.card(this,root,"コンテスト",
            "対応Build IDで採用経路・操作履歴・スコアを受動記録します。");
        CaptureUi.button(this,contest,"コンテスト取得を有効化",this::activateContest);
        CaptureUi.button(this,contest,"現在の記録を保存",()->prepareExport(false),true);
        CaptureUi.button(this,contest,"前回起動分を保存",()->prepareExport(true));

        LinearLayout detail=CaptureUi.card(this,root,"保存済み詳細ログ",
            "対応Build IDで、ゲーム内に表示した詳細ログを取り込みます。");
        CaptureUi.button(this,detail,"詳細ログ取得を有効化",this::activateDetail);
        CaptureUi.button(this,detail,"取得状況を確認",this::refreshDetail);
        CaptureUi.button(this,detail,"詳細ログを保存",()->prepareExport(false,true),true);
        CaptureUi.button(this,detail,"前回分の詳細ログを保存",()->prepareExport(true,true));
        return (android.view.View)root.getParent();
    }

    private static byte[] readRoot(String filename, int limit) throws Exception {
        if (!filename.equals("native_bootstrap_status.json") && !filename.matches("(?:contest_capture|detail_log_capture|ranking_replay_capture)(?:_status\\.json|(?:\\.previous)?\\.jsonl)"))
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

    private static String friendlyMode(int mask) {
        if(mask==0)return "無効（安全）";
        if(mask==8192)return "保存済み詳細ログ";
        if(mask==32768)return "オーディション・リプレイ";
        if(mask==4224)return "コンテスト";
        if(mask==20608)return "コンテスト＋乱数診断";
        if(mask==128)return "実行開始診断";
        if(mask==256)return "フック動作確認";
        return "その他のモード";
    }

    private void activateReplay() {
        CaptureUi.confirm(this,"このビルドでは未対応",
            "旧v1.6.5のリプレイ取得フックは現在のソースビルドに含まれていません。"
            +"未対応の設定を書き込むとゲーム側で無効扱いになり、記録できません。"
            +"既存のリプレイJSONは引き続き保存できます。",
            "閉じる",()->{});
    }

    private void refreshReplay() {
        if(busy)return;
        busy=true;
        new Thread(()->{
            try {
                JSONObject boot=new JSONObject(new String(
                    readRoot("native_bootstrap_status.json",65536),
                    StandardCharsets.UTF_8));
                int actual=boot.optInt("effectiveHookMask",-1);
                if(actual!=32768||!boot.optBoolean("nativeApiAccepted")) {
                    runOnUiThread(()->statusView.setText(
                        "実行中の取得機能: "+friendlyMode(actual)
                        +"。このソースビルドではリプレイ取得フックは未実装です。設定を変更しても有効になりません。"));
                    return;
                }
                JSONObject st=new JSONObject(new String(
                    readRoot("ranking_replay_capture_status.json",65536),
                    StandardCharsets.UTF_8));
                if(boot.getLong("pid")!=st.getLong("pid"))
                    throw new Exception("取得状況が古い起動分です。学マスを再起動してください");
                String report="オーディション・リプレイ取得"
                    +"\\n保存イベント: "+st.optLong("recordsWritten",st.optLong("events"))
                    +"\\n実行セッション: "+st.optLong("sessions")
                    +"\\n記録上限による欠落: "+st.optLong("limitDrops")
                    +"\\n未対応コールバック: "+st.optLong("unboundCallbacks")
                    +"\\nHook実行状態: "+st.optBoolean("rankingEntryInstalled");
                runOnUiThread(()->statusView.setText(report));
            } catch(Exception e){showError(e);}
            finally{runOnUiThread(()->busy=false);}
        }).start();
    }

    private void activateContest() {
        if(busy)return;
        busy=true;
        new Thread(()->{
            try {
                // The internal mask is a compatibility detail, never a user-facing setting.
                String command=DiagnosticStorage.configure(GAME_FILES,4224,
                    new String[]{"contest_capture.jsonl","contest_capture_status.json"});
                rootCommand(command,65536);
                runOnUiThread(()->statusView.setText(
                    "コンテスト取得を選択しました。学マスを完全終了し、再起動してください。"));
            } catch(Exception e) {showError(e);}
            finally {runOnUiThread(()->busy=false);}
        }).start();
    }

    private void activateDetail() {
        if (busy) return; busy = true;
        new Thread(() -> {
            try {
                String command = DiagnosticStorage.configure(GAME_FILES, 8192,
                    new String[]{"detail_log_capture.jsonl", "detail_log_capture_status.json"});
                rootCommand(command, 65536);
                runOnUiThread(() -> statusView.setText("詳細ログ取得モードを設定しました。\n"
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
                    String message = "学マスが現在読み込んでいるモード: " + friendlyMode(actualMask)
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
        prepareExport(previous,detail,false);
    }

    private void prepareExport(boolean previous,boolean detail,boolean replay) {
        if (busy) return;
        busy = true;
        pending = new ExportRequest(replay ? "ranking_replay_capture"
                             : detail ? "detail_log_capture" : "contest_capture",
                                    previous, detail, replay);
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        String title = replay ? (previous ? "gakumas-ranking-replay-previous.json" : "gakumas-ranking-replay.json")
                       : detail ? (previous ? "gakumas-detail-log-previous.json" : "gakumas-detail-log.json")
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
        writeUtf8(output, "{\"schemaVersion\":" + (request.detail || request.replay ? 1 : 2)
            + ",\"scope\":" + JSONObject.quote(request.replay ? "audition-replay-capture" : request.detail
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
        if(request.replay) {
            try(InputStream input=getAssets().open("replay_action_enums.json");
                ByteArrayOutputStream bytes=new ByteArrayOutputStream()) {
                byte[] buffer=new byte[4096];int n;
                while((n=input.read(buffer))>=0)bytes.write(buffer,0,n);
                JSONObject enums=new JSONObject(
                    new String(bytes.toByteArray(),StandardCharsets.UTF_8));
                writeUtf8(output,",\"enumDefinitions\":"+enums.toString());
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
