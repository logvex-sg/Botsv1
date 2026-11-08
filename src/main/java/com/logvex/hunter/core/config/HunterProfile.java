package com.logvex.hunter.core.config;

import com.logvex.hunter.core.equipment.EquipmentProfile;
import com.logvex.hunter.core.target.SortMode;
import com.logvex.hunter.core.target.TargetFilterSettings;
import com.logvex.hunter.core.util.Json;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * A reusable bundle of settings covering detection, equipment, combat compatibility, notifications
 * and tracking. Profiles let the user keep separate configurations for different servers or roles.
 */
public final class HunterProfile {
    private String name;

    // detection
    private double range = 64;
    private int scanIntervalTicks = 10;
    private boolean ignoreNaked = false;
    private int nakedArmorThreshold = 0;
    private boolean requireWeapon = false;
    private boolean ignoreInvisible = true;
    private boolean ignoreCreative = true;
    private boolean onlyTracked = false;

    // tracking
    private SortMode sortMode = SortMode.PRIORITY;
    private boolean autoSelect = true;
    private int maxCandidates = 8;
    private int switchCooldownSeconds = 3;
    private int historySize = 50;
    private boolean protectFriends = true;
    private boolean protectIgnored = true;

    // combat compatibility
    private boolean manageKillAura = true;
    private boolean manageAutoWeapon = true;
    private boolean manageAutoTotem = true;
    private boolean manageAutoArmor = true;
    private boolean manageAutoEat = true;
    private boolean avoidConflicts = true;
    private boolean emergencyDisableOnDeath = false;

    // notifications
    private boolean notifyOnDetect = true;
    private boolean notifyOnDisappear = true;
    private boolean notifyOnReappear = true;
    private boolean notifyOnElimination = false;
    private boolean chatPrefixEnabled = true;
    private int notificationCooldownSeconds = 5;

    // equipment
    private final List<EquipmentProfile> equipmentProfiles = new ArrayList<>();
    private String activeEquipmentProfile = "default";

    public HunterProfile(String name) {
        this.name = name;
        equipmentProfiles.add(EquipmentProfile.defaults("default"));
    }

    public String name() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    /** Builds the filter settings the selector consumes. */
    public TargetFilterSettings toFilterSettings() {
        TargetFilterSettings filters = new TargetFilterSettings();
        filters.range = range;
        filters.ignoreNaked = ignoreNaked;
        filters.nakedArmorThreshold = nakedArmorThreshold;
        filters.requireWeapon = requireWeapon;
        filters.ignoreInvisible = ignoreInvisible;
        filters.ignoreCreative = ignoreCreative;
        filters.onlyTracked = onlyTracked;
        filters.protectFriends = protectFriends;
        filters.protectIgnored = protectIgnored;
        return filters;
    }

    public EquipmentProfile equipmentProfile() {
        for (EquipmentProfile profile : equipmentProfiles) {
            if (profile.name().equals(activeEquipmentProfile)) return profile;
        }
        if (equipmentProfiles.isEmpty()) equipmentProfiles.add(EquipmentProfile.defaults("default"));
        return equipmentProfiles.get(0);
    }

    public List<EquipmentProfile> equipmentProfiles() {
        return equipmentProfiles;
    }

    public void setActiveEquipmentProfile(String name) {
        if (name != null && equipmentProfiles.stream().anyMatch(p -> p.name().equals(name))) {
            activeEquipmentProfile = name;
        }
    }

    // ------------------------------------------------------------- accessors

    public double range() {
        return range;
    }

    public void setRange(double range) {
        this.range = Math.max(1, Math.min(256, range));
    }

    public int scanIntervalTicks() {
        return scanIntervalTicks;
    }

    public void setScanIntervalTicks(int scanIntervalTicks) {
        this.scanIntervalTicks = Math.max(1, Math.min(200, scanIntervalTicks));
    }

    public boolean ignoreNaked() {
        return ignoreNaked;
    }

    public void setIgnoreNaked(boolean ignoreNaked) {
        this.ignoreNaked = ignoreNaked;
    }

    public int nakedArmorThreshold() {
        return nakedArmorThreshold;
    }

    public void setNakedArmorThreshold(int nakedArmorThreshold) {
        this.nakedArmorThreshold = Math.max(0, nakedArmorThreshold);
    }

    public boolean requireWeapon() {
        return requireWeapon;
    }

    public void setRequireWeapon(boolean requireWeapon) {
        this.requireWeapon = requireWeapon;
    }

    public boolean ignoreInvisible() {
        return ignoreInvisible;
    }

    public void setIgnoreInvisible(boolean ignoreInvisible) {
        this.ignoreInvisible = ignoreInvisible;
    }

    public boolean ignoreCreative() {
        return ignoreCreative;
    }

    public void setIgnoreCreative(boolean ignoreCreative) {
        this.ignoreCreative = ignoreCreative;
    }

    public boolean onlyTracked() {
        return onlyTracked;
    }

    public void setOnlyTracked(boolean onlyTracked) {
        this.onlyTracked = onlyTracked;
    }

    public SortMode sortMode() {
        return sortMode;
    }

    public void setSortMode(SortMode sortMode) {
        this.sortMode = sortMode == null ? SortMode.PRIORITY : sortMode;
    }

    public boolean autoSelect() {
        return autoSelect;
    }

    public void setAutoSelect(boolean autoSelect) {
        this.autoSelect = autoSelect;
    }

    public int maxCandidates() {
        return maxCandidates;
    }

    public void setMaxCandidates(int maxCandidates) {
        this.maxCandidates = Math.max(1, Math.min(64, maxCandidates));
    }

    public int switchCooldownSeconds() {
        return switchCooldownSeconds;
    }

    public void setSwitchCooldownSeconds(int switchCooldownSeconds) {
        this.switchCooldownSeconds = Math.max(0, switchCooldownSeconds);
    }

    public int historySize() {
        return historySize;
    }

    public void setHistorySize(int historySize) {
        this.historySize = Math.max(0, Math.min(500, historySize));
    }

    public boolean protectFriends() {
        return protectFriends;
    }

    public void setProtectFriends(boolean protectFriends) {
        this.protectFriends = protectFriends;
    }

    public boolean protectIgnored() {
        return protectIgnored;
    }

    public void setProtectIgnored(boolean protectIgnored) {
        this.protectIgnored = protectIgnored;
    }

    public boolean manageKillAura() {
        return manageKillAura;
    }

    public void setManageKillAura(boolean manageKillAura) {
        this.manageKillAura = manageKillAura;
    }

    public boolean manageAutoWeapon() {
        return manageAutoWeapon;
    }

    public void setManageAutoWeapon(boolean manageAutoWeapon) {
        this.manageAutoWeapon = manageAutoWeapon;
    }

    public boolean manageAutoTotem() {
        return manageAutoTotem;
    }

    public void setManageAutoTotem(boolean manageAutoTotem) {
        this.manageAutoTotem = manageAutoTotem;
    }

    public boolean manageAutoArmor() {
        return manageAutoArmor;
    }

    public void setManageAutoArmor(boolean manageAutoArmor) {
        this.manageAutoArmor = manageAutoArmor;
    }

    public boolean manageAutoEat() {
        return manageAutoEat;
    }

    public void setManageAutoEat(boolean manageAutoEat) {
        this.manageAutoEat = manageAutoEat;
    }

    public boolean avoidConflicts() {
        return avoidConflicts;
    }

    public void setAvoidConflicts(boolean avoidConflicts) {
        this.avoidConflicts = avoidConflicts;
    }

    public boolean emergencyDisableOnDeath() {
        return emergencyDisableOnDeath;
    }

    public void setEmergencyDisableOnDeath(boolean emergencyDisableOnDeath) {
        this.emergencyDisableOnDeath = emergencyDisableOnDeath;
    }

    public boolean notifyOnDetect() {
        return notifyOnDetect;
    }

    public void setNotifyOnDetect(boolean notifyOnDetect) {
        this.notifyOnDetect = notifyOnDetect;
    }

    public boolean notifyOnDisappear() {
        return notifyOnDisappear;
    }

    public void setNotifyOnDisappear(boolean notifyOnDisappear) {
        this.notifyOnDisappear = notifyOnDisappear;
    }

    public boolean notifyOnReappear() {
        return notifyOnReappear;
    }

    public void setNotifyOnReappear(boolean notifyOnReappear) {
        this.notifyOnReappear = notifyOnReappear;
    }

    public boolean notifyOnElimination() {
        return notifyOnElimination;
    }

    public void setNotifyOnElimination(boolean notifyOnElimination) {
        this.notifyOnElimination = notifyOnElimination;
    }

    public boolean chatPrefixEnabled() {
        return chatPrefixEnabled;
    }

    public void setChatPrefixEnabled(boolean chatPrefixEnabled) {
        this.chatPrefixEnabled = chatPrefixEnabled;
    }

    public int notificationCooldownSeconds() {
        return notificationCooldownSeconds;
    }

    public void setNotificationCooldownSeconds(int notificationCooldownSeconds) {
        this.notificationCooldownSeconds = Math.max(0, notificationCooldownSeconds);
    }

    // ----------------------------------------------------------- persistence

    public Map<String, Object> toJson() {
        Map<String, Object> map = Json.object();
        map.put("name", name);
        map.put("range", range);
        map.put("scanIntervalTicks", scanIntervalTicks);
        map.put("ignoreNaked", ignoreNaked);
        map.put("nakedArmorThreshold", nakedArmorThreshold);
        map.put("requireWeapon", requireWeapon);
        map.put("ignoreInvisible", ignoreInvisible);
        map.put("ignoreCreative", ignoreCreative);
        map.put("onlyTracked", onlyTracked);
        map.put("sortMode", sortMode.name().toLowerCase(java.util.Locale.ROOT));
        map.put("autoSelect", autoSelect);
        map.put("maxCandidates", maxCandidates);
        map.put("switchCooldownSeconds", switchCooldownSeconds);
        map.put("historySize", historySize);
        map.put("protectFriends", protectFriends);
        map.put("protectIgnored", protectIgnored);
        map.put("manageKillAura", manageKillAura);
        map.put("manageAutoWeapon", manageAutoWeapon);
        map.put("manageAutoTotem", manageAutoTotem);
        map.put("manageAutoArmor", manageAutoArmor);
        map.put("manageAutoEat", manageAutoEat);
        map.put("avoidConflicts", avoidConflicts);
        map.put("emergencyDisableOnDeath", emergencyDisableOnDeath);
        map.put("notifyOnDetect", notifyOnDetect);
        map.put("notifyOnDisappear", notifyOnDisappear);
        map.put("notifyOnReappear", notifyOnReappear);
        map.put("notifyOnElimination", notifyOnElimination);
        map.put("chatPrefixEnabled", chatPrefixEnabled);
        map.put("notificationCooldownSeconds", notificationCooldownSeconds);
        map.put("activeEquipmentProfile", activeEquipmentProfile);
        List<Object> equipment = new ArrayList<>();
        for (EquipmentProfile profile : equipmentProfiles) equipment.add(profile.toJson());
        map.put("equipmentProfiles", equipment);
        return map;
    }

    public static HunterProfile fromJson(Map<String, Object> map) {
        HunterProfile profile = new HunterProfile(Json.getString(map, "name", "default"));
        profile.setRange(Json.getDouble(map, "range", 64));
        profile.setScanIntervalTicks(Json.getInt(map, "scanIntervalTicks", 10));
        profile.setIgnoreNaked(Json.getBoolean(map, "ignoreNaked", false));
        profile.setNakedArmorThreshold(Json.getInt(map, "nakedArmorThreshold", 0));
        profile.setRequireWeapon(Json.getBoolean(map, "requireWeapon", false));
        profile.setIgnoreInvisible(Json.getBoolean(map, "ignoreInvisible", true));
        profile.setIgnoreCreative(Json.getBoolean(map, "ignoreCreative", true));
        profile.setOnlyTracked(Json.getBoolean(map, "onlyTracked", false));
        profile.setSortMode(parseSort(Json.getString(map, "sortMode", "priority")));
        profile.setAutoSelect(Json.getBoolean(map, "autoSelect", true));
        profile.setMaxCandidates(Json.getInt(map, "maxCandidates", 8));
        profile.setSwitchCooldownSeconds(Json.getInt(map, "switchCooldownSeconds", 3));
        profile.setHistorySize(Json.getInt(map, "historySize", 50));
        profile.setProtectFriends(Json.getBoolean(map, "protectFriends", true));
        profile.setProtectIgnored(Json.getBoolean(map, "protectIgnored", true));
        profile.setManageKillAura(Json.getBoolean(map, "manageKillAura", true));
        profile.setManageAutoWeapon(Json.getBoolean(map, "manageAutoWeapon", true));
        profile.setManageAutoTotem(Json.getBoolean(map, "manageAutoTotem", true));
        profile.setManageAutoArmor(Json.getBoolean(map, "manageAutoArmor", true));
        profile.setManageAutoEat(Json.getBoolean(map, "manageAutoEat", true));
        profile.setAvoidConflicts(Json.getBoolean(map, "avoidConflicts", true));
        profile.setEmergencyDisableOnDeath(Json.getBoolean(map, "emergencyDisableOnDeath", false));
        profile.setNotifyOnDetect(Json.getBoolean(map, "notifyOnDetect", true));
        profile.setNotifyOnDisappear(Json.getBoolean(map, "notifyOnDisappear", true));
        profile.setNotifyOnReappear(Json.getBoolean(map, "notifyOnReappear", true));
        profile.setNotifyOnElimination(Json.getBoolean(map, "notifyOnElimination", false));
        profile.setChatPrefixEnabled(Json.getBoolean(map, "chatPrefixEnabled", true));
        profile.setNotificationCooldownSeconds(Json.getInt(map, "notificationCooldownSeconds", 5));

        List<EquipmentProfile> equipment = new ArrayList<>();
        for (Object raw : Json.getArray(map, "equipmentProfiles")) {
            if (raw instanceof Map<?, ?> m) {
                @SuppressWarnings("unchecked")
                Map<String, Object> equipmentJson = (Map<String, Object>) m;
                equipment.add(EquipmentProfile.fromJson(equipmentJson));
            }
        }
        if (equipment.isEmpty()) equipment.add(EquipmentProfile.defaults("default"));
        profile.equipmentProfiles.clear();
        profile.equipmentProfiles.addAll(equipment);
        profile.setActiveEquipmentProfile(Json.getString(map, "activeEquipmentProfile", "default"));
        return profile;
    }

    public static SortMode parseSort(String value) {
        if (value == null) return SortMode.PRIORITY;
        for (SortMode mode : SortMode.values()) {
            if (mode.name().equalsIgnoreCase(value)) return mode;
        }
        return SortMode.PRIORITY;
    }

    public HunterProfile copy(String newName) {
        return fromJson(toJson()).renamed(newName);
    }

    private HunterProfile renamed(String newName) {
        this.name = newName;
        return this;
    }
}
