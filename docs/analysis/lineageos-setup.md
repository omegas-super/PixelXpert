# LineageOS 24 Setup for PixelXpert

Which packages PixelXpert needs on a LineageOS 24.0 (Android 17) device, which
pack groups work once they are present, and which cannot work regardless of
packaging. Read this before installing or debugging on a non-Pixel ROM.

**Audience:** user or agent setting up PixelXpert on LineageOS
**Prereqs:** [overview](../architecture/overview.md), [modpack-lifecycle](../architecture/modpack-lifecycle.md)

**Status:** point-in-time, 2026-11-01. Package names verified against
`app/src/main/java/sh/siava/pixelxpert/Constants.kt` and
`app/src/main/res/values/xp_module_scope.xml`. Device-specific facts are marked
**unverified**.

---

## Summary

- PixelXpert hooks exactly six package names. Four of them are ROM packages that
  LineageOS already provides; only two are Google packages, and a GApps package
  supplies those.
- **Installing GApps does not replace SystemUI.** The status bar, QS panel, shade
  and keyguard stay LineageOS/AOSP. 31 of 58 registry rows target SystemUI, so
  this is where most of the risk lives.
- **The launcher packs target `com.google.android.apps.nexuslauncher`.** Pixel
  Launcher is that package, so selecting it as the default launcher is the right
  move and it satisfies 7 packs.
- **The dialer pack targets `com.google.android.dialer`.** Google Dialer is that
  package, so that is also satisfied.
- The module requires **libxposed API 102** (`minApiVersion=102` in
  `app/src/main/resources/META-INF/xposed/module.prop`). That means LSPosed.
- There is no way to verify any of this without the device. Run the hook audit
  first; it answers in one pass what cannot be inferred from source.

---

## Model

### The six packages PixelXpert can hook

From `Constants.kt`:

| Constant | Package | Provided by | Required? |
| --- | --- | --- | --- |
| `SYSTEM_UI_PACKAGE` | `com.android.systemui` | LineageOS ROM | Always present |
| `SYSTEM_FRAMEWORK_PACKAGE` | `android` | LineageOS ROM | Always present |
| `SETTINGS_PACKAGE` | `com.android.settings` | LineageOS ROM | Always present |
| `TELECOM_SERVER_PACKAGE` | `com.android.server.telecom` | LineageOS ROM | Always present |
| `LAUNCHER_PACKAGE` | `com.google.android.apps.nexuslauncher` | GApps (Pixel Launcher) | Needed for 7 packs |
| `DIALER_PACKAGE` | `com.google.android.dialer` | GApps (Google Dialer) | Needed for 1 pack |

The module scope in `xp_module_scope.xml` lists five of these (system server is
matched by the `isSystemServer` flag rather than by package name — see
[modpack-lifecycle](../architecture/modpack-lifecycle.md)).

`R.array.root_requirement` in the same file lists only two:
`com.android.systemui` and `com.google.android.apps.nexuslauncher`. Only those two
processes get the root binder.

### Why the launcher and dialer are the only Google dependencies

A useful detail that is easy to miss: the launcher packs do not reference
`com.google.android.apps.nexuslauncher` in their hook code at all. Grepping the
seven launcher packs shows they hook `com.android.launcher3.*` and
`com.android.quickstep.*` — classes that live in the **AOSP Launcher3 base**,
which Pixel Launcher is built on:

| Pack | `launcher3` refs | `quickstep` refs | `nexuslauncher` refs |
| --- | --- | --- | --- |
| `TaskbarActivator` | 14 | 1 | 0 |
| `LauncherGestureNavbarManager` | 3 | 0 | 0 |
| `LauncherThemedIcons` | 2 | 0 | 0 |
| `PixelXpertIconUpdater` | 2 | 0 | 0 |
| `HideNavigationBarInsets` | 1 | 0 | 0 |
| `ClearAllButtonMod` | 0 | 2 | 0 |
| `CustomNavGestures` | 0 | 6 | 0 |

The package name only decides **where the pack is injected**. The classes it hooks
come from Launcher3. **Uncertain:** whether Trebuchet (LineageOS's default
launcher) retains those `com.android.launcher3.*` class names through its own R8
pass. It is Launcher3-derived, so the names are plausible, but a release build may
rename or inline them. That would make re-targeting the annotation a small change
plus a verification pass, not a rewrite — but it is unverified and needs
`LauncherInspector` run against a Trebuchet build before anyone commits to it.

For the configuration this document is about, that question does not arise: Pixel
Launcher is installed and default, so these packs are pointed at the right process
already.

### What actually blocks features

Three independent gates, in order of how many packs each one blocks:

| Gate | Blocks | Fixable by installing an app? |
| --- | --- | --- |
| SystemUI is AOSP, not Pixel | Up to 31 SystemUI rows, depending on class names | No |
| Launcher/dialer package absent | 8 rows | Yes — GApps |
| LSPosed API below 102 | Everything | Yes — use current LSPosed |

The SystemUI gate is the one that matters, and it is the one no GApps package
touches.

---

## Walkthrough

### 1. Confirm the device baseline

```bash
adb shell getprop ro.build.version.release    # 17
adb shell getprop ro.build.version.sdk        # 37
adb shell getprop ro.lineage.version          # lineage-24.0-*
```

### 2. Confirm the six packages exist

```bash
adb shell pm list packages | grep -E \
  'com.android.systemui|com.android.settings|com.android.server.telecom|com.google.android.apps.nexuslauncher|com.google.android.dialer'
```

`android` is the system server and does not appear as an ordinary package; it is
matched by `isSystemServer`.

If `nexuslauncher` is missing, Pixel Launcher is not installed and 7 packs have no
target process. If `com.google.android.dialer` is missing, the dialer pack has
none. Everything else is ROM-provided.

### 3. Confirm the launcher is actually the default

Having Pixel Launcher installed is not enough — the launcher packs run in the
**process** `com.google.android.apps.nexuslauncher`, and that process only starts
when the launcher is used. Setting it as the default home app is what makes the
process exist at boot.

```bash
adb shell cmd package resolve-activity --brief \
  -a android.intent.action.MAIN -c android.intent.category.HOME
```

The output must name `com.google.android.apps.nexuslauncher`. If it names
Trebuchet, the launcher packs will not run until the default is changed.

### 4. Confirm LSPosed, not a bare Xposed

`module.prop` declares `minApiVersion=102` and `targetApiVersion=102`. A framework
that only speaks API 101 will not load the module at all. Use current LSPosed.

### 5. Install the module and verify injection

After installing and scoping the module in LSPosed, open PixelXpert and go to the
**Hooks** page. It broadcasts `ACTION_CHECK_XPOSED_ENABLED` and waits 5 seconds
(`WAIT_TICKS = 10` × `TICK_MS = 500L` in
`app/src/main/java/sh/siava/pixelxpert/ui/hooks/HooksScreen.kt`) for each process
to answer with `ACTION_XPOSED_CONFIRMED`.

Every row should report hooked. A row that stays silent means that process did not
load the module — usually a scope problem in LSPosed, not a PixelXpert problem.

### 6. Run the hook audit before trusting any feature

This is the step that decides which SystemUI features can work on your build. The
audit is a single-pass reflection check that reports `PRESENT`, `ABSENT` or
`INLINED` for each class and method a pack depends on.

- `HookAuditor` answers `ACTION_REQUEST_HOOK_AUDIT`
- `SystemUIInspector` covers SystemUI, `FrameworkInspector` covers `android`,
  `LauncherInspector` covers the launcher
- Results arrive as `ACTION_HOOK_AUDIT_RESULT` with a `ProcessAuditReport` JSON

Read the `ABSENT` rows. Each one is a feature that cannot work on your ROM build,
and the class name tells you whether it is a Pixel-only class or a renamed one.

---

## Contracts

- **A pack runs only in the process named by its annotation's `targetPackage`.**
  Installing an app whose package name differs from that literal does nothing.
- **Pixel Launcher must be the default home app**, not merely installed, or its
  process may never start.
- **Do not expect GApps to change SystemUI.** It cannot.
- **Do not re-scope `Constants.LAUNCHER_PACKAGE` to Trebuchet and expect the
  packs to work unchanged.** The classes they hook (`com.android.launcher3.*`)
  would need verifying against Trebuchet's build, which R8 may have renamed.
- **Only `com.android.systemui` and the launcher are in `root_requirement`.**
  A feature that needs root from another process will silently queue forever.
- **The module needs LSPosed API 102.** Nothing older loads it.

---

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Module not listed as active in LSPosed | Framework older than API 102 | Use current LSPosed |
| Hooks page shows every row "no response" | Module not scoped, or `HookTester` not loaded | Enable scope for all six packages |
| Launcher features do nothing, no log | Pixel Launcher installed but not the default home app | Set it as default; confirm with `resolve-activity` |
| Launcher features do nothing, package present | Launcher3 classes renamed by R8 in that build | Run `LauncherInspector` and read `ABSENT` rows |
| Dialer feature does nothing | `com.google.android.dialer` not installed | Install Google Dialer from GApps |
| SystemUI features partially work | AOSP SystemUI lacks Pixel-only classes | Expected; the audit tells you which |
| `PixelXpert: Possible bootloop in <pkg>. Will not load for now` | 3 failed loads in 60 s | Clear `packageStrike_<pkg>` and `packageLastLoad_<pkg>` |
| Root actions silently do nothing in Settings/Dialer | Those packages are not in `root_requirement` | By design |

---

## Checklist

- [ ] `ro.build.version.release` is 17 and `ro.build.version.sdk` is 37
- [ ] All five ordinary scoped packages are installed
- [ ] Pixel Launcher is the **default home app**, confirmed with `resolve-activity`
- [ ] Google Dialer is installed
- [ ] LSPosed is current enough for API 102
- [ ] Hooks page shows all six processes hooked
- [ ] Hook audit run; `ABSENT` rows read and understood before filing any bug

---

## See also

- [Liquid Glass on LineageOS 24](liquid-glass-and-lineageos.md)
- [Mod pack lifecycle](../architecture/modpack-lifecycle.md)
- [Xposed runtime](../architecture/xposed-runtime.md)
- [Preferences and IPC](../architecture/preferences-and-ipc.md)
