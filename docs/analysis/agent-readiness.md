# Agent Readiness

What an autonomous agent can and cannot do in this repository, and why. This is
an assessment of the repo's suitability for agentic work, not a guide.

**Audience:** harness authors, maintainers evaluating agent workflows
**Prereqs:** [risk register](risk-register.md)

**Status:** point-in-time assessment of branch `canary` at commit `b6b0f8df`.

---

## Summary

- The repo is **readable** by an agent: Kotlin is statically typed, the layout is
  conventional, and the KDoc is unusually good for a hobby-adjacent Android
  module.
- The repo is **not locally verifiable** by an agent in this checkout: no JDK, no
  Android SDK, no tests.
- The risk with the widest impact is that the most common failure mode — a feature that
  compiles and does nothing — produces no signal an agent can observe.
- What closes the gap is documentation that encodes the contracts, plus tooling
  that mechanically checks the two things that break silently.

---

## Capability matrix

| Activity | Feasible now | Blocker |
| --- | --- | --- |
| Read and understand the codebase | Yes | None |
| Locate the code for a named feature | Yes | Use [modpack-catalog](../reference/modpack-catalog.md) |
| Add a mod pack | Yes, unverified | Cannot compile; cannot confirm registry emission |
| Add a preference | Yes, unverified | Cannot confirm key match without discipline |
| Refactor within one package | Yes, unverified | No compiler, no tests |
| Fix a bug with a clear stack trace | Partly | Cannot reproduce; exceptions are swallowed |
| Diagnose "feature does nothing" | Partly | Needs the contracts; no runtime signal |
| Verify a change works | No | No toolchain, no tests, no device |
| Build a release | No | No toolchain; signing config absent |
| Run CI | No | Requires GitHub Actions |

---

## Why this repo is above average for agents

**Strong KDoc.** Several core files carry comments that explain *why*, not *what*.
Examples that materially help an agent:

- `XposedModPack` explains that `extends Logger` exists to put a bare `log(...)`
  in scope inside every pack.
- `XPLauncher` opens with the full four-step entry sequence, then repeats it per
  method.
- `BootLoopProtector` explains why `commit()` is used instead of `apply()`.
- `XPrefs` explains why `lateinit` is preferable to a nullable field, and why the
  defensive null check was deleted from packs.
- `XposedGeneration` explains why a hot reload retires rather than mutates.

An agent that reads these files gets the design intent for free. That is rare.

**Conventional structure.** Package-by-feature under `xposed/modpacks/`, package
by concern elsewhere. A new agent can guess where things are and be right most of
the time.

**One bridge.** All hooking goes through `XposedRuntime`. There is no legacy
`XposedBridge` compatibility layer and no second hook engine, so there is one
place to understand rather than two.

**Bounded blast radius per feature.** A pack is a class. Adding one does not
require touching a central registry, because the KSP processor generates it.

---

## Why this repo is hard for agents

**No feedback loop.** Without a compiler, an agent writing Kotlin is writing
prose. Syntax errors, unresolved references and type mismatches are all invisible.
Every change is a hypothesis.

**Silent failure is the default.** The two most common mistakes — wrong
annotation, wrong preference key — produce no error. An agent that trusts "it
compiled" will ship dead code.

**Swallowed exceptions.** 161 empty catch blocks under `xposed/`. Even on a
device, a broken hook often leaves no trace.

**Cross-process contracts are stringly typed.** The preference seam is a shared
string namespace with no schema. Static analysis cannot validate it.

**Firmware coupling.** Hooks target specific AOSP/Pixel builds. A method that
exists on Android 16 QPR1 may not exist on QPR2. The code handles this with
`ReflectedClass` resolution failures, but an agent has no way to know which
firmware a change is valid for without reading the compatibility notes.

**Directory does not encode target.** `modpacks/systemui/IconPacks.kt` is
`@SettingsModPack`. An agent reasoning from paths will be wrong.

---

## What this documentation layer adds

The gap this tree closes is *contracts as documentation*, plus mechanical checks
for the parts that can be checked.

| Problem | Mitigation in this tree |
| --- | --- |
| Silent preference drift | [preference-keys](../reference/preference-keys.md) lists every key with its reader |
| Silent registry omission | [modpack-lifecycle](../architecture/modpack-lifecycle.md) documents the generated table and how to inspect it |
| Directory/target confusion | [REPO_MAP](../agent/REPO_MAP.md) states the rule and gives the counter-examples |
| No orientation | [QUICKSTART](../agent/QUICKSTART.md) compresses it to 15 minutes |
| Unknown toolchain state | [AGENTS.md](../../AGENTS.md) states the toolchain gap explicitly |
| Stale docs | `scripts/check-docs.mjs` fails on broken links, missing paths, orphan docs, invalid JSON |
| Unclear hazards | [risk-register](risk-register.md) ranks them with detection methods |

---

## Recommended next investments

Ordered by impact per unit of effort. None are done yet.

1. **A registry assertion in CI.** After `assembleDebug`, parse the generated
   `ModPacks.kt` and assert every annotated class appears. Catches R2
   mechanically.
2. **A preference key linter.** Extract keys from `ui/` and from `xposed/`, and
   report keys read but never written, and written but never read. Catches R1
   mechanically. This is a grep-shaped problem, not a compiler problem.
3. **Unit tests for `:modPackProcessor`.** It is pure Kotlin with no Android
   dependency. It decides which packs run. It is the only genuinely testable
   component, and it is also the one with the widest impact.
4. **A signing guard.** Fail a release workflow when `ReleaseKey.properties` is
   absent. Closes R3.
5. **A device smoke script.** Install, toggle one known feature, read logcat for
   the load line. Turns "unverified" into "verified on one path".

---

## Working agreement for agents in this repo

1. Read [QUICKSTART](../agent/QUICKSTART.md) before writing code. It takes
   fifteen minutes and prevents the three most common failures.
2. State verification honestly. "Written, not compiled" is the correct report in
   this checkout.
3. When you cannot verify, reduce the surface: make the smallest change that
   could work, and name the assumptions you could not check.
4. Prefer adding a log line over adding a silent catch.
5. If you discover a contract that is not documented, document it in the same
   commit.

---

## Checklist

- [ ] I have stated whether my change was compiled or only written
- [ ] I have named the assumptions I could not verify
- [ ] I have checked both sides of any preference key I touched
- [ ] I have confirmed any new pack appears in the generated registry, or said
      that I could not
- [ ] I have not claimed runtime behaviour I did not observe

---

## See also

- [Risk register](risk-register.md)
- [Quickstart](../agent/QUICKSTART.md)
- [Documentation style](../agent/DOC_STYLE.md)
- [Architecture overview](../architecture/overview.md)
