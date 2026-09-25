package dev.atuy1219.gakumas.progresscapture;

import android.os.Process;
import io.github.libxposed.api.XposedModule;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

public final class ModuleEntry extends XposedModule {
    private static final String TARGET = "com.bandainamcoent.idolmaster_gakuen";
    private static volatile boolean nativeLoaded;
    private static volatile boolean nativeLoadScheduled;

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
                    + "  \"errorClass\": \"" + escape(errorClass) + "\",\n"
                    + "  \"errorMessage\": \"" + escape(errorMessage) + "\"\n"
                    + "}\n";
            try (FileOutputStream stream = new FileOutputStream(out, false)) {
                stream.write(json.getBytes(StandardCharsets.UTF_8));
                stream.flush();
            }
        } catch (Throwable ignored) {
        }
    }

    private static void loadNativeDelayed() {
        if (nativeLoaded || nativeLoadScheduled) return;
        synchronized (ModuleEntry.class) {
            if (nativeLoaded || nativeLoadScheduled) return;
            nativeLoadScheduled = true;
        }

        writeBootstrapStatus("native-load-scheduled", null);
        Thread loader = new Thread(() -> {
            try {
                // Compatibility with Vector builds that register native_init.list
                // only after XposedModule.onModuleLoaded() returns.
                Thread.sleep(1000L);
                System.loadLibrary("gakumas_progress_capture");
                nativeLoaded = true;
                writeBootstrapStatus("native-library-loaded", null);
            } catch (Throwable error) {
                writeBootstrapStatus("native-load-failed", error);
            }
        }, "GakumasProgressCaptureLoader");
        loader.setDaemon(true);
        loader.start();
    }

    @Override
    public void onModuleLoaded(ModuleLoadedParam param) {
        writeBootstrapStatus("module-loaded", null);
        loadNativeDelayed();
    }
}
