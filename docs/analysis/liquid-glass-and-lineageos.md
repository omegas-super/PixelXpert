# Liquid Glass on LineageOS 24 (Android 17)

What it takes to bring iOS-style glass effects to a LineageOS 24.0 device using
PixelXpert, whether `AndroidLiquidGlassView` is the right substrate, and which
surfaces can actually carry the effect. Read this before proposing a glass
feature or adding the library.

**Audience:** agent or contributor planning a visual-effects port
**Prereqs:** [overview](../architecture/overview.md), [modpack-lifecycle](../architecture/modpack-lifecycle.md), [reflection-and-hooks](../architecture/reflection-and-hooks.md)

**Status:** point-in-time research, dated 2026-11-01. External facts are cited;
anything marked **uncertain** was not verifiable from source. Re-verify before
building.

---

## Summary

- LineageOS **24.0 is Android 17**, announced 2026-10-11 in Changelog 32. It is
  the first LineageOS branch built on Android 17 (released June 2026).
- `AndroidLiquidGlassView` is MIT-licensed, Java, `ViewGroup`-based, published as
  `com.qmdeve.liquidglass:core:1.1.0`. It renders with an **AGSL `RuntimeShader`**
  plus a `RenderNode`, gated at `Build.VERSION_CODES.TIRAMISU` (API 33).
- PixelXpert's `minSdk = 37` means every installable device already exceeds that
  gate. The API-33 fallback is dead code for this module.
- The library is a **View** component. It samples by calling `target.draw()` into
  a `RenderNode` on every pre-draw. It works on legacy View surfaces and is
  unproven on Compose surfaces.
- **The blocking problem is not graphics, it is packaging.** PixelXpert is scoped
  to Pixel packages. On LineageOS without GApps, the Launcher and Dialer packs
  cannot load at all, and SystemUI is AOSP rather than Pixel.
- The effect is a *refraction of what is behind it*. A surface with no View
  ancestor to sample produces nothing visible.

---

## Model

### What LineageOS 24.0 is

| Fact | Value | Source |
| --- | --- | --- |
| Branch | `lineage-24.0` | LineageOS Changelog 32 |
| Android base | Android 17 | Changelog 32 |
| Android 17 upstream release | June 2026 | Changelog 32 |
| LineageOS 24.0 announcement | 2026-10-11 | Changelog 32 |
| Security patches merged | August 2025 – October 2026, to 18.1–24.0 | Changelog 32 |
| Kernel policy | 23.2/24.0 ship only kernels with 1:1 eBPF backports | Changelog 32 |

LineageOS 24.0 shipped with a broad Pixel roster: Pixel 4 through Pixel 9 moved
from 23.2, and Pixel 10 / 10 Pro / 10 Pro XL / 10 Pro Fold / 10a were added new.
Check the device list before assuming a specific device is supported
([wiki.lineageos.org/devices](https://wiki.lineageos.org/devices/)).

LineageOS's own app suite moved to Material Design 3 Expressive in this cycle.
That matters because it means the *platform* surfaces (Settings, Updater,
SetupWizard) are now M3 Expressive, and a glass treatment layered on top of an
expressive surface is a visual conflict, not a complement.

### What `AndroidLiquidGlassView` actually is

Verified from source at `master` (repo metadata: 341 stars, 41 forks, MIT, Java,
last push 2026-10-25).

| Property | Value |
| --- | --- |
| Coordinates | `com.qmdeve.liquidglass:core:1.1.0` |
| License | MIT, Copyright 2025-2026 Donny Yang |
| Language | Java |
| `compileSdk` | 37 |
| `minSdk` | 24 |
| Java source/target | 21 |
| Dependencies | `androidx.annotation`, `androidx.dynamicanimation` |
| Public entry point | `com.qmdeve.liquidglass.widget.LiquidGlassView` |

Public API, from the library's own component guide:

| Method | Effect | Default |
| --- | --- | --- |
| `bind(ViewGroup source)` | sets the sampling source | none |
| `setCornerRadius(float px)` | corner radius, clamped to 0..height/2 | 40dp |
| `setRefractionHeight(float px)` | edge refraction band, clamped 12dp..50dp | 20dp |
| `setRefractionOffset(float px)` | refraction strength, clamped 20dp..120dp, negated | 70dp |
| `setDispersion(float)` | chromatic dispersion, clamped 0..1 | 0.5 |
| `setBlurRadius(float)` | blur sigma, clamped 0.01..50 | 0.01 |
| `setTintColorRed/Green/Blue(float)` | tint colour, 0..1 | 1.0 |
| `setTintAlpha(float)` | tint strength, 0..1 | 0.0 |
| `setDraggableEnabled(boolean)` | drag-to-move | false |
| `setElasticEnabled(boolean)` | springy drag | false |
| `setTouchEffectEnabled(boolean)` | press glow + 1.02x scale | false |

### The rendering pipeline

This is the part that decides whether a port is viable, so it is worth stating
precisely. Three classes cooperate.

`LiquidGlassView extends ViewGroup` is the host. It is a `ViewGroup` only so it
can hold one child, the internal `LiquidGlass`. It sets
`LAYER_TYPE_HARDWARE` in every constructor.

`LiquidGlass extends FrameLayout` is that child. It owns the
`OnPreDrawListener`, and it is registered on the **target's** `ViewTreeObserver`,
not its own:

```java
public void init(ViewGroup target) {
	if (this.target != null) removePreDrawListener();
	this.target = target;
	if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
		impl = new LiquidGlassimpl(this, target, config);
		addPreDrawListener();
		requestLayout();
		invalidate();
	} else {
		removePreDrawListener();
	}
}
```

`LiquidGlassimpl` does the work. It is annotated
`@RequiresApi(api = Build.VERSION_CODES.TIRAMISU)` and holds a `RenderNode` and a
`RuntimeShader` loaded from `R.raw.liquidglass_effect` (an `.agsl` file):

```java
this.node = new RenderNode("AndroidLiquidGlassView");
this.liquidShader = loadAgsl(target.getResources(), R.raw.liquidglass_effect);
```

On every pre-draw it re-records the whole target subtree:

```java
private void record() {
	int w = target.getWidth(), h = target.getHeight();
	if (w == 0 || h == 0) return;
	Canvas rec = node.beginRecording(w, h);
	target.getLocationInWindow(tp);
	host.getLocationInWindow(hp);
	rec.translate(-(hp[0] - tp[0]), -(hp[1] - tp[1]));
	target.draw(rec);
	node.endRecording();
}
```

and then chains the effects onto the node:

```java
RenderEffect shaderEffect = RenderEffect.createRuntimeShaderEffect(liquidShader, "content");
RenderEffect finalEffect = (contentEffect != null)
		? RenderEffect.createChainEffect(shaderEffect, contentEffect)
		: shaderEffect;
node.setRenderEffect(finalEffect);
```

`draw()` refuses to paint on a software canvas:

```java
public void draw(Canvas canvas) {
	if (!canvas.isHardwareAccelerated()) return;
	canvas.drawRenderNode(node);
}
```

The shader itself (`liquidglass_effect.agsl`) computes a signed-distance rounded
rectangle, applies a `circleMap` refraction only inside the
`refractionHeight` band at the edge, and does a **seven-tap spectral sample**
(red, orange, yellow, green, cyan, blue, purple) offset by
`chromaticAberration`, then tints. It takes `content` as a `shader` uniform, so
the recorded node is the shader's input.

Three consequences follow directly, and they govern every design decision below:

1. **The effect is a refraction of the sampling source.** No source, no effect.
   The view stays transparent.
2. **Cost scales with the sampled subtree.** `target.draw(rec)` re-records the
   entire target view tree every pre-draw. The library was designed for a 200dp
   demo widget over a static `ImageView`.
3. **Both views must be in the same window.** `getLocationInWindow` on host and
   target is how the offset is computed; different windows give a wrong offset.

### Why the API-33 gate does not apply here

The library's `minSdk` is 24 but its *effect* requires API 33. Below that,
`impl` stays null, `onDraw` draws nothing, and the view is transparent — the
README states this explicitly.

PixelXpert declares `minSdk = 37` in `app/build.gradle.kts`. There is no
PixelXpert-installable device below API 33, so the entire fallback branch is
unreachable for this module. Do not write a version check for it.

Note the mismatch that would bite a maintainer reading only the README: the
Gradle `minSdk` (24) and the *effective* API floor (33) are different numbers.
Trust the `TIRAMISU` check in `LiquidGlass.init`, not the Gradle value.

### The blocking problem: PixelXpert is scoped to Pixel packages

This is the finding that matters more than any graphics question.

`app/src/main/java/sh/siava/pixelxpert/Constants.kt` hardcodes:

| Constant | Value |
| --- | --- |
| `SYSTEM_UI_PACKAGE` | `com.android.systemui` |
| `SYSTEM_FRAMEWORK_PACKAGE` | `android` |
| `LAUNCHER_PACKAGE` | `com.google.android.apps.nexuslauncher` |
| `SETTINGS_PACKAGE` | `com.android.settings` |
| `DIALER_PACKAGE` | `com.google.android.dialer` |
| `TELECOM_SERVER_PACKAGE` | `com.android.server.telecom` |

and `app/src/main/res/values/xp_module_scope.xml` scopes the module to exactly
those five packages.

On a LineageOS 24.0 device:

| Package | Present on LineageOS 24.0? | Consequence |
| --- | --- | --- |
| `com.android.systemui` | Yes, but it is **AOSP** SystemUI, not Pixel SystemUI | Hooks that name Pixel-only classes silently no-op |
| `android` (system server) | Yes | Framework packs are the most portable |
| `com.android.settings` | Yes, but AOSP Settings internals | Settings packs may or may not resolve |
| `com.android.server.telecom` | Yes | Telecom packs are plausible |
| `com.google.android.apps.nexuslauncher` | **Only with a Google apps package** | 7 launcher packs cannot load without GApps |
| `com.google.android.dialer` | **Only with a Google apps package** | 1 dialer pack cannot load without GApps |

LineageOS ships Trebuchet, not Pixel Launcher, as the default launcher. A pack
annotated `@LauncherModPack` is registered for
`com.google.android.apps.nexuslauncher`; on a device without that package the
process never starts, so the pack is never constructed and produces no log line
at all. This is the `loadModPacks` target match doing exactly what it is
supposed to do — see [modpack-lifecycle](../architecture/modpack-lifecycle.md).

The SystemUI case is subtler and more damaging. The package name matches, so the
pack loads and logs its `Start Error Dump` or nothing at all, but the classes it
hooks may not exist. `SystemUIInspector` already encodes this divergence: it
checks `HomeStatusBarIconBlockListBinder` to decide whether the device is on the
**legacy View** status bar or the **Compose** path, and marks one set of targets
`utilized = false` accordingly.

**Uncertain:** whether AOSP SystemUI on LineageOS 24.0 exposes the same
`com.android.systemui.*` class names that the Pixel-targeted packs expect. This
cannot be resolved without a device or a LineageOS build tree, and no build is
possible on this machine (no JDK, no SDK). The hook-audit path exists for exactly
this question — run it on a real device before planning any port.

### Which surfaces can carry the effect

Feasibility is a function of two things: whether the surface is a legacy View
hierarchy the library can sample, and whether there is anything behind it worth
refracting.

| Surface | Host process | View or Compose | Feasibility |
| --- | --- | --- | --- |
| QS panel background | SystemUI | Mixed, moving to Compose | Medium — high frame cost |
| Notification shade card background | SystemUI | Legacy View | Medium |
| Power menu container | SystemUI | Legacy View | Medium |
| Keyguard clock / lock screen layers | SystemUI | Legacy View | Medium |
| Status bar | SystemUI | Mostly Compose on 17 | Low — see below |
| Quick Settings tiles | SystemUI | Compose | Low |
| Volume dialog | SystemUI | Legacy View | Medium |
| Settings app cards | Settings | Compose | Low |
| Launcher dock / search bar | Launcher | Varies | Blocked without GApps |

Two hard constraints narrow this further:

- **A Compose surface needs a `ViewGroup` ancestor to bind to.**
  `AndroidComposeView` does extend `ViewGroup`, so `bind()` type-checks. Whether
  `target.draw(rec)` faithfully records Compose content into a `RenderNode` is
  **uncertain** and must be tested on device. Do not design around it.
- **Never bind the view's own parent.** If the glass view is a child of the
  container it samples, the recording includes the glass, and the shader feeds
  its own output back in. Bind a sibling or an ancestor that excludes the host.

The safest first target is a **static, bounded, legacy-View surface** — the
volume dialog or the power menu — where the sampled subtree is small and does not
animate every frame. The status bar is the worst first choice.

---

## Walkthrough

A minimal, reversible port. Each step is independently verifiable.

### 1. Add the dependency

```kotlin
// app/build.gradle.kts
dependencies {
	implementation("com.qmdeve.liquidglass:core:1.1.0")
}
```

The library is on Maven Central, which `settings.gradle.kts` already pins. The
`implementation` scope is correct: nothing in PixelXpert's public API references
it, and `api` would leak it to consumers.

Because the module APK is injected wholesale into the host process, the library
classes travel with it and are instantiated against the **host's** `Context`
(`mContext` inside a pack), not the module app's. That is what makes a View
library usable from an Xposed module at all.

### 2. Choose the pack and the annotation

Pick the target process first. A SystemUI surface means
`@SystemUIModPack`; a system-server surface means `@FrameworkModPack`. A surface
that exists in both — which is rare for a View effect — would carry both, which
is legal and is how `IconPacks` serves two processes from one class.

Create the pack under `app/src/main/java/sh/siava/pixelxpert/xposed/modpacks/systemui/`
and follow the shape in [modpack-lifecycle](../architecture/modpack-lifecycle.md): one
`Context` constructor parameter, `onPreferenceUpdated` reading keys
unconditionally, `onPackageLoaded` installing hooks, `onUnloaded` releasing.

### 3. Capture the host container

The glass view has to be added to a live `ViewGroup` in the host process. The
existing pattern is a hook on a framework method that exposes the container, then
`addView` on it. `DepthWallpaper` is the closest precedent: it hooks
`addViews`, builds `FrameLayout` layers with `FrameLayout.LayoutParams(-1, -1)`,
and calls `reAddView(rootView.rootView as ViewGroup, mWallpaperBackground, 0)`.

Do the same, but keep the glass view **out** of the subtree you bind:

```kotlin
// Illustrative shape only — the hook target differs per surface.
val glass = LiquidGlassView(mContext)
glass.bind(sampledContainer)        // a ViewGroup that does NOT contain `glass`
hostContainer.addView(glass, FrameLayout.LayoutParams(-1, -1))
```

### 4. Expose the parameters as preferences

Every `set*` method maps to a preference key, read in `onPreferenceUpdated`.
`setRefractionOffset` and `setCornerRadius` clamp internally, so a slider can pass
raw values. Follow the two-sided contract in
[preferences-and-ipc](../architecture/preferences-and-ipc.md): the same literal in `ui/` and
`xposed/`, and slider keys read through `Xprefs.getSliderFloat` /
`getSliderInt`, never `getFloat` / `getInt`.

### 5. Release it in `onUnloaded`

`LiquidGlassView` registers a pre-draw listener on the **target's** observer and
a `RenderNode`. Its own `onDetachedFromWindow` calls `removeGlass()`, which
detaches the internal `LiquidGlass` and nulls it. That is only reached if the
view is actually removed from its parent. So `onUnloaded` must do the removal:

```kotlin
override fun onUnloaded() {
	runCatching { (glass?.parent as? ViewGroup)?.removeView(glass) }
	glass = null
}
```

If you keep a reference in `onSaveHotReloadState`, store the `View` (framework
object, classloader-neutral), not a wrapper of your own.

### 6. Verify on device

There is no build possible in this checkout — no JDK, no Android SDK, no Gradle
cache. Every step above is written but **uncompiled**. State that in any report.

On a device, the fastest signal is the `HookAuditor` / `HookTester` pair: confirm
the pack's process reports, then confirm the class it hooks exists. A pack that
never logs means the target package is absent (the LineageOS case) or the class
did not resolve.

---

## Contracts

- **The library needs a hardware-accelerated canvas.** `LiquidGlassimpl.draw`
  returns immediately on a software canvas. Any surface rendered into a software
  layer produces no effect.
- **Host and sampling source must share a window.** The offset is computed from
  `getLocationInWindow` on both.
- **The sampling source must not contain the glass view.** Otherwise the shader
  samples its own output.
- **Do not add a `Build.VERSION.SDK_INT >= 33` check.** `minSdk = 37` makes it
  dead code, and `minSdk` in this module is the real floor.
- **`bind()` must be re-called if the container is replaced.** `LiquidGlass.init`
  removes the old listener only when `target` is reassigned through `init`; a
  recycled container leaves a listener on a dead observer.
- **Keep `R.raw.liquidglass_effect` alive through minification.** If a release
  build enables shrinking, the `.agsl` resource must be retained or
  `loadAgsl` throws `RuntimeException("Error loading shader: ...")`.
- **Treat every surface as AOSP-vs-Pixel divergent.** A class that resolves on
  Pixel firmware may not exist on LineageOS SystemUI. Resolve through
  `ReflectedClass.ofIfPossible` and branch on `.clazz`, never assume.
- **Do not claim a LineageOS launcher or dialer port without a GApps decision.**
  The scoped package names are Google's.

---

## Failure modes

| Symptom | Cause in source | Fix |
| --- | --- | --- |
| Glass view is invisible, no crash | `LiquidGlass.init` took the `else` branch, or `impl` is null | Check the API level; on `minSdk = 37` this should be impossible — look for a custom `minSdk` override |
| Glass view transparent on a real device | `draw()` bailed on `!canvas.isHardwareAccelerated()` | The host view is in a software layer; set `LAYER_TYPE_HARDWARE` on an ancestor |
| Effect appears offset by a constant amount | `getLocationInWindow` returned different origins for host and target | Both must be attached to the same window; do not bind across windows |
| Glass shows a recursive smeared copy of itself | The bound `ViewGroup` contains the glass view | Bind a sibling or an ancestor that excludes the host |
| Frame rate collapses when the surface animates | `record()` re-records the whole target subtree every pre-draw | Bind a smaller subtree; avoid the status bar and QS panel as first targets |
| `RuntimeException: Error loading shader: <id>` | `R.raw.liquidglass_effect` was stripped or renamed by shrinking | Keep the raw resource; check `minifyEnabled` in the release build type |
| Pack never runs on LineageOS, no log at all | Target package absent: launcher or dialer without GApps | Confirm the package is installed, or re-scope the annotation |
| Pack runs but hooks nothing on LineageOS SystemUI | Pixel-only class name; `ReflectedClass.of` returned null and the builder short-circuited to an empty set | Run the hook audit; use `ofIfPossible` and branch on `.clazz` |
| Glass renders but shows the wrong background | Bound a container that is not visually behind the glass | Bind the container that actually paints the background |
| Effect disappears after a hot reload | The view was not saved, or `onUnloaded` removed it and nothing re-added it | Save the `View` in `onSaveHotReloadState`, or re-add on reload |

---

## Checklist

Before proposing a glass feature:

- [ ] The target package exists on LineageOS 24.0 without GApps, or GApps is a
      stated prerequisite
- [ ] The surface is a legacy View hierarchy, not Compose — or the Compose case
      is explicitly marked unproven
- [ ] The sampling source is a `ViewGroup` that does not contain the glass view
- [ ] The sampled subtree is small enough to re-record every frame
- [ ] Both views are in the same window
- [ ] `onUnloaded` removes the view from its parent
- [ ] Hot-reload state stores the `View`, not a module wrapper
- [ ] Every `set*` parameter has a preference key on both sides of the process
      boundary
- [ ] The `.agsl` raw resource survives the release build
- [ ] The report says "written but not compiled — no JDK/SDK on this machine"
- [ ] The hook audit has been run on a real LineageOS device before any claim
      that a hook resolves

---

## See also

- [Architecture overview](../architecture/overview.md)
- [Mod pack lifecycle](../architecture/modpack-lifecycle.md)
- [Reflection and hooks](../architecture/reflection-and-hooks.md)
- [Preferences and IPC](../architecture/preferences-and-ipc.md)
- [Risk register](risk-register.md)

---

## Sources

- [`QmDeve/AndroidLiquidGlassView`](https://github.com/QmDeve/AndroidLiquidGlassView) — repository, MIT licence, API surface
- [Component guide](https://github.com/QmDeve/AndroidLiquidGlassView/blob/master/docs/guide/component/AndroidLiquidGlassView.md) — `bind`, setters, defaults, API-33 note
- [`LiquidGlassimpl.java`](https://github.com/QmDeve/AndroidLiquidGlassView/blob/master/core/src/main/java/com/qmdeve/liquidglass/impl/LiquidGlassimpl.java) — `RenderNode`, `RuntimeShader`, `record()`, effect chain
- [`LiquidGlass.java`](https://github.com/QmDeve/AndroidLiquidGlassView/blob/master/core/src/main/java/com/qmdeve/liquidglass/LiquidGlass.java) — `TIRAMISU` gate, pre-draw listener
- [`liquidglass_effect.agsl`](https://github.com/QmDeve/AndroidLiquidGlassView/blob/master/core/src/main/res/raw/liquidglass_effect.agsl) — SDF, refraction band, seven-tap dispersion
- [`core/build.gradle`](https://github.com/QmDeve/AndroidLiquidGlassView/blob/master/core/build.gradle) — `compileSdk 37`, `minSdk 24`, Java 21, dependencies
- [LineageOS Changelog 32 — Slick Seventeen](https://lineageos.org/Changelog-32/) — LineageOS 24.0 = Android 17, announcement date, device roster, kernel policy
- [LineageOS device list](https://wiki.lineageos.org/devices/) — supported devices
