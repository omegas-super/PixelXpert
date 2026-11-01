# Mod Pack Catalog

Every mod pack class the module can load, the annotation that decides where it loads, the
package it resolves to, its registry priority and its child-process restriction. Read this to
answer "which class owns this feature" and "which process does it run in".

**Audience:** agent or contributor looking for the owner of a feature
**Prereqs:** `docs/agent/DOC_STYLE.md`, `docs/architecture/modpack-lifecycle.md`

## Summary

- 55 mod pack classes live under `app/src/main/java/sh/siava/pixelxpert/xposed/modpacks/` in 56 Kotlin files; one file, `app/src/main/java/sh/siava/pixelxpert/xposed/modpacks/systemui/AutoBrightnessButton.kt`, is a helper view and not a pack, and one file, `app/src/main/java/sh/siava/pixelxpert/xposed/modpacks/MiscSettings.kt`, holds a pack declared at the package root rather than in a target subdirectory.
- `:modPackProcessor` emits 58 registry rows from those 55 classes, because three classes carry two target annotations each: 55 + 3 = 58.
- A pack's target comes from its annotation, never from its folder. `IconPacks` sits under `systemui/` and is annotated for both SystemUI and Settings.
- Default priority is 99. Only three packs override it: `BatteryDataProvider` and `ThermalProvider` at 1, `LockscreenProtectionFramework` at 10.
- Two packs are child-process aware. `ScreenshotManager` is restricted to SystemUI processes whose name contains `screenshot`; `CallVibrator` carries the empty marker plus `@MainProcessModPack` so the telecom server is never treated as child-process only.
- `@CommonModPack` resolves to the empty target package, which `XPLauncher.loadModPacks` reads as "every scoped package".

## How this catalog is derived

The catalog is generated from source, not maintained by hand. Three inputs define every row.

| Input | What it contributes |
| --- | --- |
| `app/src/main/java/sh/siava/pixelxpert/annotations/BaseModPack.kt` | The meta-annotation the processor scans for, carrying `targetPackage`. |
| `app/src/main/java/sh/siava/pixelxpert/xposed/annotations/` | The seven target annotations, each a `@BaseModPack` with one package constant from `Constants.kt`. |
| `modPackProcessor/src/main/kotlin/sh/siava/pixelxpert/registry/ModPackProcessor.kt` | The resolution rules: default priority 99, one row per (pack class, target annotation) pair, `targetsMainProcess = childProcessName == null \|\| hasMainProcess`. |

The processor walks each of the seven target annotations, collects the classes annotated with it, and
emits one `ModPackData` row per class. It sorts the rows by priority, then target package, then
class name, and writes them into `sh.siava.pixelxpert.xposed.ModPacks`. A class annotated twice
produces two rows, which is why the registry is larger than the class count.

The `summary` column is written by hand from each class KDoc and the preference keys its
`onPreferenceUpdated` reads. Everything else is machine-derived.

To regenerate:

```bash
# 1. enumerate the pack files
find app/src/main/java/sh/siava/pixelxpert/xposed/modpacks -name "*.kt" | sort

# 2. read the annotation, priority and child-process marker of each class
grep -rn -E "^@(SystemUI|Framework|Launcher|Settings|Dialer|TelecomServer|Common)ModPack|^@ModPackPriority|^@ChildProcessModPack|^@MainProcessModPack" \
  app/src/main/java/sh/siava/pixelxpert/xposed/modpacks

# 3. after a build, read what the processor actually emitted
cat app/build/generated/ksp/*/kotlin/sh/siava/pixelxpert/xposed/ModPacks.kt
```

The JSON companion at [data/modpack-catalog.json](data/modpack-catalog.json) carries the same rows
and is the file tooling should read.

## Count reconciliation

The three counts that are easy to confuse, and how they relate.

| Count | Value | What it is |
| --- | --- | --- |
| Kotlin files | 56 | Every `.kt` file under `app/src/main/java/sh/siava/pixelxpert/xposed/modpacks/`. |
| Files holding a pack class | 55 | The 56 minus `systemui/AutoBrightnessButton.kt`, which declares a `View` subclass and no `XposedModPack`. |
| Pack classes | 55 | One per file that holds a pack; no file holds two. |
| Registry rows | 58 | One per (class, target annotation) pair. 55 classes + 3 extra rows from the three dual-annotated classes = 58. |

Rows per target annotation, which must sum to the row count:

| Annotation | Rows |
| --- | --- |
| `@SystemUIModPack` | 31 |
| `@FrameworkModPack` | 13 |
| `@LauncherModPack` | 7 |
| `@SettingsModPack` | 3 |
| `@DialerModPack` | 1 |
| `@TelecomServerModPack` | 1 |
| `@CommonModPack` | 2 |
| **Total** | **58** |

The row total is the number a reader should reconcile against, not the file count. A pack class
annotated twice is constructed separately in each matching process and is listed once per section.

## SystemUI

Target package `com.android.systemui`. Annotation: `@SystemUIModPack`.

| Class | File | Priority | Child process | Summary |
| --- | --- | --- | --- | --- |
| `MiscSettings` | `MiscSettings.kt` | 99 | - | Fan-out sink for the misc settings: pushes the network-stats formatting state into StringFormatter and runs the root commands behind display override, volume steps, the SystemUI tuner and the VoLTE / hotspot overrides. |
| `BrightnessRange` | `android/BrightnessRange.kt` | 99 | - | Restricts screen brightness to the configured range, in DisplayPowerController and in the BrightnessInfo the slider UI reads. |
| `StatusbarSize` | `android/StatusbarSize.kt` | 99 | - | Scales the status bar height and, with the cutout switch on, replaces the display cutout with DisplayCutout.NO_CUTOUT. |
| `BatteryDataProvider` | `systemui/BatteryDataProvider.kt` | 1 | - | Publishes battery level, charging, fast-charging and power-save state to the other packs that read it. |
| `CaffeineTile` | `systemui/CaffeineTile.kt` | 99 | - | Gives the module caffeine tile its keep-awake behaviour: click cycles 5, 10 and 30 minutes, long click switches to infinite. |
| `CursorControlKeys` | `systemui/CursorControlKeys.kt` | 99 | - | Draws cursor left/right buttons over the gesture navigation bar while the keyboard is open and injects DPAD key events. |
| `DepthWallpaper` | `systemui/DepthWallpaper.kt` | 99 | - | Builds the lock-screen depth wallpaper: wallpaper layer, AI-segmented subject cutout and dimming veil, optionally on AOD. |
| `EasyUnlock` | `systemui/EasyUnlock.kt` | 99 | - | Dismisses the keyguard once the learned secret length is reached and the credential verifies, and can raise the bouncer on wake. |
| `FeatureFlagsMods` | `systemui/FeatureFlagsMods.kt` | 99 | - | Tells the clipboard overlay the remote-action flag is on and chooses whether the LTE icon reads as 4G. |
| `FingerprintWhileDozing` | `systemui/FingerprintWhileDozing.kt` | 99 | - | Stops KeyguardUpdateMonitor from polling the fingerprint sensor while the device is dozing. |
| `GestureNavbarManager` | `systemui/GestureNavbarManager.kt` | 99 | - | Enables or disables the left and right back gesture and sets how tall each edge region is. |
| `HighBrightnessFlashlightTile` | `systemui/HighBrightnessFlashlightTile.kt` | 99 | - | Gives the module high-brightness torch tile its click, long-click and subtitle behaviour. |
| `IconPacks` | `systemui/IconPacks.kt` | 99 | - | Serves drawables from the selected icon pack in place of the original resources. |
| `KeyGuardPinScrambler` | `systemui/KeyGuardPinScrambler.kt` | 99 | - | Shuffles the PIN bouncer digits on both the view-based and the Compose keypad. |
| `KeyguardMods` | `systemui/KeyguardMods.kt` | 99 | - | Keyguard customisation: carrier text, middle custom text, charging info, forced AOD while charging, dim amount, hidden avatar, transparent bottom buttons and the torch animation. |
| `LockscreenProtectionSystemUI` | `systemui/LockscreenProtectionSystemUI.kt` | 99 | - | Blocks the Quick Settings connectivity tiles and the SystemUI power menu while the device is locked. |
| `MultiStatusbarRows` | `systemui/MultiStatusbarRows.kt` | 99 | - | Replaces the status bar icon container with a multi-row container and applies the icon sort plan. |
| `NotificationExpander` | `systemui/NotificationExpander.kt` | 99 | - | Adds expand-all and collapse-all footer buttons and applies the default expansion mode. |
| `NotificationManager` | `systemui/NotificationManager.kt` | 99 | - | Sets how long heads-up notifications stay up and makes ongoing notifications non-dismissable. |
| `PowerMenu` | `systemui/PowerMenu.kt` | 99 | - | Adds bootloader, soft-reboot and SystemUI-restart entries to the power dialog and relabels the system power-options row. |
| `QSBrightnessSlider` | `systemui/QSBrightnessSlider.kt` | 99 | - | Moves the brightness slider below the tiles, into collapsed QS, and adds the adaptive-brightness button, by reordering the panel composables. |
| `QSTileGrid` | `systemui/QSTileGrid.kt` | 99 | - | Sets the Quick Settings tile rows and columns for portrait and landscape, the quick-QS row count and the tile label scale. |
| `ScreenGestures` | `systemui/ScreenGestures.kt` | 99 | - | Double tap to sleep and wake, tap or pick up to show the ambient display, and press-and-hold to light the torch. |
| `ScreenRecord` | `systemui/ScreenRecord.kt` | 99 | - | ORs the secure virtual-display flag into MediaProjection.createVirtualDisplay so the recorder can capture restricted content. |
| `ScreenshotManager` | `systemui/ScreenshotManager.kt` | 99 | `screenshot` | Silences the screenshot shutter and lets the screenshot chord capture secure content. |
| `StatusIconTuner` | `systemui/StatusIconTuner.kt` | 99 | - | Applies the per-area ignored icon lists to the status bar, the shade header and the keyguard. |
| `StatusbarGestures` | `systemui/StatusbarGestures.kt` | 99 | - | One-finger Quick Settings pull-down and pull-up on the status bar, plus the long-press app switch shortcut. |
| `StatusbarMods` | `systemui/StatusbarMods.kt` | 99 | - | Status bar content and layout: clock position and format, clock colours, network traffic, battery bar, extra icon slots, privacy chip and roaming state. |
| `ThermalProvider` | `systemui/ThermalProvider.kt` | 1 | - | Publishes the device thermal readings in Celsius or Fahrenheit to the rest of the module. |
| `UDFPSManager` | `systemui/UDFPSManager.kt` | 99 | - | Hides the under-display fingerprint icon and/or its background circle. |
| `VolumeTile` | `systemui/VolumeTile.kt` | 99 | - | Gives the module media-volume tile its alert-slider dialog, mute toggle and percentage icon. |

## Framework

Target package `android`. Annotation: `@FrameworkModPack`.

| Class | File | Priority | Child process | Summary |
| --- | --- | --- | --- | --- |
| `AdbWifiPortPin` | `android/AdbWifiPortPin.kt` | 99 | - | Pins the wireless-debugging adb port by forwarding the configured port to the port adbd actually chose. |
| `BrightnessRange` | `android/BrightnessRange.kt` | 99 | - | Restricts screen brightness to the configured range, in DisplayPowerController and in the BrightnessInfo the slider UI reads. |
| `FaceUpScreenSleep` | `android/FaceUpScreenSleep.kt` | 99 | - | Puts the device to sleep after it has been lying still and face up for the configured time. |
| `GestureNavbarManager` | `android/GestureNavbarManager.kt` | 99 | - | Removes the IME navigation row (back chevron and keyboard switcher) that gesture navigation draws under the keyboard. |
| `HotSpotController` | `android/HotSpotController.kt` | 99 | - | Applies the hidden-SSID, client-approval, shutdown-timeout and client-cap settings to every SoftApConfiguration the framework builds. |
| `LockscreenProtectionFramework` | `android/LockscreenProtectionFramework.kt` | 10 | - | Blocks the power menu and the Power + Volume Up chord while the device is locked. |
| `PackageManager` | `android/PackageManager.kt` | 99 | - | Bypasses the mismatched-signature and version-downgrade install checks, and resets both switches five minutes after they were enabled. |
| `PhoneWindowManager` | `android/PhoneWindowManager.kt` | 99 | - | Hosts the receiver behind the home, back, sleep and app-profile-switch broadcasts, and publishes whether a profile switch is available for the focused app. |
| `ScreenOffKeys` | `android/ScreenOffKeys.kt` | 99 | - | Remaps the power-key long press, the double-press camera gesture and the volume keys while the screen is off, and lets the volume keys step the torch level. |
| `ScreenRotation` | `android/ScreenRotation.kt` | 99 | - | Forces every screen rotation to be allowed by taking over DisplayRotation.rotationForOrientation. |
| `StatusbarSize` | `android/StatusbarSize.kt` | 99 | - | Scales the status bar height and, with the cutout switch on, replaces the display cutout with DisplayCutout.NO_CUTOUT. |
| `SystemScreenRecord` | `android/SystemScreenRecord.kt` | 99 | - | Lets the SystemUI screen recorder capture secure content by answering yes in DisplayManagerService.canProjectSecureVideo for that caller. |
| `TargetOptimizer` | `android/TargetOptimizer.kt` | 99 | - | Runs cmd package compile -m speed -f for every scoped package once per build ID, through the root proxy. |

## Launcher

Target package `com.google.android.apps.nexuslauncher`. Annotation: `@LauncherModPack`.

| Class | File | Priority | Child process | Summary |
| --- | --- | --- | --- | --- |
| `ClearAllButtonMod` | `launcher/ClearAllButtonMod.kt` | 99 | - | Adds a floating clear-all button to the Recents screen and mirrors the system button visibility and tint. |
| `CustomNavGestures` | `launcher/CustomNavGestures.kt` | 99 | - | Turns launcher edge swipes (left, right, two-finger and long swipe) into the configured actions. |
| `HideNavigationBarInsets` | `launcher/HideNavigationBarInsets.kt` | 99 | - | Removes the launcher taskbar's reservation of the navigation bar inset. |
| `LauncherGestureNavbarManager` | `launcher/LauncherGestureNavbarManager.kt` | 99 | - | Resizes the taskbar gesture pill and optionally recolors it with the monet accent. |
| `LauncherThemedIcons` | `launcher/LauncherThemedIcons.kt` | 99 | - | Renders a monochrome icon layer for launcher builds that no longer ship one, and records whether the build has its own generator. |
| `PixelXpertIconUpdater` | `launcher/PixelXpertIconUpdater.kt` | 99 | - | Asks the launcher to re-check the module package icon on every activity resume, so an icon swap shows without a reboot. |
| `TaskbarActivator` | `launcher/TaskbarActivator.kt` | 99 | - | Forces the taskbar on or off, reorders the three-button layout, and applies the taskbar height and corner-radius overrides. |

## Settings

Target package `com.android.settings`. Annotation: `@SettingsModPack`.

| Class | File | Priority | Child process | Summary |
| --- | --- | --- | --- | --- |
| `AppCloneEnabler` | `settings/AppCloneEnabler.kt` | 99 | - | Re-enables the Settings app-clone screens and the delete-all-clones menu entry on builds that hide them. |
| `PXSettingsLauncher` | `settings/PXSettingsLauncher.kt` | 99 | - | Adds the module entry to the Settings homepage, with the alternate icon when the expressive theme is active. |
| `IconPacks` | `systemui/IconPacks.kt` | 99 | - | Serves drawables from the selected icon pack in place of the original resources. |

## Dialer

Target package `com.google.android.dialer`. Annotation: `@DialerModPack`.

| Class | File | Priority | Child process | Summary |
| --- | --- | --- | --- | --- |
| `RecordingMessage` | `dialer/RecordingMessage.kt` | 99 | - | Silences the Google Dialer call-recording voice prompts and their text-to-speech announcement. |

## Telecom

Target package `com.android.server.telecom`. Annotation: `@TelecomServerModPack`.

| Class | File | Priority | Child process | Summary |
| --- | --- | --- | --- | --- |
| `CallVibrator` | `android/CallVibrator.kt` | 99 | `""` (marker empty, main process too) | Vibrates when a call is answered and when it drops. |

## Common

Target package `""`. `XPLauncher.loadModPacks` treats an empty target as "every scoped package",
so these packs run in all five scoped processes and in system server.

| Class | File | Priority | Child process | Summary |
| --- | --- | --- | --- | --- |
| `HookAuditor` | `allApps/HookAuditor.kt` | 99 | - | Answers a hook audit request with a single-pass reflection inspection of the hosting process and posts the report back as JSON. |
| `HookTester` | `allApps/HookTester.kt` | 99 | - | Answers the Hooks page ping, naming the process it runs in so the page can report the package as hooked. |

## Cross-target packs

Three classes carry two target annotations. The processor emits one registry row for each, so the
same class appears in two sections above and twice in the JSON.

| Class | Targets | Why |
| --- | --- | --- |
| `BrightnessRange` | SystemUI + Framework | The framework clamps the candidate brightness; SystemUI exposes the min and max the slider may show. |
| `StatusbarSize` | Framework + SystemUI | The window manager derives the cutout and the status bar height; SystemUI reads the same height. |
| `IconPacks` | SystemUI + Settings | The four `Resources.getDrawable` overloads are hooked in both processes. |

## Failure modes

| Symptom | Cause | Detection | Fix |
| --- | --- | --- | --- |
| A pack never runs | The annotation targets a package the process is not | Read the generated `ModPacks` table; a missing row means the class carries no target annotation | Add exactly one target annotation, or move the class out of `modpacks/` if it is a helper |
| A pack runs in the wrong process | Folder-based assumption instead of the annotation | `grep -n "^@" <file>` shows the annotation; compare with this catalog | Correct the annotation, not the folder |
| A pack that needs a child process never sees it | `@ChildProcessModPack` without `@MainProcessModPack`, on a process whose name does not contain the marker | `XPLauncher.loadModPacks` gates on `processName.contains(childProcessName)` | Add `@MainProcessModPack`, or fix the marker string |
| A pack that reads another pack's statics sees null | Its priority is 99 and the provider has not loaded yet | The provider pack in question uses `@ModPackPriority(priority = 1)` | Lower the consumer's priority number so it sorts after the provider |
| This catalog lists a class that no longer exists | A pack was renamed or deleted and the table was not regenerated | The file-path check in the checklist below | Regenerate from source |

## Checklist

- [ ] Row count in the JSON equals the number of `ModPackData` rows the processor emits, not the number of `.kt` files.
- [ ] The per-annotation row counts in [Count reconciliation](#count-reconciliation) sum to the row count.
- [ ] Every `filePath` in the JSON exists on disk.
- [ ] Every `priority` is 99 unless the class carries `@ModPackPriority`.
- [ ] Every `childProcessName` is null unless the class carries `@ChildProcessModPack`.
- [ ] `targetsMainProcess` is false only for a pack with a non-empty child marker and no `@MainProcessModPack`.

## See also

- [Preference keys](preference-keys.md) — which key each pack reads
- [Packages and constants](packages-and-constants.md) — the package names and broadcast actions the packs use
- [Mod pack lifecycle](../architecture/modpack-lifecycle.md) — how a pack is discovered, constructed and hot-reloaded
- [Add a mod pack](../guides/add-a-mod-pack.md) — the procedure for adding one
