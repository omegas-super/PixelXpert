# Fork Workflow

How this repository is kept in sync with upstream, and how work is published to
our fork. Read this before pushing anything.

**Audience:** agent or maintainer publishing to GitHub
**Prereqs:** none

---

## Summary

- `origin` is upstream (`Codecity001/PixelXpert`). We read from it and never push.
- `fork` is ours (`omegas-super/PixelXpert`). We push here.
- The working branch is `canary`.
- Upstream moves fast and its CI writes commits back to `canary`, so local
  branches must be rebased, not merged, before pushing.
- `scripts/sync-fork.sh` wraps the whole loop.

---

## Model

### Remotes

| Remote | URL | Push | Pull |
| --- | --- | --- | --- |
| `origin` | `https://github.com/Codecity001/PixelXpert` | Never | Always allowed |
| `fork` | `https://github.com/omegas-super/PixelXpert` | Yes | Rarely |

The fork was created from upstream with all branches, so every upstream branch
exists under `fork/` too.

### Why a fork rather than a branch

The fork gives us:

- A stable GitHub URL for our documentation and tooling commits
- Pull-request capability against upstream, if we ever want to contribute back
- Independence from upstream force-pushes on release tags

It does not give us a private space: the fork is public, exactly like upstream.

### Branch policy

`canary` is the integration branch and the one upstream's CI watches. Because CI
commits version bumps back to it, treat `canary` as shared and moving.

For work that spans more than a session, branch off:

```bash
git switch -c docs/agent-layer fork/canary
```

and push that branch to `fork` instead of pushing `canary` directly.

---

## Walkthrough

### First-time setup

```bash
git remote -v
# origin  https://github.com/Codecity001/PixelXpert (fetch)
# fork    https://github.com/omegas-super/PixelXpert (fetch)

# If `fork` is missing:
git remote add fork https://github.com/omegas-super/PixelXpert.git
```

Credentials come from the platform credential manager. Verify with:

```bash
git ls-remote --heads fork
```

A failure here means authentication, not networking.

### Daily loop

```bash
# 1. See where you stand
scripts/sync-fork.sh status

# 2. Get upstream changes
scripts/sync-fork.sh pull

# 3. If pull could not fast-forward, merge deliberately
scripts/sync-fork.sh merge

# 4. Do your work, commit it

# 5. Publish to the fork
scripts/sync-fork.sh push
```

`scripts/sync-fork.sh sync` runs pull, merge and push in sequence.

### Rebasing onto upstream

Preferred over merging for anything not yet pushed:

```bash
git fetch origin
git rebase origin/canary
```

Resolve conflicts, then `git rebase --continue`.

### Merging upstream into a long-lived branch

If the branch is already published to the fork, rebasing rewrites history that
others may have based on. Merge instead:

```bash
git fetch origin
git merge origin/canary
```

The merge commit is the honest record that upstream and local diverged.

---

## Contracts

These are the rules that keep the fork usable.

1. **Never push to `origin`.** It is not ours. A push will fail on permissions,
   but do not attempt it.
2. **Rebase before pushing to `canary`.** Upstream CI writes to `canary` after
   releases. A merge commit there creates noise upstream will never see.
3. **Do not force-push `canary` to the fork** unless you are deliberately
   resynchronising with upstream. Force-pushing a shared branch breaks anyone
   tracking it.
4. **Force-push release tags only through the release workflow.** The CI already
   does `git tag -f` and force-pushes the version tag and `canary_builds`. Doing
   it by hand races the workflow.
5. **Keep our commits additive.** Documentation and tooling should not modify
   files that upstream CI rewrites (`version.properties`, `MagiskModBase/module.prop`,
   the update manifests, the changelogs). Editing those guarantees a conflict on
   every sync.

---

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `! [rejected] canary -> canary (fetch first)` | Upstream CI pushed a version bump after your last fetch | `git fetch fork && git rebase fork/canary` then push |
| `! [rejected] ... (non-fast-forward)` | Local history diverged from fork | Fetch, then rebase or merge deliberately |
| `fatal: Authentication failed` | Credential manager has no valid token | Re-authenticate; check `git ls-remote --heads fork` |
| `error: remote origin already exists` | Remote added twice | `git remote set-url origin <url>` |
| Merge conflicts in `version.properties` | Upstream CI owns that file | Take upstream's version, reapply nothing; never hand-edit it |
| Sync script reports `no fork/canary ref` | Fork never fetched | `git fetch fork` |
| `exit code 3` from `scripts/sync-fork.sh merge` | Real merge conflicts | Resolve the listed files, `git add`, `git commit` |

---

## Checklist

Before pushing:

- [ ] `scripts/sync-fork.sh status` shows no unexpected divergence
- [ ] I am on the branch I intend to push
- [ ] I have not modified upstream-CI-owned files
- [ ] `node scripts/check-docs.mjs` passes if I touched documentation
- [ ] I am pushing to `fork`, not `origin`

After pushing:

- [ ] The fork branch shows the commit on GitHub
- [ ] The Docs Check workflow passes, if documentation changed

---

## See also

- [Release process](release-process.md)
- [Build locally](build-locally.md)
- [Risk register](../analysis/risk-register.md)
