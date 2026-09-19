#!/usr/bin/env bash
#
# setup.sh - one-command local setup for this repo's OWN example suite.
#
# What it does, in order: makes sure Node.js is new enough (switching via nvm if it's
# available and too old), installs dependencies, installs Playwright's Chromium browser,
# builds + lints + type-checks the library, then runs the example test suite against real,
# live public SAPUI5 demo apps. Every one of these steps is also documented as a plain command
# in README.md / docs/getting-started.md - this script just automates running them in order,
# with clearer output about what's happening and why.
#
# Usage:
#   ./setup.sh                 full setup + run the example suite
#   ./setup.sh --skip-checks   skip lint/typecheck/build (just install + run tests)
#   ./setup.sh --skip-tests    setup only, don't run the example suite at the end
#   ./setup.sh --help          show this help
#
# Requires bash. On Windows, run this inside WSL or Git Bash - or just follow the plain
# commands in README.md#try-the-examples-in-this-repo by hand instead.

set -eo pipefail
# (Deliberately not using `set -u`: nvm's own nvm.sh script references some unset variables
# internally, which trips `set -u` in a way that has nothing to do with bugs in this script.)

cd "$(dirname "${BASH_SOURCE[0]}")"

REQUIRED_NODE_MAJOR=18
SKIP_CHECKS=false
SKIP_TESTS=false

for arg in "$@"; do
  case "$arg" in
    --skip-checks) SKIP_CHECKS=true ;;
    --skip-tests) SKIP_TESTS=true ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (see --help)" >&2
      exit 1
      ;;
  esac
done

info() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mWarning:\033[0m %s\n' "$1"; }
error() { printf '\033[1;31mError:\033[0m %s\n' "$1" >&2; }

# --- 1. Make sure Node.js is new enough ---------------------------------------------------------
# This project hit exactly this issue during development: an old default Node version (16.x, or
# even an old *patch* of 18.x/20.x) can't run this project's tooling at all, or hits confusing
# errors partway through (see docs/troubleshooting.md). If nvm is installed and this repo's
# .nvmrc says a version nvm doesn't have yet, this installs it; either way, it switches to it.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  info "nvm found - installing/using the Node version in .nvmrc ($(cat .nvmrc 2>/dev/null || echo '?'))..."
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
  nvm install >/dev/null
  nvm use >/dev/null
fi

if ! command -v node >/dev/null 2>&1; then
  error "Node.js was not found. Install it (https://nodejs.org, or nvm: https://github.com/nvm-sh/nvm) and re-run this script."
  exit 1
fi

NODE_VERSION="$(node -v)"          # e.g. "v20.0.0"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"

if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  error "Node.js $REQUIRED_NODE_MAJOR or newer is required - found $NODE_VERSION."
  error "Install nvm (https://github.com/nvm-sh/nvm), then re-run this script, or run:"
  error "  nvm install --lts && nvm use --lts && ./setup.sh"
  exit 1
fi

info "Using Node $NODE_VERSION, npm v$(npm -v)"

# --- 2. Install dependencies ----------------------------------------------------------------
info "Installing dependencies (npm install)..."
npm install

# --- 3. Install Playwright's browser ----------------------------------------------------------
info "Installing Playwright's Chromium browser (npx playwright install chromium)..."
npx playwright install chromium

# --- 4. Build, lint, type-check - a sanity check that everything's wired correctly -------------
if [ "$SKIP_CHECKS" = true ]; then
  info "Skipping build/lint/typecheck (--skip-checks)."
else
  info "Building the library (npm run build)..."
  npm run build

  info "Linting (npm run lint)..."
  npm run lint

  info "Type-checking (npm run typecheck)..."
  npm run typecheck
fi

# --- 5. Run the example suite -------------------------------------------------------------------
if [ "$SKIP_TESTS" = true ]; then
  info "Skipping the example test suite (--skip-tests)."
  info "Setup complete. Run 'npm test' whenever you're ready to run it."
else
  info "Running the example test suite (npm test) against real, live public SAPUI5 demo apps..."
  npm test

  info "Done! All examples passed."
  echo "  - HTML report: npx playwright show-report"
  echo "  - Start here to learn the framework: docs/getting-started.md"
  echo "  - Guided tour of every example: docs/examples.md"
fi
