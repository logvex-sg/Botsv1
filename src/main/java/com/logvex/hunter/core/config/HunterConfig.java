package com.logvex.hunter.core.config;

import com.logvex.hunter.core.store.AtomicFiles;
import com.logvex.hunter.core.util.Json;

import java.io.IOException;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The addon's top-level configuration: the master switch, the active profile, and the identity of
 * this instance.
 *
 * <p>Loading is defensive. A missing file yields defaults; a corrupt file is moved aside so the
 * next save writes a clean one, and the caller is told what happened through {@link LoadResult}.
 */
public final class HunterConfig {
    public static final int SCHEMA_VERSION = 1;

    public record LoadResult(HunterConfig config, boolean recovered, String message) {}

    private boolean enabled = true;
    private boolean emergencyStop;
    private String activeProfile = "default";
    private final Map<String, HunterProfile> profiles = new LinkedHashMap<>();

    private String instanceId = "";
    private String instanceLabel = "";
    /** Port of this instance's local control endpoint; 0 disables it. */
    private int controlPort;
    /** Secret used by other instances when they call this instance's control endpoint. */
    private String controlToken = "";
    private boolean allowRemoteControl;
    private boolean debugLogging;
    private boolean autoStartTracking = true;

    /** Whether the companion HTTP endpoint (Fleet Manager / web dashboard) runs. */
    private boolean companionEnabled;
    /** Port of the companion endpoint. */
    private int companionPort = 8720;
    /** Bearer token required by the companion endpoint; empty disables authentication. */
    private String companionToken = "";
    /** Whether the companion endpoint accepts connections from other hosts. */
    private boolean companionAllowRemote;

    // Swarm (in-game multi-client control, Meteor-Swarm style) -----------------
    /** Port the swarm host listens on when it is started. */
    private int swarmHostPort = 6969;
    /** Shared token hunters must present. Empty accepts anyone on the port. */
    private String swarmHostToken = "";
    /** Whether the swarm host accepts connections from other machines. */
    private boolean swarmHostAllowRemote;
    /** Host address the hunter connects to. */
    private String swarmHunterHost = "127.0.0.1";
    /** Port the hunter connects to. */
    private int swarmHunterPort = 6969;
    /** Whether a broadcast may change combat modules on the whole fleet. */
    private boolean swarmAllowCombatBroadcast;
    /** Whether the swarm link is restored when the client joins a world. */
    private boolean swarmAutoConnect = true;
    /** Whether this client is the host (true) or a hunter (false) by default. */
    private boolean swarmHostMode = true;

    public HunterConfig() {
        profiles.put("default", new HunterProfile("default"));
    }

    // ------------------------------------------------------------ singleton-ish access

    public static HunterConfig defaults() {
        return new HunterConfig();
    }

    // -------------------------------------------------------------- accessors

    public boolean enabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public boolean emergencyStop() {
        return emergencyStop;
    }

    public void setEmergencyStop(boolean emergencyStop) {
        this.emergencyStop = emergencyStop;
    }

    public String activeProfileName() {
        return activeProfile;
    }

    public void setActiveProfile(String name) {
        if (name != null && profiles.containsKey(name)) activeProfile = name;
    }

    public HunterProfile activeProfile() {
        HunterProfile profile = profiles.get(activeProfile);
        if (profile == null) {
            profile = profiles.computeIfAbsent("default", HunterProfile::new);
            activeProfile = "default";
        }
        return profile;
    }

    public Map<String, HunterProfile> profiles() {
        return profiles;
    }

    public HunterProfile profile(String name) {
        return profiles.get(name);
    }

    public HunterProfile createProfile(String name, boolean copyActive) {
        if (name == null || name.isBlank() || profiles.containsKey(name)) return null;
        HunterProfile profile = copyActive ? activeProfile().copy(name) : new HunterProfile(name);
        profiles.put(name, profile);
        return profile;
    }

    public boolean deleteProfile(String name) {
        if (profiles.size() <= 1 || !profiles.containsKey(name)) return false;
        profiles.remove(name);
        if (activeProfile.equals(name)) activeProfile = profiles.keySet().iterator().next();
        return true;
    }

    public String instanceId() {
        return instanceId;
    }

    public void setInstanceId(String instanceId) {
        this.instanceId = instanceId == null ? "" : instanceId;
    }

    public String instanceLabel() {
        return instanceLabel;
    }

    public void setInstanceLabel(String instanceLabel) {
        this.instanceLabel = instanceLabel == null ? "" : instanceLabel;
    }

    public int controlPort() {
        return controlPort;
    }

    public void setControlPort(int controlPort) {
        this.controlPort = Math.max(0, Math.min(65535, controlPort));
    }

    public String controlToken() {
        return controlToken;
    }

    public void setControlToken(String controlToken) {
        this.controlToken = controlToken == null ? "" : controlToken;
    }

    public boolean allowRemoteControl() {
        return allowRemoteControl;
    }

    public void setAllowRemoteControl(boolean allowRemoteControl) {
        this.allowRemoteControl = allowRemoteControl;
    }

    public boolean debugLogging() {
        return debugLogging;
    }

    public void setDebugLogging(boolean debugLogging) {
        this.debugLogging = debugLogging;
    }

    public boolean autoStartTracking() {
        return autoStartTracking;
    }

    public void setAutoStartTracking(boolean autoStartTracking) {
        this.autoStartTracking = autoStartTracking;
    }

    public boolean companionEnabled() {
        return companionEnabled;
    }

    public void setCompanionEnabled(boolean companionEnabled) {
        this.companionEnabled = companionEnabled;
    }

    public int companionPort() {
        return companionPort;
    }

    public void setCompanionPort(int companionPort) {
        this.companionPort = Math.max(1, Math.min(65535, companionPort));
    }

    public String companionToken() {
        return companionToken;
    }

    public void setCompanionToken(String companionToken) {
        this.companionToken = companionToken == null ? "" : companionToken;
    }

    public boolean companionAllowRemote() {
        return companionAllowRemote;
    }

    public void setCompanionAllowRemote(boolean companionAllowRemote) {
        this.companionAllowRemote = companionAllowRemote;
    }

    // ------------------------------------------------------------------ swarm

    public int swarmHostPort() {
        return swarmHostPort;
    }

    public void setSwarmHostPort(int swarmHostPort) {
        this.swarmHostPort = Math.max(1, Math.min(65535, swarmHostPort));
    }

    public String swarmHostToken() {
        return swarmHostToken;
    }

    public void setSwarmHostToken(String swarmHostToken) {
        this.swarmHostToken = swarmHostToken == null ? "" : swarmHostToken;
    }

    public boolean swarmHostAllowRemote() {
        return swarmHostAllowRemote;
    }

    public void setSwarmHostAllowRemote(boolean swarmHostAllowRemote) {
        this.swarmHostAllowRemote = swarmHostAllowRemote;
    }

    public String swarmHunterHost() {
        return swarmHunterHost;
    }

    public void setSwarmHunterHost(String swarmHunterHost) {
        this.swarmHunterHost = swarmHunterHost == null || swarmHunterHost.isBlank()
            ? "127.0.0.1" : swarmHunterHost.trim();
    }

    public int swarmHunterPort() {
        return swarmHunterPort;
    }

    public void setSwarmHunterPort(int swarmHunterPort) {
        this.swarmHunterPort = Math.max(1, Math.min(65535, swarmHunterPort));
    }

    public boolean swarmAllowCombatBroadcast() {
        return swarmAllowCombatBroadcast;
    }

    public void setSwarmAllowCombatBroadcast(boolean swarmAllowCombatBroadcast) {
        this.swarmAllowCombatBroadcast = swarmAllowCombatBroadcast;
    }

    public boolean swarmAutoConnect() {
        return swarmAutoConnect;
    }

    public void setSwarmAutoConnect(boolean swarmAutoConnect) {
        this.swarmAutoConnect = swarmAutoConnect;
    }

    public boolean swarmHostMode() {
        return swarmHostMode;
    }

    public void setSwarmHostMode(boolean swarmHostMode) {
        this.swarmHostMode = swarmHostMode;
    }

    // ----------------------------------------------------------- persistence

    public Map<String, Object> toJson() {
        Map<String, Object> root = Json.object();
        root.put("schema", SCHEMA_VERSION);
        root.put("enabled", enabled);
        root.put("emergencyStop", emergencyStop);
        root.put("activeProfile", activeProfile);
        root.put("instanceId", instanceId);
        root.put("instanceLabel", instanceLabel);
        root.put("controlPort", controlPort);
        root.put("controlToken", controlToken);
        root.put("allowRemoteControl", allowRemoteControl);
        root.put("debugLogging", debugLogging);
        root.put("autoStartTracking", autoStartTracking);
        root.put("companionEnabled", companionEnabled);
        root.put("companionPort", companionPort);
        root.put("companionToken", companionToken);
        root.put("companionAllowRemote", companionAllowRemote);
        root.put("swarmHostPort", swarmHostPort);
        root.put("swarmHostToken", swarmHostToken);
        root.put("swarmHostAllowRemote", swarmHostAllowRemote);
        root.put("swarmHunterHost", swarmHunterHost);
        root.put("swarmHunterPort", swarmHunterPort);
        root.put("swarmAllowCombatBroadcast", swarmAllowCombatBroadcast);
        root.put("swarmAutoConnect", swarmAutoConnect);
        root.put("swarmHostMode", swarmHostMode);
        Map<String, Object> profileMap = Json.object();
        for (Map.Entry<String, HunterProfile> entry : profiles.entrySet()) {
            profileMap.put(entry.getKey(), entry.getValue().toJson());
        }
        root.put("profiles", profileMap);
        return root;
    }

    @SuppressWarnings("unchecked")
    public static HunterConfig fromJson(Map<String, Object> root) {
        HunterConfig config = new HunterConfig();
        config.enabled = Json.getBoolean(root, "enabled", true);
        config.emergencyStop = Json.getBoolean(root, "emergencyStop", false);
        config.instanceId = Json.getString(root, "instanceId", "");
        config.instanceLabel = Json.getString(root, "instanceLabel", "");
        config.setControlPort(Json.getInt(root, "controlPort", 0));
        config.controlToken = Json.getString(root, "controlToken", "");
        config.allowRemoteControl = Json.getBoolean(root, "allowRemoteControl", false);
        config.debugLogging = Json.getBoolean(root, "debugLogging", false);
        config.autoStartTracking = Json.getBoolean(root, "autoStartTracking", true);
        config.companionEnabled = Json.getBoolean(root, "companionEnabled", false);
        config.setCompanionPort(Json.getInt(root, "companionPort", 8720));
        config.companionToken = Json.getString(root, "companionToken", "");
        config.companionAllowRemote = Json.getBoolean(root, "companionAllowRemote", false);
        config.setSwarmHostPort(Json.getInt(root, "swarmHostPort", 6969));
        config.swarmHostToken = Json.getString(root, "swarmHostToken", "");
        config.swarmHostAllowRemote = Json.getBoolean(root, "swarmHostAllowRemote", false);
        // `swarmWorker*` is the pre-rename spelling; read it so an existing config keeps its host.
        config.setSwarmHunterHost(Json.getString(root, "swarmHunterHost",
            Json.getString(root, "swarmWorkerHost", "127.0.0.1")));
        config.setSwarmHunterPort(Json.getInt(root, "swarmHunterPort",
            Json.getInt(root, "swarmWorkerPort", 6969)));
        config.swarmAllowCombatBroadcast = Json.getBoolean(root, "swarmAllowCombatBroadcast", false);
        config.swarmAutoConnect = Json.getBoolean(root, "swarmAutoConnect", true);
        config.swarmHostMode = Json.getBoolean(root, "swarmHostMode", true);

        config.profiles.clear();
        Map<String, Object> profileMap = Json.getObject(root, "profiles");
        for (Map.Entry<String, Object> entry : profileMap.entrySet()) {
            if (entry.getValue() instanceof Map<?, ?> map) {
                HunterProfile profile = HunterProfile.fromJson((Map<String, Object>) map);
                if (profile.name() == null || profile.name().isBlank()) profile.setName(entry.getKey());
                config.profiles.put(profile.name(), profile);
            }
        }
        if (config.profiles.isEmpty()) config.profiles.put("default", new HunterProfile("default"));
        String active = Json.getString(root, "activeProfile", "default");
        config.activeProfile = config.profiles.containsKey(active) ? active : config.profiles.keySet().iterator().next();
        return config;
    }

    public String toJsonText() {
        return Json.writePretty(toJson());
    }

    // ------------------------------------------------------------- file I/O

    public static LoadResult load(Path file) {
        String text = AtomicFiles.read(file);
        if (text == null || text.isBlank()) {
            return new LoadResult(new HunterConfig(), false, "no configuration found, defaults created");
        }
        try {
            Map<String, Object> root = Json.parseObject(text);
            return new LoadResult(fromJson(root), false, "configuration loaded");
        } catch (RuntimeException e) {
            // Keep the corrupt file for inspection instead of silently discarding it.
            try {
                AtomicFiles.backup(file);
            } catch (IOException ignored) {
                // the backup is best effort
            }
            HunterConfig fresh = new HunterConfig();
            try {
                AtomicFiles.write(file, fresh.toJsonText());
            } catch (IOException ignored) {
                // a later save will retry
            }
            return new LoadResult(fresh, true, "configuration was corrupt and has been reset: " + e.getMessage());
        }
    }

    public void save(Path file) throws IOException {
        AtomicFiles.write(file, toJsonText());
    }
}
