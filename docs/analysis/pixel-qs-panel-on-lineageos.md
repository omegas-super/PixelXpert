# Pixel-Style QS Panel on LineageOS

Whether PixelXpert's Quick Settings packs can run against AOSP SystemUI, which
classes they need, and what to do when one is missing. Read this before trying to
make the QS panel look like a Pixel.

**Audience:** user or agent chasing a Pixel-style QS panel on a non-Pixel ROM
**Prereqs:** [LineageOS setup](lineageos-setup.md), [modpack-lifecycle](../architecture/modpack-lifecycle.md)

**Status:** point-in-time, 2026-11-01. AOSP class names verified against
`aosp-mirror/platform_frameworks_base` at branch `main`. Device results are
**unverified** — no device was available.

---

## Summary

- The QS packs target the **AOSP Compose QS rework**, not Pixel-only classes.
  `PaginatedGridLayout`, `QSColumnsRepository`,
  `QuickQuickSettingsRowRepository` and `QuickQuickSettingsRowInteractor` all
  exist in AOSP `packages/SystemUI/src/com/android/systemui/qs/panels/`.
- This is the opposite of what the packaging analysis predicted. AOSP SystemUI on
  LineageOS is a plausible host for these hooks, not a hostile one.
- What the QS packs change is **geometry and typography**: rows, columns, quick-QS
  row count, tile label scale. They do not restyle the panel.
- There is no pack that makes AOSP QS look like Pixel QS. That is a theme and
  layout difference, not a hook difference.
- The correct first move is the hook audit, not a code change.

---

## Model

### What AOSP actually ships

`aosp-mirror/platform_frameworks_base`, branch `main`,
`packages/SystemUI/src/com/android/systemui/qs/` contains these sub-packages:

```text
qs/
├── composefragment/
├── customize/
├── external/
├── footer/
├── logging/
├── panels/
│   └── ui/compose/
│       ├── GridLayout.kt
│       ├── PaginatedGridLayout.kt
│       ├── QuickQuickSettings.kt
│       ├── TileGrid.kt
│       ├── TileDetails.kt
│       ├── infinitegrid/
│       ├── selection/
│       └── toolbar/
├── pipeline/
├── shared/
├── tileimpl/
├── tiles/
├── touch/
└── ui/
```

Cross-referencing that against the class names the QS packs hook:

| Class the pack hooks | In AOSP? | Evidence |
| --- | --- | --- |
| `qs.panels.ui.compose.PaginatedGridLayout` | Yes | `panels/ui/compose/PaginatedGridLayout.kt` — HTTP 200 |
| `qs.panels.ui.compose.infinitegrid.CommonTileKt` | Yes | `panels/ui/compose/infinitegrid/CommonTile.kt` exists in that package and declares top-level `LargeTileContent`, `LargeTileLabels`, `SmallTileContent`; the `CommonTileKt` facade is generated from it |
| `qs.panels.data.repository.QSColumnsRepository` | Yes | `panels/data/repository/QSColumnsRepository.kt` — HTTP 200 |
| `qs.panels.data.repository.QuickQuickSettingsRowRepository` | Yes | `panels/data/repository/QuickQuickSettingsRowRepository.kt` — HTTP 200 |
| `qs.panels.domain.interactor.QuickQuickSettingsRowInteractor` | Yes | `panels/domain/interactor/QuickQuickSettingsRowInteractor.kt` — HTTP 200 |
| `qs.tileimpl.QSFactoryImpl`, `QSTileImpl` | Likely | `tileimpl/` exists |
| `qs.external.CustomTile` | Likely | `external/` exists |
| `qs.tiles.WifiTile`, `BluetoothTile`, `InternetTile`, … | Likely | `tiles/` exists |

"Likely" means the package exists and the class name is the AOSP convention, but
the individual file was not opened. **Uncertain** is the honest label for those
rows. Only `PaginatedGridLayout` was confirmed file-by-file.

The important conclusion does not depend on resolving every row: the QS packs are
written against the AOSP Compose panel architecture, and LineageOS builds that
architecture from the same upstream source. This is materially better than the
SystemUI picture painted by [lineageos-setup](lineageos-setup.md), which assumed
Pixel-only classes.

### What the QS packs actually do

`QSTileGrid` is the main one. Its KDoc states the scope:

> Resizes the Quick Settings tile grid to the configured row and column counts, in
> portrait and landscape separately, plus the quick-QS row count and the tile
> label typography.

Its mechanism, in order:

1. `PaginatedGridLayout.before("TileGrid")` — when the grid is built, install a
   short-lived `Resources.getInteger` hook.
2. Inside that hook, if the requested integer id is
   `quick_settings_paginated_grid_num_rows`, return the configured row count
   instead. Landscape and portrait are separate preferences.
3. The temporary `getInteger` hook is removed as soon as the grid is built.
4. `CommonTileKt.before("TileLabel")` scales tile labels once each, guarded by an
   additional instance field so a label is never scaled twice.

Every geometry preference change ends with `SystemUtils.doubleToggleDarkMode()`,
because SystemUI only rebuilds the panel on a configuration change. That is the
`darkSwitching` guard in `SystemUtils` — a real workaround, not decoration.

So the feature set is: **N rows × M columns, QQS row count, label scale.** It is
a layout tuner. It is not a Pixel restyle.

### What "Pixel-style QS" actually means

Worth separating three things that get conflated:

| Layer | What changes it | Is it a PixelXpert pack? |
| --- | --- | --- |
| Grid geometry (rows/columns/label size) | `QSTileGrid` | Yes |
| Tile appearance (shape, colour, icon treatment) | `StatusbarMods`, `IconPacks`, `StatusIconTuner` | Partly |
| Panel background (blur, glass, transparency) | No pack does this today | No |

A Pixel QS panel differs from AOSP QS in all three layers. PixelXpert addresses the
first well, the second partly, and the third not at all — which is exactly where a
glass effect would have to be added, and why [liquid-glass-and-lineageos](liquid-glass-and-lineageos.md)
exists as a separate research note rather than a feature.

---

## Walkthrough

### 1. Establish whether the classes exist on your build

Do not guess. The audit answers it.

1. Install PixelXpert, scope all six packages in LSPosed.
2. Open the Hooks page and confirm the SystemUI row is hooked.
3. Run the hook audit.

`SystemUIInspector` checks the QS targets explicitly and records `PRESENT`,
`ABSENT` or `INLINED` for each. Read the QS section of the report.

### 2. Interpret the result

| Audit result | Meaning | Action |
| --- | --- | --- |
| `PRESENT` for `PaginatedGridLayout` | The Compose QS panel is there | Try the grid settings |
| `ABSENT` | This build does not have the Compose panel, or R8 renamed it | The pack cannot work; stop |
| `INLINED` | R8 removed the constructor | The pack's `afterConstruction` path cannot work |

`INLINED` is a real and expected outcome on release builds. `InspectionUtils`
reports it when `clazz.declaredConstructors.isEmpty()`, and the QS section of the
inspector already special-cases it:

```kotlin
val isQqsInlined = qqsRowRepo.status == AuditStatus.INLINED
```

That is the module admitting, in code, that a release build can inline the
constructor it wants to hook.

### 3. Change the grid settings

In PixelXpert, open the Quick Settings section and set:

| Preference key | Effect | Default |
| --- | --- | --- |
| `QSRowQty` | portrait rows | not set |
| `QSColQty` | portrait columns | not set |
| `QSRowQtyL` | landscape rows | not set |
| `QSColQtyL` | landscape columns | not set |
| `QQSRows` | quick-QS rows, portrait | not set |
| `QQSRowsL` | quick-QS rows, landscape | not set |
| `QSLabelScaleFactor` | label scale, percent offset | 0 |
| `QSSecondaryLabelScaleFactor` | secondary label scale | 0 |

`NOT_SET = 0` and `QS_COL_NOT_SET = 1` are the sentinels; leaving a value at its
sentinel means "do not override". Setting a column count below 1 is clamped up to
1.

### 4. Expect a screen flash

Changing any geometry key calls `SystemUtils.doubleToggleDarkMode()`, which runs
`cmd uimode night` twice through the root binder. The screen flickers. That is
the documented rebuild mechanism, not a bug — without it the panel keeps its old
geometry until the next configuration change.

This is also why `com.android.systemui` is in `R.array.root_requirement`: the
toggle needs root, and SystemUI has none of its own.

---

## Contracts

- **The QS packs need root.** `doubleToggleDarkMode` goes through
  `XPLauncher.enqueueProxyCommand`. If the binder never arrives, the rebuild never
  happens and geometry changes appear to do nothing.
- **A geometry change is not visible until the panel rebuilds.** That is what the
  dark-mode toggle is for.
- **The `getInteger` hook is deliberately short-lived.** It is installed before
  `TileGrid` and must be unhooked immediately after, or every integer read in
  SystemUI would see the override.
- **Do not expect a visual restyle from `QSTileGrid`.** It changes counts and
  scale only.
- **`ABSENT` is a stop signal.** If the audit reports the class missing, no
  preference will help.

---

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| QS row/column settings do nothing, no log | `PaginatedGridLayout` absent or inlined on this build | Run the audit; check for `ABSENT` / `INLINED` |
| Settings apply only after a reboot | The dark-mode rebuild did not run: root binder not connected | Confirm `com.android.systemui` is in `root_requirement` and the proxy connected |
| Screen flickers on every geometry change | Expected: `doubleToggleDarkMode` | None; this is the rebuild mechanism |
| Panel keeps old geometry after a change | `mIsPrefsInitiated` false, so the change never reached the pack | Check the init marker in the preference file |
| Tile labels scaled twice | The additional-instance-field guard failed | Report it; the guard is per-instance and should prevent this |
| QS panel looks nothing like Pixel after tuning | Geometry is only one of three layers | Expected; see the three-layer table above |

---

## Checklist

- [ ] Hook audit run on the actual device
- [ ] `PaginatedGridLayout` reports `PRESENT`, not `ABSENT` or `INLINED`
- [ ] Root binder connected (SystemUI is in `root_requirement`)
- [ ] Geometry keys set from the sentinel defaults
- [ ] Screen flicker accepted as the rebuild mechanism
- [ ] Expectation set: this tunes the grid, it does not restyle the panel

---

## See also

- [LineageOS setup](lineageos-setup.md)
- [Liquid Glass on LineageOS 24](liquid-glass-and-lineageos.md)
- [Mod pack lifecycle](../architecture/modpack-lifecycle.md)
- [Reflection and hooks](../architecture/reflection-and-hooks.md)
