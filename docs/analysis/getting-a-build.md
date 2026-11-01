# Getting a Flashable Build

Three ways to produce a PixelXpert APK and Magisk zip when this checkout has no
toolchain, ranked by effort. Read this before asking for a build or trying to run
`./gradlew`.

**Audience:** user or agent who needs an installable artifact
**Prereqs:** [build locally](../guides/build-locally.md), [release process](../guides/release-process.md)

**Status:** 2026-11-01. Toolchain state verified on this machine. CI paths read
from `.github/workflows/`.

---

## Summary

- **A build cannot be produced in this checkout.** There is no JDK, no Android
  SDK, and no Gradle cache. `java -version` fails. `app/build/` does not exist,
  which means nothing has ever been compiled here.
- The source is complete and the Gradle wrapper is present. The missing pieces are
  a JDK 21, Android SDK platform 37, and roughly 2 GB of dependency downloads.
- **The cheapest correct path is CI**, because the repository already contains
  four workflows that build and package the module.
- Two of those workflows are hardcoded to clone
  `https://github.com/Codecity001/PixelXpert.git` and ignore the repository they
  run in. **They will build upstream, not your fork.** This is the single most
  likely way to spend an hour and get the wrong APK.
- No source change is required to test LineageOS compatibility. The module already
  contains the audit tooling that reports what resolves on a given device.

---

## Model

### Why there is no artifact here

| Requirement | State on this machine |
| --- | --- |
| JDK 21 | absent — `java` is not on `PATH` |
| `JAVA_HOME` | unset |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | unset |
| Android SDK (platform 37, build-tools) | absent |
| Gradle cache (`~/.gradle/caches`) | absent |
| `app/build/` | absent — never built |
| Network | available |
| Free disk | 89 GB |

Everything except the toolchain is in place. The build itself is a normal Gradle
build; nothing about the source is broken.

### What the build would produce

| Task | Output | Path |
| --- | --- | --- |
| `assembleDebug` | debug APK | `app/build/outputs/apk/debug/PixelXpert.apk` |
| `assembleRelease` | release APK | `app/build/outputs/apk/release/PixelXpert.apk` |
| `buildCanary` | APK + Magisk zip, mutates version files | `output/PixelXpertFork-<version>.zip` |
| `buildStable` | same, stable channel | `output/PixelXpertFork-<version>.zip` |

`buildCanary` and `buildStable` write to `version.properties` and the JSON update
manifests. Do not run them on a branch you intend to commit from unless you mean
to bump the version.

### The CI trap: two workflows ignore your fork

Read from `.github/workflows/`:

| Workflow | Trigger | Clones | Builds your fork? |
| --- | --- | --- | --- |
| `xposedPackageTestBuild.yml` | `workflow_dispatch` | `Codecity001/PixelXpert.git` (hardcoded) | **No** |
| `fullPackageTestBuild.yml` | `workflow_dispatch` | `Codecity001/PixelXpert.git` (hardcoded) | **No** |
| `makeCanaryTestPackage.yml` | `workflow_dispatch` | `${{ github.repository }}` | Yes |
| `makeCanaryRelease.yml` | push to `canary` touching a trigger file | `${{ github.repository }}` | Yes |
| `makeStableRelease.yml` | push to `main` touching a trigger file | `${{ github.repository }}` | Yes |

The first two run `git clone` against the upstream URL, so they produce an
upstream build regardless of which repository you dispatch them from. If your goal
is to test *your* branch, use `makeCanaryTestPackage.yml`.

`makeCanaryTestPackage.yml` is also the safest of the building workflows: it runs
`./gradlew buildCanary -Pchannel=canary` on `ubuntu-latest` with Temurin 21, and
uploads artifacts rather than publishing a release.

---

## Walkthrough

### Path A — CI on your fork (recommended)

Use this if you want a build without installing anything. Roughly 15 minutes of
wall time, mostly queueing.

1. Push your branch to your fork (`fork` remote, per `AGENTS.md`).
2. Open the fork on GitHub.
3. Go to **Actions** → **Make Canary Test Package**.
4. **Run workflow**, selecting your branch.
5. Wait for the run to finish.
6. Download the artifact from the run summary.

**Before you run it, check the checkout step.** If the workflow file in your fork
still reads:

```yaml
- run: git clone -b ${GITHUB_REF_NAME} --recurse-submodules https://github.com/Codecity001/PixelXpert.git .
```

then it will build upstream, not you. Change that line to use
`${{ github.server_url }}/${{ github.repository }}.git`, matching what
`makeCanaryTestPackage.yml` already does. That is a one-line edit to a file under
`.github/`, which is a change you should make deliberately and review, not by
accident.

**Signing:** the workflows sign only when the `SIGNING_KEY` secret is set. Without
it you get an unsigned or debug-signed APK. For LSPosed testing an unsigned build
is usually not installable without re-signing, so either add the secrets or sign
locally afterwards.

### Path B — local build (full control, ~2 GB of downloads)

Use this if you want to iterate. Requires installing a toolchain.

1. Install JDK 21 (Temurin). Verify with `java -version`.
2. Install Android SDK command-line tools, then platform 37 and a recent
   build-tools.
3. Set `JAVA_HOME` and `ANDROID_HOME`, or write `local.properties` with
   `sdk.dir=...`.
4. From the repo root:

```bash
./gradlew assembleDebug
```

5. The APK lands at `app/build/outputs/apk/debug/PixelXpert.apk`.

For a flashable Magisk zip, use `./gradlew buildCanary` and take
`output/PixelXpertFork-<version>.zip` — but note it mutates version files.

The first build downloads Gradle 9.3.1 and every dependency. Expect 10–30 minutes
and roughly 2 GB.

### Path C — do not build at all

This is worth stating because it is often correct. **You do not need a custom
build to test LineageOS compatibility.** The module already ships the tooling:

- `HookTester` answers `ACTION_CHECK_XPOSED_ENABLED`, so the Hooks page tells you
  which processes the module is inside.
- `HookAuditor` answers `ACTION_REQUEST_HOOK_AUDIT` with a JSON report of
  `PRESENT` / `ABSENT` / `INLINED` per class and method.

Install any existing PixelXpert release, run the audit on the LineageOS device,
and you have the compatibility answer. A rebuild only becomes necessary when you
want to *change* behaviour, not to *measure* it.

---

## Contracts

- **Do not claim a build exists until `app/build/outputs/apk/` contains an APK.**
  An unverified claim of a working zip is worse than no zip.
- **Do not run `buildCanary` or `buildStable` casually.** They write
  `version.properties` and the update manifests.
- **Check the clone URL before trusting a CI artifact.** Two workflows ignore your
  fork.
- **A release build without `ReleaseKey.properties` falls back to the debug
  signing config** — `app/build.gradle.kts` catches the failure and continues. An
  APK that installs but cannot update over the previous install is usually this.
- **`abiFilters` is `arm64-v8a` only.** A 32-bit or x86 device cannot load the
  native parts.

---

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `java: command not found` / `CommandNotFoundException` | No JDK | Install JDK 21; set `JAVA_HOME` |
| `SDK location not found` | No `ANDROID_HOME` and no `local.properties` | Set one of them |
| Gradle download stalls on first run | No network, or a proxy | First build needs `services.gradle.org` |
| CI artifact behaves like stock PixelXpert | Workflow cloned `Codecity001/PixelXpert.git` | Use `makeCanaryTestPackage.yml`, or fix the clone URL |
| APK installs but will not update over the old one | Release build fell back to debug signing | Provide `ReleaseKey.properties` |
| Installs but the module never loads | libxposed API below 102, or not scoped | Use current LSPosed; check the Hooks page |
| `INSTALL_FAILED_NO_MATCHING_ABIS` | Device is not arm64-v8a | Expected; the module ships arm64 only |
| Build succeeds, zip missing | Ran `assembleDebug`, which does not zip | Use `buildCanary` for the Magisk zip |

---

## Checklist

Before reporting a build as working:

- [ ] The APK file exists at a real path and has a non-zero size
- [ ] The workflow (if CI) cloned your repository, not upstream
- [ ] The APK is signed with a key the device accepts
- [ ] The device is arm64-v8a
- [ ] The module appears in LSPosed and the Hooks page reports it
- [ ] The hook audit has been run on the actual ROM
- [ ] If you did not build it yourself, say so

---

## See also

- [Build locally](../guides/build-locally.md)
- [Release process](../guides/release-process.md)
- [LineageOS setup](lineageos-setup.md)
- [Pixel-style QS panel](pixel-qs-panel-on-lineageos.md)
