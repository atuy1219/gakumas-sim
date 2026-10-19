package dev.atuy1219.gakumas.progresscapture;

import java.util.LinkedHashMap;
import java.util.Map;

/** Read-only root scan, independent of Android so its actual shell is testable. */
final class DiagnosticScan {
    private static final String GAME = "com.bandainamcoent.idolmaster_gakuen";

    private static String quote(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }

    static String command(int user, String moduleApk, String[] files) {
        if (user < 0) throw new IllegalArgumentException("Unexpected Android user");
        String data = "/data/user/" + user + "/" + GAME;
        StringBuilder names = new StringBuilder();
        for (String name : files) {
            if (!name.matches("[a-z_]+\\.(json|jsonl)"))
                throw new IllegalArgumentException("Unexpected diagnostic file");
            names.append(' ').append(name);
        }
        StringBuilder s = new StringBuilder();
        s.append("uid=$(id -u) || exit 31; printf '@rootUid|%s\\n' \"$uid\"; ")
            .append("[ \"$uid\" = 0 ] || exit 32; ")
            .append("echo '@diagnosticUser|").append(user).append("'; ")
            .append("echo '@expectedDataDir|").append(data).append("'; ")
            .append("f=").append(quote(data + "/files")).append("; ")
            .append("echo \"@targetDataDirDetails|$(ls -ldZ ")
            .append(quote(data)).append(" 2>&1)\"; ")
            .append("if [ -d ").append(quote(data)).append(" ]; then ")
            .append("echo '@targetDataDir|exists'; else echo '@targetDataDir|missing-or-inaccessible'; fi; ")
            .append("p=$(pidof ").append(GAME).append(" 2>/dev/null | cut -d ' ' -f 1); ")
            .append("echo \"@gamePid|${p:-none}\"; ")
            .append("echo \"@rootMountNamespace|$(readlink /proc/self/ns/mnt 2>/dev/null)\"; ")
            .append("echo \"@initMountNamespace|$(readlink /proc/1/ns/mnt 2>/dev/null)\"; ")
            .append("echo \"@selinuxMode|$(getenforce 2>/dev/null || echo unavailable)\"; ")
            .append("case \"$p\" in ''|*[!0-9]*) p='';; esac; ")
            .append("kind=app-user; ")
            .append("if [ -n \"$p\" ]; then ")
            .append("g=$(awk '$1 == \"Uid:\" {print $2; exit}' \"/proc/$p/status\" 2>/dev/null); ")
            .append("echo \"@gameUid|${g:-unavailable}\"; ")
            .append("echo \"@gameMountNamespace|$(readlink \"/proc/$p/ns/mnt\" 2>/dev/null)\"; ")
            .append("case \"$g\" in ''|*[!0-9]*) echo '@gameUser|unavailable';; *) ")
            .append("u=$((g / 100000)); echo \"@gameUser|$u\"; ")
            .append("r=\"/proc/$p/root/data/user/$u/").append(GAME).append("/files\"; ")
            .append("echo \"@gameProcessFilesDetails|$(ls -ldZ \"$r\" 2>&1)\"; ")
            // Only read the active game's namespace for the SAME Android user.
            // No nsenter, profile switching, chmod or chown in a scan.
            .append("if [ \"$u\" = ").append(user).append(" ] && [ ! -d \"$f\" ] && [ -d \"$r\" ]; then ")
            .append("f=\"$r\"; kind=game-process-root-read-only; fi;; esac; ")
            .append("if [ -r \"/proc/$p/maps\" ]; then ")
            .append("if grep -Fq 'libgakumas_progress_capture.so' \"/proc/$p/maps\"; then ")
            .append("echo '@moduleLibraryMapped|yes'; else echo '@moduleLibraryMapped|no'; fi; ")
            .append("if grep -Fq 'libil2cpp.so' \"/proc/$p/maps\"; then ")
            .append("echo '@il2cppLibraryMapped|yes'; else echo '@il2cppLibraryMapped|no'; fi; ")
            .append("if grep -Fq -- ").append(quote(moduleApk)).append(" \"/proc/$p/maps\"; then ")
            .append("echo '@moduleApkMapped|yes'; else echo '@moduleApkMapped|no'; fi; ")
            .append("else echo '@moduleLibraryMapped|maps-inaccessible'; fi; ")
            .append("else echo '@moduleLibraryMapped|game-not-running'; fi; ")
            .append("d=\"$f/gakumas-sim\"; echo \"@traceDirectory|$d/\"; ")
            .append("echo \"@tracePathKind|$kind\"; ")
            .append("echo \"@gameFilesDetails|$(ls -ldZ \"$f\" 2>&1)\"; ")
            .append("echo \"@captureDirectoryDetails|$(ls -ldZ \"$d\" 2>&1)\"; ")
            .append("if [ -d \"$d\" ]; then echo '@captureDirectory|exists'; ")
            .append("stat -c '@captureDirectoryOwner|%u:%g %a' \"$d\" 2>/dev/null; ")
            .append("else echo '@captureDirectory|missing-or-inaccessible'; fi; ")
            .append("stat -c '@gameFilesOwner|%u:%g %a' \"$f\" 2>/dev/null; ")
            .append("echo \"@hookMask|$(cat \"$d/native_hookmask.txt\" 2>/dev/null || echo unreadable-or-missing)\"; ")
            .append("for name in").append(names).append("; do path=\"$d/$name\"; ")
            .append("if [ -f \"$path\" ]; then stat -c \"$name|%s|%Y\" \"$path\" ")
            .append("|| echo \"$name|ERROR\"; ")
            .append("elif [ -d \"$f\" ] && [ -r \"$f\" ] && [ -x \"$f\" ]; then echo \"$name|MISSING\"; ")
            .append("else echo \"$name|INACCESSIBLE\"; fi; done; ")
            .append("for candidate in /data/user/*/").append(GAME).append("; do ")
            // An unmatched glob must NOT turn a completed scan into exit 1.
            .append("if [ -d \"$candidate\" ]; then echo \"@candidateDataDir|$candidate\"; fi; done; ")
            .append("echo '@scanComplete|yes'; exit 0");
        return s.toString();
    }

    static final class Result {
        final Map<String, String> preflight = new LinkedHashMap<>();
        final Map<String, String[]> files = new LinkedHashMap<>();
    }

    static String traceDirectory(int user, Result result) {
        String suffix = "/data/user/" + user + "/" + GAME + "/files/gakumas-sim/";
        String selected = result.preflight.get("traceDirectory");
        if (suffix.equals(selected)) return selected;
        String pid = result.preflight.get("gamePid");
        if (pid != null && pid.matches("[0-9]+")
            && String.valueOf(user).equals(result.preflight.get("gameUser"))
            && ("/proc/" + pid + "/root" + suffix).equals(selected)) return selected;
        throw new SecurityException("Unexpected diagnostic read path");
    }

    static Result parse(String output) {
        Result result = new Result();
        for (String line : output.split("\\r?\\n")) {
            String[] parts = line.trim().split("\\|", 3);
            if (parts.length < 2) continue;
            if (parts[0].startsWith("@")) {
                String key = parts[0].substring(1);
                String value = line.trim().substring(parts[0].length() + 1);
                if ("candidateDataDir".equals(key) && result.preflight.containsKey(key))
                    value = result.preflight.get(key) + "; " + value;
                result.preflight.put(key, value);
            } else result.files.put(parts[0], parts);
        }
        if (!"0".equals(result.preflight.get("rootUid")))
            throw new SecurityException("suでRoot UID 0を取得できません: " + output.trim());
        if (!"yes".equals(result.preflight.get("scanComplete")))
            throw new IllegalStateException("Root一覧検査が完了していません: " + output.trim());
        return result;
    }
}
