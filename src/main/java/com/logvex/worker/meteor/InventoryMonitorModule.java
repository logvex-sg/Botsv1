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

/**
 * Shows what this client is carrying and what it has open, live.
 *
 * <p>Reads only. The table is rebuilt on the module's slow {@link #refresh()} cadence, never per
 * frame, and only when the contents actually change — the same "don't churn widgets every tick"
 * rule the desktop dashboard follows.
 */
public class InventoryMonitorModule extends FleetModule {
    private WLabel summaryLabel;
    private WTable table;
    private GuiTheme theme;
    private String lastSignature = "";

    public InventoryMonitorModule() {
        super("inventory-monitor", "Displays this client's carried items and any open container.");
    }

    @Override
    public WWidget getWidget(GuiTheme theme) {
        this.theme = theme;
        WVerticalList list = theme.verticalList();
        summaryLabel = list.add(theme.label("Reading inventory...")).expandX().widget();
        table = list.add(theme.table()).expandX().widget();

        WButton refresh = list.add(theme.button("Refresh now")).expandX().widget();
        refresh.action = () -> {
            runtime().refreshSnapshot();
            rebuild();
        };
        return list;
    }

    @Override
    public void refresh() {
        rebuild();
    }

    private void rebuild() {
        if (table == null) return;
        List<ItemEntry> carried = runtime().dispatcher().carriedItems();
        int total = InventorySummary.totalItems(carried);
        int distinct = InventorySummary.distinctItems(carried);
        if (summaryLabel != null) summaryLabel.set(total + " items, " + distinct + " stacks carried");

        StringBuilder signature = new StringBuilder();
        for (ItemEntry item : carried) {
            signature.append(item.id).append('x').append(item.count).append(';');
        }
        if (signature.toString().equals(lastSignature)) return;
        lastSignature = signature.toString();

        table.clear();
        table.add(theme.label("Item")).expandX();
        table.add(theme.label("Count"));
        table.row();
        for (var entry : InventorySummary.totalsById(carried).entrySet()) {
            table.add(theme.label(entry.getKey())).expandX();
            table.add(theme.label(Integer.toString(entry.getValue())));
            table.row();
        }
    }

    @Override
    public String getInfoString() {
        return Integer.toString(runtime().snapshot().totalItems);
    }
}
