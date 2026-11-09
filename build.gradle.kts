plugins {
    alias(libs.plugins.fabric.loom)
}

val archivesBaseName = providers.gradleProperty("archives_base_name").get()
val mavenGroup = providers.gradleProperty("maven_group").get()

// Fabric Loom 1.18 requires a Java 25 runtime, and the Gradle daemon resolves the Loom plugin in
// the JVM that runs Gradle — a toolchain does not help here. So the *build* must run on JDK 25.
// The *mod* is separately compiled to Java 21 bytecode (see options.release below), which is the
// runtime Minecraft 1.21.11 and Meteor 1.21.11-SNAPSHOT use.
require(JavaVersion.current().isCompatibleWith(JavaVersion.VERSION_25)) {
    "Logvex Hunter must be built with JDK 25 or newer: Fabric Loom 1.18 requires a Java 25 " +
        "runtime, resolved in the JVM that runs Gradle. Point JAVA_HOME at a JDK 25 installation " +
        "and re-run ./gradlew (found ${JavaVersion.current()}). The mod itself is compiled to " +
        "Java 21 bytecode and runs on Java 21."
}

base {
    archivesName = archivesBaseName
    version = libs.versions.mod.version.get()
    group = mavenGroup
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
    // Fabric
    minecraft(libs.minecraft)
    mappings(loom.layered { officialMojangMappings() })
    implementation(libs.fabric.loader)

    // Meteor
    // The published Meteor POM pulls in Fabric API modules that Loom tries to process as
    // access-widener mods; the addon only needs Meteor's own classes, so exclude them.
    modImplementation(libs.meteor.client) {
        exclude(group = "net.fabricmc.fabric-api")
        exclude(group = "net.fabricmc", module = "fabric-loader")
    }

    // Testing
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.launcher)
}

java {
    // No toolchain: the build runs on the JDK that runs Gradle (must be 25+, see the require()
    // above, because Loom 1.18 needs a Java 25 runtime). The mod is compiled *for* Java 21 via
    // options.release below, so the produced jar loads on a stock Java 21 Minecraft 1.21.11.
}

loom {
    // Meteor ships an access widener written in the intermediary namespace. Loom would try to
    // apply it while processing the mod jar and fail without intermediary mappings. The addon
    // only consumes Meteor's public API, so transitive access wideners are not needed.
    enableTransitiveAccessWideners.set(false)
}

fun toMinecraftCompat(version: String): String {
    val stable = Regex("""^(\d{2})\.([1-9]\d*)(?:\.(\d+))?$""")

    stable.matchEntire(version)?.let {
        val (year, drop, _) = it.destructured
        return "~$year.$drop"
    }

    return version
}

tasks {
    processResources {
        val propertyMap = mapOf(
            "version" to project.version,
            "minecraft_version" to toMinecraftCompat(libs.versions.minecraft.get()),
            // Declared runtime requirement: the mod's bytecode targets this level.
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

    jar {
        inputs.property("archivesName", archivesBaseName)
        val licenseName = "LICENSE_$archivesBaseName"

        from("LICENSE") {
            rename("LICENSE", licenseName)
        }
    }

    withType<JavaCompile>().configureEach {
        // Emit Java 21 bytecode so the mod loads on the Java 21 runtime Minecraft 1.21.11 uses,
        // regardless of which (newer) JDK runs the build.
        options.release.set(libs.versions.java.get().toInt())
        options.compilerArgs.addAll(
            listOf(
                "-Xlint:deprecation",
                "-Xlint:unchecked"
            )
        )
    }
}


