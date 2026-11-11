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

// One mod. The Hunter features and the Fleet Worker live in this single source set and ship as one
// jar; the only other artifact is the Fleet Manager controller (the `host/` desktop app).
rootProject.name = "logvex-hunter"
