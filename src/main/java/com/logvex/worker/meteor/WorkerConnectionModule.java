package com.logvex.worker.meteor;

import com.logvex.worker.core.WorkerConfig;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.WWidget;
import meteordevelopment.meteorclient.gui.widgets.containers.WVerticalList;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.IntSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.meteorclient.settings.StringSetting;
import meteordevelopment.meteorclient.utils.player.ChatUtils;

/**
 * The worker's connection to the Fleet Manager host, and its permissions.
 *
 * <p>This is the module an operator turns on to put a client under remote control. Its settings are
 * the same fields as {@code config/logvex-worker.json} — the module writes through to the config, so
 * the in-game settings screen and the file never disagree. Turning the module off disconnects the
 * worker; turning it on dials out again.
 */
public class WorkerConnectionModule extends FleetModule {
    private final SettingGroup sgConnection = settings.getDefaultGroup();
    private final SettingGroup sgIdentity = settings.createGroup("Identity");
    private final SettingGroup sgPermissions = settings.createGroup("Task permissions");

    private final Setting<String> host = sgConnection.add(new StringSetting.Builder()
        .name("host")
        .description("Address of the Fleet Manager host to connect to.")
        .defaultValue(WorkerConfig.DEFAULT_HOST)
        .onChanged(value -> apply(c -> c.host = value))
        .build());

    private final Setting<Integer> port = sgConnection.add(new IntSetting.Builder()
        .name("port")
        .description("Port the host's worker server listens on.")
        .defaultValue(WorkerConfig.DEFAULT_PORT)
        .range(1, 65535)
        .sliderRange(1, 65535)
        .onChanged(value -> apply(c -> c.port = value))
        .build());

    private final Setting<String> token = sgConnection.add(new StringSetting.Builder()
        .name("pairing-code")
        .description("The pairing code shown on the host's dashboard. Must match exactly.")
        .defaultValue("")
        .onChanged(value -> apply(c -> c.token = value))
        .build());

    private final Setting<Integer> heartbeat = sgConnection.add(new IntSetting.Builder()
        .name("heartbeat-seconds")
        .description("How often to report status to the host.")
        .defaultValue(5)
        .range(1, 120)
        .sliderRange(1, 60)
        .onChanged(value -> apply(c -> c.heartbeatSeconds = value))
        .build());

    private final Setting<Integer> reconnect = sgConnection.add(new IntSetting.Builder()
        .name("reconnect-seconds")
        .description("Delay before retrying after the host is unreachable.")
        .defaultValue(5)
        .range(1, 120)
        .sliderRange(1, 60)
        .onChanged(value -> apply(c -> c.reconnectSeconds = value))
        .build());

    private final Setting<String> workerId = sgIdentity.add(new StringSetting.Builder()
        .name("worker-id")
        .description("Stable id for this worker. Blank derives one from your account name.")
        .defaultValue("")
        .onChanged(value -> apply(c -> c.workerId = value))
        .build());

    private final Setting<String> label = sgIdentity.add(new StringSetting.Builder()
        .name("worker-name")
        .description("Friendly name shown on the host dashboard.")
        .defaultValue("")
        .onChanged(value -> apply(c -> c.label = value))
        .build());

    private final Setting<String> group = sgIdentity.add(new StringSetting.Builder()
        .name("group")
        .description("Suggested group name. The host is authoritative; this is a hint.")
        .defaultValue("")
        .onChanged(value -> apply(c -> c.group = value))
        .build());

    private final Setting<Boolean> allowCommands = sgPermissions.add(new BoolSetting.Builder()
        .name("allow-commands")
        .description("Let the host run chat commands on this client.")
        .defaultValue(true)
        .onChanged(value -> apply(c -> c.allowCommands = value))
        .build());

    private final Setting<Boolean> allowChat = sgPermissions.add(new BoolSetting.Builder()
        .name("allow-chat")
        .description("Let the host send chat messages as this client.")
        .defaultValue(true)
        .onChanged(value -> apply(c -> c.allowChat = value))
        .build());

    private final Setting<Boolean> allowRegear = sgPermissions.add(new BoolSetting.Builder()
        .name("allow-regear")
        .description("Let the host withdraw items from an open container into this client.")
        .defaultValue(true)
        .onChanged(value -> apply(c -> c.allowRegear = value))
        .build());

    private final Setting<Boolean> allowEfly = sgPermissions.add(new BoolSetting.Builder()
        .name("allow-efly")
        .description("Let the host fly this client with its elytra.")
        .defaultValue(true)
        .onChanged(value -> apply(c -> c.allowEfly = value))
        .build());

    private WLabel statusLabel;
    /** Guards against onChanged firing while we are writing persisted values into the settings. */
    private boolean applying;

    public WorkerConnectionModule() {
        super("worker-connection", "Connects this client to a Fleet Manager host and sets its task permissions.");
    }

    @Override
    public void onActivate() {
        FleetRuntime runtime = runtime();
        if (!runtime.configured()) {
            ChatUtils.warning("Worker is not configured yet; the config file is written on first launch.");
            return;
        }
        loadFromConfig(runtime.config());
        runtime.applyConfig();
        ChatUtils.info("Connecting to %s", runtime.config().endpoint());
    }

    @Override
    public void onDeactivate() {
        runtime().stop();
        ChatUtils.info("Disconnected from the Fleet Manager host.");
    }

    @Override
    public String getInfoString() {
        return connectionLabel();
    }

    @Override
    public WWidget getWidget(GuiTheme theme) {
        WVerticalList list = theme.verticalList();

        statusLabel = list.add(theme.label("Status: " + connectionLabel())).expandX().widget();

        WButton connect = list.add(theme.button("Connect")).expandX().widget();
        connect.action = () -> {
            runtime().applyConfig();
            refreshStatus();
        };

        WButton disconnect = list.add(theme.button("Disconnect")).expandX().widget();
        disconnect.action = () -> {
            runtime().stop();
            refreshStatus();
        };

        WButton defaults = list.add(theme.button("Restore defaults")).expandX().widget();
        defaults.action = () -> {
            host.set(WorkerConfig.DEFAULT_HOST);
            port.set(WorkerConfig.DEFAULT_PORT);
            token.set("");
            heartbeat.set(5);
            reconnect.set(5);
            workerId.set("");
            label.set("");
            group.set("");
            allowCommands.set(true);
            allowChat.set(true);
            allowRegear.set(true);
            allowEfly.set(true);
            runtime().applyConfig();
            refreshStatus();
        };

        return list;
    }

    private void refreshStatus() {
        if (statusLabel != null) statusLabel.set("Status: " + connectionLabel());
    }

    /** Copies persisted config into the settings so the UI reflects the file. */
    private void loadFromConfig(WorkerConfig config) {
        if (config == null) return;
        applying = true;
        try {
            host.set(config.host);
            port.set(config.port);
            token.set(config.token);
            heartbeat.set(config.heartbeatSeconds);
            reconnect.set(config.reconnectSeconds);
            workerId.set(config.workerId);
            label.set(config.label);
            group.set(config.group);
            allowCommands.set(config.allowCommands);
            allowChat.set(config.allowChat);
            allowRegear.set(config.allowRegear);
            allowEfly.set(config.allowEfly);
        } finally {
            applying = false;
        }
    }

    private void apply(java.util.function.Consumer<WorkerConfig> mutation) {
        if (applying) return;
        WorkerConfig config = runtime().config();
        if (config == null) return;
        mutation.accept(config);
        runtime().applyConfig();
    }
}
