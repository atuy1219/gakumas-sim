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
        LinearLayout replay=CaptureUi.card(this,root,"リプレイ","");
        CaptureUi.button(this,replay,"取得を開始",this::activateReplay,true);
        CaptureUi.button(this,replay,"状態",this::refreshReplay);
        CaptureUi.button(this,replay,"保存",()->prepareExport(false,false,true));
        CaptureUi.button(this,replay,"前回分",()->prepareExport(true,false,true));

        LinearLayout trace=CaptureUi.card(this,root,"Hook","");
        CaptureUi.button(this,trace,"取得を開始",this::activateTrace,true);
        CaptureUi.button(this,trace,"状態",this::refreshTrace);
        CaptureUi.button(this,trace,"保存",()->prepareTraceExport(false));
        CaptureUi.button(this,trace,"前回分",()->prepareTraceExport(true));

        LinearLayout current=CaptureUi.card(this,root,"状態","");
        CaptureUi.button(this,current,"更新",this::refresh);
        statusView=CaptureUi.secondary(this,"未確認",14);
        statusView.setTextIsSelectable(true);
        current.addView(statusView,new LinearLayout.LayoutParams(-1,-2));
        return (android.view.View)root.getParent();
    }

    private static byte[] readRoot(String filename, int limit) throws Exception {
        if (!filename.equals("native_bootstrap_status.json") && !filename.matches("(?:contest_capture|detail_log_capture|ranking_replay_capture|exam_hook_trace)(?:_status\\.json|(?:\\.previous)?\\.jsonl)"))
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
        if(mask==131072)return "リプレイ";
        if(mask==65536)return "実機Hookトレース";
        if(mask==4224)return "コンテスト";
        if(mask==20608)return "コンテスト＋乱数診断";
        if(mask==128)return "実行開始診断";
        if(mask==256)return "フック動作確認";
        return "その他";
    }

    private void activateTrace() {
        if(busy)return;
        busy=true;
        new Thread(()->{
            try{
                String command=DiagnosticStorage.configure(GAME_FILES,65536,
                    new String[]{"exam_hook_trace.jsonl","exam_hook_trace_status.json"});
                rootCommand(command,65536);
                runOnUiThread(()->statusView.setText(
                    "設定済み。ゲームを再起動"));
            }catch(Exception e){showError(e);}
            finally{runOnUiThread(()->busy=false);}
        }).start();
    }

    private void refreshTrace() {
        if(busy)return;
        busy=true;
        new Thread(()->{
            try{
                JSONObject boot=new JSONObject(new String(
                    readRoot("native_bootstrap_status.json",65536),StandardCharsets.UTF_8));
                if(boot.optInt("effectiveHookMask",-1)!=65536 ||
                   !boot.optBoolean("nativeApiAccepted")) {
                    runOnUiThread(()->statusView.setText(
                        "Native側のモード: "+friendlyMode(boot.optInt("effectiveHookMask",-1))
                        +"\nNative API受付: "+boot.optBoolean("nativeApiAccepted")
                        +"\n実機Hook取得を選択して学マスを完全終了・再起動してください。"));
                    return;
                }
                JSONObject status=new JSONObject(new String(
                    readRoot("exam_hook_trace_status.json",65536),StandardCharsets.UTF_8));
                if(boot.getLong("pid")!=status.getLong("pid"))
                    throw new Exception("Hook記録は以前のPIDのものです。ゲームを再起動してください");
                String shown="実機Hook取得（最新ゲーム版）"
                    +"\n開始Hook: "+status.optBoolean("setupInstalled")
                    +"\n試験開始Hook: "+status.optBoolean("startInstalled")
                    +"\n終了Hook: "+status.optBoolean("disposeInstalled")
                    +"\n乱数Hook: "+status.optBoolean("rngInstalled")
                    +"\n範囲乱数Hook: "+status.optBoolean("rngRangeInstalled")
                    +"\nカード使用Hook: "+status.optBoolean("cardMoveInstalled")
                    +"\nイベント: "+status.optLong("recordsWritten")
                    +"\n上限・書込失敗: "+status.optLong("limitDrops")
                    +"\nモード識別済み: "+status.optBoolean("modeVerified");
                runOnUiThread(()->statusView.setText(shown));
            }catch(Exception e){showError(e);}
            finally{runOnUiThread(()->busy=false);}
        }).start();
    }

    private void prepareTraceExport(boolean previous) {
        if(busy)return;
        busy=true;
        pending=new ExportRequest("exam_hook_trace",previous,false,false);
        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE,previous
            ?"gakumas-exam-hook-trace-previous.json":"gakumas-exam-hook-trace.json");
        try{startActivityForResult(intent,SAVE);}
        catch(Exception e){busy=false;pending=null;showError(e);}
    }

    private void activateReplay() {
        if(busy)return;
        busy=true;
        new Thread(()->{
            try{
                rootCommand(DiagnosticStorage.configure(GAME_FILES,131072,
                    new String[]{"ranking_replay_capture.jsonl","ranking_replay_capture_status.json"}),65536);
                runOnUiThread(()->statusView.setText("設定済み。ゲームを再起動"));
            }catch(Exception e){showError(e);}
            finally{runOnUiThread(()->busy=false);}
        }).start();
    }

    private void refreshReplay() {
        if(busy)return;
        busy=true;
        new Thread(()->{
            try{
                JSONObject boot=new JSONObject(new String(
                    readRoot("native_bootstrap_status.json",65536),StandardCharsets.UTF_8));
                if(boot.optInt("effectiveHookMask",-1)!=131072 ||
                   !boot.optBoolean("nativeApiAccepted")){
                    runOnUiThread(()->statusView.setText("リプレイ取得は無効。ゲームを再起動"));
                    return;
                }
                JSONObject st=new JSONObject(new String(
                    readRoot("ranking_replay_capture_status.json",65536),StandardCharsets.UTF_8));
                if(boot.optLong("pid",-1)!=st.optLong("pid",-2))
                    throw new Exception("古い記録。ゲームを再起動");
                String text="入口: "+st.optBoolean("rankingEntryInstalled")
                    +" / 初期値: "+st.optBoolean("dataInstalled")
                    +"\n操作ログ: "+st.optLong("sessions")
                    +" / イベント: "+st.optLong("recordsWritten")
                    +" / 欠落: "+st.optLong("limitDrops");
                runOnUiThread(()->statusView.setText(text));
            }catch(Exception e){showError(e);}
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
        if(busy)return;
        busy=true;
        new Thread(()->{
            try{
                JSONObject boot=new JSONObject(new String(
                    readRoot("native_bootstrap_status.json",65536),StandardCharsets.UTF_8));
                String summary="PID: "+boot.optInt("pid",-1)
                    +"\nNative: "+boot.optBoolean("nativeApiAccepted")
                    +"\nモード: "+friendlyMode(boot.optInt("effectiveHookMask",-1));
                runOnUiThread(()->statusView.setText(summary));
            }catch(Exception e){showError(e);}
            finally{runOnUiThread(()->busy=false);}
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
            + ",\"scope\":" + JSONObject.quote("exam_hook_trace".equals(request.base) ? "unclassified-exam-hook-trace" :
                  request.replay ? "audition-replay-capture" : request.detail
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
