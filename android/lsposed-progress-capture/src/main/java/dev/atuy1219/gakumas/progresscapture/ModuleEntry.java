package dev.atuy1219.gakumas.progresscapture;

import io.github.libxposed.api.XposedModule;

public final class ModuleEntry extends XposedModule {
    private static volatile boolean nativeLoaded;

    public ModuleEntry() {
        super();
    }

    @Override
    public void onModuleLoaded(ModuleLoadedParam param) {
        if (nativeLoaded) return;
        synchronized (ModuleEntry.class) {
            if (nativeLoaded) return;
            System.loadLibrary("gakumas_progress_capture");
            nativeLoaded = true;
        }
    }
}
