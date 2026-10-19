package dev.atuy1219.gakumas.progresscapture;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/** Keep scanning, reading and configuring in the same requested root namespace. */
final class DiagnosticRootShell {
    static final class Result {
        final int exit;
        final String output;
        Result(int exit, String output) { this.exit = exit; this.output = output; }
    }

    interface Runner { Result run(String[] arguments) throws Exception; }

    private final Runner runner;
    private Boolean mountMaster;
    private String helpStatus = "not-checked";

    DiagnosticRootShell() { this(DiagnosticRootShell::runProcess); }
    DiagnosticRootShell(Runner runner) { this.runner = runner; }

    private void selectMode() throws Exception {
        if (mountMaster != null) return;
        Result help = runner.run(new String[]{"su", "--help"});
        mountMaster = help.exit == 0 && help.output.contains("--mount-master")
            && help.output.contains("-M");
        helpStatus = "exit=" + help.exit + (mountMaster ? "; mount-master-supported" : "; mount-master-not-advertised");
    }

    String execute(String command) throws Exception {
        selectMode();
        Result result = runner.run(mountMaster
            ? new String[]{"su", "-M", "-c", command}
            : new String[]{"su", "-c", command});
        // Never retry a failed command in another namespace, especially writes.
        if (result.exit != 0)
            throw new IllegalStateException(invocation() + " 終了コード " + result.exit + ": " + result.output.trim());
        return result.output;
    }

    String invocation() { return Boolean.TRUE.equals(mountMaster) ? "su -M -c" : "su -c"; }
    String helpStatus() { return helpStatus; }

    private static Result runProcess(String[] arguments) throws Exception {
        Process process = new ProcessBuilder(arguments).redirectErrorStream(true).start();
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        try (InputStream in = process.getInputStream()) {
            byte[] buffer = new byte[8192];
            int length;
            while ((length = in.read(buffer)) != -1) {
                if (result.size() + length > 64 * 1024 * 1024) {
                    process.destroyForcibly();
                    throw new IllegalStateException("Root出力が64MiBを超えています");
                }
                result.write(buffer, 0, length);
            }
        }
        return new Result(process.waitFor(), result.toString("UTF-8"));
    }
}
