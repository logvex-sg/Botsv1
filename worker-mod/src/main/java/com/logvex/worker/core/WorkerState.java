package com.logvex.worker.core;

/** The connection states a worker moves through, surfaced to the host and to the log. */
public enum WorkerState {
    DISCONNECTED,
    CONNECTING,
    HANDSHAKING,
    CONNECTED,
    REGISTERED,
    BACKING_OFF
}
