#!/bin/sh

# Load environment variables from .env file if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a            # export all sourced vars
  . "$SCRIPT_DIR/.env"
  set +a
fi

# ------------ Config (override via env or flags) ------------
SERVER_URL="${SERVER_URL:-http://veramo_server:3332}"      # your Veramo server base
BRANCH="${BRANCH:-gh-pages}"                           # git branch to commit to
GH_REPO="${GH_REPO:-git@github.com:MalmikeFunProjects/HostWebDid.git}"
GH_USER="${GH_USER:-malmike21}"
GH_EMAIL="${GH_EMAIL:-malmike21@gmail.com}"

# Initialize git if needed
git init
git config --global user.name "${GH_USER}"
git config --global user.email "${GH_EMAIL}"
git checkout -b "${BRANCH}" || true
git remote add origin "${GH_REPO}" || true
git pull origin "${BRANCH}" || true

# Run the application
exec go run src/main.go
