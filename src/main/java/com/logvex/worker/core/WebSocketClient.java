package com.logvex.worker.core;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * A minimal RFC 6455 WebSocket client.
 *
 * <p>Written by hand rather than pulled in as a dependency: the worker ships inside a Minecraft
 * client, where every added library is a compatibility risk, and the mod only needs the small
 * subset of the protocol that text frames and a close handshake require. Binary frames, extensions
 * and compression are not implemented and are refused, which is also a useful simplification for
 * the host: the protocol is text-only in both directions.
 *
 * <p>Threading: one reader thread per connection. {@link #sendText} may be called from any thread and
 * serialises writes on an internal lock, because a WebSocket frame must not be interleaved with
 * another.
 */
public final class WebSocketClient implements AutoCloseable {
    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int OPCODE_TEXT = 0x1;
    private static final int OPCODE_CLOSE = 0x8;
    private static final int OPCODE_PING = 0x9;
    private static final int OPCODE_PONG = 0xA;
    private static final int MAX_FRAME_BYTES = 4 * 1024 * 1024;

    private final URI uri;
    private final WebSocketListener listener;
    private final Object writeLock = new Object();
    private final AtomicBoolean closed = new AtomicBoolean(false);
    private final SecureRandom random = new SecureRandom();

    private Socket socket;
    private InputStream in;
    private OutputStream out;
    private Thread reader;
    private volatile boolean open;

    public WebSocketClient(URI uri, WebSocketListener listener) {
        this.uri = uri;
        this.listener = listener;
    }

    public boolean isOpen() {
        return open && !closed.get();
    }

    /** Performs the handshake and starts the reader thread. Throws when the host refuses. */
    public void connect(int connectTimeoutMillis) throws IOException {
        if (!"ws".equalsIgnoreCase(uri.getScheme())) {
            throw new IOException("only ws:// is supported, got " + uri.getScheme());
        }
        int port = uri.getPort() > 0 ? uri.getPort() : 80;
        String path = (uri.getRawPath() == null || uri.getRawPath().isEmpty()) ? "/" : uri.getRawPath();
        if (uri.getRawQuery() != null) path = path + "?" + uri.getRawQuery();

        socket = new Socket();
        socket.connect(new InetSocketAddress(uri.getHost(), port), connectTimeoutMillis);
        socket.setTcpNoDelay(true);
        socket.setSoTimeout(0);
        in = socket.getInputStream();
        out = socket.getOutputStream();

        String key = newKey();
        String request = "GET " + path + " HTTP/1.1\r\n"
            + "Host: " + uri.getHost() + ":" + port + "\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n"
            + "Sec-WebSocket-Key: " + key + "\r\n"
            + "Sec-WebSocket-Version: 13\r\n"
            + "\r\n";
        out.write(request.getBytes(StandardCharsets.US_ASCII));
        out.flush();

        String statusLine = readHttpLine(in);
        if (statusLine == null || !statusLine.contains("101")) {
            throw new IOException("handshake rejected: " + (statusLine == null ? "no response" : statusLine.trim()));
        }
        String accept = null;
        String line;
        while ((line = readHttpLine(in)) != null && !line.isEmpty()) {
            int colon = line.indexOf(':');
            if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase("Sec-WebSocket-Accept")) {
                accept = line.substring(colon + 1).trim();
            }
        }
        if (accept == null || !accept.equals(expectedAccept(key))) {
            throw new IOException("handshake failed: bad Sec-WebSocket-Accept");
        }

        open = true;
        reader = new Thread(this::readLoop, "logvex-worker-ws");
        reader.setDaemon(true);
        reader.start();
        listener.onOpen();
    }

    /** Sends a text frame. A no-op once the socket is closed. */
    public void sendText(String text) {
        if (!isOpen() || text == null) return;
        try {
            writeFrame(OPCODE_TEXT, text.getBytes(StandardCharsets.UTF_8));
        } catch (IOException ex) {
            listener.onError(ex);
            closeQuietly();
        }
    }

    /** Sends a protocol-level ping. The host answers with a pong frame. */
    public void sendPing() {
        if (!isOpen()) return;
        try {
            writeFrame(OPCODE_PING, new byte[0]);
        } catch (IOException ex) {
            closeQuietly();
        }
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) return;
        open = false;
        try {
            if (socket != null && !socket.isClosed()) {
                synchronized (writeLock) {
                    writeRawFrame(OPCODE_CLOSE, new byte[0]);
                    out.flush();
                }
            }
        } catch (IOException ignored) {
            // Already gone; nothing useful to do.
        }
        closeQuietly();
    }

    private void closeQuietly() {
        open = false;
        closed.set(true);
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
            // Nothing to do.
        }
    }

    // ------------------------------------------------------------------ io

    private void readLoop() {
        int closeCode = 1006;
        String closeReason = "";
        try {
            while (isOpen()) {
                Frame frame = readFrame();
                if (frame == null) break;
                switch (frame.opcode) {
                    case OPCODE_TEXT -> listener.onMessage(new String(frame.payload, StandardCharsets.UTF_8));
                    case OPCODE_PING -> {
                        synchronized (writeLock) {
                            writeRawFrame(OPCODE_PONG, frame.payload);
                            out.flush();
                        }
                    }
                    case OPCODE_CLOSE -> {
                        closeCode = frame.payload.length >= 2
                            ? ((frame.payload[0] & 0xFF) << 8 | (frame.payload[1] & 0xFF))
                            : 1000;
                        closeReason = frame.payload.length > 2
                            ? new String(frame.payload, 2, frame.payload.length - 2, StandardCharsets.UTF_8)
                            : "";
                        return;
                    }
                    default -> {
                        // Pong and unknown opcodes are ignored.
                    }
                }
            }
        } catch (IOException ex) {
            if (isOpen()) listener.onError(ex);
        } finally {
            boolean wasOpen = open;
            open = false;
            closed.set(true);
            try {
                if (socket != null) socket.close();
            } catch (IOException ignored) {
                // Nothing to do.
            }
            if (wasOpen || !Thread.currentThread().isInterrupted()) {
                listener.onClose(closeCode, closeReason);
            }
        }
    }

    private void writeFrame(int opcode, byte[] payload) throws IOException {
        synchronized (writeLock) {
            writeRawFrame(opcode, payload);
            out.flush();
        }
    }

    /** Writes a single unmasked, unfragmented frame. Server-to-client frames are never masked. */
    private void writeRawFrame(int opcode, byte[] payload) throws IOException {
        int length = payload.length;
        java.io.ByteArrayOutputStream header = new java.io.ByteArrayOutputStream(10);
        header.write(0x80 | opcode);
        if (length < 126) {
            header.write(length);
        } else if (length < 65536) {
            header.write(126);
            header.write((length >>> 8) & 0xFF);
            header.write(length & 0xFF);
        } else {
            header.write(127);
            for (int shift = 56; shift >= 0; shift -= 8) {
                header.write((int) (((long) length >>> shift) & 0xFF));
            }
        }
        out.write(header.toByteArray());
        out.write(payload);
    }

    private Frame readFrame() throws IOException {
        int b0 = in.read();
        if (b0 < 0) return null;
        int b1 = in.read();
        if (b1 < 0) return null;
        int opcode = b0 & 0x0F;
        boolean masked = (b1 & 0x80) != 0;
        long length = b1 & 0x7F;
        if (length == 126) {
            length = ((long) readByte() << 8) | readByte();
        } else if (length == 127) {
            length = 0;
            for (int i = 0; i < 8; i++) length = (length << 8) | readByte();
        }
        if (length < 0 || length > MAX_FRAME_BYTES) {
            throw new IOException("frame too large: " + length);
        }
        byte[] mask = new byte[4];
        if (masked) readFully(mask, 4);
        byte[] payload = new byte[(int) length];
        readFully(payload, payload.length);
        if (masked) {
            for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        }
        return new Frame(opcode, payload);
    }

    private int readByte() throws IOException {
        int value = in.read();
        if (value < 0) throw new IOException("unexpected end of stream");
        return value;
    }

    private void readFully(byte[] buffer, int length) throws IOException {
        int offset = 0;
        while (offset < length) {
            int read = in.read(buffer, offset, length - offset);
            if (read < 0) throw new IOException("unexpected end of stream");
            offset += read;
        }
    }

    private static String readHttpLine(InputStream stream) throws IOException {
        java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream(128);
        int previous = -1;
        int current;
        while ((current = stream.read()) >= 0) {
            if (previous == '\r' && current == '\n') {
                byte[] bytes = buffer.toByteArray();
                return new String(bytes, 0, Math.max(0, bytes.length - 1), StandardCharsets.US_ASCII);
            }
            buffer.write(current);
            previous = current;
            if (buffer.size() > 8192) throw new IOException("HTTP header too long");
        }
        return null;
    }

    private String newKey() {
        byte[] nonce = new byte[16];
        random.nextBytes(nonce);
        return Base64.getEncoder().encodeToString(nonce);
    }

    private static String expectedAccept(String key) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-1");
            byte[] hash = digest.digest((key + GUID).getBytes(StandardCharsets.US_ASCII));
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception ex) {
            throw new IllegalStateException("SHA-1 unavailable", ex);
        }
    }

    private record Frame(int opcode, byte[] payload) {}

    /** Convenience: builds a {@code ws://host:port/path} URI. */
    public static URI uri(String host, int port, String path) {
        String normalized = path == null || path.isBlank() ? "/" : (path.startsWith("/") ? path : "/" + path);
        return URI.create(String.format(Locale.ROOT, "ws://%s:%d%s", host, port, normalized));
    }
}
