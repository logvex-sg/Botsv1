package com.logvex.hunter.modules.swarm;

import com.logvex.hunter.core.swarm.SwarmHandshake;
import com.logvex.hunter.core.swarm.SwarmLineReader;
import com.logvex.hunter.core.swarm.SwarmMessage;
import com.logvex.hunter.core.swarm.SwarmProtocol;
import com.logvex.hunter.core.swarm.SwarmRoster;

import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * The host side of the swarm: accepts worker connections, authenticates them and dispatches
 * commands to the roster.
 *
 * <p>The accept loop runs on one daemon thread and each worker's I/O on the link's own threads, so
 * the game thread never blocks. Every incoming message is forwarded to a callback that the owning
 * module marshals onto the client thread before it touches game state.
 */
public final class SwarmHostServer {
    private final int port;
    private final String token;
    private final boolean allowRemote;
    private final SwarmRoster roster;
    private final java.util.function.BiConsumer<String, SwarmMessage> onMessage;
    private final Consumer<String> onLog;
    private final AtomicBoolean running = new AtomicBoolean(true);

    private ServerSocket server;
    private Thread acceptThread;
    private int workerCounter;

    public SwarmHostServer(int port, String token, boolean allowRemote, SwarmRoster roster,
                           java.util.function.BiConsumer<String, SwarmMessage> onMessage,
                           Consumer<String> onLog) {
        this.port = port;
        this.token = token == null ? "" : token;
        this.allowRemote = allowRemote;
        this.roster = roster;
        this.onMessage = onMessage;
        this.onLog = onLog;
    }

    /** Binds the listener and starts accepting. Throws when the port cannot be bound. */
    public void start() throws IOException {
        InetSocketAddress address = allowRemote
            ? new InetSocketAddress(port)
            : new InetSocketAddress(InetAddress.getLoopbackAddress(), port);
        server = new ServerSocket();
        server.setReuseAddress(true);
        server.bind(address);
        acceptThread = new Thread(this::acceptLoop, "logvex-swarm-host");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    public int boundPort() {
        return server != null ? server.getLocalPort() : port;
    }

    public boolean running() {
        return running.get() && server != null && !server.isClosed();
    }

    public SwarmRoster roster() {
        return roster;
    }

    public void stop() {
        if (!running.compareAndSet(true, false)) return;
        if (server != null) {
            try {
                server.close();
            } catch (IOException ignored) {
                // already closed
            }
        }
        if (acceptThread != null) acceptThread.interrupt();
        roster.clear();
    }

    private void acceptLoop() {
        while (running.get()) {
            try {
                Socket socket = server.accept();
                Thread handler = new Thread(() -> handle(socket), "logvex-swarm-handshake");
                handler.setDaemon(true);
                handler.start();
            } catch (IOException e) {
                if (running.get()) log("accept failed: " + e.getMessage());
                break;
            }
        }
    }

    /** Performs the handshake for one socket, then registers it and starts its reader. */
    private void handle(Socket socket) {
        try {
            socket.setTcpNoDelay(true);
            SwarmLineReader reader = new SwarmLineReader(
                new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            OutputStream out = socket.getOutputStream();

            String firstLine = reader.readLine();
            SwarmMessage hello = SwarmMessage.decode(firstLine);
            String rejection = SwarmHandshake.check(hello, token);
            if (rejection != null) {
                writeLine(out, SwarmHandshake.reject(rejection).encode());
                log("rejected a worker from " + socket.getInetAddress().getHostAddress() + ": " + rejection);
                closeQuietly(socket);
                return;
            }

            String address = socket.getInetAddress().getHostAddress() + ":" + socket.getPort();
            String id = "w" + (++workerCounter) + "-" + Long.toString(System.currentTimeMillis(), 36);
            String label = hello.string(SwarmProtocol.FIELD_LABEL);
            if (label.isBlank()) label = "worker-" + workerCounter;

            writeLine(out, SwarmHandshake.accept(label).encode());

            SwarmSocketLink link = new SwarmSocketLink(socket, message -> onMessage.accept(id, message),
                closed -> roster.unregister(id));
            roster.register(id, address, label, link, System.currentTimeMillis());
            link.start();
            log("worker '" + label + "' connected from " + address);
        } catch (IOException e) {
            closeQuietly(socket);
        }
    }

    private static void writeLine(OutputStream out, String line) throws IOException {
        out.write(line.getBytes(StandardCharsets.UTF_8));
        out.write('\n');
        out.flush();
    }

    private static void closeQuietly(Socket socket) {
        try {
            socket.close();
        } catch (IOException ignored) {
            // already closed
        }
    }

    private void log(String message) {
        if (onLog != null) onLog.accept(message);
    }
}
