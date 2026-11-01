# Documentation Style Contract

This file is the single source of truth for **how** documentation in this repo is
written. Every human or agent authoring a file under `docs/` or `AGENTS.md` must
follow it. Reviewers reject PRs that do not.

The goal is not "documentation exists". The goal is that a fresh agent with no
memory of this repository can read one file and act correctly, and that a
harness can machine-parse the rest.

---

## 1. Audience model

Write for three readers at once, in this priority order:

| Priority | Reader | What they need |
| --- | --- | --- |
| 1 | **An LLM agent** with no prior context, working from a fresh clone | Exact file paths, exact symbol names, ordered steps, failure modes, "do not do this" rules |
| 2 | **A new human contributor** | The same facts, but with the *why* made explicit |
| 3 | **A maintainer under time pressure** | Scannable structure, tables, grep-able headings |

Never write for a reader who already knows the answer. If a sentence only makes
sense to someone who has already read the source, rewrite it or cut it.

---

## 2. Non-negotiable rules

1. **Facts over adjectives.** "Calls `XPrefs.Xprefs.getBoolean` on every
   `onPreferenceUpdated`" beats "efficiently manages preferences".
2. **Every claim must be checkable.** If you state that a class does something,
   you must have read that class in this session. No inference from file names.
3. **Absolute repo-relative paths.** Write `app/src/main/java/sh/siava/pixelxpert/xposed/XPLauncher.kt`,
   never "the launcher file". Inside a `docs/` file, use paths relative to the
   repo root so a reader can copy-paste them.
4. **Line anchors only when stable.** `path.kt:120` is allowed for a single
   critical line; prefer naming the symbol (`XPLauncher.onXPrefsReady`) because
   line numbers rot.
5. **No emoji** in `docs/` prose, headings, or tables. Icons belong in the app,
   not in the manual. (Badges in `README.md` are pre-existing and exempt.)
6. **No marketing tone.** Ban: "powerful", "seamless", "cutting-edge",
   "revolutionary", "robust solution". State the mechanism instead.
7. **Present tense, active voice.** "The processor emits `ModPacks.kt`", not
   "`ModPacks.kt` will have been emitted".
8. **One idea per paragraph.** Max ~5 sentences. If a paragraph needs a list,
   make it a list.
9. **Show the failure.** Every guide must include what breaks, what the error
   looks like, and how to recover. Documentation that only describes the happy
   path is incomplete.
10. **No orphan files.** Every file you create must be linked from
    `docs/README.md` (the index) and, if it is a starting point, from
    `AGENTS.md`.

---

## 3. Voice

- Second person for instructions ("run", "check", "do not edit").
- Third person for architecture ("`XPLauncher` installs two context hooks").
- Imperative for rules ("Never call `XPrefs.release()` from a hook body").
- No first person plural ("we", "our"). The repo is not a team diary.

Sentence shape: subject, verb, object. Short. If a sentence has more than two
commas, split it.

---

## 4. File structure

### 4.1 Front matter

Every file under `docs/` starts with a level-1 heading and a one-paragraph
"what this answers" block, before any other content:

```markdown
# Mod Pack Lifecycle

How a mod pack class gets discovered, constructed, hooked, hot-reloaded, and
unloaded. Read this before adding a new pack.

**Audience:** agent adding or debugging a pack
**Prereqs:** `docs/architecture/overview.md`, `docs/reference/modpack-catalog.md`
```

### 4.2 Body sections

Use these headings, in this order, when they apply:

| Heading | Contents |
| --- | --- |
| `## Summary` | 3-6 bullet facts. The whole file compressed. |
| `## Model` | The mental model, data structures, ownership |
| `## Walkthrough` | Ordered steps with file paths |
| `## Contracts` | What callers must do, what they must not do |
| `## Failure modes` | Symptom, cause, fix — as a table |
| `## Checklist` | Actionable boxes for the reader |

Omit sections that do not apply. Do not invent new top-level sections without a
reason; consistency is what makes the tree navigable.

### 4.3 Tables

Use tables for anything with 3+ parallel facts: files, symbols, failure modes,
preference keys, compatibility matrices. Keep cells short — no full sentences
with periods unless the table is a prose table.

### 4.4 Code blocks

- Always tag the language: ` ```kotlin `, ` ```bash `, ` ```text `, ` ```yaml `.
- Snippets must be **copied from the repo or runnable as written**. Never
  invent an API signature.
- Prefer a 5-line excerpt with `// ...` over a 40-line paste.
- Show `text` blocks for directory trees, log output, and error messages.

---

## 5. Directory layout

```
docs/
├── README.md                  # index — every doc reachable from here
├── agent/
│   ├── DOC_STYLE.md           # this file
│   ├── REPO_MAP.md            # every directory, what lives there
│   └── QUICKSTART.md          # 15-minute orientation
├── architecture/              # how the system works, subsystem by subsystem
├── guides/                    # task-oriented: do X, step by step
├── reference/                 # lookup tables: keys, packages, commands
└── analysis/                  # deep dives, risk registers, audits
```

Rules:

- **architecture/** answers "how does it work". It is descriptive and stable.
- **guides/** answers "how do I do X". It is procedural and changes with
  tooling.
- **reference/** answers "what is the value of X". It is tabular and exhaustive.
- **analysis/** answers "what is the state of X". It is dated and may age.
- Never duplicate: a guide links to architecture, it does not re-explain it.

---

## 6. Cross-linking

- Link with repo-relative paths: `[overview](../architecture/overview.md)`.
- Link to code with backticked full paths:
  `app/src/main/java/sh/siava/pixelxpert/xposed/XposedRuntime.kt`.
- Every doc ends with a **See also** section listing 2-5 sibling docs.
- No link may 404. `scripts/check-docs.mjs` enforces this; run it before
  committing.

---

## 7. Machine-readable companions

Where a doc contains a lookup table that tooling could consume, also emit the
data as JSON under `docs/reference/data/`. Keep the Markdown and JSON in sync in
the same commit. The JSON files are the contract for harness integrations; the
Markdown is the human view.

---

## 8. Length budget

| File | Target | Hard ceiling |
| --- | --- | --- |
| `AGENTS.md` | 150 lines | 250 lines |
| `docs/agent/*` | 200 lines | 400 lines |
| `docs/architecture/*` | 300 lines | 600 lines |
| `docs/guides/*` | 250 lines | 500 lines |
| `docs/reference/*` | 400 lines | 900 lines (tables may run long) |
| `docs/analysis/*` | 300 lines | 600 lines |

If you exceed the ceiling, split the file and link it. A 1000-line doc is a
search problem, not documentation.

---

## 9. Review checklist

Before committing any doc:

- [ ] Every file path mentioned exists (`scripts/check-docs.mjs` verifies this)
- [ ] Every symbol mentioned was read in the source, not guessed
- [ ] No emoji, no marketing words, no first person plural
- [ ] At least one failure mode or "do not" rule per procedural doc
- [ ] Linked from `docs/README.md`
- [ ] Tables render (no unescaped `|` inside cells)
- [ ] Under the length ceiling
- [ ] JSON companions regenerated if a table changed

---

## See also

- [Repository map](REPO_MAP.md)
- [Quickstart](QUICKSTART.md)
- [Docs index](../README.md)
