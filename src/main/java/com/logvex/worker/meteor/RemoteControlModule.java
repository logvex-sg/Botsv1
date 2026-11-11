package com.logvex.worker.meteor;

import com.logvex.worker.core.Json;
import com.logvex.worker.core.Protocol;
import com.logvex.worker.core.TaskResult;
import com.google.gson.JsonObject;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.WWidget;
import meteordevelopment.meteorclient.gui.widgets.containers.WVerticalList;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.meteorclient.settings.StringSetting;
import meteordevelopment.meteorclient.utils.player.ChatUtils;

/**
 * Runs the same remote-control actions the host can send, from the client itself.
 *
 * <p>This is the operator's escape hatch and test surface: it uses the identical task path and the
 * identical permission gate, so a button here proves the host's command will work too. It never
 * bypasses {@link WorkerConnectionModule}'s permissions.
 */
public class RemoteControlModule extends FleetModule {
    private final SettingGroup sgGeneral = settings.getDefaultGroup();

    private final Setting<String> command = sgGeneral.add(new StringSetting.Builder()
        .name("command")
        .description("Command to run on this client (without the leading slash).")
        .defaultValue("")
        .build());

    private final Setting<String> chat = sgGeneral.add(new StringSetting.Builder()
        .name("chat-message")
        .description("Chat message to send as this client.")
        .defaultValue("")
        .build());

    private WLabel resultLabel;

    public RemoteControlModule() {
        super("remote-control", "Runs host-equivalent command and chat actions locally, for testing and manual control.");
    }

    @Override
    public WWidget getWidget(GuiTheme theme) {
        WVerticalList list = theme.verticalList();
        list.add(theme.label("Uses the same task path and permissions as the host.")).expandX();
        resultLabel = list.add(theme.label("No action yet.")).expandX().widget();

        WButton runCommand = list.add(theme.button("Run command")).expandX().widget();
        runCommand.action = () -> {
            JsonObject payload = new JsonObject();
            payload.addProperty(Protocol.FIELD_COMMAND, command.get());
            report(runtime().dispatcher().runLocal(Protocol.TASK_COMMAND, payload));
        };

        WButton sendChat = list.add(theme.button("Send chat")).expandX().widget();
        sendChat.action = () -> {
            JsonObject payload = new JsonObject();
            payload.addProperty(Protocol.FIELD_MESSAGE, chat.get());
            report(runtime().dispatcher().runLocal(Protocol.TASK_CHAT, payload));
        };

        WButton reportPosition = list.add(theme.button("Report position")).expandX().widget();
        reportPosition.action = () -> report(runtime().dispatcher().runLocal(Protocol.TASK_POSITION, new JsonObject()));

        return list;
    }

    private void report(TaskResult result) {
        String line = (result.ok ? "OK: " : "FAILED: ") + result.message;
        if (resultLabel != null) resultLabel.set(line);
        if (result.ok) ChatUtils.info("%s", line);
        else ChatUtils.error("%s", line);
    }

    @Override
    public String getInfoString() {
        return connectionLabel();
    }
}
