# Architecture Overview

The mental model for the whole system: what runs where, what talks to what, and
which invariant each piece exists to protect. Read this before any subsystem
document.

**Audience:** any agent or contributor on first contact
**Prereqs:** [repository map](../agent/REPO_MAP.md)

---

## Summary

- PixelXpert is one APK that plays two roles: a normal Android app, and a
  code-injection module loaded by libxposed into other processes.
- The **app process** owns the UI, the preferences store, root access, and
  updates. The **hooked processes** (SystemUI, system server, launcher,
  settings, dialer, telecom) own the actual feature implementations.
- The two worlds communicate through **RemotePreferences** (a content provider
  backed by the app's `SharedPreferences`) and a small set of **broadcasts**.
- Features are implemented as **mod packs**: classes annotated with a target
  annotation, discovered at build time by a KSP processor, instantiated at
  runtime by `XPLauncher` in whichever process matches.
- Hooking goes through one bridge, `XposedRuntime`, and every loaded copy of the
  module owns an `XposedGeneration` that can be retired atomically for hot
  reload.
- The Magisk module is packaging, not code: it wraps the same APK.

---

## Model

### Two processes, one codebase

```text
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│ App process                 │        │ Hooked processes                 │
│ sh.siava.pixelxpert         │        │ com.android.systemui             │
│                             │        │ android (system_server)          │
│  MainActivity / Compose UI  │        │ com.google.android.apps.          │
│  PrefStore ─────────────┐   │        │   nexuslauncher                  │
│  RemotePrefProvider ◄───┘   │        │ com.android.settings             │
│  RootProvider (libsu)       │        │ com.google.android.dialer        │
│  UpdateWorker               │        │ com.android.server.telecom       │
│                             │        │                                  │
│                             │        │  XPLauncher                      │
│                             │◄───────┤  XposedRuntime / Generation      │
│                             │ Remote │  XPrefs                          │
│                             │  Prefs │  ModPacks[]                      │
│                             │◄───────┤  ReflectedClass hooks            │
│                             │ binder │                                  │
└─────────────────────────────┘        └──────────────────────────────────┘
```

The app process is the only one that can show UI or hold root. The hooked
processes are the only ones that can change system behaviour. Neither can do the
other's job, which is why the preference store is the seam.

### The preference seam

A user toggles a switch in the Compose UI. That writes through `PrefStore` into
the app's `SharedPreferences`. The Xposed side reads the same data through
`XPrefs`, which wraps a `RemotePreferences` client pointed at the app's
`RemotePrefProvider`.

Nothing pushes. The hooked process learns about a change because the app sends a
broadcast, and `XPrefs` forwards it to every loaded pack's
`onPreferenceUpdated`.

Consequence for an agent: **a preference key is a contract between two
processes.** Renaming it on one side produces no compile error and no crash. The
feature simply stops responding. This is the single most common way a change in
this repo silently fails.

### The mod pack abstraction

```kotlin
abstract class XposedModPack(context: Context) : Logger() {
    abstract fun onPreferenceUpdated(vararg key: String?)
    abstract fun onPackageLoaded(PRParam: XposedModuleInterface.PackageReadyParam)
    open fun onUnloaded() {}
    protected open fun onSaveHotReloadState(outState: MutableMap<String, Any?>) {}
    protected open fun onRestoreHotReloadState(savedState: Map<String, Any?>) {}
}
```

A pack receives the hooked process's `Context`, one free `onPreferenceUpdated()`
before anything is hooked so it can seed state without null checks, then
`onPackageLoaded` to install hooks. `onUnloaded` is where long-lived resources
are released; hooks are handled by the framework.

### Hook ownership

Every hook is registered through `XposedRuntime` and tracked by the current
`XposedGeneration`. A generation owns:

- hook handles
- tracked threads (interrupted on retire)
- cleanup actions (run in reverse order on retire)
- `installOnce` keys (so a step cannot run twice per generation)

A hot reload never mutates a generation. The old one is retired and a new one
takes over, re-registering the same hook ids so the framework swaps hookers
atomically instead of stacking a second hook.

---

## Walkthrough

### Cold boot of a hooked process

1. libxposed loads the module and calls `XPLauncher.onModuleLoaded`. The process
   name and `isSystemServer` flag are recorded, and a fresh `XposedGeneration` is
   attached via `XposedRuntime.attach`.
2. For system server, `onSystemServerStarting` publishes the framework class
   loader so `ReflectedClass` can resolve `com.android.server.*` later.
3. `onPackageReady` records the package snapshot and installs two context hooks:
   - system server gets its `Context` from `PhoneWindowManager.init`
   - every other package gets it from `Instrumentation.newApplication`
4. The context hook fires. `XPLauncher.initializeWithContext` stores the context,
   derives the module's `Resources`, initialises `XPrefs`, and then waits for the
   preferences provider to become readable.
5. `waitForXprefsLoad` probes a nonexistent key in a loop. What is being tested is
   whether the read throws at all — it does until the app's provider is
   reachable.
6. `onXPrefsReady` checks the bootloop protector, then walks the generated
   `ModPacks` table and constructs every pack whose target matches this process.
7. Each pack gets `onPreferenceUpdated()` then `onPackageLoaded(param)`, and is
   added to `XPLauncher.runningMods`.

### A preference change reaching a hook

1. The user changes a setting in the Compose UI.
2. `PrefStore` writes it to `SharedPreferences`.
3. The app broadcasts the change.
4. `XPrefs` receives it and calls `onPreferenceUpdated(key)` on every running
   pack.
5. The pack re-reads the key and reconfigures itself.

### Feature code path

```text
docs/reference/modpack-catalog.md   <- which pack owns which feature
  -> xposed/modpacks/<target>/<Pack>.kt
     -> annotation decides target package
        -> KSP emits ModPacks.kt
           -> XPLauncher.loadModPacks matches on target + process name
              -> pack hooks via ReflectedClass
```

---

## Contracts

These are the invariants an agent must not break. Each one has a subsystem doc
explaining why.

| Contract | Consequence of breaking it |
| --- | --- |
| Preference keys are identical in app and Xposed code | Feature silently stops responding |
| A pack must carry a target annotation for every process it should run in | KSP emits nothing for the missing targets; the pack silently does not run there |
| Pack construction may happen on the main thread | `GestureDetector`/`Handler` construction fails or misbehaves |
| `onUnloaded` must release threads, sockets, receivers | Leaks survive hot reload and stack up |
| Hot reload state may hold framework objects only | Holding module objects keeps the retired generation alive |
| Hooks go through `XposedRuntime`, never a second engine | Generation tracking is lost; retire leaves hooks running |
| Never block system server's main thread on the provider | Boot hang |
| Broadcast constants are derived from `APPLICATION_ID` | Cross-version hook/app mismatch |

---

## Failure modes

| Symptom | Likely cause | Where to look |
| --- | --- | --- |
| Feature exists in UI, does nothing | Preference key mismatch between app and pack | [preferences-system](../architecture/preferences-system.md) |
| Pack never runs at all | Wrong or missing target annotation; not in generated registry | `app/build/generated/ksp/…/ModPacks.kt` |
| Pack runs in the wrong process | Annotation targets a different package than expected | [modpack-lifecycle](modpack-lifecycle.md) |
| Nothing loads in any process | Preferences provider unreachable; wait loop never exits | [xposed-runtime](xposed-runtime.md) |
| Package skipped after repeated bootloops | Bootloop protector tripped | [reflection-and-hooks](reflection-and-hooks.md) |
| Hooks fire with old code after reload | Old generation not retired, or ids not re-registered | [hot-reload](hot-reload.md) |
| App and module disagree on version | Mismatched install | [preferences-and-ipc](preferences-and-ipc.md) |

---

## Checklist

Before making a change, confirm:

- [ ] You know whether the code runs in the app process or a hooked process
- [ ] If it crosses the boundary, you have updated both sides of the preference
      or broadcast contract
- [ ] If it is a new pack, it carries a target annotation for every process it
      should run in, and appears in the generated registry after a build
- [ ] If it acquires a resource, you have a release path in `onUnloaded`
- [ ] If it holds state across hot reload, that state is classloader-neutral

---

## See also

- [Repository map](../agent/REPO_MAP.md)
- [Xposed runtime](xposed-runtime.md)
- [Mod pack lifecycle](modpack-lifecycle.md)
- [Preferences system](preferences-system.md)
- [Hot reload](hot-reload.md)
