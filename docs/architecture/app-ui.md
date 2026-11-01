# App UI: Activities, Navigation 3, and the Screen Registry

How the app process turns a declarative `PrefScreen` into a rendered settings
page, how it navigates between pages, and which file owns each piece. This is
the app-side counterpart to the hooking architecture; nothing here runs in a
hooked process.

**Audience:** agent adding or changing a screen, a row, a destination, or the theme
**Prereqs:** [overview](overview.md), [preferences-system](preferences-system.md)

---

## Summary

- One activity renders the whole UI. `MainActivity` calls
  `setContent { PxnTheme { PxnRoot(startRoute) } }`, and `PxnRoot` is a
  three-line wrapper around `PxnNav`.
- Navigation is Navigation 3: `NavDisplay` plus `rememberNavBackStack` from
  `androidx.navigation3`, not Nav 2's `NavHost`. Backstack keys are the sealed
  `Route` hierarchy in `app/src/main/java/sh/siava/pixelxpert/ui/nav/PxnNav.kt`.
- Every settings page is data. A `PrefScreen` value lives in
  `app/src/main/java/sh/siava/pixelxpert/ui/screens/` and is rendered by one
  composable, `PrefScreenContent`, in
  `app/src/main/java/sh/siava/pixelxpert/ui/prefs/PrefRenderer.kt`.
- 21 `PrefScreen` values exist. 18 are reachable by route id through
  `routeToScreenKey`. `header_preferences` and `own_prefs_header` are rendered
  directly as the Home and Settings tabs. `sleep_on_flat_prefs` is registered
  but has no route id and no `NavRow`, so search is the only way in.
- Five destinations are hand-written composables rather than `PrefScreen` data:
  `SearchScreen`, `UpdateScreen`, `HooksScreen`, `IconPackScreen`, and the hidden
  `HookAuditScreen`.
- `PrefStore` is a Koin singleton, so every screen reads the same
  `SharedPreferences` instance and the same revision stream.

---

## Model

### Activity chain

Three activities run in sequence on launch, and only the last one shows settings.

| Activity | File | Job |
| --- | --- | --- |
| `FakeSplashActivity` | `app/src/main/java/sh/siava/pixelxpert/FakeSplashActivity.kt` | Owns the platform splash window, forwards the intent, finishes |
| `SplashActivity` | `app/src/main/java/sh/siava/pixelxpert/SplashActivity.kt` | Runs three gating checks, then starts `MainActivity` |
| `MainActivity` | `app/src/main/java/sh/siava/pixelxpert/MainActivity.kt` | Single Compose host; also the target of three updater intents |

`FakeSplashActivity` exists only so the platform splash and the check screen are
not the same window. It pins the splash with
`splashScreen.setKeepOnScreenCondition { true }`, starts `SplashActivity`
underneath it, and finishes; the finish is what dismisses the splash. Its class
KDoc records why: when one activity did both, the checks completed inside the
splash window and the spinners never appeared.

`SplashActivity` runs three checks on three threads and refuses to hand over
until all three settle:

1. `ModuleInstaller.hasRoot()` on thread `pxn-splash-root`. Success counts down
   `rootCheckPassed`; failure sets `failure` and leaves the latch at 1, so the
   other two threads block forever. That is deliberate.
2. The libsu root service, on thread `pxn-splash-gate`, through
   `PxnApp.tryConnectRootService()` and `app.rootServiceConnected.await()`. The
   wait has no timeout.
3. `PixelGate.evaluate()` on thread `pxn-splash-pixel`. It reads a file test
   through a root shell, so it also waits on `rootCheckPassed`.

The handover sleeps `Thread.sleep(1000)` first, then either starts
`MainActivity` (copying the received extras) or sets a failure string. The
failure dialog is non-cancelable: `onDismissRequest = {}` and the only button
calls `System.exit(0)`.

### Navigation 3

`PxnNav` holds one backstack and one `Route` value per destination.

```kotlin
sealed interface Route : NavKey {
	@Serializable data object Home : Route
	@Serializable data class Pref(val screenKey: String, val title: Int) : Route
	@Serializable data class Unported(val route: String, val title: Int) : Route
	@Serializable data object Search : Route
	@Serializable data object IconPack : Route
	@Serializable data object Update : Route
	@Serializable data object Hooks : Route
	@Serializable data object Settings : Route
	@Serializable data object HookAudit : Route
}
```

`Route.Pref` carries both the `preferenceScreens` key and the `@StringRes` title
of the row that opened it. That title becomes the app bar heading, so the row
that opens a screen also names it. There is no per-screen title lookup at
navigation time.

The stack starts at `Route.Home`. Three helpers mutate it:

| Helper | Behaviour |
| --- | --- |
| `pushTarget(target)` | Appends unless it is already on top |
| `push(route, title)` | Resolves `bespokeRoutes`, then `routeToScreenKey`, then falls back to `Route.Unported` |
| `selectTab(spec)` | Clears the stack to `Home`, then pushes the tab key |

`reselectTab(spec)` pops back to an already-selected tab instead of pushing it
again.

Transitions come from `LocalPxnMotionScheme.current` through a local
`PxnMotionScheme.sharedAxisX` extension: a `SharedAxisSlideDistance` of 96.dp
combined with a cross-fade where the outgoing destination fades over
`OutgoingFadeFraction = 0.35f` of the spatial duration.

### Screen registries

Four maps in `app/src/main/java/sh/siava/pixelxpert/ui/screens/` decide what a
route id reaches.

| Registry | File | Size | Looked up by |
| --- | --- | --- | --- |
| `preferenceScreens` | `PreferenceScreens.kt` | 21 | `entry<Route.Pref>` |
| `routeToScreenKey` | `Routes.kt` | 18 | `PxnNav.push` |
| `searchScreenTitles` | `Routes.kt` | 20 | `SearchIndex.buildSearchIndex` |
| `bespokeRoutes` | `PxnNav.kt` | 2 | `PxnNav.push` |

`bespokeRoutes` maps `"icon_pack"` to `Route.IconPack` and `"update"` to
`Route.Update`. Both are hand-written screens with no `PrefScreen`, so
`routeToScreenKey` cannot name them. `Routes.kt` also declares
`unportedRoutes: Set<String> = setOf()`, which is referenced only by a comment
and by nothing at runtime.

Two screens are rendered without going through either map:
`entry<Route.Home>` renders `header_preferences` directly, and
`entry<Route.Settings>` renders `own_prefs_header` directly.

### The renderer

`PrefScreenContent(screen, store, onNavigate, onSearch, modifier)` is the only
composable that draws a settings page. Its body is short and load-bearing:

```kotlin
val revision by store.revision.collectAsState()
val flat = remember(screen) { screen.flatten() }
val rows = flat.filter { visibleBy(store, it.node.nodeKey) }
val blocks = rows.toBlocks()
val googleDesign = store.getBoolean("GoogleSettingsDesign", false)
```

- `revision` is subscribed so any write recomposes the whole page. It is
  subscribed *again* inside each row composable, because `node` and `store` are
  reference-stable and Compose would otherwise skip the row's scope.
- `flatten()` is remembered; the visibility filter is not. The KDoc states that
  is what lets a switch hide its own sub-rows without the screen being reopened.
- `toBlocks()` collapses each run of consecutive `MainTile` nodes into one
  `PrefBlock.Tiles` bubble carrying the enclosing `Category.accent`.
- `googleDesign` switches the search widget and tile painting between the
  module's own look and the Google Settings look.

The `LazyColumn` deliberately passes no key lambda. The KDoc records the reason:
several `Category` nodes carry no `android:title`, so a title-derived key
collided on `"c:0"`.

Row types dispatch in one `when` in `PrefNodeRow`: `Illustration`, `Category`,
`SearchBar`, `NavRow`, `ActionRow`, `MainTile`, `SwitchPref`, `SliderPref`,
`ListPref`, `TextPref`, `ColorPref`, `TimePref`, `QsLayoutOrderPref`.

### Theme

`PxnTheme` in `app/src/main/java/sh/siava/pixelxpert/theme/PxnTheme.kt` wraps the
stable `MaterialTheme` and provides one extra composition local:

```kotlin
CompositionLocalProvider(LocalPxnMotionScheme provides motionScheme) {
	MaterialTheme(colorScheme = colorScheme, content = content)
}
```

`resolveColorScheme(context, darkTheme, dynamicColor)` is non-composable so the
same source of truth can be read outside composition. `dynamicColor = true`
selects `dynamicDarkColorScheme`/`dynamicLightColorScheme`; `false` selects the
static `darkColorScheme()`/`lightColorScheme()`.

`PxnMotionScheme` in `app/src/main/java/sh/siava/pixelxpert/theme/PxnMotion.kt`
reimplements the expressive motion model because material3 1.4.0 keeps
`androidx.compose.material3.MotionScheme` Kotlin-internal. It exposes spatial
and effects tiers in fast/standard/slow, with two presets: `expressive` (400 ms
spatial) and `standard` (300 ms). `LocalPxnMotionScheme` defaults to
`PxnMotionScheme.expressive`.

The XML theme is only there to paint the window before Compose runs.
`app/src/main/res/values/themes.xml` declares `Theme.PXN` with
`android:windowBackground` set to `@color/pxn_window_background`, which resolves
to `@android:color/system_background_light` or `_dark`. `Theme.PXN.Splash`
derives from `Theme.SplashScreen` and overrides `windowSplashScreenBackground`
to the same colour, because the androidx default follows neither wallpaper nor
custom colour profile.

### Dependency injection

`app/src/main/java/sh/siava/pixelxpert/di/PxnModule.kt` is 15 lines and has one
binding:

```kotlin
val pxnModule = module {
	single { PrefStore(get()) }
}
```

`PxnApp.onCreate` starts Koin with `androidContext(this@PxnApp)` and
`modules(pxnModule)`. `MainActivity` injects with `by inject()`; `PxnNav` and the
hand-written screens use `koinInject()`. Because `PrefStore` is a singleton, its
`revision` flow is the single invalidation channel for every screen.

---

## Walkthrough

### A settings row opens a settings page

1. `PrefScreenContent` renders a `NavRow` through `NavRowItem`. The row is
   `clickable { onNavigate(node.route, node.title) }`.
2. `onNavigate` is `PxnNav::push`. It first asks `bespokeRoutes[route]`; a hit
   is pushed directly and the rest of this sequence is skipped.
3. Otherwise it asks `routeToScreenKey[route]`. A hit produces
   `Route.Pref(screenKey, title)`; a miss produces `Route.Unported(route, title)`.
4. `pushTarget` appends the key unless it is already `backStack.lastOrNull()`.
5. `NavDisplay`'s `entry<Route.Pref>` block runs. It reads
   `preferenceScreens[key.screenKey]`.
6. A non-null screen is rendered through `NavScene { PrefScreenContent(...) }`.
   `NavScene` paints `MaterialTheme.colorScheme.background` behind it. A null
   screen renders `MissingScreen(key.screenKey)`, which prints
   `"Not ported yet:\n<key>"`.
7. The app bar heading for the new destination is
   `when (backStack.lastOrNull()) { is Route.Pref -> current.title ... }`.

### A tab is selected

1. `NavigationBar` iterates `tabs`: Home, Update, Hooks, Settings.
2. A tap on a tab that is not selected calls `selectTab(spec)`, which clears the
   backstack, adds `Route.Home`, then adds the tab key unless the tab is Home.
3. A tap on the already-selected tab calls `reselectTab(spec)`, which pops
   everything above that tab's index.
4. The selected tab is `backStack.lastOrNull { it in tabKeys }`, so a child
   screen pushed from a tab leaves the owning tab selected.
5. Five taps on Settings within a 3-second window push `Route.HookAudit` instead.
   The counter is `settingsTapCount` with `lastSettingsTapTime`; the window is
   the literal `3000L`.
6. The Update tab is wrapped in `BadgedBox(badge = { Badge() })` while
   `store.getInt("latestVersionCode", -1) > BuildConfig.VERSION_CODE`.

### An intent selects a tab

1. `MainActivity.handleIntent` reads one of four extras: `updateTapped`,
   `migratePrefs`, `newUpdate`, plus `filePath` for the first. All three branches
   set `startRoute = Route.Update`.
2. `startRoute` is activity-local `mutableStateOf`, not a shared holder, because
   a second notification tap starts a second activity instance.
3. `PxnNav`'s `LaunchedEffect(startRoute)` clears the backstack, adds
   `Route.Home`, then adds the requested route.

### A screen-local overlay is drawn

Two composables hang off `PxnNav`'s outer `Box` rather than living inside a
screen, because they must overlay the window edge rather than the list:

| Overlay | Shown while | Signature |
| --- | --- | --- |
| `PullDownIndicator` | `Route.Pref.screenKey == "quicksettings_prefs"` | `BoxScope.PullDownIndicator(store)` |
| `GestureNavIndicators` | `Route.Pref.screenKey == "gesture_nav_prefs"` | `BoxScope.GestureNavIndicators(store)` |

Both are keyed on the literal screen key, so renaming a `PrefScreen` key breaks
them silently.

### Global actions

Two top-bar menus, both in `PxnNav.kt`:

| Menu | Entry | Effect |
| --- | --- | --- |
| `RestartMenu` | Restart SystemUI | `Restarter.restartSystemUI()` |
| | Soft reboot | `Restarter.softRestart()` |
| | Restart system | `Restarter.restartSystem()` |
| `OverflowMenu` | Export settings | `store.exportTo(uri)`, default name `PixelXpert_Config.bin` |
| | Import settings | `store.importFrom(uri)` then `Restarter.restartSystemUI()` on success |
| | Reset to defaults | `store.resetAll()` then `Restarter.restartSystemUI()` |

The import restart is not cosmetic: hooks read values once at load and on change
notification, so a wholesale file replacement needs a process restart to land.

---

## Contracts

| Contract | Consequence of breaking it |
| --- | --- |
| A `NavRow.route` or `MainTile.route` must exist in `routeToScreenKey` or `bespokeRoutes` | The row opens `MissingScreen` showing `Not ported yet:` and the route id |
| A `preferenceScreens` key must equal the `PrefScreen.key` of the value it maps | Nothing breaks at compile time; the map is keyed by string, not by `PrefScreen.key` |
| A screen that should be searchable must appear in `searchScreenTitles` | `buildSearchIndex` skips the whole screen with `?: continue` |
| A screen that should be reachable by route id must appear in `routeToScreenKey` | Only reachable from search results, which push `Route.Pref` directly |
| Only one activity may host Compose | `PxnRoot(startRoute)` is designed to be the sole entry point |
| A screen composable must not draw its own top bar | `PxnNav`'s `Scaffold` owns the app bar for every route; `SearchScreen`'s KDoc states this explicitly |
| Do not pass a key lambda to the rows `LazyColumn` | Title-derived keys collide on untitled categories |
| A new overlay keyed on a screen must match the `PrefScreen.key` literal | The overlay silently never appears |

---

## Failure modes

| Symptom | Cause | Where to look |
| --- | --- | --- |
| Tapping a tile shows `Not ported yet:` | Route id missing from `routeToScreenKey` and `bespokeRoutes` | `PxnNav.push`, `MissingScreen` |
| Tapping a tile shows `Not ported yet:` with a key that looks right | Screen value added to its own file but not to `preferenceScreens` | `PreferenceScreens.kt`; `entry<Route.Pref>` renders `MissingScreen(key.screenKey)` |
| A setting is not found by search | Screen absent from `searchScreenTitles`, or node has `title == 0` and `summary == 0`, or node is `ignore = true` | `SearchIndex.buildSearchIndex` |
| Search finds a row but the destination shows no highlight | Nothing implements it: `SearchEntry.key` is never read, and `PrefScreenContent` takes no search-key parameter | `SearchScreen`, `PrefRenderer` |
| The pull-down strip never appears | `Route.Pref.screenKey` is not the literal `"quicksettings_prefs"` | `PxnNav` top-bar block |
| The gesture overlay never appears | `Route.Pref.screenKey` is not the literal `"gesture_nav_prefs"` | `PxnNav`, `onGestureNav` |
| A switch flips but the row underneath does not appear | The dependency key has no arm in `visibleBy`; the `else -> true` branch keeps the row visible, or a wrong arm hides it | `PrefRenderer.visibleBy` |
| A row stays greyed out until the app is restarted | A row composable stopped subscribing to `store.revision` in its own scope | `PrefRenderer.enabledBy` KDoc |
| The app bar shows the app name instead of the screen name | The pushing node had `title = 0` and no `titleText`, so `Route.Pref.title` is 0 and the heading falls back to `R.string.app_name` | `PxnNav` heading block; `NavRowItem`/`TileRow` pass `node.title` |
| The app refuses to start and only Exit works | One of the three splash checks failed: no root, root service did not bind, or `PixelGate` refused the device | `SplashActivity`, `PixelGate` |
| A `PrefScreen.title` is set and never appears | `PrefScreen.title` is declared but read by nothing; headings come from `Route.Pref.title` | `PrefModel.kt` |

---

## Checklist

Before adding or changing a screen:

- [ ] The `PrefScreen` value is declared in its own file under `ui/screens/` and
      added to `preferenceScreens` with a key identical to `PrefScreen.key`
- [ ] If a row should open it, the route id is in `routeToScreenKey`, or the
      destination is a hand-written composable registered in `bespokeRoutes`
- [ ] If it should be searchable, it is in `searchScreenTitles`
- [ ] Every `NavRow`/`MainTile` title is a non-zero `@StringRes`, or `titleText`
      is set, because that value becomes the destination heading
- [ ] Any row that must be hidden until its switch is on has an arm in
      `PrefRenderer.visibleBy`; `dependency` only dims, it never hides
- [ ] The screen draws content only; `PxnNav` owns the app bar
- [ ] If a screen-local overlay is keyed on the screen, the literal key matches

---

## See also

- [Architecture overview](overview.md)
- [Preferences system](preferences-system.md)
- [Add a preference](../guides/add-a-preference.md)
- [Repository map](../agent/REPO_MAP.md)
