# Reflection and Hooks

The hook DSL every mod pack is written against: how a class is resolved, how a
hook is identified, how the before/after callback shapes differ, how the original
method is reached, and how the bootloop protector and hook auditor observe the
result.

**Audience:** agent writing or debugging a hook
**Prereqs:** [xposed-runtime](xposed-runtime.md), [modpack-lifecycle](modpack-lifecycle.md)

---

## Summary

- `ReflectedClass.of(...)` wraps a possibly-null `Class<*>`. A null class is legal
  and makes the whole hook chain a no-op instead of a throw.
- `.before(...)` / `.after(...)` return builders; `.run { param -> }` installs the
  hook and returns `Set<HookHandle>`.
- Every registration gets an API 102 hook id derived from the callsite and the
  target. The same id on the next generation replaces the hook atomically.
- `HookHelper.hookMethod` is the single interceptor: it checks
  `XposedRuntime.isActive()` first and passes through when the generation is
  retired.
- `XposedRuntime.invokeOriginal` uses the API 102 `Invoker` with
  `Invoker.Type.ORIGIN` and unwraps `InvocationTargetException`.
- `BootLoopProtector` refuses to load a package after 3 strikes inside 60
  seconds.

---

## Model

### The DSL surface

`app/src/main/java/sh/siava/pixelxpert/xposed/utils/reflection/ReflectedClass.kt`

| Call | Returns | Hooks |
| --- | --- | --- |
| `of(name)`, `of(name, loader)`, `of(clazz)` | `ReflectedClass` | nothing yet |
| `ofIfPossible(name)`, `ofIfPossible(name, loader)` | `ReflectedClass` | nothing yet |
| `.before(methodName: String)` | `BeforeMethodData` | every declared overload with that name |
| `.before(method: Method)` | `BeforeMethodData` | that one method |
| `.before(pattern: Pattern)` | `BeforeMethodDatas` | every declared method whose name matches |
| `.beforeConstruction()` | `BeforeMethodData` | every declared constructor |
| `.after(...)`, `.afterConstruction()` | `AfterMethodData` / `AfterMethodDatas` | same shapes, after the call |
| `.run { param -> }` | `Set<HookHandle>` | installs |

`of` and `ofIfPossible` differ only in intent, not in behaviour: both fall back to
the framework class loader when the first lookup fails, and both can return a
wrapper around null.

```kotlin
fun of(name: String, loader: ClassLoader?): ReflectedClass {
	var c = Reflection.findClassIfExists(name, loader)
	if (c == null) c = Reflection.findClassIfExists(name, frameworkClassloader)
	return ReflectedClass(c)
}
```

The KDoc states the contract: "The wrapped `clazz` is allowed to be **null** …
the `before`/`after` builders then short-circuit to an empty handle set instead
of throwing. That is what lets a pack target an API a given Android build simply
does not have."

This is the mechanism behind the multi-Android-version support in this repo.
`ScreenshotManager` calls `ReflectedClass.ofIfPossible("android.window.ScreenCaptureInternal.CaptureArgs")`
for A16 QPR2 and `ReflectedClass.ofIfPossible("android.window.ScreenCapture.CaptureArgs")`
for QPR1; whichever resolves hooks, the other silently does nothing.

Do not add a null check for `clazz` unless you are branching on it. The
`if (ScreenshotPolicyImplClass.clazz != null)` guard in `ScreenshotManager` is
the legitimate form: it is a decision, not a safety check.

### Where the class loaders come from

| Field | Set by | Used as |
| --- | --- | --- |
| `defaultClassloader` | `XPLauncher.loadModPacks` / `reloadLoadedPackage` via `setDefaultClassloader(param.classLoader)` | fallback for `of(name)` |
| `frameworkClassloader` | `XPLauncher.onSystemServerStarting` via `setFrameworkClassloader(param.classLoader)` | second-chance lookup in `of` |
| `explicitDefaultXposedInterface` | `XPLauncher.onPackageReady` / `onHotReloaded` via `setDefaultXposedInterface(this)` | the `XposedInterface` the DSL installs through |

`defaultXposedInterface` is `explicitDefaultXposedInterface ?: XposedRuntime.api`,
so the DSL still works if only `XposedRuntime` has a generation.

`RecordingMessage` calls `ReflectedClass.setDefaultClassloader(PRParam.classLoader)`
inside `onPackageLoaded` — the one pack that sets it locally. Any pack running
after it in the same process inherits that loader.

### Hook ids

`app/src/main/java/sh/siava/pixelxpert/xposed/utils/reflection/HookId.kt`

```kotlin
fun forMethod(caller: HookCaller, clazz: Class<*>, label: String): String =
	"$PREFIX:${caller.className}#${caller.methodName}:${caller.line}->${clazz.name}#$label"
```

with `PREFIX = "pxn"`. `HookCaller` is the first stack frame outside
`sh.siava.pixelxpert.xposed.utils.reflection`, so the id names the mod pack line
that asked for the hook, not the DSL plumbing.

`HookHelper.idFor` appends the concrete signature when a name or constructor
group is expanded:

```kotlin
private fun idFor(id: String?, target: Executable): String? =
	if (id == null) null else "$id->${HookId.signature(target)}"
```

`HookId.signature` renders constructors as `<init>(...)` and static methods as
`static name(...)`, which keeps overloads distinct.

The invariant: **the id must be stable across generations and unique per
executable.** A hot reload relies on it. `XposedGeneration.hook` passes
`options.id` to `api.hook(executable).setId(...)`, and the KDoc states the
consequence:

> The id is what makes a hot reload work: the next generation registers the
> same id and the framework swaps the hooker atomically instead of stacking a
> second hook on the executable.

Because the id contains a line number, **editing a pack without changing its
hooks still changes the id** — moving a hook call to a different line produces a
different id, so on hot reload the framework sees a new hook and the old one is
unhooked through `HotReloadedParam.oldHookHandles` instead of being replaced. That
is correct but not free: the hook is briefly absent during the swap.

Only one pack overrides the id: `CursorControlKeys` uses `.id("pxn-cursor-ime-status")`.

### Priority and exception mode

`XposedGeneration.HookOptions`:

```kotlin
data class HookOptions(
	val id: String?,
	val priority: Int = XposedInterface.PRIORITY_DEFAULT,
	val exceptionMode: ExceptionMode = ExceptionMode.DEFAULT,
	val configure: ((HookBuilder) -> Unit)? = null,
)
```

Builders expose `.id(String?)`, `.priority(Int)`, `.exceptionMode(ExceptionMode)`
and `.configure { builder -> }`. `defaultOptions` fills only the id; priority and
exception mode are always the API defaults unless a pack overrides them.

No pack in `xposed/modpacks/` currently calls `.priority(...)` or
`.exceptionMode(...)` — the only override in the tree is the one `.id(...)` above.
The `configure` hook exists for options the DSL does not model.

### The interceptor, and the retired-generation guard

`app/src/main/java/sh/siava/pixelxpert/xposed/utils/reflection/HookHelper.kt`

```kotlin
fun hookMethod(...): HookHandle = XposedRuntime.hook(xposedInterface, hookMethod, options) { chain ->
	if (!XposedRuntime.isActive()) return@hook chain.proceed()

	val param = RunParam(chain.thisObject, chain.executable, chain.args.toTypedArray())

	if (runBefore) {
		callback.run(param)
		if (param.isResultSet) param.result else chain.proceed(param.args)
	} else {
		param.result = chain.proceed(param.args)
		callback.run(param)
		param.result
	}
}
```

Three invariants live in those eight lines:

1. **A retired generation only passes through.** The framework keeps old hooks
   installed until the successor replaces or unhooks them, so without the guard
   old pack code would keep running in the gap. This is the single most important
   line in the hook engine.
2. **A "before" consumer that sets a result declines to proceed.** `setResult`
   sets `isResultSet`, and the return expression then yields `param.result`
   instead of calling `chain.proceed`. `CaffeineTile` uses this to swallow
   `handleClick` so SystemUI never invokes the `TileService` over IPC.
3. **`param.args` is the array handed back to `proceed`.** Mutating it in place
   rewrites the argument. `ScreenshotManager` does `param.args[0] = 0` on
   `UserManager.getUserInfo` to force user 0.

For an "after" hook, `proceed` runs first and the consumer sees the result. It
may replace it by assigning `param.result` — that is why the expression returns
`param.result` after the callback.

`RunParam` exposes `setResult`, `getResult<T>()`, `getThisObject<T>()`,
`getArg<T>(index)`, plus the public fields `thisObject`, `method`, `args`.

### Reaching the original

Two paths, and they are not interchangeable:

| Call | Behaviour |
| --- | --- |
| `XposedRuntime.invokeOriginal(method, thisObject, *args)` | Bypasses the whole hook chain |
| `ReflectedMethod.invokeOriginal(obj, *args)` | Same, via the wrapper |
| `ReflectedMethod.invoke(obj, *args)` | Reflective call that goes *through* any hooks |
| `Reflection.invokeOriginalMethod(method, instance, args)` | Legacy-shaped alias of `invokeOriginal` |

```kotlin
fun invokeOriginal(method: Method, thisObject: Any?, vararg args: Any?): Any? {
	val invoker = requireApi().getInvoker(method).setType(Invoker.Type.ORIGIN)
	return try {
		invoker.invoke(thisObject, *args)
	} catch (t: InvocationTargetException) {
		throw t.targetException ?: t
	}
}
```

`Invoker.Type.ORIGIN` is the API 102 way to say "the real method". The
`InvocationTargetException` unwrap means callers see the exception the hooked
method actually threw, not the reflection wrapper. Without it, every
`catch (e: SomeFrameworkException)` in a hook body would miss.

The `ReflectedMethod` KDoc records why the distinction exists: "a 'before'
callback that wants to delegate has to reach the real method, not re-enter the
hook chain." `SystemUtils.setFlashLevel` relies on this — it hooks
`turnOnTorchWithStrengthLevel` and must call the original or it would recurse.

`SystemUtils` sets a `isInternalTorchCall` flag around such calls so its own
hooks can tell an internal call from a user one.

### `Reflection` — the legacy helper replacement

`app/src/main/java/sh/siava/pixelxpert/xposed/utils/reflection/Reflection.kt`
replaces `de.robv.android.xposed.XposedHelpers` one-for-one. Call sites read the
same (`getObjectField`, `callMethod`, `findMethodExact`) but the implementation is
local, so the module never touches the legacy Xposed API that the framework
blocks.

Field access walks the superclass chain and throws typed errors:

| Situation | Exception |
| --- | --- |
| Field missing | `NoSuchFieldError("<class>#<field>")` |
| Static/instance mismatch | `NoSuchFieldError("<class>#<field> is static")` or `… is not static` |
| Instance is null | `NullPointerException("Cannot read <field> from null")` |
| Method missing (best match) | `NoSuchMethodError("<class>#<name>")` |
| Class is null | `NoSuchMethodError("null.<name>")` / `NoSuchFieldError("null#<field>")` |

`findMethodBestMatch(clazz, name, vararg args)` prefers an exact parameter-type
match, then the first assignable one, then throws. `findMethodExact` walks the
superclass chain and falls back to interface default methods.

`Reflection.findClassIfExists` returns null for both `ClassNotFoundException` and
`LinkageError`. The `LinkageError` catch matters: a class that exists but fails to
link (missing native, wrong ABI) would otherwise abort the whole pack.

### `findFirstInstance`

```kotlin
fun findFirstInstance(foundCallback: InstanceFoundCallback) {
	val unhooks = LinkedHashSet<HookHandle>()
	for (method in findMethods(Pattern.compile(".+"))) {
		unhooks += before(method).run(xposedInterface, ReflectionConsumer { param ->
			unhooks.forEach { it.unhook() }
			unhooks.clear()
			foundCallback.onInstanceCaptured(param.thisObject)
		})
	}
}
```

It hooks every declared method, then unhooks all of them on the first hit. This is
the workaround for a build where the constructor was optimised away, leaving
nothing to hook to observe construction. Note the capture-then-unhook ordering: the
callback runs after unhooking, so a callback that re-enters the class does not
re-trigger.

### Bootloop protection

`app/src/main/java/sh/siava/pixelxpert/xposed/utils/BootLoopProtector.kt`

| Constant | Value | Meaning |
| --- | --- | --- |
| `LOAD_TIME_KEY_KEY` | `"packageLastLoad_"` | prefix of the last-load timestamp key |
| `PACKAGE_STRIKE_KEY_KEY` | `"packageStrike_"` | prefix of the strike counter key |
| `COUNTER_RESET_PERIOD` | `60` | seconds; a load after this gap resets the counter |

`isBootLooped(packageName)` reads both keys, then:

- if `now - lastLoadTime > 60_000` → `resetCounter`, return false
- else if `strikeCount >= 3` → return true
- else → increment the strike with **`commit()`**, not `apply()`, return false

The `commit()` is deliberate and commented: "the next line of code reads this
back, and a bootloop that loses the write would never be caught." A bootloop is
exactly the case where the process dies before `apply()`'s async write lands.

`resetCounter` removes the strike key and writes the load timestamp, also with
`commit()`, inside a `try { } catch (ignored: Throwable) { }`.

`SystemUtils.killSelf()` and `SystemUtils.restart("systemui")` both call
`resetCounter` first, so a deliberate restart does not count as a strike.

The two prefixes appear in `Constants.PREF_UPDATE_EXCLUSIONS`, and
`XPrefs.loadEverything` drops any key starting with one of them. Without that
exclusion, relaying a strike write would re-enter `loadEverything` from inside
the protector.

### Hook auditing

Two packs observe the hook system without changing behaviour.

`HookTester` (`app/src/main/java/sh/siava/pixelxpert/xposed/modpacks/allApps/HookTester.kt`)
is `@CommonModPack`, so it loads in every scoped process. It registers a receiver
for `Constants.ACTION_CHECK_XPOSED_ENABLED` and replies with
`Constants.ACTION_XPOSED_CONFIRMED` carrying `"packageName"`, addressed with
`setPackage(BuildConfig.APPLICATION_ID)`. In system server it reports
`Constants.SYSTEM_FRAMEWORK_PACKAGE` (`"android"`) rather than the real package.
It logs `PixelXpert hook test successful for <pkg>`.

`HookAuditor` (`.../allApps/HookAuditor.kt`) is also `@CommonModPack`. It listens
for `Constants.ACTION_REQUEST_HOOK_AUDIT`, runs a single-pass inspection on a
background thread, and broadcasts `Constants.ACTION_HOOK_AUDIT_RESULT` with
`"packageName"` and `"auditJson"`. It dispatches to
`SystemUIInspector.inspect`, `FrameworkInspector.inspect` or
`LauncherInspector.inspect` depending on the target, and returns null (no reply)
for any other package.

The inspectors (`app/src/main/java/sh/siava/pixelxpert/xposed/inspector/`) are
built on `InspectionUtils`, which resolves classes through three loaders in order:
the given loader, `ReflectedClass.getFrameworkClassloader()`, then
`Thread.currentThread().contextClassLoader`. Every check records `PRESENT`,
`ABSENT` or `INLINED` and never retries — the KDoc calls this a "CRITICAL
CONSTRAINT: Exactly one attempt per target".

The `INLINED` status comes from `checkConstructor(..., checkInlined = true)` and
means `clazz.declaredConstructors.isEmpty()` — R8 removed the constructor. That is
the same condition `ReflectedClass.findFirstInstance` exists to work around.

---

## Walkthrough

Installing one hook, end to end.

1. A pack calls `ReflectedClass.of("com.android.server.wm.DisplayRotation")`.
   `of` resolves via the default loader, then the framework loader, and wraps
   whatever it found (possibly null).
2. `.before("rotationForOrientation")` constructs a `BeforeMethodData` with
   `HookId.caller()` captured now, and `defaultOptions(...)` building the base id
   `pxn:<callerClass>#<callerMethod>:<line>-><targetClass>#rotationForOrientation`.
3. `.run { param -> ... }` calls `runBefore(defaultXposedInterface, consumer, false)`.
4. `runBefore` returns `emptySet()` immediately if `clazz == null`, or if neither
   an explicit nor a default `XposedInterface` exists.
5. Otherwise it calls `HookHelper.hookAllMethods(target, name, consumer, true, iface, options)`.
6. `hookAllMethods` filters `clazz.declaredMethods` by name and, for each,
   calls `hookMethod` with `options.copy(id = idFor(options.id, method))` — so each
   overload gets `…-><signature>` appended.
7. `hookMethod` calls `XposedRuntime.hook(iface, executable, options, interceptor)`.
8. `XposedRuntime.hook` compares `current.api === api`; when it matches it delegates
   to `XposedGeneration.hook`, which is what records the handle for cleanup.
9. `XposedGeneration.hook` builds `api.hook(executable).setPriority(...).setExceptionMode(...).setId(...)`,
   applies `options.configure`, calls `.intercept(hooker)`, appends the handle to
   `hooks`, and returns it.
10. At call time the interceptor runs: retired check, build `RunParam`, run the
    consumer, then either return `param.result` or `chain.proceed(param.args)`.

---

## Contracts

- **Never install a hook outside `ReflectedClass` / `HookHelper` /
  `XposedRuntime.hook`.** A direct `api.hook(...)` loses generation tracking, so
  `retire()` cannot reach it and a hot reload leaves it running old code.
- **A hook body must not throw into the framework.** Most packs wrap their bodies
  in `try { } catch (ignored: Throwable) { }`. `ScreenRotation` and `CallVibrator`
  both do. A throw propagates into the hooked method unless `ExceptionMode` says
  otherwise.
- **A hook body must not block.** Hook bodies run on whatever thread calls the
  hooked method, which for `PhoneWindowManager.init` or `QSTileImpl.handleClick`
  is a framework thread.
- **`param.setResult(...)` in a `before` hook skips the original.** Use it
  deliberately; use `invokeOriginal` when you mean to delegate.
- **Hook ids must be unique per executable.** Two packs hooking the same method
  with a caller-derived id are fine — the caller differs. Two hooks from the same
  line are not.
- **Do not rely on `ReflectedClass.of` throwing for a missing class.** It does
  not. Branch on `.clazz` if the behaviour must differ.
- **`dumpStructure()` is a diagnostic, not a guard.** It logs
  `ReflectedClass.dumpStructure: class not resolved` and returns on a null class.

---

## Failure modes

| Symptom | Cause in code | Fix |
| --- | --- | --- |
| A hook never fires, no error anywhere | The class did not resolve, so `runBefore` returned `emptySet()` | Call `ReflectedClass.of(...).dumpStructure()` or run the hook audit for that package |
| `NoSuchFieldError: <class>#<field>` at hook time | Field renamed or removed in this Android build | Add a build-guarded fallback, or wrap in `try` as the existing packs do |
| `NoSuchMethodError: <class>#<name>` | Method renamed, or no overload accepts the arguments passed | Use `findMethodExact` with explicit parameter types, or `ofIfPossible` |
| `NullPointerException: Cannot read <field> from null` | `Reflection.getObjectField(null, ...)` — a captured framework object was never assigned | Guard the field, as `GestureNavbarManager` does with `val handler = EdgeBackGestureHandler ?: return@run` |
| Hook fires with the old generation's code after a reload | The hook was installed outside `XposedRuntime.hook`, or the id changed so the framework stacked a second hook | Re-register the same id; check `HotReloadedParam.oldHookHandles` handling in [hot-reload](hot-reload.md) |
| `PixelXpert: Possible bootloop in <pkg>. Will not load for now` | 3 strikes in 60 s | Clear `packageStrike_<pkg>` and `packageLastLoad_<pkg>` in the preference file |
| Strike counter never reaches 3 | The counter was written with `apply()` somewhere instead of `commit()` | Only `BootLoopProtector` writes it, and it uses `commit()`; do not add another writer |
| Hook audit reports `INLINED` for a constructor | R8 removed it: `declaredConstructors.isEmpty()` | Use `findFirstInstance` instead of `beforeConstruction` |
| Audit JSON never arrives at the app | `HookAuditor` returned null for an unsupported package, or Gson threw and logged `HookAuditor failed to serialize audit for <pkg>: <msg>` | Only SystemUI, `android` and launcher are supported |
| `IllegalStateException: Xposed API is not attached in this process` | `invokeOriginal` called before any generation attached | Guard with `XposedRuntime.generation != null` |

---

## Checklist

Before adding a hook:

- [ ] The class is resolved through `of` / `ofIfPossible`, not `Class.forName`
- [ ] A missing class is handled by the DSL's empty-set behaviour, or by an
      explicit `.clazz` branch — not by a `null` check on the hook handle
- [ ] The hook body is wrapped so a framework change cannot throw into the host
- [ ] The hook body does not block, sleep, or do I/O on the calling thread
- [ ] `param.setResult(...)` is used only where skipping the original is intended
- [ ] `invokeOriginal` is used, not `invoke`, when the intent is to bypass hooks
- [ ] If the same method is hooked twice from one callsite, an explicit `.id(...)`
      distinguishes them
- [ ] Any framework object captured by the hook is null-guarded before use
- [ ] The pack still compiles against `minSdk = 37`

---

## See also

- [Architecture overview](overview.md)
- [Xposed runtime](xposed-runtime.md)
- [Mod pack lifecycle](modpack-lifecycle.md)
- [Hot reload](hot-reload.md)
- [Repository map](../agent/REPO_MAP.md)
