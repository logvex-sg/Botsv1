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
    public static final int VERSION = 4;

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
    public static final String CONTROL = "control";
    public static final String CONFIG = "config";

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
    public static final String TASK_EFLY = "efly";
    public static final String TASK_CONTAINER_READ = "container-read";
    public static final String TASK_CONTAINER_MOVE = "container-move";
    public static final String TASK_SHULKER_READ = "shulker-read";
    public static final String TASK_SHULKER_UNPACK = "shulker-unpack";
    public static final String TASK_SHULKER_PACK = "shulker-pack";
    public static final String TASK_RESTOCK = "restock";
    public static final String TASK_PORTAL_SCAN = "portal-scan";
    public static final String TASK_NL_TASK = "nl-task";

    // payload fields shared by more than one task
    public static final String FIELD_PAIRING_CODE = "pairingCode";
    public static final String FIELD_QUERY = "query";
    public static final String FIELD_ITEM = "item";
    public static final String FIELD_MESSAGE = "message";
    public static final String FIELD_TEXT = "text";
    public static final String FIELD_COMMAND = "command";
    public static final String FIELD_LINE = "line";
    public static final String FIELD_ALLOW_MOVES = "allowMoves";
    public static final String FIELD_ACTION = "action";
    public static final String FIELD_X = "x";
    public static final String FIELD_Y = "y";
    public static final String FIELD_Z = "z";
    public static final String FIELD_MODE = "mode";
    public static final String FIELD_MIN_HEIGHT = "minHeight";
    public static final String FIELD_USE_FIREWORKS = "useFireworks";
    public static final String FIELD_TASK_ID = "taskId";
    public static final String FIELD_REASON = "reason";
    public static final String FIELD_OK = "ok";
    public static final String FIELD_KIND = "kind";
    public static final String FIELD_DATA = "data";
    public static final String FIELD_PROGRESS = "progress";
    public static final String FIELD_PAUSED = "paused";
    public static final String FIELD_STOPPED = "stopped";
    public static final String FIELD_DURATION = "durationMs";
    public static final String FIELD_TOTAL = "total";
    public static final String FIELD_CARRIED = "carried";
    public static final String FIELD_ACCESSIBLE = "accessible";
    public static final String FIELD_ARMOR = "armor";
    public static final String FIELD_FREE_SLOTS = "freeSlots";
    public static final String FIELD_CONTAINER_OPEN = "containerOpen";
    public static final String FIELD_TOTALS = "totals";
    public static final String FIELD_LIMIT = "limit";
    public static final String FIELD_DIRECTION = "direction";
    public static final String FIELD_RADIUS = "radius";
    public static final String FIELD_SLOT = "slot";
    public static final String FIELD_LABEL = "label";
    public static final String FIELD_MOVED = "moved";
    public static final String FIELD_REMAINING = "remaining";
    public static final String FIELD_CAPACITY = "capacity";
    public static final String FIELD_EMPTY = "empty";
    public static final String FIELD_SHULKERS = "shulkers";
    public static final String FIELD_PORTALS = "portals";
    public static final String FIELD_INSTRUCTION = "instruction";
    public static final String FIELD_RUNTIME = "runtime";
    public static final String FIELD_CONFIG = "config";

    // control actions (the "control" message's payload.action). The worker owns its own
    // connection, so only it can drop it or dial it again; these make the host's Connect /
    // Disconnect / Restart controls real rather than cosmetic.
    public static final String CONTROL_CONNECT = "connect";
    public static final String CONTROL_DISCONNECT = "disconnect";
    public static final String CONTROL_RESTART = "restart";
    public static final String CONTROL_PAUSE = "pause";
    public static final String CONTROL_RESUME = "resume";

    /** efly actions. */
    public static final String EFLY_START = "start";
    public static final String EFLY_STOP = "stop";
}
