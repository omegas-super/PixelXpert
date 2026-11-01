# Xposed Runtime

How `XPLauncher` turns a libxposed load into a running set of mod packs: the five
callbacks, the process-identity decision, the two context hooks, the preference
wait, and the root proxy binder. Read this before changing anything in
`app/src/main/java/sh/siava/pixelxpert/xposed/XPLauncher.kt`.

**Audience:** agent debugging "nothing loads", "loads in the wrong process", or
"root commands do nothing"
**Prereqs:** [overview](overview.md), [modpack-lifecycle](modpack-lifecycle.md)

---

## Summary

- `XPLauncher` extends `XposedModule` and is the only entry point the framework
  calls. It implements five callbacks: `onModuleLoaded`, `onSystemServerStarting`,
  `onPackageReady`, `onHotReloading`, `onHotReloaded`.
- Process identity (`processName`, `isSystemServer`) is captured in
  `onModuleLoaded` and decides which packs are allowed in. It is not read from
  the package name.
- A `Context` never arrives as a callback parameter. It is captured by hooking
  `PhoneWindowManager.init` in system server and `Instrumentation.newApplication`
  everywhere else.
- Before any pack is constructed, `waitForXprefsLoad` blocks until the module
  app's `RemotePrefProvider` answers. It probes a key that does not exist; the
  exception is the signal.
- `XposedRuntime` is a process-wide singleton holding one `XposedGeneration`.
  `XposedGeneration` owns hooks, threads and cleanups for exactly one load.
- Root is not held by hooked processes. They bind `PixelXpertProxy` over
  `IPixelXpertProxy` and queue commands until the binder arrives.

---

## Model

### The five callbacks, and what each one owns

| Callback | Sets | Why it exists |
| --- | --- | --- |
| `onModuleLoaded` | `processName`, `isSystemServer`, new generation | Process identity must be known before any pack is matched |
| `onSystemServerStarting` | `ReflectedClass.setFrameworkClassloader` | `com.android.server.*` is not visible from the app loader |
| `onPackageReady` | package snapshot, package hooks | The only point at which the framework hands over a `ClassLoader` |
| `onHotReloading` | saved-state array, retires old generation | Called before new code loads |
| `onHotReloaded` | new generation, restored state, unhooks leftovers | Called after new code loads |

`onSystemServerStarting` runs only in system server. `onPackageReady` runs once
per package the framework considers ready, which is not the same as once per
process — see the package-snapshot invariant below.

### `XposedRuntime` versus `XposedGeneration`

`XposedRuntime` (`app/src/main/java/sh/siava/pixelxpert/xposed/XposedRuntime.kt`)
is an `object` with process lifetime. It holds:

| Member | Type | Meaning |
| --- | --- | --- |
| `generation` | `XposedGeneration?` | The load currently servicing this process |
| `api` | `XposedInterface?` | `generation?.api` |
| `processName` | `String` | `generation?.processName.orEmpty()` |
| `isSystemServer` | `Boolean` | `generation?.isSystemServer == true` |
| `sequence` | `AtomicLong` | Generation counter, logged on attach |
| `additionalInstanceFields` | `WeakHashMap` | Legacy-compatible per-instance extra fields |

`XposedGeneration` (`app/src/main/java/sh/siava/pixelxpert/xposed/XposedGeneration.kt`)
is one load. It owns `onceKeys`, `cleanups`, `threads`, `hooks`, and an
`isRetired` flag. Retiring never mutates an existing generation: the framework
constructs a new one and the old one is retired.

The split exists so that every hook, thread and cleanup has exactly one owner,
and that owner can be dropped as a unit. Nothing on the Xposed side keeps hook
state in a bare static field.

### `XposedRuntime.isActive()` returns true when there is no generation

```kotlin
fun isActive(): Boolean = generation?.isActive() ?: true
```

The `?: true` is deliberate. `isActive` answers "may module work proceed", not
"is a generation attached". A guard that returned false before the first
`attach` would silently disable every call site that runs early. The
corresponding guard in `XPLauncher.initializeWithContext` reads:

```kotlin
if (mContext != null || !XposedRuntime.isActive()) return
```

Do not "fix" the `?: true`. If you need "is anything attached", test
`XposedRuntime.generation != null` — that is what `onXPrefsReady` and
`forceConnectRootService` do.

### Process targeting

`loadModPacks` decides per registry row:

```kotlin
val partOfProcessName = if (modPackData.targetsMainProcess) "" else modPackData.childProcessName
val matchesTarget = target == param.packageName ||
	target.isEmpty() ||
	(target == Constants.SYSTEM_FRAMEWORK_PACKAGE && isSystemServer)
if (matchesTarget && processName.contains(partOfProcessName)) { ... }
```

Three rules fall out of that expression:

1. An empty `targetPackage` matches every package. That is `@CommonModPack`, and
   it is how `HookTester` answers in all six processes.
2. `android` matches system server by the `isSystemServer` flag, not by comparing
   the package name — system server's package name is `android` but the check is
   the flag.
3. A non-main-process pack is gated on `processName.contains(childProcessName)`.
   `ScreenshotManager` is annotated `@ChildProcessModPack(processNameContains =
   "screenshot")`, so it runs in `com.android.systemui:screenshot` and in the main
   process (which also contains the string `com.android.systemui`). A pack whose
   marker does not appear in any process name never runs anywhere.

Note that the main-process branch uses the empty string as the marker, and every
string contains `""`. So `targetsMainProcess = true` is "no process filter",
not "main process only".

### The two context hooks

| Process | Hook | Context source |
| --- | --- | --- |
| System server, except telecom | `PhoneWindowManager.init` (before) | `hookParam.args[0] as Context` |
| Every other package, plus telecom | `Instrumentation.newApplication` (after) | `hookParam.args[args.size - 1] as Context` |

Telecom is special twice over. It runs inside system server, so the
`isSystemServer` branch would normally apply, but the code routes it through the
`Instrumentation` branch instead because telecom is its own package inside that
process:

```kotlin
if (isSystemServer && param.packageName != Constants.TELECOM_SERVER_PACKAGE) { ...PhoneWindowManager... }
if (!isSystemServer || param.packageName == Constants.TELECOM_SERVER_PACKAGE) { ...Instrumentation... }
```

The telecom case additionally uses a `TELECOM_SERVER_LOADED` flag so the pack
loads once even though `newApplication` can fire more than once.

`hook17BetaAudioManagerSRWorkaround` is installed unconditionally, before either
context hook. It rewrites a null `mApplicationContext` on `AudioManager` from
`mOriginalContext` so a framework service never sees the null context that the
Android 17 beta audio-focus retry path leaves behind.

### Why the system-server wait runs on a thread

```kotlin
if (isSystemServer && param.packageName != Constants.TELECOM_SERVER_PACKAGE && generation != null) {
	generation.startThread("pxn-prefs-${param.packageName}") { waitForXprefsLoad(param) }
} else {
	waitForXprefsLoad(param)
}
```

System server is still booting when it gets its context, and the module app may
not be startable yet. Blocking the system server main thread on the provider
hangs boot. Every other process blocks briefly instead, which is the original
behaviour and is what keeps pack construction on the main thread.

Because the thread is started through `generation.startThread`, retiring the
generation interrupts it, and `waitForXprefsLoad`'s loop condition checks
`!Thread.currentThread().isInterrupted`.

### Why the wait probes a key that does not exist

```kotlin
while (XposedRuntime.isActive() && !Thread.currentThread().isInterrupted) {
	try {
		XPrefs.Xprefs.getBoolean("LoadTestBooleanValue", false)
		break
	} catch (ignored: Throwable) {
		SystemUtils.threadSleep(1000)
	}
}
```

`LoadTestBooleanValue` is not a preference anywhere in the repo. It is not
supposed to be. A `RemotePreferences` read throws until the provider is
reachable — the content resolver cannot bind, so the read fails rather than
returning the default. The loop is therefore testing "does a read succeed at
all", and the value is irrelevant.

A real key would be worse: it would return its default the moment the provider
became reachable, which is exactly the same signal, but a reader would then be
tempted to give the key meaning. Keep the probe key meaningless.

### The package snapshot, and why there are two of them

`XPLauncher` keeps `loadedPackageName`/`loadedClassLoader`/… and separately
`packsPackageName`/`packsClassLoader`/… . The KDoc states the reason:

> A process can receive more than one package-ready callback, and the last one is
> not necessarily the package the packs were built for.

`onPackageReady` overwrites the `loaded*` set every time it fires.
`capturePackPackage` writes the `packs*` set at the moment the packs actually
load. `onHotReloading` prefers the `packs*` set (`packsPackageName ?:
loadedPackageName`), so a hot reload rebuilds the package the packs were built
for, not whichever callback happened last.

`restoreState` then re-derives the `loaded*` set from `mContext` for
non-system-server processes, because the application context always belongs to
the process:

```kotlin
if (!isSystemServer && context != null) {
	loadedPackageName = context.packageName
	loadedClassLoader = context.classLoader
	...
}
```

### Root proxy

Hooked processes hold no root. `PixelXpertProxy` is a bound `Service` in the
module app and the only root holder. `XPLauncher` connects to it lazily.

| Step | Code | Behaviour |
| --- | --- | --- |
| Trigger | `loadModPacks` | If `R.array.root_requirement` contains this package, call `forceConnectRootService()` |
| Wait | `forceConnectRootService` | Loops until `SystemUtils.UserManager()?.isUserUnlocked == true`, sleeping 2000 ms |
| Settle | `forceConnectRootService` | `SystemUtils.threadSleep(5000)` once |
| Bind | `connectRootService` | `bindService` to `ComponentName(BuildConfig.APPLICATION_ID, PixelXpertProxy::class.java.name)` |
| Retry | `forceConnectRootService` | `while (generation.isActive() && rootProxyIPC == null) { connectRootService(); threadSleep(5000) }` |
| Arrival | `onServiceConnected` | `IPixelXpertProxy.Stub.asInterface(service)`, count down, drain `proxyQueue` |
| Loss | `onServiceDisconnected` | Null the binder, re-run `forceConnectRootService()` if still active |

`root_requirement` is defined in `app/src/main/res/values/xp_module_scope.xml`
and lists `com.android.systemui` and `com.google.android.apps.nexuslauncher`.

Two entry points into the binder:

- `getRootProviderProxy()` — returns the binder or null, waiting up to 5 seconds.
  Used by `DepthWallpaper` for `extractSubject`.
- `enqueueProxyCommand { proxy -> ... }` — runs now if the binder exists,
  otherwise appends to `proxyQueue` and starts a connection. Every
  `runRootCommand` caller in the module uses this form.

The proxy is `IPixelXpertProxy` (`app/src/main/aidl/sh/siava/pixelxpert/IPixelXpertProxy.aidl`).
See [preferences-and-ipc](preferences-and-ipc.md) for its security checks and
failure strings.

---

## Walkthrough

Cold start of a hooked process, in order.

1. **`onModuleLoaded(param)`** — `processName = param.processName`,
   `isSystemServer = param.isSystemServer`. Then
   `XposedRuntime.attach(this, processName, isSystemServer)`, which retires any
   previous live generation, increments `sequence`, constructs the new
   `XposedGeneration` and logs
   `Loaded generation <n> in <process> (systemServer=<bool>)`.
2. **`registerGenerationCleanups(generation)`** registers three cleanups in this
   order: `XPrefs.release()`, `SystemUtils.release()`, `unbindRootService()`.
   They run in reverse on retire.
3. **System server only:** `onSystemServerStarting(param)` calls
   `ReflectedClass.setFrameworkClassloader(param.classLoader)`.
4. **`onPackageReady(param)`** stores the five `loaded*` fields, calls
   `ReflectedClass.setDefaultXposedInterface(this)`, then `installPackageHooks`.
5. **`installPackageHooks`** installs the audio-focus workaround, then one of the
   two context hooks (system server gets `PhoneWindowManager.init`; everything
   else, including telecom, gets `Instrumentation.newApplication`).
6. **Context arrives.** The hook body calls `initializeWithContext(param,
   context)`. The guard `if (mContext != null || !XposedRuntime.isActive())
   return` makes the second context hook a no-op once the first one won.
7. **`initializeWithContext`** stores `mContext`, derives `moduleResources` via
   `context.createPackageContext(BuildConfig.APPLICATION_ID,
   CONTEXT_IGNORE_SECURITY).resources`, calls `XPrefs.init(context)`, then
   dispatches `waitForXprefsLoad` to a tracked thread (system server) or inline.
8. **`waitForXprefsLoad`** loops on `XPrefs.Xprefs.getBoolean("LoadTestBooleanValue",
   false)` until it stops throwing. On exit it logs
   `Loading PixelXpert version: <version> on <package>` and, best-effort,
   `PixelXpert Records: <n>`. If the generation was retired meanwhile it returns
   without loading.
9. **`onXPrefsReady(param)`** first consults `BootLoopProtector.isBootLooped`.
   If tripped it logs `PixelXpert: Possible bootloop in <pkg>. Will not load for
   now` and returns.
10. **`generation.installOnce("packs:${param.packageName}")`** guards the rest so
    a second package-ready callback cannot load packs twice. Inside, in order:
    `ensureSystemUtils` (itself an `installOnce` on `systemutils:<pkg>`),
    `XPrefs.setPackagePrefs`, `capturePackPackage`, `loadModPacks`,
    `XPrefs.onContentProviderLoaded()`, `packsLoaded = true`.
11. **`loadModPacks`** sets the default class loader, conditionally starts the
    root connection, then walks `ModPacks.getModPacks()` and calls `loadModPack`
    for every matching row.
12. **`loadModPack`** constructs `thisClass.getConstructor(Context::class.java)
    .newInstance(mContext)`, calls `onPreferenceUpdated()` inside a swallowing
    `try`, then `onPackageLoaded(param)`, restores any `pendingPackStates` entry
    for this class, adds the instance to `XPLauncher.runningMods`, and registers
    `onUnloaded()` as a generation cleanup.

The pack half of steps 11–12 is [modpack-lifecycle](modpack-lifecycle.md).

---

## Contracts

- **`XPLauncher.instance` is set in `init`.** Anything reading it before the
  first `XPLauncher` construction sees null. `getRootProviderProxy` and
  `enqueueProxyCommand` both null-check it.
- **Never call `XposedRuntime.attach` yourself.** It is `XPLauncher`'s job, and a
  second call retires the live generation, which stops every pack.
- **Never construct a pack outside `loadModPack`.** The instance is what gets the
  `onUnloaded` cleanup registered; a pack constructed elsewhere is never
  unloaded.
- **Do not block system server's main thread.** Use
  `generation.startThread(name) { ... }` for anything that waits.
- **A pack constructor must take exactly one `Context` parameter.** `loadModPack`
  reflects `getConstructor(Context::class.java)`. Any other signature throws
  `NoSuchMethodException` and the pack is skipped.
- **`onPackageLoaded` must be safe to call before any hook of its own fires.**
  Packs that need a live framework object capture it from a later callback, as
  `CaffeineTile.adoptTile` does.
- **Only `XPLauncher` may touch `rootProxyIPC`.** It is `private` in the
  companion object; external callers go through `getRootProviderProxy` or
  `enqueueProxyCommand`.

---

## Failure modes

| Symptom | Cause in code | Fix |
| --- | --- | --- |
| No pack loads in any process, no `Loading PixelXpert version` line | `waitForXprefsLoad` never breaks: `RemotePrefProvider` unreachable. Check the provider authority matches `BuildConfig.APPLICATION_ID` | Verify the `<provider>` in `app/src/main/AndroidManifest.xml` and `RemotePrefProvider`'s constructor argument |
| `PixelXpert: Possible bootloop in <pkg>. Will not load for now` | `BootLoopProtector.isBootLooped` returned true: 3 strikes within 60 s | Clear `packageStrike_<pkg>` and `packageLastLoad_<pkg>`, or call `SystemUtils.restart("systemui")` which resets the counter |
| `Start Error Dump - Occurred in <class>` | The pack's constructor, `onPreferenceUpdated`, or `onPackageLoaded` threw. The stack trace follows on the next log line | Read the trace; most often a missing framework class or a wrong constructor signature |
| Packs load in the wrong process | `processName.contains(partOfProcessName)` matched, or the annotation targets a different package | Check the annotation, not the directory — see [modpack-lifecycle](modpack-lifecycle.md) |
| Telecom hooks never fire | `TELECOM_SERVER_LOADED` was already set by an earlier generation, or the package is not `Constants.TELECOM_SERVER_PACKAGE` | Confirm the process really is `com.android.server.telecom` |
| Root commands silently do nothing | `enqueueProxyCommand` queued the command and the binder never arrived: `forceConnectRootService` is still waiting for `isUserUnlocked`, or `root_requirement` does not list this package | Check logcat for `Root request failed: <command>`; verify the package is in `R.array.root_requirement` |
| `IllegalStateException: Xposed API is not attached in this process` | `XposedRuntime.requireApi()` called with `generation == null` | Only reachable via `invokeOriginal`; do not call it before a generation is attached |
| `IllegalStateException: Timed out loading mod packs on the main thread` | `runOnMainThread` waited 30 s for the main looper | A hot-reload path deadlocked the main thread; see [hot-reload](hot-reload.md) |

---

## Checklist

Before changing `XPLauncher` or `XposedRuntime`:

- [ ] The change does not add a static field that outlives a generation
- [ ] Anything that waits is on a `generation.startThread` thread, not the main
      thread, when the process is system server
- [ ] Anything constructed is registered with `generation.registerCleanup`
- [ ] A new early-return guard uses `XposedRuntime.generation != null`, not
      `!XposedRuntime.isActive()`, if the intent is "nothing attached yet"
- [ ] The `LoadTestBooleanValue` probe key still does not exist in the
      preference tree
- [ ] `packs*` and `loaded*` snapshots are still both written if you touch the
      hot-reload path

---

## See also

- [Architecture overview](overview.md)
- [Mod pack lifecycle](modpack-lifecycle.md)
- [Preferences and IPC](preferences-and-ipc.md)
- [Reflection and hooks](reflection-and-hooks.md)
- [Hot reload](hot-reload.md)
