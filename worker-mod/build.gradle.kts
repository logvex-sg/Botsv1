plugins {
    alias(libs.plugins.fabric.loom)
}

base {
    archivesName = "logvex-worker"
    version = libs.versions.mod.version.get()
    group = "com.logvex.worker"
}

repositories {
    maven {
        name = "meteor-maven"
        url = uri("https://maven.meteordev.org/releases")
    }
    maven {
        name = "meteor-maven-snapshots"
        url = uri("https://maven.meteordev.org/snapshots")
    }
    mavenCentral()
}

dependencies {
    minecraft(libs.minecraft)
    mappings(loom.layered { officialMojangMappings() })
    implementation(libs.fabric.loader)

    // Meteor: the worker registers a "Fleet Manager" category and drives the client through Meteor's
    // own modules (ElytraFly, pathing), so it is a Meteor addon rather than a bare Fabric mod.
    // The published Meteor POM pulls in Fabric API modules that Loom tries to process as
    // access-widener mods; the worker only needs Meteor's own classes, so exclude them.
    modImplementation(libs.meteor.client) {
        exclude(group = "net.fabricmc.fabric-api")
        exclude(group = "net.fabricmc", module = "fabric-loader")
    }

    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.launcher)
}

loom {
    // Meteor ships an access widener written in the intermediary namespace. Loom would try to
    // apply it while processing the mod jar and fail without intermediary mappings. The worker
    // only consumes Meteor's public API, so transitive access wideners are not needed.
    enableTransitiveAccessWideners.set(false)
}

tasks {
    processResources {
        val propertyMap = mapOf(
            "version" to project.version,
            "minecraft_version" to toMinecraftCompat(libs.versions.minecraft.get()),
            "jdk_version" to libs.versions.java.get(),
        )
        inputs.properties(propertyMap)
        filesMatching("fabric.mod.json") {
            expand(propertyMap)
        }
    }

    test {
        useJUnitPlatform()
        testLogging {
            events("passed", "skipped", "failed")
        }
    }

    withType<JavaCompile>().configureEach {
        options.release.set(libs.versions.java.get().toInt())
        options.compilerArgs.addAll(listOf("-Xlint:deprecation", "-Xlint:unchecked"))
    }
}

/** Mirrors the root project's Minecraft compatibility range for fabric.mod.json. */
fun toMinecraftCompat(version: String): String {
    val stable = Regex("""^(\d{2})\.([1-9]\d*)(?:\.(\d+))?$""")
    stable.matchEntire(version)?.let {
        val (year, drop, _) = it.destructured
        return "~$year.$drop"
    }
    return version
}
