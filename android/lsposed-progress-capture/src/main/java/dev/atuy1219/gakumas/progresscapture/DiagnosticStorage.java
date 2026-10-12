package dev.atuy1219.gakumas.progresscapture;

/** Fixed game-private paths only. Kept independent of Android for host tests. */
final class DiagnosticStorage {
    static String configure(String parent, int mask, String[] files) {
        if (mask != 0 && mask != 128 && mask != 256 && mask != 384 && mask != 4224 && mask != 8192)
            throw new IllegalArgumentException("Unsupported native hook mask");
        if (!parent.matches("/data/user/[0-9]+/com\\.bandainamcoent\\.idolmaster_gakuen/files"))
            throw new IllegalArgumentException("Unexpected game files directory");
        StringBuilder names = new StringBuilder("native_hookmask.txt native_hookmask.txt.next");
        for (String name : files) {
            if (!name.matches("[a-z_]+\\.(json|jsonl)"))
                throw new IllegalArgumentException("Unexpected diagnostic file");
            names.append(' ').append(name).append(' ').append(name).append(".tmp");
        }
        // Check ALL fixed children before mutating. Reject dangling symlinks,
        // directories and hard links too. Never recurse over arbitrary data.
        return "p='" + parent + "'; d=\"$p/gakumas-sim\"; "
            + "test -d \"$p\" && test ! -L \"$p\" || exit 30; "
            + "test ! -L \"$d\" || exit 31; "
            + "uid=$(stat -c %u \"$p\") || exit 32; "
            + "gid=$(stat -c %g \"$p\") || exit 33; "
            + "[ \"$uid\" -ge 10000 ] && [ \"$((uid % 100000))\" -ge 10000 ] || exit 34; "
            + "[ \"$gid\" -ge 10000 ] || exit 35; "
            + "for n in " + names + "; do f=\"$d/$n\"; "
            + "test ! -L \"$f\" || exit 37; "
            + "if [ -e \"$f\" ]; then test -f \"$f\" "
            + "&& [ \"$(stat -c %h \"$f\")\" = 1 ] || exit 38; fi; done; "
            + "mkdir -p \"$d\" || exit 36; "
            + "test ! -e \"$d/native_hookmask.txt.next\" || exit 40; "
            + "(umask 077; set -C; printf '%s\\n' " + mask + " > \"$d/native_hookmask.txt.next\") || exit 41; "
            + "chown \"$uid:$gid\" \"$d/native_hookmask.txt.next\" "
            + "&& chmod 0600 \"$d/native_hookmask.txt.next\" "
            + "&& mv -f \"$d/native_hookmask.txt.next\" \"$d/native_hookmask.txt\" || exit 42; "
            // The safe mask is replaced BEFORE making a root-owned directory
            // writable. An unreadable legacy mask cannot suddenly activate.
            + "for n in " + names + "; do f=\"$d/$n\"; "
            + "if [ -f \"$f\" ]; then chown \"$uid:$gid\" \"$f\" "
            + "&& chmod 0600 \"$f\" || exit 43; fi; done; "
            + "chown \"$uid:$gid\" \"$d\" && chmod 0700 \"$d\" || exit 44; "
            + "restorecon \"$d\" || exit 45; "
            + "for n in " + names + "; do f=\"$d/$n\"; "
            + "if [ -f \"$f\" ]; then restorecon \"$f\" || exit 46; fi; done; "
            + "stat -c 'repaired-dir %u:%g %a %n' \"$d\"";
    }
}
