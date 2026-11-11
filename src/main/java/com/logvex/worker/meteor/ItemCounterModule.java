package com.logvex.worker.meteor;

import com.logvex.worker.core.InventorySummary;
import com.logvex.worker.core.ItemEntry;
import java.util.List;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.WWidget;
import meteordevelopment.meteorclient.gui.widgets.containers.WTable;
import meteordevelopment.meteorclient.gui.widgets.containers.WVerticalList;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.meteorclient.settings.StringSetting;

/**
 * Counts a queried item on this client.
 *
 * <p>Uses the same forgiving matcher the host does ({@code ItemQuery}: namespaced id, short id,
 * display-name substring, or an alias such as {@code totem} or {@code gapple}), so the number shown
 * here and the number the host aggregates agree.
 */
public class ItemCounterModule extends FleetModule {
    private final SettingGroup sgGeneral = settings.getDefaultGroup();

    private final Setting<String> query = sgGeneral.add(new StringSetting.Builder()
        .name("item")
        .description("Item to count (id, name, or an alias like 'totem').")
        .defaultValue("totem")
        .build());

    private WLabel resultLabel;

    public ItemCounterModule() {
        super("item-counter", "Counts a chosen item in this client's inventory.");
    }

    @Override
    public WWidget getWidget(GuiTheme theme) {
        WVerticalList list = theme.verticalList();
        resultLabel = list.add(theme.label("Press Count.")).expandX().widget();
        WButton count = list.add(theme.button("Count")).expandX().widget();
        count.action = this::update;
        return list;
    }

    @Override
    public void refresh() {
        update();
    }

    private void update() {
        if (resultLabel == null) return;
        List<ItemEntry> carried = runtime().dispatcher().carriedItems();
        int total = InventorySummary.countMatching(carried, query.get());
        resultLabel.set("'" + query.get() + "': " + total + " carried");
    }

    @Override
    public String getInfoString() {
        return query.get();
    }
}
