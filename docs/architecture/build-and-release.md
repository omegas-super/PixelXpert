# Build and Release Architecture

How the repository turns source into an APK, how that APK becomes a flashable
Magisk zip, how version numbers are derived and written, and which CI workflow
publishes which artifact. Read this before changing anything under `buildSrc/`,
`app/PXTasks.gradle.kts`, `MagiskModBase/`, or `.github/workflows/`.

**Audience:** agent changing build logic, versioning, signing, or packaging
**Prereqs:** [repository map](../agent/REPO_MAP.md), [overview](overview.md)

---

## Summary

- Three Gradle modules: `:app` (the APK), `:modPackProcessor` (a KSP symbol
  processor consumed by `:app`), and the implicit `:buildSrc` (build logic).
- Gradle 9.3.1 from the wrapper, AGP 9.1.0, Kotlin 2.2.21, KSP 2.3.6. JDK 21 in
  CI, JVM target 17 for bytecode.
- There are **no product flavors**. Two build types exist: `debug` and `release`.
  A "canary" or "stable" build is the same `release` build type with a different
  `-Pchannel` value, not a different variant.
- Version numbers come from `version.properties`, optionally overridden by the
  `channel` and `versionName` Gradle properties and by `git describe`.
- The APK and the Magisk module are the same artifact. `MagiskModBase/` supplies
  the flashable wrapper; the `createZip` task merges the two.
- Release signing fails open to the debug key. A missing `ReleaseKey.properties`
  produces a debug-signed APK with no warning and no build failure.
- Four release/packaging workflows plus two manual test workflows and one docs
  workflow exist under `.github/workflows/`.

---

## Model

### Module graph

```text
PixelXpert/                       (rootProject, no plugins applied)
├── build.gradle.kts              plugin declarations (apply false) + clean
├── settings.gradle.kts           includes :app and :modPackProcessor
├── buildSrc/                     kotlin-dsl; on the build script classpath
│   ├── BuildUtils.kt             version code/name providers, bump helpers
│   ├── GitTagProvider.kt         git describe --tags --match=v*
│   └── IncrementVersionTask.kt   the IncrementVersionTask type
├── modPackProcessor/             plain Kotlin JVM module, JVM 17
│   └── emits sh.siava.pixelxpert.xposed.ModPacks at KSP time
└── app/                          com.android.application, namespace sh.siava.pixelxpert
    ├── build.gradle.kts          android block, signing, APK rename hook
    └── PXTasks.gradle.kts        applied via apply(from = ...); task group "pixelxpert"
```

| Module | Plugins | Role |
| --- | --- | --- |
| `:app` | `com.android.application`, `kotlin.compose`, `kotlin.serialization`, `ksp` | The single APK. `ksp(project(":modPackProcessor"))` makes the registry generation part of its compile |
| `:modPackProcessor` | `org.jetbrains.kotlin.jvm` | Compile-time only. Depends on `symbol-processing-api` |
| `:buildSrc` | `kotlin-dsl` | Provides `getVersionCode()`, `getVersionName()`, `IncrementVersionTask` to build scripts |

`buildSrc/` classes are declared in the **default package** (no `package`
statement), which is why `app/PXTasks.gradle.kts` can use `IncrementVersionTask`
and `getVersionName()` without an import.

### Repositories and resolution policy

`settings.gradle.kts` sets `RepositoriesMode.FAIL_ON_PROJECT_REPOS`. Declaring a
`repositories { }` block inside `app/build.gradle.kts` or
`modPackProcessor/build.gradle.kts` fails configuration. The four allowed
repositories are `google()`, `mavenCentral()`, `https://jitpack.io`, and
`https://api.xposed.info/`.

### Variant and build type model

| Build type | `isMinifyEnabled` | `isShrinkResources` | `signingConfig` |
| --- | --- | --- | --- |
| `release` | `true` | `true` | `releaseSigning` (see Signing) |
| `debug` | `false` | `false` | `releaseSigning` (see Signing) |

Both build types use the same signing config object. The difference between a
"canary" and a "stable" build is only the value of the `channel` Gradle property,
which changes the version code and version name. There is no `canary` or
`stable` build type, and `./gradlew tasks` shows no such variant.

`release` adds three ProGuard files in order: `app/proguard-android-optimize.txt`,
`app/proguard.pro`, `app/proguard-rules.pro`. `app/proguard-rules.pro` is the
load-bearing one: it keeps `XPLauncher`, every `XposedModPack` subclass, the
generated `ModPacks` object, the AIDL stubs, and the whole
`sh.siava.pixelxpert.**` tree. Removing those rules breaks the module at runtime,
not at build time, because libxposed loads `XPLauncher` by name from
`app/src/main/resources/META-INF/xposed/java_init.list`.

Fixed Android settings:

| Setting | Value | Where |
| --- | --- | --- |
| `namespace` | `sh.siava.pixelxpert` | `app/build.gradle.kts` |
| `applicationId` | `sh.siava.pixelxpert` | `app/build.gradle.kts` |
| `compileSdk` / `minSdk` / `targetSdk` | 37 / 37 / 37 | `app/build.gradle.kts` |
| `abiFilters` | `arm64-v8a` only | `app/build.gradle.kts` `ndk { }` |
| `buildFeatures` | `compose`, `buildConfig`, `aidl` | `app/build.gradle.kts` |
| Java/Kotlin target | 17 | `app/build.gradle.kts`, `modPackProcessor/build.gradle.kts` |
| Core library desugaring | enabled, `desugar_jdk_libs` 2.1.5 | `app/build.gradle.kts` |

`abiFilters` restricts the APK's declared ABI. The module configures no
`externalNativeBuild` block, so no native code is compiled by Gradle; the
`sqlite3` binary shipped to devices is the prebuilt file
`MagiskModBase/sqlite3`.

### Versioning

`version.properties` is the source of truth and holds four keys:

```properties
CANARY_VERSION_CODE=536
CANARY_VERSION_NAME=canary-536
STABLE_VERSION_CODE=600
STABLE_VERSION_NAME=v6.0.0
```

Two Gradle properties override behaviour at configuration time:

| Property | Effect |
| --- | --- |
| `-Pchannel=stable` | Selects the `STABLE_*` keys and makes the version name come from the git tag |
| `-Pchannel=canary` or omitted | Selects the `CANARY_*` keys and `canary-<code>` naming |
| `-PversionName=<name>` | Highest-precedence version name override |

`BuildUtils.getVersionCodeProvider()` computes:

- stable: `STABLE_VERSION_CODE`, falling back to `VERSION_CODE`, falling back to
  `600`.
- canary or unset: `CANARY_VERSION_CODE + 1`, falling back to
  `VERSION_CODE + 1`, falling back to `501`.

The `+1` is deliberate: the build gets the *next* canary number, and the
`incrementCanaryVersion` task then writes that same number into
`version.properties`. A canary build therefore reports the same version the
release commit records.

`BuildUtils.getVersionNameProvider()` computes:

- stable: the output of `GitTagProvider` when it starts with `v` and is not the
  sentinel string `Error`; otherwise `STABLE_VERSION_NAME`, otherwise `v6.0.0`.
- canary or unset: `canary-<computed version code>`.

`GitTagProvider` shells out to:

```text
git describe --tags --match=v* --abbrev=0 HEAD
```

and returns the literal string `Error` on any exception or empty output. On the
`canary` branch of this checkout that command returns `v1.0.0-beta-04`, an
ancient tag reachable from `HEAD`. It is only consulted when `channel=stable`.

`defaultConfig.versionName` is the placeholder string `AutoGeneratedLater`. The
real name is applied in `androidComponents.onVariants` via
`output.versionName.set(getVersionName())`.

### Signing

`app/build.gradle.kts` builds `releaseSigning` before the `buildTypes` block:

```kotlin
var releaseSigning = signingConfigs.getByName("debug")

try {
    // load ReleaseKey.properties from the repo root
    releaseSigning = signingConfigs.create("release") { /* keyAlias, keyPassword, storeFile, storePassword */ }
} catch (_: Exception) {
}
```

`ReleaseKey.properties` must be at the repo root and must define `keyAlias`,
`keyPassword`, `storeFile`, and `storePassword`. `storeFile` is resolved with
`rootProject.file(...)`, so a relative path is relative to the repo root.

The catch block is empty and catches `Exception`. Any failure — file missing,
unreadable, malformed, missing keys, missing keystore — leaves `releaseSigning`
pointing at the **debug** signing config. Both `debug` and `release` build types
then use it. Consequences:

- The build succeeds and produces an APK.
- The APK is signed with the debug key.
- Nothing in the log says so.
- The failure surfaces at install time on a device, as an update that refuses to
  install over a properly signed previous version.

`/ReleaseKey.properties` and `*.jks` are listed in `.gitignore`. CI writes the
file at release time from the `SIGNING_KEY`, `KEY_STORE_PASSWORD`, `ALIAS`, and
`KEY_PASSWORD` secrets.

### Packaging: APK to Magisk zip

`MagiskModBase/` is the flashable wrapper. It is not compiled.

| File | Role |
| --- | --- |
| `MagiskModBase/module.prop` | Module identity: `id=PixelXpert`, `name=PixelXpertFork`, `version`, `versionCode`, `updateJson`, `minMagisk=25000` |
| `MagiskModBase/customize.sh` | Install-time script: ROM asserts, app install, root grant, preference migration |
| `MagiskModBase/service.sh` | Post-boot script: retries `pm install`, restores backed-up prefs, grants root |
| `MagiskModBase/sqlite3` | Prebuilt binary used by both scripts to edit `/data/adb/magisk.db` |
| `MagiskModBase/META-INF/com/google/android/update-binary` | Sources `/data/adb/magisk/util_functions.sh`, requires `MAGISK_VER_CODE >= 20400`, calls `install_module` |
| `MagiskModBase/META-INF/com/google/android/updater-script` | Single line `#MAGISK` |

The APK name is forced to `PixelXpert.apk`. Two hooks in `app/build.gradle.kts`
do this:

1. `preBuild.doLast` deletes any existing `PixelXpert.apk` in the variant's APK
   artifact directory, wrapped in a `try`/`catch` because the directory may not
   exist yet.
2. A `tasks.whenTaskAdded` handler attaches a `doLast` to `assemble<variant>`
   that renames every `.apk` in that directory which is not already
   `PixelXpert.apk` to `PixelXpert.apk`.

The result is that `app/build/outputs/apk/release/` contains `PixelXpert.apk`,
not `app-release.apk`. `createZip` and `.github/make_debug_zip.sh` both depend on
that exact name.

`app/PXTasks.gradle.kts` then builds the zip:

```kotlin
tasks.register<Zip>("createZip") {
    from(file("../MagiskModBase"))
    from(file("build/outputs/apk/release/PixelXpert.apk")) { into("") }
    destinationDirectory.set(file("../output"))
    archiveFileName.set(getVersionNameProvider().map { "PixelXpertFork-$it.zip" })
}
```

`createZip` is registered in `:app`, so `file("../MagiskModBase")` resolves to the
repo-root `MagiskModBase/` and `file("../output")` to the repo-root `output/`.
Both the wrapper files and the APK land at the zip root, which is what
`customize.sh` expects: it reads `$MODPATH/PixelXpert.apk`, falling back to the
first `*.apk` it finds.

`createZip` declares `mustRunAfter` on `assembleRelease`,
`incrementCanaryVersion`, and `incrementStableVersion`, and declares **no**
`dependsOn`. Running `:app:createZip` on its own zips whatever is already in
`app/build/outputs/apk/release/`.

### Update manifests

Five JSON files carry update metadata. They are written by the version bump task
and by CI, and read by the app and by Magisk.

| File | Written by | Read by |
| --- | --- | --- |
| `latestCanary.json` | `incrementCanaryVersion` | app: `app/src/main/java/sh/siava/pixelxpert/ui/update/UpdateScreen.kt` fetches `https://raw.githubusercontent.com/Codecity001/PixelXpert/canary/latestCanary.json` |
| `latestVersion.json` | `incrementStableVersion` | nothing in this checkout references it; the app's stable URL is `.../stable/latestStable.json` |
| `latestStable.json` | not present on `canary`; written by the stable workflow | app stable channel |
| `MagiskModuleUpdate_Xposed.json` | both bump tasks and both release workflows | Magisk, via `updateJson` in `MagiskModBase/module.prop` |
| `MagiskModuleUpdate_Full.json` | both bump tasks and both release workflows | nothing references it from `module.prop` |

`BuildUtils.bumpFileStandalone` rewrites four fields in each file by regex:
`version`, `versionCode`, `zipUrl_Xposed`, `zipUrl`. The replacement URL is
hard-coded to:

```text
https://github.com/Codecity001/PixelXpert/releases/download/<versionName>/PixelXpertFork-<versionName>.zip
```

`bumpFileStandalone` returns immediately when the target file does not exist. On
`canary`, `incrementStableVersion` lists `latestStable.json` in `filesToUpdate`
and that file is absent, so it is skipped silently.

### Pipelines

Six workflows live in `.github/workflows/`.

| Workflow | Trigger | Produces |
| --- | --- | --- |
| `makeCanaryRelease.yml` | push to `canary` whose changed paths include `.github/edit2MakeNewCanary` | Tag, GitHub prerelease, version bump commit |
| `makeStableRelease.yml` | on the `stable` branch: push touching `.github/edit2MakeNewStable`, a `v*` tag push, or manual dispatch. The `canary` copy names `main`, which does not exist upstream | Tag, GitHub release, version bump commit |
| `makeCanaryTestPackage.yml` | manual dispatch | Unzipped module contents as an Actions artifact |
| `fullPackageTestBuild.yml` | manual dispatch | Debug APK and a `PixelXpert.zip` artifact |
| `xposedPackageTestBuild.yml` | manual dispatch | Same build, different artifact names |
| `docs-check.yml` | push or PR touching `docs/**`, `AGENTS.md`, `scripts/check-docs.mjs` | Runs `node scripts/check-docs.mjs --verbose` |

The two release workflows are described step by step in
[release-process](../guides/release-process.md).

#### The stable workflow is branch-specific, and the canary copy is stale

`makeStableRelease.yml` hard-codes its own branch name in six places. The copy on
`canary` names `main`; the copy on `stable` names `stable`.

| Line in `makeStableRelease.yml` | Value on `canary` | Value on `stable` |
| --- | --- | --- |
| `on.push.branches` | `main` | `stable` |
| clone step `--branch` | `main` | `stable` |
| `sed` rewriting `module.prop` | `/canary/` to `/main/` | `/canary/` and `/main/` to `/stable/` |
| `changelog` URLs (two) | `.../main/StableChangelog.md` | `.../stable/StableChangelog.md` |
| `github-actions-x/commit` `push-branch` | `main` | `stable` |

The repository has **no `main` branch**. `git ls-remote --heads origin` returns
`auto_brightness`, `canary`, `canary-localization`,
`feature/kotlin-libxposed-v3`, `feature/statusbar-text-styling`,
`fix/qs-brightness-recompose`, `inject`, `libxposed-api-102`, `pre-a16qprb`, and
`stable` — and `fork` matches. Consequences for the `canary` copy:

| Step | Problem |
| --- | --- |
| `git clone --branch main --single-branch` | Fails outright; no such ref |
| `git push … HEAD:refs/heads/stable --force` | Force-pushes a tree built from a branch that never cloned |
| `github-actions-x/commit` with `push-branch: 'main'` | Commits to a branch that does not exist |
| Changelog URLs in `latestStable.json`, `MagiskModuleUpdate_*.json` | Point at `raw.githubusercontent.com/<repo>/main/…`, which returns 404 |
| `sed -i 's\|/canary/MagiskModuleUpdate_\|/main/MagiskModuleUpdate_\|g'` | Rewrites `module.prop` toward the same dead path |

The trigger is also `branches: [main]` plus
`paths: ['.github/edit2MakeNewStable']`, so the stable trigger file cannot fire
from `canary` at all.

**The stable release pipeline cannot run as written**, and if `main` were created
the published update manifests would still point at dead URLs. Canary is
unaffected: `makeCanaryRelease.yml` uses the same force-push pattern but
correctly targets `canary`.

The release history confirms which copy actually runs. `v6.1.0` was released on
2026-10-30, and the `makeStableRelease.yml` at that tag names `stable`, not
`main`. Stable releases are cut from the `stable` branch, using that branch's copy
of the workflow. Treat the `canary` copy as dead configuration that will mislead
you if you read only the current branch.

This is recorded as risk **R7b** in the
[risk register](../analysis/risk-register.md). The
[release process guide](../guides/release-process.md) carries the operator-facing
version of the same finding.

The `stable` branch carries one extra script, `extractStableChanges.sh`, which
does not exist on `canary`. The two copies of the stable workflow differ in their
release-notes step: the `canary` copy copies `StableChangelog.md` verbatim to
`releaseNotes.md`, and the `stable` copy calls `extractStableChanges.sh <tag>` to
extract one version's section. See
[release-process](../guides/release-process.md) for the full comparison.

Every build workflow uses the same toolchain step:

```yaml
- uses: actions/setup-java@v5
  with:
    java-version: '21'
    distribution: 'temurin'
    cache: gradle
```

`makeCanaryRelease.yml` and `makeStableRelease.yml` clone rather than checkout,
so they run against a fresh single-branch clone rather than the default
`actions/checkout` working tree.

---

## Walkthrough

### What `./gradlew buildCanary -Pchannel=canary` does

1. Gradle evaluates `:app`'s build script. `getVersionCode()` is called
   eagerly in `defaultConfig`, so `version.properties` is read at configuration
   time and the code is fixed as `CANARY_VERSION_CODE + 1`.
2. `androidComponents.onVariants` calls `getVersionName()` eagerly and sets it on
   every variant output, giving `canary-<code>`.
3. `buildCanary` executes. It has no action of its own.
4. Its finalizers run in declaration order:
   `incrementCanaryVersion`, then `assembleRelease`, then `createZip`.
5. `incrementCanaryVersion` writes `CANARY_VERSION_CODE` and
   `CANARY_VERSION_NAME` into `version.properties`, then rewrites
   `MagiskModBase/module.prop`, `latestCanary.json`,
   `MagiskModuleUpdate_Xposed.json`, and `MagiskModuleUpdate_Full.json`.
6. `assembleRelease` compiles, runs KSP, R8-shrinks, signs with `releaseSigning`,
   and the `whenTaskAdded` hook renames the output to `PixelXpert.apk`.
7. `createZip` copies `MagiskModBase/` plus the APK into
   `output/PixelXpertFork-canary-<code>.zip`.

Steps 4 and 5 mean the version files are mutated **before** the APK is built,
and they stay mutated even if `assembleRelease` fails. `createZip` is a finalizer
of `buildCanary`, not a dependent of `assembleRelease`, so it also runs after a
failed build and packages whatever APK is on disk.

### What `./gradlew buildStable -Pchannel=stable -PversionName=v6.1.0` does

Identical ordering, with three differences:

1. The version code is `STABLE_VERSION_CODE` unchanged.
2. `incrementStableVersion` writes `STABLE_VERSION_CODE` back **unchanged**. It
   does not increment. The maintainer must bump that value by hand before
   cutting a stable release.
3. The version name comes from `-PversionName`, or from the git tag, or from
   `STABLE_VERSION_NAME`.

### What the canary release workflow does

1. Clones `canary` into the workspace.
2. Installs JDK 21 (temurin) with Gradle caching.
3. Writes `ReleaseKey.properties` and decodes `ReleaseKey.jks` when the
   `SIGNING_KEY` secret is non-empty.
4. Runs `rm -rf output` then `./gradlew buildCanary -Pchannel=canary`.
5. Runs `.github/extractCanaryChanges.sh`, which writes `changeLog.md`.
6. Runs `.github/prepareCanaryChangelog.sh`, which prepends the new version
   header to `CanaryChangelog.md` unless it is already there.
7. Uploads `output/` as the `PixelXpertFork-Canary.zip` Actions artifact.
8. Force-pushes two tags: the version tag and `canary_builds`.
9. Creates a GitHub prerelease with `bodyFile: changeLog.md` and
   `artifacts: 'output/*.*'`.
10. Commits seven files back to `canary` through `github-actions-x/commit` with
    `rebase: 'false'`.

---

## Contracts

| Contract | Consequence of breaking it |
| --- | --- |
| The APK must be named `PixelXpert.apk` | `createZip` and `customize.sh` both look for that name; the zip ships without an APK |
| `createZip` must run after `assembleRelease` | The zip contains a stale or missing APK; there is no `dependsOn` to save you |
| `version.properties` keys must stay `CANARY_VERSION_CODE`, `CANARY_VERSION_NAME`, `STABLE_VERSION_CODE`, `STABLE_VERSION_NAME` | `BuildUtils` falls back to hard-coded defaults and the version silently changes |
| `MagiskModBase/module.prop` must keep `version` and `versionCode` on their own lines | `bumpFileStandalone` replaces only the first regex match per field |
| `ReleaseKey.properties` must exist for a distributable build | Silent debug signing |
| `STABLE_VERSION_CODE` must be bumped by hand | The new stable release carries the same `versionCode` as the previous one and Magisk does not offer the update |
| Do not add `repositories { }` to a module build script | `FAIL_ON_PROJECT_REPOS` fails configuration |
| Do not hand-edit `version.properties`, `module.prop`, or the four update JSONs | CI owns them; a manual edit desynchronises the next automated bump |

---

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| APK installs over a previous build only after uninstalling | Release build signed with the debug key because `ReleaseKey.properties` was absent or malformed | Create `ReleaseKey.properties` at the repo root; verify the signature before distributing |
| `output/PixelXpertFork-*.zip` has no APK inside | `createZip` ran without a fresh `assembleRelease`, or the rename hook did not fire | Run `./gradlew assembleRelease` then `./gradlew createZip`; check `app/build/outputs/apk/release/PixelXpert.apk` exists |
| Version in the APK does not match `version.properties` | `version.properties` was edited after configuration, or the bump task ran without a rebuild | Re-run the full `buildCanary` / `buildStable` task, not `assembleRelease` alone |
| Local `buildStable` writes `STABLE_VERSION_NAME=v1.0.0-beta-04` | `GitTagProvider` returned an old reachable tag and no `-PversionName` was passed | Always pass `-PversionName=vX.Y.Z`; check `git describe --tags --match=v* --abbrev=0 HEAD` first |
| Stable release ships with an unchanged `versionCode` | `incrementStableVersion` writes `STABLE_VERSION_CODE` back unchanged | Bump `STABLE_VERSION_CODE` in `version.properties` before triggering the release |
| `latestCanary.json` still points at an old release | Only `incrementCanaryVersion` writes it, and it did not run | Run `buildCanary`, not `assembleRelease` |
| `:app:kspDebugKotlin` emits "discovered no mod packs" | `:modPackProcessor` found no class carrying a `@BaseModPack`-meta-annotated annotation | Confirm the annotations exist and `ksp(project(":modPackProcessor"))` is still declared |
| Gradle fails at configuration with a repository error | A `repositories { }` block was added to a module | Remove it; add the repository to `settings.gradle.kts` |
| Builds fail with `Unsupported class file major version` | JDK other than 21 on the Gradle daemon | Set `JAVA_HOME` to a JDK 21 install |

---

## Checklist

- [ ] I know whether my change affects `:app`, `:modPackProcessor`, `:buildSrc`,
      `MagiskModBase/`, or `.github/workflows/`
- [ ] If I touched versioning, I re-read `buildSrc/src/main/kotlin/BuildUtils.kt`
      and confirmed which keys are read and which are written
- [ ] If I touched signing, I confirmed `ReleaseKey.properties` is either present
      or deliberately absent
- [ ] If I touched packaging, I confirmed `MagiskModBase/customize.sh` still finds
      `PixelXpert.apk` at the zip root
- [ ] If I touched a workflow, I confirmed the branch name it references exists
      (`git ls-remote --heads <remote>`)
- [ ] I did not hand-edit `version.properties`, `MagiskModBase/module.prop`, or
      the four update JSON files

---

## See also

- [Build locally](../guides/build-locally.md)
- [Release process](../guides/release-process.md)
- [Gradle tasks reference](../reference/gradle-tasks.md)
- [Risk register](../analysis/risk-register.md)
- [Repository map](../agent/REPO_MAP.md)
