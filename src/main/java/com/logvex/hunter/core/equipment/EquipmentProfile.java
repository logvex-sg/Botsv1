package com.logvex.hunter.core.equipment;

import com.logvex.hunter.core.util.Json;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * A named set of equipment requirements, used both for warnings and for weapon selection.
 *
 * <p>Weapon preference is an ordered list of item ids; the first one present in the inventory wins.
 */
public final class EquipmentProfile {
    private String name;
    private final List<String> weaponPreference = new ArrayList<>();
    /** Minimum number of armour pieces that must be equipped before a warning is raised. */
    private int minArmorPieces = 4;
    /** Minimum totems that should be carried in the inventory. */
    private int minTotems = 1;
    /** Minimum food items that should be carried. */
    private int minFood = 8;
    /** Durability percentage below which an equipped item raises a warning. */
    private int lowDurabilityPercent = 15;

    public EquipmentProfile(String name) {
        this.name = name;
    }

    public String name() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public List<String> weaponPreference() {
        return weaponPreference;
    }

    public void addWeapon(String itemId) {
        if (itemId != null && !itemId.isBlank() && !weaponPreference.contains(itemId)) weaponPreference.add(itemId);
    }

    public void setWeapons(List<String> weapons) {
        weaponPreference.clear();
        if (weapons != null) weaponPreference.addAll(weapons);
    }

    public int minArmorPieces() {
        return minArmorPieces;
    }

    public void setMinArmorPieces(int minArmorPieces) {
        this.minArmorPieces = Math.max(0, Math.min(4, minArmorPieces));
    }

    public int minTotems() {
        return minTotems;
    }

    public void setMinTotems(int minTotems) {
        this.minTotems = Math.max(0, minTotems);
    }

    public int minFood() {
        return minFood;
    }

    public void setMinFood(int minFood) {
        this.minFood = Math.max(0, minFood);
    }

    public int lowDurabilityPercent() {
        return lowDurabilityPercent;
    }

    public void setLowDurabilityPercent(int lowDurabilityPercent) {
        this.lowDurabilityPercent = Math.max(0, Math.min(100, lowDurabilityPercent));
    }

    /** The first preferred weapon that appears in {@code available}, or {@code null}. */
    public String chooseWeapon(List<String> available) {
        if (available == null) return null;
        for (String preferred : weaponPreference) {
            for (String item : available) {
                if (item != null && item.equalsIgnoreCase(preferred)) return preferred;
            }
        }
        return null;
    }

    public EquipmentProfile copy(String newName) {
        EquipmentProfile copy = new EquipmentProfile(newName);
        copy.setWeapons(weaponPreference);
        copy.minArmorPieces = minArmorPieces;
        copy.minTotems = minTotems;
        copy.minFood = minFood;
        copy.lowDurabilityPercent = lowDurabilityPercent;
        return copy;
    }

    public Map<String, Object> toJson() {
        Map<String, Object> map = Json.object();
        map.put("name", name);
        List<Object> weapons = new ArrayList<>(weaponPreference);
        map.put("weapons", weapons);
        map.put("minArmorPieces", minArmorPieces);
        map.put("minTotems", minTotems);
        map.put("minFood", minFood);
        map.put("lowDurabilityPercent", lowDurabilityPercent);
        return map;
    }

    public static EquipmentProfile fromJson(Map<String, Object> map) {
        EquipmentProfile profile = new EquipmentProfile(Json.getString(map, "name", "default"));
        for (Object raw : Json.getArray(map, "weapons")) {
            if (raw instanceof String s) profile.addWeapon(s);
        }
        profile.setMinArmorPieces(Json.getInt(map, "minArmorPieces", 4));
        profile.setMinTotems(Json.getInt(map, "minTotems", 1));
        profile.setMinFood(Json.getInt(map, "minFood", 8));
        profile.setLowDurabilityPercent(Json.getInt(map, "lowDurabilityPercent", 15));
        return profile;
    }

    public static EquipmentProfile defaults(String name) {
        EquipmentProfile profile = new EquipmentProfile(name);
        profile.addWeapon("minecraft:netherite_sword");
        profile.addWeapon("minecraft:diamond_sword");
        profile.addWeapon("minecraft:iron_sword");
        profile.addWeapon("minecraft:netherite_axe");
        profile.addWeapon("minecraft:diamond_axe");
        profile.addWeapon("minecraft:iron_axe");
        profile.addWeapon("minecraft:stone_sword");
        profile.addWeapon("minecraft:wooden_sword");
        return profile;
    }
}
