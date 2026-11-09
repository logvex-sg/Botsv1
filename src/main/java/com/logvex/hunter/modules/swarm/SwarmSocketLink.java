package com.logvex.hunter.modules.swarm;

import com.logvex.hunter.core.swarm.SwarmLink;
import com.logvex.hunter.core.swarm.SwarmLineReader;
import com.logvex.hunter.core.swarm.SwarmMessage;

import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * One host-to-hunter TCP channel.
 *
 * <p>A single writer thread drains a bounded queue so the game thread never blocks on the socket:
 * {@link #send} only offers to the queue and returns. A reader thread parses incoming lines and
 * hands them to a callback, which the host marshals onto its own thread. Closing is idempotent.
 */
public final class SwarmSocketLink implements SwarmLink {
    /** Cap on queued outbound lines; beyond it, commands are dropped rather than growing memory. */
    private static final int OUTBOUND_CAPACITY = 256;

    private final Socket socket;
    private final BlockingQueue<String> outbound = new LinkedBlockingQueue<>(OUTBOUND_CAPACITY);
    private final AtomicBoolean open = new AtomicBoolean(true);
    private final Consumer<SwarmMessage> onMessage;
    private final Consumer<SwarmSocketLink> onClosed;
    private Thread writer;
    private Thread reader;

    public SwarmSocketLink(Socket socket, Consumer<SwarmMessage> onMessage, Consumer<SwarmSocketLink> onClosed) {
        this.socket = socket;
        this.onMessage = onMessage;
        this.onClosed = onClosed;
    }

    public void start() {
        writer = new Thread(this::writeLoop, "logvex-swarm-writer");
        writer.setDaemon(true);
        reader = new Thread(this::readLoop, "logvex-swarm-reader");
        reader.setDaemon(true);
        writer.start();
        reader.start();
    }

    @Override
    public boolean send(String line) {
        if (!open.get() || line == null) return false;
        return outbound.offer(line);
    }

    @Override
    public boolean open() {
        return open.get();
    }

    @Override
    public void flush(long timeoutMillis) {
        long deadline = System.currentTimeMillis() + Math.max(0, timeoutMillis);
        while (open.get() && !outbound.isEmpty() && System.currentTimeMillis() < deadline) {
            try {
                Thread.sleep(5);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    @Override
    public void close() {
        if (!open.compareAndSet(true, false)) return;
        try {
            socket.close();
        } catch (IOException ignored) {
            // closing an already-closed socket is not interesting
        }
        if (writer != null) writer.interrupt();
        if (reader != null) reader.interrupt();
        if (onClosed != null) onClosed.accept(this);
    }

    private void writeLoop() {
        try (OutputStream out = socket.getOutputStream()) {
            while (open.get()) {
                String line = outbound.take();
                out.write(line.getBytes(StandardCharsets.UTF_8));
                out.write('\n');
                out.flush();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (IOException e) {
            close();
        }
    }

    private void readLoop() {
        try (SwarmLineReader in = new SwarmLineReader(
            new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while (open.get() && (line = in.readLine()) != null) {
                SwarmMessage message = SwarmMessage.decode(line);
                if (message != null && onMessage != null) onMessage.accept(message);
            }
        } catch (IOException e) {
            // a dropped connection is normal; fall through to close
        } finally {
            close();
        }
    }
}
