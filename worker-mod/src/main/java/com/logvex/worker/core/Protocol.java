package com.logvex.worker.core;

/**
 * The wire contract shared by the worker and the host.
 *
 * <p>Only the message types listed here may ever be executed. The host never sends code, a class
 * name or a shell command: it sends one of these types with a validated payload, and the worker
 * dispatches it through a fixed switch. That is what keeps this from becoming remote code
 * execution.
 */
public final class Protocol {
    private Protocol() {}

    /** Bumped whenever the envelope or a payload changes shape; mismatches are refused. */
    public static final int VERSION = 1;

    // worker -> host
    public static final String HELLO = "hello";
    public static final String REGISTER = "register";
    public static final String STATUS = "status";
    public static final String INVENTORY = "inventory";
    public static final String EQUIPMENT = "equipment";
    public static final String RESULT = "result";
    public static final String PROGRESS = "progress";
    public static final String PONG = "pong";
    public static final String ERROR = "error";
    public static final String LOG = "log";

    // host -> worker
    public static final String HELLO_ACK = "hello-ack";
    public static final String COMMAND = "command";
    public static final String TASK = "task";
    public static final String PING = "ping";
    public static final String KICK = "kick";

    // task kinds (the "task" message's payload.kind)
    public static final String TASK_STATUS = "status";
    public static final String TASK_INVENTORY = "inventory";
    public static final String TASK_COUNT = "count";
    public static final String TASK_SEARCH = "search";
    public static final String TASK_EQUIPMENT = "equipment";
    public static final String TASK_REGEAR = "regear";
    public static final String TASK_COMMAND = "command";
    public static final String TASK_CHAT = "chat";
    public static final String TASK_POSITION = "position";
}
