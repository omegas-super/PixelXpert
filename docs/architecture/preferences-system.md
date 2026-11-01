# Preferences System

The declarative preference model end to end: a `PrefScreen` tree in the app
process, the `PrefStore` writer, the `RemotePreferences` bridge, and the
`Xprefs` reader inside every hooked process. Read this before adding, renaming,
or deleting any preference key. It is the single most load-bearing contract in
the repository.

**Audience:** agent adding a setting, changing a key, or debugging "the toggle
does nothing"
**Prereqs:** [overview](overview.md), [app UI](app-ui.md)

---

## Summary

- A preference is one string key written by the app process and read by one or
  more hooked processes. There is no compile-time link between the two halves.
- The app side is declarative: a `PrefScreen` holds `PrefNode` values, one
  renderer draws them, and `PrefStore` reads and writes the key with the type the
  widget declares.
- The file is `<applicationId>_preferences` in **device-protected** storage. The
  authority is `<applicationId>`. Both are derived from `BuildConfig`, never
  literals.
- The hooked side opens that file through `XPrefs.Xprefs`, an
  `ExtendedRemotePreferences` over `RemotePrefProvider`. Every pack reads it
  inside `onPreferenceUpdated`.
- `PrefStore` bumps a single `revision` `StateFlow` on every write; that is the
  entire Compose invalidation mechanism.
- Three separate "defaults" exist for one key: the node's `default`, the
  `preferenceDefaults` map, and the fallback literal in the pack's reader. All
  three must agree.

---

## Model

### The key is the contract

```text
ui/screens/<screen>.kt          PrefNode(key = "allScreenRotations", default = "false")
        |
        v
ui/prefs/PrefRenderer.kt        store.write(node, "true")  ->  PrefStore.putBoolean
        |
        v
data/PrefStore.kt               <applicationId>_preferences   (device-protected)
        |
        v
data/RemotePrefProvider.kt      authority = BuildConfig.APPLICATION_ID
        |
        v
xposed/XPrefs.kt                ExtendedRemotePreferences(context, APPLICATION_ID,
                                APPLICATION_ID + "_preferences", true)
        |
        v
xposed/modpacks/**/Pack.kt      Xprefs.getBoolean("allScreenRotations", false)
```

Nothing checks that the last line's literal matches the first. A rename on
either side compiles, runs, and returns the reader's fallback forever.

### PrefNode: the app-side shape

`app/src/main/java/sh/siava/pixelxpert/ui/prefs/node/PrefNodes.kt` defines a
sealed hierarchy. Two branches matter:

- `PrefNode` — everything, with `ignore`, `icon`, `title`, `titleText`.
- `ValuePref` — the branch that persists a value. Adds `key`, `summary`,
  `default: String?`, `dependency: String?`.

Every `default` is a `String` even when the stored type is not, because the value
is written through a widget-specific coercion and the declared default is only a
fallback for an absent key.

| Node | Persisted type | Read back as |
| --- | --- | --- |
| `SwitchPref` | `Boolean` | `Boolean` |
| `SliderPref`, `valueCount = 1` | `Float` | `Float`, via `sliderValue` |
| `SliderPref`, `valueCount >= 2` | `String`, the JSON `{"":[lo,hi]}` | `String`, parsed by regex |
| `ListPref`, single-select | `String` | `String` |
| `ListPref`, `multiSelect = true` | `Set<String>` | `Set<String>` |
| `TextPref` | `String` | `String` |
| `ColorPref` | `String` | `String`, with an `Int` fallback |
| `TimePref` | `Int`, minutes since midnight | `Int` |
| `QsLayoutOrderPref` | `String`, comma-joined | `String` |

`PrefScreen.flatten()` walks the tree depth-first and returns
`List<FlattenedNode>`; each `FlattenedNode` carries the node plus the `@StringRes`
of its enclosing `Category`. `PrefScreen.title` is declared and read by nothing.

### PrefStore: the writer

`app/src/main/java/sh/siava/pixelxpert/data/PrefStore.kt`.

The file is opened exactly once, and only through `PrefStore.open`:

```kotlin
fun open(context: Context): SharedPreferences = context.applicationContext
	.createDeviceProtectedStorageContext()
	.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)
```

`FILE_NAME = BuildConfig.APPLICATION_ID + "_preferences"`.
`RemotePrefProvider` serves `RemotePreferenceFile(PrefStore.FILE_NAME, true)`, so
a key written through credential-protected storage lands in a same-named file
the hooks never open. The KDoc on `open` calls that out as the bug the function
exists to prevent.

Three write surfaces:

| Surface | Called from | Effect |
| --- | --- | --- |
| `write(pref, value)` | `PrefRenderer` | Coerces to the widget's type, then a typed putter |
| `putString` / `putBoolean` / `putFloat` / `putInt` / `putStringSet` | `PrefRenderer` special cases, `PxnNav`, `UpdateScreen` | Direct typed write |
| `read(pref)` | `PrefRenderer`, `PrefStore.valueOf` | Typed read, falling back to `pref.default` when `contains(key)` is false |

`contains(key)` is the switch between "unset" and "set to the default value". It
is what lets `read` return the declared default rather than a fabricated one.

Every putter ends with `_revision.value++`, and the constructor also registers a
`SharedPreferences.OnSharedPreferenceChangeListener` that bumps the same counter.
`revision: StateFlow<Int>` is the only invalidation signal in the UI.

`read`'s per-type tolerance is uneven, and that matters:

| Widget | Guard against a stored value of the wrong type |
| --- | --- |
| `SliderPref` | `sliderValue` reads `prefs.all[key]` and accepts `String` or `Number` |
| `TimePref` | `getInt`, which catches `ClassCastException` and retries as a string, a colour, or hex |
| `ColorPref` | explicit `catch (e: ClassCastException)` then `getInt` |
| `SwitchPref` | none: `getBoolean` is called unguarded |
| `ListPref`, single | none: `getString` is called unguarded |

The KDoc above `read` claims `runCatching` keeps a type mismatch from crashing.
The code only guards the three rows in the first group.

### The range-slider encoding

A `SliderPref` with `valueCount >= 2` is written by `PrefRenderer.writeRange`:

```kotlin
store.putString(node.key, "{\"\":[${trimFloat(lo)},${trimFloat(hi)}]}")
```

That shape exists because `RangeSliderPreference.setValues` produced it, and the
hooked side still parses it first. The bare `lo,hi` form the node declares as its
`default` is a *different* shape and is only understood by the app-side regex
`SLIDER_NUMBER` in `PrefRenderer`. The reader on the hooked side is
`Xprefs.getSliderValues`, which goes through
`app/src/main/java/sh/siava/pixelxpert/xposed/utils/SliderValues.kt` and tries
`getString` → `getFloat` → `getInt` → the passed default, in that order.

### RemotePrefProvider: the bridge

`app/src/main/java/sh/siava/pixelxpert/data/RemotePrefProvider.kt` is 51 lines.

```kotlin
class RemotePrefProvider :
	RemotePreferenceProvider(
		BuildConfig.APPLICATION_ID,
		arrayOf(RemotePreferenceFile(PrefStore.FILE_NAME, true)),
	)
```

It is declared in `app/src/main/AndroidManifest.xml` as
`android:authorities="${applicationId}"`, `android:directBootAware="true"`,
`android:exported="true"`. The overridden `query` calls
`HooksMonitor.onHookReported(context, Binder.getCallingUid(), Binder.getCallingPid())`
before returning the cursor, which is how the Hooks page learns which processes
actually read the file.

`REMOTE_PREF_AUTHORITY` in the same file is `BuildConfig.APPLICATION_ID`, and
`RemotePrefProvider` passes `BuildConfig.APPLICATION_ID` directly rather than the
constant. Both resolve to the same value.

### The readiness marker

`PrefStore.markReady(context)` runs from `PxnApp.onCreate`, before Android
creates the provider, and writes `LEGACY_INIT_MARKER = "IsPrefsInitiated"` with
`commit()`.

That marker is not bookkeeping. `ExtendedRemotePreferences` withholds the entire
listener fan-out until it reads `true`:

```kotlin
if (mIsPrefsInitiated && mOnSharedPreferenceChangeListeners.isNotEmpty()) {
	// fan out
}
```

Without the marker a pack loads once and never sees another preference change.

`markReady` is guarded, because the provider is `directBootAware` and the process
can be started before unlock. If the credential-protected read throws
`IllegalStateException`, it registers an `ACTION_USER_UNLOCKED` receiver and
retries both steps there. A throw out of `Application.onCreate` would kill the
process before any component existed.

### XPrefs: the reader

`app/src/main/java/sh/siava/pixelxpert/xposed/XPrefs.kt`.

```kotlin
@JvmStatic
lateinit var Xprefs: ExtendedRemotePreferences
```

`lateinit`, non-null, so the `if (Xprefs == null) return` that used to open every
pack's `onPreferenceUpdated` is dead code and has been removed. An uninitialised
read throws `UninitializedPropertyAccessException`, not `null`.

`init(context)` builds the handle with `BuildConfig.APPLICATION_ID` as both
authority and file-name prefix, plus `strictMode = true`.
`onContentProviderLoaded()` does the first full fan-out and then registers the
change listener, because before the provider answers the first read throws.

`loadEverything(packageName, vararg key)` is the fan-out:

```kotlin
if (key.isNotEmpty() &&
	(key[0] == null || Constants.PREF_UPDATE_EXCLUSIONS.any { key[0]!!.startsWith(it) })
) {
	return
}
```

`Constants.PREF_UPDATE_EXCLUSIONS` is `listOf(LOAD_TIME_KEY_KEY,
PACKAGE_STRIKE_KEY_KEY)`, i.e. `packageLastLoad_` and `packageStrike_`. Those two
prefixes are written back into the same preferences file by
`BootLoopProtector`, and relaying them would re-enter `loadEverything`.

`XPrefs.release()` detaches the listener and is registered as a generation
cleanup by `XPLauncher.registerGenerationCleanups`.

### The reader's fallback literal

Every pack passes a fallback to each `Xprefs` getter. That literal is the third
default, and it is the one that wins on a fresh install when the key has never
been written. `ScreenRotation` is representative:

```kotlin
allScreenRotations = Xprefs.getBoolean("allScreenRotations", false)
```

`ScreenRecord`, `FingerprintWhileDozing`, `HotSpotController`, `FeatureFlagsMods`,
`QSTileGrid`, `StatusbarMods` and `MiscSettings` all follow the same shape.

---

## Walkthrough

### Writing a value

1. The user taps a `SwitchPref` row. `PrefRenderer.SwitchItem` computes
   `write((!checked).toString())`.
2. `store.write(node, value)` dispatches on the node type and calls
   `putBoolean(node.key, value == "true")`.
3. `SharedPreferences.edit().putBoolean(...).apply()` commits to
   `<applicationId>_preferences` in device-protected storage.
4. `_revision.value++` fires. Every composable that collected `revision`
   recomposes and re-reads synchronously.
5. `SwitchItem`'s `write` lambda then runs its side effects, keyed on the literal
   preference key: `"AlternativeThemedAppIcon"` arms a dialog, `"AutoUpdate"`
   calls `UpdateScheduler.scheduleUpdates`, `"SyncNTPTime"` calls
   `TimeSyncScheduler.scheduleTimeSync`.
6. The `OnSharedPreferenceChangeListener` registered in `PrefStore`'s `init` also
   bumps `_revision`, so an out-of-band write invalidates the UI too.

### Reading a value on the hooked side

1. The hooked process starts. `XPLauncher.initializeWithContext` calls
   `XPrefs.init(context)`.
2. `waitForXprefsLoad` probes `XPrefs.Xprefs.getBoolean("LoadTestBooleanValue",
   false)` in a loop with `SystemUtils.threadSleep(1000)`. The key does not exist;
   the read throws until the provider answers.
3. `onXPrefsReady` → `loadModPacks` constructs each matching pack and calls
   `modInstance.onPreferenceUpdated()` with no keys. `XPLauncher.loadModPack`
   wraps that call in `try { } catch (ignored: Throwable) { }`.
4. The pack reads each key with a typed getter and caches the result in a field
   or companion object.
5. A later write in the app process reaches the pack because
   `ExtendedRemotePreferences` fans the change out to `XPrefs`'s listener, which
   calls `loadEverything(packageName, key)`, which calls
   `onPreferenceUpdated(*key)` on every pack in `XPLauncher.runningMods`.

### Adding a key: the six places that must agree

| # | Place | File | What breaks if it is missing |
| --- | --- | --- | --- |
| 1 | The `ValuePref` node with `key` and `default` | `ui/screens/<screen>.kt` | No UI; nothing ever writes the key |
| 2 | The screen in `preferenceScreens` | `ui/screens/PreferenceScreens.kt` | The screen itself is unreachable; the node is dead |
| 3 | The route in `routeToScreenKey` | `ui/screens/Routes.kt` | If the screen is new, its `NavRow` opens `MissingScreen` |
| 4 | The screen in `searchScreenTitles` | `ui/screens/Routes.kt` | The row is invisible to search |
| 5 | The key in `preferenceDefaults` | `ui/prefs/PreferenceDefaults.kt` | Only bites when another node names this key in `dependency`; see below |
| 6 | The typed reader in the pack | `xposed/modpacks/**/Pack.kt` | The value is written and never used |

Step 5 deserves its own explanation. `preferenceDefaults` is read by exactly one
caller, `PrefRenderer.enabledBy`:

```kotlin
private fun enabledBy(store: PrefStore, node: ValuePref): Boolean {
	val dep = node.dependency ?: return true
	val def = preferenceDefaults[dep] == "true"
	return if (store.contains(dep)) store.getBoolean(dep, def) else def
}
```

A missing entry yields `null == "true"` → `false`, so on a fresh install the
dependent row renders disabled and stays disabled until the dependency key is
written at least once. There is no warning and no exception.

`qsStatusbarPaddings` and `clockMultiRowStartOffset` are declared in
`statusbar_settings.kt` and absent from `preferenceDefaults` today. Neither is
currently a `dependency` target, so nothing is broken yet; naming either one in a
`dependency` would reproduce the bug immediately.

### Hiding and dimming: three different rules

A row's availability is decided in three separate places, and they do not share
a table.

| Rule | Function | Signal | Effect |
| --- | --- | --- | --- |
| Dim + inert | `enabledBy` | `dependency` resolved through `preferenceDefaults` | Row visible, faded to `alpha(0.38f)`, taps swallowed |
| Hidden | `visibleBy` | A hand-written `when (key)` over 55 literal keys | Row never enters the `LazyColumn` |
| Search visibility | `isVisible` in `SearchIndex.kt` | `dependency` only | Result filtered out when the dependency reads false |

`visibleBy`'s `else -> true` branch means an unlisted key is always visible, and
its `catch (ignored: Throwable) { true }` means a malformed stored value also
leaves the row visible. Both defaults fail open, so a missing arm produces a row
that is on screen when it should not be, never a crash.

`dependency` alone never hides a row. The `visibleBy` arms for
`"multiRowClockBottom"` and `"pinned_adb_port"` exist precisely because those two
rows declare `dependency` and were staying on screen greyed out.

### Where a value is also written by the hooked side

Two keys are written by hooked processes back into the app's file through the
same `RemotePreferences` handle:

| Key prefix | Writer | Read by |
| --- | --- | --- |
| `packageStrike_<pkg>` | `BootLoopProtector.isBootLooped` | `HooksScreen` |
| `packageLastLoad_<pkg>` | `BootLoopProtector.resetCounter` | `BootLoopProtector` |

`BootLoopProtector` uses `commit()`, not `apply()`, because the next line reads
the value back. `HooksScreen` reads the strike count with
`store.getInt("${Constants.PACKAGE_STRIKE_KEY_KEY}${row.packageName}", 0)` and
reports `RowStatus.BOOTLOOPED` at `strikes >= 3`.

---

## Contracts

### App side

| Rule | Reason |
| --- | --- |
| Every `key` is a literal `String` matching the pack's literal byte for byte | No compile-time link exists |
| `default` is written in the widget's own text form (`"true"`, `"100"`, `"15,40"`) | `read` compares it as a string; `enabledBy` compares it to `"true"` |
| A key that other rows depend on must be in `preferenceDefaults` | `enabledBy` otherwise resolves the dependency to false forever |
| A key that must be hidden when its feature is off needs an arm in `visibleBy` | `dependency` only dims |
| A range slider's stored value goes through `writeRange`, never `putFloat` | `putFloat` on `"0,50"` yields `0f` and drops the upper bound |
| `PrefStore.open` is the only way to reach the file | Credential-protected storage is a same-named file the hooks never read |
| `PrefStore.markReady` runs before the provider is created | Without the marker the hooks ignore every change |
| Never change `FILE_NAME` or the authority | Either change silently disconnects UI from hooks |

### Hooked side

| Rule | Reason |
| --- | --- |
| Read only through `Xprefs`, never a fresh `RemotePreferences` | `ExtendedRemotePreferences` carries the marker gate and the listener fan-out |
| Read inside `onPreferenceUpdated`, not in `onPackageLoaded` | `onPackageLoaded` runs once; the values must be refreshable |
| Cache into a field or companion object, do not re-read per hook invocation | A remote read is a binder call |
| Pass the same fallback the node declares as `default` | The fallback is what a fresh install actually uses |
| Match the getter to the widget's stored type | `getString` on a `Boolean` throws `ClassCastException`; `getInt` tolerates it |
| A key whose prefix is in `PREF_UPDATE_EXCLUSIONS` never reaches a pack | `loadEverything` returns before the fan-out |
| Do not write preferences from a pack except through `BootLoopProtector`'s own keys | Those writes re-enter the fan-out |

### What silently breaks when one half is missing

| Missing half | Observable result |
| --- | --- |
| Node exists, no reader | The switch toggles, persists, survives reboot, and changes nothing |
| Reader exists, no node | The key is never written; the pack's fallback literal is the permanent value, and the user has no way to change it |
| Key spelled differently on one side | The reader always returns its fallback; the UI always shows the node's default |
| `default` in the node differs from the fallback literal | The switch shows "off" while the feature is on, or the reverse, until first touch |
| Screen not in `searchScreenTitles` | Rows exist and work but are unfindable |
| Screen not in `preferenceScreens` | `entry<Route.Pref>` renders `MissingScreen`, printing the key |
| Route not in `routeToScreenKey` | The `NavRow` opens `MissingScreen`, printing the route id |
| Key absent from `preferenceDefaults` while used as a `dependency` | The dependent row is born disabled and never enables |
| No `visibleBy` arm | The row is visible with its feature off |
| Reader type mismatched | `ClassCastException` in the hooked process, or a silent fallback if the getter is `getInt` |

---

## Failure modes

| Symptom | Cause | Evidence in code |
| --- | --- | --- |
| Toggle flips, feature does nothing | Key mismatch between node and reader | No symbol ties them; `XPrefs.loadEverything` passes only the changed key string |
| Feature works after reboot but not after the toggle | Pack cached the value in `onPackageLoaded` instead of `onPreferenceUpdated` | `XPLauncher.loadModPack` calls `onPreferenceUpdated()` once before `onPackageLoaded` |
| Every change after the first is ignored | `IsPrefsInitiated` was never written | `ExtendedRemotePreferences`'s listener only fans out when `mIsPrefsInitiated` is true; `PrefStore.markReady` writes it |
| A pack never loads at all, no error | `waitForXprefsLoad` never returned: authority or file name mismatch | The loop probes `getBoolean("LoadTestBooleanValue", false)` with `threadSleep(1000)` and no iteration limit |
| A whole pack's preferences read as defaults, silently | `onPreferenceUpdated` threw and was swallowed | `loadModPack` wraps it in `try { } catch (ignored: Throwable) { }` |
| A range slider's upper bound is always lost | A range written with `putFloat` instead of `writeRange` | `PrefStore.write` stores a non-numeric string as a String; `putFloat("0,50")` gives `0f` |
| A range slider reads as an empty range before any write | `SliderValues.getValues(key, default)` tries `getString` first; an absent key yields `""`, which parses to an empty list, and the `getFloat`/`getInt` fallbacks are never reached | `SliderValues.getValues`; `PrefRenderer.visibleBy`'s comment on `batteryWarningRange` records the same path |
| A colour reads as white instead of the stored value | `getInt` on a `String`-stored colour needs the whole fallback chain | `ExtendedRemotePreferences.getInt` tries `toIntOrNull`, then `Color.parseColor`, then `removePrefix("0x").toLongOrNull(16)`; `"0xFFFFBF00"` needs the hex step because `parseColor` rejects the `0x` prefix |
| A dependent row is disabled on a fresh install | Missing `preferenceDefaults` entry | `enabledBy`: `preferenceDefaults[dep] == "true"` is `null == "true"` |
| A row stays greyed out after its dependency is switched on | A row composable stopped collecting `store.revision` in its own scope | `enabledBy`'s KDoc records `pinned_adb_port` as the case |
| `UpdateWifiOnly` reads differently before and after the first boot | The node declares `"false"`, `visibleBy` reads `AutoUpdate` with `true`, and `UpdateWorker` reads `KEY_WIFI_ONLY` with `true` | `PrefRenderer.visibleBy`, `util/UpdateWorker.kt`; three different fallbacks for two keys |
| `NetworkStatsStartTime` fails to parse in `MiscSettings` | `TimePref` writes an `Int`; the pack reads it with `getString` | `PrefStore.write` → `putInt` for `TimePref`; `MiscSettings.onPreferenceUpdated` calls `Xprefs.getString("NetworkStatsStartTime", "0:0")` and feeds it to `LocalTime.parse` |
| A screen crashes on open after a restore from an old backup | `SwitchPref`/single `ListPref` read unguarded | `PrefStore.read` catches `ClassCastException` only for `ColorPref` |
| Hooks read stale values after an import | Import replaces the file wholesale; hooks only re-read on change notification | `PxnNav`'s import handler calls `Restarter.restartSystemUI()` on success |

---

## Checklist

Before merging a preference change:

- [ ] `grep -r "<the key>" app/src/main/java/sh/siava/pixelxpert` returns exactly
      the node, the reader, and any intentional extra
- [ ] The node's `default` string equals the fallback literal in every reader
- [ ] The key is in `preferenceDefaults` if any node names it in `dependency`
- [ ] The getter matches the stored type: `getBoolean` for a switch,
      `getSliderInt`/`getSliderFloat`/`getSliderValues` for a slider, `getString`
      for text and single-select lists, `getStringSet` for multi-select,
      `getInt` for a time
- [ ] A range slider is written through `writeRange`, never `putFloat`
- [ ] The row has a `visibleBy` arm if it must disappear when its feature is off
- [ ] The owning screen is in `preferenceScreens`, `routeToScreenKey` (if routed),
      and `searchScreenTitles`
- [ ] Nothing acquired in the reader needs releasing in `onUnloaded`
- [ ] `docs/reference/preference-keys.md` and its JSON companion are regenerated
      in the same commit

---

## See also

- [App UI](app-ui.md)
- [Add a preference](../guides/add-a-preference.md)
- [Add a mod pack](../guides/add-a-mod-pack.md)
- [Preferences and IPC](preferences-and-ipc.md)
- [Architecture overview](overview.md)
