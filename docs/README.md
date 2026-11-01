# PixelXpert Documentation

The documentation tree for PixelXpert. Every document here is written to be
usable by both an AI agent with no prior context and a human contributor on
their first day.

Start with [AGENTS.md](../AGENTS.md) if you are an agent. Start with
[QUICKSTART](agent/QUICKSTART.md) if you are a person.

---

## How this tree is organised

| Directory | Answers | Stability |
| --- | --- | --- |
| [agent/](agent/) | How do I orient myself, and what are the rules? | Stable |
| [architecture/](architecture/) | How does the system work? | Stable |
| [guides/](guides/) | How do I perform a specific task? | Tracks tooling |
| [reference/](reference/) | What is the exact value of X? | Regenerated from source |
| [analysis/](analysis/) | What is the current state and risk? | Dated, ages |

The rules for writing in this tree are in
[agent/DOC_STYLE.md](agent/DOC_STYLE.md). They are enforced by
`node scripts/check-docs.mjs`.

---

## Start here

| Document | What it gives you | Read time |
| --- | --- | --- |
| [agent/QUICKSTART.md](agent/QUICKSTART.md) | Orientation and the three silent-failure traps | 15 min |
| [agent/REPO_MAP.md](agent/REPO_MAP.md) | Every directory and what lives in it | 10 min |
| [architecture/overview.md](architecture/overview.md) | The two-process model and the invariants | 15 min |

---

## Agent material

| Document | Contents |
| --- | --- |
| [agent/DOC_STYLE.md](agent/DOC_STYLE.md) | The documentation style contract; mandatory for anyone writing docs |
| [agent/REPO_MAP.md](agent/REPO_MAP.md) | Annotated directory map, including which package owns which concern |
| [agent/QUICKSTART.md](agent/QUICKSTART.md) | Fast orientation, failure traps, first-change checklist |

---

## Architecture

How the system works, subsystem by subsystem.

| Document | Contents |
| --- | --- |
| [architecture/overview.md](architecture/overview.md) | The two-process model, the preference seam, the mod pack abstraction, hook ownership |
| [architecture/xposed-runtime.md](architecture/xposed-runtime.md) | `XPLauncher` entry sequence, `XposedRuntime` vs `XposedGeneration`, process targeting, root proxy |
| [architecture/modpack-lifecycle.md](architecture/modpack-lifecycle.md) | Discovery by KSP, construction, invocation, unload; the generated registry contract |
| [architecture/reflection-and-hooks.md](architecture/reflection-and-hooks.md) | The `ReflectedClass` DSL, hook ids and priorities, `invokeOriginal`, bootloop protection |
| [architecture/hot-reload.md](architecture/hot-reload.md) | The generation model, save/restore contract, ordering guarantees |
| [architecture/preferences-and-ipc.md](architecture/preferences-and-ipc.md) | RemotePreferences, broadcast contracts, the root binder |
| [architecture/preferences-system.md](architecture/preferences-system.md) | The declarative preference model end to end, app side to hooked side |
| [architecture/app-ui.md](architecture/app-ui.md) | Compose structure, Navigation 3, theme, screen registry |
| [architecture/build-and-release.md](architecture/build-and-release.md) | Module graph, variants, versioning, signing, Magisk packaging, pipelines |

---

## Guides

Task-oriented procedures. Each one states what breaks if you skip a step.

| Document | Task |
| --- | --- |
| [guides/add-a-mod-pack.md](guides/add-a-mod-pack.md) | Add a feature that hooks a target process |
| [guides/add-a-preference.md](guides/add-a-preference.md) | Add a user-visible setting, on both sides of the process boundary |
| [guides/build-locally.md](guides/build-locally.md) | Set up a toolchain and build the APK |
| [guides/release-process.md](guides/release-process.md) | Cut a canary or stable release |
| [guides/fork-workflow.md](guides/fork-workflow.md) | Sync with upstream and publish to the fork |

---

## Reference

Lookup tables, regenerated from source.

| Document | Contents |
| --- | --- |
| [reference/modpack-catalog.md](reference/modpack-catalog.md) | Every mod pack: class, annotation, target package, priority, purpose |
| [reference/preference-keys.md](reference/preference-keys.md) | Every preference key: type, default, owning screen, which pack reads it |
| [reference/packages-and-constants.md](reference/packages-and-constants.md) | Scoped packages, broadcast actions, intent extras, file paths |
| [reference/gradle-tasks.md](reference/gradle-tasks.md) | Every custom Gradle task and its side effects |

Machine-readable companions live in
[`reference/data/`](reference/data/). They are the contract for harness
integrations; the Markdown is the human view. Keep both in sync in the same
commit.

---

## Analysis

Dated assessments. These describe a moment in time and are expected to age.

| Document | Contents |
| --- | --- |
| [analysis/risk-register.md](analysis/risk-register.md) | Known hazards in the codebase, ranked, with detection and mitigation |
| [analysis/agent-readiness.md](analysis/agent-readiness.md) | What an autonomous agent can and cannot do here, and why |
| [analysis/liquid-glass-and-lineageos.md](analysis/liquid-glass-and-lineageos.md) | Research: iOS-style glass effects on LineageOS 24 / Android 17, `AndroidLiquidGlassView` internals, and the packaging blockers that matter more than the renderer |

---

## Conventions

- Paths in prose are repo-relative and backticked:
  `app/src/main/java/sh/siava/pixelxpert/xposed/XPLauncher.kt`
- Links between docs are relative: `[overview](architecture/overview.md)`
- Symbols are named rather than line-numbered, because line numbers rot
- Every document ends with a **See also** section

---

## Keeping this tree honest

```bash
node scripts/check-docs.mjs
```

Verifies that internal links resolve, that every referenced source path exists,
that JSON companions parse, and that no document is orphaned from this index.
Run it before committing documentation. CI runs it on every push.

When a document goes stale because the code moved, fix it in the same commit as
the code change. A wrong document is worse than no document.
