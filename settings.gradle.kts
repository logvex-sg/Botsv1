pluginManagement {
    repositories {
        maven {
            name = "Fabric"
            url = uri("https://maven.fabricmc.net/")
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "logvex-hunter"

// The Worker mod is the Minecraft-side half of the Fleet Manager ecosystem: one jar dropped into a
// bot's mods folder that dials out to the desktop Host and executes a closed set of tasks. It is a
// separate Fabric mod (its own fabric.mod.json, its own release jar) built from this same checkout.
include("worker-mod")


