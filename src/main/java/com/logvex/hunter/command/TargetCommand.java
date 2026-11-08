package com.logvex.hunter.command;

import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.model.TargetCategory;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.target.TargetCandidate;
import com.logvex.hunter.core.util.Time;
import com.logvex.hunter.gui.target.TargetManagerScreen;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.target.PlayerTrackerModule;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import meteordevelopment.meteorclient.commands.Command;
import meteordevelopment.meteorclient.gui.GuiThemes;
import net.minecraft.commands.SharedSuggestionProvider;

/** Manages the target lists from chat: {@code .target <add|remove|list|focus|...>}. */
public class TargetCommand extends Command {
    public TargetCommand() {
        super("target", "Manages the Logvex Hunter target lists.", "targets");
    }

    @Override
    public void build(LiteralArgumentBuilder<SharedSuggestionProvider> builder) {
        builder.then(literal("list")
            .executes(context -> {
                list(TargetCategory.PRIORITY);
                return SINGLE_SUCCESS;
            })
            .then(argument("category", StringArgumentType.word()).executes(context -> {
                TargetCategory category = TargetCategory.fromKey(StringArgumentType.getString(context, "category"));
                list(category);
                return SINGLE_SUCCESS;
            }))
        );

        builder.then(literal("add")
            .then(argument("player", StringArgumentType.word())
                .executes(context -> {
                    add(StringArgumentType.getString(context, "player"), TargetCategory.PRIORITY);
                    return SINGLE_SUCCESS;
                })
                .then(argument("category", StringArgumentType.word()).executes(context -> {
                    add(StringArgumentType.getString(context, "player"),
                        TargetCategory.fromKey(StringArgumentType.getString(context, "category")));
                    return SINGLE_SUCCESS;
                }))
            )
        );

        builder.then(literal("remove")
            .then(argument("player", StringArgumentType.word()).executes(context -> {
                String name = StringArgumentType.getString(context, "player");
                HunterCore core = core();
                TargetEntry entry = core.targets().byName(name);
                if (entry == null) {
                    error("%s is not on any list.", name);
                } else {
                    core.targets().remove(entry.identityKey());
                    core.markDirty();
                    info("Removed %s from %s.", name, entry.category().displayName());
                }
                return SINGLE_SUCCESS;
            }))
        );

        builder.then(literal("focus")
            .then(argument("player", StringArgumentType.word()).executes(context -> {
                String name = StringArgumentType.getString(context, "player");
                PlayerTrackerModule tracker = HunterRegistry.tracker();
                if (tracker != null && tracker.selectByName(name)) info("Focused %s.", name);
                else error("%s is not currently visible.", name);
                return SINGLE_SUCCESS;
            }))
        );

        builder.then(literal("clear").executes(context -> {
            PlayerTrackerModule tracker = HunterRegistry.tracker();
            if (tracker != null) tracker.clearTarget();
            info("Target cleared.");
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("current").executes(context -> {
            TargetCandidate target = core().currentTarget();
            if (target == null) info("No current target.");
            else info("%s  %.1fm  hp %.1f/%s  [%s]", target.name(), target.distance,
                target.snapshot.health(), target.snapshot.maxHealth(), target.category.displayName());
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("gui").executes(context -> {
            mc.setScreen(new TargetManagerScreen(GuiThemes.get(), null));
            return SINGLE_SUCCESS;
        }));
    }

    private void list(TargetCategory category) {
        HunterCore core = core();
        var entries = core.targets().byCategory(category);
        info("%s (%d):", category.displayName(), entries.size());
        if (entries.isEmpty()) {
            info(" - empty");
            return;
        }
        for (TargetEntry entry : entries) {
            info(" - %s  prio %d  %dK/%dD  last seen %s", entry.effectiveName(), entry.priority(),
                entry.killCount(), entry.deathCount(), entry.lastSeen() == 0 ? "never" : Time.ago(entry.lastSeen()));
        }
    }

    private void add(String name, TargetCategory category) {
        PlayerTrackerModule tracker = HunterRegistry.tracker();
        if (tracker != null) {
            tracker.addTarget(name, category);
            info("Added %s to %s.", name, category.displayName());
            return;
        }
        HunterCore core = core();
        TargetEntry entry = core.targets().byName(name);
        if (entry == null) {
            entry = new TargetEntry(category, name);
            core.targets().add(entry);
        } else {
            entry.setCategory(category);
        }
        core.markDirty();
        info("Added %s to %s.", name, category.displayName());
    }

    private HunterCore core() {
        return HunterRuntime.get().core();
    }
}
