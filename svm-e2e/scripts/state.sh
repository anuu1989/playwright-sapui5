#!/usr/bin/env bash
# Persists the run store between scheduled pipeline runs on an orphan branch (default: svm-e2e-state).
#   scripts/state.sh pull   restore .data/e2e_runs.json (no-op on the very first run)
#   scripts/state.sh push   save it back if it changed
# The workflow's `concurrency` group guarantees one pipeline touches the file at a time.
set -euo pipefail
BRANCH="${STATE_BRANCH:-svm-e2e-state}"
FILE="${STORE_PATH:-.data/e2e_runs.json}"
NAME="$(basename "$FILE")"
ROOT="$(git rev-parse --show-toplevel)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

case "${1:-}" in
  pull)
    mkdir -p "$(dirname "$FILE")"
    if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
      git fetch --depth=1 origin "$BRANCH"
      git show "FETCH_HEAD:$NAME" > "$FILE"
      echo "restored $FILE from $BRANCH"
    else
      echo "no $BRANCH branch yet - starting with an empty store"
    fi
    ;;
  push)
    [ -f "$FILE" ] || { echo "nothing to save"; exit 0; }
    if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
      git clone --quiet --depth=1 --branch "$BRANCH" "$(git remote get-url origin)" "$TMP/s"
    else
      git init --quiet -b "$BRANCH" "$TMP/s"
      git -C "$TMP/s" remote add origin "$(git -C "$ROOT" remote get-url origin)"
    fi
    cp "$FILE" "$TMP/s/$NAME"
    cd "$TMP/s"
    git add "$NAME"
    if git diff --cached --quiet; then echo "store unchanged"; exit 0; fi
    git -c user.name="svm-e2e" -c user.email="svm-e2e@users.noreply.github.com" commit --quiet -m "svm-e2e: update run store"
    git push --quiet origin "$BRANCH"
    echo "saved $FILE to $BRANCH"
    ;;
  *) echo "usage: state.sh pull|push" >&2; exit 2 ;;
esac
