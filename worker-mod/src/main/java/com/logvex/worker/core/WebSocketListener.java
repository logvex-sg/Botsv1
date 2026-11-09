package com.logvex.worker.core;

/** Callbacks from {@link WebSocketClient}. All are invoked on the client's reader thread. */
public interface WebSocketListener {
    default void onOpen() {}

    default void onMessage(String text) {}

    default void onClose(int code, String reason) {}

    default void onError(Throwable error) {}
}
