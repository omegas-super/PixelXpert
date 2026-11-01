# Preference Keys

Every preference key the module stores, the type it is stored as, its declared default, the
screen that owns it and the classes that read it on the hook side. Read this before renaming a
key or adding a reader for an existing one.

**Audience:** agent adding a setting, or tracing why a setting has no effect
**Prereqs:** `docs/architecture/preferences-system.md`, `docs/agent/DOC_STYLE.md`

## Summary

- 197 distinct keys are declared across 20 preference screens; `header_preferences` declares navigation tiles only.
- A key is a cross-process string contract. The app writes it through `PrefStore`; the hooks read the same literal through `Xprefs`.
- 189 keys have a hook-side reader. 8 are read only inside the app.
- 12 further keys are read on the hook side but declared by no preference screen; they are listed in [Keys with no screen declaration](#keys-with-no-screen-declaration).
- `SleepOnFlatScreen` is declared twice, on `misc_prefs` and on `sleep_on_flat_prefs`. Both write the same key.
- Stored types are not uniform: a single-handle slider stores a `Float`, a range slider stores the JSON string `{"":[lo,hi]}`.

## Model

A key exists in four places, and all four must agree.

| Place | File | Role |
| --- | --- | --- |
| Screen declaration | `app/src/main/java/sh/siava/pixelxpert/ui/screens/` | The `PrefNode` that owns the key, its declared `default` and its `dependency`. |
| Default table | `app/src/main/java/sh/siava/pixelxpert/ui/prefs/PreferenceDefaults.kt` | The `key -> android:defaultValue` map the renderer uses to resolve a dependency for a key that was never written. |
| Store | `app/src/main/java/sh/siava/pixelxpert/data/PrefStore.kt` | Opens `<applicationId>_preferences` in device-protected storage and writes the widget's native type. |
| Hook reader | `app/src/main/java/sh/siava/pixelxpert/xposed/` | Reads the literal through `Xprefs`, a `ExtendedRemotePreferences` over the same file. |

Type vocabulary used in the tables below:

| Type | Node | Stored as |
| --- | --- | --- |
| `boolean` | `SwitchPref` | Boolean. |
| `float` | `SliderPref` with `valueCount` 1 | Float. |
| `string` | `SliderPref` with `valueCount` 2 | The JSON string `{"":[lo,hi]}` written by `PrefRenderer.writeRange`. |
| `string` | `ListPref`, `TextPref`, `ColorPref`, `QsLayoutOrderPref` | String. Colours are stored as the decimal or `0x` string the dialog produced. |
| `string-set` | `ListPref` with `multiSelect` | `Set<String>`. |
| `int` | `TimePref` | Int, minutes since midnight. |


## dialer_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `DialerRemoveRecordMessage` | boolean | `false` | `RecordingMessage` |
| `force_volte` | boolean | `false` | `MiscSettings` |
| `vibrateOnAnswered` | boolean | `false` | `CallVibrator` |
| `vibrateOnDrop` | boolean | `false` | `CallVibrator` |

## gesture_nav_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `BackFromLeft` | boolean | `true` | `GestureNavbarManager` |
| `BackFromRight` | boolean | `true` | `GestureNavbarManager` |
| `BackLeftHeight` | float | `100` | `GestureNavbarManager` |
| `BackRightHeight` | float | `100` | `GestureNavbarManager` |
| `CursorControlKeys` | boolean | `false` | `CursorControlKeys` |
| `FCLongSwipeEnabled` | boolean | `false` | `CustomNavGestures` |
| `GesPillHeightFactor` | float | `100` | `LauncherGestureNavbarManager` |
| `GesPillWidthModPos` | float | `50` | `LauncherGestureNavbarManager` |
| `HideNavbarInsets` | boolean | `false` | `HideNavigationBarInsets` |
| `KeyboardSpaceHideButtons` | boolean | `false` | `GestureNavbarManager` |
| `leftSwipeUpAction` | string | `-1` | `CustomNavGestures` |
| `leftSwipeUpPercentage` | float | `25` | `CustomNavGestures` |
| `navPillColorAccent` | boolean | `false` | `CursorControlKeys`, `LauncherGestureNavbarManager` |
| `rightSwipeUpAction` | string | `-1` | `CustomNavGestures` |
| `rightSwipeUpPercentage` | float | `25` | `CustomNavGestures` |
| `swipeUpPercentage` | float | `20` | `CustomNavGestures` |
| `twoFingerSwipeUpAction` | string | `None` | `CustomNavGestures` |

## hotspot_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `force_hotspot` | boolean | `false` | `MiscSettings` |
| `hotSpotHideSSID` | boolean | `false` | `HotSpotController` |
| `hotSpotMaxClients` | float | `0` | `HotSpotController` |
| `hotSpotTimeoutSecs` | float | `0` | `HotSpotController` |
| `hotspotDisableApproval` | boolean | `false` | `HotSpotController` |

## lock_screen_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `BlockQSPowerOnLockscreen` | boolean | `false` | `LockscreenProtectionFramework`, `LockscreenProtectionSystemUI` |
| `DWOpacity` | float | `192` | `DepthWallpaper` |
| `DWallpaperEnabled` | boolean | `false` | `DepthWallpaper` |
| `DWonAOD` | boolean | `false` | `DepthWallpaper` |
| `DisableLockScreenPill` | boolean | `false` | `ScreenGestures` |
| `DoubleTapSleepLockscreen` | boolean | `false` | `ScreenGestures` |
| `HideLockScreenUserAvatar` | boolean | `false` | `KeyguardMods` |
| `KGMiddleCustomText` | string | (unset) | `KeyguardMods` |
| `KeyGuardDimAmount` | float | `-1` | `KeyguardMods` |
| `KeyguardBottomButtonsTransparent` | boolean | `false` | `KeyguardMods` |
| `SegmentorAI` | string | `0` | `DepthWallpaper` |
| `ShowChargingInfo` | boolean | `false` | `KeyguardMods` |
| `WakeUpToSecurityInput` | boolean | `false` | `EasyUnlock` |
| `carrierTextMod` | boolean | `false` | `KeyguardMods` |
| `carrierTextValue` | string | (unset) | `KeyguardMods` |
| `easyUnlockEnabled` | boolean | `false` | `EasyUnlock` |
| `fingerprint_circle_hide` | boolean | `false` | `UDFPSManager` |
| `fingerprint_icon_hide` | boolean | `false` | `UDFPSManager` |
| `holdScreenTorchEnabled` | boolean | `false` | `ScreenGestures` |
| `shufflePinEnabled` | boolean | `false` | `KeyGuardPinScrambler` |

## lsqs_custom_text

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `NetworkStatsMonthStart` | float | `1` | `MiscSettings` |
| `NetworkStatsStartBase` | string | `0` | `MiscSettings` |
| `NetworkStatsStartTime` | int | `00:00` | `MiscSettings` |
| `NetworkStatsWeekStart` | string | `1` | `MiscSettings` |
| `networkStatDLColor` | string | `-7617718` | `MiscSettings` |
| `networkStatULColor` | string | `-351845` | `MiscSettings` |
| `networkStatsColorful` | boolean | `false` | `MiscSettings` |

## misc_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `AnimateFlashlight` | boolean | `false` | `KeyguardMods`, `ScreenOffKeys` |
| `BrightnessRange` | string | `0,100` | `BrightnessRange` |
| `DisableOngoingNotifDismiss` | boolean | `false` | `NotificationManager` |
| `EnableClipboardSmartActions` | boolean | `false` | `FeatureFlagsMods` |
| `FastChargingWattage` | float | `5` | `BatteryDataProvider` |
| `ForceAODwCharging` | boolean | `false` | `KeyguardMods` |
| `HeadupAutoDismissNotificationDecay` | float | `5000` | `NotificationManager` |
| `InsecureScreenRecord` | boolean | `false` | `ScreenRecord`, `SystemScreenRecord` |
| `NTPServers` | string | `0.pool.ntp.org;1.pool.ntp.org` | (app only) |
| `NotificationAODIconLimit` | string | (unset) | `StatusbarMods` |
| `PXInSettings` | boolean | `true` | `PXSettingsLauncher` |
| `PickToShowAmbient` | boolean | `false` | `ScreenGestures` |
| `RecentClearAllReposition` | boolean | `false` | `ClearAllButtonMod` |
| `ScreenshotChordInsecure` | boolean | `false` | `ScreenshotManager` |
| `SleepOnFlatScreen` | boolean | `false` | `FaceUpScreenSleep` |
| `StatusbarAppSwitchIconEnabled` | boolean | `false` | `StatusbarMods` |
| `StatusbarLongpressAppSwitch` | boolean | `false` | `StatusbarGestures` |
| `SyncNTPTime` | boolean | `false` | (app only) |
| `TapToShowAmbient` | boolean | `false` | `ScreenGestures` |
| `TimeSyncInterval` | float | `24` | (app only) |
| `advancedPowerMenu` | boolean | `false` | `PowerMenu` |
| `allScreenRotations` | boolean | `false` | `ScreenRotation`, `StatusbarSize` |
| `controlFlashWithVolKeys` | boolean | `false` | `ScreenOffKeys` |
| `disableScreenshotSound` | boolean | `false` | `ScreenshotManager` |
| `displayOverride` | float | `100` | `MiscSettings` |
| `displayOverrideEnabled` | boolean | `false` | `MiscSettings` |
| `doubleTapToWake` | boolean | `false` | `ScreenGestures` |
| `enable_high_brightness_flashlight` | boolean | `false` | `SystemUtils` |
| `fingerprintWhileDozing` | boolean | `true` | `FingerprintWhileDozing` |
| `noCutoutEnabled` | boolean | `false` | `StatusbarMods`, `StatusbarSize` |
| `notificationDefaultExpansion` | string | `0` | `NotificationExpander` |
| `notificationExpandallEnabled` | boolean | `false` | `NotificationExpander` |
| `pin_wireless_adb` | boolean | `false` | `AdbWifiPortPin` |
| `pinned_adb_port` | string | `5555` | `AdbWifiPortPin` |
| `sysui_tuner` | boolean | `false` | `MiscSettings` |
| `volumeStps` | float | `10` | `MiscSettings` |

## nav_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `HideNavbar` | boolean | `false` | `LauncherGestureNavbarManager` |

## own_prefs_header

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `AlternativeThemedAppIcon` | boolean | `false` | (app only) |
| `AutoUpdate` | boolean | `false` | (app only) |
| `GoogleSettingsDesign` | boolean | `false` | (app only) |
| `TemperatureUnitF` | boolean | `false` | `KeyguardMods`, `ThermalProvider` |
| `UpdateWifiOnly` | boolean | `false` | (app only) |
| `appLanguage` | string | (unset) | (app only) |

## packagemanger_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `PM_AllowDowngrade` | boolean | `false` | `PackageManager` |
| `PM_AllowMismatchedSignature` | boolean | `false` | `PackageManager` |

## physical_buttons_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `doublePressPowerButtonScreenOff` | string | `0` | `ScreenOffKeys` |
| `doublePressPowerButtonScreenOn` | string | `0` | `ScreenOffKeys` |
| `longPressPowerButtonScreenOff` | string | `0` | `ScreenOffKeys` |
| `longPressPowerButtonScreenOn` | string | `0` | `ScreenOffKeys` |
| `longPressVolumeDownButtonScreenOff` | string | `0` | `ScreenOffKeys` |
| `longPressVolumeUpButtonScreenOff` | string | `0` | `ScreenOffKeys` |

## qs_tile_qty_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `QQSRows` | float | `2` | `QSTileGrid` |
| `QQSRowsL` | float | `1` | `QSTileGrid` |
| `QSColQty` | float | `4` | `QSTileGrid` |
| `QSColQtyL` | float | `8` | `QSTileGrid` |
| `QSRowQty` | float | `4` | `QSTileGrid` |
| `QSRowQtyL` | float | `2` | `QSTileGrid` |

## quicksettings_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `QSAutoBrightnessToggle` | boolean | `false` | `QSBrightnessSlider` |
| `QSFooterBuildNumberEnabled` | boolean | `false` | `StatusbarMods` |
| `QSFooterBuildNumberText` | string | (unset) | `StatusbarMods` |
| `QSLabelScaleFactor` | float | `0` | `QSTileGrid` |
| `QSPulldownPercent` | float | `25` | `StatusbarGestures` |
| `QSPulldownSide` | string | `1` | `StatusbarGestures` |
| `QSPullodwnEnabled` | boolean | `false` | `StatusbarGestures` |
| `QSSecondaryLabelScaleFactor` | float | `0` | `QSTileGrid` |
| `UnMuteVolumePCT` | float | `50` | `SystemUtils` |
| `oneFingerPullupEnabled` | boolean | `false` | `StatusbarGestures` |
| `qs_layout_order` | string | `brightness,qs,media` | `QSBrightnessSlider` |

## sbqs_network_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `networkTrafficColorful` | boolean | `false` | `StatusbarMods` |
| `networkTrafficDLColor` | string | `-7617718` | `StatusbarMods` |
| `networkTrafficInterval` | float | `1` | `StatusbarMods` |
| `networkTrafficMode` | string | `0` | `StatusbarMods` |
| `networkTrafficOpacity` | float | `100` | `StatusbarMods` |
| `networkTrafficRXTop` | boolean | `true` | `StatusbarMods` |
| `networkTrafficShadow` | string | `0` | `StatusbarMods` |
| `networkTrafficShowIcons` | boolean | `true` | `StatusbarMods` |
| `networkTrafficShowInBits` | boolean | `false` | `StatusbarMods` |
| `networkTrafficThreshold` | string | `10` | `StatusbarMods` |
| `networkTrafficULColor` | string | `-351845` | `StatusbarMods` |

## sleep_on_flat_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `FlatStandbyTime` | float | `5` | `FaceUpScreenSleep` |
| `SleepOnFlatRespectWakeLock` | boolean | `true` | `FaceUpScreenSleep` |

## statusbar_batterybar_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `BBAnimateCharging` | boolean | `false` | `StatusbarMods` |
| `BBOnBottom` | boolean | `false` | `StatusbarMods` |
| `BBOnlyWhileCharging` | boolean | `false` | `StatusbarMods` |
| `BBOpacity` | float | `100` | `StatusbarMods` |
| `BBSetCentered` | boolean | `false` | `StatusbarMods` |
| `BBarColorful` | boolean | `false` | `StatusbarMods` |
| `BBarEnabled` | boolean | `false` | `StatusbarMods` |
| `BBarHeight` | float | `50` | `StatusbarMods` |
| `BBarTransitColors` | boolean | `false` | `StatusbarMods` |
| `batteryChargingColor` | string | `-16711936` | `StatusbarMods` |
| `batteryCriticalColor` | string | `-65536` | `StatusbarMods` |
| `batteryFastChargingColor` | string | `-16776961` | `StatusbarMods` |
| `batteryPowerSaveColor` | string | `0xFFFFBF00` | `StatusbarMods` |
| `batteryWarningColor` | string | `-256` | `StatusbarMods` |
| `batteryWarningRange` | string | `15,40` | `StatusbarMods` |
| `indicateCharging` | boolean | `false` | `StatusbarMods` |
| `indicateFastCharging` | boolean | `false` | `StatusbarMods` |
| `indicatePowerSave` | boolean | `false` | `StatusbarMods` |

## statusbar_clock_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `AfterSBCSmall` | boolean | `true` | `StatusbarMods` |
| `BeforeSBCSmall` | boolean | `true` | `StatusbarMods` |
| `DateFormatAfterSBC` | string | `""` | `StatusbarMods` |
| `DateFormatBeforeSBC` | string | `""` | `StatusbarMods` |
| `SBCAfterClockColor` | string | `-1` | `StatusbarMods` |
| `SBCAmPmStyle` | string | `2` | `StatusbarMods` |
| `SBCBeforeClockColor` | string | `-1` | `StatusbarMods` |
| `SBCClockColor` | string | `-1` | `StatusbarMods` |
| `SBCClockColorful` | boolean | `false` | `StatusbarMods` |
| `SBCClockTextEffect` | string | `0` | `StatusbarMods` |
| `SBCDayOfWeekMode` | string | `0` | `StatusbarMods` |
| `SBCShowSeconds` | boolean | `false` | `StatusbarMods` |
| `SBClockLoc` | string | `0` | `StatusbarMods` |

## statusbar_settings

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `DoubleTapSleep` | boolean | `false` | `ScreenGestures` |
| `HidePrivacyChip` | boolean | `false` | `StatusbarMods` |
| `HideRoamingState` | boolean | `false` | `StatusbarMods` |
| `KGIgnoredIcons` | string-set | (unset) | `StatusIconTuner` |
| `LTE4GIconMod` | string | `0` | `FeatureFlagsMods` |
| `NotificationIconLimit` | string | (unset) | `StatusbarMods` |
| `QSIgnoredIcons` | string-set | (unset) | `StatusIconTuner` |
| `SBIgnoredIcons` | string-set | (unset) | `StatusIconTuner` |
| `VolteIconEnabled` | boolean | `false` | `StatusbarMods` |
| `VowifiIconEnabled` | boolean | `false` | `StatusbarMods` |
| `clockMultiRowStartOffset` | float | `2` | `StatusbarMods` |
| `combinedSignalEnabled` | boolean | `false` | `StatusbarMods` |
| `multiRowClockBottom` | boolean | `false` | `StatusbarMods` |
| `networkOnSBEnabled` | boolean | `false` | `StatusbarMods` |
| `networkTrafficPosition` | string | `2` | `StatusbarMods` |
| `notificationAreaMultiRow` | boolean | `false` | `StatusbarMods`, `StatusbarSize` |
| `qsStatusbarPaddings` | string | `-.5,100.5` | `StatusbarMods` |
| `statusbarHeightFactor` | float | `100` | `StatusbarMods`, `StatusbarSize` |
| `statusbarPaddings` | string | `-.5,100.5` | `StatusbarMods` |
| `systemIconSortPlan` | string | `0` | `MultiStatusbarRows` |
| `systemIconsMultiRow` | boolean | `false` | `MultiStatusbarRows`, `StatusbarSize` |

## taskbar_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `EnableGoogleRecents` | boolean | `false` | `TaskbarActivator` |
| `TaskbarAsRecents` | boolean | `true` | `TaskbarActivator` |
| `TaskbarOnLauncher` | boolean | `false` | `TaskbarActivator` |
| `TaskbarRadiusOverride` | float | `1` | `TaskbarActivator` |
| `taskBarMode` | string | `0` | `TaskbarActivator` |
| `taskbarHeightOverride` | float | `100` | `TaskbarActivator` |

## theming_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `ForceThemedLauncherIcons` | boolean | `false` | `LauncherThemedIcons` |

## three_button_prefs

| Key | Type | Default | Read by |
| --- | --- | --- | --- |
| `ThreeButtonCenter` | string | `home` | `TaskbarActivator` |
| `ThreeButtonLayoutMod` | boolean | `false` | `TaskbarActivator` |
| `ThreeButtonLeft` | string | `back` | `TaskbarActivator` |
| `ThreeButtonRight` | string | `recent` | `TaskbarActivator` |

## Keys declared on more than one screen

A key that two screens declare writes the same preference file entry from either screen.
The tables above list it under the first screen in the ordering used by `PreferenceScreens.kt`.

| Key | Screens | Note |
| --- | --- | --- |
| `SleepOnFlatScreen` | `misc_prefs`, `sleep_on_flat_prefs` | The two nodes declare the same key with different defaults; `misc_prefs` declares `false`, `sleep_on_flat_prefs` declares no default and `PreferenceDefaults.kt` maps the key to `null`. |

## Keys with no screen declaration

These keys are read or written on the hook side and have no `PrefNode` of their own. A reader
must not assume they are user-visible.

| Key | Type | Default in code | Read by | Note |
| --- | --- | --- | --- | --- |
| `DisableUnlockHintAnimation` | boolean | false | `KeyguardMods` | Suppresses the unlock hint animation. No preference screen declares it. |
| `LoadTestBooleanValue` | boolean | false | `XPLauncher` | Probe key. `waitForXprefsLoad` reads it in a loop; the read throws until the provider answers. |
| `cachedFlashLevel` | int | half of the maximum torch level | `SystemUtils` | Last torch strength level read from the camera, cached for the fallback path. |
| `cachedMaxFlashLevel` | int | 45 | `SystemUtils` | Cached maximum torch strength level. |
| `expectedPassLen` | int | -1 | `EasyUnlock` | Learned length of the user secret. Written back by the pack itself. |
| `high_brightness_flashlight_level` | int | maximum torch level | `HighBrightnessFlashlightTile, HighBrightnessTorchController` | Current high-brightness torch level, written by the controller and read by the tile. |
| `notificationExpandallHookEnabled` | boolean | true | `NotificationExpander` | Internal switch that gates the expand-all hook; no screen exposes it. |
| `optimized_build` | String | `""` | `TargetOptimizer` | The `Build.ID` the AOT compile sweep already ran for. |
| `system_restart_pending` | boolean | false | `TargetOptimizer` | Marks that a compile sweep is still being applied; cleared on the next load. |
| `qqs_brightness_slider` | boolean | false | `QSBrightnessSlider` | Written by the QS layout-order control, not by a SwitchPref node. |
| `qs_brightness_slider_bottom` | boolean | false | `QSBrightnessSlider` | Derived by the QS layout-order control from the brightness/QS ordering. |
| `qs_media_player_top` | boolean | false | `QSBrightnessSlider` | Derived by the QS layout-order control from the media/QS ordering. |

## Keys with no hook-side reader

These keys are consumed inside the app. `readBy` is empty in the JSON for them.

| Key | Screen | Read by (app side) |
| --- | --- | --- |
| `NTPServers` | misc_prefs | `NTPTimeSyncer` |
| `SyncNTPTime` | misc_prefs | `TimeSyncScheduler`, `PrefRenderer` |
| `TimeSyncInterval` | misc_prefs | `TimeSyncScheduler` |
| `AlternativeThemedAppIcon` | own_prefs_header | `PrefRenderer` applies the launcher icon alias flip |
| `AutoUpdate` | own_prefs_header | `UpdateScheduler`, `PrefRenderer` |
| `GoogleSettingsDesign` | own_prefs_header | `PrefRenderer` selects the Settings-style layout |
| `UpdateWifiOnly` | own_prefs_header | `UpdateWorker`, `PrefRenderer` |
| `appLanguage` | own_prefs_header | no reader in this checkout; the `languages_*` arrays and the node exist, no consumer |

## Preference-file keys outside the PrefNode model

The same SharedPreferences file carries bookkeeping keys that no screen declares and no `PrefNode`
type models.

| Key | Type | Written by | Purpose |
| --- | --- | --- | --- |
| `IsPrefsInitiated` | boolean | `PrefStore.markReady` | Gate that lets ExtendedRemotePreferences start fanning out change events. |
| `drawableMapping` | String (JSON) | `ThemePackMapping.saveMapping` | Icon pack resource substitution map read by IconPacks. |
| `packageStrike_<packageName>` | Int | `BootLoopProtector` | Bootloop strike count per package; three inside a minute refuse the load. |
| `packageLastLoad_<packageName>` | Long | `BootLoopProtector` | Timestamp that resets the strike counter. |
| `updateVersionIgnored` | Int | `UpdateWorker` | Version code the user dismissed. |
| `latestVersionCode` | Int | `UpdateWorker` | Last version code the background check saw. |

## Failure modes

| Symptom | Cause | Detection | Fix |
| --- | --- | --- | --- |
| The setting toggles but nothing changes | The key literal differs by one character between the screen and the reader, so the reader always gets the default | Grep the literal in both trees: it must appear identically under `ui/` and `xposed/` | Fix the literal on one side |
| The setting has no effect until a restart | The reader caches the value in a field and its `onPreferenceUpdated` does not re-read it | Read the pack's `onPreferenceUpdated`; every key the hooks depend on must be read there | Add the read, or accept the restart and document it |
| A range slider value reads as `0` | The reader used `getInt` or `getFloat` on a key stored as the `{"":[lo,hi]}` string | `Xprefs.getSliderValues` is the reader for range keys | Use the slider helper, not the scalar one |
| A dependency row is enabled when it should not be | The key was never written and `PreferenceDefaults` has no entry for it | Compare the screen list with `preferenceDefaults`; two screen keys are missing there | Add the key to `PreferenceDefaults` |
| A key exists in `PreferenceDefaults` but on no screen | The screen that declared it was removed | The three QS layout keys are written by `PrefRenderer`, not by a node | Leave them, or delete the stale entry |

## Checklist

- [ ] Every key in the JSON appears in exactly one screen, except the documented `SleepOnFlatScreen` pair.
- [ ] Every `readBy` entry names a class that actually contains the literal.
- [ ] A new key has a `default` in both the screen node and `PreferenceDefaults.kt`.
- [ ] A new key that a hook reads appears in the pack's `onPreferenceUpdated`.
- [ ] Range-slider keys are read with `getSliderValues`, single-handle sliders with `getSliderInt` or `getSliderFloat`.
- [ ] The JSON companion at `docs/reference/data/preference-keys.json` was regenerated in the same change.

## See also

- [Mod pack catalog](modpack-catalog.md) — the packs named in the Read by column
- [Packages and constants](packages-and-constants.md) — broadcast actions and the preference file contract
- [Preferences system](../architecture/preferences-system.md) — the declarative model end to end
- [Add a preference](../guides/add-a-preference.md) — the procedure for adding a key
