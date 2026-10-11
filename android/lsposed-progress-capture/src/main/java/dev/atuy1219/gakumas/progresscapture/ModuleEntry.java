package dev.atuy1219.gakumas.progresscapture;

import android.os.Process;
import android.util.Log;
import io.github.libxposed.api.XposedModule;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public final class ModuleEntry extends XposedModule {
    private static final String TARGET = "com.bandainamcoent.idolmaster_gakuen";
    private static final String TAG = "GakumasCapture";
    private static volatile boolean nativeLoaded;
    private static volatile boolean nativeLoadScheduled;
    private static String processName = "";
    private static String nativeBootstrap = "";
    private static native String nativeGetBootstrap();

    public ModuleEntry() {
        super();
    }

    private static String escape(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    private static void writeBootstrapStatus(String phase, Throwable error) {
        try {
            int userId = Process.myUid() / 100000;
            File dir = new File("/data/user/" + userId + "/" + TARGET + "/files/gakumas-sim");
            if (!dir.exists()) dir.mkdirs();
            File out = new File(dir, "bootstrap_status.json");
            String errorClass = error == null ? "" : error.getClass().getName();
            String errorMessage = error == null ? "" : String.valueOf(error.getMessage());
            String json =
                    "{\n"
                    + "  \"phase\": \"" + escape(phase) + "\",\n"
                    + "  \"uid\": " + Process.myUid() + ",\n"
                    + "  \"pid\": " + Process.myPid() + ",\n"
                    + "  \"process\": \"" + escape(processName) + "\",\n"
                    + "  \"nativeBootstrap\": " + (nativeBootstrap.isEmpty() ? "null" : nativeBootstrap) + ",\n"
                    + "  \"errorClass\": \"" + escape(errorClass) + "\",\n"
                    + "  \"errorMessage\": \"" + escape(errorMessage) + "\"\n"
                    + "}\n";
            try (FileOutputStream stream = new FileOutputStream(out, false)) {
                stream.write(json.getBytes(StandardCharsets.UTF_8));
                stream.flush();
            }
        } catch (Throwable writeError) {
            Log.e(TAG, "Unable to write bootstrap_status.json phase=" + phase, writeError);
        }
    }

    private static void loadNative() {
        if (nativeLoaded || nativeLoadScheduled) return;
        synchronized (ModuleEntry.class) {
            if (nativeLoaded || nativeLoadScheduled) return;
            nativeLoadScheduled = true;
        }

        writeBootstrapStatus("native-load-scheduled", null);
        Thread loader = new Thread(() -> {
            try {
                System.loadLibrary("gakumas_progress_capture");
                nativeLoaded = true;
                nativeBootstrap = new JSONObject(nativeGetBootstrap()).toString();
                Log.i(TAG, "native-library-loaded pid=" + Process.myPid() + " " + nativeBootstrap);
                writeBootstrapStatus("native-library-loaded", null);
            } catch (Throwable error) {
                Log.e(TAG, "native-load-failed", error);
                writeBootstrapStatus("native-load-failed", error);
            }
        }, "GakumasProgressCaptureLoader");
        loader.setDaemon(true);
        loader.start();
    }

    @Override
    public void onModuleLoaded(ModuleLoadedParam param) {
        processName = param.getProcessName();
        if (!TARGET.equals(processName)) return;
        Log.i(TAG, "LSPosed ModuleEntry loaded; process=" + processName
            + " pid=" + Process.myPid() + " processUid=" + Process.myUid());
        writeBootstrapStatus("module-loaded", null);
        // Package callbacks happen after module loading/entrypoint registration.
        // Avoid a guessed one-second delay on framework revisions that used
        // to register native_init.list after onModuleLoaded returned.
        writeBootstrapStatus("waiting-for-target-package", null);
    }

    @Override
    public void onPackageLoaded(PackageLoadedParam param) {
        if (!TARGET.equals(processName) || !TARGET.equals(param.getPackageName())
                || !param.isFirstPackage()) return;
        Log.i(TAG, "target-package-loaded pid=" + Process.myPid());
        loadNative();
    }
}
