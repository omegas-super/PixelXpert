# Repository Map

Every directory in this repository, what lives in it, and whether an agent is
likely to need it. Read this before grepping the tree.

**Audience:** any agent or contributor on first contact with the repo
**Prereqs:** none

---

## Summary

- Three Gradle modules: `:app` (the module itself), `:modPackProcessor` (a KSP
  symbol processor), `:buildSrc` (build logic).
- One source root that matters: `app/src/main/java/sh/siava/pixelxpert/`.
- Two execution worlds inside one APK: the **app process** (Compose UI,
  preferences, updater) and the **hooked process** (code injected into
  SystemUI, system server, launcher, settings, dialer, telecom).
- `MagiskModBase/` is not code; it is the Magisk wrapper that turns the APK
  into a flashable zip.
- Documentation lives in `docs/`. Start at `docs/README.md`.

---

## Top level

| Path | What it is | Agent relevance |
| --- | --- | --- |
| `app/` | The Android application module. All product code. | Primary |
| `modPackProcessor/` | KSP processor that generates the mod pack registry at build time. | High if touching pack discovery |
| `buildSrc/` | Gradle build logic: version code/name providers, version bump task. | High if touching versioning |
| `gradle/` | Version catalog (`libs.versions.toml`) and wrapper properties. | High if touching dependencies |
| `MagiskModBase/` | Magisk module template: `module.prop`, `customize.sh`, `service.sh`, update-binary. | High if touching packaging |
| `docs/` | This documentation tree. | Primary |
| `.github/` | CI workflows, issue templates, release helper scripts, trigger files. | High if touching release |
| `.idea/` | IntelliJ/Android Studio project state. Committed, but not authoritative. | Ignore |
| `output/` | Build output for the packaged Magisk zip. Gitignored, created by `createZip`. | Ignore |

Root files worth knowing:

| File | Purpose |
| --- | --- |
| `settings.gradle.kts` | Includes `:app` and `:modPackProcessor`; pins repositories (google, mavenCentral, jitpack, api.xposed.info) |
| `build.gradle.kts` | Root plugin declarations only, plus `clean` |
| `gradle.properties` | JVM args, AndroidX, configuration cache, KSP incremental off |
| `version.properties` | `CANARY_VERSION_CODE`/`NAME` and `STABLE_VERSION_CODE`/`NAME` — the source of truth for versioning |
| `latestVersion.json`, `latestCanary.json` | In-app updater manifests for stable and canary channels |
| `MagiskModuleUpdate_Full.json`, `MagiskModuleUpdate_Xposed.json` | Magisk manager update manifests for the two module flavors |
| `makeMagisk.bat` | Windows helper that zips `MagiskModBase` with the built APK |
| `.editorconfig` | Tabs, LF, max line 120, ktlint intellij_idea style |
| `README.md` | User-facing install guide. Not for contributors. |
| `CONTRIBUTING.md` | Four lines. Superseded by `docs/`. |

---

## `app/src/main/java/sh/siava/pixelxpert/`

The whole product. 178 Kotlin files, ~31.9k lines.

| Path | Contents | Notes |
| --- | --- | --- |
| `Constants.kt` | Broadcast actions, scoped package names, update channel ids, Magisk paths | Read this first; it defines the cross-process contract |
| `MainActivity.kt`, `PxnApp.kt`, `PxnRoot.kt` | App entry, Application class, root Compose host | |
| `SplashActivity.kt`, `FakeSplashActivity.kt` | Splash screens | `Fake` is the one shown when the real splash is skipped |
| `annotations/` | `@BaseModPack`, `@ChildProcessModPack`, `@MainProcessModPack`, `@ModPackPriority`, `ModPackData` | The meta-annotation layer the KSP processor reads |
| `data/` | `PrefStore.kt`, `RemotePrefProvider.kt`, `HooksMonitor.kt` | Preference storage and the hook-status channel |
| `di/` | `PxnModule.kt` | Koin module — the only DI wiring |
| `receivers/` | Broadcast receivers for preference and boot events | |
| `service/` | `PixelXpertProxy.kt`, `RootProvider.kt`, `tileServices/` | Root binder service and Quick Settings tiles |
| `theme/` | Compose theme, colors, typography | |
| `ui/` | All Compose UI | Largest app-side package, ~8.6k lines |
| `util/` | Updater, installer, NTP sync, icon pack, restart helpers | |
| `xposed/` | All hooking code | Largest package overall, ~20.2k lines |

### `xposed/` in detail

This is where an agent will spend most of its time.

| Path | Contents |
| --- | --- |
| `XPLauncher.kt` | `XposedModule` entry point: process identity, context acquisition, preference wait, pack loading, hot reload |
| `XposedRuntime.kt` | Process-wide bridge to the libxposed API; generation holder; hook/invoke/log helpers |
| `XposedGeneration.kt` | Everything one loaded copy owns: hooks, threads, cleanups, `installOnce` keys |
| `XposedModPack.kt` | Abstract base every pack extends |
| `XPrefs.kt` | Remote preference access from the hooked process |
| `annotations/` | The seven target annotations (`@SystemUIModPack`, `@FrameworkModPack`, …) |
| `inspector/` | Framework/SystemUI/Launcher inspection helpers |
| `modpacks/` | The feature implementations, grouped by target package |
| `utils/` | `SystemUtils`, reflection DSL, bootloop protector, logging, resource helpers |

### `xposed/modpacks/` grouping

55 pack classes across 56 `.kt` files, producing **58 registry rows** because
three packs carry two target annotations each. Counts below are by
**annotation**, which is what decides the target package.

| Annotation | Packs | Target package |
| --- | --- | --- |
| `@SystemUIModPack` | 29 | `com.android.systemui` |
| `@FrameworkModPack` | 12 | `android` (system server) |
| `@LauncherModPack` | 7 | `com.google.android.apps.nexuslauncher` |
| `@SettingsModPack` | 3 | `com.android.settings` |
| `@CommonModPack` | 2 | every scoped package |
| `@DialerModPack` | 1 | `com.google.android.dialer` |
| `@TelecomServerModPack` | 1 | `com.android.server.telecom` |

**Directory location is convention, not configuration.** Two cases prove it:

- `modpacks/systemui/IconPacks.kt` is annotated `@SettingsModPack`, so it runs in
  Settings, not SystemUI.
- `modpacks/MiscSettings.kt` sits at the package root and is annotated
  `@SystemUIModPack`.

Never infer a pack's target from its folder. Read its annotation, or read the
generated registry.

`modpacks/systemui/AutoBrightnessButton.kt` is not a pack; it is a view helper
used by `QSBrightnessSlider`.

The authoritative, per-class catalog with annotations, target packages and
priorities is `docs/reference/modpack-catalog.md`.

### `xposed/utils/reflection/`

The hooking DSL. `ReflectedClass.of(...)` returns a builder that resolves a
class by name, then `.before(...)`/`.after(...)` on a method name returns a
`ReflectedMethod` that `.run(...)`s a lambda. `HookHelper.kt` and `HookId.kt`
hold the hook-id and priority plumbing. Read
`docs/architecture/reflection-and-hooks.md` before editing anything here.

---

## `app/src/main/res/`

| Path | Contents |
| --- | --- |
| `values/` | Default strings, arrays (including `root_requirement`), colors, dimens |
| `values-night/`, `color-night/`, `drawable-night/` | Dark variants |
| `values-<locale>/` | 30 translations. Adding a string means adding it to `values/` first; translations are managed externally |
| `drawable/`, `mipmap-anydpi-v31/`, `font/`, `raw/` | Icons, adaptive icon, fonts, Lottie animations |
| `xml/` | Preference-related XML, file provider paths |

---

## `modPackProcessor/`

A single KSP `SymbolProcessor` (`ModPackProcessor.kt`) plus its
`META-INF/services` registration. At build time it scans for classes annotated
with `@BaseModPack` and the seven target annotations, then emits
`sh.siava.pixelxpert.xposed.ModPacks` — a generated object whose
`getModPacks()` returns the table `XPLauncher` walks.

**Do not hand-write `ModPacks`.** It is generated into
`app/build/generated/ksp/`. If you add a pack and it does not run, check the
generated file before debugging anything else.

---

## `buildSrc/`

| File | Purpose |
| --- | --- |
| `BuildUtils.kt` | `getVersionCode()`, `getVersionName()`, `getVersionNameProvider()` — read `version.properties` and git tags |
| `GitTagProvider.kt` | Resolves the latest git tag for stable versioning |
| `IncrementVersionTask.kt` | The task that bumps `version.properties` and the JSON manifests |

---

## `.github/`

| Path | Purpose |
| --- | --- |
| `workflows/makeCanaryRelease.yml` | Triggered by a push to `canary` that touches `.github/edit2MakeNewCanary` |
| `workflows/makeStableRelease.yml` | Stable counterpart |
| `workflows/makeCanaryTestPackage.yml`, `fullPackageTestBuild.yml`, `xposedPackageTestBuild.yml` | Manual (`workflow_dispatch`) test builds |
| `edit2MakeNewCanary`, `edit2MakeNewStable` | **Trigger files.** Touching one is how a release is started. Their content is not used as config; their modification is the signal. |
| `extractCanaryChanges.sh`, `prepareCanaryChangelog.sh`, `make_debug_zip.sh` | Release helper scripts |
| `workflowFiles/ReleaseNotesTemplate.md`, `FutureChanageLog.md` | Release note templates |
| `ISSUE_TEMPLATE/` | Bug report form and feature request template |

---

## `MagiskModBase/`

The Magisk module payload. `createZip` copies the release APK next to these
files and zips the result into `output/PixelXpertFork-<version>.zip`.

| File | Purpose |
| --- | --- |
| `module.prop` | Module id, name, version, update JSON URL |
| `customize.sh` | Install-time script |
| `service.sh` | Post-boot service script |
| `sqlite3` | Bundled binary used by install scripts |
| `META-INF/com/google/android/update-binary`, `updater-script` | Flashable zip entry points |

---

## Fast orientation paths

| If you need to… | Read |
| --- | --- |
| Understand the whole system in 15 minutes | `docs/agent/QUICKSTART.md` |
| Add a feature that hooks the framework | `docs/guides/add-a-mod-pack.md` |
| Add a user-visible setting | `docs/guides/add-a-preference.md` |
| Build the APK | `docs/guides/build-locally.md` |
| Cut a release | `docs/guides/release-process.md` |
| Find a specific pack | `docs/reference/modpack-catalog.md` |
| Find a preference key | `docs/reference/preference-keys.md` |

---

## See also

- [Quickstart](QUICKSTART.md)
- [Documentation style contract](DOC_STYLE.md)
- [Architecture overview](../architecture/overview.md)
- [Docs index](../README.md)
