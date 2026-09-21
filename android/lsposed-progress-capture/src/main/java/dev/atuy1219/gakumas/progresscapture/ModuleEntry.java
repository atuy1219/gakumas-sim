package dev.atuy1219.gakumas.progresscapture;

import de.robv.android.xposed.IXposedHookLoadPackage;
import de.robv.android.xposed.callbacks.XC_LoadPackage;

public final class ModuleEntry implements IXposedHookLoadPackage {
    private static final String TARGET = "com.bandainamcoent.idolmaster_gakuen";
    private static volatile boolean loaded;

    @Override
    public void handleLoadPackage(XC_LoadPackage.LoadPackageParam lpparam) throws Throwable {
        if (lpparam == null || !TARGET.equals(lpparam.packageName) || !TARGET.equals(lpparam.processName)) {
            return;
        }
        if (loaded) return;
        synchronized (ModuleEntry.class) {
            if (loaded) return;
            System.loadLibrary("gakumas_progress_capture");
            loaded = true;
        }
    }
}
