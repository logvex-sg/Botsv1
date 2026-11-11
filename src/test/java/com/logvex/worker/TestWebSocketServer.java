package com.logvex.worker;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * A tiny single-connection WebSocket server for tests.
 *
 * <p>Deliberately independent of the production client: it implements the server half of the
 * handshake and frame codec from scratch so a bug in {@code WebSocketClient} cannot be hidden by
 * the same bug in the test harness. Text frames only, no masking on the server-to-client side,
 * unmasking on the client-to-server side.
 */
final class TestWebSocketServer implements AutoCloseable {
    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    private final ServerSocket serverSocket;
    private final BlockingQueue<String> inbound = new LinkedBlockingQueue<>();
    private final Thread acceptor;
    private volatile Socket socket;
    private volatile OutputStream out;
    private volatile boolean closed;

    TestWebSocketServer() throws IOException {
        this.serverSocket = new ServerSocket(0);
        this.acceptor = new Thread(this::acceptLoop, "test-ws-accept");
        this.acceptor.setDaemon(true);
        this.acceptor.start();
    }

    int port() {
        return serverSocket.getLocalPort();
    }

    private void acceptLoop() {
        try {
            Socket accepted = serverSocket.accept();
            socket = accepted;
            accepted.setTcpNoDelay(true);
            InputStream in = accepted.getInputStream();
            out = accepted.getOutputStream();

            String requestLine = readLine(in);
            String key = null;
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase("Sec-WebSocket-Key")) {
                    key = line.substring(colon + 1).trim();
                }
            }
            String accept = Base64.getEncoder().encodeToString(
                MessageDigest.getInstance("SHA-1").digest((key + GUID).getBytes(StandardCharsets.US_ASCII)));
            out.write(("HTTP/1.1 101 Switching Protocols\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            out.flush();

            while (!closed) {
                String frame = readFrame(in);
                if (frame == null) break;
                inbound.add(frame);
            }
        } catch (Exception ignored) {
            // Test server; a closed socket simply ends the loop.
        }
    }

    /** Waits for the next text frame from the client. */
    String next(int timeoutMillis) throws InterruptedException {
        return inbound.poll(timeoutMillis, TimeUnit.MILLISECONDS);
    }

    /** Sends a text frame to the client. */
    void send(String text) throws IOException {
        synchronized (this) {
            writeFrame(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    /** Sends a close frame. */
    void sendClose() throws IOException {
        synchronized (this) {
            OutputStream stream = out;
            stream.write(0x88);
            stream.write(0);
            stream.flush();
        }
    }

    private void writeFrame(byte[] payload) throws IOException {
        OutputStream stream = out;
        int length = payload.length;
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        header.write(0x81);
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
        stream.write(header.toByteArray());
        stream.write(payload);
        stream.flush();
    }

    private String readFrame(InputStream in) throws IOException {
        int b0 = in.read();
        if (b0 < 0) return null;
        int b1 = in.read();
        if (b1 < 0) return null;
        int opcode = b0 & 0x0F;
        boolean masked = (b1 & 0x80) != 0;
        long length = b1 & 0x7F;
        if (length == 126) {
            length = ((long) readByte(in) << 8) | readByte(in);
        } else if (length == 127) {
            length = 0;
            for (int i = 0; i < 8; i++) length = (length << 8) | readByte(in);
        }
        byte[] mask = new byte[4];
        if (masked) readFully(in, mask, 4);
        byte[] payload = new byte[(int) length];
        readFully(in, payload, payload.length);
        if (masked) {
            for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        }
        if (opcode == 0x8) return null;
        if (opcode == 0x9) { // ping: answer with a pong so the client's reader stays happy
            synchronized (this) {
                OutputStream stream = out;
                stream.write(0x8A);
                stream.write(0);
                stream.flush();
            }
            return readFrame(in);
        }
        return new String(payload, StandardCharsets.UTF_8);
    }

    private static int readByte(InputStream in) throws IOException {
        int value = in.read();
        if (value < 0) throw new IOException("eof");
        return value;
    }

    private static void readFully(InputStream in, byte[] buffer, int length) throws IOException {
        int offset = 0;
        while (offset < length) {
            int read = in.read(buffer, offset, length - offset);
            if (read < 0) throw new IOException("eof");
            offset += read;
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(128);
        int previous = -1;
        int current;
        while ((current = in.read()) >= 0) {
            if (previous == '\r' && current == '\n') {
                byte[] bytes = buffer.toByteArray();
                return new String(bytes, 0, Math.max(0, bytes.length - 1), StandardCharsets.US_ASCII);
            }
            buffer.write(current);
            previous = current;
        }
        return null;
    }

    @Override
    public void close() {
        closed = true;
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
            // Nothing to do.
        }
        try {
            serverSocket.close();
        } catch (IOException ignored) {
            // Nothing to do.
        }
    }
}
