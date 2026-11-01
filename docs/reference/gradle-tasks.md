# Gradle Tasks Reference

Every custom Gradle task registered by this repository: its name, group, what it
does, what it is ordered against, and which files it touches on disk.

**Audience:** agent or maintainer running a build, or changing build logic
**Prereqs:** [build and release architecture](../architecture/build-and-release.md)

---

## Summary

- Six custom tasks exist: five in `app/PXTasks.gradle.kts` plus `clean` in the
  root `build.gradle.kts`.
- All five tasks from `app/PXTasks.gradle.kts` are in the group `pixelxpert`.
- `buildCanary` and `buildStable` have no action. They are ordering declarations
  that `finalizedBy` three other tasks each.
- `incrementCanaryVersion` and `incrementStableVersion` are the only tasks that
  write source files.
- `createZip` has `mustRunAfter` and **no** `dependsOn`. It packages whatever
  APK is already on disk.
- Nothing here is wired into `assemble` or `build`. `./gradlew build` does not
  produce a Magisk zip and does not touch `version.properties`.

---

## Model

### Task inventory

| Task | Group | Type | Declared in |
| --- | --- | --- | --- |
| `clean` | none | `Delete` | `build.gradle.kts` (root) |
| `buildCanary` | `pixelxpert` | plain `Task` | `app/PXTasks.gradle.kts` |
| `buildStable` | `pixelxpert` | plain `Task` | `app/PXTasks.gradle.kts` |
| `incrementCanaryVersion` | `pixelxpert` | `IncrementVersionTask` | `app/PXTasks.gradle.kts` |
| `incrementStableVersion` | `pixelxpert` | `IncrementVersionTask` | `app/PXTasks.gradle.kts` |
| `createZip` | `pixelxpert` | `Zip` | `app/PXTasks.gradle.kts` |

All five `pixelxpert` tasks are registered in `:app`, because
`app/build.gradle.kts` line 15 applies the script:

```kotlin
apply(from = rootProject.file("app/PXTasks.gradle.kts"))
```

They are therefore invoked as `:app:buildCanary`, `:app:createZip`, and so on.
Gradle's task-name abbreviation also works: `./gradlew buildCanary` resolves to
the single match in `:app`.

There is no `assembleCanary`, `assembleStable`, `buildXposed`, `buildFull`, or
`bundleCanary`. If a command with one of those names appears in a script or an
issue, it is wrong.

### Ordering model

```text
buildCanary ──finalizedBy──> incrementCanaryVersion
            ──finalizedBy──> assembleRelease
            ──finalizedBy──> createZip

buildStable ──finalizedBy──> incrementStableVersion
            ──finalizedBy──> assembleRelease
            ──finalizedBy──> createZip

createZip   ──mustRunAfter──> incrementCanaryVersion
            ──mustRunAfter──> incrementStableVersion
            ──mustRunAfter──> assembleRelease
```

Three properties of this graph matter:

1. **`finalizedBy` is not `dependsOn`.** The finalizers run after the finalized
   task, even if it fails. `buildCanary` has no action, so it always succeeds and
   the finalizers always run.
2. **`finalizedBy` order is not a hard sequence between siblings.** Gradle runs
   finalizers after the finalized task, but the relative order of multiple
   finalizers is only guaranteed where an explicit `mustRunAfter` exists. That is
   exactly what `createZip`'s three `mustRunAfter` declarations provide.
3. **`createZip` has no `dependsOn`.** Run alone, it zips whatever is in
   `app/build/outputs/apk/release/` — possibly nothing.

### Task-by-task

#### `clean`

```kotlin
tasks {
    register("clean", Delete::class) {
        delete(project.layout.buildDirectory)
    }
}
```

Group: unset. Deletes the root project's build directory only —
`<repo>/build/`. It does **not** delete `app/build/`, `modPackProcessor/build/`,
`output/`, or `~/.gradle`.

This overrides the `clean` task the Gradle base plugin would otherwise provide.
Because the root project applies no plugins, there is no base `clean` to override;
this is the only one.

#### `buildCanary`

```kotlin
tasks.register("buildCanary") {
    group = taskGroup
    description = "Builds a Canary APK with count-based versioning"
    finalizedBy("incrementCanaryVersion")
        .finalizedBy("assembleRelease")
        .finalizedBy("createZip")
}
```

No action. Side effects are entirely those of its finalizers. Requires
`-Pchannel=canary` for the version name to be `canary-<code>`; without it,
`channel` is unset, `isStableProvider` is `false`, and the canary path is taken
anyway. The property is documentation, not a switch.

#### `buildStable`

```kotlin
tasks.register("buildStable") {
    group = taskGroup
    description = "Builds a Stable APK with Git Tag versioning"
    finalizedBy("incrementStableVersion")
        .finalizedBy("assembleRelease")
        .finalizedBy("createZip")
}
```

No action. Always pass `-Pchannel=stable -PversionName=<tag>`. Without
`-Pchannel=stable` the stable path is not taken at all and the build produces a
canary version. Without `-PversionName`, the version name comes from
`git describe --tags --match=v* --abbrev=0 HEAD`.

#### `incrementCanaryVersion`

```kotlin
tasks.register<IncrementVersionTask>("incrementCanaryVersion") {
    group = taskGroup
    description = "Increments the canary version and saves it to the related files"
    versionFile.set(rootProject.file("version.properties"))
    stable.set(false)
    filesToUpdate.from(
        rootProject.file("MagiskModBase/module.prop"),
        rootProject.file("latestCanary.json"),
        rootProject.file("MagiskModuleUpdate_Xposed.json"),
        rootProject.file("MagiskModuleUpdate_Full.json"),
    )
    targetVersionName.set(getVersionName())
}
```

Reads `CANARY_VERSION_CODE`, adds 1, and writes:

| File | Fields written |
| --- | --- |
| `version.properties` | `CANARY_VERSION_CODE`, `CANARY_VERSION_NAME` |
| `MagiskModBase/module.prop` | `version`, `versionCode` |
| `latestCanary.json` | `version`, `versionCode`, `zipUrl_Xposed`, `zipUrl` |
| `MagiskModuleUpdate_Xposed.json` | `version`, `versionCode`, `zipUrl_Xposed`, `zipUrl` |
| `MagiskModuleUpdate_Full.json` | `version`, `versionCode`, `zipUrl_Xposed`, `zipUrl` |

The URL written is always:

```text
https://github.com/Codecity001/PixelXpert/releases/download/<versionName>/PixelXpertFork-<versionName>.zip
```

`targetVersionName` is `getVersionName()`, evaluated at configuration time. Under
`-Pchannel=canary` that is `canary-<code>`, matching what the APK will report.
Under no `channel` property it is also `canary-<code>`. Under
`-Pchannel=stable` it would be a stable name, but this task is only reached
through `buildCanary`.

`IncrementVersionTask` declares `versionFile` as `@InputFile` and `filesToUpdate`
as `@OutputFiles`. Missing files in `filesToUpdate` are skipped silently by
`bumpFileStandalone` (`if (!file.exists()) return`).

#### `incrementStableVersion`

```kotlin
tasks.register<IncrementVersionTask>("incrementStableVersion") {
    group = taskGroup
    description = "Increments the stable version and saves it to the related files"
    versionFile.set(rootProject.file("version.properties"))
    stable.set(true)
    filesToUpdate.from(
        rootProject.file("MagiskModBase/module.prop"),
        rootProject.file("latestStable.json"),
        rootProject.file("latestVersion.json"),
        rootProject.file("MagiskModuleUpdate_Full.json"),
        rootProject.file("MagiskModuleUpdate_Xposed.json"),
    )
    targetVersionName.set(getVersionName())
}
```

Despite the name and description, it **does not increment**. The stable branch of
`incrementVersionLogic` reads `STABLE_VERSION_CODE` and writes it back unchanged:

```kotlin
val code = (props.getProperty("STABLE_VERSION_CODE") ?: props.getProperty("VERSION_CODE", "600")).toInt()
// ...
updateVersionProperties(vFile, mapOf(
    "STABLE_VERSION_CODE" to code.toString(),
    "STABLE_VERSION_NAME" to versionName,
))
```

Files written:

| File | Fields written | Note |
| --- | --- | --- |
| `version.properties` | `STABLE_VERSION_CODE` (unchanged), `STABLE_VERSION_NAME` | |
| `MagiskModBase/module.prop` | `version`, `versionCode` | |
| `latestStable.json` | `version`, `versionCode`, `zipUrl_Xposed`, `zipUrl` | Absent on `canary`; skipped |
| `latestVersion.json` | same | |
| `MagiskModuleUpdate_Full.json` | same | |
| `MagiskModuleUpdate_Xposed.json` | same | |

Bump `STABLE_VERSION_CODE` by hand before running this task for a real release.

#### `createZip`

```kotlin
tasks.register<Zip>("createZip") {
    group = taskGroup
    description = "Creates the final Magisk module file"
    mustRunAfter("incrementCanaryVersion")
    mustRunAfter("incrementStableVersion")
    mustRunAfter("assembleRelease")
    from(file("../MagiskModBase"))
    from(file("build/outputs/apk/release/PixelXpert.apk")) { into("") }
    destinationDirectory.set(file("../output"))
    archiveFileName.set(getVersionNameProvider().map { "PixelXpertFork-$it.zip" })
}
```

| Property | Value |
| --- | --- |
| Source tree | `MagiskModBase/` (repo root) |
| Extra content | `app/build/outputs/apk/release/PixelXpert.apk`, placed at the zip root |
| Output directory | `output/` (repo root) |
| Archive name | `PixelXpertFork-<versionName>.zip` |
| Depends on | nothing |
| Ordered after | `incrementCanaryVersion`, `incrementStableVersion`, `assembleRelease` |

`file(...)` inside a task registered in `:app` resolves against `:app`'s project
directory, so `../MagiskModBase` and `../output` are the repo-root paths.

The archive name comes from `getVersionNameProvider()`, a lazy `Provider`, so the
name reflects the version after `incrementCanaryVersion` has run — but only
because `mustRunAfter` forces the ordering. If you invoke `createZip` alone, the
name reflects `version.properties` as it is on disk.

`from(file(...))` does not fail on a missing file. If
`app/build/outputs/apk/release/PixelXpert.apk` does not exist, `createZip`
succeeds and produces a zip containing only the `MagiskModBase/` contents.
`MagiskModBase/customize.sh` then prints `! APK not found in zip!` at install
time on the device. There is no build-time warning.

### Non-custom build tasks worth knowing

These come from AGP and are not registered by this repository, but they are the
ones you actually invoke.

| Task | Produces | Notes |
| --- | --- | --- |
| `assembleDebug` | `app/build/outputs/apk/debug/PixelXpert.apk` | Renamed by the `whenTaskAdded` hook in `app/build.gradle.kts` |
| `assembleRelease` | `app/build/outputs/apk/release/PixelXpert.apk` | Same rename; R8 minify and resource shrink enabled |
| `build` | `assemble` + `check` | `check` has no tests to run; there are no `test` or `androidTest` source sets |
| `kspDebugKotlin`, `kspReleaseKotlin` | `app/build/generated/ksp/<variant>/kotlin/sh/siava/pixelxpert/xposed/ModPacks.kt` | Runs `:modPackProcessor` |
| `lint`, `lintDebug`, `lintRelease` | `app/build/reports/lint-results*.html` | AGP default; no custom lint config in the repo |

### The APK rename hook

`app/build.gradle.kts` has two non-task hooks that change the APK filename:

```kotlin
tasks.named("preBuild").get().doLast {
    try {
        artifactDir.get().asFile.listFiles()
            ?.filter { it.name == apkName }
            ?.forEach { it.delete() }
    } catch (_: Throwable) { }
}

tasks.whenTaskAdded {
    if (name.lowercase() == "assemble${variant.name.lowercase()}") {
        doLast {
            artifactDir.get().asFile.listFiles()
                ?.filter { it.extension == "apk" && it.name != apkName }
                ?.forEach { it.renameTo(File(it.parent, apkName)) }
        }
    }
}
```

`apkName` is the literal `"PixelXpert.apk"`. Both blocks run once per variant,
because they are inside `onVariants { }`. `preBuild` gets a `doLast` per variant,
so with two variants the deletion action is registered twice; it is idempotent.

`renameTo` returns a `Boolean` that is discarded. A failed rename leaves the
original `app-release.apk` in place and no error is reported.

---

## Contracts

| Contract | Consequence of breaking it |
| --- | --- |
| Do not add `dependsOn` to `createZip` without re-checking `mustRunAfter` | Ordering may be satisfied twice or a cycle may be introduced |
| Do not rely on `incrementStableVersion` to bump `STABLE_VERSION_CODE` | It writes the value back unchanged |
| Do not run `createZip` without a preceding `assembleRelease` | The zip ships without an APK; the failure appears on a device, not in the build |
| Do not add a task named `clean` elsewhere | The root `clean` deletes only `<repo>/build`; a second one would shadow it |
| Do not expect `./gradlew build` to produce a zip | `createZip` is not attached to `build` or `assemble` |
| Keep the APK filename `PixelXpert.apk` | `createZip`'s `from(...)` and `customize.sh` both hard-code it |

---

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `output/` does not exist after `./gradlew build` | `createZip` is not part of `build` | Run `./gradlew buildCanary` or `./gradlew assembleRelease createZip` |
| `Task 'assembleCanary' not found` | No such variant exists; there are no product flavors | Use `assembleRelease` with `-Pchannel=canary`, or `buildCanary` |
| `output/PixelXpertFork-*.zip` has no APK | `createZip` ran without a fresh `assembleRelease`; `mustRunAfter` does not imply `dependsOn` | Run both in one invocation |
| Zip filename carries an unexpected version | `createZip` invoked alone, so `getVersionNameProvider()` read `version.properties` before any bump | Run it through `buildCanary` / `buildStable` |
| `version.properties` changed when you only wanted an APK | `buildCanary` / `buildStable` finalize the increment tasks | Use `assembleDebug` or `assembleRelease` |
| `./gradlew clean` leaves `app/build/` in place | Root `clean` deletes only the root build directory | Delete `app/build/` and `modpackprocessor/build/` manually, or use `./gradlew :app:clean` |
| `latestStable.json` was not updated | The file does not exist on `canary`; `bumpFileStandalone` returns early | Expected on `canary`; the stable branch has the file |
| `STABLE_VERSION_CODE` unchanged after `incrementStableVersion` | By design: the stable path never increments | Bump it by hand |
| APK is `app-release.apk` instead of `PixelXpert.apk` | The `whenTaskAdded` rename hook did not fire for that variant, or `renameTo` failed silently | Check `app/build.gradle.kts` `androidComponents.onVariants`; run the task by its exact `assemble<variant>` name |
| Task runs twice, or a cycle error at configuration | A `dependsOn` was added between `createZip` and `assembleRelease` | Remove it; ordering is expressed with `mustRunAfter` |

---

## Checklist

- [ ] I know whether the task I am running writes files (`incrementCanaryVersion`,
      `incrementStableVersion`) or only reads them
- [ ] If I want a Magisk zip, I ran a task that reaches `createZip` **and** a task
      that reaches `assembleRelease`
- [ ] If I ran `buildStable`, I checked `STABLE_VERSION_CODE` in
      `version.properties` was already bumped
- [ ] I did not commit `version.properties`, `MagiskModBase/module.prop`, or the
      update JSON files changed by a local build
- [ ] I confirmed `app/build/outputs/apk/release/PixelXpert.apk` exists before
      trusting the zip

---

## See also

- [Build and release architecture](../architecture/build-and-release.md)
- [Build locally](../guides/build-locally.md)
- [Release process](../guides/release-process.md)
- [Repository map](../agent/REPO_MAP.md)
- [Risk register](../analysis/risk-register.md)
