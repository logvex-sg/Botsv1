package com.logvex.worker.core;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * Owns the worker's connection to the host.
 *
 * <p>One supervisor thread dials out, authenticates, registers and then heartbeats; a second,
 * single-threaded executor runs tasks so two tasks can never run at once on the same client (the
 * host's "one conflicting task per worker" rule is enforced here as well as on the host). The reader
 * thread only parses and hands work off, so a slow task cannot stall the connection.
 *
 * <p>Reconnection is unconditional and unbounded with a fixed delay: a worker is expected to
 * outlive a host restart without operator intervention.
 */
public final class WorkerLink implements AutoCloseable {
    /** Opens a connection. Injectable so tests can supply a loopback server. */
    public interface ConnectionFactory {
        WebSocketClient connect(java.net.URI uri, WebSocketListener listener, int timeoutMillis) throws IOException;

        static ConnectionFactory defaultFactory() {
            return (uri, listener, timeout) -> {
                WebSocketClient client = new WebSocketClient(uri, listener);
                client.connect(timeout);
                return client;
            };
        }
    }

    private static final int HANDSHAKE_TIMEOUT_SECONDS = 10;
    private static final int MAX_CACHED_RESULTS = 64;

    private final WorkerConfig config;
    private final TaskDispatcher dispatcher;
    private final ConnectionFactory factory;
    private final Consumer<String> logSink;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final ExecutorService taskExecutor =
        Executors.newSingleThreadExecutor(runnable -> daemonThread(runnable, "logvex-worker-tasks"));
    /** Bounded cache of task id to encoded result, so a host retry is answered without re-running. */
    private final Map<String, String> completedResults = new LinkedHashMap<>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, String> eldest) {
            return size() > MAX_CACHED_RESULTS;
        }
    };

    private volatile WorkerState state = WorkerState.DISCONNECTED;
    private volatile Consumer<WorkerState> stateListener = ignored -> {};
    private volatile WebSocketClient client;
    private volatile Thread supervisor;
    private volatile CountDownLatch ackLatch;
    private volatile String registeredId = "";
    private volatile long connectedAt;

    public WorkerLink(WorkerConfig config, TaskDispatcher dispatcher) {
        this(config, dispatcher, ConnectionFactory.defaultFactory(), message -> {});
    }

    public WorkerLink(WorkerConfig config, TaskDispatcher dispatcher, ConnectionFactory factory, Consumer<String> logSink) {
        this.config = config;
        this.dispatcher = dispatcher;
        this.factory = factory;
        this.logSink = logSink == null ? message -> {} : logSink;
    }

    public WorkerState state() {
        return state;
    }

    public boolean isRegistered() {
        return state == WorkerState.REGISTERED;
    }

    public long connectedAt() {
        return connectedAt;
    }

    public void onStateChange(Consumer<WorkerState> listener) {
        this.stateListener = listener == null ? ignored -> {} : listener;
    }

    public synchronized void start() {
        if (!running.compareAndSet(false, true)) return;
        supervisor = daemonThread(this::supervise, "logvex-worker-link");
        supervisor.start();
    }

    public synchronized void stop() {
        if (!running.compareAndSet(true, false)) return;
        WebSocketClient current = client;
        if (current != null) current.close();
        Thread thread = supervisor;
        if (thread != null) thread.interrupt();
        setState(WorkerState.DISCONNECTED);
    }

    @Override
    public void close() {
        stop();
        taskExecutor.shutdownNow();
    }

    /** Sends a message if connected; returns whether it was queued. */
    public boolean send(Envelope envelope) {
        WebSocketClient current = client;
        if (current == null || !current.isOpen()) return false;
        current.sendText(envelope.encode());
        return true;
    }

    // ------------------------------------------------------------- supervisor

    private void supervise() {
        while (running.get()) {
            try {
                connectOnce();
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception ex) {
                log("connection failed: " + ex.getMessage());
            } finally {
                WebSocketClient current = client;
                if (current != null) current.close();
                client = null;
            }
            if (!running.get()) break;
            setState(WorkerState.BACKING_OFF);
            try {
                sleep(config.reconnectSeconds * 1000L);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        setState(WorkerState.DISCONNECTED);
    }

    private void connectOnce() throws IOException, InterruptedException {
        setState(WorkerState.CONNECTING);
        java.net.URI uri = WebSocketClient.uri(config.host, config.port, "/worker");
        log("connecting to " + config.endpoint());
        WebSocketClient newClient = factory.connect(uri, new Listener(), 10_000);
        client = newClient;
        connectedAt = System.currentTimeMillis();
        setState(WorkerState.HANDSHAKING);

        ackLatch = new CountDownLatch(1);
        JsonObject hello = new JsonObject();
        hello.addProperty("token", config.token);
        hello.addProperty("protocolVersion", Protocol.VERSION);
        hello.addProperty("workerId", config.workerId);
        hello.addProperty("modVersion", "1.0.0");
        newClient.sendText(new Envelope(Protocol.HELLO, null, hello).encode());

        if (!ackLatch.await(HANDSHAKE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw new IOException("host did not acknowledge the handshake");
        }
        if (!newClient.isOpen()) {
            throw new IOException("host closed the connection during the handshake");
        }

        setState(WorkerState.REGISTERED);
        log("registered as " + registeredId);
        sendSnapshot(Protocol.REGISTER);

        while (running.get() && newClient.isOpen()) {
            sleep(config.heartbeatSeconds * 1000L);
            if (!running.get() || !newClient.isOpen()) break;
            sendSnapshot(Protocol.STATUS);
        }
    }

    private void sendSnapshot(String type) {
        try {
            WorkerSnapshot snapshot = dispatcher.snapshot();
            if (snapshot != null && (snapshot.workerId == null || snapshot.workerId.isEmpty())) {
                snapshot.workerId = registeredId;
            }
            send(Envelope.of(type, Json.gson().toJsonTree(snapshot).getAsJsonObject()));
        } catch (Exception ex) {
            log("could not send " + type + ": " + ex.getMessage());
        }
    }

    private void setState(WorkerState next) {
        if (state == next) return;
        state = next;
        try {
            stateListener.accept(next);
        } catch (RuntimeException ignored) {
            // A listener must never break the link.
        }
    }

    private void sleep(long millis) throws InterruptedException {
        Thread.sleep(millis);
    }

    private void log(String message) {
        try {
            logSink.accept(message);
        } catch (RuntimeException ignored) {
            // Logging must never break the link.
        }
    }

    private static Thread daemonThread(Runnable runnable, String name) {
        Thread thread = new Thread(runnable, name);
        thread.setDaemon(true);
        return thread;
    }

    // ---------------------------------------------------------------- inbound

    private final class Listener implements WebSocketListener {
        @Override
        public void onMessage(String text) {
            Envelope envelope = Envelope.decode(text);
            if (envelope == null) {
                log("ignored a malformed frame");
                return;
            }
            switch (envelope.type) {
                case Protocol.HELLO_ACK -> handleHelloAck(envelope);
                case Protocol.TASK, Protocol.COMMAND -> handleTask(envelope);
                case Protocol.PING -> send(Envelope.reply(Protocol.PONG, envelope.id, null));
                case Protocol.KICK -> {
                    log("host kicked this worker: " + Json.string(envelope.payloadOrEmpty(), "reason", "no reason given"));
                    stop();
                }
                default -> {
                    // Unknown types are ignored so an older worker stays usable with a newer host.
                }
            }
        }

        @Override
        public void onClose(int code, String reason) {
            log("disconnected (" + code + (reason.isBlank() ? "" : " " + reason) + ")");
        }

        @Override
        public void onError(Throwable error) {
            log("socket error: " + error.getMessage());
        }
    }

    private void handleHelloAck(Envelope envelope) {
        JsonObject payload = envelope.payloadOrEmpty();
        boolean accepted = Json.bool(payload, "accepted", true);
        int hostVersion = Json.integer(payload, "protocolVersion", Protocol.VERSION);
        registeredId = Json.string(payload, "workerId", config.workerId);
        if (!accepted) {
            log("host refused the connection: " + Json.string(payload, "reason", "unauthorised"));
            stop();
            return;
        }
        if (hostVersion != Protocol.VERSION) {
            log("protocol mismatch: host speaks v" + hostVersion + ", this worker speaks v" + Protocol.VERSION);
            stop();
            return;
        }
        CountDownLatch latch = ackLatch;
        if (latch != null) latch.countDown();
    }

    private void handleTask(Envelope envelope) {
        JsonObject payload = envelope.payloadOrEmpty();
        String taskId = envelope.id != null ? envelope.id : Json.string(payload, "taskId", "");
        String kind = Json.string(payload, "kind", envelope.type.equals(Protocol.COMMAND) ? Protocol.TASK_COMMAND : "");

        if (taskId.isEmpty()) {
            log("refused a task with no id");
            return;
        }
        if (!TaskCatalog.isSupported(kind)) {
            TaskResult refused = TaskResult.failure(taskId, kind,
                "unsupported task kind '" + kind + "'; this worker implements " + TaskCatalog.all());
            sendResult(taskId, refused);
            return;
        }
        synchronized (completedResults) {
            String cached = completedResults.get(taskId);
            if (cached != null) {
                // A retry of a task we already ran: answer with the original result, do not re-run it.
                WebSocketClient current = client;
                if (current != null && current.isOpen()) current.sendText(cached);
                return;
            }
        }

        taskExecutor.execute(() -> {
            TaskResult result;
            try {
                result = dispatcher.dispatch(taskId, kind, payload);
            } catch (Exception ex) {
                result = TaskResult.failure(taskId, kind, "task threw: " + ex.getMessage());
            }
            if (result == null) result = TaskResult.failure(taskId, kind, "task produced no result");
            sendResult(taskId, result);
        });
    }

    private void sendResult(String taskId, TaskResult result) {
        if (result.taskId == null || result.taskId.isEmpty()) result.taskId = taskId;
        String encoded = Envelope.reply(Protocol.RESULT, taskId,
            Json.gson().toJsonTree(result).getAsJsonObject()).encode();
        synchronized (completedResults) {
            completedResults.put(taskId, encoded);
        }
        WebSocketClient current = client;
        if (current != null && current.isOpen()) current.sendText(encoded);
    }
}
