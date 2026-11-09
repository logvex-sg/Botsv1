package com.logvex.hunter.core.swarm;

import java.io.IOException;
import java.io.Reader;

/**
 * Reads newline-delimited text with a hard cap on line length.
 *
 * <p>{@link java.io.BufferedReader#readLine()} grows without bound, so a peer that never sends a
 * newline could exhaust memory. This reader caps every line at {@link SwarmProtocol#MAX_LINE} and
 * silently discards the rest of an oversized line, which keeps a hostile or broken peer from
 * affecting the host.
 */
public final class SwarmLineReader implements AutoCloseable {
    private final Reader reader;
    private final int maxLine;
    private final StringBuilder buffer = new StringBuilder();
    private boolean discarding;

    public SwarmLineReader(Reader reader) {
        this(reader, SwarmProtocol.MAX_LINE);
    }

    public SwarmLineReader(Reader reader, int maxLine) {
        this.reader = reader;
        this.maxLine = Math.max(64, maxLine);
    }

    /**
     * Reads the next line.
     *
     * @return the line without its terminator, or {@code null} at end of stream.
     * @throws IOException when the underlying reader fails
     */
    public String readLine() throws IOException {
        while (true) {
            int read = reader.read();
            if (read < 0) {
                if (buffer.isEmpty() && !discarding) return null;
                String line = discarding ? null : buffer.toString();
                buffer.setLength(0);
                discarding = false;
                return line;
            }
            char c = (char) read;
            if (c == '\n') {
                if (discarding) {
                    discarding = false;
                    buffer.setLength(0);
                    continue;
                }
                String line = buffer.toString();
                buffer.setLength(0);
                return line;
            }
            if (c == '\r') continue;
            if (discarding) continue;
            if (buffer.length() >= maxLine) {
                discarding = true;
                buffer.setLength(0);
                continue;
            }
            buffer.append(c);
        }
    }

    @Override
    public void close() throws IOException {
        reader.close();
    }
}
