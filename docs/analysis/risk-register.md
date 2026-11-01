# Risk Register

Known hazards in this codebase, ranked by how much damage they do and how hard
they are to notice. Every entry is grounded in code that exists today.

**Audience:** an agent about to change something, or a maintainer triaging
**Prereqs:** [architecture overview](../architecture/overview.md)

**Status:** point-in-time assessment of branch `canary` at commit `b6b0f8df`.
Re-verify before relying on any row.

---

## Summary

- The highest-damage risks are **silent**: they compile, run, and do nothing.
- The two structural ones are the cross-process preference contract and the
  build-time pack registry.
- The codebase deliberately swallows exceptions in hook bodies (161 empty
  `catch` blocks under `xposed/`). That is a reasonable robustness choice and a
  severe debuggability cost.
- Release signing fails open to the debug key with no warning.
- There are no automated tests of any kind.

---

## Severity scale

| Level | Meaning |
| --- | --- |
| Critical | Ships wrong behaviour to users with no signal |
| High | Costs hours of debugging or breaks a release |
| Medium | Adds friction or hides a class of bug |
| Low | Worth knowing, cheap to work around |

---

## Register

### R1 — Preference key drift between processes

**Severity:** Critical
**Detection:** manual only

The app writes a preference under a string key; the hooked process reads it
under the same literal. Nothing type-checks this. `XPrefs.Xprefs` is an
`ExtendedRemotePreferences`; a missing key returns the supplied default
silently.

```kotlin
// app side
pref("my_feature_enabled") { ... }
// xposed side — typo compiles fine, reads default forever
Xprefs.getBoolean("myFeatureEnabled", false)
```

**Why it is critical:** the feature appears in the UI, toggles without error, and
has no effect. There is no log line, because the pack's hook is installed and
simply always takes the disabled branch.

**Mitigation:** `docs/reference/preference-keys.md` lists every key with its
reader. Grep the literal on both sides before concluding a hook is broken.
`scripts/check-docs.mjs` cannot catch this; only discipline does.

---

### R2 — A pack that is not in the generated registry never runs

**Severity:** Critical
**Detection:** inspect the generated file

`XPLauncher.loadModPacks` iterates `ModPacks.getModPacks()`, which is generated
by `:modPackProcessor` from annotations at build time. A pack class that is
missing its target annotation, or annotated with a target that does not match
the process it runs in, is absent from that table.

**Why it is critical:** no error, no log, no crash. The class exists, compiles,
and is dead code.

**Aggravating factor:** directory placement is not configuration.
`modpacks/systemui/IconPacks.kt` carries `@SettingsModPack` and runs in Settings.
An agent that reasons from the folder will get this wrong.

**Mitigation:** after adding a pack, read
`app/build/generated/ksp/<variant>/kotlin/sh/siava/pixelxpert/xposed/ModPacks.kt`
and confirm the class is present with the expected target.

---

### R3 — Release builds silently fall back to debug signing

**Severity:** High
**Detection:** inspect the APK signature

`app/build.gradle.kts` reads `ReleaseKey.properties` from the repo root inside a
`try`/`catch`. On any failure — file absent, malformed, keystore missing — the
catch block is empty and `releaseSigning` remains `signingConfigs.getByName("debug")`.

```kotlin
var releaseSigning = signingConfigs.getByName("debug")
try {
    // ... load ReleaseKey.properties ...
} catch (_: Exception) {
    // silently keeps debug signing
}
```

**Why it is high:** a release build succeeds, produces an APK, and the APK is
signed with the debug key. Users cannot install it over a properly signed
previous version. The failure surfaces at install time on a device, not at build
time.

**Mitigation:** always verify the signing config before distributing. A CI check
that fails the build when `ReleaseKey.properties` is absent in a release
workflow would close this permanently.

---

### R4 — Swallowed exceptions in hook bodies

**Severity:** High
**Detection:** none at runtime

There are 161 empty `catch (ignored: Throwable) {}` blocks and 27 `runCatching`
calls under `xposed/`. Hook bodies catch broadly so that one broken pack cannot
take down SystemUI — a defensible choice for a module that runs inside other
processes.

The cost: when a hook throws, the feature silently does nothing. `XPLauncher`
does log pack construction failures (`"Start Error Dump - Occurred in "`), but
failures inside an already-installed hook are caught where they happen and, in
the empty blocks, discarded.

**Mitigation:** when debugging, temporarily convert the relevant empty catch to a
`Logger.log(t)`. Do not commit the change unless it is a genuine improvement.
When adding a new catch, log first.

---

### R5 — No automated tests

**Severity:** High
**Detection:** obvious

There are no `test` or `androidTest` source sets. Verification is entirely by
inspection and by running on a rooted Pixel device.

**Consequence for agents:** you cannot prove a change works. The honest report is
"written and reviewed, not compiled or executed". Do not claim otherwise.

**Where tests would pay off first:** the `:modPackProcessor` symbol processor is
pure Kotlin with no Android dependency, and it decides which packs run. It is the
single most testable component in the repo, and the one with the widest impact.

---

### R6 — CI commits version bumps back to `canary`

**Severity:** Medium
**Detection:** push rejection

`makeCanaryRelease.yml` ends with `github-actions-x/commit` pushing
`version.properties`, `MagiskModBase/module.prop`, changelogs and the update
manifests back to the branch. It also force-pushes the version tag and the
`canary_builds` tag.

**Consequence:** anyone holding local commits on `canary` when a release runs
gets a rejected push and must rebase.

**Mitigation:** fetch before pushing; rebase rather than merge. Do not work
directly on `canary` for long-lived changes.

---

### R7 — Release trigger is a file touch, not a command
**Severity:** Medium
**Detection:** reading the workflow

`makeCanaryRelease.yml` triggers on a push to `canary` whose changed paths
include `.github/edit2MakeNewCanary`. The file's contents are irrelevant; the
modification is the signal.

**Consequence:** an agent that edits that file while making unrelated changes
starts a release. Conversely, an agent trying to start a release by editing
`version.properties` will not trigger anything.

**Mitigation:** treat `.github/edit2MakeNewCanary` and `.github/edit2MakeNewStable`
as reserved. See [release-process](../guides/release-process.md).

---

### R7b — The stable release pipeline targets a branch that does not exist

**Severity:** High
**Detection:** `git ls-remote --heads origin`

`makeStableRelease.yml` is written against a branch named `main`. The repository
has no `main` branch, upstream or on the fork. The actual branch set is:
`auto_brightness`, `canary`, `canary-localization`,
`feature/kotlin-libxposed-v3`, `feature/statusbar-text-styling`,
`fix/qs-brightness-recompose`, `inject`, `libxposed-api-102`, `pre-a16qprb`,
`stable`.

What this breaks in that workflow:

| Step | Problem |
| --- | --- |
| `git clone --branch main --single-branch` | Fails outright; there is no such ref |
| `git push … HEAD:refs/heads/stable --force` | Force-pushes a tree built from a branch that never cloned |
| `github-actions-x/commit` with `push-branch: 'main'` | Commits to a nonexistent branch |
| Changelog URLs in `latestStable.json`, `MagiskModuleUpdate_*.json` | Point at `raw.githubusercontent.com/<repo>/main/…`, which 404s |
| `sed -i 's|/canary/MagiskModuleUpdate_|/main/MagiskModuleUpdate_|g'` | Rewrites `module.prop` URLs toward the same dead path |

The trigger is also `branches: [main]` plus
`paths: ['.github/edit2MakeNewStable']`, so the stable trigger file cannot fire
from `canary` either.

**Conclusion:** the `canary` copy of the stable pipeline cannot run as written, and
because it is the copy that has been producing the published manifests, the damage
is already live. Canary releases are unaffected —
`makeCanaryRelease.yml` correctly targets `canary`.

**Verified live (2026-11-01):**

| URL | Status |
| --- | --- |
| `raw.githubusercontent.com/Codecity001/PixelXpert/stable/latestStable.json` | 200 — serves a manifest whose `changelog` points at `…/main/StableChangelog.md` |
| `raw.githubusercontent.com/Codecity001/PixelXpert/stable/MagiskModuleUpdate_Xposed.json` | 200 — same dead pointer |
| `raw.githubusercontent.com/Codecity001/PixelXpert/main/StableChangelog.md` | **404** |
| `raw.githubusercontent.com/Codecity001/PixelXpert/stable/StableChangelog.md` | 200 |

So a working manifest is being served that directs Magisk and the in-app updater at
a changelog URL which does not exist. The failure is in the published artifact, not
merely in a workflow that has yet to run.

**Mitigation:** repoint the workflow at `stable`, which exists and which the
workflow already force-pushes to, and republish the two manifests. Do not attempt a
stable release until this is resolved. See
[release-process](../guides/release-process.md).

---

### R7c — The two branches carry different release workflows

**Severity:** Medium
**Detection:** `git show origin/stable:.github/workflows/makeStableRelease.yml`

The `canary` and `stable` branches do not contain the same release tooling. They
are not interchangeable, and reading one tells you nothing certain about the other.

| Fact | On `canary` | On `stable` |
| --- | --- | --- |
| `extractStableChanges.sh` under `.github/` | absent | **present** |
| `makeStableRelease.yml` clone target | `--branch main` | `--branch stable` |
| `makeStableRelease.yml` push target | `HEAD:refs/heads/stable` | `stable` |
| Changelog step | copies `StableChangelog.md` verbatim | runs `extractStableChanges.sh` |

So the stable pipeline is not uniformly broken: the `stable` branch copy names a
branch that exists, while the `canary` branch copy names `main`, which exists
nowhere. The `canary` copy is the one that cannot run.

**Consequence for an agent:** a claim of the form "the release script does X" must
name the branch it was read from. Verifying a path with `Test-Path` in a `canary`
worktree proves only that it is absent from `canary`.

**Mitigation:** use `git cat-file -e <branch>:<path>` or
`git show <branch>:<path>` when reasoning about another branch's tooling.

---

### R8 — Bootloop protector is per-package, time-windowed, and persists

**Severity:** Medium
**Detection:** the package simply stops loading

`BootLoopProtector.isBootLooped` counts strikes in shared preferences under
`packageStrike_<pkg>` and resets when more than 60 seconds have passed since
`packageLastLoad_<pkg>`. Three strikes inside a minute and the package is skipped
with the log line:

```text
PixelXpert: Possible bootloop in <pkg>. Will not load for now
```

**Consequence:** a genuine crash loop is contained, which is the point. But an
agent iterating quickly — three module loads inside a minute — can trip it and
conclude its change broke everything.

**Mitigation:** if a package stops loading, check those two preference keys. The
counter resets after 60 seconds without a load.

---

### R9 — Hot reload state can pin a retired generation

**Severity:** Medium
**Detection:** leak, grows across reloads

`XposedModPack.onSaveHotReloadState` receives a map that is carried to the next
generation. The KDoc is explicit that only framework objects may be stored. A
module object placed in that map keeps the old classloader and everything it
references alive.

**Mitigation:** treat the map as framework-objects-only. Release module state in
`onUnloaded` instead.

---

### R10 — Preference change fan-out is O(packs) on every write

**Severity:** Low
**Detection:** profiling

`XPrefs.loadEverything` calls `onPreferenceUpdated` on every running pack for
every changed key. Packs are expected to filter on the key argument. A pack that
ignores the argument and does heavy work on every change causes jank in SystemUI.

**Mitigation:** in `onPreferenceUpdated`, return early unless the changed key is
one you care about, and handle the no-keys case (full load).

---

### R11 — `extractSubject` is unimplemented but has a live caller

**Severity:** Medium
**Detection:** read the throw site and its caller

`PixelXpertProxy.extractSubject` unconditionally throws:

```kotlin
override fun extractSubject(input: Bitmap?, method: Int): Bitmap? = throw RemoteException(
    "PixelXpertProxy.extractSubject is not ported yet: " +
        "it is only reachable from the DepthWallpaper mod pack, " +
        "which is not part of this slice.",
)
```

The justification is stale. `DepthWallpaper.kt` **is** in the tree, carries
`@SystemUIModPack`, and calls it at `app/src/main/java/sh/siava/pixelxpert/xposed/modpacks/systemui/DepthWallpaper.kt:226`:

```kotlin
val subjectBitmap = XPLauncher.getRootProviderProxy()?.extractSubject(finalScaledWallpaperBitmap, SegmentorAI)
```

The caller catches broadly, so the `RemoteException` is discarded. The depth-wallpaper
subject mask therefore never gets produced, with no user-visible error and no log
line.

**Why it is medium, not critical:** the feature degrades rather than crashes. But it
is a shipped, selectable option that cannot work.

**Mitigation:** either implement `extractSubject` — the ML Kit dependency is already
declared in `app/build.gradle.kts` as
`play-services-mlkit-subject-segmentation` — or remove the feature toggle. Do not
trust the stale comment as evidence of scope.

---

### R12 — `XposedRuntime.detach()` and `unhookAll()` have no callers

**Severity:** Low
**Detection:** grep

The only reachable teardown path is `XposedGeneration.retire()`, which deliberately
leaves hooks installed so the successor generation can replace them by id.
`detach()` and `unhookAll()` are dead. An agent looking for "the unload path" will
find three methods and only one of them is live.

**Mitigation:** read [hot-reload](../architecture/hot-reload.md) before assuming
which teardown path applies.

---

### R14 — `NetworkStatsStartTime` is written as `Int` and read as `String`

**Severity:** High
**Detection:** compare the write site with the read site

`PrefStore` persists a `TimePref` as an `Int`:

```kotlin
// app/src/main/java/sh/siava/pixelxpert/data/PrefStore.kt:218
is sh.siava.pixelxpert.ui.prefs.node.TimePref ->
    putInt(pref.key, value?.toIntOrNull() ?: 0)
```

`MiscSettings` reads the same key as a `String`:

```kotlin
// app/src/main/java/sh/siava/pixelxpert/xposed/modpacks/MiscSettings.kt:42
LocalTime.parse(Xprefs.getString("NetworkStatsStartTime", "0:0"), DateTimeFormatter.ofPattern("H:m"))
```

`SharedPreferences.getString` on an `Int` entry throws `ClassCastException`. The
throw happens inside `onPreferenceUpdated`, which `XPLauncher.loadModPack` wraps in
an empty catch, so the rest of that pack's initialisation is silently abandoned.

Note the value is also lossy: `"00:00"` becomes `0` on write, so even a correct
string read would parse `"0"` rather than `"00:00"`.

**Why it is high:** a shipped feature's pack partially initialises and reports
nothing. It is the clearest instance of the class of bug described in R1 and R4.

**Mitigation:** either make `TimePref` persist as a string, or read it as an `Int`
and format it on the reader side. Both sides must agree on the type as well as the
key name.

---

### R15 — Three independent defaults per preference key, unsynchronised

**Severity:** Medium
**Detection:** cross-check the node, the defaults map, and the pack literal

A preference key can carry a default in three places:

| Source | Example |
| --- | --- |
| The `PrefNode` declaration | `TimePref(key = "NetworkStatsStartTime", default = "00:00")` |
| The `preferenceDefaults` map | `"NetworkStatsStartTime" to "00:00"` |
| The reader's fallback literal | `Xprefs.getBoolean(key, false)` |

Nothing keeps them in agreement, and drift exists today in `NotificationIconLimit`,
`NotificationAODIconLimit`, `SleepOnFlatScreen`, `appLanguage` and
`UpdateWifiOnly`. `UpdateWifiOnly` has a third value at its `UpdateWorker` read
site.

`preferenceDefaults` is read by exactly one call site, `PrefRenderer.enabledBy`, so
a missing entry is invisible unless another node names that key as a `dependency`.
Two keys (`qsStatusbarPaddings`, `clockMultiRowStartOffset`) are already absent from
the map.

**Mitigation:** treat the node's `default` as authoritative, and make the reader's
fallback literal match it. See [add-a-preference](../guides/add-a-preference.md).

---

### R16 — Two documented capabilities are not implemented

**Severity:** Low
**Detection:** grep for readers of the property

- `SearchEntry.key` is populated by the search index but read by no caller. Search
  finds and navigates to a screen, but never scrolls to or highlights the matched
  row, despite the `SearchIndex`/`SearchScreen` KDocs implying it does.
- `PrefScreen.title` is declared but read by no caller. Headings come from
  `Route.Pref.title` — the pushing row's `@StringRes`. Setting `PrefScreen.title`
  has no effect.

**Mitigation:** do not rely on either property. If you need a heading, set it on the
row that pushes the screen.

---

### R17 — `sleep_on_flat_prefs` is unreachable by navigation

**Severity:** Low
**Detection:** grep the route registry

`sleep_on_flat_prefs` appears in both `preferenceScreens` (21 entries) and
`searchScreenTitles` (20 entries), but it has no route id in `routeToScreenKey`
(18 entries) and no `NavRow` pointing at it. Search is the only way to reach it.

This may be intentional, but nothing in the code says so. The three registries are
different sizes by design: `searchScreenTitles` deliberately excludes
`header_preferences`.

**Mitigation:** treat as a probable gap rather than documented behaviour.

---

### R18 — `com.android.server.telecom` is absent from `scope.list`, so telecom packs never load

**Severity:** Critical
**Detection:** compare `scope.list` against the target annotations

`app/src/main/resources/META-INF/xposed/scope.list` ships five entries:

```text
com.android.systemui
com.google.android.apps.nexuslauncher
system
com.android.settings
com.google.android.dialer
```

`com.android.server.telecom` is missing, yet `@TelecomServerModPack` exists in
`app/src/main/java/sh/siava/pixelxpert/xposed/annotations/TelecomServerModPack.kt`
with `targetPackage = Constants.TELECOM_SERVER_PACKAGE`, and `CallVibrator`
carries it.

`app/src/main/resources/META-INF/xposed/module.prop` sets `staticScope=true`,
which means libxposed loads the module only into the processes named in
`scope.list`. The telecom server is not one of them, so the module is never
loaded there, so `CallVibrator` is never constructed.

**Why it is critical:** this affects every device, Pixel included, and has done
so for as long as the scope list has been in this state. It is silent: no log
line, no error, no crash. The pack exists, compiles, and is dead.

**Scope of the defect:** `CallVibrator` is the only pack carrying
`@TelecomServerModPack`, so exactly one feature is affected.

**Mitigation:** add `com.android.server.telecom` to `scope.list`. Fixed on branch
`fix/lineageos-scope-and-trebuchet` and **confirmed in a compiled artifact**: the
built APK's `META-INF/xposed/scope.list` now carries seven entries including
`com.android.server.telecom`, and the string is present in `classes.dex`. The
build succeeded on CI run 41312733798.

---

### R19 — The launcher packs have no process to run in on a ROM without Pixel Launcher

**Severity:** High (for non-Pixel ROMs only)
**Detection:** `pm list packages | grep nexuslauncher`

The seven launcher packs carry `@LauncherModPack`, which targets
`com.google.android.apps.nexuslauncher`. That package exists only when a Google
apps package has installed Pixel Launcher. On a ROM whose launcher is Trebuchet,
the package is `com.android.launcher3` and the Pixel package is absent, so
`loadModPacks` finds no match and no launcher pack is constructed.

The packs themselves hook `com.android.launcher3.*` and `com.android.quickstep.*`
— the AOSP Launcher3 base — not anything Pixel-specific. Verified per pack:
`TaskbarActivator` 14 `launcher3` / 1 `quickstep` / 0 `nexuslauncher` references,
and zero `nexuslauncher` references across all seven.

**Mitigation:** add a `@TrebuchetModPack` annotation targeting
`com.android.launcher3` and carry it alongside `@LauncherModPack` on the seven
packs. Implemented on branch `fix/lineageos-scope-and-trebuchet` and **confirmed
to compile**: CI run 41312733798 succeeded, the generated registry picked up
`TrebuchetModPack`, and `com.android.launcher3` appears in `classes.dex`.

**Still unverified:** whether Trebuchet's release build retains those class names
through its own R8 pass. Compiling proves the annotation resolves and the pack
registers for the new target; it does not prove the hooks find their classes on a
real Trebuchet build. If they do not, the packs' existing
`catch (ignored: Throwable)` swallows the failure rather than crashing. Needs a
`LauncherInspector` run on a Trebuchet device to confirm.

---

### R20 — The launcher audit returns nothing on a non-Pixel launcher

**Severity:** High
**Detection:** request an audit on a Trebuchet device and watch for a reply

`HookAuditor` dispatches on the target package with a `when`, and only the Pixel
Launcher branch existed:

```kotlin
Constants.LAUNCHER_PACKAGE -> LauncherInspector.inspect(PRParam.classLoader)
else -> null
```

The result is guarded by `if (report != null)`, so a `null` produces no broadcast
at all. On a Trebuchet device the launcher branch never matched, the `when` fell
through, and the audit silently returned nothing — no report, no error, no
timeout message.

`LauncherInspector` compounded it by hardcoding the Pixel package in both the
report's `packageName` and its `processName`, so even a successful audit would
have described a package the device does not have.

**Why it is high:** this is the instrument that answers "does this module work on
my ROM". On a non-Pixel launcher it returns silence, which reads as "not hooked"
rather than "not asked".

**Mitigation:** dispatch both launcher packages and report the process the module
is actually running in. Fixed on branch `fix/lineageos-scope-and-trebuchet` as
commit `a468e16c`, and confirmed in a compiled artifact: `com.android.launcher3`
and the `LauncherInspector` class both appear in `classes.dex` of CI build
41317346425.

---

### R13 — No local toolchain in this checkout

**Severity:** Low (environmental)
**Detection:** immediate

There is no JDK, no Android SDK, and no Gradle cache. `java -version` fails;
`./gradlew` cannot run.

**Mitigation:** [build-locally](../guides/build-locally.md). Until then, all
verification is by reading.

---

## What is notably healthy

Worth recording, so an agent does not "fix" these:

- `XposedGeneration` gives every hook, thread and cleanup exactly one owner. The
  retire model is clean.
- `installOnce` releases its key on failure, so a transient error does not
  permanently mark work as done.
- `BootLoopProtector` uses `commit()` rather than `apply()` deliberately, with a
  comment explaining that a lost write would defeat the protection.
- `XPrefs` documents why its `lateinit` is non-null and why the defensive
  `if (Xprefs == null) return` was removed from packs.
- `XPLauncher` runs the system-server preference wait on a tracked thread rather
  than blocking main, with the reason stated.

---

## Checklist

Before starting work, decide:

- [ ] Does my change cross the app/hook boundary? If yes, R1 applies.
- [ ] Am I adding a pack? If yes, R2 applies.
- [ ] Am I touching build or signing? If yes, R3 applies.
- [ ] Am I debugging a silent failure? R4 is the likely cause.
- [ ] Am I touching `.github/edit2Make*`? If yes, R7 applies.
- [ ] Am I attempting a stable release? R7b blocks it entirely.
- [ ] Am I iterating on-device quickly? If yes, R8 may trip.
- [ ] Am I relying on `PixelXpertProxy`? R11 applies.
- [ ] Am I adding or reading a `TimePref`? R14 applies.
- [ ] Am I adding a preference default? R15 applies.
- [ ] Am I adding a target annotation? R18 applies — the package must also appear
      in `scope.list` or the module never loads there.

---

## See also

- [Architecture overview](../architecture/overview.md)
- [Agent readiness](agent-readiness.md)
- [Preferences system](../architecture/preferences-system.md)
- [Release process](../guides/release-process.md)
