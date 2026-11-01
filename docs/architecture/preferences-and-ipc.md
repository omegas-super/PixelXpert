# Preferences and IPC

How a preference value written by the Compose UI becomes a value a hook reads
inside SystemUI, and every other channel the two halves of the APK use to talk:
RemotePreferences, the change listener, the broadcasts in `Constants.kt`, and the
root binder.

**Audience:** agent debugging "the setting does nothing", or adding a
cross-process channel
**Prereqs:** [overview](overview.md), [xposed-runtime](xposed-runtime.md)

---

## Summary

- Preferences cross the process boundary through `RemotePreferences` from
  `com.crossbowffs.remotepreferences:remotepreferences:0.8`. There is no push and
  no polling: the library's provider `notifyChange` drives the listener.
- The contract is two strings: authority = `BuildConfig.APPLICATION_ID`, file =
  `BuildConfig.APPLICATION_ID + "_preferences"`.
- The file must live in **device-protected storage**. Both sides depend on that;
  the Xposed side reads before the user unlocks.
- `ExtendedRemotePreferences` gates its listener fan-out on
  `PrefStore.LEGACY_INIT_MARKER` so a pack never sees a half-populated store.
- `XPrefs.loadEverything` is the single fan-out point: it calls
  `onPreferenceUpdated(key)` on every instance in `XPLauncher.runningMods`.
- The root binder is `IPixelXpertProxy`, implemented by `PixelXpertProxy`, and it
  re-checks the caller's package against `R.array.root_requirement` on every call.

---

## Model

### The preference file, and why its location is a contract

`app/src/main/java/sh/siava/pixelxpert/data/PrefStore.kt`

```kotlin
fun open(context: Context): SharedPreferences = context.applicationContext
	.createDeviceProtectedStorageContext()
	.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

val FILE_NAME: String = BuildConfig.APPLICATION_ID + "_preferences"
const val LEGACY_INIT_MARKER = "IsPrefsInitiated"
const val REMOTE_PREF_AUTHORITY: String = BuildConfig.APPLICATION_ID   // top-level
```

The KDoc on `open` records the failure it prevents: "`RemotePrefProvider` serves
`RemotePreferenceFile(FILE_NAME, true)`, so a key written through
credential-protected storage lands in a file the hooks never open — silently,
because the name matches on both sides."

The second boolean in `RemotePreferenceFile(PrefStore.FILE_NAME, true)` is the
device-protected flag. `RemotePrefProvider` is declared `directBootAware` in
`app/src/main/AndroidManifest.xml`, so Android can start the app process before
unlock, and the store answers then. Every read and write of `FILE_NAME` goes
through `PrefStore.open`; calling `context.getSharedPreferences(FILE_NAME, …)`
directly is the bug that function exists to prevent.

`PrefStore.markReady` (`called from PxnApp.onCreate`) writes the marker with
`commit()` and then migrates any keys left in credential-protected storage by an
older build. If either step throws — which happens during direct boot, where
`getSharedPreferences` on the credential store raises `IllegalStateException` —
it registers an `ACTION_USER_UNLOCKED` receiver and retries, rather than letting
the throw escape `Application.onCreate` and kill the process.

### The provider side

`app/src/main/java/sh/siava/pixelxpert/data/RemotePrefProvider.kt`

```kotlin
class RemotePrefProvider :
	RemotePreferenceProvider(
		BuildConfig.APPLICATION_ID,
		arrayOf(RemotePreferenceFile(PrefStore.FILE_NAME, true)),
	)
```

Declared in `app/src/main/AndroidManifest.xml` with
`android:authorities="${applicationId}"`, `directBootAware="true"`,
`exported="true"`.

`query` is overridden for one side effect only:

```kotlin
val cursor = super.query(uri, projection, selection, selectionArgs, sortOrder)
context?.let { HooksMonitor.onHookReported(it, Binder.getCallingUid(), Binder.getCallingPid()) }
return cursor
```

Because `XPLauncher` reads a probe key before loading any pack, a query is the
earliest evidence that the module is running in the caller. `HooksMonitor`
records the pid per tracked package and later kills processes that started
without the module.

### The reader side

`app/src/main/java/sh/siava/pixelxpert/xposed/XPrefs.kt`

```kotlin
lateinit var Xprefs: ExtendedRemotePreferences

fun init(context: Context) {
	packageName = context.packageName
	Xprefs = ExtendedRemotePreferences(
		context,
		BuildConfig.APPLICATION_ID,
		BuildConfig.APPLICATION_ID + "_preferences",
		true,
	)
}
```

`Xprefs` is `lateinit`, not nullable. The KDoc explains why the `if (Xprefs ==
null) return` guard that older packs carry is dead code: an uninitialised read
throws `UninitializedPropertyAccessException` rather than yielding null, so the
guard can never fire. Do not add it back.

`XPrefs` also exposes `MagiskRoot = "/data/adb/modules/PixelXpert"`, used by
`ModuleFolderOperations`.

### `ExtendedRemotePreferences` — two things layered over the library

`app/src/main/java/sh/siava/pixelxpert/xposed/utils/ExtendedRemotePreferences.kt`

1. **A fan-out listener list.** The library keeps one listener slot;
   `mOnSharedPreferenceChangeListeners` is a `Collections.synchronizedList` so
   more than one pack can observe changes.
2. **A readiness gate on `PrefStore.LEGACY_INIT_MARKER`.** Until the marker reads
   `true`, changes are withheld so a pack never sees half a preference set.

```kotlin
private val l = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
	if (PrefStore.LEGACY_INIT_MARKER == key) {
		mIsPrefsInitiated = getBoolean(PrefStore.LEGACY_INIT_MARKER, false)
	}
	if (mIsPrefsInitiated && mOnSharedPreferenceChangeListeners.isNotEmpty()) {
		synchronized(mOnSharedPreferenceChangeListeners) { mOnSharedPreferenceChangeListeners.toList() }
			.forEach { it.onSharedPreferenceChanged(this, key) }
	}
}
```

`l` is a **field, not an inline lambda**, and the comment says why: "RemotePreferences
registers this with the content resolver, and a lambda handed over inline would be
collectable the moment this method returns." An inline lambda would be collected,
and the listener would stop firing — silently.

`initListener()` runs once (`mListenerRegistered`), reads the marker with
`super.getBoolean` to bypass the override, and registers `l`.

`getInt` is overridden to tolerate a value stored as a colour string or a hex
literal, falling back to `Color.parseColor`, then `removePrefix("0x").toLongOrNull(16)`,
then `defValue`. This exists because `getInt` on a key written as a String throws
`ClassCastException` inside `SharedPreferencesImpl`.

Three slider helpers delegate to `SliderValues`:

| Method | Delegate |
| --- | --- |
| `getSliderInt(key, defaultVal)` | `SliderValues.getSingleIntValue` |
| `getSliderFloat(key, defaultVal)` | `SliderValues.getSingleFloatValue` |
| `getSliderValues(key, defaultValue)` | `SliderValues.getValues` |

`SliderValues` tries String first, then Float, then Int, and parses `{"":[lo,hi]}`
JSON with `JsonReader`. The String-first order is load bearing: a single-handle
slider stores a Float, a range slider stores the JSON string, and an imported
preference file may carry either.

### The fan-out

```kotlin
fun loadEverything(packageName: String, vararg key: String?) {
	if (key.isNotEmpty() &&
		(key[0] == null || Constants.PREF_UPDATE_EXCLUSIONS.any { key[0]!!.startsWith(it) })
	) return

	setPackagePrefs(packageName)
	for (mod in XPLauncher.runningMods) {
		mod.onPreferenceUpdated(*key)
	}
}
```

Called from two places: the `OnSharedPreferenceChangeListener` in `XPrefs` (one
key), and `onContentProviderLoaded()` with no key (the initial "load everything"
pass). `onContentProviderLoaded` then registers the listener — order matters,
because before the provider answers the first read throws.

`setPackagePrefs` is empty. Its KDoc says it is kept because the call site is part
of the load sequence.

`PREF_UPDATE_EXCLUSIONS` is `listOf(LOAD_TIME_KEY_KEY, PACKAGE_STRIKE_KEY_KEY)`.
Both are bootloop bookkeeping; relaying them would re-enter `loadEverything` from
inside `BootLoopProtector`.

### Broadcast contracts

`app/src/main/java/sh/siava/pixelxpert/Constants.kt`

| Constant | Value | Sender | Receiver |
| --- | --- | --- | --- |
| `ACTION_CHECK_XPOSED_ENABLED` | `"<id>.ACTION_CHECK_XPOSED_ENABLED"` | `HooksScreen` | `HookTester` |
| `ACTION_XPOSED_CONFIRMED` | `"<id>.ACTION_XPOSED_CONFIRMED"` | `HookTester` | `HooksScreen` |
| `ACTION_REQUEST_HOOK_AUDIT` | `"<id>.ACTION_REQUEST_HOOK_AUDIT"` | `HookAuditScreen` | `HookAuditor` |
| `ACTION_HOOK_AUDIT_RESULT` | `"<id>.ACTION_HOOK_AUDIT_RESULT"` | `HookAuditor` | `HookAuditScreen` |
| `ACTION_HOME` | `"<id>.ACTION_HOME"` | `CustomNavGestures` | `PhoneWindowManager` |
| `ACTION_BACK` | `"<id>.ACTION_BACK"` | `CustomNavGestures` | `PhoneWindowManager` |
| `ACTION_SLEEP` | `"<id>.ACTION_SLEEP"` | `CustomNavGestures` | `PhoneWindowManager` |
| `ACTION_SWITCH_APP_PROFILE` | `"<id>.ACTION_SWITCH_APP_PROFILE"` | `CustomNavGestures`, `StatusbarGestures` | `PhoneWindowManager` |
| `ACTION_PROFILE_SWITCH_AVAILABLE` | `"<id>.ACTION_PROFILE_SWITCH_AVAILABLE"` | `PhoneWindowManager` | `StatusbarMods` |

`<id>` is `Constants.APPLICATION_ID`, which is `BuildConfig.APPLICATION_ID`. The
KDoc calls this out: "Both are derived from the application id, so a module
installed under the same id keeps talking to old hook code."

Extras:

| Broadcast | Extra | Type |
| --- | --- | --- |
| `ACTION_XPOSED_CONFIRMED` | `"packageName"` | String |
| `ACTION_HOOK_AUDIT_RESULT` | `"packageName"` | String |
| `ACTION_HOOK_AUDIT_RESULT` | `"auditJson"` | String (Gson of `ProcessAuditReport`) |

Every reply from a hooked process uses `setPackage(BuildConfig.APPLICATION_ID)`
so it reaches the module app and nobody else. `HooksScreen` gives the hooks five
seconds to answer and treats silence as "unresponsive" rather than "checking".

`getAppProfileSwitchIntent()` is the one broadcast built through a helper, and it
adds `Intent.FLAG_RECEIVER_FOREGROUND`. The KDoc explains: a profile switch is a
gesture response, and a late one reads as a dead gesture.

### The root binder

Hooked processes have no root. The module app does.

| Piece | File | Role |
| --- | --- | --- |
| `IPixelXpertProxy` | `app/src/main/aidl/sh/siava/pixelxpert/IPixelXpertProxy.aidl` | `runRootCommand(String): String[]`, `extractSubject(Bitmap, int): Bitmap` |
| `PixelXpertProxy` | `app/src/main/java/sh/siava/pixelxpert/service/PixelXpertProxy.kt` | the bound `Service`, holds the libsu shell |
| `IRootProviderService` | `app/src/main/aidl/sh/siava/pixelxpert/IRootProviderService.aidl` | `checkLSPosedDB`, `isPackageInstalled`, `activateInLSPosed`, `getFileSystemService` |
| `RootProvider` | `app/src/main/java/sh/siava/pixelxpert/service/RootProvider.kt` | a libsu `RootService`, runs as root |

`PixelXpertProxy` is declared `exported="true"` in the manifest with no
permission, so it protects itself in `ensureEnvironment()`:

```kotlin
private fun ensureEnvironment() {
	if (!rootGranted) throw RemoteException("Root is not granted")
	ensureSecurity(Binder.getCallingUid())
}

private fun ensureSecurity(callingUid: Int) {
	val pkgs = packageManager.getPackagesForUid(callingUid)
	if (pkgs != null) {
		for (packageName in pkgs) if (rootAllowedPacks.contains(packageName)) return
	}
	throw RemoteException("You do know that this is a shady request, right?")
}
```

`rootAllowedPacks` is `R.array.root_requirement`, read at binder construction.
`runRootCommand` wraps everything in a `try` that logs
`Root request failed: <command>` and returns an empty array, so a failure comes
back as an empty result rather than a transaction crash in the hooked process.

`PixelXpertProxyIPC` is an **inner** class, and the comment says why: "Because
this is a bind-service, the binder object must not be static, or it will be
GC'd and the process will die."

`extractSubject` is not implemented:

```kotlin
override fun extractSubject(input: Bitmap?, method: Int): Bitmap? = throw RemoteException(
	"PixelXpertProxy.extractSubject is not ported yet: " +
		"it is only reachable from the DepthWallpaper mod pack, " +
		"which is not part of this slice.",
)
```

That message is stale. `DepthWallpaper` **is** in the tree
(`app/src/main/java/sh/siava/pixelxpert/xposed/modpacks/systemui/DepthWallpaper.kt`)
and it does call `XPLauncher.getRootProviderProxy()?.extractSubject(...)`. The
call therefore always throws, and the caller's `catch (ignored: Throwable) { }`
swallows it — so the depth-wallpaper subject mask is never produced. See the
failure table.

`RootProvider` is separate: it is a libsu `RootService` used by the Hooks screen
to read the LSPosed scope database at
`/data/adb/lspd/config/modules_config.db` through the bundled
`/data/adb/modules/PixelXpert/sqlite3`.

### Hook-status monitoring

`app/src/main/java/sh/siava/pixelxpert/data/HooksMonitor.kt`

The provider records pids; `BootReceiver` calls `HooksMonitor.schedule` on
`LOCKED_BOOT_COMPLETED` and again on `BOOT_COMPLETED`. `check` runs once per boot
(guarded by a `CHECKED` flag committed with `commit()`), and for each tracked
package whose running pid never reported, runs `killall <process>` so Android
restarts it with the module.

`TRACKED` covers SystemUI, launcher, Settings and Dialer — not system server,
because system server cannot be killed and restarted that way.

The store is `context.createDeviceProtectedStorageContext().getSharedPreferences("hooks_monitor", …)`
and is cleared whenever `/proc/sys/kernel/random/boot_id` changes (falling back
to `Settings.Global.BOOT_COUNT`).

---

## Walkthrough

A switch flip reaching a hook.

1. The Compose row calls `PrefStore.putBoolean(key, value)`.
2. `putBoolean` writes `prefs.edit().putBoolean(key, value).apply()` and bumps
   `_revision`, which invalidates every composable reading `PrefStore.revision`.
3. `SharedPreferencesImpl` notifies its own listeners. `RemotePreferenceProvider`
   has registered a content observer on the same file and calls `notifyChange` on
   the provider URI.
4. In the hooked process, the `RemotePreferences` client's content observer fires
   and invokes `l` inside `ExtendedRemotePreferences`.
5. `l` checks whether the key is the init marker (it is not), then checks
   `mIsPrefsInitiated`. If false, it returns — the change is dropped, by design.
6. Otherwise it snapshots `mOnSharedPreferenceChangeListeners` under the monitor
   and calls each listener. There is exactly one in practice: `XPrefs.listener`.
7. `XPrefs.listener` reads `packageName` (null → return) and calls
   `loadEverything(target, key)`.
8. `loadEverything` drops the key if it starts with a bootloop prefix, then calls
   `onPreferenceUpdated(key)` on every instance in `XPLauncher.runningMods`.
9. The pack re-reads its keys through `Xprefs` and reconfigures its state
   fields. Most packs also act immediately, e.g. `UDFPSManager.onPreferenceUpdated`
   calls `setUDFPSGraphics(true)` when the key is one of its two.

The initial load is the same path with no key: `onContentProviderLoaded()` calls
`loadEverything(packageName)` before registering the listener, so every pack gets
one "read everything" pass before it ever sees an incremental change.

---

## Contracts

- **Authority and file name are a cross-process contract.** Changing either
  disconnects the UI from the hooks silently, and orphans the preference file
  already on the device.
- **All preference I/O goes through `PrefStore.open`.** It is the only place that
  applies `createDeviceProtectedStorageContext`.
- **The init marker is written with `commit()`, before the provider is created.**
  `PxnApp.onCreate` runs `PrefStore.markReady(this)` for exactly that ordering
  reason.
- **A pack must never write a preference key it does not own.** Writes from the
  hooked process go through the remote editor and will be seen by every other
  pack as a change.
- **Never relay the bootloop keys.** They are in `PREF_UPDATE_EXCLUSIONS`; a
  second writer or a removal of the exclusion causes re-entrancy.
- **Broadcast replies must `setPackage(BuildConfig.APPLICATION_ID)`.** An
  unaddressed reply from a system process is visible to anything listening.
- **Broadcast action strings must stay derived from `APPLICATION_ID`.** A literal
  breaks cross-version compatibility.
- **`PixelXpertProxy` must keep `ensureEnvironment()` as the first statement of
  every binder entry point.** The service is exported with no permission.
- **`PixelXpertProxyIPC` must stay an inner class.** A static binder gets
  collected and the process dies.

---

## Failure modes

| Symptom | Cause in code | Fix |
| --- | --- | --- |
| Setting changes in UI, hook never reacts | Key mismatch between `PrefStore` write and `Xprefs.get*` read | Grep the literal in both `ui/` and `xposed/` |
| Hook reacts once at startup, then never again | `mIsPrefsInitiated` is false: the marker was never written, so `l` drops every change | Confirm `PrefStore.LEGACY_INIT_MARKER` is `true` in the preference file |
| Preferences read as defaults in SystemUI but are correct in the app | Keys were written to credential-protected storage | Confirm `PrefStore.open` is the writer; the migration in `markReady` handles legacy installs |
| No pack loads at all, `waitForXprefsLoad` never returns | Provider authority does not match `BuildConfig.APPLICATION_ID` | Check `<provider android:authorities>` in the manifest |
| `ClassCastException` from `SharedPreferencesImpl` on a slider key | The key holds a String (range JSON) and was read with `getFloat` | Use `getSliderInt` / `getSliderFloat` / `getSliderValues` |
| Depth-wallpaper subject mask never appears | `PixelXpertProxy.extractSubject` throws `RemoteException` unconditionally; `DepthWallpaper`'s `catch (ignored: Throwable)` hides it | Port `extractSubject`, or accept that the feature is inert |
| `Root request failed: <command>` in logcat, empty result | `rootGranted` false (libsu has no root) or `ensureSecurity` threw `"You do know that this is a shady request, right?"` | Confirm the calling package is in `R.array.root_requirement` and Magisk granted root |
| Hooks screen shows every row "no response" | `HookTester` never loaded — it is `@CommonModPack`, so a missing registry row silences all six processes | Check the generated `ModPacks.kt` and the process log for `PixelXpert hook test successful for <pkg>` |
| Hook audit returns nothing for a package | `HookAuditor` returns null for anything but SystemUI, `android`, launcher | Expected; the other inspectors do not exist |
| App process killed at boot with `IllegalStateException` | A credential-protected `getSharedPreferences` call escaped `Application.onCreate` | Route it through `PrefStore.open`, or wrap it as `markReady` does |
| A tracked app is killed once per boot with no module problem | `HooksMonitor` found a pid that never queried the provider | Expected recovery path; check logcat tag `HooksMonitor` for `restarting <process>: pid <n> did not report` |

---

## Checklist

Before adding or changing a preference or an IPC channel:

- [ ] The key literal is identical in `ui/` and `xposed/` (grep both)
- [ ] The value type matches what the writer stores (Boolean, Float, String,
      StringSet) and the reader uses the matching accessor
- [ ] Slider keys use `getSlider*`, never `getFloat` / `getInt` directly
- [ ] The key is not added to `PREF_UPDATE_EXCLUSIONS` unless it is bootloop
      bookkeeping
- [ ] A new broadcast action is derived from `APPLICATION_ID`, not hardcoded
- [ ] A new hooked-process reply uses `setPackage(BuildConfig.APPLICATION_ID)`
- [ ] A new binder entry point calls `ensureEnvironment()` first
- [ ] The new entry point wraps its body so a failure returns an empty result
      rather than throwing across the binder

---

## See also

- [Architecture overview](overview.md)
- [Xposed runtime](xposed-runtime.md)
- [Reflection and hooks](reflection-and-hooks.md)
- [Hot reload](hot-reload.md)
- [Repository map](../agent/REPO_MAP.md)
