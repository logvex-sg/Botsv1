package com.logvex.hunter.modules.swarm;

import com.logvex.hunter.core.swarm.SwarmHandshake;
import com.logvex.hunter.core.swarm.SwarmLineReader;
import com.logvex.hunter.core.swarm.SwarmMessage;
import com.logvex.hunter.core.swarm.SwarmProtocol;

import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BiConsumer;

/**
 * The hunter side of the swarm link.
 *
 * <p>Connects to a host, performs the token handshake, then receives {@code command} lines. Commands
 * are never executed on the socket thread: they are queued and drained on the client tick by the
 * owning module, which keeps every game-state change on the client thread. Status and results are
 * sent back over the same socket.
 */
public final class SwarmHunterClient {
    private final String host;
    private final int port;
    private final String token;
    private final String label;
    private final BiConsumer<String, Boolean> onStateChange;
    private final ConcurrentLinkedQueue<String> inbox = new ConcurrentLinkedQueue<>();
    private final AtomicBoolean running = new AtomicBoolean(true);

    private volatile Socket socket;
    private volatile OutputStream out;
    private volatile boolean connected;
    private volatile String lastError = "";
    private volatile long lastLatencyMillis = -1;
    private Thread thread;

    public SwarmHunterClient(String host, int port, String token, String label,
                             BiConsumer<String, Boolean> onStateChange) {
        this.host = host;
        this.port = port;
        this.token = token == null ? "" : token;
        this.label = label == null ? "" : label;
        this.onStateChange = onStateChange;
    }

    public void start() {
        thread = new Thread(this::run, "logvex-swarm-hunter");
        thread.setDaemon(true);
        thread.start();
    }

    public boolean connected() {
        return connected;
    }

    public String lastError() {
        return lastError;
    }

    public long lastLatencyMillis() {
        return lastLatencyMillis;
    }

    public String endpoint() {
        return host + ":" + port;
    }

    /** Takes the next command queued by the reader, or {@code null} when there is none. */
    public String pollCommand() {
        return inbox.poll();
    }

    /** Sends a status line back to the host. Returns {@code false} when the link is down. */
    public boolean sendStatus(String status, String data) {
        return send(SwarmMessage.of(SwarmProtocol.STATUS)
            .with(SwarmProtocol.FIELD_STATUS, status)
            .with(SwarmProtocol.FIELD_DATA, data));
    }

    /** Sends the result of a command back to the host. */
    public boolean sendResult(String line, boolean ok, String output) {
        return send(SwarmMessage.of(SwarmProtocol.RESULT)
            .with(SwarmProtocol.FIELD_LINE, line)
            .with(SwarmProtocol.FIELD_OK, ok)
            .with(SwarmProtocol.FIELD_OUTPUT, output)
            .with(SwarmProtocol.FIELD_TIME, System.currentTimeMillis()));
    }

    public void disconnect() {
        if (!running.compareAndSet(true, false)) return;
        closeSocket();
        if (thread != null) thread.interrupt();
        notifyState("disconnected", false);
    }

    private boolean send(SwarmMessage message) {
        OutputStream stream = out;
        if (stream == null || !connected) return false;
        try {
            stream.write(message.encode().getBytes(StandardCharsets.UTF_8));
            stream.write('\n');
            stream.flush();
            return true;
        } catch (IOException e) {
            closeSocket();
            notifyState("send failed", false);
            return false;
        }
    }

    private void run() {
        notifyState("connecting", false);
        try {
            Socket s = new Socket();
            s.connect(new InetSocketAddress(host, port), 5000);
            s.setTcpNoDelay(true);
            socket = s;
            out = s.getOutputStream();
            out.write(SwarmHandshake.hello(token, label).encode().getBytes(StandardCharsets.UTF_8));
            out.write('\n');
            out.flush();

            SwarmLineReader reader = new SwarmLineReader(
                new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
            String first = reader.readLine();
            SwarmMessage ack = SwarmMessage.decode(first);
            if (!SwarmHandshake.accepted(ack)) {
                lastError = ack == null ? "no handshake reply" : ack.string(SwarmProtocol.FIELD_ERROR);
                closeSocket();
                notifyState(lastError.isBlank() ? "rejected" : lastError, false);
                return;
            }
            connected = true;
            notifyState("connected", true);
            readLoop(reader);
        } catch (IOException e) {
            lastError = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            closeSocket();
            notifyState(lastError, false);
        }
    }

    private void readLoop(SwarmLineReader reader) throws IOException {
        String line;
        while (running.get() && (line = reader.readLine()) != null) {
            SwarmMessage message = SwarmMessage.decode(line);
            if (message == null) continue;
            switch (message.type()) {
                case SwarmProtocol.COMMAND -> {
                    String command = message.string(SwarmProtocol.FIELD_LINE);
                    if (!command.isBlank()) inbox.offer(command);
                }
                case SwarmProtocol.PING -> {
                    lastLatencyMillis = System.currentTimeMillis() - message.number(SwarmProtocol.FIELD_TIME, 0);
                    send(SwarmMessage.of(SwarmProtocol.PONG)
                        .with(SwarmProtocol.FIELD_TIME, message.number(SwarmProtocol.FIELD_TIME, 0)));
                }
                case SwarmProtocol.BYE -> {
                    closeSocket();
                    notifyState("host closed the link", false);
                    return;
                }
                default -> {
                    // ignore unknown message types so a newer host can add fields safely
                }
            }
        }
        closeSocket();
        notifyState("host disconnected", false);
    }

    private void closeSocket() {
        connected = false;
        out = null;
        Socket s = socket;
        socket = null;
        if (s != null) {
            try {
                s.close();
            } catch (IOException ignored) {
                // already closed
            }
        }
    }

    private void notifyState(String state, boolean up) {
        if (onStateChange != null) onStateChange.accept(state, up);
    }
}
