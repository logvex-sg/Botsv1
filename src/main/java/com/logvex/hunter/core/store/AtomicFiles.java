package com.logvex.hunter.core.store;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * Crash-safe file writes.
 *
 * <p>A write goes to a sibling temporary file first and is then moved over the destination, so a
 * crash mid-write can never leave a half-written configuration behind. Readers treat a missing or
 * unreadable file as "no data" rather than failing.
 */
public final class AtomicFiles {
    private AtomicFiles() {}

    public static void write(Path target, String content) throws IOException {
        Path parent = target.getParent();
        if (parent != null) Files.createDirectories(parent);
        Path temp = target.resolveSibling(target.getFileName() + ".tmp");
        Files.writeString(temp, content, StandardCharsets.UTF_8);
        try {
            Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException atomicUnsupported) {
            Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /** Reads a file as UTF-8, returning {@code null} when it does not exist or cannot be read. */
    public static String read(Path target) {
        try {
            if (!Files.exists(target)) return null;
            return Files.readString(target, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
    }

    public static Path backup(Path target) throws IOException {
        Path backup = target.resolveSibling(target.getFileName() + ".bak");
        if (Files.exists(target)) {
            Files.copy(target, backup, StandardCopyOption.REPLACE_EXISTING);
        }
        return backup;
    }

    public static void ensureDirectory(Path dir) {
        try {
            Files.createDirectories(dir);
        } catch (IOException ignored) {
            // best effort; a later write will report the failure
        }
    }
}
