# Add a Preference

How to add one user-visible setting and wire it through both processes: the pref
node, the screen registry, the search index, the defaults map, and the reader in
the pack. Each step names what breaks when it is skipped.

**Audience:** agent or contributor adding a setting
**Prereqs:** [preferences system](../architecture/preferences-system.md),
[app UI](../architecture/app-ui.md)

---

## Summary

- A setting is a `ValuePref` node in a `PrefScreen`, plus a reader in a mod pack.
  Nothing links them but the key string.
- Six artefacts must agree: the node, `preferenceScreens`, `routeToScreenKey`
  (for a new screen), `searchScreenTitles`, `preferenceDefaults` (only when the
  key is a `dependency` target), and the pack's reader.
- The node's `default` string, the `preferenceDefaults` entry, and the reader's
  fallback literal are three separate values. All three must be the same text.
- `dependency` only dims a row. Hiding it requires an arm in
  `PrefRenderer.visibleBy`.
- A range slider must be written through `PrefRenderer.writeRange`, because the
  hooked side parses `{"":[lo,hi]}` and not the bare `lo,hi` the node declares.

---

## Model

### Where each artefact lives

| # | Artefact | File | Required? |
| --- | --- | --- | --- |
| 1 | `ValuePref` node | `app/src/main/java/sh/siava/pixelxpert/ui/screens/<screen>.kt` | Always |
| 2 | Screen entry | `app/src/main/java/sh/siava/pixelxpert/ui/screens/PreferenceScreens.kt` | Only for a new screen |
| 3 | Route entry | `app/src/main/java/sh/siava/pixelxpert/ui/screens/Routes.kt` | Only for a new routed screen |
| 4 | Search title | `app/src/main/java/sh/siava/pixelxpert/ui/screens/Routes.kt` | Only for a new searchable screen |
| 5 | Default | `app/src/main/java/sh/siava/pixelxpert/ui/prefs/PreferenceDefaults.kt` | Only when the key is named in another node's `dependency` |
| 6 | Reader | `app/src/main/java/sh/siava/pixelxpert/xposed/modpacks/**/*.kt` | Always, unless the value is only used in the app process |

### Node types and the type they persist

From `app/src/main/java/sh/siava/pixelxpert/ui/prefs/node/PrefNodes.kt`. All of
`default`, `title`, `summary`, `dependency` are nullable/zero-defaulted, so a
minimal node is `SwitchPref(key = "X")` — and it renders untitled, with no
summary, and defaults to absent.

| Node | `default` written as | Stored as | Hooked-side getter |
| --- | --- | --- | --- |
| `SwitchPref` | `"true"` / `"false"` | `Boolean` | `getBoolean` |
| `SliderPref` (`valueCount = 1`) | `"100"` | `Float` | `getSliderInt` / `getSliderFloat` |
| `SliderPref` (`valueCount = 2`) | `"0,100"` | `String`, `{"":[lo,hi]}` once written | `getSliderValues` |
| `ListPref` | the `entryValues` member | `String` | `getString` |
| `ListPref` (`multiSelect = true`) | none used | `Set<String>` | `getStringSet` |
| `TextPref` | `""` or a literal | `String` | `getString` |
| `ColorPref` | `"-16711936"` or `"#RRGGBB"` or `"0xFFRRGGBB"` | `String` | `getInt` |
| `TimePref` | `"00:00"` | `Int`, minutes since midnight | `getInt`, **not** `getString` |
| `QsLayoutOrderPref` | `"brightness,qs,media"` | `String` | `getString` |

`PrefStore.write` picks the stored type from the node class, so the node type is
what decides the getter the pack must use. Choosing a `TimePref` and reading it
with `getString` is a real mismatch that exists today; see the failure table.

### The three defaults

```text
ui/screens/<screen>.kt        SwitchPref(key = "X", default = "false")   <- what the row shows when unset
ui/prefs/PreferenceDefaults.kt   "X" to "false"                            <- what enabledBy resolves a dependency to
xposed/modpacks/**/Pack.kt    Xprefs.getBoolean("X", false)               <- what the hook uses when unset
```

The renderer resolves a row's own value through `PrefStore.read`, which returns
`pref.default` when `contains(key)` is false. The hooked side never sees the
node, only its own literal. Divergence is invisible until someone toggles the
row: the switch says off, the hook behaves as on.

### Where `preferenceDefaults` is actually read

One call site, `PrefRenderer.enabledBy`:

```kotlin
private fun enabledBy(store: PrefStore, node: ValuePref): Boolean {
	val dep = node.dependency ?: return true
	val def = preferenceDefaults[dep] == "true"
	return if (store.contains(dep)) store.getBoolean(dep, def) else def
}
```

A missing entry is `null == "true"` → `false`, so a fresh install renders the
dependent row disabled. That is the only consequence, and it only exists for keys
that something names in `dependency`.

Two keys are in that position today and are missing from the map:
`qsStatusbarPaddings` and `clockMultiRowStartOffset`, both declared in
`app/src/main/java/sh/siava/pixelxpert/ui/screens/statusbar_settings.kt`. Neither
is currently a `dependency` target, so neither is broken yet.

### Visibility versus enablement

Three rules, three places, no shared table:

| Behaviour | Implemented in | Input | Failure when unlisted |
| --- | --- | --- | --- |
| Dimmed and inert | `PrefRenderer.enabledBy` | `node.dependency` + `preferenceDefaults` | Dependency resolves to false; row stays greyed out |
| Hidden entirely | `PrefRenderer.visibleBy` | A `when (key)` over 55 literal keys, `else -> true` | Row is always visible |
| Filtered out of search | `SearchIndex.isVisible` | `entry.dependency` only | Result shown even when its switch is off |

`visibleBy` also catches `Throwable` and returns `true`, so a malformed stored
value leaves the row visible rather than taking the screen down.

### Screen registries

| Registry | File | Lookup | Effect of omission |
| --- | --- | --- | --- |
| `preferenceScreens` | `PreferenceScreens.kt` | `entry<Route.Pref>` | `MissingScreen(key)` renders `Not ported yet:` |
| `routeToScreenKey` | `Routes.kt` | `PxnNav.push` | A `NavRow` with that route opens `MissingScreen(route)` |
| `searchScreenTitles` | `Routes.kt` | `buildSearchIndex` | The whole screen is skipped by `?: continue` |

`searchScreenTitles` has 20 entries and `preferenceScreens` has 21. The
difference is `header_preferences`, which is the Home launcher and is deliberately
not searchable. `sleep_on_flat_prefs` is in both maps but has no route id and no
`NavRow` pointing at it, so search is currently the only way to reach it.

### Search indexing rules

`buildSearchIndex` in `app/src/main/java/sh/siava/pixelxpert/ui/search/SearchIndex.kt`:

- a screen is skipped entirely when it is absent from `searchScreenTitles`;
- a `Category` marked `ignore = true` still contributes its title as a
  breadcrumb, because the walk recurses before the `ignore` test;
- any other node with `ignore = true` is skipped;
- a node with `title == 0` **and** `summary == 0` is skipped;
- `ListPref.entries` is expanded and joined with `,` so every option is
  searchable;
- membership is a case-insensitive `contains` on a haystack of title, summary,
  entries and breadcrumbs joined by `SEP` (U+00F8);
- `FuzzyScore` from commons-text only orders the matches; the cap is
  `SEARCH_MAX_RESULTS = 10`.

`SearchEntry.key` is populated but never read: the destination screen is pushed
as `Route.Pref(screenKey, screenTitle)` and `PrefScreenContent` takes no
search-key parameter. Nothing scrolls to or highlights the matched row.

---

## Walkthrough

### 1. Pick the screen and the node type

Decide which existing `PrefScreen` owns the setting. Reuse a screen where
possible: a new screen costs steps 5 and 6 as well. Pick the node type from the
table above; the node type decides the stored type and therefore the getter the
pack must call.

### 2. Add the node

In `app/src/main/java/sh/siava/pixelxpert/ui/screens/<screen>.kt`, inside the
right `Category.children`. The shape of a real node, from
`app/src/main/java/sh/siava/pixelxpert/ui/screens/misc_prefs.kt`:

```kotlin
SwitchPref(
	key = "allScreenRotations",
	title = R.string.allow_all_screen_rotations,
	summary = R.string.allow_all_screen_rotations_summary,
	default = "false",
	summaryOn = R.string.general_on,
	summaryOff = R.string.general_off,
),
```

and a slider with a dependency, from
`app/src/main/java/sh/siava/pixelxpert/ui/screens/statusbar_batterybar_prefs.kt`:

```kotlin
SliderPref(
	key = "BBarHeight",
	title = R.string.BB_Thickness_title,
	default = "50",
	dependency = "BBarEnabled",
	continuous = true,
),
```

Rules that apply to the node itself:

- `key` is a literal string. It must match the pack's literal exactly.
- `title` is a `@StringRes`. A literal string needs `titleText` instead, which
  wins over `title`; `misc_prefs.kt` does this once, on `sysui_tuner`.
- `default` is the value the row shows when the key is absent, written in the
  widget's own text form.
- `summaryOn`/`summaryOff` override `summary` for a switch; the renderer picks
  `summaryOn` when checked, `summaryOff` when not, else `summary`.
- `mainSwitch = true` and `prominent = true` are declared on `SwitchPref` but
  read by nothing in the renderer.
- `icon` is a drawable resource; `0` means the row reserves no leading space.

### 3. Add the string resources

`app/src/main/res/values/strings.xml` for the title and summary. The search index
resolves them with `context.getString(...)` once, at index build time.

### 4. Add the key to `preferenceDefaults` if it is a dependency target

Only needed when some node names this key in `dependency`. Add the entry with
exactly the same text as the node's `default`:

```kotlin
"allScreenRotations" to "false",
```

Skipping this is invisible until a row depends on it. Adding it unnecessarily is
harmless.

### 5. Register the screen (new screens only)

Three edits, all in `app/src/main/java/sh/siava/pixelxpert/ui/screens/`:

```kotlin
// PreferenceScreens.kt
"statusbar_settings" to statusbar_settings,

// Routes.kt
val routeToScreenKey: Map<String, String> = mapOf(
	"statusbar" to "statusbar_settings",
)

val searchScreenTitles: Map<String, Int> = mapOf(
	"statusbar_settings" to R.string.statusbar_header,
)
```

The map key in `PreferenceScreens.kt` and the `PrefScreen.key` inside the file are
independent strings. Keeping them equal is a convention, not a requirement of the
code, and nothing warns when they diverge.

### 6. Reach the screen from a row

A new screen is unreachable unless something navigates to it. Either add a
`NavRow` on an existing screen:

```kotlin
NavRow(key = "sbc_header", title = R.string.sbc_header, route = "sbc"),
```

or a `MainTile` on `header_preferences`. The `route` value must be a key of
`routeToScreenKey`, or of `bespokeRoutes` in
`app/src/main/java/sh/siava/pixelxpert/ui/nav/PxnNav.kt` for a hand-written
screen.

### 7. Hide or dim the row when its feature is off

If the row is meaningless while a switch is off, add an arm to `visibleBy` in
`app/src/main/java/sh/siava/pixelxpert/ui/prefs/PrefRenderer.kt`:

```kotlin
"SyncNTPTimeNow", "TimeSyncInterval", "NTPServers" ->
	store.getBoolean("SyncNTPTime", false)
```

The arm is keyed on the row being hidden, not on the switch that governs it.
`dependency` alone does not hide anything; it only sets `alpha(0.38f)` and
`clickable(enabled = false)`.

### 8. Add the reader in the pack

In the pack's `onPreferenceUpdated`, read the key with the getter that matches the
node type:

```kotlin
override fun onPreferenceUpdated(vararg key: String?) {
	allScreenRotations = Xprefs.getBoolean("allScreenRotations", false)
}
```

Two rules:

- read every key the pack uses, unconditionally, not only `key[0]`;
- pass the same value the node declares as `default`.

`onPreferenceUpdated` is called once with no keys before `onPackageLoaded`
(`XPLauncher.loadModPack`), which is what makes the unconditional read the
initialisation path as well as the update path.

### 9. Verify

There is no build on this machine. On a build machine, and by inspection
everywhere:

```bash
# 1. the key appears exactly twice, once per side
grep -rn "allScreenRotations" app/src/main/java/sh/siava/pixelxpert

# 2. the node's default and the reader's fallback are the same text
grep -rn -A2 'key = "allScreenRotations"' app/src/main/java/sh/siava/pixelxpert/ui/screens
```

On device, the stored value can be read back without trusting the switch. The
hidden `HookAuditScreen` (five taps on the Settings tab) snapshots
`PrefStore.open(context).all.toMap()` into `MarkdownGenerator.generate`, whose
`## PixelXpert Preferences` section lists every key and value. A `String` value
renders inside backticks, a `Boolean` renders plainly, so the stored type is
visible in the exported report.

---

## Contracts

Two tables. The first is the rule set; the second is the same rules restated as
"What breaks when each piece is omitted", which is the form a reviewer needs.

| Rule | Consequence of breaking it |
| --- | --- |
| The key literal is identical in the node and in every reader | The reader returns its fallback forever; the UI keeps showing its own default |
| The node's `default`, the `preferenceDefaults` entry, and the reader's fallback are the same text | The switch and the feature disagree until the first touch |
| The node type matches the getter | `ClassCastException` in the hooked process, or a silent fallback when the getter tolerates it |
| A range slider is written only by `writeRange` | A `putFloat` on `"0,50"` stores `0f` and drops the upper bound |
| A key that gates other rows is in `preferenceDefaults` | Dependent rows are born disabled and never enable |
| A row that must disappear needs a `visibleBy` arm | It stays visible with its feature off |
| A new screen is in `preferenceScreens` | `entry<Route.Pref>` renders `MissingScreen` |
| A routed screen is in `routeToScreenKey` | The `NavRow` renders `MissingScreen` |
| A searchable screen is in `searchScreenTitles` | The whole screen is skipped by the index |
| `key` is not a prefix of another key used in `PREF_UPDATE_EXCLUSIONS` | `packageLastLoad_` and `packageStrike_` writes would be relayed and re-enter `loadEverything` |

---

### What breaks when each piece is omitted

| Omitted | Immediate observable result | Silent? |
| --- | --- | --- |
| The node | The key is never written; the reader's fallback is the permanent value | Yes |
| The reader | The row toggles, persists, survives reboot, changes nothing | Yes |
| The key match (typo on either side) | Reader always sees an absent key | Yes |
| `default` agreement | Switch shows one state, feature behaves as the other | Until first touch |
| `preferenceDefaults` entry, when used as `dependency` | Dependent row is disabled on a fresh install, forever | Yes |
| `visibleBy` arm | Row visible while its feature is off; toggling it does nothing | Yes |
| `preferenceScreens` entry (new screen) | `MissingScreen` prints the screen key | No, visible |
| `routeToScreenKey` entry (new screen) | `MissingScreen` prints the route id | No, visible |
| `searchScreenTitles` entry (new screen) | Rows work but cannot be found by search | Yes |
| `summaryOn`/`summaryOff` | Row falls back to `summary`, or to no supporting text | No, cosmetic |
| `title` and `titleText` both absent | Row renders with an empty label; a `NavRow`/`MainTile` also gives the destination an empty heading | No, visible |
| A `Category` wrapper around the new rows | Rows appear at the top level of the screen instead of under a heading | No, cosmetic |

---

## Failure modes

| Symptom | Cause | Evidence in code |
| --- | --- | --- |
| The switch persists but the feature never reacts | Key mismatch, or the pack reads in `onPackageLoaded` only | No symbol links the two; `XPrefs.loadEverything` forwards only the changed key string |
| The switch shows off while the feature is on | Node `default` differs from the reader's fallback | `PrefStore.read` returns `pref.default` for an absent key; the reader uses its own literal |
| A dependent row is greyed out on a clean install | The dependency key has no `preferenceDefaults` entry | `enabledBy`: `preferenceDefaults[dep] == "true"` is `null == "true"` |
| A dependent row stays greyed out after the switch is turned on | The row composable stopped collecting `store.revision` in its own scope, so Compose skipped it | `enabledBy`'s KDoc records `pinned_adb_port` as exactly this case |
| A row stays on screen with its feature off | No `visibleBy` arm | `visibleBy`'s `else -> true` |
| A row vanishes unexpectedly | A `visibleBy` arm returns false because a read threw; the `catch` returns `true` only for throws inside the `when` | `visibleBy`'s `catch (ignored: Throwable) { true }` |
| The screen opens on `Not ported yet:` | Screen not in `preferenceScreens`, or route not in `routeToScreenKey`/`bespokeRoutes` | `PxnNav` `entry<Route.Pref>` and `MissingScreen` |
| A range slider's upper bound is lost | Written with `putFloat` instead of `writeRange` | `PrefStore.write` sends a non-numeric string down the `putString` path; `putFloat("0,50")` gives `0f` |
| A range slider reads as "0 to 0" | `Xprefs.getSliderValues` on an absent key: `SliderValues.getValues("")` returns an empty list | `visibleBy`'s comment on `batteryWarningRange` records this empty-list path |
| A colour reads as white | `getInt` on a hex string needs the hex fallback step, not `Color.parseColor` | `ExtendedRemotePreferences.getInt` tries `toIntOrNull`, then `Color.parseColor`, then hex; `parseColor` rejects a `0x` prefix |
| `MiscSettings` throws parsing `NetworkStatsStartTime` | `TimePref` writes an `Int`; the pack reads it with `getString` | `PrefStore.write` → `putInt` for `TimePref`; `MiscSettings` calls `Xprefs.getString("NetworkStatsStartTime", "0:0")` and feeds it to `LocalTime.parse` |
| The screen crashes when opened after restoring an old backup | `SwitchPref` and single-select `ListPref` read with no `ClassCastException` guard | `PrefStore.read` catches only for `ColorPref` and tolerates only through `getInt` for `TimePref` |
| `UpdateWifiOnly` behaves differently after a reboot | Two fallbacks exist for the same absent key | `PrefRenderer.visibleBy` reads `AutoUpdate` with `true`; `UpdateWorker.KEY_WIFI_ONLY` reads with `true`; the node declares `"false"` |
| A search result opens the right screen but does not scroll to the row | Nothing implements it | `SearchEntry.key` is set in `buildSearchIndex` and read nowhere; `PrefScreenContent` has no search-key parameter |
| The app bar shows the app name, not the screen title | The `NavRow`/`MainTile` that pushed it had `title = 0` | `PxnNav`'s heading block falls back to `R.string.app_name` when the title is 0 |

---

## Checklist

- [ ] The node is in the right `Category` of the right `PrefScreen`
- [ ] `key` is a literal that appears identically in the pack
- [ ] `default` is written in the widget's own text form
- [ ] The reader's fallback literal is the same text as `default`
- [ ] `preferenceDefaults` has an entry if any node names this key in `dependency`
- [ ] `visibleBy` has an arm if the row must disappear when its feature is off
- [ ] A new screen is in `preferenceScreens`, `routeToScreenKey`, and
      `searchScreenTitles`
- [ ] Something navigates to a new screen: a `NavRow` or a `MainTile`
- [ ] The pack reads it in `onPreferenceUpdated`, with the getter matching the
      node type
- [ ] `grep -rn "<key>" app/src/main/java/sh/siava/pixelxpert` returns exactly the
      node and the reader, plus any deliberate extras
- [ ] `docs/reference/preference-keys.md` and
      `docs/reference/data/preference-keys.json` are regenerated in the same
      commit

---

## See also

- [Preferences system](../architecture/preferences-system.md)
- [App UI](../architecture/app-ui.md)
- [Add a mod pack](add-a-mod-pack.md)
- [Preference keys reference](../reference/preference-keys.md)
