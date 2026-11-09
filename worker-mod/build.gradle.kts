plugins {
    alias(libs.plugins.fabric.loom)
}

base {
    archivesName = "logvex-worker"
    version = libs.versions.mod.version.get()
    group = "com.logvex.worker"
}

repositories {
    mavenCentral()
}

dependencies {
    minecraft(libs.minecraft)
    mappings(loom.layered { officialMojangMappings() })
    implementation(libs.fabric.loader)

    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.launcher)
}

loom {
    // No Meteor and no Fabric API: the worker only needs the game classes and the loader. The tick
    // hook is a mixin so that no Fabric API dependency is required.
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
