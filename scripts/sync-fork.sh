#!/usr/bin/env bash
#
# sync-fork.sh - keep the fork (omegas-super/PixelXpert) in step with upstream
# (Codecity001/PixelXpert), and publish local work to the fork.
#
# The fork exists so we get real GitHub sync: we push our documentation and
# tooling to `fork`, and we merge upstream changes from `origin` on demand.
#
# Usage:
#   scripts/sync-fork.sh status          show divergence between local/origin/fork
#   scripts/sync-fork.sh pull            fetch both remotes and fast-forward local
#   scripts/sync-fork.sh merge           merge upstream into the current branch
#   scripts/sync-fork.sh push            push current branch to fork
#   scripts/sync-fork.sh sync            pull + merge + push (the usual command)
#
# Exit codes: 0 ok, 1 error, 2 usage, 3 conflict requiring manual resolution.
#
set -euo pipefail

UPSTREAM_REMOTE="origin"
FORK_REMOTE="fork"
UPSTREAM_URL="https://github.com/Codecity001/PixelXpert"
FORK_URL="https://github.com/omegas-super/PixelXpert"
MAIN_BRANCH="canary"

c_reset=$'\033[0m'; c_red=$'\033[31m'; c_green=$'\033[32m'
c_yellow=$'\033[33m'; c_blue=$'\033[34m'; c_dim=$'\033[2m'

info()  { printf '%s==>%s %s\n' "$c_blue" "$c_reset" "$*"; }
ok()    { printf '%s  ok%s %s\n' "$c_green" "$c_reset" "$*"; }
warn()  { printf '%s  !!%s %s\n' "$c_yellow" "$c_reset" "$*"; }
die()   { printf '%s  xx%s %s\n' "$c_red" "$c_reset" "$*" >&2; exit 1; }

repo_root() {
	git rev-parse --show-toplevel 2>/dev/null || die "not inside a git repository"
}

ensure_remotes() {
	local root; root="$(repo_root)"
	cd "$root"

	if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
		info "adding upstream remote '$UPSTREAM_REMOTE'"
		git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
	fi
	if ! git remote get-url "$FORK_REMOTE" >/dev/null 2>&1; then
		info "adding fork remote '$FORK_REMOTE'"
		git remote add "$FORK_REMOTE" "$FORK_URL"
	fi
}

current_branch() {
	git rev-parse --abbrev-ref HEAD
}

require_clean_tree() {
	if [[ -n "$(git status --porcelain)" ]]; then
		warn "working tree is dirty:"
		git status --short
		die "commit or stash your work before running this command"
	fi
}

cmd_status() {
	ensure_remotes
	local branch; branch="$(current_branch)"
	printf '%s branch:%s %s\n' "$c_dim" "$c_reset" "$branch"
	printf '%s upstream:%s %s\n' "$c_dim" "$c_reset" "$(git remote get-url "$UPSTREAM_REMOTE")"
	printf '%s fork:%s     %s\n' "$c_dim" "$c_reset" "$(git remote get-url "$FORK_REMOTE")"
	echo

	if git rev-parse --verify --quiet "$UPSTREAM_REMOTE/$branch" >/dev/null; then
		read -r behind ahead <<<"$(git rev-list --left-right --count "$UPSTREAM_REMOTE/$branch"...HEAD)"
		printf 'vs upstream/%s : %s behind, %s ahead\n' "$branch" "$behind" "$ahead"
	else
		warn "no $UPSTREAM_REMOTE/$branch ref (run: git fetch $UPSTREAM_REMOTE)"
	fi

	if git rev-parse --verify --quiet "$FORK_REMOTE/$branch" >/dev/null; then
		read -r behind ahead <<<"$(git rev-list --left-right --count "$FORK_REMOTE/$branch"...HEAD)"
		printf 'vs fork/%s     : %s behind, %s ahead\n' "$branch" "$behind" "$ahead"
	else
		warn "no $FORK_REMOTE/$branch ref (run: git fetch $FORK_REMOTE)"
	fi
}

cmd_pull() {
	ensure_remotes
	local branch; branch="$(current_branch)"
	info "fetching $UPSTREAM_REMOTE and $FORK_REMOTE"
	git fetch "$UPSTREAM_REMOTE" --prune
	git fetch "$FORK_REMOTE" --prune
	ok "fetched"

	if git rev-parse --verify --quiet "$UPSTREAM_REMOTE/$branch" >/dev/null; then
		if git merge-base --is-ancestor HEAD "$UPSTREAM_REMOTE/$branch"; then
			info "fast-forwarding $branch to $UPSTREAM_REMOTE/$branch"
			git merge --ff-only "$UPSTREAM_REMOTE/$branch"
			ok "fast-forwarded"
		else
			warn "cannot fast-forward: local has commits upstream does not"
			warn "use 'scripts/sync-fork.sh merge' to merge instead"
		fi
	fi
}

cmd_merge() {
	ensure_remotes
	local branch; branch="$(current_branch)"
	require_clean_tree
	info "merging $UPSTREAM_REMOTE/$branch into $branch"
	git fetch "$UPSTREAM_REMOTE" --prune

	if ! git rev-parse --verify --quiet "$UPSTREAM_REMOTE/$branch" >/dev/null; then
		die "no such ref: $UPSTREAM_REMOTE/$branch"
	fi

	if git merge-base --is-ancestor "$UPSTREAM_REMOTE/$branch" HEAD; then
		ok "already up to date"
		return 0
	fi

	if git merge --no-edit "$UPSTREAM_REMOTE/$branch"; then
		ok "merged cleanly"
	else
		warn "merge conflicts in:"
		git diff --name-only --diff-filter=U | sed 's/^/      /'
		echo
		warn "resolve them, then: git add <files> && git commit"
		exit 3
	fi
}

cmd_push() {
	ensure_remotes
	local branch; branch="$(current_branch)"
	info "pushing $branch to $FORK_REMOTE"
	git push "$FORK_REMOTE" "$branch"
	ok "pushed to $FORK_REMOTE/$branch"
}

cmd_sync() {
	cmd_pull
	cmd_merge
	cmd_push
}

usage() {
	cat <<EOF
sync-fork.sh - keep the fork in step with upstream, and publish to the fork

  status   show divergence between local, upstream and fork
  pull     fetch both remotes and fast-forward local where possible
  merge    merge upstream into the current branch
  push     push the current branch to the fork
  sync     pull + merge + push

Remotes:
  $UPSTREAM_REMOTE -> $UPSTREAM_URL
  $FORK_REMOTE     -> $FORK_URL
Branch: $MAIN_BRANCH
EOF
}

main() {
	[[ $# -ge 1 ]] || { usage; exit 2; }
	case "$1" in
		status) cmd_status ;;
		pull)   cmd_pull ;;
		merge)  cmd_merge ;;
		push)   cmd_push ;;
		sync)   cmd_sync ;;
		-h|--help|help) usage ;;
		*) usage; exit 2 ;;
	esac
}

main "$@"
