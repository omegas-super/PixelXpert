# Build Locally

How to install a toolchain that can build this repository, the exact commands to
run, where the artifacts land, and what every failure looks like. Read this
before running `./gradlew` for the first time.

**Audience:** contributor or agent about to compile the module
**Prereqs:** [build and release architecture](../architecture/build-and-release.md)

---

## Summary

- This checkout has **no JDK, no Android SDK, and no Gradle cache**. `java
  -version` fails with `CommandNotFoundException`; `./gradlew` cannot start.
- You need JDK 21 (CI uses temurin 21), Android SDK platform 37, and a matching
  build-tools; set `ANDROID_HOME` and `JAVA_HOME`.
- The Gradle wrapper is Gradle 9.3.1 and downloads itself on first run, so the
  first build needs network access.
- `assembleDebug` and `assembleRelease` build an APK. `buildCanary` and
  `buildStable` additionally mutate version files and produce a Magisk zip.
- Artifacts land at `app/build/outputs/apk/<buildType>/PixelXpert.apk` and
  `output/PixelXpertFork-<versionName>.zip`.
- There are no unit tests. `./gradlew build` runs `assemble` plus `check`; `check`
  has nothing to run.

---

## Model

### What the build needs

| Requirement | Exact value | Read from |
| --- | --- | --- |
| JDK | 21 | CI: `java-version: '21'`, `distribution: 'temurin'` in all five build workflows |
| Gradle | 9.3.1 | `gradle/wrapper/gradle-wrapper.properties` `distributionUrl` |
| Android Gradle Plugin | 9.1.0 | `gradle/libs.versions.toml` `agp` |
| Kotlin | 2.2.21 | `gradle/libs.versions.toml` `kotlin` |
| KSP | 2.3.6 | `gradle/libs.versions.toml` `ksp` |
| `compileSdk` | 37 | `app/build.gradle.kts` |
| `minSdk` / `targetSdk` | 37 / 37 | `app/build.gradle.kts` |
| `abiFilters` | `arm64-v8a` | `app/build.gradle.kts` |
| JVM bytecode target | 17 | `app/build.gradle.kts` `kotlin.compilerOptions.jvmTarget` |
| `ANDROID_HOME` or `local.properties` `sdk.dir` | path to the SDK | AGP convention; `local.properties` is gitignored |

`buildToolsVersion` is not pinned in `app/build.gradle.kts`, so AGP selects its
default for AGP 9.1.0. Install a recent build-tools alongside platform 37.

The JDK must be 21 even though the bytecode target is 17. AGP 9.1.0 requires a
JDK 21 toolchain to run Gradle and the Android plugin; the 17 is the class-file
version of the produced code.

### Why the first build is slow

The wrapper has no local distribution. On the first `./gradlew` invocation it
downloads `gradle-9.3.1-bin.zip` from `services.gradle.org` into
`GRADLE_USER_HOME` (`~/.gradle/wrapper/dists` by default). That directory does
not exist on this machine. Every dependency in `gradle/libs.versions.toml` is
then resolved from `google()`, `mavenCentral()`, `jitpack.io`, and
`api.xposed.info`.

`gradle.properties` sets `org.gradle.configuration-cache=true` and
`ksp.incremental=false`. Configuration cache makes repeat builds faster; KSP
incremental being off means the whole mod pack registry is regenerated on every
build.

### Where things land

| Artifact | Path |
| --- | --- |
| Debug APK | `app/build/outputs/apk/debug/PixelXpert.apk` |
| Release APK | `app/build/outputs/apk/release/PixelXpert.apk` |
| Magisk module zip | `output/PixelXpertFork-<versionName>.zip` |
| Generated pack registry | `app/build/generated/ksp/<variant>/kotlin/sh/siava/pixelxpert/xposed/ModPacks.kt` |
| Build outputs root | `build/` (root project), `app/build/`, `modPackProcessor/build/` |

The APK is always named `PixelXpert.apk`, not `app-debug.apk` or
`app-release.apk`. `app/build.gradle.kts` renames it in an `assemble<variant>`
`doLast` hook, and both packaging paths look for that name.

`output/` and `app/build/` do not exist until you build. They are not tracked.
`app/build/` is covered by `app/.gitignore` (`/build`). `output/` is created by
the `createZip` task and by `.github/make_debug_zip.sh`.

---

## Walkthrough

### Step 1 — Install JDK 21

Install a JDK 21 distribution. Temurin 21 is what CI uses, so use it to keep
local and CI behaviour aligned. Then set `JAVA_HOME` and put it on `PATH`.

Windows (PowerShell, adjust the path to your install):

```powershell
[Environment]::SetEnvironmentVariable('JAVA_HOME', 'C:\Program Files\Eclipse Adoptium\jdk-21.0.5.11-hotspot', 'User')
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.5.11-hotspot'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
java -version
```

`java -version` must print a 21.x version. If it fails, `gradlew.bat` exits with:

```text
ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.

Please set the JAVA_HOME variable in your environment to match the
location of your Java installation.
```

`gradlew.bat` reads `JAVA_HOME` first and falls back to `java.exe` on `PATH`. If
`JAVA_HOME` is set but points somewhere without `bin/java.exe`, it prints
`ERROR: JAVA_HOME is set to an invalid directory`.

### Step 2 — Install Android SDK platform 37

Install the SDK command-line tools, then the platform and build-tools:

```bash
sdkmanager "platforms;android-37" "build-tools;37.0.0" "platform-tools"
```

Platform 37 is required: `compileSdk = 37` in `app/build.gradle.kts`. The
`android.suppressUnsupportedCompileSdk=37.0` line in `gradle.properties`
suppresses AGP's warning about compiling against an SDK newer than the plugin
expects. It does not substitute for the platform being installed.

### Step 3 — Point the build at the SDK

Either set `ANDROID_HOME` in the environment, or create `local.properties` at the
repo root:

```properties
sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
```

`local.properties` is gitignored (`.gitignore` line 12, `local.properties`). Do
not commit it.

### Step 4 — Optional: create `ReleaseKey.properties`

Only needed for a distributable, non-debug-signed build. Without it, both build
types are signed with the debug key and the build reports no warning.

Create `ReleaseKey.properties` at the repo root:

```properties
storePassword=<keystore password>
keyAlias=<alias>
keyPassword=<key password>
storeFile=/absolute/path/to/ReleaseKey.jks
```

All four keys are required. `storeFile` goes through `rootProject.file(...)`, so a
relative value is resolved from the repo root. The file is gitignored
(`/ReleaseKey.properties`, `*.jks`).

Verify what you got:

```bash
"$ANDROID_HOME/build-tools/37.0.0/apksigner" verify --print-certs \
  app/build/outputs/apk/release/PixelXpert.apk
```

The certificate DN must not contain `CN=Android Debug`.

### Step 5 — Build

```bash
# fastest sanity check: compile the debug variant
./gradlew assembleDebug

# release APK only, no version mutation, no zip
./gradlew assembleRelease

# full canary pipeline: bump version, build release APK, package Magisk zip
./gradlew buildCanary -Pchannel=canary

# full stable pipeline; always pass the version name explicitly
./gradlew buildStable -Pchannel=stable -PversionName=v6.1.0

# remove build outputs
./gradlew clean
```

On Windows use `gradlew.bat` or `.\gradlew.bat`.

`assembleDebug` and `assembleRelease` are safe to run repeatedly: they read
`version.properties` but never write it. `buildCanary` and `buildStable` **do**
write it, plus `MagiskModBase/module.prop` and the update JSON manifests. See
[gradle-tasks](../reference/gradle-tasks.md) for the exact file list.

If you only want the APK and do not want version files touched, use
`assembleRelease`. If you want the zip without the version bump, run
`./gradlew assembleRelease createZip` in one invocation so `mustRunAfter` is
satisfied.

### Step 6 — Collect the artifacts

```text
app/build/outputs/apk/debug/PixelXpert.apk      <- debug build
app/build/outputs/apk/release/PixelXpert.apk    <- release build
output/PixelXpertFork-canary-537.zip            <- Magisk module (canary example)
```

Install the APK directly with `adb install -r`, or flash the zip in Magisk. The
zip contains `module.prop`, `customize.sh`, `service.sh`, `sqlite3`,
`META-INF/com/google/android/update-binary`, and `PixelXpert.apk` at its root.

---

## Contracts

| Contract | Consequence of breaking it |
| --- | --- |
| `JAVA_HOME` must point at a JDK 21 | Gradle refuses to start, or AGP fails with an unsupported class file version |
| The Android SDK must contain platform 37 | `Failed to find target with hash string 'android-37'` at configuration |
| `ANDROID_HOME` or `local.properties` `sdk.dir` must be set | `SDK location not found` at configuration |
| Never commit `local.properties` or `ReleaseKey.properties` | Leaks a machine path or a signing password |
| Never add `repositories { }` to `app/build.gradle.kts` or `modPackProcessor/build.gradle.kts` | `FAIL_ON_PROJECT_REPOS` fails configuration |
| Use `assembleRelease` when you do not intend to bump versions | `buildCanary` / `buildStable` rewrite `version.properties` and the update manifests |
| Do not run `buildStable` without `-PversionName` | The version name comes from `git describe --tags --match=v*`, which on `canary` resolves to `v1.0.0-beta-04` |

---

## Failure modes

Every row below was produced or reproduced on this machine, or is a direct
consequence of a line in a file named in the row.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `java: The term 'java' is not recognized as the name of a cmdlet, function, script file, or operable program.` | No JDK installed, `PATH` unchanged | Install JDK 21, set `JAVA_HOME`, reopen the shell |
| `ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.` then exit 1 | `gradlew.bat` line 23-32 fallback failed | Set `JAVA_HOME` to a JDK 21 install |
| `ERROR: JAVA_HOME is set to an invalid directory: <path>` | `JAVA_HOME` set but `bin/java.exe` missing | Correct the path or unset `JAVA_HOME` |
| `SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by setting the sdk.dir path in your project's local.properties file` | Neither `ANDROID_HOME` nor `local.properties` set | Set one of them |
| `Failed to find target with hash string 'android-37' in: <sdk>` | Platform 37 not installed | `sdkmanager "platforms;android-37"` |
| `Failed to find Build Tools revision 37.0.0` | Build-tools not installed | `sdkmanager "build-tools;37.0.0"` |
| First `./gradlew` hangs or fails downloading `gradle-9.3.1-bin.zip` | No network, or a proxy is required | Configure the proxy or pre-seed `~/.gradle/wrapper/dists` |
| `Unsupported class file major version` | Gradle daemon on a JDK other than 21 | Point `JAVA_HOME` at JDK 21; stop stale daemons with `./gradlew --stop` |
| `Release build produced an APK that will not install over the previous version` | `ReleaseKey.properties` absent; the `try`/`catch` in `app/build.gradle.kts` fell back to `signingConfigs.getByName("debug")` | Create `ReleaseKey.properties` and rebuild; verify with `apksigner verify --print-certs` |
| `output/` is empty after `assembleRelease` | `assembleRelease` does not create the zip; only `createZip` does | Run `./gradlew createZip` after `assembleRelease`, or use `buildCanary` / `buildStable` |
| `createZip` produced a zip with no APK | `createZip` has `mustRunAfter` but no `dependsOn` on `assembleRelease` | Run `./gradlew assembleRelease createZip` in one invocation |
| `ModPackProcessor discovered no mod packs; refusing to emit an empty registry` | `:app` no longer declares `ksp(project(":modPackProcessor"))`, or every target annotation was removed | Restore the `ksp(...)` dependency and the annotations |
| Build succeeds but `ModPacks.kt` is stale | `ksp.incremental=false` still caches; a partially failed KSP run can leave the previous file | `./gradlew clean` then rebuild |
| `buildStable` wrote `STABLE_VERSION_NAME=v1.0.0-beta-04` | No `-PversionName`; `GitTagProvider` returned an old reachable `v*` tag | Pass `-PversionName=vX.Y.Z` and revert the file |
| `Configuration cache problems found` after editing a build script | A task captured the `Project` at execution time | Re-run; if it persists, fix the task to use providers |

---

## Checklist

- [ ] `java -version` prints 21.x
- [ ] `echo $env:JAVA_HOME` (PowerShell) or `echo $JAVA_HOME` prints a JDK 21 path
- [ ] `$ANDROID_HOME/platforms/android-37` exists
- [ ] `./gradlew --version` prints `Gradle 9.3.1`
- [ ] `./gradlew assembleDebug` succeeds
- [ ] `app/build/outputs/apk/debug/PixelXpert.apk` exists and is named exactly that
- [ ] If building a distributable: `ReleaseKey.properties` exists and
      `apksigner verify --print-certs` shows a non-debug certificate
- [ ] I know whether my command mutates `version.properties` (`buildCanary`,
      `buildStable`) or not (`assembleDebug`, `assembleRelease`)

---

## See also

- [Build and release architecture](../architecture/build-and-release.md)
- [Release process](release-process.md)
- [Gradle tasks reference](../reference/gradle-tasks.md)
- [Risk register](../analysis/risk-register.md)
- [Repository map](../agent/REPO_MAP.md)
