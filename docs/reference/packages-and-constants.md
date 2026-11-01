# Packages and Constants

The package names the module scopes into, the broadcast actions and intent extras that cross
process boundaries, the on-disk paths it writes, and the update channel constants. Read this
before adding a broadcast, a scoped package or a file the hooks must find.

**Audience:** agent adding a cross-process contract or a scoped package
**Prereqs:** `app/src/main/java/sh/siava/pixelxpert/Constants.kt`, `docs/agent/DOC_STYLE.md`

## Summary

- Application id and package namespace are both `sh.siava.pixelxpert`. Every broadcast action except `IconPackUtil.ACTION_PACK` is derived from that id.
- Six packages are scoped: SystemUI, Pixel Launcher, the system framework (`android`), Settings, Google Dialer and the telecom server.
- Two of them, SystemUI and Pixel Launcher, additionally appear in `root_requirement`; `XPLauncher` connects the root proxy service when it loads in one of those.
- Nine broadcast actions are declared in `Constants.kt`: four for the Hooks and Hook Audit pages, five for gestures and profile switching.
- The preference file is `<applicationId>_preferences` in device-protected storage, served by `RemotePrefProvider` under authority `<applicationId>`.

## Model

### Scoped packages

`app/src/main/res/values/xp_module_scope.xml` declares two string arrays. `module_scope` is the
package list the module installs into and the list `TargetOptimizer` compiles. `root_requirement`
is the subset whose processes need the root proxy.

| Package | Role | Target annotation | In `root_requirement` |
| --- | --- | --- | --- |
| `com.android.systemui` | SystemUI | `@SystemUIModPack` | yes |
| `com.google.android.apps.nexuslauncher` | Pixel Launcher | `@LauncherModPack` | yes |
| `android` | System Framework (system_server) | `@FrameworkModPack` | no |
| `com.android.settings` | Settings | `@SettingsModPack` | no |
| `com.google.android.dialer` | Google Dialer | `@DialerModPack` | no |
| `com.android.server.telecom` | Telecom server | `@TelecomServerModPack` | no |

`com.android.server.telecom` is the only scoped package without an entry in `module_scope`; it is
reached through `@TelecomServerModPack`, and `XPLauncher` treats it as a package that is not system
server even though it reports `isSystemServer`.

A third copy of the list lives in `app/src/main/resources/META-INF/xposed/scope.list`, which is what
LSPosed reads. It names the system framework as `system`, while `module_scope` and the target
annotation name it `android`. Both are the system server; the two spellings are not interchangeable
in code that compares package names.

### Broadcast actions

| Constant | Value | Direction | Purpose |
| --- | --- | --- | --- |
| `ACTION_CHECK_XPOSED_ENABLED` | `sh.siava.pixelxpert.ACTION_CHECK_XPOSED_ENABLED` | app -> hooks | Ask every hooked process to identify itself. |
| `ACTION_XPOSED_CONFIRMED` | `sh.siava.pixelxpert.ACTION_XPOSED_CONFIRMED` | hooks -> app | Reply naming the confirmed package in extra "packageName". |
| `ACTION_REQUEST_HOOK_AUDIT` | `sh.siava.pixelxpert.ACTION_REQUEST_HOOK_AUDIT` | app -> hooks | Request one reflection inspection pass. |
| `ACTION_HOOK_AUDIT_RESULT` | `sh.siava.pixelxpert.ACTION_HOOK_AUDIT_RESULT` | hooks -> app | Audit report, with extras "packageName" and "auditJson". |
| `ACTION_HOME` | `sh.siava.pixelxpert.ACTION_HOME` | launcher -> system_server | Drive the window manager home hot key. |
| `ACTION_BACK` | `sh.siava.pixelxpert.ACTION_BACK` | launcher -> system_server | Drive the window manager back key press. |
| `ACTION_SLEEP` | `sh.siava.pixelxpert.ACTION_SLEEP` | launcher -> system_server | Put the device to sleep. |
| `ACTION_SWITCH_APP_PROFILE` | `sh.siava.pixelxpert.ACTION_SWITCH_APP_PROFILE` | launcher -> system_server | Switch the focused app to another user profile. Carries FLAG_RECEIVER_FOREGROUND. |
| `ACTION_PROFILE_SWITCH_AVAILABLE` | `sh.siava.pixelxpert.ACTION_PROFILE_SWITCH_AVAILABLE` | system_server -> SystemUI | Report whether the focused app exists in another profile, in extra "available". |

`ACTION_SWITCH_APP_PROFILE` is the only action with a factory: `Constants.getAppProfileSwitchIntent()`
sets the action and adds `FLAG_RECEIVER_FOREGROUND`.

### Intent extras

| Extra | Type | Carried by | Written by | Read by |
| --- | --- | --- | --- | --- |
| `packageName` | String | ACTION_XPOSED_CONFIRMED, ACTION_HOOK_AUDIT_RESULT | HookTester, HookAuditor | HooksScreen, HookAuditScreen |
| `auditJson` | String | ACTION_HOOK_AUDIT_RESULT | HookAuditor | HookAuditScreen |
| `available` | Boolean | ACTION_PROFILE_SWITCH_AVAILABLE | PhoneWindowManager | StatusbarMods |
| `updateTapped` | Boolean | Intent.ACTION_RUN to MainActivity | ui/update/UpdateScreen.kt | MainActivity |
| `filePath` | String | Intent.ACTION_RUN to MainActivity | ui/update/UpdateScreen.kt | MainActivity |
| `migratePrefs` | String | Magisk post-install callback | MagiskModBase scripts | MainActivity |
| `newUpdate` | Boolean | update notification | util/UpdateWorker.kt | MainActivity |
| `notificationId` | Int | update notification | UpdateWorker, UpdateScreen | receivers/NotificationActionHandler.kt |
| `max_charging_current` | Int | battery status intent | framework | BatteryDataProvider, KeyguardMods |
| `max_charging_voltage` | Int | battery status intent | framework | BatteryDataProvider, KeyguardMods |
| `temperature` | Int | battery status intent | framework | KeyguardMods |
| `android.media.EXTRA_VOLUME_STREAM_TYPE` | Int | volume change broadcast | framework | xposed/utils/SystemUtils.kt |
| `android.media.EXTRA_VOLUME_STREAM_VALUE` | Int | volume change broadcast | framework | xposed/utils/SystemUtils.kt |
| `android.intent.extra.STREAM` | Parcelable (Uri) | ACTION_SEND of the hook audit report | HookAuditScreen | the share target |
| `android.intent.extra.SUBJECT` | String | ACTION_SEND of the hook audit report | HookAuditScreen | the share target |
| `android.intent.extra.COMPONENT_NAME` | Parcelable (ComponentName) | splash hand-off | launcher | FakeSplashActivity |
| `android.app.extra.DOWNLOAD_ID` | Long | DownloadManager completion | DownloadManager | UpdateScreen |

### File paths

| Constant | Value | Written by | Purpose |
| --- | --- | --- | --- |
| `Constants.getLockScreenSubjectCachePath` | `<cacheDir>/lswt.png` | `DepthWallpaper` | Segmented subject mask cache; its length decides whether re-segmentation is needed. |
| `Constants.getLockScreenBitmapCachePath` | `<cacheDir>/lsw.jpg` | `DepthWallpaper` | Cropped lock-screen wallpaper bitmap cache. |
| `Constants.MAGISK_UPDATE_DIR` | `/data/adb/modules_update` | `Magisk` | Staged module directory; a module.prop here means an update waits for a reboot. |
| `Constants.MAGISK_MODULES_DIR` | `/data/adb/modules` | `Magisk` | Active module directory. Declared in Constants but read by no code path. |
| `Constants.MOD_NAME` | `PixelXpert` | `ModuleInstaller` | Module folder name under the Magisk directories. |
| `XPrefs.MagiskRoot` | `/data/adb/modules/PixelXpert` | `XPrefs` | Module root path as the hook side sees it. |
| `ModuleInstaller.updateDir` | `/data/adb/modules_update/PixelXpert` | `ModuleInstaller` | Where the staged module.prop and system.prop are read and written. |

### Update channel constants

Notifications are posted on channel `Updates`, created in `app/src/main/java/sh/siava/pixelxpert/PxnApp.kt` at `IMPORTANCE_DEFAULT`.

| Constant | Value | Purpose |
| --- | --- | --- |
| `UPDATE_AVAILABLE_ID` | 0 | Update available notification. |
| `UPDATE_DOWNLOADED_ID` | 1 | Download finished, tap to install. |
| `UPDATE_DOWNLOAD_FAILED_ID` | 2 | Download failed. |

Manifest endpoints, in the order `fetchUpdateInfo` tries them:

| Channel | URL | Constant |
| --- | --- | --- |
| stable | `https://raw.githubusercontent.com/Codecity001/PixelXpert/stable/latestStable.json` | `STABLE_UPDATES_URL` |
| stable (fallback) | `https://raw.githubusercontent.com/Codecity001/PixelXpert/main/latestStable.json` | inline fallback in fetchUpdateInfo |
| stable (fallback) | `https://raw.githubusercontent.com/Codecity001/PixelXpert/master/latestStable.json` | inline fallback in fetchUpdateInfo |
| canary | `https://raw.githubusercontent.com/Codecity001/PixelXpert/canary/latestCanary.json` | `CANARY_UPDATES_URL` |
| override | `value of preference "updateJsonUrl"` | `Constants.KEY_UPDATE_JSON_URL` |

Manifests the release tasks rewrite:

| File | Written by | Read by |
| --- | --- | --- |
| `latestCanary.json` | `incrementCanaryVersion` | the app update check |
| `latestVersion.json` | `incrementStableVersion` | the app update check |
| `MagiskModuleUpdate_Xposed.json` | `incrementCanaryVersion, incrementStableVersion` | Magisk updateJson in MagiskModBase/module.prop |
| `MagiskModuleUpdate_Full.json` | `incrementCanaryVersion, incrementStableVersion` | the full-package Magisk update channel |
| `latestStable.json` | `incrementStableVersion` | the stable update check |

`latestStable.json` is referenced by the stable update task and by the stable update check, but the
file is not present in this checkout. Only the canary manifests are.

### Preference file keys

| Key | Type | Written by | Purpose |
| --- | --- | --- | --- |
| `IsPrefsInitiated` | boolean | `PrefStore.markReady` | Gate that lets ExtendedRemotePreferences start fanning out change events. |
| `drawableMapping` | String (JSON) | `ThemePackMapping.saveMapping` | Icon pack resource substitution map read by IconPacks. |
| `packageStrike_<packageName>` | Int | `BootLoopProtector` | Bootloop strike count per package; three inside a minute refuse the load. |
| `packageLastLoad_<packageName>` | Long | `BootLoopProtector` | Timestamp that resets the strike counter. |
| `updateVersionIgnored` | Int | `UpdateWorker` | Version code the user dismissed. |
| `latestVersionCode` | Int | `UpdateWorker` | Last version code the background check saw. |

### Storage identifiers

| Name | Value | Purpose |
| --- | --- | --- |
| `PrefStore.FILE_NAME` | `sh.siava.pixelxpert_preferences` | The SharedPreferences file both sides open, in device-protected storage. |
| `REMOTE_PREF_AUTHORITY` | `sh.siava.pixelxpert` | Authority of RemotePrefProvider; also the RemotePreferences authority the hooks bind to. |
| `IconPackUtil.ACTION_PACK` | `sh.siava.pixelxpert.iconpack` | Intent action every icon pack declares; an external contract, not derived from the application id. |
| `HooksMonitor PREFS` | `hooks_monitor` | Device-protected file holding the per-boot pid report used to restart packages that missed the module. |
| `ThemePackMapping.DRAWABLE_MAPPING_KEY` | `drawableMapping` | Key of the icon pack mapping in the preference file. |

### AIDL interfaces

| Interface | Methods | Implemented by |
| --- | --- | --- |
| `IPixelXpertProxy` | `String[] runRootCommand(String command)`<br>`Bitmap extractSubject(in Bitmap input, int method)` | `service/PixelXpertProxy.kt` |
| `IRootProviderService` | `boolean checkLSPosedDB(String packageName)`<br>`boolean isPackageInstalled(String packageName)`<br>`boolean activateInLSPosed(String packageName)`<br>`IBinder getFileSystemService()` | `service/RootProvider.kt` |

### AI method constants

| Constant | Value | Purpose |
| --- | --- | --- |
| `AI_METHOD_MLKIT` | 0 | Subject segmentation through ML Kit; the value stored by default in "SegmentorAI". |
| `AI_METHOD_PYTORCH` | 1 | Subject segmentation through PyTorch. Declared in Constants but referenced by no code path. |

## Contracts

- A broadcast action that is derived from `APPLICATION_ID` is not a public contract. Renaming the
  application id renames every one of them at once, which is why `IconPackUtil.ACTION_PACK` is the
  one action written out as a literal.
- `RemotePrefProvider` must keep the authority `BuildConfig.APPLICATION_ID` and must keep serving
  `PrefStore.FILE_NAME`. If either drifts, `XPLauncher.waitForXprefsLoad` never returns and no pack
  loads in any process.
- `PREF_UPDATE_EXCLUSIONS` must keep both bootloop prefixes. Relaying them re-enters
  `XPrefs.loadEverything` from inside `BootLoopProtector`.
- The scoped package list is duplicated in three places that must stay consistent:
  `xp_module_scope.xml` (module scope and root requirement), `META-INF/xposed/scope.list` (what
  LSPosed loads into), and the target annotations under `xposed/annotations/`.

## Failure modes

| Symptom | Cause | Detection | Fix |
| --- | --- | --- | --- |
| A pack loads but no root command runs | The package is missing from `root_requirement`, so `XPLauncher` never connects the proxy | `Constants.getRootProviderProxy()` returns null in that process | Add the package to `root_requirement` |
| The Hooks page reports no response for every row | The `HookTester` reply never arrives, so no `ACTION_XPOSED_CONFIRMED` is sent | The page logs no confirmed package after five seconds | Confirm `HookTester` is in the generated `ModPacks` table and that the broadcast is exported |
| The preference store is empty on a direct-boot process | The file was opened in credential-protected storage | `PrefStore.open` must be the only opener | Use `createDeviceProtectedStorageContext()` |
| Hook change events stop arriving after the first one | `IsPrefsInitiated` was never written, so `ExtendedRemotePreferences` withholds fan-out | `Xprefs.getBoolean("IsPrefsInitiated", false)` is false | Call `PrefStore.markReady` from `PxnApp.onCreate` |
| The update check reports "Connection Error" for a canary build | The canary manifest URL or `latestCanary.json` is missing | `fetchUpdateInfo` logs the failure for every endpoint | Restore the manifest, or set the override key `updateJsonUrl` |

## Checklist

- [ ] A new scoped package appears in `xp_module_scope.xml`, `META-INF/xposed/scope.list`, `Constants.kt` and a target annotation.
- [ ] A new broadcast action is declared in `Constants.kt` and derived from `APPLICATION_ID` unless it is an external contract.
- [ ] A new extra has exactly one writer and every reader tolerates its absence.
- [ ] A new file path is stable across process restarts.
- [ ] The JSON companion at `docs/reference/data/packages-and-constants.json` was regenerated in the same change.

## See also

- [Mod pack catalog](modpack-catalog.md) — which packs use these packages and actions
- [Preference keys](preference-keys.md) — the keys stored in the preference file
- [Preferences and IPC](../architecture/preferences-and-ipc.md) — the provider, the proxy binder and the update flow
- [Xposed runtime](../architecture/xposed-runtime.md) — the load sequence that consumes the scope arrays
