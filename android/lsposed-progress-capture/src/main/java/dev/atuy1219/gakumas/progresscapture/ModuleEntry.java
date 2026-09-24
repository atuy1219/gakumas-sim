package dev.atuy1219.gakumas.progresscapture;

import android.content.pm.ApplicationInfo;
import android.os.Process;
import android.util.Log;
import io.github.libxposed.api.XposedModule;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

public final class ModuleEntry extends XposedModule {
    private static final String TARGET = "com.bandainamcoent.idolmaster_gakuen";
    private static final String NATIVE_NAME = "gakumas_progress_capture";
    private static final String NATIVE_FILE = "libgakumas_progress_capture.so";
    private static final String TAG = "GakumasProgressCapture";
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

    private static void writeBootstrapStatus(
            String phase,
            Throwable error,
            String nativeLibraryDir,
            String attemptedPath) {
        String errorText = error == null
                ? ""
                : error.getClass().getName() + ": " + String.valueOf(error.getMessage());
        Log.i(TAG,
                "bootstrap phase=" + phase
                + " pid=" + Process.myPid()
                + " uid=" + Process.myUid()
                + " nativeLibraryDir=" + nativeLibraryDir
                + " attemptedPath=" + attemptedPath
                + (errorText.isEmpty() ? "" : " error=" + errorText));
        try {
            int userId = Process.myUid() / 100000;
            File dir = new File("/storage/emulated/" + userId
                    + "/Android/data/" + TARGET + "/files/gakumas-sim");
            if (!dir.exists()) dir.mkdirs();
            File out = new File(dir, "bootstrap_status.json");
            String errorClass = error == null ? "" : error.getClass().getName();
            String errorMessage = error == null ? "" : String.valueOf(error.getMessage());
            boolean attemptedPathExists = attemptedPath != null
                    && !attemptedPath.isEmpty()
                    && new File(attemptedPath).isFile();
            String json =
                    "{\n"
                    + "  \"phase\": \"" + escape(phase) + "\",\n"
                    + "  \"uid\": " + Process.myUid() + ",\n"
                    + "  \"pid\": " + Process.myPid() + ",\n"
                    + "  \"nativeLibraryDir\": \"" + escape(nativeLibraryDir) + "\",\n"
                    + "  \"attemptedPath\": \"" + escape(attemptedPath) + "\",\n"
                    + "  \"attemptedPathExists\": " + attemptedPathExists + ",\n"
                    + "  \"errorClass\": \"" + escape(errorClass) + "\",\n"
                    + "  \"errorMessage\": \"" + escape(errorMessage) + "\"\n"
                    + "}\n";
            try (FileOutputStream stream = new FileOutputStream(out, false)) {
                stream.write(json.getBytes(StandardCharsets.UTF_8));
                stream.flush();
            }
        } catch (Throwable writeError) {
            Log.e(TAG, "bootstrap status file write failed phase=" + phase, writeError);
        }
    }

    private void loadNativeDelayed() {
        if (nativeLoaded || nativeLoadScheduled) return;
        synchronized (ModuleEntry.class) {
            if (nativeLoaded || nativeLoadScheduled) return;
            nativeLoadScheduled = true;
        }

        String nativeLibraryDir = "";
        String absolutePath = "";
        try {
            ApplicationInfo info = getModuleApplicationInfo();
            if (info != null && info.nativeLibraryDir != null) {
                nativeLibraryDir = info.nativeLibraryDir;
                absolutePath = new File(nativeLibraryDir, NATIVE_FILE).getAbsolutePath();
            }
        } catch (Throwable error) {
            writeBootstrapStatus("module-native-dir-failed", error, "", "");
        }

        final String resolvedNativeLibraryDir = nativeLibraryDir;
        final String resolvedAbsolutePath = absolutePath;
        writeBootstrapStatus(
                "native-load-scheduled",
                null,
                resolvedNativeLibraryDir,
                resolvedAbsolutePath);

        Thread loader = new Thread(() -> {
            Throwable absoluteError = null;
            try {
                // Vector registers native_init.list immediately after onModuleLoaded()
                // returns. Delay the dlopen so the native entrypoint has already been
                // registered with the framework.
                Thread.sleep(1200L);

                if (!resolvedAbsolutePath.isEmpty() && new File(resolvedAbsolutePath).isFile()) {
                    writeBootstrapStatus(
                            "native-absolute-load-start",
                            null,
                            resolvedNativeLibraryDir,
                            resolvedAbsolutePath);
                    try {
                        System.load(resolvedAbsolutePath);
                        nativeLoaded = true;
                        writeBootstrapStatus(
                                "native-library-loaded-absolute",
                                null,
                                resolvedNativeLibraryDir,
                                resolvedAbsolutePath);
                        return;
                    } catch (Throwable error) {
                        absoluteError = error;
                        writeBootstrapStatus(
                                "native-absolute-load-failed",
                                error,
                                resolvedNativeLibraryDir,
                                resolvedAbsolutePath);
                    }
                }

                writeBootstrapStatus(
                        "native-loadlibrary-start",
                        absoluteError,
                        resolvedNativeLibraryDir,
                        resolvedAbsolutePath);
                System.loadLibrary(NATIVE_NAME);
                nativeLoaded = true;
                writeBootstrapStatus(
                        "native-library-loaded-loadlibrary",
                        null,
                        resolvedNativeLibraryDir,
                        resolvedAbsolutePath);
            } catch (Throwable error) {
                nativeLoaded = false;
                writeBootstrapStatus(
                        "native-load-failed",
                        error,
                        resolvedNativeLibraryDir,
                        resolvedAbsolutePath);
            } finally {
                nativeLoadScheduled = false;
            }
        }, "GakumasProgressCaptureLoader");
        loader.setDaemon(true);
        loader.start();
    }

    @Override
    public void onModuleLoaded(ModuleLoadedParam param) {
        Log.i(TAG, "onModuleLoaded process=" + param.getProcessName()
                + " systemServer=" + param.isSystemServer());
        writeBootstrapStatus("module-loaded", null, "", "");
        loadNativeDelayed();
    }

    @Override
    public void onPackageLoaded(PackageLoadedParam param) {
        if (!TARGET.equals(param.getPackageName()) || !param.isFirstPackage()) return;
        Log.i(TAG, "onPackageLoaded package=" + param.getPackageName()
                + " firstPackage=" + param.isFirstPackage());
        // Retry from the package-ready path if the early attempt failed.
        loadNativeDelayed();
    }
}
