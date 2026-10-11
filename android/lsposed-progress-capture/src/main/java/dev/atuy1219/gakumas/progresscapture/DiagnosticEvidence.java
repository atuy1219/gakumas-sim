package dev.atuy1219.gakumas.progresscapture;

/** A readable file is not evidence that its hooks are running now. */
final class DiagnosticEvidence {
    static String scope(String runningPid, int recordPid, int lastNativePid) {
        if (recordPid <= 0) return "unattributed";
        if (String.valueOf(recordPid).equals(runningPid)) return "current-process";
        if ("none".equals(runningPid) && recordPid == lastNativePid && lastNativePid > 0)
            return "last-known-run";
        return "historical-or-other-process";
    }

    static boolean selfTestPassed(String status, String testScope, boolean touchesGame,
        int testPid, int nativePid, int testUid, int nativeUid,
        boolean installed, boolean backup, int calls, int baseline, int original, int detoured) {
        return "passed".equals(status) && "module-local-pure-function".equals(testScope)
            && !touchesGame && nativePid > 0 && testPid == nativePid
            && nativeUid >= 10000 && testUid == nativeUid
            && installed && backup && calls == 1 && original == baseline
            && (long) detoured == (long) baseline + 1;
    }
}
