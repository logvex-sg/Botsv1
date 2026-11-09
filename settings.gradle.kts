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

// The Meteor addon (Hunter) is the root project. The standalone worker mod is a subproject so the
// two ship as separate jars with separate metadata.
include("worker-mod")

