package com.logvex.hunter.companion;

import com.logvex.hunter.HunterAddon;
import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.companion.CompanionApi;
import com.logvex.hunter.core.equipment.EquipmentItem;
import com.logvex.hunter.core.equipment.EquipmentSnapshot;
import com.logvex.hunter.core.equipment.InventoryStatus;
import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.target.TargetCandidate;
import com.logvex.hunter.core.util.Json;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterModule;
import com.logvex.hunter.modules.HunterRegistry;
import meteordevelopment.meteorclient.systems.modules.Module;
import meteordevelopment.meteorclient.systems.modules.Modules;
import net.minecraft.client.Minecraft;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * The game-layer implementation of the companion API.
 *
 * <p>Read methods sample cached runtime values; because the HTTP handler runs off the client
 * thread, the sampling is marshalled onto the client thread and awaited with a short timeout. That
 * keeps the endpoint correct without ever mutating game state from a socket thread.
 */
public final class MinecraftCompanionApi implements CompanionApi {
    private static final long CALL_TIMEOUT_MS = 2000;

    private final Minecraft mc = Minecraft.getInstance();

    @Override
    public HunterCore core() {
        return HunterRuntime.get().core();
    }

    @Override
    public String version() {
        return HunterAddon.VERSION;
    }

    @Override
    public boolean connected() {
        return onClient(() -> HunterRuntime.get().connected(), false);
    }

    @Override
    public Map<String, Object> botView() {
        return onClient(this::buildBotView, emptyBot());
    }

    @Override
    public List<Map<String, Object>> playerViews() {
        return onClient(this::buildPlayerViews, List.of());
    }

    @Override
    public List<Map<String, Object>> moduleViews() {
        return onClient(this::buildModuleViews, List.of());
    }

    @Override
    public String handleCommand(String command) {
        return onClient(() -> CompanionCommands.run(command), "client thread unavailable");
    }

    @Override
    public void notify(String message) {
        onClient(() -> {
            HunterChat.info(message);
            core().recordEvent(com.logvex.hunter.core.stats.CombatEvent.Kind.INFO, "Remote: " + message, "");
            return null;
        }, null);
    }

    // ------------------------------------------------------------- sampling

    private Map<String, Object> buildBotView() {
        HunterRuntime runtime = HunterRuntime.get();
        HunterCore core = runtime.core();
        EquipmentSnapshot equipment = runtime.equipment();
        InventoryStatus inventory = runtime.inventory();

        Map<String, Object> map = Json.object();
        map.put("connected", runtime.connected());
        map.put("server", core.serverAddress());
        map.put("dimension", runtime.dimension());
        map.put("health", runtime.localHealth());
        map.put("armor", runtime.localArmor());
        map.put("weapon", runtime.localWeapon());
        map.put("totems", inventory.totems);
        map.put("food", inventory.food);
        map.put("freeSlots", inventory.freeSlots);
        map.put("usedSlots", inventory.usedSlots);
        map.put("status", core.config().emergencyStop() ? "emergency-stop" : core.running() ? "running" : "stopped");

        var position = runtime.localPosition();
        Map<String, Object> pos = Json.object();
        pos.put("x", position.x);
        pos.put("y", position.y);
        pos.put("z", position.z);
        map.put("position", pos);

        List<Object> armor = new ArrayList<>();
        for (EquipmentItem item : equipment.all()) {
            if (!item.slot.isArmor()) continue;
            Map<String, Object> entry = Json.object();
            entry.put("slot", item.slot.key());
            entry.put("item", item.itemId);
            entry.put("name", item.nameOrId());
            entry.put("durability", item.damageable()
                ? (int) Math.round(item.durabilityFraction() * 100) : -1);
            armor.add(entry);
        }
        map.put("armorPieces", armor);

        TargetCandidate target = core.currentTarget();
        if (target != null) {
            Map<String, Object> t = Json.object();
            t.put("name", target.name());
            t.put("distance", target.distance);
            t.put("health", target.snapshot.health());
            t.put("maxHealth", target.snapshot.maxHealth());
            t.put("armor", target.snapshot.armorPoints());
            t.put("category", target.category.key());
            map.put("currentTarget", t);
        }
        return map;
    }

    private List<Map<String, Object>> buildPlayerViews() {
        HunterRuntime runtime = HunterRuntime.get();
        List<Map<String, Object>> list = new ArrayList<>();
        var self = runtime.localPosition();
        for (PlayerSnapshot snapshot : runtime.players()) {
            Map<String, Object> map = Json.object();
            map.put("uuid", snapshot.uuid() == null ? null : snapshot.uuid().toString());
            map.put("name", snapshot.name());
            map.put("health", snapshot.health());
            map.put("maxHealth", snapshot.maxHealth());
            map.put("armor", snapshot.armorPoints());
            map.put("distance", snapshot.position().distanceTo(self));
            map.put("holdingWeapon", snapshot.holdingWeapon());
            map.put("hasTotem", snapshot.hasTotem());
            map.put("invisible", snapshot.invisible());
            map.put("creative", snapshot.creative());
            map.put("dimension", snapshot.dimension());
            Map<String, Object> pos = Json.object();
            pos.put("x", snapshot.position().x);
            pos.put("y", snapshot.position().y);
            pos.put("z", snapshot.position().z);
            map.put("position", pos);
            list.add(map);
        }
        return list;
    }

    private List<Map<String, Object>> buildModuleViews() {
        List<Map<String, Object>> list = new ArrayList<>();
        for (HunterModule module : HunterRegistry.hunterModules()) {
            list.add(moduleView(module.name, module.title, module.isActive(), "logvex"));
        }
        for (Module module : Modules.get().getAll()) {
            if (module.category == HunterAddon.CATEGORY) continue;
            String name = module.name;
            if (!isCoordinated(name)) continue;
            list.add(moduleView(name, module.title, module.isActive(), module.category.name));
        }
        return list;
    }

    private static Map<String, Object> moduleView(String name, String title, boolean active, String category) {
        Map<String, Object> map = Json.object();
        map.put("name", name);
        map.put("title", title);
        map.put("enabled", active);
        map.put("category", category);
        return map;
    }

    private static boolean isCoordinated(String name) {
        return switch (name) {
            case "kill-aura", "auto-weapon", "auto-totem", "auto-armor", "auto-eat",
                 "crystal-aura", "anchor-aura" -> true;
            default -> false;
        };
    }

    // ------------------------------------------------------- thread bridge

    private <T> T onClient(Supplier<T> supplier, T fallback) {
        if (mc.isSameThread()) {
            try {
                return supplier.get();
            } catch (RuntimeException e) {
                return fallback;
            }
        }
        CompletableFuture<T> future = new CompletableFuture<>();
        mc.execute(() -> {
            try {
                future.complete(supplier.get());
            } catch (Throwable t) {
                future.complete(fallback);
            }
        });
        try {
            return future.get(CALL_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            return fallback;
        }
    }

    private interface Supplier<T> {
        T get();
    }

    private static Map<String, Object> emptyBot() {
        Map<String, Object> map = Json.object();
        map.put("connected", false);
        map.put("status", "unavailable");
        return map;
    }
}
