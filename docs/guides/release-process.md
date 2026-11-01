# Release Process

How a canary and a stable release are triggered, what CI does to the repository
during a release, and the things you must never do while a release is running.

**Audience:** maintainer cutting a release, or agent asked to prepare one
**Prereqs:** [build and release architecture](../architecture/build-and-release.md),
[build locally](build-locally.md)

---

## Summary

- A release is triggered by **modifying a file**, not by running a command.
  `.github/edit2MakeNewCanary` and `.github/edit2MakeNewStable` are signals; their
  contents are not read.
- Canary releases run from `canary`. Stable releases run from `stable`. The
  `makeStableRelease.yml` copy on `canary` targets `main`, which does not exist.
- CI force-pushes tags, creates the GitHub release, then commits version bumps
  back to the branch it built from.
- A canary build takes `CANARY_VERSION_CODE + 1` and writes that number back. A
  stable build writes `STABLE_VERSION_CODE` back **unchanged**, so a stable
  version code must be bumped by hand.
- The release APK is signed with `ReleaseKey.jks` from CI secrets. Locally, the
  same build silently produces a debug-signed APK.
- Holding local commits on `canary` when a release runs guarantees a rejected
  push. Fetch and rebase before pushing.

---

## Model

### The two channels

| | Canary | Stable |
| --- | --- | --- |
| Branch | `canary` | `stable` |
| Trigger file | `.github/edit2MakeNewCanary` | `.github/edit2MakeNewStable` |
| Workflow | `makeCanaryRelease.yml` | `makeStableRelease.yml` (the `stable` branch copy) |
| Gradle command | `./gradlew buildCanary -Pchannel=canary` | `./gradlew buildStable -Pchannel=stable -PversionName=<tag>` |
| Version code | `CANARY_VERSION_CODE + 1` | `STABLE_VERSION_CODE` unchanged |
| Version name | `canary-<code>` | `v<X.Y.Z>` |
| Tag pushed | `<versionName>`, plus `canary_builds` | `v<X.Y.Z>` |
| GitHub release | `prerelease: true` | `prerelease: false` |
| Release notes source | `changeLog.md` | `StableChangelog.md` copied to `releaseNotes.md` |
| Artifact glob | `output/*.*` | `output/PixelXpertFork-*.zip` |
| Also force-pushes | `canary_builds` tag | `HEAD:refs/heads/stable` |

### The trigger-file mechanism

`makeCanaryRelease.yml` declares:

```yaml
on:
  push:
    branches:
      - 'canary'
    paths:
      - '.github/edit2MakeNewCanary'
```

`makeStableRelease.yml` on the `stable` branch declares the same shape with
`.github/edit2MakeNewStable` and branch `stable`, plus a `v*` tag push and a
`workflow_dispatch` with an optional `tag_name` input.

Consequences that surprise people:

- The file's **content is irrelevant**. `.github/edit2MakeNewCanary` currently
  contains the single line `536`; `.github/edit2MakeNewStable` contains a comment
  line. Neither is parsed by any workflow. Grep confirms it: the only two
  references to those filenames in `.github/` are the two `paths:` filters.
- Any commit that changes the file triggers a release, including a whitespace
  change or an unrelated edit that happens to touch it.
- Editing `version.properties` does **not** trigger a release. Nothing watches it.
- A release triggered this way builds whatever is on the branch at that moment.

The canary trigger file holds the previous version number as a human-readable
marker. Updating it to a new number is a convenient way to make the required
modification, but the number itself has no effect: the actual version comes from
`version.properties`.

### Version resolution at build time

`BuildUtils.getVersionCodeProvider()`:

- `channel=stable`: `STABLE_VERSION_CODE`, else `VERSION_CODE`, else `600`.
- otherwise: `CANARY_VERSION_CODE + 1`, else `VERSION_CODE + 1`, else `501`.

`BuildUtils.getVersionNameProvider()`:

- `-PversionName` if supplied (highest precedence).
- `channel=stable`: `git describe --tags --match=v* --abbrev=0 HEAD` when the
  result starts with `v` and is not `Error`; else `STABLE_VERSION_NAME`; else
  `v6.0.0`.
- otherwise: `canary-<computed code>`.

### What CI writes back

`makeCanaryRelease.yml` ends with `github-actions-x/commit@v2.9`:

```yaml
push-branch: 'canary'
commit-message: 'Version update: Release'
force-add: 'true'
rebase: 'false'
files: MagiskModBase/module.prop version.properties CanaryChangelog.md latestCanary.json MagiskModuleUpdate_Xposed.json MagiskModuleUpdate_Full.json
```

`makeStableRelease.yml` does the same for `main` on the `canary` copy, and for
`stable` on the `stable` copy, with:

```text
files: MagiskModBase/module.prop version.properties StableChangelog.md latestStable.json latestVersion.json MagiskModuleUpdate_Xposed.json MagiskModuleUpdate_Full.json
```

`rebase: 'false'` means the action commits on top of whatever it fetched. If the
branch moved between the clone at the start of the job and the push at the end,
the push is rejected and the release completes without the version bump. The
release itself has already been published by then.

### Changelog extraction

Canary release notes are assembled in two scripts.

`.github/extractCanaryChanges.sh`:

1. Deletes and recreates `changeLog.md` and `Tchangelog.htm`.
2. Reads `CANARY_VERSION_NAME` from `version.properties`.
3. If `CanaryChangelog.md` already contains a line beginning `**<versionName>**`,
   it extracts that section with `awk`, stopping at the second `**canary-`
   heading.
4. Otherwise it finds the last commit whose message contains
   `Version update: Release`, then collects every commit since then whose subject
   starts with `CHANGELOG: `, writing each as a `- ` bullet.
5. If `changeLog.md` is still empty, it writes
   `- PixelXpertFork <versionName> Canary Release`.

`.github/prepareCanaryChangelog.sh` then prepends `**<versionName>**` plus
`changeLog.md` to `CanaryChangelog.md`, unless that version heading is already
present.

The `CHANGELOG: ` commit-subject prefix is therefore the contract for getting a
change into canary release notes. A commit without it is invisible to the
fallback path. The direct-extraction path (step 3) means that editing
`CanaryChangelog.md` by hand before triggering the release is also sufficient,
and that is the path the current history uses.

### Stable has no changelog extraction step on this branch

The two channels are asymmetric, and the asymmetry is per branch. Get this right
before editing either workflow.

| | Canary (`canary` branch) | Stable (`canary` branch copy) | Stable (`stable` branch copy) |
| --- | --- | --- | --- |
| Changelog step | `extractCanaryChanges.sh` then `prepareCanaryChangelog.sh` | none | `extractStableChanges.sh <tag>` |
| Release body source | `changeLog.md` | `StableChangelog.md` copied to `releaseNotes.md` | `releaseNotes.md` written by that script |

On the `canary` branch, the stable workflow has **no** changelog-extraction step.
Its "Prepare Release Notes" step is:

```yaml
TAG="${{ steps.version_info.outputs.tag }}"
if [ -f StableChangelog.md ]; then
  cp StableChangelog.md releaseNotes.md
else
  echo "PixelXpertFork $TAG Stable Release" > releaseNotes.md
fi
```

That copies the **entire** `StableChangelog.md` into the release body. Unlike
canary, there is no extraction of just the new version's section, and there is no
`CHANGELOG: `-prefix commit convention on the stable path.

The `stable` branch carries a different copy of `makeStableRelease.yml` whose
"Prepare Release Notes" step calls `extractStableChanges.sh "<tag>"`. That script
exists **only on the `stable` branch**. It extracts the block from `**<tag>**` up
to the next `**v<digit>` heading, and falls back to copying the whole file when
the tag is absent. Do not reference that script from `canary` — it is not there.

Consequence for a maintainer working on `canary`: writing release notes for a
stable release means editing `StableChangelog.md` in full, because the file is
published verbatim.

### Tag naming

| Tag | Created by | Purpose |
| --- | --- | --- |
| `canary-<code>` | `makeCanaryRelease.yml` | One per canary build; the GitHub prerelease is attached to it |
| `canary_builds` | `makeCanaryRelease.yml` | Moving pointer to the newest canary commit |
| `v<X.Y.Z>` | `makeStableRelease.yml` | One per stable release |

Both workflows use `git tag -f` followed by `git push <url> <tag> --force`. Tags
are **force-moved**, not appended. Re-running a release for the same version
relocates the existing tag, and anyone who already fetched it holds a stale ref.

Observed tag state on `origin`: 96 tag refs, including `canary-530` through
`canary-536`, `canary_builds`, and `v6.0.0` through `v6.1.0`. The stable tag
`v6.1.0` points at a commit that is **not** an ancestor of `canary` `HEAD`;
stable and canary are separate lines of history.

### Order of operations in `makeCanaryRelease.yml`

1. `git clone --branch canary --single-branch --recurse-submodules <server>/<repo>.git .`
2. `actions/setup-java@v5`, JDK 21 temurin, Gradle cache.
3. `chmod +x gradlew`.
4. Write `ReleaseKey.properties` and decode `ReleaseKey.jks`, only if the
   `SIGNING_KEY` secret is non-empty.
5. `rm -rf output` then `./gradlew buildCanary -Pchannel=canary`.
6. `chmod +x .github/*.sh`.
7. `.github/extractCanaryChanges.sh` produces `changeLog.md`.
8. `.github/prepareCanaryChangelog.sh <run_id>` prepends to `CanaryChangelog.md`;
   then `git checkout -- gradlew .github/*.sh` discards incidental chmod changes.
9. Upload `output/` as artifact `PixelXpertFork-Canary.zip`.
10. Read `CANARY_VERSION_NAME`, `git tag -f`, force-push it, `git tag -f
    canary_builds`, force-push it.
11. `ncipollo/release-action@v1.21.0` creates the prerelease with
    `bodyFile: changeLog.md`, `allowUpdates: true`, `replacesArtifacts: false`,
    `artifacts: 'output/*.*'`.
12. `github-actions-x/commit@v2.9` commits the seven files back to `canary`.

Step 11 uses `replacesArtifacts: false`, so a re-run adds assets without removing
old ones. Step 12 runs **after** the release is published: if the commit fails,
the release exists but the branch does not record it.

### Order of operations in `makeStableRelease.yml` (the `stable` branch copy)

1. Clone `stable`.
2. JDK 21 temurin.
3. Write signing files when `SIGNING_KEY` is set.
4. Determine the version: the `workflow_dispatch` `tag_name` input, else
   `github.ref_name` when the ref is a tag, else `STABLE_VERSION_NAME` from
   `version.properties`. Strip leading `v`/`V`, then rebuild the tag as `v<version>`.
5. `rm -rf output` then `./gradlew buildStable -Pchannel=stable
   -PversionName=<tag>`.
6. Copy `StableChangelog.md` to `releaseNotes.md`.
7. Rewrite metadata: `sed` the `updateJson` URL in `MagiskModBase/module.prop`,
   set `STABLE_VERSION_NAME` in `version.properties`, and regenerate
   `latestStable.json`, `latestVersion.json`, `MagiskModuleUpdate_Xposed.json`,
   and `MagiskModuleUpdate_Full.json` with heredocs pointing at the release tag.
8. Upload `output/PixelXpertFork-*.zip`.
9. `git tag -f <tag>`, force-push the tag, and force-push
   `HEAD:refs/heads/stable`.
10. Create the GitHub release with `prerelease: false`,
    `replacesArtifacts: true`.
11. Commit the seven files back to `stable`.

Step 9 force-pushes the **branch** `stable` to the job's `HEAD`. That is a
rewrite of the remote branch, not a fast-forward merge.

---

## Walkthrough

### Cutting a canary release

1. Confirm the branch is `canary` and up to date:

   ```bash
   git fetch origin
   git status
   git log --oneline -5
   ```

2. Confirm no local commits are unpushed. CI will commit to `canary` during the
   release; unpushed local work is the thing that breaks.

3. Decide the version. `CANARY_VERSION_CODE` in `version.properties` is the
   **current** value; the build uses that value plus one.

4. Optionally write the release notes. Either:
   - add a `**canary-<next>**` heading and bullets to `CanaryChangelog.md`, which
     `extractCanaryChanges.sh` will extract verbatim, or
   - let the fallback collect commits whose subject starts with `CHANGELOG: `.

5. Modify the trigger file. Any change works:

   ```bash
   echo "537" > .github/edit2MakeNewCanary
   ```

6. Commit and push to the branch the workflow watches:

   ```bash
   git add .github/edit2MakeNewCanary
   git commit -m "canary release"
   git push fork canary
   ```

   The workflow only fires on a push to `canary` on the repository that hosts the
   workflow. Pushing to a fork runs the fork's copy of the workflow, if it is
   enabled there.

7. Watch the run. On success you get a tag `canary-<code>`, a moved
   `canary_builds` tag, a GitHub prerelease with
   `PixelXpertFork-canary-<code>.zip`, and a `Version update: Release` commit on
   `canary`.

8. Pull the write-back commit before doing anything else:

   ```bash
   git fetch origin
   git rebase origin/canary
   ```

### Cutting a stable release

1. Check out `stable`, not `canary`:

   ```bash
   git fetch origin
   git checkout stable
   git rebase origin/stable
   ```

2. Bump the stable version **by hand** in `version.properties`:

   ```properties
   STABLE_VERSION_CODE=611
   STABLE_VERSION_NAME=v6.1.1
   ```

   `incrementStableVersion` writes `STABLE_VERSION_CODE` back unchanged. If you
   do not bump it, the new release carries the previous `versionCode` and Magisk
   will not offer it as an update.

3. Add the release notes to `StableChangelog.md`. The workflow copies this file
   verbatim into the GitHub release body.

4. Modify `.github/edit2MakeNewStable`, commit, and push to `stable`. Or run the
   workflow manually with the `tag_name` input set to the tag you want.

5. Expect the workflow to force-push the `stable` branch and the `v<X.Y.Z>` tag.
   Re-fetch afterwards.

### After a release

Verify all four in this order:

```bash
git ls-remote --tags origin | grep -E 'canary-|v6\.'
curl -s https://raw.githubusercontent.com/Codecity001/PixelXpert/canary/latestCanary.json
```

| Check | Expected |
| --- | --- |
| Tag exists and points at the release commit | `git ls-remote --tags origin` |
| GitHub release has the zip asset | release page for the tag |
| Update manifest matches the release | `latestCanary.json` or `latestStable.json` version and `zipUrl` |
| `MagiskModBase/module.prop` version and `updateJson` match the channel | read the file on the branch |

---

## Contracts

| Contract | Consequence of breaking it |
| --- | --- |
| Canary builds come from `canary`; stable builds come from `stable` | The `canary` copy of `makeStableRelease.yml` names `main`, which does not exist; the job fails at clone and its URLs 404. See [R7b](../analysis/risk-register.md) |
| `STABLE_VERSION_CODE` must be bumped manually before a stable release | Magisk sees the same `versionCode` and does not offer the update |
| Commits that should appear in fallback canary notes must start with `CHANGELOG: ` | The commit is omitted from the generated notes |
| The `SIGNING_KEY`, `KEY_STORE_PASSWORD`, `ALIAS`, `KEY_PASSWORD` secrets must exist | The signing step is skipped, `ReleaseKey.properties` is never written, and the workflow builds a debug-signed APK |
| Do not touch the trigger files outside a release | Any push that modifies them starts a release |
| Do not hold unpushed local commits on the target branch during a release | `github-actions-x/commit` with `rebase: 'false'` rejects, or your push is rejected |

---

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Push rejected after a release ran | CI committed `Version update: Release` to `canary` while you held local commits | `git fetch origin && git rebase origin/canary`, then push |
| Release published but the branch has no version bump | `github-actions-x/commit` push failed; it runs after the release step | Bump and commit manually, or re-run the workflow |
| Stable workflow fails at clone with a missing branch | `makeStableRelease.yml` on `canary` targets `main`; the repository has no `main` branch | Run the workflow from the `stable` branch. See [R7b](../analysis/risk-register.md) |
| Stable update manifests point at a 404 changelog URL | The `canary` copy of the workflow bakes `raw.githubusercontent.com/<repo>/main/StableChangelog.md` into `latestStable.json` and `MagiskModuleUpdate_*.json` | Use the `stable` branch copy, which writes `.../stable/StableChangelog.md`. See [R7b](../analysis/risk-register.md) |
| `module.prop` on a stable build advertises a dead `updateJson` | The `sed` in the `canary` copy rewrites `/canary/` to `/main/`, and `/main/` 404s | Use the `stable` branch copy, which rewrites to `/stable/`. See [R7b](../analysis/risk-register.md) |
| Triggering a release by editing `version.properties` does nothing | Only the two trigger files are in `paths:` | Modify `.github/edit2MakeNewCanary` or `.github/edit2MakeNewStable` |
| Release notes are a single generic bullet | No `CHANGELOG: `-prefixed commits since the last release, and no `**canary-<version>**` heading in `CanaryChangelog.md` | Add the heading and bullets to `CanaryChangelog.md` before triggering |
| Release notes contain the wrong changes | `extractCanaryChanges.sh` found an existing `**canary-<version>**` heading and extracted that section | Correct `CanaryChangelog.md` before triggering, or edit the release body afterwards |
| APK from CI will not install over the previous version | `SIGNING_KEY` secret missing; signing step skipped; debug-signed APK shipped | Restore the secret; re-run; verify with `apksigner verify --print-certs` |
| A previously fetched tag now points somewhere else | Both workflows use `git tag -f` and `git push --force` | `git fetch --tags --force`; do not rely on old tag objects |
| `latestCanary.json` version does not match the release | `incrementCanaryVersion` ran but the write-back commit failed | Check the branch; re-run the workflow |
| Stable release has the same `versionCode` as the previous one | `STABLE_VERSION_CODE` not bumped | Bump it, re-run |
| Canary release published twice for one trigger | Two commits touching the trigger file were pushed | Only the newest matters; delete the extra release and re-trigger deliberately |

---

## Do not do this

- **Do not edit `.github/edit2MakeNewCanary` or `.github/edit2MakeNewStable` for
  any reason other than starting a release.** There is no way to make an
  unrelated change to those files. Any modification triggers a full build,
  tag push, GitHub release, and a commit back to the branch.
- **Do not run `buildCanary` or `buildStable` locally and then commit.** They
  rewrite `version.properties`, `MagiskModBase/module.prop`,
  `latestCanary.json`, and both `MagiskModuleUpdate_*.json`. CI owns those files;
  a local bump collides with the next automated bump.
- **Do not hand-edit `latestCanary.json`, `latestVersion.json`,
  `latestStable.json`, `MagiskModuleUpdate_Xposed.json`, or
  `MagiskModuleUpdate_Full.json`.** `bumpFileStandalone` rewrites `version`,
  `versionCode`, `zipUrl_Xposed`, and `zipUrl` by regex; a hand-written shape it
  cannot match is silently left alone.
- **Do not trigger a canary release from a branch other than `canary`.** The
  `paths` and `branches` filters are both required.
- **Do not assume the `canary` copy of `makeStableRelease.yml` is the one that
  runs.** It is not, and it cannot be. It targets a branch named `main` that does
  not exist on `origin` or on `fork`, force-pushes its tree to `stable`, writes
  version bumps to `push-branch: 'main'`, and bakes `.../main/...` changelog URLs
  that return 404. A stable release must be run from the `stable` branch. Full
  analysis in [R7b](../analysis/risk-register.md).
- **Do not attempt a stable release until the `main`/`stable` mismatch is
  resolved.** Even if a `main` branch were created, the published update
  manifests would point at dead URLs unless the `sed` and the heredoc URLs are
  changed too. See [R7b](../analysis/risk-register.md).
- **Do not expect canary to be affected by the above.** `makeCanaryRelease.yml`
  uses the same `git push ... HEAD:refs/heads/<branch> --force` pattern but
  correctly targets `canary`, which exists. The canary pipeline is sound.
- **Do not distribute an APK built with `assembleRelease` on a machine without
  `ReleaseKey.properties`.** It is debug-signed and nothing warned you.
- **Do not push a `v*` tag casually.** A `v*` tag push triggers
  `makeStableRelease.yml` on the `stable` branch copy.
- **Do not `git push --force` to `canary` or `stable` while a release is
  running.** The workflow force-pushes tags and, for stable, the branch itself.

---

## Checklist

- [ ] I am on the branch the workflow actually watches (`canary` or `stable`)
- [ ] `git fetch origin` is done and I hold no unpushed commits
- [ ] For stable: `STABLE_VERSION_CODE` and `STABLE_VERSION_NAME` are bumped by
      hand in `version.properties`
- [ ] `StableChangelog.md` (stable) or `CanaryChangelog.md` (canary) contains the
      notes I want published
- [ ] I modified exactly one trigger file, and nothing else in `.github/`
- [ ] I know the workflow will commit back to my branch and force-move tags
- [ ] After the run: tag, release asset, update manifest, and `module.prop` all
      agree

---

## See also

- [Build and release architecture](../architecture/build-and-release.md)
- [Build locally](build-locally.md)
- [Gradle tasks reference](../reference/gradle-tasks.md)
- [Risk register](../analysis/risk-register.md)
- [Repository map](../agent/REPO_MAP.md)
