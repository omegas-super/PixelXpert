# Hot Reload

The generation model, the save/restore contract, what may and may not be carried
across a reload, and the ordering guarantees that make the swap safe. Read this
before touching `onHotReloading`, `onHotReloaded`, or anything a pack stores in
`onSaveHotReloadState`.

**Audience:** agent adding hot-reload state, or debugging "old code keeps
running" / "state resets on reload"
**Prereqs:** [xposed-runtime](xposed-runtime.md), [reflection-and-hooks](reflection-and-hooks.md)

---

## Summary

- Hot reload never mutates a generation. The framework constructs a new
  `XposedGeneration` and the old one is retired.
- `onHotReloading` collects a fixed 12-element `Array<Any?>` and hands it to the
  framework via `param.setSavedInstanceState(state)`. Only after that succeeds is
  the old generation retired.
- `onHotReloaded` attaches a fresh generation, restores the state, rebuilds the
  package, and finally unhooks whatever the new generation did not replace.
- Hook identity is what makes the swap safe: the new generation registers the same
  ids, and the framework replaces the hookers atomically.
- Pack-level state is per-pack, keyed by class name, and reached only by that
  pack's next generation.
- The module declares `autoHotReload=true` in its libxposed `module.prop`.

---

## Model

### The manifest flag

`app/src/main/resources/META-INF/xposed/module.prop`:

```text
minApiVersion=102
targetApiVersion=102
staticScope=true
autoHotReload=true
```

`autoHotReload=true` is what makes the framework deliver `onHotReloading` /
`onHotReloaded` at all. Without it the module is only ever loaded once and an
update requires a process restart.

### Two objects, one swap

| Object | Lifetime | Mutated by reload |
| --- | --- | --- |
| `XposedRuntime` (`object`) | process | No — its `generation` field is replaced |
| `XposedGeneration` | one load | No — `retire()` only sets `isRetired` and runs cleanups |

`XposedRuntime.attach` is the only place `generation` is assigned:

```kotlin
fun attach(module: XposedModule, processName: String, isSystemServer: Boolean): XposedGeneration {
	val previous = generation
	if (previous != null && !previous.isRetired) {
		previous.retire()
	}
	val next = XposedGeneration(module, module, processName, isSystemServer, sequence.incrementAndGet())
	generation = next
	log(Log.INFO, "Loaded generation ${next.sequence} in $processName (systemServer=$isSystemServer)")
	return next
}
```

The `previous.retire()` in `attach` covers the case where the framework loaded the
module twice without a hot reload — the KDoc calls it out: "Retire the old
generation cleanly rather than let two copies fight over the same hooks."

`retire()` is idempotent (`if (isRetired) return`).

### What a generation owns, and what retiring does

`XposedGeneration`:

| Collection | Type | On `retire()` |
| --- | --- | --- |
| `onceKeys` | `ConcurrentHashMap.newKeySet` | Not cleared — the generation is discarded anyway |
| `cleanups` | `CopyOnWriteArrayList<Cleanup>` | Run in reverse, each in `runCatching`; then cleared |
| `threads` | `ConcurrentHashMap.newKeySet<Thread>` | Each `interrupt()`ed; then cleared |
| `hooks` | `CopyOnWriteArrayList<HookHandle>` | **Deliberately not touched** |

```kotlin
fun retire() {
	if (isRetired) return
	isRetired = true
	cleanups.asReversed().forEach { cleanup ->
		runCatching(cleanup.action).onFailure { Log.e(TAG, "Generation cleanup failed", it) }
	}
	cleanups.clear()
	threads.forEach { it.interrupt() }
	threads.clear()
}
```

**Hooks are intentionally left installed.** The KDoc states the reason: "The
replacement generation re-registers the same ids, which lets the framework
atomically replace them; whatever it does not replace is unhooked from
`HotReloadedParam.oldHookHandles` once the new generation has finished."

`unhookAll()` exists but is only reached from `XposedRuntime.detach()`, which
nothing in the tree calls. It is the explicit-teardown path, not the reload path.

`installOnce(key, action)` is per-generation, and a failed action removes its key
again so a transient failure does not permanently mark the work as done:

```kotlin
fun installOnce(key: String, action: () -> Unit): Boolean {
	checkActive()
	if (!onceKeys.add(key)) return false
	try { action() } catch (t: Throwable) { onceKeys.remove(key); throw t }
	return true
}
```

`checkActive()` throws `IllegalStateException("This module generation has been
retired")` from `installOnce`, `startThread` and `hook`.

### The saved-state array

`onHotReloading` builds a positional array. The indices are the contract:

| Index | Value | Read back as |
| --- | --- | --- |
| 0 | `processName` | not read in `restoreState` (re-read from the callback param) |
| 1 | `isSystemServer` | not read in `restoreState` (re-read from the callback param) |
| 2 | `packsPackageName ?: loadedPackageName` | `loadedPackageName` |
| 3 | `packsClassLoader ?: loadedClassLoader` | `loadedClassLoader` |
| 4 | `packsDefaultClassLoader ?: loadedDefaultClassLoader` | `loadedDefaultClassLoader` |
| 5 | `packsAppComponentFactory ?: loadedAppComponentFactory` | `loadedAppComponentFactory` |
| 6 | `packsApplicationInfo ?: loadedApplicationInfo` | `loadedApplicationInfo` |
| 7 | `mContext` | `mContext` |
| 8 | `moduleResources` | `moduleResources` |
| 9 | `ReflectedClass.getFrameworkClassloader()` | `ReflectedClass.setFrameworkClassloader(...)` |
| 10 | `packsLoaded` | `packsLoaded` |
| 11 | `packStates` (`ArrayMap<String, Map<String, Any?>>`) | `pendingPackStates` |

Indices 0 and 1 are written but not read. `onHotReloaded` sets `processName` and
`isSystemServer` from `param.processName` / `param.isSystemServer` before calling
`restoreState`. They stay in the array so the positions of 2–11 are stable.

**The array is positional.** Inserting an element in the middle silently
reassigns every later field. Add to the end, or bump a version marker.

### What may be stored

The KDoc on `onHotReloading` states the rule:

> Saves only classloader-neutral state: strings, primitives, and framework
> objects (context, class loaders, resources, application info).

`XposedModPack.onSaveHotReloadState` repeats it for packs:

> Only framework objects (views, controllers, managers, interactors) may be
> stored; module objects and anything that still references this pack must be
> released in `onUnloaded` instead.

The reason is classloader identity. A hot reload gives the module a new class
loader. An object of a module class saved from the old generation is an instance
of the *old* class; the new generation cannot cast it, and holding it keeps the
old loader — and every class and static it owns — alive. A framework object
(`View`, `StateFlow`, `WindowManagerService`, an interactor) belongs to the host
process's loader, which does not change, so it survives.

| May be stored | May not be stored |
| --- | --- |
| `android.content.Context` | Anything of a `sh.siava.pixelxpert.*` class |
| `ClassLoader`, `Resources`, `ApplicationInfo`, `AppComponentFactory` | A `XposedModPack` instance or a field holding one |
| `android.view.View` and listeners' targets | A `HookHandle` |
| Framework managers, interactors, controllers | A `Thread`, `CountDownTimer`, `BroadcastReceiver`, `WakeLock` |
| Strings, primitives, `Boolean` | A lambda or anonymous class capturing the pack |

### Per-pack state

```kotlin
// XposedModPack
fun saveHotReloadState(outState: MutableMap<String, Any?>) { onSaveHotReloadState(outState) }
fun restoreHotReloadState(savedState: Map<String, Any?>) { onRestoreHotReloadState(savedState) }
protected open fun onSaveHotReloadState(outState: MutableMap<String, Any?>) {}
protected open fun onRestoreHotReloadState(savedState: Map<String, Any?>) {}
```

`XPLauncher.onHotReloading` iterates `runningMods` and keys each non-empty map by
`mod.javaClass.name`:

```kotlin
val modState = ArrayMap<String, Any?>()
mod.saveHotReloadState(modState)
if (modState.isNotEmpty()) packStates[mod.javaClass.name] = modState
```

An **empty** map is not stored. That is why the nine packs that implement the
callbacks are the only ones that carry anything.

On restore, `loadModPack` looks up `pendingPackStates?.get(thisClass.name)` after
`onPackageLoaded` and calls `restoreHotReloadState` in its own `try`.

The nine packs that implement hot-reload state, and what they keep:

| Pack | Keys stored | Kind |
| --- | --- | --- |
| `systemui/UDFPSManager` | `"view"`, `"viewModel"` | framework |
| `systemui/StatusIconTuner` | `"statusBar"`, `"quickSettings"`, `"keyguard"` | framework containers |
| `systemui/StatusbarGestures` | `"shadeInteractor"`, `"notificationPanel"` | framework |
| `systemui/GestureNavbarManager` | `"edgeBackGestureHandler"`, `"initialBackX"` | framework + `Float` |
| `systemui/NotificationManager` | `"headsUpManager"` | framework |
| `systemui/ScreenGestures` | `"notificationPanel"`, `"keyguardViewManager"`, `"dozeTouchTrigger"`, `"keyguardInteractor"`, `"shadeInteractor"` | framework |
| `systemui/KeyguardMods` | `"keyguardRootView"`, `"middleTextId"`, `"colorExtractor"`, `"dozing"`, `"supportsDarkText"` | framework + `Int` + `Boolean` |
| `systemui/CursorControlKeys` | `"imeVisible"` | `Boolean` |
| `android/PhoneWindowManager` | `"windowManager"` | framework |

Two details worth copying when you write your own:

- `StatusIconTuner` and the rest use `?.let { outState["k"] = it }`, so a pack
  whose framework object has not been captured yet saves an empty map — and an
  empty map is dropped by `onHotReloading`, so the pack starts fresh rather than
  restoring a map of nulls.
- `KeyguardMods` stores `mComposeKGMiddleCustomTextView?.let { outState["middleTextId"] = it.id }`
  — the `Int` id, not the view. A view it cannot guarantee is still attached is
  not carried; the id is enough to find it again. It also guards the root view
  with `takeIf { it.isAttachedToWindow }`, and every restore uses `as?` with a
  default.

`PhoneWindowManager` is the clearest example of why the mechanism exists: the
window manager handle is only captured once `enableScreen` runs, and the framework
does not replay that call after a reload. Without `onSaveHotReloadState` /
`onRestoreHotReloadState`, every hot-key action would NPE until the next reboot.

### The ordering guarantees

There are four, and each protects a specific failure.

**1. State is accepted before the old generation is retired.**

```kotlin
return try {
	param.setSavedInstanceState(state)
	generation.retire()
	true
} catch (t: Throwable) {
	Logger.log("PixelXpert: hot reload state could not be saved")
	Logger.log(t)
	false
}
```

If `setSavedInstanceState` throws, `retire()` never runs. Returning `false` tells
the framework the transfer failed, and the running module is untouched. Retiring
first would leave a process with no live generation and no state.

**2. `packStates` is collected before `retire()`, but read from the mod instances
that are about to be unloaded.** Each pack's `saveHotReloadState` is called inside
its own `try`, so one pack that throws does not abort the transfer:

```kotlin
} catch (t: Throwable) {
	Logger.log("PixelXpert: could not save hot reload state for ${mod.javaClass.name}")
	Logger.log(t)
}
```

The pack is then simply absent from `packStates` and starts fresh.

**3. Pack construction after a reload runs on the main thread.**

```kotlin
generation.installOnce("hot-reload-packs:$packageName") {
	ensureSystemUtils(context, param)
	XPrefs.setPackagePrefs(packageName)
	capturePackPackage(param)
	runOnMainThread { loadModPacks(param) }
	XPrefs.onContentProviderLoaded()
	packsLoaded = true
}
```

`runOnMainThread`'s KDoc states the reason: "A hot reload arrives on the
framework's reload thread, but packs are normally built on the main thread and
some of them construct `GestureDetector`/`Handler` state that requires a Looper
there."

```kotlin
private fun runOnMainThread(action: () -> Unit) {
	if (Looper.myLooper() == Looper.getMainLooper()) { action(); return }

	val latch = CountDownLatch(1)
	val failure = AtomicReference<Throwable?>()
	Handler(Looper.getMainLooper()).post {
		try { action() } catch (t: Throwable) { failure.set(t) } finally { latch.countDown() }
	}

	if (!latch.await(30, TimeUnit.SECONDS)) {
		throw IllegalStateException("Timed out loading mod packs on the main thread")
	}
	failure.get()?.let { throw it }
}
```

Without the hop, a pack like `ScreenGestures` or `StatusbarGestures` would
construct `GestureDetector`/`Handler` on the reload thread and either throw
`RuntimeException: Can't create handler inside thread that has not called
Looper.prepare()` or silently bind to the wrong looper.

The 30-second timeout exists because a main-thread post that never runs would
otherwise hang the reload thread forever.

**4. Old hooks are unhooked only after the new generation has finished.**

```kotlin
} finally {
	param.oldHookHandles.forEach { handle -> runCatching(handle::unhook) }
}
```

The `finally` means this runs even if `restoreState` or `reloadLoadedPackage`
threw. The comment states the invariant: "Hooks the new generation registered
with the same id replaced their old handles atomically; unhooking those is a
documented no-op. Anything not replaced is an old-generation hook that must not
keep running old code."

Unhooking *before* the new generation registered would leave a window with no
hook at all.

### Why `reloadLoadedPackage` does not replay `onPackageReady`

```kotlin
/**
 * Uses the saved package name/classloader/context rather than replaying
 * [onPackageReady], which the framework deliberately does not call again.
 */
```

After a hot reload the framework does not call `onPackageReady`, so a pack's
context hook — the only thing that delivers a `Context` — must be reinstalled by
the reload path or it would never fire:

```kotlin
// Reinstall the package hooks even when the context has not arrived yet ...
installPackageHooks(param)
```

`SavedPackageReadyParam` is a private reimplementation of the
`PackageReadyParam` interface, built from saved values:

| Member | Behaviour |
| --- | --- |
| `packageName` | as saved |
| `classLoader` | as saved |
| `defaultClassLoader` | as saved, falling back to `classLoader` |
| `applicationInfo` | as saved, else `ApplicationInfo()` with the package name set |
| `appComponentFactory` | as saved, else `AppComponentFactory()` |
| `isFirstPackage` | always `false` |

If the old generation had **not** finished waiting for the provider
(`!packsLoaded`), `reloadLoadedPackage` re-runs `waitForXprefsLoad(param)` instead
of reading preferences early:

```kotlin
if (!packsLoaded) {
	waitForXprefsLoad(param)
	return
}
```

### `XPrefs` and `SystemUtils` across the swap

Both are process-wide singletons, and both have a generation-scoped cleanup.

`XPrefs.release()`:

```kotlin
if (this::Xprefs.isInitialized) {
	runCatching { Xprefs.unregisterOnSharedPreferenceChangeListener(listener) }
}
packageName = null
```

It detaches the listener but does **not** clear `Xprefs`. `XPrefs.init(context)`
reassigns it in the new generation, so the object is replaced rather than reused.
The listener is a `private val` on the `object`, so the same instance is
re-registered — unregistering first is what stops a duplicate registration.

`SystemUtils.release()` is deliberately asymmetric:

```kotlin
fun release() {
	instance?.releaseInstance()
	// Keep [instance] reachable from this class loader. ...
}
```

`instance` is **not** nulled. The comment explains: framework listeners and views
created by the old generation are still attached to the live process and call
these static helpers after the switch. Dropping the instance there was "a
guaranteed NPE". `releaseInstance()` cancels the flash animator, unregisters the
volume receiver and audio-playback callback, and unregisters the torch callbacks —
but the `Handler`/`HandlerThread` survives, for the same reason.

---

## Walkthrough

A reload, in order.

### `onHotReloading` (old generation still live)

1. `XposedRuntime.generation ?: return false` — nothing to transfer.
2. Allocate `packStates = ArrayMap<String, Any?>()`.
3. For each `mod` in `runningMods.toList()` (a snapshot, because `runningMods` is a
   `CopyOnWriteArrayList`): build a fresh `ArrayMap`, call
   `mod.saveHotReloadState(modState)` inside `try`, store it under
   `mod.javaClass.name` if non-empty. A throw logs
   `PixelXpert: could not save hot reload state for <class>` and the pack is
   skipped.
4. Build the 12-element array (indices above).
5. `param.setSavedInstanceState(state)`.
6. `generation.retire()` — runs the three module cleanups plus every pack's
   `onUnloaded`, in reverse registration order, then interrupts tracked threads.
7. Return `true`.
   On any throw in steps 5–6, log `PixelXpert: hot reload state could not be
   saved` and return `false` without retiring.

### `onHotReloaded` (new generation)

1. `processName = param.processName`, `isSystemServer = param.isSystemServer`.
2. `XposedRuntime.attach(this, processName, isSystemServer)` — retires the old
   generation if it somehow was not retired, then installs the new one.
3. `registerGenerationCleanups(generation)` — the three cleanups again.
4. `ReflectedClass.setDefaultXposedInterface(this)`.
5. `val saved = param.savedInstanceState as? Array<*>`. If null, only the `finally`
   runs.
6. `restoreState(saved)` — writes indices 2–11 back into the fields, then
   re-derives the `loaded*` set from `mContext` when this is not system server,
   then copies `loaded*` into `packs*`.
7. `reloadLoadedPackage()`:
   - returns if `loadedPackageName`, `loadedClassLoader` or the generation is null
   - `ReflectedClass.setDefaultClassloader(classLoader)`
   - builds `SavedPackageReadyParam`
   - if `mContext != null`: re-derive `moduleResources` if absent, `XPrefs.init(context)`,
     `ensureSystemUtils(context, param)`
   - `installPackageHooks(param)` unconditionally
   - if `mContext == null`, return
   - if `!packsLoaded`, `waitForXprefsLoad(param)` and return
   - otherwise `installOnce("hot-reload-packs:$packageName")` → `ensureSystemUtils`,
     `XPrefs.setPackagePrefs`, `capturePackPackage`, `runOnMainThread { loadModPacks }`,
     `XPrefs.onContentProviderLoaded()`, `packsLoaded = true`
8. `finally`: `param.oldHookHandles.forEach { handle -> runCatching(handle::unhook) }`.
   A throw anywhere in 6–7 logs `PixelXpert: hot reload initialization failed` and
   still reaches the `finally`.

Each pack is then constructed by `loadModPack`, which calls `onPreferenceUpdated()`
(swallowing), `onPackageLoaded(param)`, and finally
`restoreHotReloadState(pendingPackStates[className])`.

---

## Contracts

- **Saved state must be classloader-neutral.** Strings, primitives, framework
  objects. A module object keeps the retired loader alive and cannot be cast by
  the new generation.
- **`saveHotReloadState` must not throw.** It is caught, but the pack then loses
  its state silently; log before you throw.
- **`restoreHotReloadState` must tolerate missing keys.** The map is only present
  if the previous generation saved something. Every implementation in the tree
  uses `savedState["x"] as? T` or `?.let`.
- **The saved-state array is positional and append-only.** Indices 0–11 are a
  contract with `restoreState`.
- **Retire only after `setSavedInstanceState` succeeds.** Never reorder those two
  statements.
- **Never unhook old handles before the new generation has registered.** The
  `finally` placement is the contract.
- **Pack construction after a reload must go through `runOnMainThread`.**
- **`onUnloaded` must release everything the pack owns that is *not* in the
  saved state.** If you save a view, do not also null it in `onUnloaded` before
  the save has run — `onUnloaded` runs during `retire()`, which happens *after*
  `saveHotReloadState`, so the ordering is safe, but do not move a release into
  `onHotReloading`.
- **Do not null `SystemUtils.instance`.** It is kept on purpose.
- **`installOnce` keys are per generation.** A key used in the cold path
  (`"packs:<pkg>"`) and one used in the reload path
  (`"hot-reload-packs:<pkg>"`) are different strings on purpose: they cannot
  collide, and each guards one path.

---

## Failure modes

| Symptom | Cause in code | Fix |
| --- | --- | --- |
| `PixelXpert: hot reload state could not be saved` then old code keeps running | `setSavedInstanceState` threw; `retire()` never ran and `onHotReloading` returned `false` | Read the following stack trace; the framework will usually reload the module without state |
| `PixelXpert: could not save hot reload state for <class>` | That pack's `onSaveHotReloadState` threw | The pack starts fresh on the new generation; fix the throw |
| `PixelXpert: could not restore hot reload state for <class>` | The pack's `onRestoreHotReloadState` threw, or a stored value has the wrong type | Use `as?` casts; the rest of the reload continues |
| `PixelXpert: hot reload initialization failed` | `restoreState` or `reloadLoadedPackage` threw | Old hooks are still unhooked by the `finally`; the process is left without packs until restart |
| `IllegalStateException: Timed out loading mod packs on the main thread` | `runOnMainThread`'s 30 s wait expired — the main looper is blocked | Find what blocked the main thread; a hot reload during a main-thread stall will always fail this way |
| Pack state resets to defaults after every reload | The pack does not implement `onSaveHotReloadState`, or saved an empty map (which is dropped) | Implement both callbacks and always put at least one key |
| `ClassCastException` on a restored value | A module object was stored, and the new loader's class is a different class | Store the framework object only; release the module object in `onUnloaded` |
| `IllegalStateException: This module generation has been retired` | `installOnce` / `startThread` / `hook` called on a retired generation | Guard with `XposedRuntime.generation?.isActive() == true` before doing generation work |
| Hooks fire twice after a reload | The hook id changed (line moved) so the framework stacked a new hook, and the old one was not in `oldHookHandles` | Keep hook call sites on stable lines, or supply an explicit `.id(...)` |
| `NullPointerException` in a static `SystemUtils` helper after a reload | Something nulled `SystemUtils.instance` during teardown | Do not; `release()` keeps it deliberately |
| Preferences stop updating after a reload | `XPrefs.release()` unregistered the listener and the new generation never re-registered | Confirm `XPrefs.onContentProviderLoaded()` runs on the reload path |
| A framework callback NPEs after a reload | A view or listener from the old generation calls back into the retired pack | Save the framework object, or detach the listener in `onUnloaded` |

---

## Checklist

Before adding or changing hot-reload state:

- [ ] Every value stored is a primitive, a String, or a framework object
- [ ] No `sh.siava.pixelxpert.*` instance is reachable from the saved map
- [ ] `onRestoreHotReloadState` uses `as?` and tolerates an empty map
- [ ] `onSaveHotReloadState` cannot throw for a normal running state
- [ ] Anything the pack acquired but did not save is released in `onUnloaded`
- [ ] Anything the pack acquired and *did* save is not also released in
      `onUnloaded`
- [ ] If you touched the saved-state array, you appended rather than inserted
- [ ] The new-generation path still calls `runOnMainThread { loadModPacks(...) }`
- [ ] `param.oldHookHandles` is still unhooked in a `finally`
- [ ] `SystemUtils.instance` and `XPrefs.Xprefs` are still reachable after
      `release()`

---

## See also

- [Architecture overview](overview.md)
- [Xposed runtime](xposed-runtime.md)
- [Mod pack lifecycle](modpack-lifecycle.md)
- [Reflection and hooks](reflection-and-hooks.md)
- [Preferences and IPC](preferences-and-ipc.md)
